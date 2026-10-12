"""Integration tests for Governance API endpoints (FN-10, Issue #44).

Verifies that POST /governance/test-guardrail correctly blocks adversarial attacks
and returns 200 OK with status BLOCKED for live demonstration.
"""

from fastapi.testclient import TestClient

from src.main import app


def test_governance_test_guardrail_prompt_injection():
    client = TestClient(app)
    res = client.post(
        "/governance/test-guardrail",
        json={"test_type": "PROMPT_INJECTION"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["test_type"] == "PROMPT_INJECTION"
    assert data["status"] == "BLOCKED"
    assert "Model Armor" in data["guardrail_layer"]
    assert "MODEL_ARMOR_PROMPT_INJECTION" in data["violation_code"]


def test_governance_test_guardrail_iap_forbidden_tool():
    client = TestClient(app)
    res = client.post(
        "/governance/test-guardrail",
        json={"test_type": "IAP_FORBIDDEN_TOOL"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["test_type"] == "IAP_FORBIDDEN_TOOL"
    assert data["status"] == "BLOCKED"
    assert "IAP" in data["guardrail_layer"]
    assert "IAP_PERMISSION_DENIED" in data["violation_code"]


def test_governance_test_guardrail_sdp_room_leak():
    client = TestClient(app)
    res = client.post(
        "/governance/test-guardrail",
        json={"test_type": "SDP_ROOM_LEAK"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["test_type"] == "SDP_ROOM_LEAK"
    assert data["status"] == "BLOCKED"
    assert "SDP" in data["guardrail_layer"]
    assert "MODEL_ARMOR_SDP_PII_LEAK" in data["violation_code"]


def test_governance_test_guardrail_invalid_type():
    client = TestClient(app)
    res = client.post(
        "/governance/test-guardrail",
        json={"test_type": "UNKNOWN_ATTACK"},
    )
    assert res.status_code == 422
