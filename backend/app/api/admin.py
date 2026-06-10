from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import admin_user, current_user
from app.db import get_db
from app.models import AiJob, AuditLog

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/ai-jobs")
def ai_jobs(
    status: str = "",
    limit: int = 50,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    q = select(AiJob).order_by(AiJob.id.desc()).limit(limit)
    if status:
        q = q.where(AiJob.status == status)
    jobs = db.execute(q).scalars().all()
    return {
        "items": [
            {
                "id": j.id,
                "study_id": j.study_id,
                "kind": j.kind,
                "status": j.status,
                "error": j.error,
                "latency_sec": j.latency_sec,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
            for j in jobs
        ]
    }


@router.get("/audit")
def audit(limit: int = 100, db: Session = Depends(get_db), user: dict = Depends(admin_user)):
    rows = db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)).scalars().all()
    return {
        "items": [
            {
                "id": a.id,
                "account_id": a.account_id,
                "action": a.action,
                "target_type": a.target_type,
                "target_id": a.target_id,
                "detail": a.detail,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in rows
        ]
    }


@router.post("/sync-orthanc")
def sync_orthanc(since: int = 0, db: Session = Depends(get_db), user: dict = Depends(admin_user)):
    """Orthanc 변경 피드 수동 동기화(운영은 워커 폴링)."""
    from app.dicom.orthanc import OrthancClient, sync_new_studies

    client = OrthancClient()
    if not client.alive():
        return {"ok": False, "detail": "Orthanc에 연결할 수 없습니다"}
    registered, last = sync_new_studies(db, client, since=since)
    client.close()
    return {"ok": True, "registered": registered, "last_seq": last}
