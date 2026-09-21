"""Application settings, read from environment variables (or a local .env file)."""
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET = "change-me-to-a-long-random-string"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+psycopg://vapepos:vapepos@localhost:5432/vapepos"
    secret_key: str = DEFAULT_SECRET
    access_token_expire_minutes: int = 720
    # Comma-separated list of allowed browser origins
    cors_origins: str = "http://localhost:5173"
    # Decides which calendar day a sale belongs to (reports, Z-Report)
    business_timezone: str = "UTC"

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        """Let people paste the URL exactly as Neon/Render give it (postgresql://...)."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
