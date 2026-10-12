"""Emergency management and safety check endpoints (API-01, API-02, API-08)."""

import random
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from src.agents.building_agent import BuildingAgent
from src.agents.resident_agent import ResidentAgent
from src.db.base import BaseRepository
from src.db.factory import get_repository
from src.dependencies.auth import get_current_user, require_admin
from src.models.auth import CurrentUser
from src.models.domain import (
    Emergency,
    EmergencyStatus,
    EmergencyType,
    Issue,
    IssueStatus,
    IssueType,
    PresenceContext,
    PresenceState,
    Resident,
    ResidentEmergencyCurrentState,
    ResidentEmergencyStateEvent,
    SafetyStatus,
    SourceType,
)
from src.models.schemas import (
    ActiveEmergencyResponse,
    ConfirmPresenceRequest,
    ConfirmPresenceResponse,
    EmergencyTriageRequest,
    EmergencyTriageResponse,
    EmergencyTriggerRequest,
    EmergencyTriggerResponse,
    SimulateStepResponse,
    StructuredNeedSchema,
)

router = APIRouter(prefix="", tags=["emergency"])


@router.post(
    "/admin/reset-database",
    summary="Firestore データベースの完全クリーンアップ & 50戸再シード（管理人専用）",
)
async def reset_database(
    admin: CurrentUser = Depends(require_admin),
    repo: BaseRepository = Depends(get_repository),
) -> dict:
    """Clear all old documents and reseed strictly 50 units SC-3 dataset."""
    from src.db.seed import seed_sc3_data

    building_id = admin.building_id or "bld-01"
    await repo.clear_building_data(building_id)
    await seed_sc3_data(repo, building_id=building_id, force_reset=True)
    units = await repo.list_units(building_id)
    residents = await repo.list_residents(building_id)
    return {
        "status": "success",
        "building_id": building_id,
        "units_count": len(units),
        "residents_count": len(residents),
        "message": "Firestoreの不要データを全削除し、厳密な50戸（SC-3仕様）に再シードしました。",
    }


@router.get(
    "/emergency/active",
    response_model=ActiveEmergencyResponse,
    summary="API-08 / FN-01: アクティブな緊急事態および最新Issueの取得（画面復元用）",
)
async def get_active_emergency(
    user: CurrentUser = Depends(get_current_user),
    repo: BaseRepository = Depends(get_repository),
) -> ActiveEmergencyResponse:
    """現在進行中のアクティブな緊急事態および最新Issueを取得し、
    ブラウザリロード時の画面復元を可能にする (FN-01)。
    """
    building_id = user.building_id or "bld-01"
    emergency = await repo.get_active_emergency(building_id)
    if not emergency:
        return ActiveEmergencyResponse(is_active=False)

    issues = await repo.list_issues(building_id, emergency.emergency_id)
    latest = issues[-1] if issues else None

    return ActiveEmergencyResponse(
        is_active=True,
        emergency_id=emergency.emergency_id,
        issue_id=latest.issue_id if latest else None,
        emergency_type=emergency.emergency_type,
        status=emergency.status,
        instruction=latest.instruction if latest else "",
        triggered_at=emergency.triggered_at,
        created_at=latest.created_at if latest else emergency.triggered_at,
    )


def _get_resident_floor(resident_id: str) -> int:
    """Extract floor number from resident_id (e.g. res-205 -> 2, resident-i -> 3)."""
    persona_floors = {
        "resident-i": 3,
        "resident-h": 3,
        "resident-j": 3,
        "resident-k": 5,
    }
    if resident_id in persona_floors:
        return persona_floors[resident_id]
    if resident_id.startswith("res-") and len(resident_id) >= 5:
        room_part = resident_id[4:]
        if room_part.isdigit():
            return int(room_part[0])
    return 3


