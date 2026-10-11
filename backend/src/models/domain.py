"""Domain models based on ER diagram and docs/DESIGN.md.

Entities:
- E-001: Building
- E-002: Unit
- E-003: Node
- E-004: Edge
- E-005: Resident
- E-006: HouseholdProfile
- E-007: PresenceContext
- E-008: Emergency
- E-009: ResidentEmergencyCurrentState
- E-010: ResidentEmergencyStateEvent
- E-011: Issue
- E-012: Task
- E-013: TaskEvent
- E-016: AuditEvent
"""

from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

# --- Enums (docs/DESIGN.md §7.4 #5) ---


class EmergencyType(StrEnum):
    EARTHQUAKE = "EARTHQUAKE"
    POWER_OUTAGE = "POWER_OUTAGE"
    FIRE = "FIRE"
    FLOOD = "FLOOD"


class EmergencyStatus(StrEnum):
    ACTIVE = "ACTIVE"
    CLOSED = "CLOSED"


class SafetyStatus(StrEnum):
    SAFE = "SAFE"
    NEED_HELP = "NEED_HELP"
    UNKNOWN = "UNKNOWN"


class PresenceState(StrEnum):
    IN_BUILDING = "IN_BUILDING"
    OUTSIDE_BUILDING = "OUTSIDE_BUILDING"
    UNKNOWN = "UNKNOWN"


class SourceType(StrEnum):
    CALENDAR = "CALENDAR"
    SELF_REPORT = "SELF_REPORT"
    DEVICE_SIGNAL = "DEVICE_SIGNAL"


class NodeType(StrEnum):
    UNIT_ENTRANCE = "UNIT_ENTRANCE"
    CORRIDOR = "CORRIDOR"
    STAIRS = "STAIRS"
    LANDING = "LANDING"
    LOUNGE = "LOUNGE"
    MANAGEMENT_OFFICE = "MANAGEMENT_OFFICE"


class MovementType(StrEnum):
    WALK = "WALK"
    STAIRS_UP = "STAIRS_UP"
    STAIRS_DOWN = "STAIRS_DOWN"


class IssueType(StrEnum):
    SAFETY_CHECK = "SAFETY_CHECK"


class IssueStatus(StrEnum):
    OPEN = "OPEN"
    TRIAGING = "TRIAGING"
    RESOLVED = "RESOLVED"


class TaskType(StrEnum):
    NEIGHBOR_CHECK = "NEIGHBOR_CHECK"


class TaskStatus(StrEnum):
    PENDING = "PENDING"
    OFFERED = "OFFERED"
    APPROVED = "APPROVED"
    DECLINED = "DECLINED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"


class TaskEventType(StrEnum):
    EVALUATED = "EVALUATED"
    OFFERED = "OFFERED"
    APPROVED = "APPROVED"
    DECLINED = "DECLINED"
    STARTED = "STARTED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class TaskResult(StrEnum):
    CAN_EXECUTE = "CAN_EXECUTE"
    REQUIRES_ASSISTANCE = "REQUIRES_ASSISTANCE"
    CANNOT_EXECUTE = "CANNOT_EXECUTE"
    UNKNOWN = "UNKNOWN"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class ActorType(StrEnum):
    RESIDENT = "RESIDENT"
    ADMIN = "ADMIN"
    BUILDING_AGENT = "BUILDING_AGENT"
    RESIDENT_AGENT = "RESIDENT_AGENT"
    SYSTEM = "SYSTEM"


class ReasonCode(StrEnum):
    TARGET_RESPONDED = "TARGET_RESPONDED"
    TARGET_NO_RESPONSE = "TARGET_NO_RESPONSE"
    BUSY = "BUSY"
    UNSAFE = "UNSAFE"
    TIMEOUT = "TIMEOUT"


# --- Entities ---


class Building(BaseModel):
    """E-001 Building 建物"""
    building_id: str
    name: str
    floor_count: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Unit(BaseModel):
    """E-002 Unit 住戸"""
    unit_id: str
    building_id: str
    entrance_node_id: str
    room_number: str
    floor: int


