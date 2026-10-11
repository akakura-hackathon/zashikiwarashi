"""Repository interface defining data access operations across Cat 1-5 entities."""

from abc import ABC, abstractmethod

from src.models.domain import (
    AuditEvent,
    Building,
    Edge,
    Emergency,
    HouseholdProfile,
    Issue,
    Node,
    PresenceContext,
    Resident,
    ResidentEmergencyCurrentState,
    ResidentEmergencyStateEvent,
    Task,
    TaskEvent,
    Unit,
)


class BaseRepository(ABC):
    """Abstract Repository for Zashikiwarashi persistence."""

    # --- Cat 1: Building & Space ---
    @abstractmethod
    async def create_building(self, building: Building) -> None: ...

    @abstractmethod
    async def get_building(self, building_id: str) -> Building | None: ...

    @abstractmethod
    async def create_unit(self, unit: Unit) -> None: ...

    @abstractmethod
    async def get_unit(self, building_id: str, unit_id: str) -> Unit | None: ...

    @abstractmethod
    async def list_units(self, building_id: str) -> list[Unit]: ...

    @abstractmethod
    async def create_node(self, node: Node) -> None: ...

    @abstractmethod
    async def create_edge(self, edge: Edge) -> None: ...

    @abstractmethod
    async def clear_building_data(self, building_id: str) -> None: ...

    # --- Cat 2: Residents & Households ---
    @abstractmethod
    async def create_resident(self, resident: Resident) -> None: ...

    @abstractmethod
    async def get_resident(self, building_id: str, resident_id: str) -> Resident | None: ...

    @abstractmethod
    async def list_residents(self, building_id: str) -> list[Resident]: ...

    @abstractmethod
    async def set_household_profile(self, building_id: str, profile: HouseholdProfile) -> None: ...

    @abstractmethod
    async def get_household_profile(
        self, building_id: str, unit_id: str
    ) -> HouseholdProfile | None: ...

    @abstractmethod
    async def list_household_profiles(self, building_id: str) -> list[HouseholdProfile]: ...

    # --- Cat 3: Presence Context ---
    @abstractmethod
    async def set_presence_context(self, building_id: str, context: PresenceContext) -> None: ...

    @abstractmethod
    async def get_presence_context(
        self, building_id: str, resident_id: str
    ) -> PresenceContext | None: ...

    @abstractmethod
    async def list_presence_contexts(
        self, building_id: str
    ) -> list[PresenceContext]: ...

    # --- Cat 4: Emergency Dynamic States ---
    @abstractmethod
    async def create_emergency(self, emergency: Emergency) -> None: ...

    @abstractmethod
    async def get_emergency(self, building_id: str, emergency_id: str) -> Emergency | None: ...

    @abstractmethod
    async def get_active_emergency(self, building_id: str) -> Emergency | None: ...

    @abstractmethod
    async def close_all_active_emergencies(self, building_id: str) -> None: ...

    @abstractmethod
    async def find_emergency_by_issue(
        self, building_id: str, issue_id: str
    ) -> Emergency | None: ...

    @abstractmethod
    async def update_emergency(self, emergency: Emergency) -> None: ...

    @abstractmethod
    async def set_current_state(
        self, building_id: str, state: ResidentEmergencyCurrentState
    ) -> None: ...

    @abstractmethod
    async def batch_set_current_states(
        self, building_id: str, states: list[ResidentEmergencyCurrentState]
    ) -> None: ...

    @abstractmethod
    async def get_current_state(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> ResidentEmergencyCurrentState | None: ...

    @abstractmethod
    async def list_current_states(
        self, building_id: str, emergency_id: str
    ) -> list[ResidentEmergencyCurrentState]: ...

    @abstractmethod
    async def append_state_event(
        self, building_id: str, event: ResidentEmergencyStateEvent
    ) -> None: ...

    # --- Cat 5: Issue, Task, Coordination, Audit ---
    @abstractmethod
    async def create_issue(self, building_id: str, issue: Issue) -> None: ...

    @abstractmethod
    async def get_issue(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> Issue | None: ...

    @abstractmethod
    async def update_issue(self, building_id: str, issue: Issue) -> None: ...

    @abstractmethod
    async def create_task(self, building_id: str, emergency_id: str, task: Task) -> None: ...

    @abstractmethod
    async def get_task(self, building_id: str, emergency_id: str, task_id: str) -> Task | None: ...

    @abstractmethod
    async def update_task(self, building_id: str, emergency_id: str, task: Task) -> None: ...

    @abstractmethod
    async def list_tasks_by_issue(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> list[Task]: ...

    @abstractmethod
    async def list_tasks_by_resident(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> list[Task]: ...

    @abstractmethod
    async def list_all_tasks(
        self, building_id: str, emergency_id: str
    ) -> list[Task]: ...

    @abstractmethod
    async def append_task_event(
        self, building_id: str, emergency_id: str, event: TaskEvent
    ) -> None: ...

    @abstractmethod
    async def list_task_events(
        self, building_id: str, emergency_id: str, task_id: str
    ) -> list[TaskEvent]: ...

    @abstractmethod
    async def append_audit_event(self, building_id: str, event: AuditEvent) -> None: ...

    @abstractmethod
    async def list_audit_events_for_resident(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> list[AuditEvent]: ...
