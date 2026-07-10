"""병원 선택 → 자원관리 → Client 선택 → PACS Viewer 흐름.

로그인 후 흐름(전체 로직):
  로그인 → /api/my/hospitals(병원 목록) → 병원 선택
        → /api/hospitals/{id}/resources(영상 용량·DB 용량·클라이언트·접속 상태)
        → Client 선택 → /clients/{cid}/enter → PACS Viewer 진입(해당 병원 스코프)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db import get_db
from app.models import Account, AuditLog, Client, Hospital, Modality, Report, Study

router = APIRouter(prefix="/api", tags=["hospitals"])

ONLINE_WINDOW_SEC = 300  # 마지막 접속 5분 이내면 online


def _is_online(last_seen) -> bool:
    if last_seen is None:
        return False
    ls = last_seen if last_seen.tzinfo else last_seen.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ls).total_seconds() < ONLINE_WINDOW_SEC


def _is_system_admin(user: dict) -> bool:
    """시스템(서버 운영) 관리자 — role=admin이면서 특정 병원 소속이 아닌 계정(전체 병원)."""
    return user.get("role") == "admin" and not user.get("hid")


def _require_access(user: dict, hospital_id: int) -> None:
    """시스템 관리자=전체 병원, 그 외=자기 소속 병원만."""
    if _is_system_admin(user):
        return
    if user.get("hid") == hospital_id:
        return
    raise HTTPException(status_code=403, detail="이 병원에 접근할 권한이 없습니다")


def _accessible_hospitals(db: Session, user: dict) -> list[Hospital]:
    q = select(Hospital).where(Hospital.enabled.is_(True)).order_by(Hospital.name)
    if _is_system_admin(user):
        pass  # 전체 병원
    elif user.get("hid"):
        q = q.where(Hospital.id == user["hid"])  # 자기 병원만
    else:
        return []
    return list(db.execute(q).scalars().all())


def _client_counts(db: Session, hospital_id: int) -> tuple[int, int]:
    clients = db.execute(select(Client).where(Client.hospital_id == hospital_id)).scalars().all()
    online = sum(1 for c in clients if c.enabled and _is_online(c.last_seen))
    return len(clients), online


@router.get("/my/hospitals")
def my_hospitals(db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """로그인 사용자가 접근 가능한 병원 목록 + 빠른 상태(접속 클라이언트·검사 수)."""
    out = []
    for h in _accessible_hospitals(db, user):
        total_clients, online = _client_counts(db, h.id)
        studies = db.execute(
            select(func.count()).select_from(Study).where(Study.hospital_id == h.id)
        ).scalar() or 0
        out.append({
            "id": h.id, "code": h.code, "name": h.name, "departments": h.departments,
            "license_clients": h.license_clients, "clients": total_clients, "online_clients": online,
            "studies": studies, "modality_limit": h.modality_limit,
        })
    return {"items": out, "role": user.get("role"), "is_admin": _is_system_admin(user)}


@router.get("/hospitals/{hid}/resources")
def hospital_resources(hid: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """병원별 자원관리 — 영상 용량(추정)·DB 용량·클라이언트·접속 상태·장비."""
    _require_access(user, hid)
    h = db.get(Hospital, hid)
    if not h:
        raise HTTPException(status_code=404, detail="병원을 찾을 수 없습니다")

    studies = db.execute(select(Study).where(Study.hospital_id == hid)).scalars().all()
    n_studies = len(studies)
    n_instances = sum(s.instance_count for s in studies)
    n_series = sum(s.series_count for s in studies)
    study_ids = [s.id for s in studies]

    # DB 용량 — 행 수(검사·판독·주석)
    n_reports = 0
    n_annos = 0
    if study_ids:
        n_reports = db.execute(
            select(func.count()).select_from(Report).where(Report.study_id.in_(study_ids))
        ).scalar() or 0
        from app.models import Annotation

        n_annos = db.execute(
            select(func.count()).select_from(Annotation).where(Annotation.study_id.in_(study_ids))
        ).scalar() or 0

    # 영상 용량 — Orthanc 전체 디스크에서 인스턴스 비율로 추정(Orthanc는 공유 저장)
    image_bytes_est = None
    orthanc_total = None
    total_instances = db.execute(select(func.sum(Study.instance_count))).scalar() or 0
    from app.dicom.orthanc import OrthancClient

    oc = OrthancClient()
    try:
        if oc.alive():
            st = oc.statistics()
            orthanc_total = int(st.get("TotalDiskSize", 0) or 0)
            if total_instances > 0 and orthanc_total:
                image_bytes_est = int(orthanc_total * (n_instances / total_instances))
    finally:
        oc.close()

    # 클라이언트 + 접속 상태
    clients = db.execute(
        select(Client).where(Client.hospital_id == hid).order_by(Client.id)
    ).scalars().all()
    client_rows = [{
        "id": c.id, "name": c.name, "code": c.code, "location": c.location,
        "enabled": c.enabled, "online": _is_online(c.last_seen),
        "last_seen": c.last_seen.isoformat() if c.last_seen else None,
        "last_user": c.last_user,
    } for c in clients]
    online = sum(1 for c in client_rows if c["online"] and c["enabled"])

    n_modalities = db.execute(
        select(func.count()).select_from(Modality).where(Modality.hospital_id == hid)
    ).scalar() or 0
    n_accounts = db.execute(
        select(func.count()).select_from(Account).where(Account.hospital_id == hid)
    ).scalar() or 0

    return {
        "hospital": {"id": h.id, "code": h.code, "name": h.name, "departments": h.departments,
                     "address": h.address, "phone": h.phone},
        "image": {"studies": n_studies, "series": n_series, "instances": n_instances,
                  "bytes_estimate": image_bytes_est, "orthanc_total_bytes": orthanc_total},
        "db": {"studies": n_studies, "reports": n_reports, "annotations": n_annos},
        "clients": {"total": len(client_rows), "online": online,
                    "license": h.license_clients, "items": client_rows},
        "modalities": {"count": n_modalities, "limit": h.modality_limit},
        "accounts": n_accounts,
    }


# ──────────────────────────── Client(좌석) CRUD ────────────────────────────
class ClientBody(BaseModel):
    name: str
    location: str = ""
    enabled: bool = True
    role: str = ""  # 계정 등급 — doctor|radiologist|technologist|staff ("" = 변경 없음/기본 staff)


# Client(좌석)별 계정 등급 — Client 테이블에 컬럼이 없어(스키마 마이그레이션 금지)
# hospital 스코프 setting 'client.roles' 에 {"<client_id>": "<role>"} 로 보관한다.
_CLIENT_ROLES_KEY = "client.roles"


def _client_roles(db: Session, hid: int) -> dict:
    from app.services.settings_service import get_hospital_setting

    stored = get_hospital_setting(db, hid, _CLIENT_ROLES_KEY, default={}) or {}
    return dict(stored) if isinstance(stored, dict) else {}


def _validate_client_role(role: str) -> None:
    from app.services.permissions import CLIENT_ROLES

    if role and role not in CLIENT_ROLES:
        raise HTTPException(status_code=400,
                            detail=f"알 수 없는 등급: {role} ({'|'.join(CLIENT_ROLES)})")


def _client_dict(c: Client, role: str = "staff") -> dict:
    from app.services.permissions import ROLES

    return {"id": c.id, "hospital_id": c.hospital_id, "name": c.name, "code": c.code,
            "location": c.location, "enabled": c.enabled, "online": _is_online(c.last_seen),
            "last_seen": c.last_seen.isoformat() if c.last_seen else None, "last_user": c.last_user,
            "role": role, "role_label": ROLES.get(role, role)}


@router.get("/hospitals/{hid}/clients")
def list_clients(hid: int, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    _require_access(user, hid)
    roles = _client_roles(db, hid)
    rows = db.execute(select(Client).where(Client.hospital_id == hid).order_by(Client.id)).scalars().all()
    return {"items": [_client_dict(c, roles.get(str(c.id), "staff")) for c in rows]}


@router.post("/hospitals/{hid}/clients")
def create_client(hid: int, body: ClientBody, db: Session = Depends(get_db),
                  user: dict = Depends(current_user)):
    _require_access(user, hid)
    h = db.get(Hospital, hid)
    if not h:
        raise HTTPException(status_code=404, detail="병원을 찾을 수 없습니다")
    cur = db.execute(select(func.count()).select_from(Client).where(Client.hospital_id == hid)).scalar() or 0
    if h.license_clients > 0 and cur >= h.license_clients:
        raise HTTPException(status_code=409, detail=f"Client 라이선스 한도 초과({h.license_clients}석)")
    _validate_client_role(body.role)
    c = Client(hospital_id=hid, name=body.name.strip() or f"Client {cur + 1}",
               code=f"{h.code}-C{cur + 1:02d}", location=body.location.strip(), enabled=body.enabled)
    db.add(c)
    db.flush()
    role = body.role or "staff"
    if body.role:
        from app.services.settings_service import set_hospital_setting

        roles = _client_roles(db, hid)
        roles[str(c.id)] = body.role
        set_hospital_setting(db, hid, _CLIENT_ROLES_KEY, roles)
    db.add(AuditLog(account_id=user.get("uid"), action="client_create",
                    target_type="client", target_id=str(c.id),
                    detail={"hospital": hid, "role": role}))
    db.commit()
    return _client_dict(c, role)


@router.put("/hospitals/{hid}/clients/{cid}")
def update_client(hid: int, cid: int, body: ClientBody, db: Session = Depends(get_db),
                  user: dict = Depends(current_user)):
    _require_access(user, hid)
    c = db.get(Client, cid)
    if not c or c.hospital_id != hid:
        raise HTTPException(status_code=404, detail="Client를 찾을 수 없습니다")
    _validate_client_role(body.role)
    c.name = body.name.strip()
    c.location = body.location.strip()
    c.enabled = body.enabled
    roles = _client_roles(db, hid)
    if body.role:  # "" = 등급 변경 없음(기존 유지)
        from app.services.settings_service import set_hospital_setting

        roles[str(c.id)] = body.role
        set_hospital_setting(db, hid, _CLIENT_ROLES_KEY, roles)
    db.commit()
    return _client_dict(c, roles.get(str(c.id), "staff"))


@router.delete("/hospitals/{hid}/clients/{cid}")
def delete_client(hid: int, cid: int, db: Session = Depends(get_db),
                  user: dict = Depends(current_user)):
    _require_access(user, hid)
    c = db.get(Client, cid)
    if not c or c.hospital_id != hid:
        raise HTTPException(status_code=404, detail="Client를 찾을 수 없습니다")
    roles = _client_roles(db, hid)
    if roles.pop(str(cid), None) is not None:  # 등급 매핑 정리(고아 키 방지)
        from app.services.settings_service import set_hospital_setting

        set_hospital_setting(db, hid, _CLIENT_ROLES_KEY, roles)
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/hospitals/{hid}/clients/{cid}/enter")
def enter_client(hid: int, cid: int, db: Session = Depends(get_db),
                 user: dict = Depends(current_user)):
    """Client 선택 → PACS Viewer 진입. 접속 시각·사용자 기록(online 판정)."""
    _require_access(user, hid)
    c = db.get(Client, cid)
    if not c or c.hospital_id != hid:
        raise HTTPException(status_code=404, detail="Client를 찾을 수 없습니다")
    if not c.enabled:
        raise HTTPException(status_code=409, detail="비활성화된 Client입니다")
    c.last_seen = datetime.now(timezone.utc)
    c.last_user = user.get("sub", "")[:64]
    db.add(AuditLog(account_id=user.get("uid"), action="client_enter",
                    target_type="client", target_id=str(c.id), detail={"hospital": hid}))
    db.commit()
    return {"ok": True, "hospital_id": hid, "client_id": cid, "client_name": c.name}


@router.post("/hospitals/{hid}/clients/{cid}/heartbeat")
def heartbeat(hid: int, cid: int, db: Session = Depends(get_db),
              user: dict = Depends(current_user)):
    """뷰어가 주기적으로 호출 → online 유지."""
    _require_access(user, hid)
    c = db.get(Client, cid)
    if c and c.hospital_id == hid:
        c.last_seen = datetime.now(timezone.utc)
        db.commit()
    return {"ok": True}
