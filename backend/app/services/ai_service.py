"""AI 초안 생성 서비스 — 검색(2축) → 컨텍스트(deid) → 생성 → 저장."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import AiJob, Patient, Report, Study
from app.rag.deid import mask
from app.rag.generate import GenerationInput, generate_draft
from app.rag.retrieval import patient_priors, similar_cases
from app.services.report_service import save_draft_from_ai


def run_draft_job(db: Session, job: AiJob) -> Report:
    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    db.commit()
    try:
        study = db.get(Study, job.study_id)
        report = generate_for_study(db, study)
        job.status = "done"
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        return report
    except Exception as e:
        job.status = "failed"
        job.error = str(e)[:2000]
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        raise


def generate_for_study(db: Session, study: Study) -> Report:
    patient = db.get(Patient, study.patient_id)
    names = [patient.name_masked] if patient and patient.name_masked else []

    priors = patient_priors(db, study)
    query_text = mask(f"{study.study_desc} {study.clinical_info}", patient_names=names).text
    similars = similar_cases(db, study, query_text)

    gi = GenerationInput(
        modality=study.modality,
        body_part=study.body_part,
        study_desc=mask(study.study_desc, patient_names=names).text,
        clinical_info=mask(study.clinical_info, patient_names=names).text,
        priors=priors,
        similars=similars,
    )
    result = generate_draft(gi)
    return save_draft_from_ai(db, study, result.sr_json, model=result.model, sources=result.sources)
