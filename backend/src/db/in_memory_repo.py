"""In-memory implementation of BaseRepository for local testing and offline verification."""

from src.db.base import BaseRepository
from src.models.domain import (
    AuditEvent,
    Building,
    Edge,
    Emergency,
    EmergencyStatus,
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


class InMemoryRepository(BaseRepository):
    """Stores all entities in memory dictionaries, keyed matching Firestore path hierarchy."""

    def __init__(self) -> None:
        self.buildings: dict[str, Building] = {}
        self.units: dict[str, dict[str, Unit]] = {}
        self.nodes: dict[str, dict[str, Node]] = {}
        self.edges: dict[str, dict[str, Edge]] = {}
        self.residents: dict[str, dict[str, Resident]] = {}
        self.household_profiles: dict[str, dict[str, HouseholdProfile]] = {}
        self.presence_contexts: dict[str, dict[str, PresenceContext]] = {}
        self.emergencies: dict[str, dict[str, Emergency]] = {}
        self.current_states: dict[str, dict[str, ResidentEmergencyCurrentState]] = {}
        self.state_events: list[ResidentEmergencyStateEvent] = []
        self.issues: dict[str, dict[str, Issue]] = {}
        self.tasks: dict[str, dict[str, Task]] = {}
        self.task_events: dict[str, list[TaskEvent]] = {}
        self.audit_events: dict[str, list[AuditEvent]] = {}

    # --- Cat 1 ---
    async def create_building(self, building: Building) -> None:
        self.buildings[building.building_id] = building
        self.units.setdefault(building.building_id, {})
        self.nodes.setdefault(building.building_id, {})
        self.edges.setdefault(building.building_id, {})
        self.residents.setdefault(building.building_id, {})
        self.household_profiles.setdefault(building.building_id, {})
        self.presence_contexts.setdefault(building.building_id, {})
        self.emergencies.setdefault(building.building_id, {})

    async def get_building(self, building_id: str) -> Building | None:
        return self.buildings.get(building_id)

    async def create_unit(self, unit: Unit) -> None:
        self.units.setdefault(unit.building_id, {})[unit.unit_id] = unit

    async def get_unit(self, building_id: str, unit_id: str) -> Unit | None:
        return self.units.get(building_id, {}).get(unit_id)

    async def list_units(self, building_id: str) -> list[Unit]:
        return list(self.units.get(building_id, {}).values())

    async def create_node(self, node: Node) -> None:
        self.nodes.setdefault(node.building_id, {})[node.node_id] = node

    async def create_edge(self, edge: Edge) -> None:
        self.edges.setdefault(edge.building_id, {})[edge.edge_id] = edge

    async def clear_building_data(self, building_id: str) -> None:
        self.units.pop(building_id, None)
        self.nodes.pop(building_id, None)
        self.edges.pop(building_id, None)
        self.residents.pop(building_id, None)
        self.household_profiles.pop(building_id, None)
        self.presence_contexts.pop(building_id, None)

    # --- Cat 2 ---
    async def create_resident(self, resident: Resident) -> None:
        target_bld = "bld-01"
        for b_id, units in self.units.items():
            if resident.unit_id in units:
                target_bld = b_id
                break
        self.residents.setdefault(target_bld, {})[resident.resident_id] = resident

    async def get_resident(self, building_id: str, resident_id: str) -> Resident | None:
        return self.residents.get(building_id, {}).get(resident_id)

    async def list_residents(self, building_id: str) -> list[Resident]:
        return list(self.residents.get(building_id, {}).values())

    async def set_household_profile(self, building_id: str, profile: HouseholdProfile) -> None:
        self.household_profiles.setdefault(building_id, {})[profile.unit_id] = profile

    async def get_household_profile(
        self, building_id: str, unit_id: str
    ) -> HouseholdProfile | None:
        return self.household_profiles.get(building_id, {}).get(unit_id)

    async def list_household_profiles(self, building_id: str) -> list[HouseholdProfile]:
        return list(self.household_profiles.get(building_id, {}).values())

    # --- Cat 3 ---
    async def set_presence_context(self, building_id: str, context: PresenceContext) -> None:
        self.presence_contexts.setdefault(building_id, {})[context.resident_id] = context

    async def get_presence_context(
        self, building_id: str, resident_id: str
    ) -> PresenceContext | None:
        return self.presence_contexts.get(building_id, {}).get(resident_id)

    async def list_presence_contexts(self, building_id: str) -> list[PresenceContext]:
        return list(self.presence_contexts.get(building_id, {}).values())

    # --- Cat 4 ---
    async def create_emergency(self, emergency: Emergency) -> None:
        self.emergencies.setdefault(emergency.building_id, {})[emergency.emergency_id] = emergency

    async def get_emergency(self, building_id: str, emergency_id: str) -> Emergency | None:
        return self.emergencies.get(building_id, {}).get(emergency_id)

    async def get_active_emergency(self, building_id: str) -> Emergency | None:
        active_list = [
            em for em in self.emergencies.get(building_id, {}).values()
            if em.status == EmergencyStatus.ACTIVE
        ]
        if not active_list:
            return None
        active_list.sort(key=lambda e: e.triggered_at, reverse=True)
        return active_list[0]

    async def close_all_active_emergencies(self, building_id: str) -> None:
        for em in self.emergencies.get(building_id, {}).values():
            if em.status == EmergencyStatus.ACTIVE:
                em.status = EmergencyStatus.CLOSED

    async def find_emergency_by_issue(
        self, building_id: str, issue_id: str
    ) -> Emergency | None:
        for em_id, issue_map in self.issues.items():
            if issue_id in issue_map:
                return self.emergencies.get(building_id, {}).get(em_id)
        return None

    async def update_emergency(self, emergency: Emergency) -> None:
        self.emergencies.setdefault(emergency.building_id, {})[emergency.emergency_id] = emergency

    async def set_current_state(
        self, building_id: str, state: ResidentEmergencyCurrentState
    ) -> None:
        key = f"{building_id}:{state.emergency_id}"
        self.current_states.setdefault(key, {})[state.resident_id] = state

    async def batch_set_current_states(
        self, building_id: str, states: list[ResidentEmergencyCurrentState]
    ) -> None:
        for state in states:
            key = f"{building_id}:{state.emergency_id}"
            self.current_states.setdefault(key, {})[state.resident_id] = state

    async def get_current_state(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> ResidentEmergencyCurrentState | None:
        key = f"{building_id}:{emergency_id}"
        return self.current_states.get(key, {}).get(resident_id)

    async def list_current_states(
        self, building_id: str, emergency_id: str
    ) -> list[ResidentEmergencyCurrentState]:
        key = f"{building_id}:{emergency_id}"
        return list(self.current_states.get(key, {}).values())

    async def append_state_event(
        self, building_id: str, event: ResidentEmergencyStateEvent
    ) -> None:
        self.state_events.append(event)

    # --- Cat 5 ---
    async def create_issue(self, building_id: str, issue: Issue) -> None:
        self.issues.setdefault(issue.emergency_id, {})[issue.issue_id] = issue

    async def get_issue(self, building_id: str, emergency_id: str, issue_id: str) -> Issue | None:
        return self.issues.get(emergency_id, {}).get(issue_id)

    async def list_issues(self, building_id: str, emergency_id: str) -> list[Issue]:
        return list(self.issues.get(emergency_id, {}).values())

    async def update_issue(self, building_id: str, issue: Issue) -> None:
        self.issues.setdefault(issue.emergency_id, {})[issue.issue_id] = issue

    async def create_task(self, building_id: str, emergency_id: str, task: Task) -> None:
        self.tasks.setdefault(emergency_id, {})[task.task_id] = task

    async def get_task(self, building_id: str, emergency_id: str, task_id: str) -> Task | None:
        return self.tasks.get(emergency_id, {}).get(task_id)

    async def update_task(self, building_id: str, emergency_id: str, task: Task) -> None:
        self.tasks.setdefault(emergency_id, {})[task.task_id] = task

    async def list_tasks_by_issue(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> list[Task]:
        return [
            t for t in self.tasks.get(emergency_id, {}).values() if t.issue_id == issue_id
        ]

    async def list_tasks_by_resident(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> list[Task]:
        return [
            t for t in self.tasks.get(emergency_id, {}).values() if t.resident_id == resident_id
        ]

    async def list_all_tasks(
        self, building_id: str, emergency_id: str
    ) -> list[Task]:
        return list(self.tasks.get(emergency_id, {}).values())

    async def append_task_event(
        self, building_id: str, emergency_id: str, event: TaskEvent
    ) -> None:
        self.task_events.setdefault(event.task_id, []).append(event)

    async def list_task_events(
        self, building_id: str, emergency_id: str, task_id: str
    ) -> list[TaskEvent]:
        return list(self.task_events.get(task_id, []))

    async def append_audit_event(self, building_id: str, event: AuditEvent) -> None:
        self.audit_events.setdefault(event.emergency_id, []).append(event)

    async def list_audit_events_for_resident(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> list[AuditEvent]:
        events = self.audit_events.get(emergency_id, [])
        return [
            e for e in events if e.actor_id == resident_id or e.target_id == resident_id
        ]
