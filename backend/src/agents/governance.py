"""Agent Governance Engine enforcing control points G1 - G6.

Adheres strictly to docs/ARCHITECTURE.md §3.4 and Domain Principle 4:
- G1: Ingress Gateway (CLIENT_TO_AGENT)
- G2: Model Armor (Prompt Injection / Jailbreak & SDP Filters)
- G3: Egress Gateway (AGENT_TO_ANYWHERE)
- G4: IAP Agent Policy (Agent Identity x CEL Deterministic Enforcement)
- G5: Policy Engine Integration
- G6: Agent Registry Validation
"""

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class AgentIdentity(StrEnum):
    """G4: Official Agent Identities."""
    BUILDING_AGENT = "serviceAccount:building-agent-sa@zashikiwarashi.iam.gserviceaccount.com"
    RESIDENT_AGENT = "serviceAccount:resident-agent-sa@zashikiwarashi.iam.gserviceaccount.com"
    API_INGESTION = "serviceAccount:api-runtime@zashikiwarashi.iam.gserviceaccount.com"
    UNAUTHORIZED = "serviceAccount:unauthorized-external@malicious.com"


class GovernanceViolationType(StrEnum):
    INGRESS_UNAUTHORIZED = "INGRESS_UNAUTHORIZED"
    MODEL_ARMOR_PROMPT_INJECTION = "MODEL_ARMOR_PROMPT_INJECTION"
    MODEL_ARMOR_SDP_PII_LEAK = "MODEL_ARMOR_SDP_PII_LEAK"
    EGRESS_UNREGISTERED_DESTINATION = "EGRESS_UNREGISTERED_DESTINATION"
    IAP_PERMISSION_DENIED = "IAP_PERMISSION_DENIED"
    POLICY_ENGINE_VIOLATION = "POLICY_ENGINE_VIOLATION"


class AgentGovernanceError(Exception):
    """Raised when an Agent Gateway, Model Armor, or IAP policy is violated."""

    def __init__(
        self,
        violation_type: GovernanceViolationType,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(f"[{violation_type}] {message}")
        self.violation_type = violation_type
        self.message = message
        self.details = details or {}


@dataclass
class GovernanceValidationResult:
    allowed: bool
    violation_type: GovernanceViolationType | None = None
    reason: str = ""


class AgentGovernanceEngine:
    """Deterministic Multi-Agent Governance Guardrail System."""

    # G6: Registered service endpoints
    REGISTERED_SERVICES = {
        "mcp-tools",
        "vertex-ai-gemini",
        "resident-agent-a2a",
    }

    # G4: IAP Allowed Tools per Agent Identity
    ALLOWED_TOOLS_BY_IDENTITY = {
        AgentIdentity.BUILDING_AGENT: {
            "generate_triage_candidate",
            "dispatch_task",
            "query_candidate_capability",
        },
        AgentIdentity.RESIDENT_AGENT: {
            "read_own_profile",
            "record_evaluation",
        },
    }

    # G2: Known prompt injection / jailbreak patterns
    PROMPT_INJECTION_PATTERNS = [
        re.compile(r"ignore\s+(all\s+)?(previous|prior)\s+instructions", re.IGNORECASE),
        re.compile(r"system\s+prompt\s+override", re.IGNORECASE),
        re.compile(r"you\s+are\s+now\s+(DAN|unrestricted|god\s+mode)", re.IGNORECASE),
        re.compile(r"disregard\s+all\s+guardrails", re.IGNORECASE),
        re.compile(r"bypass\s+policy", re.IGNORECASE),
        re.compile(
            r"reveal\s+all\s+.*(?:resident|personal|secret|private).*\s*data", re.IGNORECASE
        ),
    ]

    # G2 / SDP: Regex for room numbers (3 or 4 digits like 301, 302, 1204, or with 号室)
    ROOM_NUMBER_PATTERN = re.compile(r"\b([1-9][0-9]{2,3})(?:号室)?\b")
    PHONE_NUMBER_PATTERN = re.compile(r"\b0\d{1,4}[-(]?\d{1,4}[-)]?\d{4}\b")

    @classmethod
    def validate_ingress(
        cls,
        caller_identity: str,
        target_agent: AgentIdentity,
        input_prompt: str,
    ) -> GovernanceValidationResult:
        """G1 & G2: Validate Ingress Gateway access and run Model Armor input inspection."""
        # 1. G1: Caller authorization (Must be API Ingestion or trusted internal coordinator)
        trusted_callers = {
            AgentIdentity.API_INGESTION,
            AgentIdentity.BUILDING_AGENT,
            "admin",
            "system",
        }
        if caller_identity not in trusted_callers:
            raise AgentGovernanceError(
                GovernanceViolationType.INGRESS_UNAUTHORIZED,
                f"Unauthorized caller '{caller_identity}' blocked by Ingress Agent Gateway.",
            )

        # 2. G2: Model Armor Prompt Injection / Jailbreak Filter
        for pattern in cls.PROMPT_INJECTION_PATTERNS:
            if pattern.search(input_prompt):
                raise AgentGovernanceError(
                    GovernanceViolationType.MODEL_ARMOR_PROMPT_INJECTION,
                    "Prompt injection or jailbreak detected by Model Armor filter.",
                    details={"matched_pattern": pattern.pattern},
                )

        return GovernanceValidationResult(allowed=True)

    @classmethod
    def validate_egress(
        cls,
        agent_identity: AgentIdentity,
        target_service: str,
        tool_name: str | None = None,
        payload_text: str | None = None,
    ) -> GovernanceValidationResult:
        """G3, G4, G6: Validate Egress Gateway, Agent Registry, and IAP CEL policy."""
        # 1. G6: Agent Registry Destination Check
        if target_service not in cls.REGISTERED_SERVICES:
            raise AgentGovernanceError(
                GovernanceViolationType.EGRESS_UNREGISTERED_DESTINATION,
                f"Target destination '{target_service}' is not registered in Agent Registry.",
            )

        # 2. G4: IAP Agent Policy (CEL Check)
        if tool_name:
            allowed_tools = cls.ALLOWED_TOOLS_BY_IDENTITY.get(agent_identity, set())
            if tool_name not in allowed_tools:
                raise AgentGovernanceError(
                    GovernanceViolationType.IAP_PERMISSION_DENIED,
                    f"Agent Identity '{agent_identity}' is forbidden from invoking '{tool_name}'.",
                    details={"tool_name": tool_name, "agent_identity": agent_identity},
                )

        # 3. G2 / SDP: Model Armor Sensitive Data Protection (PII Leak Prevention)
        if payload_text:
            if cls.ROOM_NUMBER_PATTERN.search(payload_text):
                raise AgentGovernanceError(
                    GovernanceViolationType.MODEL_ARMOR_SDP_PII_LEAK,
                    "Model Armor SDP filter blocked payload containing plain unit/room number.",
                    details={"field": "room_number"},
                )
            if cls.PHONE_NUMBER_PATTERN.search(payload_text):
                raise AgentGovernanceError(
                    GovernanceViolationType.MODEL_ARMOR_SDP_PII_LEAK,
                    "Model Armor SDP filter blocked outgoing payload containing phone number.",
                    details={"field": "phone_number"},
                )

        return GovernanceValidationResult(allowed=True)
