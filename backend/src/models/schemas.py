"""API Request and Response Pydantic Schemas based on docs/DESIGN.md §8."""

from datetime import datetime

from pydantic import BaseModel, Field

from src.models.domain import (
    AuditEvent,
    EmergencyStatus,
    EmergencyType,
    Issue,
    ReasonCode,
    SafetyStatus,
    Task,
    TaskEvent,
    TaskStatus,
)

# --- Legacy / Chat (Existing) ---


class ChatRequest(BaseModel):
    session_id: str
    message: str


class ChatResponse(BaseModel):
    reply: str


# --- API-01: POST /emergency/trigger ---


class EmergencyTriggerRequest(BaseModel):
    building_id: str
    emergency_type: EmergencyType = EmergencyType.EARTHQUAKE
    instruction: str = "震度5強の地震が発生しました。各戸の安否確認を実施します。"


class EmergencyTriggerResponse(BaseModel):
    emergency_id: str
    issue_id: str
    status: EmergencyStatus
    triggered_at: datetime


# --- API-02: POST /emergency/confirm-presence ---


class ConfirmPresenceRequest(BaseModel):
    emergency_id: str
    safety_status: SafetyStatus
    message: str | None = None


class StructuredNeedSchema(BaseModel):
    resident_id: str
    floor: int
    category: str  # "SAFETY_CHECK", "EVACUATION", "WATER", "MEDICAL", "UNKNOWN"
    requires_assistance: bool
    can_stairs: bool
    raw_message: str
    needs_clarification: bool = False
    clarification_question: str | None = None


class ConfirmPresenceResponse(BaseModel):
    resident_id: str
    emergency_id: str
    safety_status: SafetyStatus
    observed_at: datetime
    message: str | None = None
    structured_need: StructuredNeedSchema | None = None
    needs_clarification: bool = False
    clarification_question: str | None = None


# --- API-03: GET /issues/{issueId} ---


class PriorityAlertTarget(BaseModel):
    resident_id: str
    unit_id: str
    room_number: str
    floor: int
    safety_status: SafetyStatus
    is_elderly: bool
    is_mobility_difficulty: bool
    neighbor_check_result: ReasonCode | None = None
    priority_level: str = "HIGH"  # HIGH | MEDIUM | LOW


class IssueDetailResponse(BaseModel):
    issue: Issue
    tasks: list[Task]
    current_states_summary: dict[str, int] = Field(default_factory=dict)
    resident_states: dict[str, SafetyStatus] = Field(default_factory=dict)
    room_states: dict[str, SafetyStatus] = Field(default_factory=dict)
    priority_targets: list[PriorityAlertTarget] = Field(default_factory=list)
    likely_away_count: int = 0
    likely_away_rooms: list[str] = Field(default_factory=list)


# --- API-04: POST /tasks/{taskId}/respond ---


class TaskRespondRequest(BaseModel):
    response: TaskStatus  # APPROVED | DECLINED
    reason_code: ReasonCode | None = None


class TaskRespondResponse(BaseModel):
    task_id: str
    status: TaskStatus
    event_id: str


# --- API-05: POST /tasks/{taskId}/report ---


class TaskReportRequest(BaseModel):
    status: TaskStatus  # IN_PROGRESS | COMPLETED | FAILED
    reason_code: ReasonCode | None = None


class TaskReportResponse(BaseModel):
    task_id: str
    status: TaskStatus
    event_id: str


# --- API-06: GET /tasks/{taskId} ---


class TaskDetailResponse(BaseModel):
    task: Task
    # Progressive Disclosure（承認前は None、承認後に開示）
    target_room_number: str | None = None
    target_floor: int | None = None
    target_unit_id: str | None = None
    is_disclosed: bool = False
    latest_event: TaskEvent | None = None


# --- API-07: GET /me/audit-events ---


class AuditEventListResponse(BaseModel):
    audit_events: list[AuditEvent]


# --- API-08: POST /emergencies/{emergencyId}/triage ---


class EmergencyTriageRequest(BaseModel):
    issue_id: str


class EmergencyTriageResponse(BaseModel):
    issue_id: str
    tasks_created: int
    triaged_units_count: int
    unresponsive_count: int = 0
    likely_away_count: int = 0
    assigned_residents: list[str] = Field(default_factory=list)
    ai_reasoning: str = ""
    agent_model: str = "Building Agent (Gemini 2.5 Flash)"
    policy_gate: str = (
        "Policy Engine G4: Progressive Disclosure (未承認住戸の部屋番号をマスク) を強制適用"
    )
