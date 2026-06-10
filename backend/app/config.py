"""앱 설정 — 환경변수 단일 소스 (CLAUDE.md 절대 규칙 4: 시크릿은 env로만)."""
from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
    # DB (D-1: PostgreSQL+pgvector, 개발 폴백 SQLite)
    database_url: str = os.getenv(
        "SAINTVIEW_DATABASE_URL",
        "sqlite:///./dev.db",
    )
    # 인증
    jwt_secret: str = os.getenv("SAINTVIEW_JWT_SECRET", "dev-only-change-me")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = int(os.getenv("SAINTVIEW_JWT_EXPIRE_MINUTES", "480"))
    # Orthanc (D-3)
    orthanc_url: str = os.getenv("SAINTVIEW_ORTHANC_URL", "http://localhost:8042")
    orthanc_user: str = os.getenv("SAINTVIEW_ORTHANC_USER", "saintview")
    orthanc_password: str = os.getenv("SAINTVIEW_ORTHANC_PASSWORD", "saintview_dev")
    # AI (CLAUDE.md §4)
    ai_model: str = os.getenv("SAINTVIEW_AI_MODEL", "claude-opus-4-8")
    ai_mode: str = os.getenv("SAINTVIEW_AI_MODE", "mock")  # mock | live
    ai_auto_generate: bool = os.getenv("SAINTVIEW_AI_AUTO_GENERATE", "1") == "1"
    # 임베딩 (D-2)
    embedding_backend: str = os.getenv("SAINTVIEW_EMBEDDING_BACKEND", "local")  # local | voyage
    embedding_dim: int = int(os.getenv("SAINTVIEW_EMBEDDING_DIM", "256"))

    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith("postgresql")


@lru_cache
def get_settings() -> Settings:
    return Settings()
