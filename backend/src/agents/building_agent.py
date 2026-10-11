"""Building Agent Coordinator module (FN-04, docs/DESIGN.md §5.1, §6.3).

建物全体の Multi-Agent オーケストレーター。
- トリアージ要求を受けて、未応答住戸を分類（在宅要確認 vs Likely Away）
- Gemini による空間近接ペアリング案（JSON Schema 構造化出力）
- LLM 失敗時・オフライン時のルールベースフォールバック（NFR-03）
- 隣室確認タスク（NEIGHBOR_CHECK）の作成と打診開始
"""

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

from src.agents.governance import (
    AgentGovernanceEngine,
    AgentIdentity,
)
from src.db.base import BaseRepository
from src.models.domain import (
    ActorType,
    EmergencyType,
    Task,
    TaskEvent,
    TaskEventType,
    TaskStatus,
)
from src.observability import trace_span
from src.services.triage_service import DISASTER_TASK_CONFIG, TriageResult, TriageService

logger = logging.getLogger(__name__)


class BuildingAgent:
    """全棟の調整を行う Building Agent Coordinator。
    
    専用の Agent Identity（G4）を持ち、IAP CEL ポリシーで権限が制限される。
    """

    def __init__(self, repo: BaseRepository):
        self.repo = repo
        self.triage_service = TriageService(repo)
        self.identity = AgentIdentity.BUILDING_AGENT

    def invoke_tool(self, tool_name: str, payload: dict | None = None) -> None:
        """G3/G4: Agent Gateway Egress & IAP 認可チェックを通過してツールを呼ぶ。"""
        import json
        payload_str = json.dumps(payload) if payload else None
        AgentGovernanceEngine.validate_egress(
            agent_identity=self.identity,
            target_service="mcp-tools",
            tool_name=tool_name,
            payload_text=payload_str,
        )

    async def execute_triage(
        self,
        building_id: str,
        emergency_id: str,
        issue_id: str,
        use_llm: bool = True,
    ) -> TriageResult:
        """4大災害シナリオ（地震・停電・火災・洪水）に応じたトリアージを実行し協力タスクを作成する。

        1. LLM 有効時は Gemini による空間近接ペアリングを試行
        2. LLM エラー時またはオフライン環境時はルールベース TriageService へ自動フォールバック
        """
        emergency = await self.repo.get_emergency(building_id, emergency_id)
        emergency_type = (
            emergency.emergency_type if emergency else EmergencyType.EARTHQUAKE
        )

        with trace_span(
            "BuildingAgent.execute_triage",
            plan_id=issue_id,
            attributes={
                "building_id": building_id,
                "emergency_id": emergency_id,
                "emergency_type": emergency_type.value,
                "agent_identity": self.identity.value,
                "use_llm": use_llm,
            },
        ):
            # ルールベースで集計およびフォールバック計画を計算
            rule_result = await self.triage_service.execute_triage_result(
                building_id=building_id,
                emergency_id=emergency_id,
                issue_id=issue_id,
                emergency_type=emergency_type,
            )

            if not use_llm:
                return rule_result

        # Gemini LLM による推論（Google GenAI / ADK 連携）
        try:
            llm_result = await self._run_gemini_triage(
                building_id=building_id,
                emergency_id=emergency_id,
                issue_id=issue_id,
                fallback_result=rule_result,
                emergency_type=emergency_type,
            )
            return llm_result
        except Exception as e:
            logger.warning(
                f"[BuildingAgent] Gemini LLM triage fallback to rules: {e}"
            )
            return rule_result

    async def _run_gemini_triage(
        self,
        building_id: str,
        emergency_id: str,
        issue_id: str,
        fallback_result: TriageResult,
        emergency_type: EmergencyType = EmergencyType.EARTHQUAKE,
    ) -> TriageResult:
        """Gemini モデルに災害別近接最適化の判断を行わせる。

        APIキー未設定時や接続不可時は速やかに例外を投げてフォールバックする。
        """
        import os

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not configured, using fallback.")

        # Google GenAI クライアント（google-genai / ADK）による構造化推論
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        scenario_instructions = {
            EmergencyType.EARTHQUAKE: (
                "震度5強の地震が発生しました。以下の未応答住戸と、各階で「無事」と回答した住民のリストから、"
                "最も近い住民に対して「同一フロアの隣室確認タスク（約20秒）」を重複なく1:1で割り当てる計画を策定してください。\n\n"
                "【制約条件】\n"
                "1. 救助のために別フロアへ行かせない（同じ階の住民のみ）。\n"
                "2. 1住戸に対して重複してタスクを割り当てない。\n"
                "3. 外出中（Likely Away）の住戸は対象から除外する。"
            ),
            EmergencyType.POWER_OUTAGE: (
                "落雷による全館停電が発生し、エレベーターが全基停止しました。階段利用が困難な要配慮世帯に対し、"
                "同一・近接フロアの住民による「飲料水・物資の階段リレー運搬タスク（約4分）」を重複なく割り当てる計画を策定してください。\n\n"
                "【制約条件】\n"
                "1. 1人に全フロアを往復させず、負担軽減のため近接階リレーとする。\n"
                "2. 1住戸に対して重複してタスクを割り当てない。\n"
                "3. 外出中（Likely Away）の住戸は対象から除外する。"
            ),
            EmergencyType.FIRE: (
                "棟内火災警報が鳴動し、西側非常階段からの避難方針が決定しました。単独階段避難に不安がある住民に対し、"
                "同一避難動線上の住民による「西側非常階段への避難同行タスク（約30秒）」を重複なく割り当てる計画を策定してください。\n\n"
                "【制約条件】\n"
                "1. 逆方向や階段から離れる方向へ戻らせない（同一避難動線上の住民のみ）。\n"
                "2. 1住戸に対して重複してタスクを割り当てない。\n"
                "3. 外出中（Likely Away）の住戸は対象から除外する。"
            ),
            EmergencyType.FLOOD: (
                "外水氾濫による浸水警戒が発令され、低層階（1F/2F）から上層階（6F以上）への垂直避難が決定しました。"
                "低層階の要支援住民に対し、上階へ移動する住民による「垂直避難同行タスク（約1分）」を重複なく割り当てる計画を策定してください。\n\n"
                "【制約条件】\n"
                "1. 上方向へ避難中の住民の動線に合わせて同行を依頼する。\n"
                "2. 1住戸に対して重複してタスクを割り当てない。\n"
                "3. 外出中（Likely Away）の住戸は対象から除外する。"
            ),
        }

        instruction = scenario_instructions.get(
            emergency_type, scenario_instructions[EmergencyType.EARTHQUAKE]
        )

        prompt = f"""
あなたは大規模マンションの防災コーディネーター（Building Agent）です。
{instruction}

未応答住戸数: {fallback_result.unresponsive_count}
除外された外出中住戸数: {fallback_result.likely_away_count}

出力は以下のJSON形式のみで回答してください:
{{
  "pairing": [
    {{"assigned_resident_id": "resident-i", "target_resident_id": "resident-h", "floor": 3}}
  ],
  "reasoning": "同一フロアまたは最短動線で最も近接している住民に支援を依頼"
}}
"""
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        text = response.text
        if not text:
            raise ValueError("Empty response from Gemini")

        parsed = json.loads(text)
        pairings = parsed.get("pairing", [])

        if not pairings:
            return fallback_result

        config = DISASTER_TASK_CONFIG.get(
            emergency_type, DISASTER_TASK_CONFIG[EmergencyType.EARTHQUAKE]
        )
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=60)
        created_tasks: list[Task] = []

        for p in pairings:
            task_id = f"task-{uuid.uuid4().hex[:12]}"
            task = Task(
                task_id=task_id,
                issue_id=issue_id,
                resident_id=p["assigned_resident_id"],
                target_resident_id=p["target_resident_id"],
                task_type=config["task_type"],
                title=config["title"],
                description=config["description"],
                status=TaskStatus.OFFERED,
                estimated_seconds=config["estimated_seconds"],
                created_at=now,
                expires_at=expires_at,
            )
            saved_task = await self.repo.create_task(building_id, emergency_id, task)
            await self.repo.append_task_event(
                building_id,
                emergency_id,
                TaskEvent(
                    event_id=f"evt-{uuid.uuid4().hex[:12]}",
                    task_id=saved_task.task_id,
                    actor_resident_id=p["assigned_resident_id"],
                    event_type=TaskEventType.OFFERED,
                    actor_type=ActorType.BUILDING_AGENT,
                    occurred_at=now,
                    expires_at=expires_at,
                ),
            )
            created_tasks.append(saved_task)

        return TriageResult(
            emergency_id=emergency_id,
            issue_id=issue_id,
            created_tasks=created_tasks,
            unresponsive_count=fallback_result.unresponsive_count,
            likely_away_count=fallback_result.likely_away_count,
            ai_reasoning=(
                parsed.get("reasoning")
                or f"Gemini 2.5 Flash により{emergency_type.value}の"
                "空間近接と不在除外を最適化したペアリング策定。"
            ),
            agent_model="Gemini 2.5 Flash (Google GenAI SDK)",
        )
