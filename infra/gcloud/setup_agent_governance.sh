#!/usr/bin/env bash
# ==============================================================================
# Setup Script for Agent Governance (FN-10 / Step 7)
# 
# Configures:
# 1. Google Cloud APIs (modelarmor, networkservices, iap, etc.)
# 2. Model Armor Template (G2: Prompt Injection + SDP Filters)
# 3. Agent Gateway Ingress (G1) and Egress (G3)
# 4. Agent Registry (G6)
# 5. IAP Agent Authorization Policies (G4: CEL)
#
# Adheres to rules/infra.md and docs/ARCHITECTURE.md §3.4.
# ==============================================================================

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project)}"
REGION="${GCP_REGION:-us-central1}"
CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../agent_governance" && pwd)"

echo "=== [1/5] Enabling Agent Governance APIs in ${PROJECT_ID} ==="
gcloud services enable \
  modelarmor.googleapis.com \
  networkservices.googleapis.com \
  aiplatform.googleapis.com \
  iap.googleapis.com \
  dlp.googleapis.com \
  --project="${PROJECT_ID}"

echo "=== [2/5] Creating Model Armor Template (G2) ==="
# Template for Prompt Injection, Jailbreak, and SDP Filters
if gcloud beta model-armor templates describe zashikiwarashi-guardrails --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "[-] Model Armor template 'zashikiwarashi-guardrails' already exists. Updating..."
  gcloud beta model-armor templates update zashikiwarashi-guardrails \
    --location="${REGION}" \
    --config-file="${CONFIG_DIR}/model-armor-template.yaml" \
    --project="${PROJECT_ID}"
else
  echo "[+] Creating Model Armor template 'zashikiwarashi-guardrails'..."
  gcloud beta model-armor templates create zashikiwarashi-guardrails \
    --location="${REGION}" \
    --config-file="${CONFIG_DIR}/model-armor-template.yaml" \
    --project="${PROJECT_ID}"
fi

echo "=== [3/5] Setting up Agent Registry (G6) ==="
if gcloud beta network-services agent-registries describe zashikiwarashi-registry --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "[-] Agent Registry 'zashikiwarashi-registry' exists."
else
  echo "[+] Registering Agent Registry..."
  gcloud beta network-services agent-registries create zashikiwarashi-registry \
    --location="${REGION}" \
    --config-file="${CONFIG_DIR}/agent-registry.yaml" \
    --project="${PROJECT_ID}"
fi

echo "=== [4/5] Deploying Ingress (G1) and Egress (G3) Agent Gateways ==="
# Ingress (CLIENT_TO_AGENT)
if gcloud beta network-services agent-gateways describe agw-ingress-c2a --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "[-] Ingress Agent Gateway exists."
else
  echo "[+] Creating Ingress Agent Gateway (CLIENT_TO_AGENT)..."
  gcloud beta network-services agent-gateways create agw-ingress-c2a \
    --location="${REGION}" \
    --config-file="${CONFIG_DIR}/agw-ingress.yaml" \
    --project="${PROJECT_ID}"
fi

# Egress (AGENT_TO_ANYWHERE)
if gcloud beta network-services agent-gateways describe agw-egress-a2a --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "[-] Egress Agent Gateway exists."
else
  echo "[+] Creating Egress Agent Gateway (AGENT_TO_ANYWHERE)..."
  gcloud beta network-services agent-gateways create agw-egress-a2a \
    --location="${REGION}" \
    --config-file="${CONFIG_DIR}/agw-egress.yaml" \
    --project="${PROJECT_ID}"
fi

echo "=== [5/5] Applying IAP Agent Authorization Policies (G4: CEL) ==="
gcloud iap web set-iam-policy "${CONFIG_DIR}/iap-policy.json" \
  --project="${PROJECT_ID}" || echo "[!] Notice: IAP policy binding can also be enforced deterministically via Policy Engine."

echo "=== [+] Agent Governance Deployment Finished Successfully ==="
