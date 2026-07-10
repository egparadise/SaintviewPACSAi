"""app_setting 조회/저장 — scope 오버라이드(user > source > global, 화면분석 §5.7)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting


def get_setting(db: Session, key: str, *, user: str = "", source: str = "", default=None):
    """우선순위: user > source > global."""
    candidates = []
    if user:
        candidates.append(("user", user))
    if source:
        candidates.append(("source", source))
    candidates.append(("global", ""))
    for scope, scope_id in candidates:
        row = db.execute(
            select(AppSetting).where(
                AppSetting.scope == scope,
                AppSetting.scope_id == scope_id,
                AppSetting.key == key,
            )
        ).scalar_one_or_none()
        if row is not None:
            return row.value
    return default


def get_hospital_setting(db: Session, hospital_id: int, key: str, default=None):
    """병원(hospital) 스코프 설정 — 병원별 권한 매트릭스·장비 노드·SCU 등."""
    row = db.execute(
        select(AppSetting).where(
            AppSetting.scope == "hospital",
            AppSetting.scope_id == str(hospital_id),
            AppSetting.key == key,
        )
    ).scalar_one_or_none()
    return row.value if row is not None else default


def set_hospital_setting(db: Session, hospital_id: int, key: str, value: dict) -> None:
    set_setting(db, key, value, scope="hospital", scope_id=str(hospital_id))


def set_setting(db: Session, key: str, value: dict, *, scope: str = "global", scope_id: str = "") -> None:
    row = db.execute(
        select(AppSetting).where(
            AppSetting.scope == scope, AppSetting.scope_id == scope_id, AppSetting.key == key
        )
    ).scalar_one_or_none()
    if row is None:
        db.add(AppSetting(scope=scope, scope_id=scope_id, key=key, value=value))
    else:
        row.value = value
    db.commit()
