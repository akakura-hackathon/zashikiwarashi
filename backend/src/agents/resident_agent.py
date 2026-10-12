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

from src.agents.governance import (
    AgentGovernanceEngine,
    AgentIdentity,
)
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
from src.observability import trace_span
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
    専用の Agent Identity（G4）を持ち、IAP CEL ポリシーで権限が制限される。
    """

    def __init__(self, resident_id: str, repo: BaseRepository, building_id: str = "bld-01"):
        self.resident_id = resident_id
        self.repo = repo
        self.building_id = building_id
        self.identity = AgentIdentity.RESIDENT_AGENT

    def invoke_tool(self, tool_name: str, payload: dict[str, Any] | None = None) -> None:
        """G3/G4: Agent Gateway Egress & IAP 認可チェックを通過してツールを呼ぶ。"""
        import json
        payload_str = json.dumps(payload) if payload else None
        # IAP ポリシーおよび SDP フィルタの検査
        AgentGovernanceEngine.validate_egress(
            agent_identity=self.identity,
            target_service="mcp-tools",
            tool_name=tool_name,
            payload_text=payload_str,
        )

    async def evaluate_task(self, task: Task) -> TaskEvent:
        """R1: 打診されたタスクを本人の制約から評価し、TaskEvent EVALUATED を生成する。

        本人が高齢・移動困難の場合や、タスク内容が過大な場合は逆提案または援助要を返す。
        """
        with trace_span(
            "ResidentAgent.evaluate_task",
            plan_id=task.task_id,
            attributes={
                "resident_id": self.resident_id,
                "task_id": task.task_id,
                "task_type": task.task_type.value,
            },
        ):
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

    def _get_genai_client(self):
        """Google GenAI クライアントを環境設定に応じて初期化する。"""
        import os

        from google import genai

        from src.config import get_settings

        settings = get_settings()
        api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")
        if api_key:
            return genai.Client(api_key=api_key)

        project = settings.google_cloud_project or os.environ.get("GOOGLE_CLOUD_PROJECT")
        if project:
            location = settings.google_cloud_location or os.environ.get(
                "GOOGLE_CLOUD_LOCATION", "us-central1"
            )
            return genai.Client(vertexai=True, project=project, location=location)

        return None

    async def parse_user_free_text_llm(self, text: str, floor: int) -> StructuredNeed:
        """R3: Gemini 2.5 Flash による自由文の自然言語理解（NLU）と構造化 Need 変換。
        
        LLM 失敗時は即座にルールベース parse_user_free_text へフォールバックする。
        """
        client = self._get_genai_client()
        if not client:
            return self.parse_user_free_text(text, floor)

        import json

        from google.genai import types

        prompt = f"""
あなたはマンション住民の専属AI代理人「Resident Agent」です。
担当住民の階数: {floor}F
住民からの自由文メッセージ: "{text}"

