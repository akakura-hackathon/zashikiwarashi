"""Emergency management and safety check endpoints (API-01, API-02, API-08)."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from src.agents.building_agent import BuildingAgent
from src.db.base import BaseRepository
from src.db.factory import get_repository
from src.dependencies.auth import get_current_user, require_admin
from src.models.auth import CurrentUser
from src.models.domain import (
    Emergency,
    EmergencyStatus,
    Issue,
    IssueStatus,
    IssueType,
    PresenceContext,
    PresenceState,
    ResidentEmergencyCurrentState,
    ResidentEmergencyStateEvent,
    SafetyStatus,
    SourceType,
)
from src.models.schemas import (
    ConfirmPresenceRequest,
    ConfirmPresenceResponse,
    EmergencyTriageRequest,
    EmergencyTriageResponse,
    EmergencyTriggerRequest,
    EmergencyTriggerResponse,
)

router = APIRouter(prefix="", tags=["emergency"])


@router.post(
    "/emergency/trigger",
    response_model=EmergencyTriggerResponse,
    summary="API-01: 緊急モード発令（管理人専用）",
)
async def trigger_emergency(
    req: EmergencyTriggerRequest,
    admin: CurrentUser = Depends(require_admin),
    repo: BaseRepository = Depends(get_repository),
) -> EmergencyTriggerResponse:
    """Trigger building-wide emergency state and safety check issue (API-01)."""
    now = datetime.now(UTC)
    emergency_id = f"em-{uuid.uuid4().hex[:12]}"
    issue_id = f"iss-{uuid.uuid4().hex[:12]}"
    building_id = req.building_id or admin.building_id or "bld-01"

    # 0. Ensure building & SC-3 seed data exist (50 units, residents H/I/J/K)
    building = await repo.get_building(building_id)
    residents = await repo.list_residents(building_id) if building else []
    if not building or len(residents) != 50:
        from src.db.seed import seed_sc3_data
        await seed_sc3_data(repo, building_id=building_id, force_reset=True)
        residents = await repo.list_residents(building_id)

    # 0.5 Close any previous active emergencies in this building
    await repo.close_all_active_emergencies(building_id)

    # 1. Create Emergency (E-008)
    emergency = Emergency(
        emergency_id=emergency_id,
        building_id=building_id,
        emergency_type=req.emergency_type,
        status=EmergencyStatus.ACTIVE,
        triggered_by=admin.uid,
        triggered_at=now,
    )
    await repo.create_emergency(emergency)

    # 2. Create Initial Safety Check Issue (E-011)
    issue = Issue(
        issue_id=issue_id,
        emergency_id=emergency_id,
        issue_type=IssueType.SAFETY_CHECK,
        instruction=req.instruction,
        status=IssueStatus.OPEN,
        created_by_admin_id=admin.uid,
        created_at=now,
    )
    await repo.create_issue(building_id, issue)

    # 3. Initialize all 50 residents' state to UNKNOWN via Batch Write (E-009)
    valid_resident_ids = {
        "resident-h", "resident-i", "resident-j", "resident-k"
    } | {
        f"res-{floor}{room:02d}"
        for floor in range(1, 6)
        for room in range(1, 11)
        if f"{floor}{room:02d}" not in ("301", "302", "303", "504")
    }
    target_residents = [r for r in residents if r.resident_id in valid_resident_ids]
    if len(target_residents) != 50:
        target_residents = residents[:50]

    initial_states = [
        ResidentEmergencyCurrentState(
            emergency_id=emergency_id,
            resident_id=res.resident_id,
            safety_status=SafetyStatus.UNKNOWN,
            observed_at=now,
        )
        for res in target_residents
    ]
    await repo.batch_set_current_states(building_id, initial_states)

    return EmergencyTriggerResponse(
        emergency_id=emergency_id,
        issue_id=issue_id,
        status=EmergencyStatus.ACTIVE,
        triggered_at=now,
    )


@router.post(
    "/emergency/confirm-presence",
    response_model=ConfirmPresenceResponse,
    summary="API-02: 在館・安否の1タップ応答（住民専用）",
)
async def confirm_presence(
    req: ConfirmPresenceRequest,
    user: CurrentUser = Depends(get_current_user),
    repo: BaseRepository = Depends(get_repository),
) -> ConfirmPresenceResponse:
    """Record 1-tap safety and presence response from resident (API-02)."""
    now = datetime.now(UTC)
    resident_id = user.resident_id or user.uid
    building_id = user.building_id or "bld-01"

    # Verify active emergency
    emergency = await repo.get_emergency(building_id, req.emergency_id)
    if not emergency or emergency.status != EmergencyStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Emergency {req.emergency_id} is not active.",
        )

    # 1. Update Presence Context (E-007)
    await repo.set_presence_context(
        building_id,
        PresenceContext(
            resident_id=resident_id,
            presence_state=PresenceState.IN_BUILDING,
            observed_at=now,
            expires_at=now + timedelta(hours=24),
            source_type=SourceType.SELF_REPORT,
        ),
    )

    # 2. Update Current State (E-009)
    await repo.set_current_state(
        building_id,
        ResidentEmergencyCurrentState(
            emergency_id=req.emergency_id,
            resident_id=resident_id,
            safety_status=req.safety_status,
            observed_at=now,
        ),
    )

    # 3. Append State Event (E-010)
    await repo.append_state_event(
        building_id,
        ResidentEmergencyStateEvent(
            event_id=f"state-evt-{uuid.uuid4().hex[:12]}",
            emergency_id=req.emergency_id,
            resident_id=resident_id,
            safety_status=req.safety_status,
            occurred_at=now,
            source="SELF_REPORT",
        ),
    )

    return ConfirmPresenceResponse(
        resident_id=resident_id,
        emergency_id=req.emergency_id,
        safety_status=req.safety_status,
        observed_at=now,
        message=req.message,
    )


@router.post(
    "/emergencies/{emergency_id}/triage",
    response_model=EmergencyTriageResponse,
    summary="API-08: 安否確認締切・トリアージ開始（管理人専用）",
)
async def triage_emergency(
    emergency_id: str,
    req: EmergencyTriageRequest,
    admin: CurrentUser = Depends(require_admin),
    repo: BaseRepository = Depends(get_repository),
) -> EmergencyTriageResponse:
    """Close safety check period and generate neighbor check tasks (API-08)."""
    building_id = admin.building_id or "bld-01"

    # Update Issue status to TRIAGING
    issue = await repo.get_issue(building_id, emergency_id, req.issue_id)
    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue {req.issue_id} not found.",
        )

    issue.status = IssueStatus.TRIAGING
    await repo.update_issue(building_id, issue)

    # Execute Triage via Building Agent Coordinator (FN-04)
    building_agent = BuildingAgent(repo)
    triage_result = await building_agent.execute_triage(
        building_id=building_id,
        emergency_id=emergency_id,
        issue_id=req.issue_id,
    )

    tasks = triage_result.created_tasks
    assigned_residents = [t.resident_id for t in tasks]
    return EmergencyTriageResponse(
        issue_id=req.issue_id,
        tasks_created=len(tasks),
        triaged_units_count=len(tasks),
        unresponsive_count=triage_result.unresponsive_count,
        likely_away_count=triage_result.likely_away_count,
        assigned_residents=assigned_residents,
        ai_reasoning=triage_result.ai_reasoning,
        agent_model=triage_result.agent_model,
        policy_gate=(
            "Policy Engine G4: Progressive Disclosure (未承認住戸の部屋番号をマスク) を強制適用"
        ),
    )
