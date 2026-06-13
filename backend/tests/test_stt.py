"""38차 — 서버측 STT(Whisper/OpenAI) 동작 고정(엔진 선택·폴백 경계)."""
from __future__ import annotations

from app.services.settings_service import set_setting


def test_stt_browser_engine_rejects_server(client, auth_headers, db):
    set_setting(db, "ai.policy", {"stt_engine": "browser"}, scope="global")
    r = client.post("/api/stt", headers=auth_headers,
                    files={"audio": ("d.webm", b"x" * 16, "audio/webm")})
    assert r.status_code == 400  # 서버 STT 비활성 안내


def test_stt_empty_audio_rejected(client, auth_headers, db):
    set_setting(db, "ai.policy", {"stt_engine": "openai_api"}, scope="global")
    r = client.post("/api/stt", headers=auth_headers,
                    files={"audio": ("d.webm", b"", "audio/webm")})
    assert r.status_code == 400  # 빈 오디오


def test_stt_openai_without_key_returns_501(client, auth_headers, db, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    set_setting(db, "ai.policy", {"stt_engine": "openai_api"}, scope="global")
    r = client.post("/api/stt", headers=auth_headers,
                    files={"audio": ("d.webm", b"x" * 16, "audio/webm")})
    assert r.status_code == 501  # 키 미설정 안내
    set_setting(db, "ai.policy", {"stt_engine": "browser"}, scope="global")  # 복원
