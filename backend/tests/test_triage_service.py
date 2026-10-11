"""Tests for TriageService and TaskService end-to-end SC-3 workflow."""

import pytest

from src.db.in_memory_repo import InMemoryRepository
from src.db.seed import seed_sc3_data
from src.models.domain import (
    Emergency,
    EmergencyType,
    Issue,
    ReasonCode,
    ResidentEmergencyCurrentState,
    SafetyStatus,
    TaskStatus,
)
from src.services.task_service import TaskService
from src.services.triage_service import TriageService


@pytest.mark.asyncio
async def test_sc3_triage_and_task_lifecycle():
    repo = InMemoryRepository()
    building_id = "bld-01"
    emergency_id = "em-sc3-01"
    issue_id = "iss-sc3-01"

    # 1. Populate Building & Residents (150 units, H/I/J/K personas)
    await seed_sc3_data(repo, building_id=building_id)

    # 2. Trigger Emergency & Safety Check Issue
    await repo.create_emergency(
        Emergency(
            emergency_id=emergency_id,
            building_id=building_id,
            emergency_type=EmergencyType.EARTHQUAKE,
            triggered_by="admin-01",
        )
    )
    await repo.create_issue(
        building_id,
        Issue(
            issue_id=issue_id,
            emergency_id=emergency_id,
            instruction="震度5強地震。各戸の安否確認",
            created_by_admin_id="admin-01",
        ),
    )

    # 3. Simulate Responses:
    # Resident I (301) reports SAFE
    await repo.set_current_state(
        building_id,
        ResidentEmergencyCurrentState(
            emergency_id=emergency_id,
            resident_id="resident-i",
            safety_status=SafetyStatus.SAFE,
        ),
    )
    # Resident H (302) is UNKNOWN (Unconfirmed elderly solo)
    await repo.set_current_state(
        building_id,
        ResidentEmergencyCurrentState(
            emergency_id=emergency_id,
            resident_id="resident-h",
            safety_status=SafetyStatus.UNKNOWN,
        ),
    )
    # Resident K (504) is UNKNOWN, but presence context is OUTSIDE_BUILDING (calendar busy)
    await repo.set_current_state(
        building_id,
        ResidentEmergencyCurrentState(
            emergency_id=emergency_id,
            resident_id="resident-k",
            safety_status=SafetyStatus.UNKNOWN,
        ),
    )

    # 4. Execute SC-3 Triage
    triage_svc = TriageService(repo)
    tasks = await triage_svc.execute_sc3_triage(building_id, emergency_id, issue_id)

    # Resident I on 3F should be assigned neighbor check for Resident H (302)
    assert len(tasks) >= 1
    task_for_h = next((t for t in tasks if t.target_resident_id == "resident-h"), None)
    assert task_for_h is not None
    assert task_for_h.resident_id == "resident-i"
    assert task_for_h.status == TaskStatus.OFFERED
    assert task_for_h.expires_at is not None

    # Resident K (504, outside building) should NOT have neighbor check task created
    task_for_k = next((t for t in tasks if t.target_resident_id == "resident-k"), None)
    assert task_for_k is None

    # 5. Task Detail Before Approval: Progressive Disclosure
    task_svc = TaskService(repo)
    detail_before = await task_svc.get_task_detail(
        building_id, emergency_id, task_for_h.task_id, "resident-i"
    )
    assert detail_before.is_disclosed is False
    assert detail_before.target_room_number is None  # MASKED
    assert detail_before.target_floor == 3

    # 6. Resident I approves the task (Human Approval)
    status, _ = await task_svc.respond_to_task(
        building_id,
        emergency_id,
        task_for_h.task_id,
        "resident-i",
        TaskStatus.APPROVED,
    )
    assert status == TaskStatus.APPROVED

    # Detail After Approval: Room Number 302 Disclosed
    detail_after = await task_svc.get_task_detail(
        building_id, emergency_id, task_for_h.task_id, "resident-i"
    )
    assert detail_after.is_disclosed is True
    assert detail_after.target_room_number == "302"

    # Audit Event Recorded for Room Number Disclosure
    audits = await repo.list_audit_events_for_resident(
        building_id, emergency_id, "resident-i"
    )
    assert len(audits) >= 1
    assert "unit_room_number:302" in audits[0].data_disclosed

    # 7. Resident I completes task with "TARGET_NO_RESPONSE" (インターホン応答なし)
    await task_svc.report_task_progress(
        building_id,
        emergency_id,
        task_for_h.task_id,
        "resident-i",
        TaskStatus.COMPLETED,
        reason_code=ReasonCode.TARGET_NO_RESPONSE,
    )

    # 8. Priority Alert Verification for Management Console
    alerts = await triage_svc.calculate_priority_alerts(building_id, emergency_id)
    target_alert = next((a for a in alerts if a.resident_id == "resident-h"), None)
    assert target_alert is not None
    assert target_alert.room_number == "302"
    assert target_alert.is_elderly is True
    assert target_alert.priority_level == "CRITICAL"
