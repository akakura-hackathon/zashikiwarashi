"""Task coordination service orchestrating Policy Engine and Repositories (API-04, 05, 06)."""

import uuid
from datetime import UTC, datetime

from src.db.base import BaseRepository
from src.models.domain import (
    ActorType,
    ReasonCode,
    ResidentEmergencyCurrentState,
    ResidentEmergencyStateEvent,
    SafetyStatus,
    TaskEvent,
    TaskEventType,
    TaskStatus,
)
from src.models.schemas import TaskDetailResponse
from src.services.policy_engine import PolicyEngine, PolicyViolationError


class TaskService:
    """Business logic for task lifecycle and privacy-preserving execution."""

    def __init__(self, repo: BaseRepository) -> None:
        self.repo = repo

    async def get_task_detail(
        self, building_id: str, emergency_id: str, task_id: str, actor_resident_id: str
    ) -> TaskDetailResponse:
        """Fetch task detail applying Progressive Disclosure (API-06)."""
        task = await self.repo.get_task(building_id, emergency_id, task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found.")

        # Ensure only assigned resident or target can view
        PolicyEngine.verify_resident_authorization(task, actor_resident_id)

        # Lookup target unit if neighbor check
        target_unit = None
        if task.target_resident_id:
            target_resident = await self.repo.get_resident(building_id, task.target_resident_id)
            if target_resident:
                target_unit = await self.repo.get_unit(building_id, target_resident.unit_id)

        # Lookup latest event
        events = await self.repo.list_task_events(building_id, emergency_id, task_id)
        latest_event = events[-1] if events else None

        return PolicyEngine.apply_progressive_disclosure(task, target_unit, latest_event)

    async def respond_to_task(
        self,
        building_id: str,
        emergency_id: str,
        task_id: str,
        actor_resident_id: str,
        response: TaskStatus,  # APPROVED | DECLINED
        reason_code: ReasonCode | None = None,
    ) -> tuple[TaskStatus, str]:
        """Respond to task offer (API-04). Only assigned resident can approve/decline."""
        task = await self.repo.get_task(building_id, emergency_id, task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found.")

        PolicyEngine.verify_resident_authorization(task, actor_resident_id)

        if response not in (TaskStatus.APPROVED, TaskStatus.DECLINED):
            raise PolicyViolationError("Response must be APPROVED or DECLINED.")

        now = datetime.now(UTC)
        event_id = f"evt-{uuid.uuid4().hex[:12]}"

        # Update task status
        task.status = response
        await self.repo.update_task(building_id, emergency_id, task)

        # Append TaskEvent
        event_type = (
            TaskEventType.APPROVED
            if response == TaskStatus.APPROVED
            else TaskEventType.DECLINED
        )
        event = TaskEvent(
            event_id=event_id,
            task_id=task_id,
            actor_resident_id=actor_resident_id,
            event_type=event_type,
            reason_code=reason_code,
            actor_type=ActorType.RESIDENT,
            occurred_at=now,
        )
        await self.repo.append_task_event(building_id, emergency_id, event)

        # If APPROVED, record AuditEvent for room number disclosure
        if response == TaskStatus.APPROVED and task.target_resident_id:
            target_res = await self.repo.get_resident(building_id, task.target_resident_id)
            if target_res:
                target_unit = await self.repo.get_unit(building_id, target_res.unit_id)
                if target_unit:
                    audit = PolicyEngine.create_disclosure_audit_event(
                        emergency_id, actor_resident_id, task, target_unit.room_number
                    )
                    await self.repo.append_audit_event(building_id, audit)

        return task.status, event_id

    async def report_task_progress(
        self,
        building_id: str,
        emergency_id: str,
        task_id: str,
        actor_resident_id: str,
        new_status: TaskStatus,  # STARTED | COMPLETED | FAILED
        reason_code: ReasonCode | None = None,
    ) -> tuple[TaskStatus, str]:
        """Report execution progress (API-05). Enforces prior approval."""
        task = await self.repo.get_task(building_id, emergency_id, task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found.")

        PolicyEngine.verify_resident_authorization(task, actor_resident_id)
        PolicyEngine.verify_task_approved_for_action(task, new_status)

        now = datetime.now(UTC)
        event_id = f"evt-{uuid.uuid4().hex[:12]}"

        # Update task status
        task.status = new_status
        await self.repo.update_task(building_id, emergency_id, task)

        # Map to TaskEventType
        event_type_map = {
            TaskStatus.IN_PROGRESS: TaskEventType.STARTED,
            TaskStatus.COMPLETED: TaskEventType.COMPLETED,
            TaskStatus.FAILED: TaskEventType.FAILED,
        }
        event = TaskEvent(
            event_id=event_id,
            task_id=task_id,
            actor_resident_id=actor_resident_id,
            event_type=event_type_map[new_status],
            reason_code=reason_code,
            actor_type=ActorType.RESIDENT,
            occurred_at=now,
        )
        await self.repo.append_task_event(building_id, emergency_id, event)

        # If neighbor check completed, reflect result onto target resident state (DESIGN §8 API-05)
        if new_status == TaskStatus.COMPLETED and task.target_resident_id:
            # If neighbor responded, safety is SAFE. If no response, keep UNKNOWN.
            updated_safety = (
                SafetyStatus.SAFE
                if reason_code == ReasonCode.TARGET_RESPONDED
                else SafetyStatus.UNKNOWN
            )
            await self.repo.set_current_state(
                building_id,
                ResidentEmergencyCurrentState(
                    emergency_id=emergency_id,
                    resident_id=task.target_resident_id,
                    safety_status=updated_safety,
                    observed_at=now,
                ),
            )
            # Append State Event
            await self.repo.append_state_event(
                building_id,
                ResidentEmergencyStateEvent(
                    event_id=f"state-evt-{uuid.uuid4().hex[:12]}",
                    emergency_id=emergency_id,
                    resident_id=task.target_resident_id,
                    safety_status=updated_safety,
                    occurred_at=now,
                    source="NEIGHBOR_CHECK",
                ),
            )

        return task.status, event_id
