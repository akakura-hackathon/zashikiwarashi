"""Policy Engine enforcing privacy, safety, and Progressive Disclosure (G5 / FN-06 / FN-07).

Principles:
1. LLM provides intelligence, but code enforces authority (Domain Principle 4).
2. Progressive Disclosure: Unit room numbers and personal details are strictly HIDDEN
   until explicit Human Approval (TaskEvent APPROVED) is granted.
3. Only the assigned resident via API-04 can write APPROVED/DECLINED (PRV-06).
4. Child Safety: Private units cannot be designated for child care without cameras.
5. All disclosure events produce append-only AuditEvents (E-016).
"""

import uuid
from datetime import UTC, datetime

from src.models.domain import (
    ActorType,
    AuditEvent,
    NodeType,
    Task,
    TaskEvent,
    TaskStatus,
    Unit,
)
from src.models.schemas import TaskDetailResponse


class PolicyViolationError(Exception):
    """Raised when an operation violates security, safety, or privacy policies."""
    pass


class PolicyEngine:
    """Deterministic system code enforcing safety and disclosure rules."""

    @staticmethod
    def verify_resident_authorization(task: Task, actor_resident_id: str) -> None:
        """Ensure only the assigned resident can respond to or report on their task."""
        if task.resident_id != actor_resident_id:
            raise PolicyViolationError(
                f"Unauthorized: Resident {actor_resident_id} cannot operate on task {task.task_id} "
                f"assigned to {task.resident_id}."
            )

    @staticmethod
    def verify_task_approved_for_action(task: Task, target_status: TaskStatus) -> None:
        """Prevent task progress (IN_PROGRESS, COMPLETED, FAILED) if not yet APPROVED."""
        if target_status in (TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED, TaskStatus.FAILED):
            if task.status not in (TaskStatus.APPROVED, TaskStatus.IN_PROGRESS):
                raise PolicyViolationError(
                    f"Policy Violation: Cannot transition task {task.task_id} from {task.status} "
                    f"to {target_status} without prior Human Approval (APPROVED)."
                )

    @staticmethod
    def apply_progressive_disclosure(
        task: Task,
        target_unit: Unit | None,
        latest_event: TaskEvent | None = None,
    ) -> TaskDetailResponse:
        """Apply Progressive Disclosure to task view.
        
        If task is APPROVED or IN_PROGRESS or COMPLETED:
            Room number, unit ID, and floor are disclosed.
        Otherwise:
            Room number and unit ID are MASKED (None).
        """
        is_disclosed = task.status in (
            TaskStatus.APPROVED,
            TaskStatus.IN_PROGRESS,
            TaskStatus.COMPLETED,
        )

        if is_disclosed and target_unit:
            return TaskDetailResponse(
                task=task,
                target_room_number=target_unit.room_number,
                target_floor=target_unit.floor,
                target_unit_id=target_unit.unit_id,
                is_disclosed=True,
                latest_event=latest_event,
            )

        # Masked view before approval
        return TaskDetailResponse(
            task=task,
            target_room_number=None,
            target_floor=target_unit.floor if target_unit else None,
            target_unit_id=None,
            is_disclosed=False,
            latest_event=latest_event,
        )

    @staticmethod
    def create_disclosure_audit_event(
        emergency_id: str,
        actor_resident_id: str,
        task: Task,
        disclosed_room_number: str,
    ) -> AuditEvent:
        """Generate audit record whenever high-identifying room number is disclosed."""
        now = datetime.now(UTC)
        return AuditEvent(
            audit_event_id=f"aud-{uuid.uuid4().hex[:12]}",
            emergency_id=emergency_id,
            actor_type=ActorType.RESIDENT,
            actor_id=actor_resident_id,
            action="DISCLOSE_ROOM_NUMBER_ON_APPROVAL",
            target_type="TASK",
            target_id=task.task_id,
            data_used=["resident_approval", "task_id"],
            data_disclosed=[f"unit_room_number:{disclosed_room_number}"],
            occurred_at=now,
        )

    @staticmethod
    def verify_child_safety_location(destination_node_type: NodeType) -> None:
        """Enforce Child Safety Policy (Domain Principle 4 / DESIGN §3.1).
        
        Child accompaniment / waiting locations must be public monitored areas
        (e.g. LOUNGE, MANAGEMENT_OFFICE), strictly prohibiting private units.
        """
        allowed_types = (NodeType.LOUNGE, NodeType.MANAGEMENT_OFFICE)
        if destination_node_type not in allowed_types:
            raise PolicyViolationError(
                f"Child Safety Policy Violation: Destination {destination_node_type} is not a "
                "monitored public area. Must be LOUNGE or MANAGEMENT_OFFICE."
            )
