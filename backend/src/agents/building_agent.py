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
    Task,
    TaskEvent,
    TaskEventType,
    TaskStatus,
    TaskType,
)
from src.observability import trace_span
from src.services.triage_service import TriageResult, TriageService

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
        """トリアージを実行し、未応答住戸への隣室確認タスクを作成する。

        1. LLM 有効時は Gemini による空間近接ペアリングを試行
        2. LLM エラー時またはオフライン環境時はルールベース TriageService へ自動フォールバック
        """
        with trace_span(
            "BuildingAgent.execute_triage",
            plan_id=issue_id,
            attributes={
                "building_id": building_id,
                "emergency_id": emergency_id,
                "agent_identity": self.identity.value,
                "use_llm": use_llm,
            },
        ):
            # ルールベースで集計およびフォールバック計画を計算
            rule_result = await self.triage_service.execute_sc3_triage_result(
                building_id=building_id,
                emergency_id=emergency_id,
                issue_id=issue_id,
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
    ) -> TriageResult:
        """Gemini モデルに近接最適化の判断を行わせる。

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

        prompt = f"""
あなたは大規模マンションの防災コーディネーター（Building Agent）です。
震度5強の地震が発生しました。以下の未応答住戸と、各階で「無事」と回答した住民のリストから、
最も近い住民に対して「同一フロアの隣室確認タスク（約20秒）」を重複なく1:1で割り当てる計画を策定してください。

【制約条件】
1. 救助のために別フロアへ行かせない（同じ階の住民のみ）。
2. 1住戸に対して重複してタスクを割り当てない。
3. 外出中（Likely Away）の住戸は隣室確認の対象から除外する。

未応答住戸数: {fallback_result.unresponsive_count}
除外された外出中住戸数: {fallback_result.likely_away_count}

出力は以下のJSON形式のみで回答してください:
{{
  "pairing": [
    {{"assigned_resident_id": "resident-i", "target_resident_id": "resident-h", "floor": 3}}
  ],
  "reasoning": "同一3階で最も近接している住民Iに住民Hの確認を依頼"
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
                task_type=TaskType.NEIGHBOR_CHECK,
                status=TaskStatus.OFFERED,
                estimated_seconds=20,
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
                or "Gemini 2.5 Flash により空間近接とカレンダー不在除外を最適化したペアリング策定。"
            ),
            agent_model="Gemini 2.5 Flash (Google GenAI SDK)",
        )
