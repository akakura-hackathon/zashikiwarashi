"""Building Agent Coordinator module (FN-04, docs/DESIGN.md §5.1, §6.3).

建物全体の Multi-Agent オーケストレーター。
- トリアージ要求を受けて、未応答住戸を分類（在宅要確認 vs Likely Away）
- Gemini による空間近接ペアリング案（JSON Schema 構造化出力）
- LLM 失敗時・オフライン時のルールベースフォールバック（NFR-03）
- 協力タスクの作成と打診開始
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

        1. LLM 有効時は Gemini 2.5 Flash による空間近接ペアリング推論を試行
        2. LLM 未設定・通信失敗時はルールベースへ自動フォールバック (NFR-03)
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
            # まずフォールバック用および候補者集計のベースを計算
            rule_result = await self.triage_service.execute_triage_result(
                building_id=building_id,
                emergency_id=emergency_id,
                issue_id=issue_id,
                emergency_type=emergency_type,
            )

            if not use_llm:
                return rule_result

            # Gemini LLM による実推論（Google GenAI / ADK 連携）
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
                logger.info(
                    f"[BuildingAgent] Gemini LLM triage fallback to rules: {e}"
                )
                return rule_result

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

    async def _run_gemini_triage(
        self,
        building_id: str,
        emergency_id: str,
        issue_id: str,
        fallback_result: TriageResult,
        emergency_type: EmergencyType = EmergencyType.EARTHQUAKE,
    ) -> TriageResult:
        """Gemini 2.5 Flash に住民候補を渡し、空間近接と災害制約下の自律ペアリングを推論させる。

        Policy Engine による検証:
        - 実在する有効な支援者・対象者ペアであるか
        - 重複割り当てがないか
        - 制約違反時はルールベースに安全にフォールバック
        """
        client = self._get_genai_client()
        if not client:
            raise ValueError(
                "Google GenAI client not configured (GEMINI_API_KEY or Vertex AI required)."
            )

        from google.genai import types

        # 1. 実際の候補者データを抽出
        classification = await self.triage_service.classify_candidates(building_id, emergency_id)
        if not classification.unconfirmed_targets or not classification.safe_helpers:
            return fallback_result

        unconfirmed_json = [
            {
                "resident_id": c.resident_id,
                "floor": c.floor,
                "room_number": c.room_number,
                "is_elderly": c.elderly_count > 0,
                "has_mobility_difficulty": c.mobility_difficulty_count > 0,
            }
            for c in classification.unconfirmed_targets
        ]

        safe_helpers_json = [
            {
                "resident_id": c.resident_id,
                "floor": c.floor,
                "room_number": c.room_number,
            }
            for c in classification.safe_helpers
        ]

        likely_away_json = [
            {
                "resident_id": c.resident_id,
                "floor": c.floor,
                "room_number": c.room_number,
            }
            for c in classification.likely_away
        ]

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
あなたはマンション全体の自律協調システム「Building Agent（建物防災コーディネーター）」です。
現在の災害種別: {emergency_type.value}
{instruction}

【トリアージ候補者データ】
1. 要確認・未応答住戸リスト (安否確認対象):
{json.dumps(unconfirmed_json, ensure_ascii=False, indent=2)}

2. 支援可能者リスト (在館・無事回答済み):
{json.dumps(safe_helpers_json, ensure_ascii=False, indent=2)}

3. 外出中・対象外住戸リスト (カレンダー等不在判定):
{json.dumps(likely_away_json, ensure_ascii=False, indent=2)}

【タスク・出力ルール】
- 支援可能者リストから適切な協力者を1名選び、未応答住戸へ割り当ててください（重複不可、1:1）。
- 災害種別の制約（{emergency_type.value}）に合致するよう、階数や部屋番号の距離を考慮してください。
- 支援可能者が不足している階や住戸は無理に割り当てず、スキップしてください。
- 出力は必ず以下のJSON形式のみで回答してください:
{{
  "pairing": [
    {{
      "assigned_resident_id": "支援者ID (safe_helpersリスト内のresident_id)",
      "target_resident_id": "対象者ID (unconfirmed_targetsリスト内のresident_id)",
    }}
  ],
  "reasoning": "なぜこのペアリングにしたかの空間的判断理由（要配慮世帯に言及）"
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
        raw_pairings = parsed.get("pairing", [])
        if not raw_pairings:
            return fallback_result

        # Policy Engine Guardrails による出力検証
        valid_helper_ids = {c.resident_id for c in classification.safe_helpers}
        valid_target_ids = {c.resident_id for c in classification.unconfirmed_targets}
        resident_unit_map = classification.resident_unit_map

        assigned_helpers: set[str] = set()
        targeted_units: set[str] = set()
        validated_pairings: list[dict] = []

        for p in raw_pairings:
            h_id = p.get("assigned_resident_id")
            t_id = p.get("target_resident_id")
            if not h_id or not t_id:
                continue
            if h_id not in valid_helper_ids or t_id not in valid_target_ids:
                logger.warning(
                    f"[BuildingAgent] LLM returned invalid resident pairing: {h_id} -> {t_id}"
                )
                continue
            if h_id in assigned_helpers or t_id in targeted_units:
                logger.warning(
                    f"[BuildingAgent] LLM returned duplicate assignment: {h_id} or {t_id}"
                )
                continue

            assigned_helpers.add(h_id)
            targeted_units.add(t_id)
            validated_pairings.append(p)

        if not validated_pairings:
            logger.warning(
                "[BuildingAgent] No validated pairings from LLM output, falling back to rules."
            )
            return fallback_result

        config = DISASTER_TASK_CONFIG.get(
            emergency_type, DISASTER_TASK_CONFIG[EmergencyType.EARTHQUAKE]
        )
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=60)
        created_tasks: list[Task] = []

        for p in validated_pairings:
            h_id = p["assigned_resident_id"]
            t_id = p["target_resident_id"]
            task_id = f"task-{uuid.uuid4().hex[:12]}"
            helper_unit = resident_unit_map.get(h_id)
            target_unit = resident_unit_map.get(t_id)

            task = Task(
                task_id=task_id,
                issue_id=issue_id,
                resident_id=h_id,
                target_resident_id=t_id,
                start_node_id=helper_unit.entrance_node_id if helper_unit else None,
                destination_node_id=target_unit.entrance_node_id if target_unit else None,
                task_type=config["task_type"],
                title=config["title"],
                description=config["description"],
                status=TaskStatus.OFFERED,
                estimated_seconds=config["estimated_seconds"],
                created_at=now,
                expires_at=expires_at,
            )
            await self.repo.create_task(building_id, emergency_id, task)
            await self.repo.append_task_event(
                building_id,
                emergency_id,
                TaskEvent(
                    event_id=f"evt-{uuid.uuid4().hex[:12]}",
                    task_id=task.task_id,
                    actor_resident_id=h_id,
                    event_type=TaskEventType.OFFERED,
                    actor_type=ActorType.BUILDING_AGENT,
                    occurred_at=now,
                    expires_at=expires_at,
                ),
            )
            created_tasks.append(task)

        ai_reasoning_text = (
            parsed.get("reasoning")
            or f"Gemini 2.5 Flash により{emergency_type.value}の最適化ペアリングを策定。"
        )

        return TriageResult(
            emergency_id=emergency_id,
            issue_id=issue_id,
            created_tasks=created_tasks,
            unresponsive_count=len(classification.unconfirmed_targets),
            likely_away_count=len(classification.likely_away),
            ai_reasoning=f"【Gemini 2.5 Flash 推論】{ai_reasoning_text}",
            agent_model="Building Agent (Vertex AI Gemini 2.5 Flash)",
        )
