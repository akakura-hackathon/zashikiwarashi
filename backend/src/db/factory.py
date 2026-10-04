"""Repository Factory ensuring strict production vs local isolation."""

import os

from src.config import get_settings
from src.db.base import BaseRepository
from src.db.firestore_repo import FirestoreRepository
from src.db.in_memory_repo import InMemoryRepository

# Singleton instance for in-memory testing during local dev
_in_memory_repo_instance: InMemoryRepository | None = None


def get_repository() -> BaseRepository:
    """Resolve repository based on environment and runtime configuration.
    
    Safety Rules:
    1. If environment == "production", ALWAYS return FirestoreRepository.
       In-memory mode is strictly forbidden in production.
    2. If environment in ("local", "test"):
       - Returns InMemoryRepository if USE_IN_MEMORY_DB is True or
         FIRESTORE_EMULATOR_HOST is absent and no GCP credentials are found.
       - Otherwise returns FirestoreRepository (connected to emulator or dev project).
    """
    settings = get_settings()

    if settings.is_production:
        # 本番環境では必ず FirestoreRepository を使用
        return FirestoreRepository(settings)

    # ローカル・テスト環境
    if settings.use_in_memory_db or not os.environ.get("FIRESTORE_EMULATOR_HOST"):
        global _in_memory_repo_instance
        if _in_memory_repo_instance is None:
            _in_memory_repo_instance = InMemoryRepository()
        return _in_memory_repo_instance

    return FirestoreRepository(settings)


def reset_in_memory_repo() -> InMemoryRepository:
    """Reset in-memory repository instance (useful for test isolation)."""
    global _in_memory_repo_instance
    _in_memory_repo_instance = InMemoryRepository()
    return _in_memory_repo_instance
