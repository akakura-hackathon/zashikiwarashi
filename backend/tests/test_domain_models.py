"""Tests for Cat 1-5 domain models and validation."""

from datetime import UTC, datetime

from src.models.domain import (
    AuditEvent,
    Building,
    Emergency,
    EmergencyStatus,
    EmergencyType,
    HouseholdProfile,
    Issue,
    IssueStatus,
    IssueType,
    PresenceContext,
    PresenceState,
    Resident,
    ResidentEmergencyCurrentState,
    SafetyStatus,
    SourceType,
    Task,
    TaskEvent,
    TaskEventType,
    TaskStatus,
    TaskType,
    Unit,
)


def test_domain_model_creation():
    now = datetime.now(UTC)

    # Cat 1
    building = Building(building_id="bld-01", name="Test Building", floor_count=15)
    assert building.building_id == "bld-01"

    unit = Unit(
        unit_id="unit-302",
        building_id="bld-01",
        entrance_node_id="node-302",
        room_number="302",
        floor=3,
    )
    assert unit.room_number == "302"

    # Cat 2
    resident = Resident(resident_id="res-h", unit_id="unit-302")
    assert resident.resident_id == "res-h"
    profile = HouseholdProfile(unit_id="unit-302", elderly_count=1, mobility_difficulty_count=1)
    assert profile.is_priority_support_target is True

    # Cat 3
    presence = PresenceContext(
        resident_id="res-h",
        presence_state=PresenceState.IN_BUILDING,
        expires_at=now,
        source_type=SourceType.DEVICE_SIGNAL,
    )
    assert presence.presence_state == PresenceState.IN_BUILDING

    # Cat 4
    emergency = Emergency(
        emergency_id="em-01",
        building_id="bld-01",
        emergency_type=EmergencyType.EARTHQUAKE,
        triggered_by="admin-01",
    )
    assert emergency.status == EmergencyStatus.ACTIVE

    state = ResidentEmergencyCurrentState(
        emergency_id="em-01",
        resident_id="res-h",
        safety_status=SafetyStatus.UNKNOWN,
    )
    assert state.safety_status == SafetyStatus.UNKNOWN

    # Cat 5
    issue = Issue(
        issue_id="iss-01",
        emergency_id="em-01",
        issue_type=IssueType.SAFETY_CHECK,
        instruction="地震安否確認",
        created_by_admin_id="admin-01",
    )
    assert issue.status == IssueStatus.OPEN

    task = Task(
        task_id="tsk-01",
        issue_id="iss-01",
        resident_id="res-i",
        target_resident_id="res-h",
        task_type=TaskType.NEIGHBOR_CHECK,
        status=TaskStatus.OFFERED,
    )
    assert task.status == TaskStatus.OFFERED

    event = TaskEvent(
        event_id="evt-01",
        task_id="tsk-01",
        event_type=TaskEventType.APPROVED,
    )
    assert event.event_type == TaskEventType.APPROVED

    audit = AuditEvent(
        audit_event_id="aud-01",
        emergency_id="em-01",
        actor_type="RESIDENT",
        actor_id="res-i",
        action="TASK_APPROVED",
        target_type="TASK",
        target_id="tsk-01",
        data_disclosed=["unit_302_room_number"],
    )
    assert "unit_302_room_number" in audit.data_disclosed