def _weighted_sample_residents(
    residents: list[Resident],
    weights_by_floor: dict[int, float],
    rng: random.Random,
) -> list[str]:
    """Sort resident IDs using Efraimidis-Spirakis weighted sampling algorithm."""
    scored: list[tuple[float, str]] = []
    for r in residents:
        floor = _get_resident_floor(r.resident_id)
        weight = max(weights_by_floor.get(floor, 1.0), 0.01)
        u = rng.random()
        # Avoid log(0)
        u = max(u, 1e-9)
        # Key: u^(1/w). Higher score means earlier selection.
        score = u ** (1.0 / weight)
        scored.append((score, r.resident_id))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [r_id for _, r_id in scored]


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

    # 2. Create Initial Disaster Issue (E-011)
    issue_type_map = {
        EmergencyType.EARTHQUAKE: IssueType.SAFETY_CHECK,
        EmergencyType.POWER_OUTAGE: IssueType.SUPPLY_DISTRIBUTION,
        EmergencyType.FIRE: IssueType.EVACUATION_GUIDANCE,
        EmergencyType.FLOOD: IssueType.VERTICAL_EVACUATION,
    }
    route_constraint_map = {
        EmergencyType.FIRE: "西側非常階段",
        EmergencyType.FLOOD: "上層階（6階以上）共用部",
    }
    issue = Issue(
        issue_id=issue_id,
        emergency_id=emergency_id,
        issue_type=issue_type_map.get(req.emergency_type, IssueType.SAFETY_CHECK),
        instruction=req.instruction,
        route_constraint=route_constraint_map.get(req.emergency_type),
        status=IssueStatus.OPEN,
        created_by_admin_id=admin.uid,
        created_at=now,
    )
    await repo.create_issue(building_id, issue)

    # 3. Initialize residents' states (E-009, NFR-05)
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

    # Manual demo personas: 301 (resident-i), 302 (resident-h), 303 (resident-j), 504 (resident-k)
    manual_resident_ids = {"resident-i", "resident-h", "resident-j", "resident-k"}
    safety_status_map: dict[str, SafetyStatus] = {
        r.resident_id: SafetyStatus.UNKNOWN for r in target_residents
    }

    if req.simulate_distribution:
        # Deterministic seed distribution for demo reproducibility (NFR-05 / SC-3)
        # or weighted random distribution per disaster type (Issue #50)
        other_residents = sorted(
            [r for r in target_residents if r.resident_id not in manual_resident_ids],
            key=lambda r: r.resident_id,
        )

        if req.random_seed:
            chosen_seed = random.randint(1, 10_000_000)
            rng = random.Random(chosen_seed)
        else:
            chosen_seed = req.seed if req.seed is not None else 42
            rng = random.Random(chosen_seed)

        # Backward compatibility for default demo earthquake seed:
        # If random_seed is False and seed is 42 (or None) and earthquake, use uniform shuffle
        is_default_demo_eq = (
            not req.random_seed
            and (req.seed is None or req.seed == 42)
            and req.emergency_type == EmergencyType.EARTHQUAKE
        )
        if is_default_demo_eq:
            shuffled_ids = [r.resident_id for r in other_residents]
            rng.shuffle(shuffled_ids)
        else:
            # Floor-weighted distribution per disaster type:
            # FLOOD: Lower floors (1F > 2F > 3F > 4F > 5F)
            # FIRE / POWER_OUTAGE: Upper floors (5F > 4F > 3F > 2F > 1F)
            # EARTHQUAKE: Uniform
            if req.emergency_type == EmergencyType.FLOOD:
                weights = {1: 4.0, 2: 2.5, 3: 1.0, 4: 0.5, 5: 0.2}
            elif req.emergency_type in (EmergencyType.FIRE, EmergencyType.POWER_OUTAGE):
                weights = {5: 3.5, 4: 2.5, 3: 1.5, 2: 1.0, 1: 0.8}
            else:
                weights = {1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0, 5: 1.0}
            shuffled_ids = _weighted_sample_residents(other_residents, weights, rng)

        # 46 units: 2 NEED_HELP, 6 UNKNOWN, 38 SAFE
        need_help_ids = set(shuffled_ids[:2])
        unknown_ids = set(shuffled_ids[2:8])

        for r_id in shuffled_ids:
            if r_id in need_help_ids:
                safety_status_map[r_id] = SafetyStatus.NEED_HELP
            elif r_id in unknown_ids:
                safety_status_map[r_id] = SafetyStatus.UNKNOWN
            else:
                safety_status_map[r_id] = SafetyStatus.SAFE

    initial_states = [
        ResidentEmergencyCurrentState(
            emergency_id=emergency_id,
            resident_id=res.resident_id,
            safety_status=safety_status_map[res.resident_id],
            observed_at=now,
        )
        for res in target_residents
    ]
    await repo.batch_set_current_states(building_id, initial_states)

    # Append initial state history events (E-010)
    for res in target_residents:
        status_val = safety_status_map[res.resident_id]
        await repo.append_state_event(
            building_id,
            ResidentEmergencyStateEvent(
                event_id=f"state-evt-{uuid.uuid4().hex[:12]}",
                emergency_id=emergency_id,
                resident_id=res.resident_id,
                safety_status=status_val,
                occurred_at=now,
                source="SIMULATED_INITIAL" if status_val != SafetyStatus.UNKNOWN else "SYSTEM_INIT",
            ),
        )

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
    # FN-02 / FN-08: The management persona cannot submit a resident answer.
    if user.role != "resident":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Resident role required")
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

    # FN-03 / REQ-15: 自由文メッセージを Resident Agent が解析・構造化
    structured_need_schema = None
    needs_clarification = False
    clarification_question = None

    resident = await repo.get_resident(building_id, resident_id)
    unit = await repo.get_unit(building_id, resident.unit_id) if resident else None
    floor = unit.floor if unit else 1

    final_safety_status = req.safety_status
    if req.message is not None:
        agent = ResidentAgent(resident_id=resident_id, repo=repo, building_id=building_id)
        need = agent.parse_user_free_text(req.message, floor)
        structured_need_schema = StructuredNeedSchema(
            resident_id=need.resident_id,
            floor=need.floor,
            category=need.category,
            requires_assistance=need.requires_assistance,
            can_stairs=need.can_stairs,
            raw_message=need.raw_message,
            needs_clarification=need.needs_clarification,
            clarification_question=need.clarification_question,
        )
        needs_clarification = need.needs_clarification
        clarification_question = need.clarification_question
        if need.requires_assistance:
            final_safety_status = SafetyStatus.NEED_HELP

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
            safety_status=final_safety_status,
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
            safety_status=final_safety_status,
            occurred_at=now,
            source="SELF_REPORT",
        ),
    )

    return ConfirmPresenceResponse(
        resident_id=resident_id,
        emergency_id=req.emergency_id,
        safety_status=final_safety_status,
        observed_at=now,
        message=req.message,
        structured_need=structured_need_schema,
        needs_clarification=needs_clarification,
        clarification_question=clarification_question,
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


@router.post(
    "/emergencies/{emergency_id}/simulate-step",
    response_model=SimulateStepResponse,
    summary="[Feature/Demo] 時間経過シミュレーション: 未回答住戸の自律安否更新 (Issue #50)",
)
async def simulate_step(
    emergency_id: str,
    admin: CurrentUser = Depends(require_admin),
    repo: BaseRepository = Depends(get_repository),
) -> SimulateStepResponse:
    """時間の経過に伴い、未回答（UNKNOWN）の一般住戸のうち
    1〜2戸が無事（SAFE）に回答する動的変動をシミュレートする (Issue #50)。
    """
    building_id = admin.building_id or "bld-01"
    now = datetime.now(UTC)

    # 1. 現在の全住民状態を取得
    states = await repo.list_current_states(building_id, emergency_id)
    if not states:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Emergency {emergency_id} states not found.",
        )

    manual_resident_ids = {"resident-i", "resident-h", "resident-j", "resident-k"}

    # 手動ペルソナ以外の UNKNOWN 住戸を抽出
    unknown_states = [
        s for s in states
        if s.safety_status == SafetyStatus.UNKNOWN and s.resident_id not in manual_resident_ids
    ]

    updated_ids: list[str] = []
    if unknown_states:
        # 1〜2戸を選択して SAFE に更新
        update_count = min(len(unknown_states), random.choice([1, 2]))
        selected_to_update = random.sample(unknown_states, update_count)

        for s in selected_to_update:
            s.safety_status = SafetyStatus.SAFE
            s.observed_at = now
            updated_ids.append(s.resident_id)
            # 履歴イベントも追加
            await repo.append_state_event(
                building_id,
                ResidentEmergencyStateEvent(
                    event_id=f"state-evt-{uuid.uuid4().hex[:12]}",
                    emergency_id=emergency_id,
                    resident_id=s.resident_id,
                    safety_status=SafetyStatus.SAFE,
                    occurred_at=now,
                    source="SIMULATED_STEP",
                ),
            )

        # batch_set_current_states で更新
        await repo.batch_set_current_states(building_id, states)

    # 最新サマリー計算
    safe_cnt = sum(1 for s in states if s.safety_status == SafetyStatus.SAFE)
    need_help_cnt = sum(1 for s in states if s.safety_status == SafetyStatus.NEED_HELP)
    unknown_cnt = sum(1 for s in states if s.safety_status == SafetyStatus.UNKNOWN)

    summary_map = {
        "SAFE": safe_cnt,
        "NEED_HELP": need_help_cnt,
        "UNKNOWN": unknown_cnt,
    }
    msg = (
        f"{len(updated_ids)} 戸の安否回答（無事）を受領しました。"
        if updated_ids
        else "未回答の一般住戸はありません。"
    )

    return SimulateStepResponse(
        emergency_id=emergency_id,
        advanced_resident_ids=updated_ids,
        current_states_summary=summary_map,
        updated_count=len(updated_ids),
        updated_residents=updated_ids,
        safe_count=safe_cnt,
        need_help_count=need_help_cnt,
        unknown_count=unknown_cnt,
        total_count=len(states),
        message=msg,
    )

