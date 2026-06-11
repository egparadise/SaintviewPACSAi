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
    "mode.profiles",         # 05 제품 모드 프로파일 JSON (S7 — 전역/관리자 전용)
    "worklist.tabs",         # 워크리스트 페이지 탭 (UBPACS-Z 최대 10페이지 패턴)
    "worklist.tree",         # 검색 폴더 트리 (탐색기형 — 조건 누적 병합)
    "dicom.nodes",           # SCP/SCU 장비 노드 목록 (AE Title/IP/Port — 전역/관리자)
}


class SettingBody(BaseModel):
    value: dict
    scope: str = "user"  # user | global


@router.get("/{key}")
def read_setting(key: str, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    if key not in ALLOWED_KEYS:
        raise HTTPException(status_code=404, detail="알 수 없는 설정 키")
    value = get_setting(db, key, user=user["sub"], default={})
    if key == "mode.profiles" and not value:
        from app.services.mode_profiles import DEFAULT_MODE_PROFILES

        value = DEFAULT_MODE_PROFILES
    return {"key": key, "value": value}


@router.put("/{key}")
def write_setting(
    key: str, body: SettingBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    if key not in ALLOWED_KEYS:
        raise HTTPException(status_code=404, detail="알 수 없는 설정 키")
    if key in ("mode.profiles", "dicom.nodes") and body.scope != "global":
        raise HTTPException(status_code=400, detail=f"{key}는 전역(global) 설정만 허용")
    if key == "worklist.tabs" and len(body.value.get("items", [])) > 10:
        raise HTTPException(status_code=400, detail="워크리스트 페이지는 최대 10개입니다 (UBPACS-Z 규격)")
    if body.scope == "global":
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="전역 설정은 관리자만 변경할 수 있습니다")
        set_setting(db, key, body.value, scope="global")
    elif body.scope == "user":
        set_setting(db, key, body.value, scope="user", scope_id=user["sub"])
    else:
        raise HTTPException(status_code=400, detail="scope는 user|global")
    return {"ok": True, "key": key, "scope": body.scope}