住民のメッセージから被害・支援状況を分析し、以下のJSON形式のみで出力してください:
{{
  "category": "SAFETY_CHECK" 等の該当カテゴリ,
  "requires_assistance": true または false,
  "can_stairs": true または false,
  "needs_clarification": true または false (曖昧で緊急度不明ならtrue),
  "clarification_question": "不足情報がある場合の聞き返し質問文（不要ならnull）"
}}
"""
        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )
            if not response.text:
                return self.parse_user_free_text(text, floor)

            parsed = json.loads(response.text)
            return StructuredNeed(
                resident_id=self.resident_id,
                floor=floor,
                category=parsed.get("category", "SAFETY_CHECK"),
                requires_assistance=bool(parsed.get("requires_assistance", False)),
                can_stairs=bool(parsed.get("can_stairs", True)),
                raw_message=text.strip(),
                needs_clarification=bool(parsed.get("needs_clarification", False)),
                clarification_question=parsed.get("clarification_question"),
            )
        except Exception:
            return self.parse_user_free_text(text, floor)

    def parse_user_free_text(self, text: str, floor: int) -> StructuredNeed:
        """R3 (フォールバック): 本人の自由文メッセージを構造化 Need に変換し、不足があれば聞き返す。

        例:
        - 「ドアが開かない。足が痛い」 -> [負傷あり, 救助要, 階段不可]
        - 「水」 -> 不足情報あり（何人分？どの程度？）聞き返し発動
        """
        with trace_span(
            "ResidentAgent.parse_user_free_text",
            plan_id=self.resident_id,
            attributes={
                "resident_id": self.resident_id,
                "floor": floor,
                "text_length": len(text.strip()),
            },
        ):
            clean_text = text.strip()

            # 否定表現・安全表現の除去（「けがはない」「問題ない」などの誤検知を防ぐ）
            injury_negations = [
                "けがはなく", "けがはない", "けがはありません", "けがなし", "けが無し",
                "怪我はなく", "怪我はない", "怪我はありません", "怪我なし", "怪我無し",
                "痛くない", "痛くありません", "痛くはない", "痛くはありません",
            ]
            clean_text_for_injury = clean_text.replace("手助け", "").replace("お助け", "")
            for neg in injury_negations:
                clean_text_for_injury = clean_text_for_injury.replace(neg, "")

            injury_keywords = ["怪我", "けが", "足が痛", "痛い", "血", "動けない", "挟ま", "骨折"]
            is_injury = any(k in clean_text_for_injury for k in injury_keywords)

            # 閉じ込めの否定・移動可能表現
            trapped_negations = [
                "部屋から出られます", "部屋から出られる", "出られます", "出られる", "出れます",
                "避難できます", "避難できる", "動けます", "動ける", "歩けます", "歩ける",
            ]
            clean_text_for_trapped = clean_text
            for neg in trapped_negations:
                clean_text_for_trapped = clean_text_for_trapped.replace(neg, "")

            trapped_keywords = [
                "閉じ込め", "ドアが開かない", "出られない", "ドア遮断", "逃げ道",
            ]
            is_trapped = any(k in clean_text_for_trapped for k in trapped_keywords)
            is_water = any(k in clean_text for k in ["水", "飲料水", "喉", "食料", "飲み水"])
            stair_keywords = [
                "階段", "昇降", "降りられない", "階段不可",
                "エレベーター停止", "EV停止", "足が悪", "階段困難",
            ]
            is_stair_diff = any(k in clean_text for k in stair_keywords)
            medical_keywords = ["薬", "医療", "呼吸器", "電源", "バッテリー"]
            is_medical = any(k in clean_text for k in medical_keywords)
            is_heat = any(k in clean_text for k in ["熱中症", "暑い", "エアコン", "空調"])
            fire_keywords = ["火", "煙", "煙充満", "火災", "避難同行", "火が見え"]
            is_fire = any(k in clean_text for k in fire_keywords)
            flood_keywords = [
                "洪水", "浸水", "冠水", "垂直避難", "上階",
                "上層階", "水が迫", "床下浸水", "床上浸水",
            ]
            is_flood = any(k in clean_text for k in flood_keywords)

            safe_short_keywords = [
                "無事", "大丈夫", "平気", "ok", "OK", "良好",
                "問題なし", "問題ない", "何もない", "なし", "異常なし",
            ]
            is_explicit_safe = any(k in clean_text for k in safe_short_keywords) or (
                "けがはなく" in clean_text or "怪我はなく" in clean_text
            )

            # 自由文が短すぎて情報不足の場合（聞き返し R3）
            # ただし「無事」など明確な安全報告がある場合は聞き返しを発動せず安全とする
            if (
                len(clean_text) <= 2
                and not is_injury
                and not is_trapped
                and not is_fire
                and not is_flood
                and not is_explicit_safe
            ):
                return StructuredNeed(
                    resident_id=self.resident_id,
                    floor=floor,
                    category="UNKNOWN",
                    requires_assistance=True,
                    can_stairs=True,
                    raw_message=clean_text,
                    needs_clarification=True,
                    clarification_question=(
                        "どのような状況でしょうか？ お怪我や閉じ込めはありますか？"
                    ),
                )

            category = "SAFETY_CHECK"
            if is_injury or is_trapped or is_fire:
                category = "EVACUATION"
            elif is_flood:
                category = "VERTICAL_EVACUATION"
            elif is_water:
                category = "WATER"
            elif is_medical:
                category = "MEDICAL"
            elif is_heat:
                category = "HEAT_RELIEF"
            elif is_stair_diff:
                category = "STAIRS_ASSIST"

            requires_assistance = (
                is_injury
                or is_trapped
                or is_water
                or is_stair_diff
                or is_medical
                or is_heat
                or is_fire
                or is_flood
            )
            can_stairs = not (is_injury or is_stair_diff)

            return StructuredNeed(
                resident_id=self.resident_id,
                floor=floor,
                category=category,
                requires_assistance=requires_assistance,
                can_stairs=can_stairs,
                raw_message=clean_text,
                needs_clarification=False,
                clarification_question=None,
            )
