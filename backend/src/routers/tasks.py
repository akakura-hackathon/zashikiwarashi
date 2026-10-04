"""Task coordination and issue progress endpoints (API-03, API-04, API-05, API-06)."""

from fastapi import APIRouter, Depends, HTTPException, status

from src.db.base import BaseRepository
from src.db.factory import get_repository
from src.dependencies.auth import get_current_user
from src.models.auth import CurrentUser
from src.models.domain import SafetyStatus
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
    user: CurrentUser = Depends(get_current_user),
    repo: BaseRepository = Depends(get_repository),
) -> IssueDetailResponse:
    """Fetch issue, associated tasks, and prioritized unconfirmed targets (API-03)."""
    building_id = user.building_id or "bld-01"

    # 1. Lookup active emergency or find emergency containing this issue
    emergency = await repo.get_active_emergency(building_id)
    if not emergency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active emergency found.",
        )
    emergency_id = emergency.emergency_id

    issue = await repo.get_issue(building_id, emergency_id, issue_id)
    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue {issue_id} not found in emergency {emergency_id}.",
        )

    # 2. Fetch tasks for issue
    tasks = await repo.list_tasks_by_issue(building_id, emergency_id, issue_id)

    # If resident, they can only view tasks assigned to them (DESIGN §7.3.2)
    if user.role == "resident":
        tasks = [t for t in tasks if t.resident_id == (user.resident_id or user.uid)]

    # 3. Current states summary and mapping
    current_states = await repo.list_current_states(building_id, emergency_id)
    summary: dict[str, int] = {}
    resident_states: dict[str, SafetyStatus] = {}
    for st in current_states:
        summary[st.safety_status] = summary.get(st.safety_status, 0) + 1
        resident_states[st.resident_id] = st.safety_status

    # 4. Priority targets for management triage (computed on-the-fly, DESIGN §6.3 D)
    priority_targets = []
    if user.role == "admin":
        triage_svc = TriageService(repo)
        priority_targets = await triage_svc.calculate_priority_alerts(building_id, emergency_id)

    return IssueDetailResponse(
        issue=issue,
        tasks=tasks,
        current_states_summary=summary,
        resident_states=resident_states,
        priority_targets=priority_targets,
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
