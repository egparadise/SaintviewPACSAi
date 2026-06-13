"""37차 — 가입 흐름: 홈→가입→로그인→병원별 페이지 + 관리자 감독."""
from __future__ import annotations


def _payload(username="newadmin", hosp="성모영상의학과의원"):
    return {
        "hospital": {
            "name": hosp, "address": "서울시 강남구", "departments": "영상의학과,내과",
            "phone": "02-1234-5678", "fax": "02-1234-5679", "homepage": "https://sungmo.example",
            "license_clients": 5, "modality_limit": 3,
        },
        "registrant": {
            "name": "김원장", "title": "원장", "sex": "M", "birth6": "700101",
            "phone": "02-1234-5678", "mobile": "010-1111-2222", "email": "won@example.com",
            "username": username, "password": "signup12345", "password_confirm": "signup12345",
        },
        "billing": {"method": "card", "card_last4": "1234567890"},
    }


def test_signup_creates_hospital_and_admin_then_login(client):
    r = client.post("/api/signup", json=_payload())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] and body["hospital_code"]
    # 가입한 관리자 계정으로 로그인
    lg = client.post("/api/auth/login", json={"username": "newadmin", "password": "signup12345"})
    assert lg.status_code == 200, lg.text
    assert lg.json()["role"] == "admin"


def test_signup_password_mismatch(client):
    p = _payload(username="mismatch1")
    p["registrant"]["password_confirm"] = "different999"
    assert client.post("/api/signup", json=p).status_code == 400


def test_signup_duplicate_username(client):
    client.post("/api/signup", json=_payload(username="dupe1", hosp="A병원"))
    assert client.post("/api/signup", json=_payload(username="dupe1", hosp="B병원")).status_code == 409


def test_signup_card_only_stores_last4(client, db):
    from sqlalchemy import select

    from app.models import Hospital

    r = client.post("/api/signup", json=_payload(username="cardadmin", hosp="카드병원"))
    code = r.json()["hospital_code"]
    h = db.execute(select(Hospital).where(Hospital.code == code)).scalar_one()
    assert h.billing_card_last4 == "7890"  # 마지막 4자리만
    assert len(h.billing_card_last4) <= 4


def test_admin_overview(client, auth_headers):
    client.post("/api/signup", json=_payload(username="ovadmin", hosp="감독병원"))
    r = client.get("/api/admin/overview", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "hospitals" in body and "totals" in body and "server" in body
    assert any(h["name"] == "감독병원" for h in body["hospitals"])
    assert body["server"]["api"] is True
