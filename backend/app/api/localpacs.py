"""Local Server 모드 API — /api/local (서버 Orthanc/Postgres 와 분리된 로컬 PACS).

루트 = server.network.local_share_dir. 전 엔드포인트 인증(current_user) 필수,
경로는 local.db 조회로만 해석(루트 이탈 방지). 미설정 시 400 안내.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db import get_db
from app.services import localpacs_service as svc
from app.services.settings_service import get_setting

router = APIRouter(prefix="/api/local", tags=["local"])


def _root(db: Session) -> Path:
    """설정에서 로컬 PACS 루트를 해석 — 미설정이면 400."""
    cfg = get_setting(db, "server.network", default={}) or {}
    try:
        return svc.resolve_root(str(cfg.get("local_share_dir", "") or ""))
    except svc.LocalPacsNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/init")
def local_init(db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """폴더 구조(DB/Image/Temp)+local.db 스키마 생성 — idempotent."""
    return svc.init_dirs(_root(db))


@router.post("/import")
def local_import(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    """multipart files[] → Temp 저장→pydicom 판정(비DICOM 스킵)→Image 배치→local.db 등록."""
    return svc.import_files(_root(db), files)


@router.get("/studies")
def local_studies(q: str = "", db: Session = Depends(get_db), user: dict = Depends(current_user)):
    return svc.list_studies(_root(db), q)


@router.get("/studies/{study_id}/tree")
def local_study_tree(
    study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    tree = svc.study_tree(_root(db), study_id)
    if tree is None:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    return tree


@router.get("/instances/{iid}/rendered")
def local_instance_rendered(
    iid: int,
    wc: float | None = None,
    ww: float | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    """인스턴스 → PNG(8bit W/L, MONOCHROME1 반전·RGB 지원)."""
    path = svc.instance_path(_root(db), iid)
    if path is None:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")
    try:
        png = svc.render_png(path, wc=wc, ww=ww)
    except Exception:  # noqa: BLE001 — 픽셀 미보유·손상 파일 등은 사용자 메시지로
        raise HTTPException(status_code=422, detail="이미지를 렌더링할 수 없습니다")
    return Response(content=png, media_type="image/png")


@router.delete("/studies/{study_id}")
def local_delete_study(
    study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """로컬 검사 삭제(파일+local.db) — 서버 DB에 감사 로그 기록."""
    result = svc.delete_study(_root(db), study_id)
    if result is None:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    from app.models import AuditLog

    db.add(
        AuditLog(
            account_id=user.get("uid"),
            action="local_study_delete",
            target_type="local_study",
            target_id=str(study_id),
            detail={"removed_files": result.get("removed_files", 0), "by": user.get("sub", "")},
        )
    )
    db.commit()
    return result
