"""Tests for repository CRUD and SC-3 seed dataset operations."""

import pytest

from src.db.in_memory_repo import InMemoryRepository
from src.db.seed import seed_sc3_data
from src.models.domain import (
    Emergency,
    EmergencyType,
    PresenceState,
    ResidentEmergencyCurrentState,
    SafetyStatus,
)


@pytest.mark.asyncio
async def test_sc3_seeding_and_queries():
    repo = InMemoryRepository()
    await seed_sc3_data(repo, building_id="bld-01")

    # 1. Building Check
    bld = await repo.get_building("bld-01")
    assert bld is not None
    assert bld.floor_count == 5

    # 2. Units Check (5 floors * 10 units = 50)
    units = await repo.list_units("bld-01")
    assert len(units) == 50

    # 3. Personas Check
    res_h = await repo.get_resident("bld-01", "resident-h")
    assert res_h is not None
    profile_h = await repo.get_household_profile("bld-01", res_h.unit_id)
    assert profile_h is not None
    assert profile_h.elderly_count == 1
    assert profile_h.is_priority_support_target is True

    res_i = await repo.get_resident("bld-01", "resident-i")
    assert res_i is not None
    assert res_i.unit_id == "unit-301"

    res_k = await repo.get_resident("bld-01", "resident-k")
    assert res_k is not None
    ctx_k = await repo.get_presence_context("bld-01", "resident-k")
    assert ctx_k is not None
    assert ctx_k.presence_state == PresenceState.OUTSIDE_BUILDING

    # 4. Emergency Dynamic States Test
    em = Emergency(
        emergency_id="em-test-01",
        building_id="bld-01",
        emergency_type=EmergencyType.EARTHQUAKE,
        triggered_by="admin-01",
    )
    await repo.create_emergency(em)
    active_em = await repo.get_active_emergency("bld-01")
    assert active_em is not None
    assert active_em.emergency_id == "em-test-01"

    # Set State
    await repo.set_current_state(
        "bld-01",
        ResidentEmergencyCurrentState(
            emergency_id="em-test-01",
            resident_id="resident-i",
            safety_status=SafetyStatus.SAFE,
        ),
    )
    st = await repo.get_current_state("bld-01", "em-test-01", "resident-i")
    assert st is not None
    assert st.safety_status == SafetyStatus.SAFE
