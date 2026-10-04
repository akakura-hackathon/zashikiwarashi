"""Seed data generator for SC-3 (Earthquake Safety Check Distribution Scenario).

Adheres to docs/DESIGN.md §7.3.4:
- 1 Building: 15 floors, 150 units (10 units per floor: x01 - x10).
- Nodes and Edges: Unit entrances, corridors, stairs up/down.
- Specific Residents:
  - H: 302 (Elderly solo: elderly_count=1, mobility_difficulty_count=1)
  - I: 301 (Normal solo helper)
  - J: 303 (Normal neighbor)
  - K: 1204 (Outside building: calendar busy)
  - Other units: Deterministic pseudorandom household profiles (seed 42).
"""

import random
from datetime import UTC, datetime, timedelta

from src.db.base import BaseRepository
from src.models.domain import (
    Building,
    Edge,
    HouseholdProfile,
    MovementType,
    Node,
    NodeType,
    PresenceContext,
    PresenceState,
    Resident,
    SourceType,
    Unit,
)


async def seed_sc3_data(repo: BaseRepository, building_id: str = "bld-01") -> None:
    """Populate repository with deterministic SC-3 seed data."""
    now = datetime.now(UTC)
    expires_24h = now + timedelta(hours=24)

    # 1. Building (E-001)
    building = Building(
        building_id=building_id,
        name="グランドタワー赤倉",
        floor_count=15,
        created_at=now,
    )
    await repo.create_building(building)

    # 2. Nodes & Edges (E-003, E-004)
    # Corridors and Stairs for each floor (1..15)
    for floor in range(1, 16):
        corridor_node = Node(
            node_id=f"node-corridor-{floor}",
            building_id=building_id,
            node_type=NodeType.CORRIDOR,
            floor=floor,
        )
        await repo.create_node(corridor_node)

        stairs_node = Node(
            node_id=f"node-stairs-{floor}",
            building_id=building_id,
            node_type=NodeType.STAIRS,
            floor=floor,
        )
        await repo.create_node(stairs_node)

        # Corridor to stairs edge
        await repo.create_edge(
            Edge(
                edge_id=f"edge-corr-stairs-{floor}",
                building_id=building_id,
                from_node_id=corridor_node.node_id,
                to_node_id=stairs_node.node_id,
                movement_type=MovementType.WALK,
                distance_meters=10.0,
                standard_travel_seconds=15,
            )
        )

        # Stairs up/down to next floor
        if floor < 15:
            next_stairs = f"node-stairs-{floor + 1}"
            await repo.create_edge(
                Edge(
                    edge_id=f"edge-stairs-up-{floor}-{floor+1}",
                    building_id=building_id,
                    from_node_id=stairs_node.node_id,
                    to_node_id=next_stairs,
                    movement_type=MovementType.STAIRS_UP,
                    distance_meters=15.0,
                    standard_travel_seconds=30,
                )
            )
            await repo.create_edge(
                Edge(
                    edge_id=f"edge-stairs-down-{floor+1}-{floor}",
                    building_id=building_id,
                    from_node_id=next_stairs,
                    to_node_id=stairs_node.node_id,
                    movement_type=MovementType.STAIRS_DOWN,
                    distance_meters=15.0,
                    standard_travel_seconds=20,
                )
            )

    # 3. Units, Entrance Nodes, Residents & HouseholdProfiles (E-002, E-005, E-006, E-007)
    rng = random.Random(42)  # Deterministic seed for repeatable demo test runs (NFR-05)

    for floor in range(1, 16):
        for room_idx in range(1, 11):
            room_number = f"{floor}{room_idx:02d}"
            unit_id = f"unit-{room_number}"
            entrance_node_id = f"node-entrance-{room_number}"

            # Entrance Node
            await repo.create_node(
                Node(
                    node_id=entrance_node_id,
                    building_id=building_id,
                    node_type=NodeType.UNIT_ENTRANCE,
                    floor=floor,
                )
            )

            # Edge from corridor to entrance
            await repo.create_edge(
                Edge(
                    edge_id=f"edge-corr-ent-{room_number}",
                    building_id=building_id,
                    from_node_id=f"node-corridor-{floor}",
                    to_node_id=entrance_node_id,
                    movement_type=MovementType.WALK,
                    distance_meters=5.0 + (room_idx * 2.0),
                    standard_travel_seconds=5 + room_idx,
                )
            )

            # Unit
            unit = Unit(
                unit_id=unit_id,
                building_id=building_id,
                entrance_node_id=entrance_node_id,
                room_number=room_number,
                floor=floor,
            )
            await repo.create_unit(unit)

            # Key Persona Mapping
            resident_id = f"res-{room_number}"
            elderly = 0
            mobility = 0
            presence_state = PresenceState.IN_BUILDING
            source_type = SourceType.DEVICE_SIGNAL

            if room_number == "302":
                # Resident H: 高齢単身・足腰不安
                resident_id = "resident-h"
                elderly = 1
                mobility = 1
            elif room_number == "301":
                # Resident I: 健常単身・援助可能者
                resident_id = "resident-i"
            elif room_number == "303":
                # Resident J: 近隣住民
                resident_id = "resident-j"
            elif room_number == "1204":
                # Resident K: 終日カレンダー外出中
                resident_id = "resident-k"
                presence_state = PresenceState.OUTSIDE_BUILDING
                source_type = SourceType.CALENDAR
            else:
                # Random household profile for remaining units
                if rng.random() < 0.15:
                    elderly = 1
                if rng.random() < 0.08:
                    mobility = 1

            # Resident (E-005)
            await repo.create_resident(
                Resident(resident_id=resident_id, unit_id=unit_id, created_at=now)
            )

            # HouseholdProfile (E-006)
            await repo.set_household_profile(
                building_id,
                HouseholdProfile(
                    unit_id=unit_id,
                    member_count=1 if elderly else rng.randint(1, 4),
                    elderly_count=elderly,
                    mobility_difficulty_count=mobility,
                ),
            )

            # PresenceContext (E-007)
            await repo.set_presence_context(
                building_id,
                PresenceContext(
                    resident_id=resident_id,
                    presence_state=presence_state,
                    observed_at=now,
                    expires_at=expires_24h,
                    source_type=source_type,
                ),
            )
