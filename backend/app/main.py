"""Saintview PACS AI — FastAPI 엔트리포인트."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    admin,
    auth,
    management,
    orders,
    phrases,
    reports,
    settings as settings_api,
    share,
    stt,
    worklist,
)
from app.config import get_settings
from app.db import SessionLocal, init_db
from app.services.auth_service import ensure_default_admin
from app.workers.ai_worker import worker_loop

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("saintview")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.validate_for_prod()  # prod 보안 게이트 (§8)
    init_db()
    with SessionLocal() as db:
        ensure_default_admin(db)
    stop_event = asyncio.Event()
    worker_task = asyncio.create_task(worker_loop(stop_event))
    # MPPS SCP 리스너(장비 수행단계 수신 → 오더 상태) — 포트 충돌 등은 비치명적
    mpps = None
    if settings.mpps_enabled:
        try:
            from app.dicom.mpps_scp import start_mpps_server

            mpps = start_mpps_server(settings.mpps_port, settings.mpps_aet)
        except Exception:  # noqa: BLE001 — 리스너 실패가 앱 기동을 막지 않도록
            logger.exception("MPPS SCP 기동 실패 (포트 %d) — 비활성으로 계속", settings.mpps_port)
    logger.info("Saintview PACS AI 시작 (AI mode=%s)", settings.ai_mode)
    yield
    stop_event.set()
    await worker_task
    if mpps is not None:
        _, server = mpps
        server.shutdown()


app = FastAPI(title="Saintview PACS AI", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],  # Vite dev + 뷰어 별도 포트
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(worklist.router)
app.include_router(reports.router)
app.include_router(admin.router)
app.include_router(management.router)
app.include_router(settings_api.router)
app.include_router(orders.router)
app.include_router(phrases.router)
app.include_router(stt.router)
app.include_router(share.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "ai_mode": get_settings().ai_mode}
