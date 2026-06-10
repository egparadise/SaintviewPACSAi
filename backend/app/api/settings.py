from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db import get_db
from app.services.settings_service import get_setting, set_setting

router = APIRouter(prefix="/api/settings", tags=["settings"])

# 노출 허용 키 화이트리스트 (임의 키 남용 방지)
ALLOWED_KEYS = {
    "pdf.template",          # 기관/부서/푸터 (관리자)
    "ai.policy",             # 자동생성·vision 토글 (관리자)
    "worklist.prefs",        # 사용자 기본 필터·자동갱신·컬럼 구성(F-8)
    "viewer.prefs",          # 사용자 뷰어 환경(행잉·오버레이)
    "report.phrases",        # 상용구 사전 (화면분석 §5.6 Predefined Readings)
}


class SettingBody(BaseModel):
    value: dict
    scope: str = "user"  # user | global


@router.get("/{key}")
def read_setting(key: str, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    if key not in ALLOWED_KEYS:
        raise HTTPException(status_code=404, detail="알 수 없는 설정 키")
    value = get_setting(db, key, user=user["sub"], default={})
    return {"key": key, "value": value}


@router.put("/{key}")
def write_setting(
    key: str, body: SettingBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    if key not in ALLOWED_KEYS:
        raise HTTPException(status_code=404, detail="알 수 없는 설정 키")
    if body.scope == "global":
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="전역 설정은 관리자만 변경할 수 있습니다")
        set_setting(db, key, body.value, scope="global")
    elif body.scope == "user":
        set_setting(db, key, body.value, scope="user", scope_id=user["sub"])
    else:
        raise HTTPException(status_code=400, detail="scope는 user|global")
    return {"ok": True, "key": key, "scope": body.scope}
