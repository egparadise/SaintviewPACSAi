from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db import get_db
from app.models import Study
from app.services.study_service import (
    WorklistFilter,
    queue_ai_job,
    search_worklist,
    study_detail,
)

router = APIRouter(prefix="/api", tags=["worklist"])


@router.get("/worklist")
def worklist(
    q: str = Query("", description="통합 검색(환자 ID/이름)"),
    pid: str = Query("", description="환자 ID (필드별)"),
    pname: str = Query("", description="환자 이름 (필드별)"),
    sex: str = "",
    desc: str = Query("", description="검사명 (Study Description)"),
    modality: str = "",
    body_part: str = "",
    status: str = "",
    date_from: str = "",
    date_to: str = "",
    finding: str = Query("", description="소견/임프레션 텍스트 검색 (F-2)"),
    emergency: bool = False,
    key: bool = Query(False, description="키이미지 등록 검사만 (F-16)"),
    hospital_id: int = Query(0, description="선택한 병원으로 스코프(0=자동)"),
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    items, total = search_worklist(
        db,
        WorklistFilter(
            patient_query=q,
            patient_id=pid,
            patient_name=pname,
            sex=sex,
            study_desc=desc,
            modality=modality,
            body_part=body_part,
            status=status,
            date_from=date_from,
            date_to=date_to,
            finding_query=finding,
            emergency_only=emergency,
            key_only=key,
            hospital_id=_scoped_hospital(db, user, hospital_id),
            limit=limit,
            offset=offset,
        ),
    )
    return {"items": items, "total": total}


def _scoped_hospital(db: Session, user: dict, selected: int = 0) -> int | None:
    """병원 스코프 결정 (병원 선택 → PACS Viewer 흐름):
    - 시스템 관리자(병원 미소속 admin): 선택 병원으로 필터, 미선택이면 전체.
    - 병원 소속 사용자: 항상 자기 병원으로 고정(테넌시).
    - 그 외(레거시 단일테넌시): 전체.
    """
    is_sys_admin = user.get("role") == "admin" and not user.get("hid")
    hid = user.get("hid")
    if is_sys_admin:
        return selected or None
    if hid:
        return hid  # 병원 소속 — 자기 병원 고정
    return None


class NlQueryBody(BaseModel):
    text: str


@router.post("/worklist/nl-query")
def nl_query(body: NlQueryBody, user: dict = Depends(current_user)):
    """S1 자연어 검색 — 자연어를 필터로 변환해 미리보기 반환(적용은 사용자 확인 후)."""
    from app.rag.nl_query import nl_to_query

    if not body.text.strip():
        raise HTTPException(status_code=400, detail="검색 문장을 입력하세요")
    return nl_to_query(body.text)


@router.get("/studies/{study_id}")
def get_study(study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    detail = study_detail(db, study_id)
    if not detail:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    return detail


@router.post("/studies/{study_id}/analyze")
def analyze(study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """AI 초안 (재)생성 트리거 — 워커가 비동기 처리."""
    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    job = queue_ai_job(db, study, kind="regenerate")
    return {"job_id": job.id, "status": job.status}


class BookmarkBody(BaseModel):
    bookmark: bool


@router.put("/studies/{study_id}/bookmark")
def set_bookmark(
    study_id: int, body: BookmarkBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """BOOKMARK 컬럼(★) 토글 — UBPACS Filter Setting 항목."""
    from app.models import AuditLog

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    study.bookmark = body.bookmark
    db.add(AuditLog(action="bookmark_set", target_type="study", target_id=str(study_id),
                    detail={"by": user["sub"], "bookmark": body.bookmark}))
    db.commit()
    return {"ok": True, "bookmark": study.bookmark}


class MemoBody(BaseModel):
    memo: str


@router.put("/studies/{study_id}/memo")
def set_memo(
    study_id: int, body: MemoBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """MEMO window (UBPACS-Z Worklist 구성) — 검사 단위 사용자 메모."""
    from app.models import AuditLog

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    study.memo = body.memo[:2000]
    db.add(AuditLog(action="memo_set", target_type="study", target_id=str(study_id),
                    detail={"by": user["sub"], "len": len(body.memo)}))
    db.commit()
    return {"ok": True}


class PriorityBody(BaseModel):
    emergency: bool


@router.put("/studies/{study_id}/priority")
def set_priority(
    study_id: int, body: PriorityBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """F-15: Emergency/STAT 플래그 토글 (컨텍스트 메뉴 Priority)."""
    from app.models import AuditLog

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    study.emergency = body.emergency
    db.add(AuditLog(action="priority_set", target_type="study", target_id=str(study_id),
                    detail={"by": user["sub"], "emergency": body.emergency}))
    db.commit()
    return {"ok": True, "emergency": study.emergency}


@router.get("/studies/{study_id}/series-tree")
def series_tree(study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """시리즈→인스턴스 트리 + 썸네일 URL — 자체 뷰어 세로 썸네일용."""
    from app.config import get_settings
    from app.dicom.orthanc import OrthancClient

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    if not study.orthanc_id:
        return {"study_uid": study.study_uid, "series": []}
    client = OrthancClient()
    try:
        if not client.alive():
            return {"study_uid": study.study_uid, "series": []}
        tree = client.series_tree(study.orthanc_id)
    finally:
        client.close()
    base = get_settings().orthanc_url
    for s in tree:
        for inst in s["instances"]:
            inst["preview_url"] = f"{base}/instances/{inst['orthanc_id']}/preview"
    return {"study_uid": study.study_uid, "series": tree}


@router.get("/studies/{study_id}/instances")
def study_instances(study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """인스턴스 목록 + 썸네일 URL — 키이미지 선택 UI (F-16)."""
    from app.config import get_settings
    from app.dicom.orthanc import OrthancClient

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    if not study.orthanc_id:
        return {"items": [], "key_images": study.key_images or []}
    client = OrthancClient()
    try:
        if not client.alive():
            return {"items": [], "key_images": study.key_images or []}
        items = client.study_instances(study.orthanc_id)
    finally:
        client.close()
    base = get_settings().orthanc_url
    for it in items:
        it["preview_url"] = f"{base}/instances/{it['orthanc_id']}/preview"
    return {"items": items, "key_images": study.key_images or []}


@router.post("/import-dicom")
async def import_dicom(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    """USB/CD 등에서 고른 .dcm 파일을 Orthanc(자체 저장소)에 올리고 로컬 DB에 등록.

    원본 PiViewSTAR 'Import DICOM Files' 대응 — 파일별 결과(성공/중복/실패)를 반환한다.
    """
    from app.dicom.orthanc import OrthancClient
    from app.models import AuditLog
    from app.workers.ai_worker import sync_orthanc_once

    client = OrthancClient()
    if not client.alive():
        raise HTTPException(status_code=503, detail="Orthanc 저장소에 연결할 수 없습니다")

    results = []
    ok = 0
    for f in files:
        data = await f.read()
        if not data:
            results.append({"filename": f.filename, "size": 0, "status": "빈 파일"})
            continue
        try:
            r = client.upload_dicom(data)
            status = "중복" if r.get("Status") == "AlreadyStored" else "성공"
            if status == "성공":
                ok += 1
            results.append({"filename": f.filename, "size": len(data), "status": status})
        except Exception as e:  # noqa: BLE001 — 파일 단위 실패는 격리해 계속 진행
            results.append({"filename": f.filename, "size": len(data),
                            "status": f"실패: {str(e)[:60]}"})
    client.close()

    # 변경 피드 동기화 → studies 테이블 등록 (운영 워커와 동일 커서 재사용)
    registered = 0
    if ok:
        for _ in range(40):
            cnt = sync_orthanc_once()
            registered += cnt
            if cnt == 0:
                break

    db.add(AuditLog(account_id=user.get("uid"), action="import_dicom",
                    target_type="study", target_id="",
                    detail={"by": user["sub"], "files": len(files), "uploaded": ok,
                            "registered": registered}))
    db.commit()
    return {"processed": len(files), "uploaded": ok, "registered": registered, "results": results}


class KeyImagesBody(BaseModel):
    items: list[dict]  # [{"sop_uid","orthanc_id","instance_number"}]


@router.put("/studies/{study_id}/key-images")
def set_key_images(
    study_id: int, body: KeyImagesBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    from app.models import AuditLog

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    study.key_images = body.items
    db.add(AuditLog(action="key_images_set", target_type="study", target_id=str(study_id),
                    detail={"by": user["sub"], "count": len(body.items)}))
    db.commit()
    return {"ok": True, "count": len(body.items)}


@router.post("/studies/{study_id}/ctr")
def measure_ctr_endpoint(
    study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """S2 자동계측 CTR(심흉비) — AI 초안 계측 + numeric_verify. 확정 아님(라벨 필수)."""
    from sqlalchemy import delete

    from app.models import Annotation, AuditLog
    from app.rag.ctr import measure_ctr

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    if study.modality not in ("CR", "DX"):
        raise HTTPException(status_code=409, detail="CTR은 흉부 X선(CR/DX)에서만 계측합니다")

    png: bytes | None = None
    if study.orthanc_id:
        from app.dicom.orthanc import OrthancClient
        from app.rag.image_guard import mask_burn_in

        client = OrthancClient()
        try:
            if client.alive():
                raw = client.study_preview_png(study.orthanc_id)
                if raw:
                    png = mask_burn_in(raw)  # PHI 게이트(절대 규칙 1) — 번인 마스킹 후 전송
        finally:
            client.close()

    result = measure_ctr(study.study_uid, png)

    # AI 계측 주석 영속화 — 기존 ctr 주석은 교체
    db.execute(delete(Annotation).where(Annotation.study_id == study_id, Annotation.kind == "ctr"))
    if result["verified"] and result["ctr"] is not None:
        for name, seg in (("cardiac", result["cardiac"]), ("thoracic", result["thoracic"])):
            db.add(Annotation(
                study_id=study_id, kind="ctr",
                points=[[seg["x1"], seg["y"]], [seg["x2"], seg["y"]]],
                value=result["ctr"], unit="ratio",
                text=f"CTR {name} (AI 초안)",
                source="ai", confidence=result["confidence"], verified=True,
                created_by=user["sub"],
            ))
    db.add(AuditLog(action="ctr_measure", target_type="study", target_id=str(study_id),
                    detail={"by": user["sub"], "ctr": result["ctr"], "verified": result["verified"],
                            "source": result["source"]}))
    db.commit()
    return result


def _anno_out(a) -> dict:
    return {
        "id": a.id, "series_uid": a.series_uid, "sop_uid": a.sop_uid, "kind": a.kind,
        "points": a.points or [], "value": a.value, "unit": a.unit, "text": a.text,
        "source": a.source, "confidence": a.confidence, "verified": a.verified,
        "created_by": a.created_by,
    }


@router.get("/studies/{study_id}/annotations")
def get_annotations(study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """주석/계측 목록 (07 A.4) — 뷰어 로드 시 복원."""
    from sqlalchemy import select

    from app.models import Annotation

    rows = db.execute(select(Annotation).where(Annotation.study_id == study_id)).scalars().all()
    return {"items": [_anno_out(a) for a in rows]}


class AnnotationsBody(BaseModel):
    items: list[dict]  # [{series_uid, sop_uid, kind, points, value?, unit?, text?, source?, confidence?, verified?}]


@router.put("/studies/{study_id}/annotations")
def put_annotations(
    study_id: int, body: AnnotationsBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """주석 전체 교체 저장 — 뷰어 Save. AI 주석(source=ai)은 라벨 보존."""
    from sqlalchemy import delete

    from app.models import Annotation, AuditLog

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    if len(body.items) > 500:
        raise HTTPException(status_code=400, detail="주석은 검사당 500개 이하")
    db.execute(delete(Annotation).where(Annotation.study_id == study_id))
    for it in body.items:
        pts = it.get("points") or []
        if not isinstance(pts, list):
            continue
        db.add(Annotation(
            study_id=study_id,
            series_uid=str(it.get("series_uid", ""))[:128],
            sop_uid=str(it.get("sop_uid", ""))[:128],
            kind=str(it.get("kind", "line"))[:32],
            points=pts,
            value=it.get("value"),
            unit=str(it.get("unit", ""))[:16],
            text=str(it.get("text", ""))[:512],
            source="ai" if it.get("source") == "ai" else "user",
            confidence=it.get("confidence"),
            verified=bool(it.get("verified", False)),
            created_by=user["sub"],
        ))
    db.add(AuditLog(action="annotations_save", target_type="study", target_id=str(study_id),
                    detail={"by": user["sub"], "count": len(body.items)}))
    db.commit()
    return {"ok": True, "count": len(body.items)}


class GspsBody(BaseModel):
    images: list[dict]        # [{sop_uid, series_uid, rows, cols}]
    annotations: list[dict]   # 07 A.4 주석 (points 0~1)
    wc: float | None = None
    ww: float | None = None
    label: str = "SAINTVIEW"


@router.post("/studies/{study_id}/send-gsps")
def send_gsps(
    study_id: int, body: GspsBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """주석·W/L을 GSPS 표준 객체로 Orthanc(동일 Study)에 저장."""
    from app.dicom.gsps import build_gsps_dataset, gsps_bytes
    from app.dicom.orthanc import OrthancClient
    from app.models import AuditLog, Patient

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    if not body.images:
        raise HTTPException(status_code=400, detail="참조 이미지가 없습니다")
    client = OrthancClient()
    try:
        if not client.alive():
            raise HTTPException(status_code=503, detail="Orthanc에 연결할 수 없습니다")
        patient = db.get(Patient, study.patient_id)
        ds = build_gsps_dataset(
            study=study, patient=patient, images=body.images,
            annotations=body.annotations, wc=body.wc, ww=body.ww,
            label=body.label, creator=user["sub"],
        )
        result = client.upload_dicom(gsps_bytes(ds))
        db.add(AuditLog(action="send_gsps", target_type="study", target_id=str(study_id),
                        detail={"by": user["sub"], "annotations": len(body.annotations),
                                "orthanc": result.get("ID", "")}))
        db.commit()
        return {"ok": True, "sop_instance_uid": ds.SOPInstanceUID}
    finally:
        client.close()


class RoiStatsBody(BaseModel):
    sop_uid: str
    kind: str = "rect"            # rect | ellipse | circle
    points: list[list[float]]    # 0~1 정규화 좌표


@router.post("/studies/{study_id}/roi-stats")
def roi_stats(study_id: int, body: RoiStatsBody, db: Session = Depends(get_db),
              user: dict = Depends(current_user)):
    """ROI HU 통계(평균·최소·최대·표준편차·면적) + 기본 W/L — 픽셀 데이터 기반."""
    import io

    from pydicom import dcmread

    from app.dicom.orthanc import OrthancClient
    from app.dicom.roi import roi_statistics

    study = db.get(Study, study_id)
    if not study or not study.orthanc_id:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    if len(body.points) < 2:
        raise HTTPException(status_code=400, detail="ROI 좌표가 부족합니다")
    client = OrthancClient()
    try:
        if not client.alive():
            raise HTTPException(status_code=503, detail="Orthanc에 연결할 수 없습니다")
        oid = None
        for inst in client.study_instances(study.orthanc_id):
            if inst.get("sop_uid") == body.sop_uid:
                oid = inst["orthanc_id"]
                break
        if not oid:
            raise HTTPException(status_code=404, detail="해당 영상을 찾을 수 없습니다")
        try:
            ds = dcmread(io.BytesIO(client.instance_file(oid)), force=True)
            arr = ds.pixel_array
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"픽셀 디코딩 실패: {e}")
        if getattr(arr, "ndim", 2) != 2:
            raise HTTPException(status_code=422, detail="그레이스케일 2D 영상만 지원합니다")
        rows, cols = arr.shape
        has_rescale = hasattr(ds, "RescaleSlope") or hasattr(ds, "RescaleIntercept")
        slope = float(getattr(ds, "RescaleSlope", 1) or 1)
        intercept = float(getattr(ds, "RescaleIntercept", 0) or 0)
        ps = getattr(ds, "PixelSpacing", None)
        pixel_spacing = [float(ps[0]), float(ps[1])] if ps else None
        pts_px = [[p[0] * cols, p[1] * rows] for p in body.points]
        stats = roi_statistics(arr, slope=slope, intercept=intercept, kind=body.kind,
                               points_px=pts_px, pixel_spacing=pixel_spacing,
                               has_rescale=has_rescale)
        # 드래그 W/L 초기화용 기본 W/L (태그 → 없으면 데이터 범위)
        wc, ww = _default_wl(ds, arr, slope, intercept)
        stats["wc"], stats["ww"] = wc, ww
        return stats
    finally:
        client.close()


def _default_wl(ds, arr, slope: float, intercept: float):
    """기본 W/L — WindowCenter/Width 태그 우선, 없으면 HU 데이터 범위."""
    def _scalar(v):
        try:
            return float(v[0]) if hasattr(v, "__len__") and not isinstance(v, str) else float(v)
        except (TypeError, ValueError):
            return None
    wc = _scalar(getattr(ds, "WindowCenter", None))
    ww = _scalar(getattr(ds, "WindowWidth", None))
    if wc is not None and ww is not None and ww > 0:
        return round(wc, 1), round(ww, 1)
    import numpy as np

    hu = np.asarray(arr, dtype=float) * slope + intercept
    lo, hi = float(np.percentile(hu, 1)), float(np.percentile(hu, 99))
    return round((lo + hi) / 2, 1), round(max(hi - lo, 1), 1)


@router.get("/studies/{study_id}/gsps")
def load_gsps(study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """검사에 귀속된 GSPS(PR) 객체를 찾아 주석·W/L로 파싱(불러오기 — 타사 PR 표시)."""
    from app.dicom.gsps import GSPS_SOP_CLASS, parse_gsps_dataset
    from app.dicom.orthanc import OrthancClient
    from pydicom import dcmread

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    if not study.orthanc_id:
        return {"items": []}
    client = OrthancClient()
    items = []
    try:
        if not client.alive():
            raise HTTPException(status_code=503, detail="Orthanc에 연결할 수 없습니다")
        for inst in client.study_instances(study.orthanc_id):
            oid = inst["orthanc_id"]
            try:
                if client.instance_meta(oid).get("sop_class_uid") != GSPS_SOP_CLASS:
                    continue
                data = client.instance_file(oid)
                import io as _io

                parsed = parse_gsps_dataset(dcmread(_io.BytesIO(data), force=True))
                parsed["sop_instance_uid"] = inst.get("sop_uid", "")
                items.append(parsed)
            except Exception:  # noqa: BLE001 — 개별 인스턴스 오류는 건너뜀
                continue
        return {"items": items}
    finally:
        client.close()


@router.post("/studies/{study_id}/send-kos")
def send_kos(study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """키이미지 선택을 KOS 표준 객체로 Orthanc에 저장 (F-16)."""
    import io

    from app.dicom.kos import build_kos_dataset
    from app.dicom.orthanc import OrthancClient
    from app.models import AuditLog, Patient

    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    if not study.key_images:
        raise HTTPException(status_code=409, detail="선택된 키이미지가 없습니다")
    client = OrthancClient()
    try:
        if not client.alive():
            raise HTTPException(status_code=503, detail="Orthanc에 연결할 수 없습니다")
        enriched = []
        for ki in study.key_images:
            meta = client.instance_meta(ki["orthanc_id"]) if ki.get("orthanc_id") else {}
            enriched.append({**ki, **meta})
        patient = db.get(Patient, study.patient_id)
        ds = build_kos_dataset(study=study, patient=patient, key_images=enriched, creator=user["sub"])
        buf = io.BytesIO()
        ds.save_as(buf, write_like_original=False)
        result = client.upload_dicom(buf.getvalue())
        db.add(AuditLog(action="send_kos", target_type="study", target_id=str(study_id),
                        detail={"by": user["sub"], "orthanc": result.get("ID", "")}))
        db.commit()
        return {"ok": True, "sop_instance_uid": ds.SOPInstanceUID}
    finally:
        client.close()
