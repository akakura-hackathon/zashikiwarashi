"""Comprehensive integration tests for REST API endpoints (API-01 to API-08)."""

import pytest
from fastapi.testclient import TestClient

from src.db.factory import reset_in_memory_repo
from src.db.seed import seed_sc3_data
from src.main import app


@pytest.fixture(autouse=True)
async def setup_test_db():
    repo = reset_in_memory_repo()
    await seed_sc3_data(repo, building_id="bld-01")
    yield repo


def test_api_sc3_end_to_end_flow():
    client = TestClient(app)

    # 1. API-01: Trigger Emergency (Admin only)
    # Unauthorized as resident
    res_forbidden = client.post(
        "/emergency/trigger",
        json={"building_id": "bld-01", "instruction": "震度5強地震"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_forbidden.status_code == 403

    # Authorized as Admin
    res_trigger = client.post(
        "/emergency/trigger",
        json={"building_id": "bld-01", "instruction": "震度5強地震。安否確認開始"},
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_trigger.status_code == 200
    data_trigger = res_trigger.json()
    emergency_id = data_trigger["emergency_id"]
    issue_id = data_trigger["issue_id"]
    assert emergency_id.startswith("em-")
    assert issue_id.startswith("iss-")

    # 2. API-02: Resident I reports SAFE
    res_presence_i = client.post(
        "/emergency/confirm-presence",
        json={"emergency_id": emergency_id, "safety_status": "SAFE"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_presence_i.status_code == 200
    assert res_presence_i.json()["safety_status"] == "SAFE"

    # (Resident H remains UNKNOWN, Resident K is UNKNOWN but calendar busy)

    # 3. API-08: Admin triggers Triage
    res_triage = client.post(
        f"/emergencies/{emergency_id}/triage",
        json={"issue_id": issue_id},
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_triage.status_code == 200
    assert res_triage.json()["tasks_created"] >= 1

    # 4. API-03: Resident I views issue progress & finds assigned task
    res_issue_resident = client.get(
        f"/issues/{issue_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_issue_resident.status_code == 200
    resident_tasks = res_issue_resident.json()["tasks"]
    assert len(resident_tasks) >= 1
    task_for_h = next((t for t in resident_tasks if t["target_resident_id"] == "resident-h"), None)
    assert task_for_h is not None
    task_id = task_for_h["task_id"]

    # 5. API-06: Progressive Disclosure check BEFORE approval
    res_task_before = client.get(
        f"/tasks/{task_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_task_before.status_code == 200
    detail_before = res_task_before.json()
    assert detail_before["is_disclosed"] is False
    assert detail_before["target_room_number"] is None  # MASKED
    assert detail_before["target_floor"] == 3

    # 6. API-04: Resident I approves the neighbor check task
    res_approval = client.post(
        f"/tasks/{task_id}/respond",
        json={"response": "APPROVED"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_approval.status_code == 200
    assert res_approval.json()["status"] == "APPROVED"

    # API-06: Progressive Disclosure check AFTER approval -> Room 302 disclosed
    res_task_after = client.get(
        f"/tasks/{task_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_task_after.status_code == 200
    detail_after = res_task_after.json()
    assert detail_after["is_disclosed"] is True
    assert detail_after["target_room_number"] == "302"  # DISCLOSED

    # 7. API-05: Resident I reports completion with TARGET_NO_RESPONSE
    res_report = client.post(
        f"/tasks/{task_id}/report",
        json={"status": "COMPLETED", "reason_code": "TARGET_NO_RESPONSE"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_report.status_code == 200
    assert res_report.json()["status"] == "COMPLETED"

    # 8. API-03: Admin views issue progress and sees CRITICAL alert for 302
    res_issue_admin = client.get(
        f"/issues/{issue_id}",
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_issue_admin.status_code == 200
    priority_targets = res_issue_admin.json()["priority_targets"]
    target_302 = next((p for p in priority_targets if p["room_number"] == "302"), None)
    assert target_302 is not None
    assert target_302["priority_level"] == "CRITICAL"
    assert target_302["neighbor_check_result"] == "TARGET_NO_RESPONSE"

    # 9. API-07: Resident I views personal audit events
    res_audit = client.get(
        "/me/audit-events",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_audit.status_code == 200
    audit_events = res_audit.json()["audit_events"]
    assert len(audit_events) >= 1
    assert "unit_room_number:302" in audit_events[0]["data_disclosed"]
