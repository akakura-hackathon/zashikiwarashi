#!/usr/bin/env bash
# 初回構築（1回だけ・オーナー権限で実行）: Terraform が動く前に必要なものを作る。
# - Terraform が使う API（Cloud Resource Manager・Service Usage）の有効化
# - Terraform の state 用 GCS バケット
# 以降は infra/terraform で `terraform init && terraform apply` する（infra/terraform/README.md）。
# docs/ARCHITECTURE.md §6.1、rules/infra.md
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-zashikiwarashi}"
REGION="${REGION:-us-central1}"
BUCKET="${TFSTATE_BUCKET:-zashikiwarashi-tfstate}"

gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com \
  --project "$PROJECT_ID"

if gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "state バケット gs://${BUCKET} は作成済み"
else
  gcloud storage buckets create "gs://${BUCKET}" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

# state を誤って上書き・削除したときに戻せるようにする
gcloud storage buckets update "gs://${BUCKET}" --versioning

echo "完了。次は infra/terraform で terraform init && terraform plan を実行する。"
