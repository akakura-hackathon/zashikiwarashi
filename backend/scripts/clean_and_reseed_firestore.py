"""Clean old/extra data and reseed strict 50-unit SC-3 dataset in Firestore.

Usage:
    uv run python scripts/clean_and_reseed_firestore.py
"""

import asyncio
import os
import sys

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.config import Settings
from src.db.firestore_repo import FirestoreRepository
from src.db.seed import seed_sc3_data


async def main() -> None:
    settings = Settings(environment="production")
    proj = settings.google_cloud_project or "default"
    db_id = settings.firestore_database_id
    print(f"[*] Connecting to Firestore (project={proj}, db={db_id})...")
    repo = FirestoreRepository(settings)

    building_id = "bld-01"

    # 1. Check existing counts
    print(f"[*] Inspecting existing documents for building {building_id}...")
    existing_units = await repo.list_units(building_id)
    existing_residents = await repo.list_residents(building_id)
    print(f"    - Existing units: {len(existing_units)}")
    print(f"    - Existing residents: {len(existing_residents)}")

    # 2. Clean building data
    print(f"[*] Deleting ALL old/extra documents for building {building_id}...")
    await repo.clear_building_data(building_id)

    # Also clean emergencies
    emergencies_col = (
        repo.db.collection("buildings")
        .document(building_id)
        .collection("emergencies")
    )
    emg_docs = [d async for d in emergencies_col.stream()]
    for emg in emg_docs:
        # Delete subcollections if any
        for sub in ["current_states", "state_events", "issues", "tasks", "audit_events"]:
            sub_docs = [d async for d in emg.reference.collection(sub).stream()]
            for s in sub_docs:
                await s.reference.delete()
        await emg.reference.delete()
    print(f"    - Cleared {len(emg_docs)} old emergency records.")

    # 3. Reseed exact 50 units SC-3 data
    print("[*] Reseeding strict 50-unit SC-3 dataset...")
    await seed_sc3_data(repo, building_id=building_id, force_reset=False)

    # 4. Verify post-seed counts
    new_units = await repo.list_units(building_id)
    new_residents = await repo.list_residents(building_id)
    print(f"[+] Post-seed verification for {building_id}:")
    print(f"    - Units count: {len(new_units)} (Expected: 50)")
    print(f"    - Residents count: {len(new_residents)} (Expected: 50)")

    if len(new_units) == 50 and len(new_residents) == 50:
        print("[SUCCESS] Firestore cleaned and reseeded to exactly 50 units!")
    else:
        print(f"[WARNING] Mismatch: units={len(new_units)}, residents={len(new_residents)}")


if __name__ == "__main__":
    asyncio.run(main())
