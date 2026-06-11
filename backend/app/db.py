"""SQLAlchemy 엔진·세션. 계층 규칙: repositories만 세션을 직접 사용한다."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    settings = get_settings()
    kwargs = {}
    if settings.database_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(settings.database_url, **kwargs)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _sqlite_sync_columns() -> None:
    """SQLite 개발 DB 한정 — 모델에 새로 추가된 단순 컬럼을 ALTER로 보정.

    create_all은 기존 테이블을 변경하지 않아 모델 진화 시 dev.db가 깨진다
    (운영 Postgres는 Alembic이 담당). NOT NULL은 default와 함께만 추가한다.
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    with engine.connect() as conn:
        for table in Base.metadata.tables.values():
            if table.name not in existing_tables:
                continue  # 새 테이블은 create_all이 만든다
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have or col.primary_key:
                    continue
                ddl = col.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {ddl}'))
        conn.commit()


def init_db() -> None:
    """개발/테스트용 스키마 생성 (운영은 Alembic 마이그레이션)."""
    from app import models  # noqa: F401  모델 등록

    if get_settings().is_postgres:
        with engine.connect() as conn:
            from sqlalchemy import text

            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
    Base.metadata.create_all(engine)
    if not get_settings().is_postgres:
        _sqlite_sync_columns()
