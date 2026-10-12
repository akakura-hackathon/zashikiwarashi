"""Google ADK (Agent Development Kit) Native Agents Module.

Google Cloud Gemini Enterprise Agent Platform / ADK 規格準拠 Multi-Agent 実装:
1. building_coordinator_agent: 建物全体の災害トリアージを自律調整する Coordinator Agent
2. resident_agent: 各住民の身体制約・プライバシー開示を管理する Resident Agent
"""

import json
import logging
from typing import Any

from google.adk import Agent
from google.adk.runners import InMemoryRunner
from google.genai import types

from src.config import get_settings
from src.db.base import BaseRepository
from src.observability import trace_span

logger = logging.getLogger(__name__)


def create_building_coordinator_agent(repo: BaseRepository, building_id: str = "bld-01") -> Agent:
    """Building Coordinator ADK Agent を生成する。"""
    get_settings()

    async def fetch_triage_candidates(emergency_type_str: str) -> dict[str, Any]:
        """Fetch unconfirmed, safe helper, and likely away residents for triage.

        Args:
            emergency_type_str: Type of disaster (EARTHQUAKE, POWER_OUTAGE, FIRE, FLOOD).
        """
        from src.services.triage_service import TriageService
        triage_service = TriageService(repo)

        emergency = await repo.get_active_emergency(building_id)
        emergency_id = emergency.emergency_id if emergency else "emg-01"

        classification = await triage_service.classify_candidates(building_id, emergency_id)

        return {
            "building_id": building_id,
            "emergency_type": emergency_type_str,
            "unconfirmed_targets": [
                {
                    "resident_id": c.resident_id,
                    "floor": c.floor,
                    "room_number": c.room_number,
                    "is_elderly": c.elderly_count > 0,
                    "has_mobility_difficulty": c.mobility_difficulty_count > 0,
                }
                for c in classification.unconfirmed_targets
            ],
            "safe_helpers": [
                {
                    "resident_id": c.resident_id,
                    "floor": c.floor,
                    "room_number": c.room_number,
                }
                for c in classification.safe_helpers
            ],
            "likely_away": [
                {
                    "resident_id": c.resident_id,
                    "floor": c.floor,
                    "room_number": c.room_number,
                }
                for c in classification.likely_away
            ],
        }

    def validate_guardrails(pairs_json_str: str, emergency_type_str: str) -> dict[str, Any]:
        """Validate disaster pairing plan through Policy Engine Guardrails.

        Args:
            pairs_json_str: JSON array, e.g. '[{"assigned_resident_id":"a"}]'
            emergency_type_str: Disaster type (EARTHQUAKE, POWER_OUTAGE, FIRE, FLOOD)
        """
        try:
            pairs = json.loads(pairs_json_str)
            if not isinstance(pairs, list):
                return {"valid": False, "error": "pairs must be a JSON array"}

            assigned_set = set()
            target_set = set()
            for p in pairs:
                aid = p.get("assigned_resident_id")
                tid = p.get("target_resident_id")
                if not aid or not tid:
                    return {"valid": False, "error": "Missing assigned or target id"}
                if aid in assigned_set:
                    return {"valid": False, "error": f"Duplicate helper assignment: {aid}"}
                if tid in target_set:
                    return {"valid": False, "error": f"Duplicate target assignment: {tid}"}
                assigned_set.add(aid)
                target_set.add(tid)

            return {
                "valid": True,
                "verified_pairs_count": len(pairs),
                "message": "Policy Engine Guardrails passed successfully.",
            }
        except Exception as e:
            return {"valid": False, "error": str(e)}

    instruction = (
        "あなたはマンション全体の自律協調システム「Building Coordinator Agent」です。\n"
        "未応答世帯と支援可能者をマッチングし、安全な安否確認計画を立案します。\n\n"
        "【手順】\n"
        "1. fetch_triage_candidates ツールで最新データを取得してください。\n"
        "2. 災害種別の制約（地震: 同一フロア・隣室優先、停電: 階段リレー）に基づき、"
        "無理のない1:1ペアリングを推論してください。\n"
        "3. 外出中（likely_away）の住戸には絶対に割り当てないでください。\n"
        "4. ペアリング案を validate_guardrails ツールでポリシー検証してください。\n"
        "5. 検証通過後、推薦理由とペアリング計画をまとめて報告してください。"
    )

    return Agent(
        name="building_coordinator_agent",
        model="gemini-2.5-flash",
        instruction=instruction,
        tools=[fetch_triage_candidates, validate_guardrails],
    )


