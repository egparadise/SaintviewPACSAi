"""검사(워크리스트) 서비스 — 검색·등록·상태 관리."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import AiJob, Patient, Report, Series, Study


@dataclass
class WorklistFilter:
    patient_query: str = ""       # 통합 검색(ID 또는 이름)
    patient_id: str = ""          # 필드별 검색 (Zetta/PiView 패턴)
    patient_name: str = ""
    sex: str = ""
    study_desc: str = ""
    modality: str = ""
    body_part: str = ""
    status: str = ""
    date_from: str = ""           # YYYYMMDD
    date_to: str = ""
    finding_query: str = ""       # F-2: 소견/임프레션 텍스트 검색
    emergency_only: bool = False
    key_only: bool = False         # 키이미지 등록 검사만 (F-16 — 서치필터 별도 조회)
    hospital_id: int | None = None  # 경량 테넌시 — 소속 병원 검사로 제한(None=전체)
    limit: int = 100
    offset: int = 0


def _op_clause(col, raw: str):
    """07 A.2 검색 연산자: '=K' 정확 / 'K%' 접두 / '!K' 제외 / 기본 포함(%K%)."""
    v = raw.strip()
    if v.startswith("="):
        return col == v[1:]
    if v.startswith("!"):
        return ~col.like(f"%{v[1:]}%")
    if v.endswith("%") and not v.startswith("%"):
        return col.like(v)
    return col.like(f"%{v}%")


def _resolve_hospital_id(db: Session, source_aet: str) -> int | None:
    """수신 AET → 등록 장비(Modality)의 소속 병원. 매칭 없으면 None(전역)."""
    if not source_aet:
        return None
    from app.models import Modality

    m = db.execute(
        select(Modality).where(Modality.ae_title == source_aet.strip().upper())
    ).scalar_one_or_none()
    return m.hospital_id if m else None


def get_or_create_patient(db: Session, patient_key: str, name: str, birth: str, sex: str) -> Patient:
    p = db.execute(select(Patient).where(Patient.patient_key == patient_key)).scalar_one_or_none()
    if p:
        return p
    p = Patient(patient_key=patient_key, name_masked=name, birth_date=birth, sex=sex)
    db.add(p)
    db.flush()
    return p


def register_study(
    db: Session,
    *,
    study_uid: str,
    patient_key: str,
    patient_name: str = "",
    birth_date: str = "",
    sex: str = "",
    accession_no: str = "",
    study_date: str = "",
    study_time: str = "",
    modality: str = "",
    body_part: str = "",
    study_desc: str = "",
    clinical_info: str = "",
    institution: str = "",
    referring_physician: str = "",
    department: str = "",
    source_aet: str = "",
    orthanc_id: str = "",
    series: list[dict] | None = None,
) -> Study:
    """검사 등록(수신 동기화·하네스 공용). 이미 있으면 카운트만 갱신."""
    existing = db.execute(select(Study).where(Study.study_uid == study_uid)).scalar_one_or_none()
    if existing:
        return existing
    patient = get_or_create_patient(db, patient_key, patient_name, birth_date, sex)
    study = Study(
        patient_id=patient.id,
        study_uid=study_uid,
        accession_no=accession_no,
        study_date=study_date,
        study_time=study_time,
        modality=modality,
        body_part=body_part,
        study_desc=study_desc,
        clinical_info=clinical_info,
        institution=institution,
        referring_physician=referring_physician,
        department=department,
        source_aet=source_aet,
        orthanc_id=orthanc_id,
        # 경량 테넌시: 수신 AET → 등록 장비 → 병원으로 자동 귀속
        hospital_id=_resolve_hospital_id(db, source_aet),
        status="received",
    )
    db.add(study)
    db.flush()
    for s in series or []:
        db.add(
            Series(
                study_id=study.id,
                series_uid=s["series_uid"],
                modality=s.get("modality", modality),
                series_desc=s.get("series_desc", ""),
                instance_count=s.get("instance_count", 0),
            )
        )
        study.series_count += 1
        study.instance_count += int(s.get("instance_count", 0))
    db.commit()
    return study


def search_worklist(db: Session, f: WorklistFilter) -> tuple[list[dict], int]:
    q = (
        select(Study, Patient)
        .join(Patient, Study.patient_id == Patient.id)
    )
    if f.patient_query:
        like = f"%{f.patient_query}%"
        q = q.where(or_(Patient.patient_key.like(like), Patient.name_masked.like(like)))
    if f.patient_id:
        q = q.where(_op_clause(Patient.patient_key, f.patient_id))
    if f.patient_name:
        q = q.where(_op_clause(Patient.name_masked, f.patient_name))
    if f.sex:
        q = q.where(Patient.sex == f.sex)
    if f.study_desc:
        q = q.where(_op_clause(Study.study_desc, f.study_desc))
    if f.modality:
        q = q.where(Study.modality == f.modality)
    if f.body_part:
        q = q.where(Study.body_part.like(f"%{f.body_part}%"))
    if f.status:
        if f.status == "unread":
            # S1 '미판독' — 확정 전 전체(received/draft_ready/reading/suspended)
            q = q.where(Study.status != "finalized")
        else:
            q = q.where(Study.status == f.status)
    if f.date_from:
        q = q.where(Study.study_date >= f.date_from)
    if f.date_to:
        q = q.where(Study.study_date <= f.date_to)
    if f.emergency_only:
        q = q.where(Study.emergency.is_(True))
    if f.key_only:
        # key_images JSON 이 비어있지 않은 검사 — PG/SQLite 공통(텍스트 캐스트 비교)
        from sqlalchemy import String, cast

        q = q.where(Study.key_images.isnot(None), cast(Study.key_images, String) != "[]")
    if f.hospital_id is not None:
        q = q.where(Study.hospital_id == f.hospital_id)
    if f.finding_query:
        # F-2: SR 텍스트 검색 — 최신 리포트 narrative 기준 (단순 LIKE, pg에선 추후 FTS)
        sub = select(Report.study_id).where(Report.narrative_text.like(f"%{f.finding_query}%"))
        q = q.where(Study.id.in_(sub))

    total = db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
    # Emergency 최우선 → 검사일 역순 (F-15 / 설계 §6.2)
    q = q.order_by(Study.emergency.desc(), Study.study_date.desc(), Study.id.desc())
    rows = db.execute(q.limit(f.limit).offset(f.offset)).all()

    order_names = _order_names(db, [s.accession_no for s, _ in rows if s.accession_no])
    items = []
    for study, patient in rows:
        latest = _latest_report(db, study.id)
        items.append(_study_row(study, patient, latest,
                                order_name=order_names.get(study.accession_no, "")))
    return items, total


def _order_names(db: Session, accessions: list[str]) -> dict[str, str]:
    """ORDER NAME 컬럼 — accession으로 RIS 오더명 일괄 매칭."""
    if not accessions:
        return {}
    from app.models import Order

    rows = db.execute(
        select(Order.accession_no, Order.procedure_desc).where(Order.accession_no.in_(accessions))
    ).all()
    return {acc: desc for acc, desc in rows if desc}


def _latest_report(db: Session, study_id: int) -> Report | None:
    return db.execute(
        select(Report).where(Report.study_id == study_id).order_by(Report.version.desc()).limit(1)
    ).scalar_one_or_none()


def _study_row(study: Study, patient: Patient, latest: Report | None, *, order_name: str = "") -> dict:
    impression_preview = ""
    has_critical_flag = False
    if latest:
        from app.rag.schemas import has_critical

        imps = (latest.sr_json or {}).get("impression", [])
        if imps:
            impression_preview = imps[0].get("statement", "")[:120]
        has_critical_flag = has_critical(latest.sr_json or {})
    return {
        "id": study.id,
        "study_uid": study.study_uid,
        "patient_key": patient.patient_key,
        "patient_name": patient.name_masked,
        "sex": patient.sex,
        "birth_date": patient.birth_date,
        "accession_no": study.accession_no,
        "study_date": study.study_date,
        "study_time": study.study_time,
        "modality": study.modality,
        "body_part": study.body_part,
        "study_desc": study.study_desc,
        "status": study.status,
        "emergency": study.emergency,
        "has_key": bool(study.key_images),
        "critical": has_critical_flag,
        "series_count": study.series_count,
        "instance_count": study.instance_count,
        "report_status": latest.status if latest else None,
        "impression_preview": impression_preview,
        # DICOM 헤더 기반 확장 컬럼 (UBPACS-Z Filter Setting)
        "institution": study.institution,
        "referring_physician": study.referring_physician,
        "memo": study.memo,
        "finalized_at": (
            latest.finalized_at.isoformat() if latest and latest.finalized_at else ""
        ),
        "department": study.department,
        "source_aet": study.source_aet,
        "bookmark": study.bookmark,
        "order_name": order_name,
    }


def study_detail(db: Session, study_id: int) -> dict | None:
    study = db.get(Study, study_id)
    if not study:
        return None
    patient = db.get(Patient, study.patient_id)
    latest = _latest_report(db, study.id)
    names = _order_names(db, [study.accession_no] if study.accession_no else [])
    row = _study_row(study, patient, latest, order_name=names.get(study.accession_no, ""))
    row["clinical_info"] = study.clinical_info
    row["orthanc_id"] = study.orthanc_id
    row["series"] = [
        {
            "series_uid": s.series_uid,
            "modality": s.modality,
            "series_desc": s.series_desc,
            "instance_count": s.instance_count,
        }
        for s in study.series
        if s.deleted_at is None  # Exam Control 소프트 삭제 제외
    ]
    # F-14 Related Exams: 동일 환자 다른 검사
    related = [
        {
            "id": s.id,
            "study_uid": s.study_uid,
            "study_date": s.study_date,
            "modality": s.modality,
            "study_desc": s.study_desc,
            "status": s.status,
        }
        for s in sorted(patient.studies, key=lambda x: x.study_date, reverse=True)
        if s.id != study.id
    ]
    row["related_exams"] = related
    return row


def queue_ai_job(db: Session, study: Study, kind: str = "draft") -> AiJob:
    job = AiJob(study_id=study.id, kind=kind, status="queued")
    db.add(job)
    db.commit()
    return job
