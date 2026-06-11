"""오더/예약 API (RIS — P2) — MWL 내보내기 + MPPS 상태 매핑."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.config import get_settings
from app.db import get_db
from app.models import AuditLog, Order

router = APIRouter(prefix="/api/orders", tags=["orders"])

# MPPS 상태 전이: 예약 → 진행중(IN PROGRESS) → 완료(COMPLETED) / 취소(DISCONTINUED)
_TRANSITIONS: dict[str, set[str]] = {
    "scheduled": {"in_progress", "cancelled"},
    "in_progress": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


def _order_out(o: Order) -> dict:
    return {
        "id": o.id, "patient_key": o.patient_key, "patient_name": o.patient_name,
        "birth_date": o.birth_date, "sex": o.sex, "accession_no": o.accession_no,
        "modality": o.modality, "scheduled_date": o.scheduled_date,
        "scheduled_time": o.scheduled_time, "procedure_desc": o.procedure_desc,
        "station_aet": o.station_aet, "status": o.status,
        "body_part": o.body_part, "projection": o.projection, "dicom_study_id": o.dicom_study_id,
    }


@router.get("")
def list_orders(
    status: str = "", date: str = "", limit: int = 100,
    db: Session = Depends(get_db), user: dict = Depends(current_user),
):
    q = select(Order)
    if status:
        q = q.where(Order.status == status)
    if date:
        q = q.where(Order.scheduled_date == date)
    q = q.order_by(Order.scheduled_date.desc(), Order.scheduled_time.desc(), Order.id.desc())
    rows = db.execute(q.limit(min(limit, 500))).scalars().all()
    return {"items": [_order_out(o) for o in rows]}


class OrderBody(BaseModel):
    patient_key: str
    patient_name: str = ""     # DICOM PN: Last^First (프론트 폼에서 조합)
    birth_date: str = ""
    sex: str = ""
    accession_no: str = ""     # 빈값 = 자동 채번
    modality: str = "CR"
    scheduled_date: str = ""   # YYYYMMDD
    scheduled_time: str = ""   # HHMMSS
    procedure_desc: str = ""
    station_aet: str = ""
    body_part: str = ""
    projection: str = ""       # PA/AP/LAT…
    dicom_study_id: str = ""   # 빈값 = 자동 채번


@router.post("")
def create_order(body: OrderBody, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    if not body.patient_key.strip():
        raise HTTPException(status_code=400, detail="patient_key는 필수입니다")
    if body.scheduled_date and len(body.scheduled_date) != 8:
        raise HTTPException(status_code=400, detail="scheduled_date는 YYYYMMDD")
    order = Order(
        patient_key=body.patient_key.strip()[:128],
        patient_name=body.patient_name[:128],
        birth_date=body.birth_date[:8],
        sex=body.sex[:8],
        accession_no=body.accession_no[:64],
        modality=body.modality[:16],
        scheduled_date=body.scheduled_date,
        scheduled_time=body.scheduled_time[:6],
        procedure_desc=body.procedure_desc[:256],
        station_aet=body.station_aet[:32],
        body_part=body.body_part.strip().upper()[:64],
        projection=body.projection.strip().upper()[:32],
        dicom_study_id=body.dicom_study_id[:16],
    )
    db.add(order)
    db.flush()
    if not order.accession_no:
        order.accession_no = f"SV{order.id:08d}"   # Accession 자동 채번
    if not order.dicom_study_id:
        order.dicom_study_id = f"S{order.id:06d}"  # StudyID 자동 채번
    db.add(AuditLog(action="order_create", target_type="order", target_id=str(order.id),
                    detail={"by": user["sub"], "patient": order.patient_key}))
    db.commit()
    return _order_out(order)


class StatusBody(BaseModel):
    status: str  # in_progress | completed | cancelled


@router.put("/{order_id}/status")
def set_order_status(
    order_id: int, body: StatusBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """MPPS 매핑 상태 전이 — 잘못된 전이는 거부."""
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="오더를 찾을 수 없습니다")
    if body.status not in _TRANSITIONS.get(order.status, set()):
        raise HTTPException(
            status_code=409, detail=f"'{order.status}' → '{body.status}' 전이는 허용되지 않습니다"
        )
    order.status = body.status
    db.add(AuditLog(action="order_status", target_type="order", target_id=str(order_id),
                    detail={"by": user["sub"], "to": body.status}))
    db.commit()
    return _order_out(order)


@router.post("/export-mwl")
def export_mwl(db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """scheduled 오더를 MWL .wl 파일로 내보내기 — Orthanc worklists 플러그인 폴더."""
    from app.dicom.mwl import export_worklist_files

    orders = db.execute(select(Order).where(Order.status == "scheduled")).scalars().all()
    out_dir = get_settings().mwl_dir
    count = export_worklist_files(orders, out_dir)
    db.add(AuditLog(action="mwl_export", target_type="order", target_id="*",
                    detail={"by": user["sub"], "count": count, "dir": out_dir}))
    db.commit()
    return {"ok": True, "count": count, "dir": out_dir}