class Node(BaseModel):
    """E-003 Node 移動ノード"""
    node_id: str
    building_id: str
    node_type: NodeType
    floor: int


class Edge(BaseModel):
    """E-004 Edge 移動経路"""
    edge_id: str
    building_id: str
    from_node_id: str
    to_node_id: str
    movement_type: MovementType
    distance_meters: float
    standard_travel_seconds: int = 30


class Resident(BaseModel):
    """E-005 Resident 住民"""
    resident_id: str  # Firebase Auth UID と 1対1
    unit_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class HouseholdProfile(BaseModel):
    """E-006 HouseholdProfile 世帯プロファイル（高機密・他Agent非公開）"""
    unit_id: str
    member_count: int = 1
    elderly_count: int = 0
    infant_count: int = 0
    other_support_required_count: int = 0
    additional_non_helper_count: int = 0
    mobility_difficulty_count: int = 0
    stair_assistance_required_count: int = 0

    @property
    def is_priority_support_target(self) -> bool:
        """要配慮世帯かどうか（高齢・乳幼児・移動困難）"""
        return (
            self.elderly_count > 0
            or self.infant_count > 0
            or self.mobility_difficulty_count > 0
            or self.stair_assistance_required_count > 0
            or self.other_support_required_count > 0
        )


class PresenceContext(BaseModel):
    """E-007 PresenceContext 在館コンテキスト"""
    resident_id: str
    presence_state: PresenceState = PresenceState.UNKNOWN
    observed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    expires_at: datetime
    source_type: SourceType = SourceType.SELF_REPORT


class Emergency(BaseModel):
    """E-008 Emergency 緊急事象"""
    emergency_id: str
    building_id: str
    emergency_type: EmergencyType
    status: EmergencyStatus = EmergencyStatus.ACTIVE
    triggered_by: str
    triggered_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    closed_at: datetime | None = None


class ResidentEmergencyCurrentState(BaseModel):
    """E-009 ResidentEmergencyCurrentState 現在状態"""
    emergency_id: str
    resident_id: str
    current_node_id: str | None = None
    safety_status: SafetyStatus = SafetyStatus.UNKNOWN
    observed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ResidentEmergencyStateEvent(BaseModel):
    """E-010 ResidentEmergencyStateEvent 状態履歴（追記専用）"""
    event_id: str
    emergency_id: str
    resident_id: str
    current_node_id: str | None = None
    safety_status: SafetyStatus
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    source: str = "SELF_REPORT"  # SELF_REPORT | NEIGHBOR_CHECK | ADMIN


class Issue(BaseModel):
    """E-011 Issue 管理人Issue"""
    issue_id: str
    emergency_id: str
    issue_type: IssueType = IssueType.SAFETY_CHECK
    instruction: str
    route_constraint: str | None = None
    status: IssueStatus = IssueStatus.OPEN
    created_by_admin_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Task(BaseModel):
    """E-012 Task 住民タスク"""
    task_id: str
    issue_id: str
    parent_task_id: str | None = None
    resident_id: str
    target_resident_id: str | None = None
    start_node_id: str | None = None
    destination_node_id: str | None = None
    task_type: TaskType = TaskType.NEIGHBOR_CHECK
    estimated_seconds: int = 20
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    expires_at: datetime | None = None


class TaskEvent(BaseModel):
    """E-013 TaskEvent タスクイベント（追記専用）"""
    event_id: str
    task_id: str
    actor_resident_id: str | None = None
    event_type: TaskEventType
    result: TaskResult | None = None
    reason_code: ReasonCode | None = None
    actor_type: ActorType = ActorType.RESIDENT
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    expires_at: datetime | None = None


class AuditEvent(BaseModel):
    """E-016 AuditEvent 監査イベント（追記専用）"""
    audit_event_id: str
    emergency_id: str
    actor_type: ActorType
    actor_id: str
    action: str
    target_type: str
    target_id: str
    data_used: list[str] = Field(default_factory=list)
    data_disclosed: list[str] = Field(default_factory=list)
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
