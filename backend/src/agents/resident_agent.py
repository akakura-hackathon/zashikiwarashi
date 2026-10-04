"""Resident Agent module (FN-03, docs/DESIGN.md §5.8).

各住民に1つずつ割り当てられる自律代理人。
- resident_id による Context 分離（Agent Runtime セッションの分離）
- R1: 逆提案（交渉役）
- R2: 開示の番人（Gatekeeper）
- R3: 本人との対話・自由文の構造化 Need 変換と聞き返し
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from src.db.base import BaseRepository
from src.models.domain import (
    ActorType,
    ReasonCode,
    Task,
    TaskEvent,
    TaskEventType,
    TaskResult,
    TaskType,
)
from src.services.privacy_gateway import PrivacyGateway


@dataclass
class StructuredNeed:
    resident_id: str
    floor: int
    category: str  # "SAFETY_CHECK", "EVACUATION", "WATER", "MEDICAL"
    requires_assistance: bool
    can_stairs: bool
    raw_message: str
    needs_clarification: bool = False
    clarification_question: str | None = None


class ResidentAgent:
    """住民個別の代理人 Agent。

    本人の世帯プロファイルと在館コンテキストのみにアクセスし、
    他住民の生データやメモリには一切触れない（Domain Principle 6: Agent Isolation）。
    """

    def __init__(self, resident_id: str, repo: BaseRepository, building_id: str = "bld-01"):
        self.resident_id = resident_id
        self.repo = repo
        self.building_id = building_id

    async def evaluate_task(self, task: Task) -> TaskEvent:
        """R1: 打診されたタスクを本人の制約から評価し、TaskEvent EVALUATED を生成する。

        本人が高齢・移動困難の場合や、タスク内容が過大な場合は逆提案または援助要を返す。
        """
        now = datetime.now(UTC)
        resident = await self.repo.get_resident(self.building_id, self.resident_id)
        household = (
            await self.repo.get_household_profile(self.building_id, resident.unit_id)
            if resident
            else None
        )

        is_mobility_diff = bool(
            household and household.mobility_difficulty_count > 0
        )

        event_id = f"evt-{uuid.uuid4().hex[:12]}"

        # 移動困難または高齢の場合、階段移動を含むタスクや過大なタスクは受諾不可（援助要）
        if is_mobility_diff:
            return TaskEvent(
                event_id=event_id,
                task_id=task.task_id,
                actor_resident_id=self.resident_id,
                event_type=TaskEventType.EVALUATED,
                actor_type=ActorType.RESIDENT_AGENT,
                result=TaskResult.REQUIRES_ASSISTANCE,
                reason_code=ReasonCode.UNSAFE,
                occurred_at=now,
            )

        # 一般住民の場合、極小タスク（NEIGHBOR_CHECK）なら受諾可能（CAN_EXECUTE）
        if task.task_type == TaskType.NEIGHBOR_CHECK:
            return TaskEvent(
                event_id=event_id,
                task_id=task.task_id,
                actor_resident_id=self.resident_id,
                event_type=TaskEventType.EVALUATED,
                actor_type=ActorType.RESIDENT_AGENT,
                result=TaskResult.CAN_EXECUTE,
                occurred_at=now,
            )

        return TaskEvent(
            event_id=event_id,
            task_id=task.task_id,
            actor_resident_id=self.resident_id,
            event_type=TaskEventType.EVALUATED,
            actor_type=ActorType.RESIDENT_AGENT,
            result=TaskResult.CAN_EXECUTE,
            occurred_at=now,
        )

    async def answer_inquiry(self, inquiry_type: str, is_approved: bool) -> dict[str, Any]:
        """R2: 開示の番人（Gatekeeper）。

        外部（Building Agent 等）からの問い合わせに対し、
        承認前は抽象トークンのみを返し、承認後にのみ限定開示する。
        """
        resident = await self.repo.get_resident(self.building_id, self.resident_id)
        if not resident:
            return {"error": "Resident not found"}

        unit = await self.repo.get_unit(self.building_id, resident.unit_id)
        floor = unit.floor if unit else 1

        if inquiry_type == "LOCATION":
            if not is_approved:
                # 承認前: 抽象トークンのみ
                return {
                    "is_disclosed": False,
                    "location_token": PrivacyGateway.abstract_capability(floor, "RESIDENCE"),
                    "floor_level": f"{floor}F",
                }
            # 承認後: 部屋番号を開示
            return {
                "is_disclosed": True,
                "room_number": unit.room_number if unit else None,
                "floor": floor,
            }

        return {"status": "UNKNOWN_INQUIRY"}

    def parse_user_free_text(self, text: str, floor: int) -> StructuredNeed:
        """R3: 本人の自由文メッセージを構造化 Need に変換し、不足があれば聞き返す。

        例:
        - 「ドアが開かない。足が痛い」 -> [負傷あり, 救助要, 階段不可]
        - 「水」 -> 不足情報あり（何人分？どの程度？）聞き返し発動
        """
        clean_text = text.strip()

        injury_keywords = ["怪我", "けが", "足", "痛い", "血", "動けない", "挟ま"]
        is_injury = any(k in clean_text for k in injury_keywords)
        is_trapped = any(k in clean_text for k in ["閉じ込め", "ドアが開かない", "出られない"])
        is_water = any(k in clean_text for k in ["水", "飲料水", "喉"])

        # 自由文が短すぎて情報不足の場合（聞き返し R3）
        if len(clean_text) <= 2 and not is_injury and not is_trapped:
            return StructuredNeed(
                resident_id=self.resident_id,
                floor=floor,
                category="UNKNOWN",
                requires_assistance=True,
                can_stairs=True,
                raw_message=clean_text,
                needs_clarification=True,
                clarification_question="どのような状況でしょうか？ お怪我や閉じ込めはありますか？",
            )

        category = "SAFETY_CHECK"
        if is_injury or is_trapped:
            category = "EVACUATION"
        elif is_water:
            category = "WATER"

        return StructuredNeed(
            resident_id=self.resident_id,
            floor=floor,
            category=category,
            requires_assistance=is_injury or is_trapped,
            can_stairs=not is_injury,
            raw_message=clean_text,
            needs_clarification=False,
            clarification_question=None,
        )
