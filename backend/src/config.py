from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Zashikiwarashi Backend Settings.
    
    環境切り替え（ARCHITECTURE.md §3.1 / §6 に準拠）:
    - environment == "production":
        - Firestore: Google Cloud Firestore (default) を強制使用。
        - 認証: API Gateway 経由の X-Apigateway-Api-Userinfo (Base64 JWT Claims) のみ許可。
    - environment in ("local", "test"):
        - Firestore: FIRESTORE_EMULATOR_HOST が設定されていればエミュレーター、
                     未設定かつ use_in_memory_db=True の場合はインメモリDBにフォールバック。
        - 認証: テスト用モックヘッダー / デフォルトユーザーを許容。
    """
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["production", "local", "test"] = "local"
    port: int = 8080
    cors_allow_origins: list[str] = ["http://localhost:3000"]

    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"

    # Firestore 設定
    firestore_database_id: str = "(default)"
    use_in_memory_db: bool = False  # production では強制的に False 扱い

    # 認証設定
    auth_mode: Literal["production", "mock"] = "mock"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()

