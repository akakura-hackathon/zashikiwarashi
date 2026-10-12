"""Triage service for SC-3 (Earthquake Safety Check Distribution Scenario).

Implements:
1. Automated classification of unconfirmed units (Likely Away vs. In-Building Target).
2. Neighbor-check task generation to nearest 'SAFE' resident on the same floor (1:1 no overlap).
3. Priority Alert generation for Management Office console (API-03 / DESIGN §6.3 D).
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from src.db.base import BaseRepository
from src.models.domain import (
    ActorType,
    EmergencyType,
    IssueStatus,
    PresenceState,
    ReasonCode,
    SafetyStatus,
    Task,
    TaskEvent,
    TaskEventType,
    TaskStatus,
    TaskType,
)
from src.models.schemas import PriorityAlertTarget, TaskBoardItem

DISASTER_TASK_CONFIG: dict[EmergencyType, dict] = {
    EmergencyType.EARTHQUAKE: {
        "task_type": TaskType.NEIGHBOR_CHECK,
        "title": "隣室の安否確認",
        "description": "ご自身の安全確認後、近隣住戸のインターホン確認をお願いします。",
        "estimated_seconds": 20,
    },
    EmergencyType.POWER_OUTAGE: {
        "task_type": TaskType.SUPPLY_RELAY,
        "title": "飲料水の階段リレー運搬",
        "description": (
            "全館停電・エレベーター停止のため、指定踊り場への物資リレー運搬を依頼します。"
        ),
        "estimated_seconds": 240,
    },
    EmergencyType.FIRE: {
        "task_type": TaskType.EVACUATION_ESCORT,
        "title": "西側非常階段への避難同行",
        "description": "同一階の要配慮住戸の方と合流し、西側非常階段まで同行避難をお願いします。",
        "estimated_seconds": 30,
    },
    EmergencyType.FLOOD: {
        "task_type": TaskType.VERTICAL_EVACUATION,
        "title": "上層階への垂直避難同行",
        "description": (
            "浸水警戒区域のため、上層階（6階以上）への垂直避難への同行支援を依頼します。"
        ),
        "estimated_seconds": 60,
    },
}


@dataclass
class TriageResult:
    emergency_id: str
    issue_id: str
    created_tasks: list[Task] = field(default_factory=list)
    unresponsive_count: int = 0
    likely_away_count: int = 0
    ai_reasoning: str = ""
    agent_model: str = "Building Agent (Vertex AI Gemini 2.5 Flash)"


@dataclass
class ResidentCandidate:
    resident_id: str
    unit_id: str
    room_number: str
    floor: int
    elderly_count: int = 0
    mobility_difficulty_count: int = 0


@dataclass
class TriageCandidateClassification:
    safe_helpers: list[ResidentCandidate] = field(default_factory=list)
    unconfirmed_targets: list[ResidentCandidate] = field(default_factory=list)
    likely_away: list[ResidentCandidate] = field(default_factory=list)
    safe_helpers_by_floor: dict[int, list[ResidentCandidate]] = field(default_factory=dict)
    unconfirmed_targets_by_floor: dict[int, list[ResidentCandidate]] = field(default_factory=dict)
    resident_unit_map: dict[str, Any] = field(default_factory=dict)
    # 再実行時（#60）: 打診中・承認済み・確認中・完了の Task がある未応答住戸（今回は対象外）
    handled_targets: list[ResidentCandidate] = field(default_factory=list)
    # 再実行時（#60）: 打診回数の上限に達し、再打診しない未応答住戸（管理人の対応に回す）
    exhausted_targets: list[ResidentCandidate] = field(default_factory=list)


# (支援者, 確認対象) の組。計画の段階ではまだ Task を作らない
Assignment = tuple[ResidentCandidate, ResidentCandidate]

# 進行中とみなす Task の状態（対象の住戸・担当の住民とも今回の割り当てから外す）
ACTIVE_TASK_STATUSES = {TaskStatus.PENDING, TaskStatus.OFFERED, TaskStatus.APPROVED,
                        TaskStatus.IN_PROGRESS}
# 打診し直す対象になる Task の状態
RETRYABLE_TASK_STATUSES = {TaskStatus.DECLINED, TaskStatus.EXPIRED, TaskStatus.FAILED}
# 1住戸あたりの打診回数の上限（初回＋再打診1回。DESIGN §6.3 D、§7.4 #6）
MAX_OFFERS_PER_TARGET = 2


def effective_task_status(task: Task, now: datetime) -> TaskStatus:
    """返事期限を過ぎた打診中の Task を期限切れとして扱った状態を返す。"""
    if task.status == TaskStatus.OFFERED and task.expires_at:
        expires_at = task.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at <= now:
            return TaskStatus.EXPIRED
    return task.status


# 管理人の確認状況ボードの並び順（要対応 → 進行中 → 完了。DESIGN §6.3 D、#61）
_BOARD_ORDER = {
    "NO_RESPONSE": 0, "EXHAUSTED": 1, "UNASSIGNED": 2, "RETRY_PENDING": 3,
    "IN_PROGRESS": 4, "APPROVED": 5, "OFFERED": 6, "RESPONDED": 7,
}


def _assignment_reason(helper_room: str, helper_floor: int, target_room: str,
                       target_floor: int) -> str:
    """割り当ての理由を管理人向けに短く表す（例: 同じ3階・隣の部屋）。"""
    if helper_floor != target_floor:
        return f"{helper_floor}階から{target_floor}階へ"
    if helper_room.isdigit() and target_room.isdigit():
        diff = abs(int(helper_room) - int(target_room))
        distance = "隣の部屋" if diff == 1 else f"{diff}部屋先"
        return f"同じ{target_floor}階・{distance}"
    return f"同じ{target_floor}階"


class TriageService:
    """Core logic for safety check coordination across disaster scenarios (SC-1 to SC-4)."""

    def __init__(self, repo: BaseRepository) -> None:
        self.repo = repo

    async def expire_overdue_offers(self, building_id: str, emergency_id: str) -> list[Task]:
        """返事期限を過ぎた打診中の Task を EXPIRED にする（トリアージ再実行時のみ。#60）。"""
        now = datetime.now(UTC)
        expired: list[Task] = []
        for task in await self.repo.list_all_tasks(building_id, emergency_id):
            if task.status != TaskStatus.OFFERED:
                continue
            if effective_task_status(task, now) != TaskStatus.EXPIRED:
                continue
            task.status = TaskStatus.EXPIRED
            await self.repo.update_task(building_id, emergency_id, task)
            await self.repo.append_task_event(
                building_id,
                emergency_id,
                TaskEvent(
                    event_id=f"evt-{uuid.uuid4().hex[:12]}",
                    task_id=task.task_id,
                    actor_resident_id=task.resident_id,
                    event_type=TaskEventType.DECLINED,
                    reason_code=ReasonCode.TIMEOUT,
                    actor_type=ActorType.SYSTEM,
                    occurred_at=now,
                ),
            )
            expired.append(task)
        return expired

    async def classify_candidates(
        self, building_id: str, emergency_id: str
    ) -> TriageCandidateClassification:
        """住民・住戸・在館コンテキストからトリアージ対象者・支援可能者・不在者を分類する。

        既存の Task も見て、確認済み・進行中の住戸と手の空いていない支援者を除く（#60）。
        """
        now = datetime.now(UTC)
        residents = await self.repo.list_residents(building_id)
        current_states = await self.repo.list_current_states(building_id, emergency_id)
        state_map = {s.resident_id: s.safety_status for s in current_states}

        units = await self.repo.list_units(building_id)
        unit_map = {u.unit_id: u for u in units}
        resident_unit_map = {r.resident_id: unit_map.get(r.unit_id) for r in residents}

        # 既存 Task の集計
        busy_helpers: set[str] = set()
        unavailable_helpers: set[str] = set()  # 辞退・期限切れを起こした住民には再度頼まない
        handled_target_ids: set[str] = set()
        offers_per_target: dict[str, int] = {}
        for task in await self.repo.list_all_tasks(building_id, emergency_id):
            status = effective_task_status(task, now)
            if status in ACTIVE_TASK_STATUSES:
                busy_helpers.add(task.resident_id)
            if status in (TaskStatus.DECLINED, TaskStatus.EXPIRED):
                unavailable_helpers.add(task.resident_id)
            if not task.target_resident_id:
                continue
            offers_per_target[task.target_resident_id] = (
                offers_per_target.get(task.target_resident_id, 0) + 1
            )
            if status in ACTIVE_TASK_STATUSES or status == TaskStatus.COMPLETED:
                handled_target_ids.add(task.target_resident_id)

        classification = TriageCandidateClassification(resident_unit_map=resident_unit_map)

        for resident in residents:
            r_id = resident.resident_id
            unit = resident_unit_map.get(r_id)
            if not unit:
                continue

            # 世帯プロファイルから要配慮情報を取得
            profile = await self.repo.get_household_profile(building_id, unit.unit_id)
            elderly = profile.elderly_count if profile else 0
            mobility = profile.mobility_difficulty_count if profile else 0

            cand = ResidentCandidate(
                resident_id=r_id,
                unit_id=unit.unit_id,
                room_number=unit.room_number,
                floor=unit.floor,
                elderly_count=elderly,
                mobility_difficulty_count=mobility,
            )

            status = state_map.get(r_id, SafetyStatus.UNKNOWN)
            ctx = await self.repo.get_presence_context(building_id, r_id)
            presence = ctx.presence_state if ctx else PresenceState.UNKNOWN

            if presence == PresenceState.OUTSIDE_BUILDING:
                classification.likely_away.append(cand)
            elif status == SafetyStatus.SAFE:
                if r_id in busy_helpers or r_id in unavailable_helpers:
                    continue
                classification.safe_helpers.append(cand)
                classification.safe_helpers_by_floor.setdefault(unit.floor, []).append(cand)
            elif status == SafetyStatus.UNKNOWN:
                if r_id in handled_target_ids:
                    classification.handled_targets.append(cand)
                elif offers_per_target.get(r_id, 0) >= MAX_OFFERS_PER_TARGET:
                    classification.exhausted_targets.append(cand)
                else:
                    classification.unconfirmed_targets.append(cand)
                    classification.unconfirmed_targets_by_floor.setdefault(
                        unit.floor, []
                    ).append(cand)

        return classification

    def match_rule_based(self, classification: TriageCandidateClassification) -> list[Assignment]:
        """同一フロア・空間近接による1:1マッチング（重複なし）。Task はまだ作らない。"""
        assignments: list[Assignment] = []
        assigned_helpers: set[str] = set()

        for floor, targets in classification.unconfirmed_targets_by_floor.items():
            helpers = classification.safe_helpers_by_floor.get(floor, [])
            available_helpers = [h for h in helpers if h.resident_id not in assigned_helpers]

            for target in targets:
                if not available_helpers:
                    break

                target_room = int(target.room_number) if target.room_number.isdigit() else 0

                # 部屋番号の差で最も近い支援者を探索
                closest_helper = min(
                    available_helpers,
                    key=lambda h: abs(
                        int(h.room_number) - target_room if h.room_number.isdigit() else 999
                    ),
                )

                available_helpers.remove(closest_helper)
                assigned_helpers.add(closest_helper.resident_id)
                assignments.append((closest_helper, target))

        return assignments

    async def commit_assignments(
        self,
        building_id: str,
        emergency_id: str,
        issue_id: str,
        assignments: list[Assignment],
        emergency_type: EmergencyType = EmergencyType.EARTHQUAKE,
    ) -> list[Task]:
        """確定した割り当てから Task（E-012）と打診の TaskEvent（E-013）を作る。"""
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=60)  # 60s timeout for approval (DESIGN §7.4 #6)
        config = DISASTER_TASK_CONFIG.get(
            emergency_type, DISASTER_TASK_CONFIG[EmergencyType.EARTHQUAKE]
        )
        units = {u.unit_id: u for u in await self.repo.list_units(building_id)}

        tasks_created: list[Task] = []
        for helper, target in assignments:
            task_id = f"task-{uuid.uuid4().hex[:12]}"
            helper_unit = units.get(helper.unit_id)
            target_unit = units.get(target.unit_id)
            new_task = Task(
                task_id=task_id,
                issue_id=issue_id,
                resident_id=helper.resident_id,
                target_resident_id=target.resident_id,
                start_node_id=helper_unit.entrance_node_id if helper_unit else None,
                destination_node_id=target_unit.entrance_node_id if target_unit else None,
                task_type=config["task_type"],
                title=config["title"],
                description=config["description"],
                estimated_seconds=config["estimated_seconds"],
                status=TaskStatus.OFFERED,
                created_at=now,
                expires_at=expires_at,
            )
            await self.repo.create_task(building_id, emergency_id, new_task)

            event = TaskEvent(
                event_id=f"evt-{uuid.uuid4().hex[:12]}",
                task_id=task_id,
                actor_resident_id=helper.resident_id,
                event_type=TaskEventType.OFFERED,
                actor_type=ActorType.BUILDING_AGENT,
                occurred_at=now,
                expires_at=expires_at,
            )
            await self.repo.append_task_event(building_id, emergency_id, event)
            tasks_created.append(new_task)

        return tasks_created

    async def execute_triage(
        self,
        building_id: str,
        emergency_id: str,
        issue_id: str,
        emergency_type: EmergencyType = EmergencyType.EARTHQUAKE,
    ) -> list[Task]:
        """4大災害シナリオ（地震・停電・火災・洪水）に応じたトリアージを実行しタスクを生成する。"""
        tasks, _ = await self._execute_rule_triage(
            building_id, emergency_id, issue_id, emergency_type
        )
        return tasks

    async def _execute_rule_triage(
        self,
        building_id: str,
        emergency_id: str,
        issue_id: str,
        emergency_type: EmergencyType,
    ) -> tuple[list[Task], TriageCandidateClassification]:
        await self.expire_overdue_offers(building_id, emergency_id)
        classification = await self.classify_candidates(building_id, emergency_id)
        assignments = self.match_rule_based(classification)
        tasks = await self.commit_assignments(
            building_id, emergency_id, issue_id, assignments, emergency_type
        )
        return tasks, classification

    async def execute_sc3_triage(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> list[Task]:
        """後方互換用: 地震（SC-3）トリアージを実行する。"""
        return await self.execute_triage(
            building_id=building_id,
            emergency_id=emergency_id,
            issue_id=issue_id,
            emergency_type=EmergencyType.EARTHQUAKE,
        )

    def build_result(
        self,
        emergency_id: str,
        issue_id: str,
        tasks: list[Task],
        classification: TriageCandidateClassification,
        emergency_type: EmergencyType = EmergencyType.EARTHQUAKE,
    ) -> TriageResult:
        """作成した Task と分類から、ルールベースの判断根拠つきの TriageResult を作る。"""
        unresponsive = (
            len(classification.unconfirmed_targets)
            + len(classification.handled_targets)
            + len(classification.exhausted_targets)
        )
        likely_away = len(classification.likely_away)

        config = DISASTER_TASK_CONFIG.get(
            emergency_type, DISASTER_TASK_CONFIG[EmergencyType.EARTHQUAKE]
        )
        task_label = config["title"]
        est_sec = config["estimated_seconds"]

        if tasks:
            task_summaries = [f"{t.resident_id} → {t.target_resident_id}" for t in tasks]
            reasoning = (
                f"【{emergency_type.value}対応】未応答{unresponsive}戸を分析。"
                f"カレンダー不在判定({likely_away}戸)を低優先除外。"
                f"空間近接の安全回答者へ{task_label}({len(tasks)}件: {', '.join(task_summaries)})"
                f"を重複なし・所要目安{est_sec}秒でペアリングしました。"
            )
        else:
            reasoning = (
                f"【{emergency_type.value}対応】未応答{unresponsive}戸を分析。"
                f"カレンダー不在判定({likely_away}戸)を除外。"
                f"割当可能な安全回答済みの住民がいません。"
            )
        if classification.handled_targets or classification.exhausted_targets:
            reasoning += (
                f"確認中・完了済みの{len(classification.handled_targets)}戸は対象外、"
                f"再打診の上限に達した{len(classification.exhausted_targets)}戸は管理人対応に回しました。"
            )

        return TriageResult(
            emergency_id=emergency_id,
            issue_id=issue_id,
            created_tasks=tasks,
            unresponsive_count=unresponsive,
            likely_away_count=likely_away,
            ai_reasoning=reasoning,
            agent_model="Building Agent (Policy Engine)",
        )

    async def execute_triage_result(
        self,
        building_id: str,
        emergency_id: str,
        issue_id: str,
        emergency_type: EmergencyType = EmergencyType.EARTHQUAKE,
    ) -> TriageResult:
        """4大災害シナリオに応じたトリアージを実行し、構造化された TriageResult を返却する。"""
        tasks, classification = await self._execute_rule_triage(
            building_id, emergency_id, issue_id, emergency_type
        )
        return self.build_result(emergency_id, issue_id, tasks, classification, emergency_type)

    async def execute_sc3_triage_result(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> TriageResult:
        """後方互換用: 地震（SC-3）トリアージ結果を返却する。"""
        return await self.execute_triage_result(
            building_id=building_id,
            emergency_id=emergency_id,
            issue_id=issue_id,
            emergency_type=EmergencyType.EARTHQUAKE,
        )

    async def build_task_board(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> list[TaskBoardItem]:
        """管理人の確認状況ボード（#61）。確認先の住戸ごとに最新の Task を1行にまとめる。"""
        now = datetime.now(UTC)
        issue = await self.repo.get_issue(building_id, emergency_id, issue_id)
        tasks = await self.repo.list_tasks_by_issue(building_id, emergency_id, issue_id)

        residents = await self.repo.list_residents(building_id)
        units = {u.unit_id: u for u in await self.repo.list_units(building_id)}
        unit_of = {r.resident_id: units.get(r.unit_id) for r in residents}
        states = {
            s.resident_id: s.safety_status
            for s in await self.repo.list_current_states(building_id, emergency_id)
        }
        away = {
            c.resident_id
            for c in await self.repo.list_presence_contexts(building_id)
            if c.presence_state == PresenceState.OUTSIDE_BUILDING
        }

        tasks_by_target: dict[str, list[Task]] = {}
        for t in tasks:
            if t.target_resident_id:
                tasks_by_target.setdefault(t.target_resident_id, []).append(t)

        items: list[TaskBoardItem] = []
        for target_id, target_tasks in tasks_by_target.items():
            target_unit = unit_of.get(target_id)
            if not target_unit:
                continue
            target_tasks.sort(key=lambda t: t.created_at)
            latest = target_tasks[-1]
            offers = len(target_tasks)
            helper_unit = unit_of.get(latest.resident_id)
            status = effective_task_status(latest, now)

            reason = (
                _assignment_reason(helper_unit.room_number, helper_unit.floor,
                                   target_unit.room_number, target_unit.floor)
                if helper_unit else ""
            )
            if status == TaskStatus.COMPLETED:
                events = await self.repo.list_task_events(building_id, emergency_id,
                                                          latest.task_id)
                result = next(
                    (e.reason_code for e in reversed(events)
                     if e.event_type == TaskEventType.COMPLETED),
                    None,
                )
                if result == ReasonCode.TARGET_NO_RESPONSE:
                    group, state, reason = "ACTION", "NO_RESPONSE", "隣室確認でも応答がありません"
                else:
                    group, state = "DONE", "RESPONDED"
            elif status in RETRYABLE_TASK_STATUSES:
                if offers >= MAX_OFFERS_PER_TARGET:
                    group, state = "ACTION", "EXHAUSTED"
                    reason = f"{offers}回打診しても担当が決まりませんでした"
                else:
                    group, state = "ACTION", "RETRY_PENDING"
                    cause = "辞退" if status == TaskStatus.DECLINED else (
                        "返事の期限切れ" if status == TaskStatus.EXPIRED else "失敗")
                    reason = f"{cause}。次のトリアージで別の住民に再打診します"
            elif status in (TaskStatus.APPROVED, TaskStatus.IN_PROGRESS):
                group, state = "ACTIVE", status.value
            else:
                group, state = "ACTIVE", "OFFERED"

            items.append(TaskBoardItem(
                target_resident_id=target_id,
                target_room_number=target_unit.room_number,
                target_floor=target_unit.floor,
                group=group,
                state=state,
                reason=reason,
                task_id=latest.task_id,
                task_type=latest.task_type,
                helper_room_number=helper_unit.room_number if helper_unit else None,
                expires_at=latest.expires_at if state == "OFFERED" else None,
                offer_count=offers,
            ))

        # トリアージ後も担当がいない未応答住戸（同じ階に頼める「無事」の住民がいない）
        if (issue and issue.status == IssueStatus.TRIAGING) or tasks:
            for r in residents:
                unit = unit_of.get(r.resident_id)
                if (
                    not unit
                    or r.resident_id in tasks_by_target
                    or r.resident_id in away
                    or states.get(r.resident_id, SafetyStatus.UNKNOWN) != SafetyStatus.UNKNOWN
                ):
                    continue
                items.append(TaskBoardItem(
                    target_resident_id=r.resident_id,
                    target_room_number=unit.room_number,
                    target_floor=unit.floor,
                    group="ACTION",
                    state="UNASSIGNED",
                    reason="同じ階に頼める「無事」の住民がいません",
                ))

        items.sort(key=lambda i: (_BOARD_ORDER.get(i.state, 9), i.target_room_number))
        return items

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
