"""CLI script to seed SC-3 data into Firestore (Emulator or Production GCP).

Usage:
    uv run python scripts/seed_sc3.py
"""

import asyncio
import os
import sys

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.db.factory import get_repository
from src.db.seed import seed_sc3_data


async def main() -> None:
    repo = get_repository()
    print(f"[*] Seeding SC-3 dataset using repository: {type(repo).__name__}...")
    await seed_sc3_data(repo, building_id="bld-01")
    print("[+] Successfully seeded SC-3 dataset: 1 Building, 50 Units, Residents H/I/J/K.")


if __name__ == "__main__":
    asyncio.run(main())
