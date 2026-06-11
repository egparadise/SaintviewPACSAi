"""13차 — 주석 영속화·CTR(S2)·GSPS·외부AI(F-12)·오더/MWL/MPPS 검증."""
from app.db import SessionLocal
from app.services.study_service import queue_ai_job, register_study
from app.workers.ai_worker import process_once


def _make_study(db, uid: str, *, patient: str, modality: str = "CR", draft: bool = False) -> int:
    study = register_study(
        db,
        study_uid=uid,
        patient_key=patient,
        patient_name="테스트",
        study_date="20260611",
        modality=modality,
        body_part="CHEST",
        study_desc="Chest PA",
        clinical_info="검진",
    )
    if draft:
        queue_ai_job(db, study)
    return study.id


# ── 주석 영속화 (07 A.4) ─────────────────────────────────────


def test_annotations_roundtrip(client, auth_headers):
    with SessionLocal() as db:
        sid = _make_study(db, "1.2.840.999.13.1", patient="P1300")
    items = [
        {"series_uid": "s1", "sop_uid": "i1", "kind": "length",
         "points": [[0.1, 0.2], [0.5, 0.2]], "value": 42.5, "unit": "mm"},
        {"series_uid": "s1", "sop_uid": "i1", "kind": "text",
         "points": [[0.3, 0.7]], "text": "참고 병변"},
    ]
    r = client.put(f"/api/studies/{sid}/annotations", headers=auth_headers, json={"items": items})
    assert r.status_code == 200 and r.json()["count"] == 2

    got = client.get(f"/api/studies/{sid}/annotations", headers=auth_headers).json()["items"]
    assert len(got) == 2
    length = next(a for a in got if a["kind"] == "length")
    assert length["value"] == 42.5 and length["unit"] == "mm"
    assert length["source"] == "user"

    # 전체 교체 의미론
    r = client.put(f"/api/studies/{sid}/annotations", headers=auth_headers, json={"items": []})
    assert client.get(f"/api/studies/{sid}/annotations", headers=auth_headers).json()["items"] == []


# ── S2 자동계측 CTR ──────────────────────────────────────────


