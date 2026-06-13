"""38차 — 로그인→병원선택→자원관리→Client선택→PACS Viewer 흐름 + 테넌시."""
from __future__ import annotations


def _mk_hospital(client, auth_headers, code, name, license_clients=2):
    r = client.post("/api/admin/hospitals", headers=auth_headers,
                    json={"code": code, "name": name, "license_clients": license_clients})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_system_admin_sees_all_hospitals(client, auth_headers):
    _mk_hospital(client, auth_headers, "HFLOW1", "흐름병원1")
    r = client.get("/api/my/hospitals", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["is_admin"] is True
    assert any(h["name"] == "흐름병원1" for h in r.json()["items"])


def test_client_lifecycle_and_enter(client, auth_headers):
    hid = _mk_hospital(client, auth_headers, "HFLOW2", "흐름병원2", license_clients=2)
    # 좌석 생성(라이선스 2석)
    c1 = client.post(f"/api/hospitals/{hid}/clients", headers=auth_headers,
                     json={"name": "판독실-1", "location": "3F"})
    assert c1.status_code == 200, c1.text
    cid = c1.json()["id"]
    assert c1.json()["online"] is False  # 아직 접속 전
    client.post(f"/api/hospitals/{hid}/clients", headers=auth_headers, json={"name": "판독실-2"})
    # 3번째는 라이선스 초과
    over = client.post(f"/api/hospitals/{hid}/clients", headers=auth_headers, json={"name": "초과"})
    assert over.status_code == 409
    # Client 선택 → 진입(접속 기록)
    ent = client.post(f"/api/hospitals/{hid}/clients/{cid}/enter", headers=auth_headers)
    assert ent.status_code == 200 and ent.json()["hospital_id"] == hid
    # 자원관리 — 접속 클라이언트 online 반영
    res = client.get(f"/api/hospitals/{hid}/resources", headers=auth_headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["clients"]["total"] == 2 and body["clients"]["license"] == 2
    assert body["clients"]["online"] == 1
    assert "image" in body and "db" in body and "modalities" in body


def test_hospital_user_tenancy_isolation(client, auth_headers):
    # 두 병원 + 각각 소속 admin
    h1 = _mk_hospital(client, auth_headers, "TEN1", "테넌트1")
    h2 = _mk_hospital(client, auth_headers, "TEN2", "테넌트2")
    client.post("/api/admin/accounts", headers=auth_headers, json={
        "username": "ten1admin", "password": "tenant12345", "role": "admin", "hospital_id": h1,
    })
    tok = client.post("/api/auth/login", json={"username": "ten1admin", "password": "tenant12345"}).json()["token"]
    th = {"Authorization": f"Bearer {tok}"}
    # 자기 병원만 목록에 보임
    mine = client.get("/api/my/hospitals", headers=th).json()
    assert mine["is_admin"] is False
    ids = [h["id"] for h in mine["items"]]
    assert h1 in ids and h2 not in ids
    # 다른 병원 자원 접근 → 403
    assert client.get(f"/api/hospitals/{h2}/resources", headers=th).status_code == 403
    # 자기 병원은 OK
    assert client.get(f"/api/hospitals/{h1}/resources", headers=th).status_code == 200
