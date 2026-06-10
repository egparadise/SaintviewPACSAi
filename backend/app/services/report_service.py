"""리포트 워크플로 — draft → in_review → finalized (버전 보존, F-17/F-20)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, Report, Study
from app.rag.retrieval import ingest_report
from app.rag.schemas import has_critical, narrative_from_sr


class WorkflowError(Exception):
    pass


def list_reports(db: Session, study_id: int) -> list[Report]:
    return list(
        db.execute(
            select(Report).where(Report.study_id == study_id).order_by(Report.version.desc())
        ).scalars()
    )


def latest_report(db: Session, study_id: int) -> Report | None:
    rows = list_reports(db, study_id)
    return rows[0] if rows else None


def save_draft_from_ai(db: Session, study: Study, sr_json: dict, *, model: str, sources: dict) -> Report:
    version = (latest_report(db, study.id).version + 1) if latest_report(db, study.id) else 1
    report = Report(
        study_id=study.id,
        version=version,
        status="draft",
        sr_json=sr_json,
        narrative_text=narrative_from_sr(sr_json),
        created_by="ai",
        ai_model=model,
        ai_sources=sources,
    )
    db.add(report)
    study.status = "draft_ready"
    if has_critical(sr_json):
        study.emergency = True  # critical → 워크리스트 최우선(설계 §6.2)
    db.commit()
    return report


def update_report(db: Session, report: Report, sr_json: dict, *, username: str) -> Report:
    """판독의 수정 — 확정본은 수정 불가, 새 버전을 만든다."""
    if report.status == "finalized":
        raise WorkflowError("확정된 판독은 수정할 수 없습니다. 새 버전(addendum)을 생성하세요.")
    report.sr_json = sr_json
    report.narrative_text = narrative_from_sr(sr_json)
    report.status = "in_review"
    report.reviewed_by = username
    report.study.status = "reading"
    db.add(
        AuditLog(
            action="report_update",
            target_type="report",
            target_id=str(report.id),
            detail={"by": username, "version": report.version},
        )
    )
    db.commit()
    return report


def finalize_report(db: Session, report: Report, *, username: str) -> Report:
    """확정: 버전 보존 + 환류 인제스트(설계 §4.1) + 불일치 지표(F-20)."""
    if report.status == "finalized":
        raise WorkflowError("이미 확정된 판독입니다.")
    report.status = "finalized"
    report.reviewed_by = username
    report.finalized_at = datetime.now(timezone.utc)
    report.diff_metrics = _diff_against_ai_draft(db, report)
    report.study.status = "finalized"
    chunks = ingest_report(db, report)  # 환류: 확정본 → RAG 인덱스
    db.add(
        AuditLog(
            action="report_finalize",
            target_type="report",
            target_id=str(report.id),
            detail={"by": username, "version": report.version, "ingested_chunks": chunks},
        )
    )
    db.commit()
    return report


def _diff_against_ai_draft(db: Session, final: Report) -> dict:
    """F-20: AI 초안(v1, created_by='ai') 대비 확정본 차이 지표."""
    draft = db.execute(
        select(Report)
        .where(Report.study_id == final.study_id, Report.created_by == "ai")
        .order_by(Report.version.asc())
        .limit(1)
    ).scalar_one_or_none()
    if not draft or draft.id == final.id and final.created_by == "ai":
        base = draft.narrative_text if draft else ""
    else:
        base = draft.narrative_text
    if not draft:
        return {"has_ai_draft": False}

    import difflib

    ratio = difflib.SequenceMatcher(None, base, final.narrative_text).ratio()
    draft_critical = has_critical(draft.sr_json or {})
    final_critical = has_critical(final.sr_json or {})
    return {
        "has_ai_draft": True,
        "draft_report_id": draft.id,
        "similarity": round(ratio, 4),
        "modified_ratio": round(1 - ratio, 4),
        # critical 소견 탈락/추가 — 리뷰 알림 대상(F-20)
        "critical_dropped": draft_critical and not final_critical,
        "critical_added": final_critical and not draft_critical,
        "accepted_unmodified": ratio > 0.98,
    }
