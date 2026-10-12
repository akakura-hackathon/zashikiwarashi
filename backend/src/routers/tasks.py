"""Task coordination and issue progress endpoints (API-03, API-04, API-05, API-06)."""

from fastapi import APIRouter, Depends, HTTPException, status

from src.db.base import BaseRepository
from src.db.factory import get_repository
from src.dependencies.auth import get_current_user
from src.models.auth import CurrentUser
from src.models.domain import PresenceState, SafetyStatus
from src.models.schemas import (
    IssueDetailResponse,
    TaskDetailResponse,
    TaskReportRequest,
    TaskReportResponse,
    TaskRespondRequest,
    TaskRespondResponse,
)
from src.services.policy_engine import PolicyViolationError
from src.services.task_service import TaskService
from src.services.triage_service import TriageService

router = APIRouter(prefix="", tags=["tasks"])


@router.get(
    "/issues/{issue_id}",
    response_model=IssueDetailResponse,
    summary="API-03: Issue進捗・配下Task・優先アラート取得（管理人・住民）",
)
async def get_issue_progress(
    issue_id: str,
    emergency_id: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    repo: BaseRepository = Depends(get_repository),
) -> IssueDetailResponse:
    """Fetch issue, associated tasks, and prioritized unconfirmed targets (API-03)."""
    building_id = user.building_id or "bld-01"

    # 1. Lookup emergency: use provided emergency_id, active emergency, or search by issue_id
    target_emergency = None
    if emergency_id:
        target_emergency = await repo.get_emergency(building_id, emergency_id)

    if not target_emergency:
        target_emergency = await repo.get_active_emergency(building_id)

    issue = None
    if target_emergency:
        issue = await repo.get_issue(building_id, target_emergency.emergency_id, issue_id)
        if not issue:
            # Fallback: search across all emergencies in building
            fallback_em = await repo.find_emergency_by_issue(building_id, issue_id)
            if fallback_em:
                target_emergency = fallback_em
                issue = await repo.get_issue(building_id, target_emergency.emergency_id, issue_id)
    else:
        target_emergency = await repo.find_emergency_by_issue(building_id, issue_id)
        if target_emergency:
            issue = await repo.get_issue(building_id, target_emergency.emergency_id, issue_id)

    if not target_emergency or not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue {issue_id} not found in any emergency.",
        )
    actual_emergency_id = target_emergency.emergency_id

    # 2. Fetch tasks for issue
    tasks = await repo.list_tasks_by_issue(building_id, actual_emergency_id, issue_id)

    # If resident, they can only view tasks assigned to them (DESIGN §7.3.2)
    if user.role == "resident":
        tasks = [t for t in tasks if t.resident_id == (user.resident_id or user.uid)]

    # 3. Current states summary and mapping
    current_states = await repo.list_current_states(building_id, actual_emergency_id)
    summary: dict[str, int] = {}
    resident_states: dict[str, SafetyStatus] = {}
    for st in current_states:
        summary[st.safety_status] = summary.get(st.safety_status, 0) + 1
        resident_states[st.resident_id] = st.safety_status

    # 4. Priority targets and Likely Away units for management triage (DESIGN §6.3 D)
    priority_targets = []
    room_states = {}
    likely_away_count = 0
    likely_away_rooms: list[str] = []
    task_board = []

    if user.role == "admin":
        # FN-08: Resolve rooms from repository data, never from demo labels.
        residents = await repo.list_residents(building_id)
        units = {u.unit_id: u for u in await repo.list_units(building_id)}
        resident_to_room: dict[str, str] = {}
        for resident in residents:
            unit = units.get(resident.unit_id)
            if unit:
                resident_to_room[resident.resident_id] = unit.room_number
                room_states[unit.room_number] = resident_states.get(
                    resident.resident_id, SafetyStatus.UNKNOWN
                )

        # Cat 3 在館コンテキストから外出中（終日外出予定など）の住戸を抽出
        presence_contexts = await repo.list_presence_contexts(building_id)
        for ctx in presence_contexts:
            if ctx.presence_state == PresenceState.OUTSIDE_BUILDING:
                if resident_states.get(ctx.resident_id) == SafetyStatus.UNKNOWN:
                    room_no = resident_to_room.get(ctx.resident_id)
                    if room_no:
                        likely_away_rooms.append(room_no)
        likely_away_count = len(likely_away_rooms)

        triage_svc = TriageService(repo)
        priority_targets = await triage_svc.calculate_priority_alerts(
            building_id, actual_emergency_id
        )
        task_board = await triage_svc.build_task_board(
            building_id, actual_emergency_id, issue_id
        )

    return IssueDetailResponse(
        issue=issue,
        tasks=tasks,
        current_states_summary=summary,
        resident_states=resident_states,
        room_states=room_states,
        priority_targets=priority_targets,
        likely_away_count=likely_away_count,
        likely_away_rooms=likely_away_rooms,
        task_board=task_board,
    )


