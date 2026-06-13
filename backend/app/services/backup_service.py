"""백업/저장공간 서비스 — 설정 기간 데이터 백업 + 압축(JPEG/JPEG2000 등) + 보존 정책.

실동작: Orthanc에서 인스턴스를 받아 지정 전송구문으로 트랜스코드해 백업 디렉토리에 기록.
폴백: 압축 코덱 플러그인이 없으면 원본(비압축)으로 저장하고 fallback 카운트를 남긴다.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import BackupJob, Study
from app.services.settings_service import get_setting, set_setting

# 압축 포맷 → DICOM 전송구문 UID (백업 시 적용)
TRANSFER_SYNTAX: dict[str, str] = {
    "none": "1.2.840.10008.1.2.1",            # Explicit VR Little Endian (비압축)
    "jpeg2000_lossless": "1.2.840.10008.1.2.4.90",
    "jpeg2000": "1.2.840.10008.1.2.4.91",     # 손실
    "jpeg_lossless": "1.2.840.10008.1.2.4.70",
    "jpeg": "1.2.840.10008.1.2.4.50",         # JPEG Baseline (손실)
}
COMPRESSION_LABELS: dict[str, str] = {
    "none": "비압축 DICOM",
    "jpeg2000_lossless": "JPEG2000 무손실",
    "jpeg2000": "JPEG2000 (손실)",
    "jpeg_lossless": "JPEG 무손실",
    "jpeg": "JPEG (손실)",
}

BACKUP_POLICY_KEY = "backup.policy"
DEFAULT_POLICY = {
    "enabled": False,
    "schedule_time": "02:00",     # 매일 HH:MM (스케줄 백업)
    "retention_days": 0,          # 0=무제한(보존 정책 미적용)
    "compression": "none",
    "target_dir": "",             # 비우면 backend/backup
}


def _safe(name: str) -> str:
    """경로 구성요소 안전화 — traversal·구분자 제거."""
    s = re.sub(r"[^A-Za-z0-9._-]", "_", str(name or "").strip())
    return (s or "unknown")[:96]


def get_policy(db: Session) -> dict:
    return {**DEFAULT_POLICY, **(get_setting(db, BACKUP_POLICY_KEY, default={}) or {})}


def set_policy(db: Session, policy: dict) -> dict:
    cur = get_policy(db)
    merged = {**cur, **{k: policy[k] for k in DEFAULT_POLICY if k in policy}}
    # 검증
    if merged["compression"] not in TRANSFER_SYNTAX:
        merged["compression"] = "none"
    if not re.match(r"^\d{1,2}:\d{2}$", str(merged["schedule_time"])):
        merged["schedule_time"] = "02:00"
    merged["retention_days"] = max(0, int(merged.get("retention_days") or 0))
    set_setting(db, BACKUP_POLICY_KEY, merged, scope="global")
    return merged


def _default_backup_dir() -> Path:
    # backend/app/services/backup_service.py → parents[2] = backend
    return Path(__file__).resolve().parents[2] / "backup"


def resolve_target(target_dir: str) -> Path:
    return Path(target_dir).expanduser() if target_dir.strip() else _default_backup_dir()


def _studies_in_range(db: Session, date_from: str, date_to: str) -> list[Study]:
    q = select(Study).where(Study.orthanc_id != "")
    if date_from:
        q = q.where(Study.study_date >= date_from)
    if date_to:
        q = q.where(Study.study_date <= date_to)
    return list(db.execute(q.order_by(Study.study_date)).scalars().all())


def run_backup_job(db: Session, job_id: int, *, client=None) -> BackupJob:
    """백업 작업 실행 — 인스턴스별 트랜스코드 후 디렉토리에 기록. job 상태/통계 갱신."""
    from app.dicom.orthanc import OrthancClient

    job = db.get(BackupJob, job_id)
    if job is None:
        raise ValueError(f"BackupJob {job_id} 없음")
    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    db.commit()

    own_client = client is None
    client = client or OrthancClient()
    ts_uid = TRANSFER_SYNTAX.get(job.compression, TRANSFER_SYNTAX["none"])
    root = resolve_target(job.target_dir)
    fallbacks = 0
    try:
        if not client.alive():
            raise RuntimeError("Orthanc에 연결할 수 없습니다")
        studies = _studies_in_range(db, job.date_from, job.date_to)
        total_bytes = 0
        inst_count = 0
        done_studies = 0
        for study in studies:
            try:
                instances = client.study_instances(study.orthanc_id)
            except httpx.HTTPError:
                continue
            sdir = root / _safe(study.study_date or "nodate") / _safe(study.study_uid)
            sdir.mkdir(parents=True, exist_ok=True)
            for inst in instances:
                oid = inst["orthanc_id"]
                try:
                    data = client.instance_file(oid, transcode=ts_uid if job.compression != "none" else None)
                except httpx.HTTPError:
                    # 트랜스코드 실패 → 원본으로 폴백
                    try:
                        data = client.instance_file(oid)
                        fallbacks += 1
                    except httpx.HTTPError:
                        continue
                fname = f"{_safe(inst.get('sop_uid') or oid)}.dcm"
                (sdir / fname).write_bytes(data)
                total_bytes += len(data)
                inst_count += 1
            done_studies += 1
        job.study_count = done_studies
        job.instance_count = inst_count
        job.total_bytes = total_bytes
        job.status = "done"
        if fallbacks:
            job.error = f"압축 폴백(원본 저장) {fallbacks}건 — Orthanc 코덱 플러그인 확인"
    except Exception as e:  # noqa: BLE001 — 작업 결과로 기록
        job.status = "failed"
        job.error = str(e)[:500]
    finally:
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        if own_client:
            client.close()
    return job


def storage_overview(db: Session) -> dict:
    """저장공간 현황 — Orthanc 디스크 사용량 + DB 카운트 + 백업 대상 디스크 여유 + 보존 후보."""
    import shutil

    from app.dicom.orthanc import OrthancClient

    policy = get_policy(db)
    out: dict = {"policy": policy, "orthanc": None}
    out["db"] = {
        "studies": db.execute(select(func.count()).select_from(Study)).scalar() or 0,
    }
    # Orthanc 통계
    client = OrthancClient()
    try:
        if client.alive():
            st = client.statistics()
            out["orthanc"] = {
                "alive": True,
                "studies": st.get("CountStudies"),
                "series": st.get("CountSeries"),
                "instances": st.get("CountInstances"),
                "disk_size": int(st.get("TotalDiskSize", 0) or 0),
                "uncompressed_size": int(st.get("TotalUncompressedSize", 0) or 0),
            }
        else:
            out["orthanc"] = {"alive": False}
    except httpx.HTTPError as e:
        out["orthanc"] = {"alive": False, "error": str(e)[:200]}
    finally:
        client.close()
    # 백업 대상 디스크 여유
    target = resolve_target(policy.get("target_dir", ""))
    try:
        check = target if target.exists() else target.parent
        usage = shutil.disk_usage(check)
        out["disk"] = {"path": str(target), "total": usage.total,
                       "used": usage.used, "free": usage.free}
    except OSError as e:
        out["disk"] = {"path": str(target), "error": str(e)[:200]}
    # 보존 정책 후보(설정 기간 초과 검사)
    rd = int(policy.get("retention_days") or 0)
    if rd > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=rd)).strftime("%Y%m%d")
        out["retention"] = {
            "cutoff_date": cutoff, "retention_days": rd,
            "candidate_studies": db.execute(
                select(func.count()).select_from(Study).where(
                    Study.study_date != "", Study.study_date < cutoff
                )
            ).scalar() or 0,
        }
    else:
        out["retention"] = {"retention_days": 0, "candidate_studies": 0}
    return out


LAST_SCHEDULED_KEY = "backup.last_scheduled"


def maybe_run_scheduled_backup(db: Session, *, now: datetime | None = None, client=None) -> BackupJob | None:
    """스케줄 백업 — 정책이 enabled이고 예정 시각(로컬 HH:MM)을 지났고 오늘 미실행이면 1회 실행."""
    policy = get_policy(db)
    if not policy.get("enabled"):
        return None
    now = now or datetime.now()  # 로컬 벽시계 기준(스케줄 시각도 로컬)
    today = now.strftime("%Y%m%d")
    last = (get_setting(db, LAST_SCHEDULED_KEY, default={}) or {}).get("date", "")
    if last == today:
        return None
    try:
        hh, mm = str(policy["schedule_time"]).split(":")
        sched_minutes = int(hh) * 60 + int(mm)
    except (ValueError, KeyError):
        return None
    if now.hour * 60 + now.minute < sched_minutes:
        return None  # 예정 시각 전
    set_setting(db, LAST_SCHEDULED_KEY, {"date": today}, scope="global")
    job = BackupJob(
        kind="scheduled", status="queued", compression=policy.get("compression", "none"),
        target_dir=policy.get("target_dir", ""), date_from="", date_to="",
    )
    db.add(job)
    db.commit()
    run_backup_job(db, job.id, client=client)
    return job


def retention_candidates(db: Session, retention_days: int) -> list[Study]:
    if retention_days <= 0:
        return []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).strftime("%Y%m%d")
    return list(db.execute(
        select(Study).where(Study.study_date != "", Study.study_date < cutoff)
    ).scalars().all())
