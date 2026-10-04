"""Tests for Policy Engine rules: Progressive Disclosure, Authorization, and Child Safety."""

import pytest

from src.models.domain import (
    NodeType,
    Task,
    TaskStatus,
    TaskType,
    Unit,
)
from src.services.policy_engine import PolicyEngine, PolicyViolationError


def test_progressive_disclosure_masking():
    unit = Unit(
        unit_id="unit-302",
        building_id="bld-01",
        entrance_node_id="node-302",
        room_number="302",
        floor=3,
    )
    task = Task(
        task_id="tsk-01",
        issue_id="iss-01",
        resident_id="res-i",
        target_resident_id="res-h",
        task_type=TaskType.NEIGHBOR_CHECK,
        status=TaskStatus.OFFERED,  # Not yet approved
    )

    # 1. Before approval: Room number is strictly masked
    view = PolicyEngine.apply_progressive_disclosure(task, unit)
    assert view.is_disclosed is False
    assert view.target_room_number is None
    assert view.target_floor == 3

    # 2. After approval: Room number is disclosed
    task.status = TaskStatus.APPROVED
    approved_view = PolicyEngine.apply_progressive_disclosure(task, unit)
    assert approved_view.is_disclosed is True
    assert approved_view.target_room_number == "302"
    assert approved_view.target_floor == 3


def test_action_blocked_without_approval():
    task = Task(
        task_id="tsk-01",
        issue_id="iss-01",
        resident_id="res-i",
        task_type=TaskType.NEIGHBOR_CHECK,
        status=TaskStatus.OFFERED,
    )

    # Cannot start or complete without approval
    with pytest.raises(PolicyViolationError) as exc_info:
        PolicyEngine.verify_task_approved_for_action(task, TaskStatus.COMPLETED)
    assert "without prior Human Approval" in str(exc_info.value)


def test_resident_authorization():
    task = Task(
        task_id="tsk-01",
        issue_id="iss-01",
        resident_id="res-i",
        task_type=TaskType.NEIGHBOR_CHECK,
        status=TaskStatus.OFFERED,
    )

    # Authorized
    PolicyEngine.verify_resident_authorization(task, "res-i")

    # Unauthorized resident
    with pytest.raises(PolicyViolationError) as exc_info:
        PolicyEngine.verify_resident_authorization(task, "res-stranger")
    assert "Unauthorized" in str(exc_info.value)


def test_child_safety_policy():
    # Public monitored areas allowed
    PolicyEngine.verify_child_safety_location(NodeType.LOUNGE)
    PolicyEngine.verify_child_safety_location(NodeType.MANAGEMENT_OFFICE)

    # Private units or unmonitored stairs rejected
    with pytest.raises(PolicyViolationError):
        PolicyEngine.verify_child_safety_location(NodeType.UNIT_ENTRANCE)
    with pytest.raises(PolicyViolationError):
        PolicyEngine.verify_child_safety_location(NodeType.STAIRS)
