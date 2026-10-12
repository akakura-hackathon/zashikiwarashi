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

    gcp_project_id: str = "zashikiwarashi"
    google_cloud_project: str = "zashikiwarashi"
    google_cloud_location: str = "us-central1"
    gemini_api_key: str = ""
    google_genai_use_vertexai: bool = True

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
    import os
    s = Settings()
    if s.google_cloud_project:
        os.environ["GOOGLE_CLOUD_PROJECT"] = s.google_cloud_project
    if s.google_cloud_location:
        os.environ["GOOGLE_CLOUD_LOCATION"] = s.google_cloud_location
    if s.google_genai_use_vertexai:
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
        os.environ["GOOGLE_GENAI_USE_ENTERPRISE"] = "true"
    if s.gemini_api_key:
        os.environ["GEMINI_API_KEY"] = s.gemini_api_key
    return s