@router.get(
    "/tasks/{task_id}",
    response_model=TaskDetailResponse,
    summary="API-06: Task詳細・Progressive Disclosure（住民専用）",
)
async def get_task(
    task_id: str,
    user: CurrentUser = Depends(get_current_user),
    repo: BaseRepository = Depends(get_repository),
) -> TaskDetailResponse:
    """Fetch task detail with progressive disclosure masking applied (API-06)."""
    building_id = user.building_id or "bld-01"
    emergency = await repo.get_active_emergency(building_id)
    if not emergency:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active emergency.")

    task_service = TaskService(repo)
    resident_id = user.resident_id or user.uid

    try:
        return await task_service.get_task_detail(
            building_id, emergency.emergency_id, task_id, resident_id
        )
    except PolicyViolationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.post(
    "/tasks/{task_id}/respond",
    response_model=TaskRespondResponse,
    summary="API-04: 打診への回答（APPROVED/DECLINED）（住民専用）",
)
async def respond_to_task(
    task_id: str,
    req: TaskRespondRequest,
    user: CurrentUser = Depends(get_current_user),
    repo: BaseRepository = Depends(get_repository),
) -> TaskRespondResponse:
    """Approve or decline task offer (API-04). Only assigned resident can approve."""
    building_id = user.building_id or "bld-01"
    emergency = await repo.get_active_emergency(building_id)
    if not emergency:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active emergency.")

    task_service = TaskService(repo)
    resident_id = user.resident_id or user.uid

    try:
        new_status, event_id = await task_service.respond_to_task(
            building_id=building_id,
            emergency_id=emergency.emergency_id,
            task_id=task_id,
            actor_resident_id=resident_id,
            response=req.response,
            reason_code=req.reason_code,
        )
        return TaskRespondResponse(
            task_id=task_id,
            status=new_status,
            event_id=event_id,
        )
    except PolicyViolationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.post(
    "/tasks/{task_id}/report",
    response_model=TaskReportResponse,
    summary="API-05: タスク開始・完了・失敗の報告（住民専用）",
)
async def report_task(
    task_id: str,
    req: TaskReportRequest,
    user: CurrentUser = Depends(get_current_user),
    repo: BaseRepository = Depends(get_repository),
) -> TaskReportResponse:
    """Report task progress or completion (API-05)."""
    building_id = user.building_id or "bld-01"
    emergency = await repo.get_active_emergency(building_id)
    if not emergency:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active emergency.")

    task_service = TaskService(repo)
    resident_id = user.resident_id or user.uid

    try:
        new_status, event_id = await task_service.report_task_progress(
            building_id=building_id,
            emergency_id=emergency.emergency_id,
            task_id=task_id,
            actor_resident_id=resident_id,
            new_status=req.status,
            reason_code=req.reason_code,
        )
        return TaskReportResponse(
            task_id=task_id,
            status=new_status,
            event_id=event_id,
        )
    except PolicyViolationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