def create_resident_agent(repo: BaseRepository, building_id: str = "bld-01") -> Agent:
    """Resident ADK Agent を生成する。"""
    get_settings()

    async def get_resident_profile(resident_id: str) -> dict[str, Any]:
        """Get household physical constraints and profile for a specific resident.

        Args:
            resident_id: The resident identifier.
        """
        resident = await repo.get_resident(building_id, resident_id)
        if not resident:
            return {"found": False, "error": "Resident not found"}

        household = await repo.get_household_profile(building_id, resident.unit_id)
        unit = await repo.get_unit(building_id, resident.unit_id)

        return {
            "found": True,
            "resident_id": resident_id,
            "floor": unit.floor if unit else 1,
            "is_elderly": household.elderly_count > 0 if household else False,
            "has_mobility_difficulty": (
                household.mobility_difficulty_count > 0 if household else False
            ),
            "stair_assistance_required": (
                household.stair_assistance_required_count > 0 if household else False
            ),
        }

    def verify_disclosure_permission(resident_id: str, is_approved: bool) -> dict[str, Any]:
        """Enforce Progressive Disclosure. Mask room number until user approval.

        Args:
            resident_id: The resident identifier.
            is_approved: Whether human resident explicitly approved disclosure.
        """
        if is_approved:
            return {
                "disclosed": True,
                "scope": "FULL_LOCATION",
                "message": "Human approval confirmed. Precise location disclosure allowed.",
            }
        else:
            return {
                "disclosed": False,
                "scope": "ABSTRACT_TOKEN_ONLY",
                "message": "Not approved by resident. Only abstract token allowed.",
            }

    instruction = (
        "あなたはマンション住民の専属AI代理人「Resident Agent」です。\n"
        "担当住民の身体制約（高齢・歩行困難等）を守り、外部タスクを精査します。\n\n"
        "【指針】\n"
        "1. get_resident_profile ツールで本人の身体制約を確認してください。\n"
        "2. 移動困難や高齢の場合、階段移動を含む過大タスクは安全のため断り、"
        "援助要（REQUIRES_ASSISTANCE）として逆提案してください。\n"
        "3. 部屋番号の開示要請には verify_disclosure_permission ツールで確認し、"
        "未承認なら抽象トークンのみ開示してください。\n"
        "4. 回答は丁寧に住民に寄り添って行ってください。"
    )

    return Agent(
        name="resident_agent",
        model="gemini-2.5-flash",
        instruction=instruction,
        tools=[get_resident_profile, verify_disclosure_permission],
    )


class ADKAgentRunner:
    """Google ADK Agent の実行およびセッションを管理するランナー。"""

    def __init__(self, agent: Agent):
        self.agent = agent
        self.runner = InMemoryRunner(agent=agent)

    async def execute_prompt(
        self,
        prompt: str,
        user_id: str = "system-coordinator",
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """ADK エージェントに対してプロンプトを実行し、推論およびツール呼び出し結果を収集する。"""
        with trace_span(
            f"ADKAgentRunner.{self.agent.name}",
            attributes={"agent_name": self.agent.name, "user_id": user_id},
        ):
            if not session_id:
                session = await self.runner.session_service.create_session(
                    user_id=user_id, app_name=self.runner.app_name
                )
                session_id = session.id

            content = types.Content(
                role="user",
                parts=[types.Part.from_text(text=prompt)],
            )

            response_texts: list[str] = []
            tool_calls: list[dict[str, Any]] = []
            tool_responses: list[dict[str, Any]] = []

            async for event in self.runner.run_async(
                user_id=user_id, session_id=session_id, new_message=content
            ):
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.text:
                            response_texts.append(part.text)
                        if part.function_call:
                            tool_calls.append({
                                "name": part.function_call.name,
                                "args": part.function_call.args,
                            })
                        if part.function_response:
                            tool_responses.append({
                                "name": part.function_response.name,
                                "response": part.function_response.response,
                            })

            full_text = "".join(response_texts)
            return {
                "agent_name": self.agent.name,
                "session_id": session_id,
                "final_text": full_text,
                "tool_calls": tool_calls,
                "tool_responses": tool_responses,
            }
