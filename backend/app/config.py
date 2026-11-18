"""Application settings — overridable via environment variables or backend/.env."""
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Upstream APIs
    quran_api_base: str = Field(default="https://api.quran.com/api/v4")
    qdc_api_base: str = Field(default="https://api.qurancdn.com/api/qdc")
    wbw_audio_base: str = Field(default="https://audio.qurancdn.com")
    http_timeout_s: float = Field(default=30.0)

    # Local storage
    cache_dir: Path = Field(default=BACKEND_DIR / "cache")
    frontend_dir: Path = Field(default=PROJECT_DIR / "frontend")
    cache_audio: bool = Field(default=True)

    log_level: str = Field(default="INFO")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
