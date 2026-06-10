"""AI 작업 큐 워커 — ai_jobs 폴링 방식(단일 프로세스 MVP).

FastAPI lifespan에서 백그라운드 태스크로 구동되며,
독립 실행도 가능: python -m app.workers.ai_worker
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AiJob
from app.services.ai_service import run_draft_job

logger = logging.getLogger("saintview.ai_worker")

POLL_INTERVAL_SEC = 2.0


def process_once() -> int:
    """대기 작업 1배치 처리. 반환: 처리 건수."""
    processed = 0
    with SessionLocal() as db:
        jobs = list(
            db.execute(
                select(AiJob).where(AiJob.status == "queued").order_by(AiJob.id).limit(5)
            ).scalars()
        )
        for job in jobs:
            try:
                run_draft_job(db, job)
                processed += 1
                logger.info("AI 초안 생성 완료 study_id=%s job=%s", job.study_id, job.id)
            except Exception:
                logger.exception("AI 작업 실패 job=%s", job.id)
    return processed


async def worker_loop(stop_event: asyncio.Event) -> None:
    logger.info("AI 워커 시작 (폴링 %.1fs)", POLL_INTERVAL_SEC)
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(process_once)
        except Exception:
            logger.exception("워커 루프 오류")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SEC)
        except asyncio.TimeoutError:
            pass
    logger.info("AI 워커 종료")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(worker_loop(asyncio.Event()))
