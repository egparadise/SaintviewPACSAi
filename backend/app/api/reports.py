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


@router.get("/reports/{report_id}/export")
def export_report(
    report_id: int,
    format: str = "pdf",
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    """판독서 출력 (F-9/D-4: PDF 우선). 출력 행위는 감사 로그 기록."""
    from fastapi.responses import Response

    from app.models import AuditLog
    from app.services.pdf_service import render_report_pdf

    report = db.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    if format != "pdf":
        raise HTTPException(status_code=400, detail="지원 형식: pdf (DICOM SR/FHIR는 로드맵 P1/P2)")
    pdf = render_report_pdf(db, report)
    db.add(AuditLog(action="report_export", target_type="report", target_id=str(report_id),
                    detail={"by": user["sub"], "format": format}))
    db.commit()
    filename = f"report_{report.study.accession_no or report.study_id}_v{report.version}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/batch-review")
def batch_review_candidates(
    limit: int = 50, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """F-22: 일괄 검토 대상 — AI 초안(draft) 중 critical 없음."""
    from sqlalchemy import select

    from app.models import Patient, Study
    from app.rag.schemas import has_critical

    rows = db.execute(
        select(Report, Study, Patient)
        .join(Study, Report.study_id == Study.id)
        .join(Patient, Study.patient_id == Patient.id)
        .where(Report.status == "draft", Report.created_by == "ai")
        .order_by(Study.study_date.desc())
        .limit(limit * 2)
    ).all()
    items = []
    for report, study, patient in rows:
        if has_critical(report.sr_json or {}):
            continue  # critical은 개별 검토 강제
        imps = (report.sr_json or {}).get("impression", [])
        items.append({
            "report_id": report.id,
            "study_id": study.id,
            "patient_key": patient.patient_key,
            "patient_name": patient.name_masked,
            "modality": study.modality,
            "study_date": study.study_date,
            "study_desc": study.study_desc,
            "impression": imps[0].get("statement", "") if imps else "",
            "confidence": imps[0].get("confidence", "") if imps else "",
        })
        if len(items) >= limit:
            break
    return {"items": items}


class BatchFinalize(BaseModel):
    report_ids: list[int]


@router.post("/reports/batch-finalize")
def batch_finalize(
    body: BatchFinalize, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """F-22: 일괄 확정. critical 포함 초안은 거부(개별 검토 강제)."""
    from app.rag.schemas import has_critical

    results = []
    for rid in body.report_ids:
        report = db.get(Report, rid)
        if not report:
            results.append({"report_id": rid, "ok": False, "detail": "없음"})
            continue
        if has_critical(report.sr_json or {}):
            results.append({"report_id": rid, "ok": False, "detail": "critical 소견 — 개별 검토 필요"})
            continue
        try:
            finalize_report(db, report, username=user["sub"])
            results.append({"report_id": rid, "ok": True})
        except WorkflowError as e:
            results.append({"report_id": rid, "ok": False, "detail": str(e)})
    ok = sum(1 for r in results if r["ok"])
    return {"finalized": ok, "total": len(results), "results": results}
