from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "local"
    port: int = 8080
    cors_allow_origins: list[str] = ["http://localhost:3000"]

    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"

    firestore_database_id: str = "(default)"


@lru_cache
def get_settings() -> Settings:
    return Settings()
