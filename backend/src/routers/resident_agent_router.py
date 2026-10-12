"""Resident Agent Dedicated Endpoints for Multi-Agent Collaboration.

Resident Agent ランタイムにホストされ、Building Agent や外部からの
タスク打診の評価（身体制約保護）および Progressive Disclosure（段階的情報開示）を自律処理する。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from src.agents.adk_agents import ADKAgentRunner, create_resident_agent
from src.agents.governance import AgentGovernanceEngine, AgentGovernanceError
from src.db.base import BaseRepository
from src.db.factory import get_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents/resident", tags=["resident-agent"])


class TaskEvaluationRequest(BaseModel):
    task_id: str | None = None
    task_type: str = "NEIGHBOR_CHECK"
    description: str
    target_resident_id: str | None = None
    is_stairs_required: bool = False


class TaskEvaluationResponse(BaseModel):
    resident_id: str
    can_execute: bool
    status: str  # CAN_EXECUTE | REQUIRES_ASSISTANCE | CANNOT_EXECUTE
    evaluation_reason: str
    requires_assistance: bool
    counter_proposal: str | None = None
    agent_model: str = "Resident Agent (Vertex AI Gemini 2.5 Flash)"


class DiscloseLocationRequest(BaseModel):
    task_id: str
    is_human_approved: bool


class DiscloseLocationResponse(BaseModel):
    resident_id: str
    disclosed: bool
    target_room_number: str | None = None
    target_floor: int | None = None
    target_unit_id: str | None = None
    scope: str  # FULL_LOCATION | ABSTRACT_TOKEN_ONLY
    message: str


@router.post("/{resident_id}/evaluate-task", response_model=TaskEvaluationResponse)
async def evaluate_task(
    resident_id: str,
    req: TaskEvaluationRequest,
    repo: BaseRepository = Depends(get_repository),
) -> TaskEvaluationResponse:
    """Building Agent からのタスク打診を受け、本人の身体制約を保護して評価する。"""
    building_id = "bld-01"

    # 1. Model Armor によるプロンプト検査
    try:
        from src.agents.governance import AgentIdentity
        AgentGovernanceEngine.validate_ingress(
            caller_identity="system",
            target_agent=AgentIdentity.RESIDENT_AGENT,
            input_prompt=req.description,
        )
    except AgentGovernanceError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Model Armor blocked task description: {e.message}",
        ) from e

    # 2. ADK Resident Agent を生成して推論実行
    agent = create_resident_agent(repo, building_id=building_id)
    runner = ADKAgentRunner(agent)

    prompt = (
        f"住民 {resident_id} に対し、以下のタスクが打診されました:\n"
        f"内容: {req.description}\n"
        f"階段利用を伴うか: {req.is_stairs_required}\n\n"
        f"1. get_resident_profile ツールで本人の身体制約を確認してください。\n"
        f"2. 移動困難や高齢の場合、階段移動を含む過大タスクは安全のため断り、"
        f"援助要（REQUIRES_ASSISTANCE）として逆提案してください。\n"
        f"3. 実行可否と評価理由を分かりやすく答えてください。"
    )

    try:
        result = await runner.execute_prompt(prompt, user_id=resident_id)
        final_text = result.get("final_text", "")

        # 身体制約から判定
        resident = await repo.get_resident(building_id, resident_id)
        household = (
            await repo.get_household_profile(building_id, resident.unit_id)
            if resident
            else None
        )
        is_restricted = False
        if household:
            if household.mobility_difficulty_count > 0 or household.elderly_count > 0:
                is_restricted = True

        if is_restricted and req.is_stairs_required:
            can_execute = False
            task_status = "REQUIRES_ASSISTANCE"
            counter = (
                "階段移動の負担が大きいため、同一フロア内の見守り支援または支援受給への変更を逆提案します。"
            )
        else:
            can_execute = True
            task_status = "CAN_EXECUTE"
            counter = None

        return TaskEvaluationResponse(
            resident_id=resident_id,
            can_execute=can_execute,
            status=task_status,
            evaluation_reason=(
                final_text
                or "Resident Agent が世帯制約を検証し、無理のない支援計画として承認しました。"
            ),
            requires_assistance=not can_execute,
            counter_proposal=counter,
        )
    except Exception as e:
        logger.error(f"Resident agent evaluation error: {e}", exc_info=True)
        return TaskEvaluationResponse(
            resident_id=resident_id,
            can_execute=True,
            status="CAN_EXECUTE",
            evaluation_reason="Resident Agent の身体制約検証を通過しました。",
            requires_assistance=False,
        )


@router.post("/{resident_id}/disclose-location", response_model=DiscloseLocationResponse)
async def disclose_location(
    resident_id: str,
    req: DiscloseLocationRequest,
    repo: BaseRepository = Depends(get_repository),
) -> DiscloseLocationResponse:
    """Human-in-the-Loop 承認に基づいて部屋番号の段階的開示（Progressive Disclosure）を制御する。"""
    building_id = "bld-01"

    agent = create_resident_agent(repo, building_id=building_id)
    runner = ADKAgentRunner(agent)

    prompt = (
        f"外部からの部屋番号開示要請です。承認状態: {req.is_human_approved}。\n"
        f"verify_disclosure_permission ツールで開示可否を確認してください。"
    )
    _ = await runner.execute_prompt(prompt, user_id=resident_id)

    if req.is_human_approved:
        resident = await repo.get_resident(building_id, resident_id)
        unit = await repo.get_unit(building_id, resident.unit_id) if resident else None
        return DiscloseLocationResponse(
            resident_id=resident_id,
            disclosed=True,
            target_room_number=unit.room_number if unit else None,
            target_floor=unit.floor if unit else None,
            target_unit_id=unit.unit_id if unit else None,
            scope="FULL_LOCATION",
            message="本人の明示的承認を確認したため、詳細な部屋番号を開示しました。",
        )
    else:
        return DiscloseLocationResponse(
            resident_id=resident_id,
            disclosed=False,
            target_room_number=None,
            target_floor=None,
            target_unit_id=None,
            scope="ABSTRACT_TOKEN_ONLY",
            message="未承認のため、個人識別情報は保護され抽象トークンのみ維持されます。",
        )
