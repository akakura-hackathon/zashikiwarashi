"""Triage service for SC-3 (Earthquake Safety Check Distribution Scenario).

Implements:
1. Automated classification of unconfirmed units (Likely Away vs. In-Building Target).
2. Neighbor-check task generation to nearest 'SAFE' resident on the same floor (1:1 no overlap).
3. Priority Alert generation for Management Office console (API-03 / DESIGN §6.3 D).
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from src.db.base import BaseRepository
from src.models.domain import (
    ActorType,
    PresenceState,
    ReasonCode,
    SafetyStatus,
    Task,
    TaskEvent,
    TaskEventType,
    TaskStatus,
    TaskType,
)
from src.models.schemas import PriorityAlertTarget


@dataclass
class TriageResult:
    emergency_id: str
    issue_id: str
    created_tasks: list[Task] = field(default_factory=list)
    unresponsive_count: int = 0
    likely_away_count: int = 0
    ai_reasoning: str = ""
    agent_model: str = "Building Agent (Vertex AI Gemini 2.5 Flash)"


class TriageService:
    """Core logic for safety check coordination in SC-3."""

    def __init__(self, repo: BaseRepository) -> None:
        self.repo = repo

    async def execute_sc3_triage(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> list[Task]:
        """Triage unconfirmed units and generate neighbor check tasks."""
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=60)  # 60s timeout for approval (DESIGN §7.4 #6)

        # 1. Fetch current status of all residents and units
        residents = await self.repo.list_residents(building_id)
        current_states = await self.repo.list_current_states(building_id, emergency_id)
        state_map = {s.resident_id: s.safety_status for s in current_states}

        # Units map: unit_id -> Unit
        units = await self.repo.list_units(building_id)
        unit_map = {u.unit_id: u for u in units}
        resident_unit_map = {r.resident_id: unit_map.get(r.unit_id) for r in residents}

        # 2. Classify candidates: Safe helpers vs. Unconfirmed targets
        safe_helpers_by_floor: dict[int, list[str]] = {}
        unconfirmed_targets_by_floor: dict[int, list[str]] = {}

        for resident in residents:
            r_id = resident.resident_id
            unit = resident_unit_map.get(r_id)
            if not unit:
                continue

            status = state_map.get(r_id, SafetyStatus.UNKNOWN)
            ctx = await self.repo.get_presence_context(building_id, r_id)
            presence = ctx.presence_state if ctx else PresenceState.UNKNOWN

            if status == SafetyStatus.SAFE:
                # Helper candidate if SAFE and in building
                if presence != PresenceState.OUTSIDE_BUILDING:
                    safe_helpers_by_floor.setdefault(unit.floor, []).append(r_id)
            elif status == SafetyStatus.UNKNOWN:
                # Unconfirmed: Only target if NOT outside building (Likely Away filtered out)
                if presence != PresenceState.OUTSIDE_BUILDING:
                    unconfirmed_targets_by_floor.setdefault(unit.floor, []).append(r_id)

        # 3. Match nearest safe helper to unconfirmed target on same floor (1:1, no duplicates)
        tasks_created: list[Task] = []
        assigned_helpers: set[str] = set()

        for floor, target_resident_ids in unconfirmed_targets_by_floor.items():
            helpers = safe_helpers_by_floor.get(floor, [])
            available_helpers = [h for h in helpers if h not in assigned_helpers]

            for target_id in target_resident_ids:
                if not available_helpers:
                    break

                target_unit = resident_unit_map[target_id]
                target_room = int(target_unit.room_number) if target_unit else 0

                # Find closest helper by room number distance
                closest_helper = min(
                    available_helpers,
                    key=lambda h: abs(
                        int(resident_unit_map[h].room_number) - target_room
                        if resident_unit_map.get(h)
                        else 999
                    ),
                )

                available_helpers.remove(closest_helper)
                assigned_helpers.add(closest_helper)

                # Create Neighbor Check Task (E-012)
                task_id = f"task-{uuid.uuid4().hex[:12]}"
                helper_unit = resident_unit_map[closest_helper]
                new_task = Task(
                    task_id=task_id,
                    issue_id=issue_id,
                    resident_id=closest_helper,
                    target_resident_id=target_id,
                    start_node_id=helper_unit.entrance_node_id if helper_unit else None,
                    destination_node_id=target_unit.entrance_node_id if target_unit else None,
                    task_type=TaskType.NEIGHBOR_CHECK,
                    estimated_seconds=20,
                    status=TaskStatus.OFFERED,
                    created_at=now,
                )
                await self.repo.create_task(building_id, emergency_id, new_task)

                # Append TaskEvent (E-013)
                event = TaskEvent(
                    event_id=f"evt-{uuid.uuid4().hex[:12]}",
                    task_id=task_id,
                    actor_resident_id=closest_helper,
                    event_type=TaskEventType.OFFERED,
                    actor_type=ActorType.BUILDING_AGENT,
                    occurred_at=now,
                    expires_at=expires_at,
                )
                await self.repo.append_task_event(building_id, emergency_id, event)
                tasks_created.append(new_task)

        return tasks_created

    async def execute_sc3_triage_result(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> TriageResult:
        """Triage unconfirmed units and return structured TriageResult."""
        tasks = await self.execute_sc3_triage(building_id, emergency_id, issue_id)
        current_states = await self.repo.list_current_states(building_id, emergency_id)
        residents = await self.repo.list_residents(building_id)

        unresponsive = sum(1 for s in current_states if s.safety_status == SafetyStatus.UNKNOWN)
        likely_away = 0
        for r in residents:
            ctx = await self.repo.get_presence_context(building_id, r.resident_id)
            if ctx and ctx.presence_state == PresenceState.OUTSIDE_BUILDING:
                likely_away += 1

        if tasks:
            task_summaries = [f"{t.resident_id} → {t.target_resident_id}" for t in tasks]
            reasoning = (
                f"未応答{unresponsive}戸を分析。カレンダー不在判定({likely_away}戸)を低優先除外。"
                f"同一階の安全回答者へ隣室確認({len(tasks)}件: {', '.join(task_summaries)})"
                "を1:1重複なし・20秒でペアリングしました。"
            )
        else:
            reasoning = (
                f"未応答{unresponsive}戸を分析。カレンダー不在判定({likely_away}戸)を除外。"
                "同一階に割当可能な安全回答済みの住民がいません。"
            )

        return TriageResult(
            emergency_id=emergency_id,
            issue_id=issue_id,
            created_tasks=tasks,
            unresponsive_count=unresponsive,
            likely_away_count=likely_away,
            ai_reasoning=reasoning,
            agent_model="Building Agent (Vertex AI Gemini 2.5 Flash / Policy Engine)",
        )

    async def calculate_priority_alerts(
        self, building_id: str, emergency_id: str
    ) -> list[PriorityAlertTarget]:
        """Compute priority alerts for management console (DESIGN §6.3 D).
        
        Condition:
          - Target resident is UNKNOWN
          - Neighbor check task reported TARGET_NO_RESPONSE
          - Target household is elderly or mobility impaired
        """
        residents = await self.repo.list_residents(building_id)
        current_states = await self.repo.list_current_states(building_id, emergency_id)
        state_map = {s.resident_id: s.safety_status for s in current_states}
        units = await self.repo.list_units(building_id)
        unit_map = {u.unit_id: u for u in units}

        # Check neighbor check task results
        priority_targets: list[PriorityAlertTarget] = []

        # Query all tasks for this emergency to correlate neighbor check results
        all_tasks = await self.repo.list_all_tasks(building_id, emergency_id)
        target_tasks_map: dict[str, list[Task]] = {}
        for t in all_tasks:
            if t.target_resident_id:
                target_tasks_map.setdefault(t.target_resident_id, []).append(t)

        for resident in residents:
            r_id = resident.resident_id
            unit = unit_map.get(resident.unit_id)
            if not unit:
                continue

            status = state_map.get(r_id, SafetyStatus.UNKNOWN)
            profile = await self.repo.get_household_profile(building_id, unit.unit_id)

            is_elderly = (profile.elderly_count > 0) if profile else False
            is_mobility = (profile.mobility_difficulty_count > 0) if profile else False
            is_priority_household = (profile.is_priority_support_target) if profile else False

            # Inspect neighbor check task results targeting this resident
            neighbor_result: ReasonCode | None = None
            tasks = target_tasks_map.get(r_id, [])
            for t in tasks:
                if t.task_type == TaskType.NEIGHBOR_CHECK:
                    events = await self.repo.list_task_events(building_id, emergency_id, t.task_id)
                    for ev in events:
                        if ev.event_type == TaskEventType.COMPLETED and ev.reason_code:
                            neighbor_result = ev.reason_code

            if status == SafetyStatus.UNKNOWN and is_priority_household:
                priority_level = (
                    "CRITICAL"
                    if neighbor_result == ReasonCode.TARGET_NO_RESPONSE
                    else "HIGH"
                )
                priority_targets.append(
                    PriorityAlertTarget(
                        resident_id=r_id,
                        unit_id=unit.unit_id,
                        room_number=unit.room_number,
                        floor=unit.floor,
                        safety_status=status,
                        is_elderly=is_elderly,
                        is_mobility_difficulty=is_mobility,
                        neighbor_check_result=neighbor_result,
                        priority_level=priority_level,
                    )
                )

        return priority_targets
