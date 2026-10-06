"""Google Cloud Firestore implementation of BaseRepository.

Adheres strictly to the collection path hierarchy specified in docs/DESIGN.md §7.3.1:
  buildings/{building_id}
    units/{unit_id}
    nodes/{node_id}
    edges/{edge_id}
    residents/{resident_id}
    household_profiles/{unit_id}
    presence_contexts/{resident_id}
    emergencies/{emergency_id}
      current_states/{resident_id}
      state_events/{event_id}
      issues/{issue_id}
      tasks/{task_id}
        events/{event_id}
      audit_events/{audit_event_id}
"""

from typing import Any

from google.cloud import firestore

from src.config import Settings
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


class FirestoreRepository(BaseRepository):
    """Production & Firebase Emulator Firestore client."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        project = settings.google_cloud_project or None
        self.db = firestore.AsyncClient(
            project=project,
            database=settings.firestore_database_id,
        )

    def _clean_dict(self, data: dict[str, Any]) -> dict[str, Any]:
        """Convert None or complex types into Firestore-friendly dicts."""
        return {k: v for k, v in data.items() if v is not None}

    # --- Cat 1 ---
    async def create_building(self, building: Building) -> None:
        doc_ref = self.db.collection("buildings").document(building.building_id)
        await doc_ref.set(building.model_dump(mode="json"))

    async def get_building(self, building_id: str) -> Building | None:
        doc = await self.db.collection("buildings").document(building_id).get()
        return Building.model_validate(doc.to_dict()) if doc.exists else None

    async def create_unit(self, unit: Unit) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(unit.building_id)
            .collection("units")
            .document(unit.unit_id)
        )
        await doc_ref.set(unit.model_dump(mode="json"))

    async def get_unit(self, building_id: str, unit_id: str) -> Unit | None:
        doc = (
            await self.db.collection("buildings")
            .document(building_id)
            .collection("units")
            .document(unit_id)
            .get()
        )
        return Unit.model_validate(doc.to_dict()) if doc.exists else None

    async def list_units(self, building_id: str) -> list[Unit]:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("units")
        )
        docs = [d async for d in query.stream()]
        return [Unit.model_validate(d.to_dict()) for d in docs]

    async def create_node(self, node: Node) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(node.building_id)
            .collection("nodes")
            .document(node.node_id)
        )
        await doc_ref.set(node.model_dump(mode="json"))

    async def create_edge(self, edge: Edge) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(edge.building_id)
            .collection("edges")
            .document(edge.edge_id)
        )
        await doc_ref.set(edge.model_dump(mode="json"))

    async def clear_building_data(self, building_id: str) -> None:
        subcollections = [
            "units",
            "nodes",
            "edges",
            "residents",
            "household_profiles",
            "presence_contexts",
        ]
        bld_ref = self.db.collection("buildings").document(building_id)
        for col_name in subcollections:
            col_ref = bld_ref.collection(col_name)
            docs = [d async for d in col_ref.stream()]
            for d in docs:
                await col_ref.document(d.id).delete()

    # --- Cat 2 ---
    async def create_resident(self, resident: Resident) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document("bld-01")  # default building anchor
            .collection("residents")
            .document(resident.resident_id)
        )
        await doc_ref.set(resident.model_dump(mode="json"))

    async def get_resident(self, building_id: str, resident_id: str) -> Resident | None:
        doc = (
            await self.db.collection("buildings")
            .document(building_id)
            .collection("residents")
            .document(resident_id)
            .get()
        )
        return Resident.model_validate(doc.to_dict()) if doc.exists else None

    async def list_residents(self, building_id: str) -> list[Resident]:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("residents")
        )
        docs = [d async for d in query.stream()]
        return [Resident.model_validate(d.to_dict()) for d in docs]

    async def set_household_profile(self, building_id: str, profile: HouseholdProfile) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("household_profiles")
            .document(profile.unit_id)
        )
        await doc_ref.set(profile.model_dump(mode="json"))

    async def get_household_profile(
        self, building_id: str, unit_id: str
    ) -> HouseholdProfile | None:
        doc = (
            await self.db.collection("buildings")
            .document(building_id)
            .collection("household_profiles")
            .document(unit_id)
            .get()
        )
        return HouseholdProfile.model_validate(doc.to_dict()) if doc.exists else None

    async def list_household_profiles(self, building_id: str) -> list[HouseholdProfile]:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("household_profiles")
        )
        docs = [d async for d in query.stream()]
        return [HouseholdProfile.model_validate(d.to_dict()) for d in docs]

    # --- Cat 3 ---
    async def set_presence_context(self, building_id: str, context: PresenceContext) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("presence_contexts")
            .document(context.resident_id)
        )
        await doc_ref.set(context.model_dump(mode="json"))

    async def get_presence_context(
        self, building_id: str, resident_id: str
    ) -> PresenceContext | None:
        doc = (
            await self.db.collection("buildings")
            .document(building_id)
            .collection("presence_contexts")
            .document(resident_id)
            .get()
        )
        return PresenceContext.model_validate(doc.to_dict()) if doc.exists else None

    # --- Cat 4 ---
    async def create_emergency(self, emergency: Emergency) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(emergency.building_id)
            .collection("emergencies")
            .document(emergency.emergency_id)
        )
        await doc_ref.set(emergency.model_dump(mode="json"))

    async def get_emergency(self, building_id: str, emergency_id: str) -> Emergency | None:
        doc = (
            await self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .get()
        )
        return Emergency.model_validate(doc.to_dict()) if doc.exists else None

    async def get_active_emergency(self, building_id: str) -> Emergency | None:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .where(filter=firestore.FieldFilter("status", "==", EmergencyStatus.ACTIVE.value))
        )
        docs = [d async for d in query.stream()]
        if not docs:
            return None
        emergencies = [Emergency.model_validate(d.to_dict()) for d in docs]
        emergencies.sort(key=lambda e: e.triggered_at, reverse=True)
        return emergencies[0]

    async def close_all_active_emergencies(self, building_id: str) -> None:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .where(filter=firestore.FieldFilter("status", "==", EmergencyStatus.ACTIVE.value))
        )
        docs = [d async for d in query.stream()]
        for d in docs:
            em = Emergency.model_validate(d.to_dict())
            em.status = EmergencyStatus.CLOSED
            await self.update_emergency(em)

    async def find_emergency_by_issue(
        self, building_id: str, issue_id: str
    ) -> Emergency | None:
        emergencies_ref = (
            self.db.collection("buildings").document(building_id).collection("emergencies")
        )
        docs = [d async for d in emergencies_ref.stream()]
        for d in docs:
            em_id = d.id
            issue_doc = (
                await emergencies_ref.document(em_id).collection("issues").document(issue_id).get()
            )
            if issue_doc.exists:
                return Emergency.model_validate(d.to_dict())
        return None

    async def update_emergency(self, emergency: Emergency) -> None:
        await self.create_emergency(emergency)

    async def set_current_state(
        self, building_id: str, state: ResidentEmergencyCurrentState
    ) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(state.emergency_id)
            .collection("current_states")
            .document(state.resident_id)
        )
        await doc_ref.set(state.model_dump(mode="json"))

    async def batch_set_current_states(
        self, building_id: str, states: list[ResidentEmergencyCurrentState]
    ) -> None:
        if not states:
            return
        batch = self.db.batch()
        for state in states:
            doc_ref = (
                self.db.collection("buildings")
                .document(building_id)
                .collection("emergencies")
                .document(state.emergency_id)
                .collection("current_states")
                .document(state.resident_id)
            )
            batch.set(doc_ref, state.model_dump(mode="json"))
        await batch.commit()

    async def get_current_state(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> ResidentEmergencyCurrentState | None:
        doc = (
            await self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("current_states")
            .document(resident_id)
            .get()
        )
        return ResidentEmergencyCurrentState.model_validate(doc.to_dict()) if doc.exists else None

    async def list_current_states(
        self, building_id: str, emergency_id: str
    ) -> list[ResidentEmergencyCurrentState]:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("current_states")
        )
        docs = [d async for d in query.stream()]
        return [ResidentEmergencyCurrentState.model_validate(d.to_dict()) for d in docs]

    async def append_state_event(
        self, building_id: str, event: ResidentEmergencyStateEvent
    ) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(event.emergency_id)
            .collection("state_events")
            .document(event.event_id)
        )
        await doc_ref.set(event.model_dump(mode="json"))

    # --- Cat 5 ---
    async def create_issue(self, building_id: str, issue: Issue) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(issue.emergency_id)
            .collection("issues")
            .document(issue.issue_id)
        )
        await doc_ref.set(issue.model_dump(mode="json"))

    async def get_issue(self, building_id: str, emergency_id: str, issue_id: str) -> Issue | None:
        doc = (
            await self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("issues")
            .document(issue_id)
            .get()
        )
        return Issue.model_validate(doc.to_dict()) if doc.exists else None

    async def update_issue(self, building_id: str, issue: Issue) -> None:
        await self.create_issue(building_id, issue)

    async def create_task(self, building_id: str, emergency_id: str, task: Task) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("tasks")
            .document(task.task_id)
        )
        await doc_ref.set(task.model_dump(mode="json"))

    async def get_task(self, building_id: str, emergency_id: str, task_id: str) -> Task | None:
        doc = (
            await self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("tasks")
            .document(task_id)
            .get()
        )
        return Task.model_validate(doc.to_dict()) if doc.exists else None

    async def update_task(self, building_id: str, emergency_id: str, task: Task) -> None:
        await self.create_task(building_id, emergency_id, task)

    async def list_tasks_by_issue(
        self, building_id: str, emergency_id: str, issue_id: str
    ) -> list[Task]:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("tasks")
            .where(filter=firestore.FieldFilter("issue_id", "==", issue_id))
        )
        docs = [d async for d in query.stream()]
        return [Task.model_validate(d.to_dict()) for d in docs]

    async def list_tasks_by_resident(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> list[Task]:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("tasks")
            .where(filter=firestore.FieldFilter("resident_id", "==", resident_id))
        )
        docs = [d async for d in query.stream()]
        return [Task.model_validate(d.to_dict()) for d in docs]

    async def list_all_tasks(
        self, building_id: str, emergency_id: str
    ) -> list[Task]:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("tasks")
        )
        docs = [d async for d in query.stream()]
        return [Task.model_validate(d.to_dict()) for d in docs]

    async def append_task_event(
        self, building_id: str, emergency_id: str, event: TaskEvent
    ) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("tasks")
            .document(event.task_id)
            .collection("events")
            .document(event.event_id)
        )
        await doc_ref.set(event.model_dump(mode="json"))

    async def list_task_events(
        self, building_id: str, emergency_id: str, task_id: str
    ) -> list[TaskEvent]:
        query = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("tasks")
            .document(task_id)
            .collection("events")
        )
        docs = [d async for d in query.stream()]
        return [TaskEvent.model_validate(d.to_dict()) for d in docs]

    async def append_audit_event(self, building_id: str, event: AuditEvent) -> None:
        doc_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(event.emergency_id)
            .collection("audit_events")
            .document(event.audit_event_id)
        )
        await doc_ref.set(event.model_dump(mode="json"))

    async def list_audit_events_for_resident(
        self, building_id: str, emergency_id: str, resident_id: str
    ) -> list[AuditEvent]:
        # Resident is either actor or target
        events_ref = (
            self.db.collection("buildings")
            .document(building_id)
            .collection("emergencies")
            .document(emergency_id)
            .collection("audit_events")
        )
        docs = [d async for d in events_ref.stream()]
        results = []
        for d in docs:
            ev = AuditEvent.model_validate(d.to_dict())
            if ev.actor_id == resident_id or ev.target_id == resident_id:
                results.append(ev)
        return results