def test_ctr_mock_verified(client, auth_headers):
    with SessionLocal() as db:
        sid = _make_study(db, "1.2.840.999.13.2", patient="P1301", modality="CR")
    r = client.post(f"/api/studies/{sid}/ctr", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verified"] is True
    assert 0.2 <= body["ctr"] <= 0.95
    assert body["source"] == "mock"
    # AI 계측 주석 2건(cardiac/thoracic) 영속화 + 라벨
    annos = client.get(f"/api/studies/{sid}/annotations", headers=auth_headers).json()["items"]
    ctr_annos = [a for a in annos if a["kind"] == "ctr"]
    assert len(ctr_annos) == 2
    assert all(a["source"] == "ai" and a["verified"] for a in ctr_annos)


def test_ctr_rejects_non_xray(client, auth_headers):
    with SessionLocal() as db:
        sid = _make_study(db, "1.2.840.999.13.3", patient="P1302", modality="MR")
    assert client.post(f"/api/studies/{sid}/ctr", headers=auth_headers).status_code == 409


def test_ctr_numeric_verify():
    from app.rag.ctr import numeric_verify

    ok, _ = numeric_verify({"cardiac": {"x1": 0.3, "x2": 0.7, "y": 0.6},
                            "thoracic": {"x1": 0.1, "x2": 0.9, "y": 0.55}})
    assert ok
    bad, note = numeric_verify({"cardiac": {"x1": 0.7, "x2": 0.3, "y": 0.6},
                                "thoracic": {"x1": 0.1, "x2": 0.9, "y": 0.55}})
    assert not bad and note


# ── GSPS ─────────────────────────────────────────────────────


def test_gsps_build():
    import pydicom

    from app.dicom.gsps import GSPS_SOP_CLASS, build_gsps_dataset, gsps_bytes

    with SessionLocal() as db:
        sid = _make_study(db, "1.2.840.999.13.4", patient="P1303")
        from app.models import Patient, Study

        study = db.get(Study, sid)
        patient = db.get(Patient, study.patient_id)
        ds = build_gsps_dataset(
            study=study, patient=patient,
            images=[{"sop_uid": "i1", "series_uid": "s1", "rows": 512, "cols": 512}],
            annotations=[
                {"sop_uid": "i1", "kind": "length", "points": [[0.1, 0.2], [0.5, 0.2]],
                 "value": 42.5, "unit": "mm"},
                {"sop_uid": "i1", "kind": "ellipse", "points": [[0.2, 0.3], [0.6, 0.5]]},
                {"sop_uid": "i1", "kind": "text", "points": [[0.3, 0.7]], "text": "병변"},
            ],
            wc=40, ww=400, creator="admin",
        )
    assert ds.SOPClassUID == GSPS_SOP_CLASS
    assert ds.Modality == "PR"
    assert ds.StudyInstanceUID == "1.2.840.999.13.4"  # 동일 Study 귀속
    assert len(ds.GraphicAnnotationSequence) == 3
    assert ds.SoftcopyVOILUTSequence[0].WindowWidth == 400.0
    ell = ds.GraphicAnnotationSequence[1].GraphicObjectSequence[0]
    assert ell.GraphicType == "ELLIPSE" and ell.NumberOfGraphicPoints == 4
    # 직렬화 가능 + 재파싱
    import io

    parsed = pydicom.dcmread(io.BytesIO(gsps_bytes(ds)))
    assert parsed.SOPClassUID == GSPS_SOP_CLASS


# ── F-12 외부 AI 결과 병합 ───────────────────────────────────


def test_external_ai_merge(client, auth_headers):
    with SessionLocal() as db:
        sid = _make_study(db, "1.2.840.999.13.5", patient="P1304", draft=True)
    process_once()

    r = client.post(f"/api/studies/{sid}/external-ai", headers=auth_headers, json={
        "vendor": "LunitClone", "model": "cxr-3.0",
        "results": [
            {"label": "Nodule", "observation": "RUL 8mm 결절 의심", "severity": "significant",
             "confidence": 0.91},
        ],
    })
    assert r.status_code == 200, r.text
    sr = r.json()["sr_json"]
    assert any("[외부AI LunitClone]" in f["organ"] for f in sr["findings"])
    assert any("외부 AI" in c for c in sr["ai_meta"]["caveats"])
    assert r.json()["ai_sources"]["external_ai"][0]["vendor"] == "LunitClone"


def test_external_ai_validation_and_critical(client, auth_headers):
    with SessionLocal() as db:
        sid = _make_study(db, "1.2.840.999.13.6", patient="P1305")
    # severity 화이트리스트 위반
    assert client.post(f"/api/studies/{sid}/external-ai", headers=auth_headers, json={
        "vendor": "V", "results": [{"label": "x", "severity": "fatal", "confidence": 0.5}],
    }).status_code == 400
    # confidence 범위 위반
    assert client.post(f"/api/studies/{sid}/external-ai", headers=auth_headers, json={
        "vendor": "V", "results": [{"label": "x", "confidence": 1.5}],
    }).status_code == 400
    # critical → 응급 플래그 + 리포트 없으면 초안 생성
    r = client.post(f"/api/studies/{sid}/external-ai", headers=auth_headers, json={
        "vendor": "V", "results": [{"label": "Pneumothorax", "severity": "critical",
                                    "confidence": 0.95}],
    })
    assert r.status_code == 200 and r.json()["status"] == "draft"
    detail = client.get(f"/api/studies/{sid}", headers=auth_headers).json()
    assert detail["emergency"] is True


# ── 오더 / MWL / MPPS ────────────────────────────────────────


def test_orders_crud_and_mpps_transitions(client, auth_headers):
    r = client.post("/api/orders", headers=auth_headers, json={
        "patient_key": "P1306", "patient_name": "오더환자", "modality": "CT",
        "scheduled_date": "20260612", "procedure_desc": "Chest CT",
    })
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["accession_no"].startswith("SV")  # 자동 채번
    oid = order["id"]

    items = client.get("/api/orders?status=scheduled", headers=auth_headers).json()["items"]
    assert any(o["id"] == oid for o in items)

    # MPPS 전이: scheduled → in_progress → completed
    assert client.put(f"/api/orders/{oid}/status", headers=auth_headers,
                      json={"status": "in_progress"}).status_code == 200
    assert client.put(f"/api/orders/{oid}/status", headers=auth_headers,
                      json={"status": "completed"}).status_code == 200
    # completed 후 전이 불가
    assert client.put(f"/api/orders/{oid}/status", headers=auth_headers,
                      json={"status": "in_progress"}).status_code == 409
    # scheduled → completed 직행 불가
    r2 = client.post("/api/orders", headers=auth_headers, json={"patient_key": "P1307"})
    assert client.put(f"/api/orders/{r2.json()['id']}/status", headers=auth_headers,
                      json={"status": "completed"}).status_code == 409


def test_mwl_export(client, auth_headers, tmp_path):
    import pydicom

    from app.config import get_settings

    client.post("/api/orders", headers=auth_headers, json={
        "patient_key": "P1308", "patient_name": "엠더블유엘", "modality": "CR",
        "scheduled_date": "20260613", "scheduled_time": "0930", "procedure_desc": "Chest PA",
        "station_aet": "CR01",
    })
    get_settings().mwl_dir = str(tmp_path)
    r = client.post("/api/orders/export-mwl", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["count"] >= 1
    files = list(tmp_path.glob("sv*.wl"))
    assert files
    ds = pydicom.dcmread(files[0])
    assert ds.PatientID
    sps = ds.ScheduledProcedureStepSequence[0]
    assert sps.Modality and sps.ScheduledStationAETitle


# ── 번인 OCR 가드 — 폴백 무중단 ─────────────────────────────


def test_image_guard_ocr_fallback():
    import io

    from PIL import Image

    from app.rag.image_guard import mask_burn_in

    img = Image.new("RGB", (200, 200), (120, 120, 120))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    out = mask_burn_in(buf.getvalue())  # pytesseract 유무와 무관하게 동작해야 함
    masked = Image.open(io.BytesIO(out))
    assert masked.getpixel((100, 5)) == (0, 0, 0)      # 상단 스트립
    assert masked.getpixel((100, 195)) == (0, 0, 0)    # 하단 스트립
