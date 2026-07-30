"""AI 작업 큐 워커 — ai_jobs 폴링 방식(단일 프로세스 MVP).

FastAPI lifespan에서 백그라운드 태스크로 구동되며,
독립 실행도 가능: python -m app.workers.ai_worker
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AiJob, AppSetting
from app.services.ai_service import run_draft_job

logger = logging.getLogger("saintview.ai_worker")

POLL_INTERVAL_SEC = 2.0
ORTHANC_SYNC_EVERY = 5  # 워커 폴링 N회마다 Orthanc 동기화 (≈10초)
_SYNC_SEQ_KEY = "orthanc.last_change_seq"


def _sync_one_orthanc(seq_key: str, client, label: str) -> int:
    """한 Orthanc 인스턴스의 변경 피드를 1회 동기화. seq 는 인스턴스별로 따로 영속화한다."""
    from app.dicom.orthanc import sync_new_studies

    if not client.alive():
        return 0
    with SessionLocal() as db:
        row = db.execute(
            select(AppSetting).where(AppSetting.scope == "global", AppSetting.key == seq_key)
        ).scalar_one_or_none()
        since = int((row.value or {}).get("seq", 0)) if row else 0
        registered, last = sync_new_studies(db, client, since=since)
        if row is None:
            db.add(AppSetting(scope="global", scope_id="", key=seq_key, value={"seq": last}))
        else:
            row.value = {"seq": last}
        db.commit()
        if registered:
            logger.info("Orthanc 동기화[%s]: 신규 검사 %d건 (seq→%s)", label, registered, last)
        return registered


def sync_orthanc_once() -> int:
    """Orthanc 변경 피드 1회 동기화. last seq는 app_setting에 영속화.

    공용 Orthanc + **병원별 전용 컨테이너**를 모두 폴링한다.
    (전용 컨테이너를 빼면 그쪽으로 수신된 검사가 DB 에 영원히 등록되지 않는다 —
     seq 는 인스턴스마다 별도 키로 관리해야 서로 진행을 덮어쓰지 않는다.)
    Orthanc 미가동이면 0 반환(다음 주기 재시도) — 검사 도착 자동 감지의 본체.
    """
    from app.dicom.orthanc import OrthancClient, client_for_hospital
    from app.models import Hospital

    total = 0
    client = OrthancClient()
    try:
        total += _sync_one_orthanc(_SYNC_SEQ_KEY, client, "공용")
    except Exception:
        logger.exception("Orthanc 동기화 실패(공용)")
    finally:
        client.close()

    # 병원별 전용 컨테이너 — 등록돼 있는 병원만(미등록이면 client_for_hospital 이 공용을 준다)
    try:
        with SessionLocal() as db:
            hids = [h.id for h in db.execute(select(Hospital)).scalars().all()]
        for hid in hids:
            hc = None
            try:
                from app.dicom.orthanc import orthanc_url_for_hospital

                with SessionLocal() as db2:
                    url = orthanc_url_for_hospital(db2, hid)
                if not url:
                    continue          # 전용 컨테이너 없음 = 공용에서 이미 처리됨
                hc = client_for_hospital_url(url)
                total += _sync_one_orthanc(f"{_SYNC_SEQ_KEY}.h{hid}", hc, f"병원{hid}")
            except Exception:
                logger.exception("Orthanc 동기화 실패(병원 %s)", hid)
            finally:
                if hc is not None:
                    hc.close()
    except Exception:
        logger.exception("병원별 Orthanc 목록 조회 실패")
    return total


def client_for_hospital_url(url: str):
    from app.dicom.orthanc import OrthancClient

    return OrthancClient(base_url=url)


def process_once() -> int:
    """대기 작업 1배치 처리. 반환: 처리 건수."""
    processed = 0
    with SessionLocal() as db:
        jobs = list(
            db.execute(
                select(AiJob).where(AiJob.status == "queued").order_by(AiJob.id).limit(20)
            ).scalars()
        )
        # AI 판독 보류 스위치 — 보류 중이면 생성하지 않고 대기 잡을 드레인(skipped)한다
        # (보류 이전에 쌓인 잡·경합으로 새어 들어온 잡이 활성화 시점에 한꺼번에 실행되는 것 방지)
        from app.services.settings_service import ai_draft_enabled

        if jobs and not ai_draft_enabled(db):
            for job in jobs:
                job.status = "skipped"
                job.error = "AI 판독 보류 중(ai.policy.draft_enabled=off) — 생성하지 않음"
            db.commit()
            logger.info("AI 판독 보류 — 대기 작업 %d건 skipped", len(jobs))
            return 0
        for job in jobs:
            try:
                run_draft_job(db, job)
                processed += 1
                logger.info("AI 초안 생성 완료 study_id=%s job=%s", job.study_id, job.id)
            except Exception:
                logger.exception("AI 작업 실패 job=%s", job.id)
    return processed


def scheduled_backup_once() -> None:
    """스케줄 백업 점검 — 정책 예정 시각 도달 시 1회 실행(저장공간/백업 2단계)."""
    from app.services.backup_service import maybe_run_scheduled_backup

    with SessionLocal() as db:
        try:
            job = maybe_run_scheduled_backup(db)
            if job is not None:
                logger.info("스케줄 백업 실행 job=%s status=%s (%d검사/%d인스턴스)",
                            job.id, job.status, job.study_count, job.instance_count)
        except Exception:
            logger.exception("스케줄 백업 점검 오류")


async def worker_loop(stop_event: asyncio.Event) -> None:
    logger.info("AI 워커 시작 (폴링 %.1fs, Orthanc 동기화 %d주기)", POLL_INTERVAL_SEC, ORTHANC_SYNC_EVERY)
    tick = 0
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(process_once)
            if tick % ORTHANC_SYNC_EVERY == 0:
                await asyncio.to_thread(sync_orthanc_once)
                await asyncio.to_thread(scheduled_backup_once)
        except Exception:
            logger.exception("워커 루프 오류")
        tick += 1
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SEC)
        except asyncio.TimeoutError:
            pass
    logger.info("AI 워커 종료")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(worker_loop(asyncio.Event()))
