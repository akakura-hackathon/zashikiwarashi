"""Audit log query endpoints (API-07 / REQ-10)."""

from fastapi import APIRouter, Depends, HTTPException, status

from src.db.base import BaseRepository
from src.db.factory import get_repository
from src.dependencies.auth import get_current_user
from src.models.auth import CurrentUser
from src.models.schemas import AuditEventListResponse

router = APIRouter(prefix="", tags=["audit"])


@router.get(
    "/me/audit-events",
    response_model=AuditEventListResponse,
    summary="API-07: 本人に関わる監査イベントの閲覧（住民専用）",
)
async def get_my_audit_events(
    user: CurrentUser = Depends(get_current_user),
    repo: BaseRepository = Depends(get_repository),
) -> AuditEventListResponse:
    """Retrieve all audit events where the caller is either actor or target (REQ-10)."""
    building_id = user.building_id or "bld-01"
    emergency = await repo.get_active_emergency(building_id)
    if not emergency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active emergency found.",
        )

    resident_id = user.resident_id or user.uid
    events = await repo.list_audit_events_for_resident(
        building_id=building_id,
        emergency_id=emergency.emergency_id,
        resident_id=resident_id,
    )
    return AuditEventListResponse(audit_events=events)
