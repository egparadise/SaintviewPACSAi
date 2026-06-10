from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db import get_db
from app.models import Report
from app.services.report_service import (
    WorkflowError,
    finalize_report,
    list_reports,
    update_report,
)

router = APIRouter(prefix="/api", tags=["reports"])


def _report_out(r: Report) -> dict:
    return {
        "id": r.id,
        "study_id": r.study_id,
        "version": r.version,
        "status": r.status,
        "sr_json": r.sr_json,
        "narrative_text": r.narrative_text,
        "created_by": r.created_by,
        "reviewed_by": r.reviewed_by,
        "finalized_at": r.finalized_at.isoformat() if r.finalized_at else None,
        "ai_model": r.ai_model,
        "ai_sources": r.ai_sources,
        "diff_metrics": r.diff_metrics,
    }


@router.get("/studies/{study_id}/reports")
def get_reports(study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    return {"items": [_report_out(r) for r in list_reports(db, study_id)]}


class ReportUpdate(BaseModel):
    sr_json: dict


@router.put("/reports/{report_id}")
def put_report(
    report_id: int,
    body: ReportUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    report = db.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    try:
        report = update_report(db, report, body.sr_json, username=user["sub"])
    except WorkflowError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _report_out(report)


@router.post("/reports/{report_id}/finalize")
def finalize(report_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    report = db.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    try:
        report = finalize_report(db, report, username=user["sub"])
    except WorkflowError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _report_out(report)
