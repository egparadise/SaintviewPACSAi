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
