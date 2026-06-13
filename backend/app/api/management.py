"""서버 관리(Admin) — 가입자 병원 · 계정/역할 · 등록 장비(SCU/SCP) · SCP 수신 제어.

요청 사양: Modality 등록·관리, 등록 장비만 수신, SCP 포트 개폐, 병원/계정/권한.
계층: 라우터(검증·감사) → repositories(DB). 도메인 규칙은 permissions/auth_service 재사용.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user, require_perm
from app.db import get_db
from app.models import Account, AuditLog, Hospital, Modality, Study
from app.services.auth_service import hash_password
from app.services.permissions import ROLES, role_catalog
from app.services.settings_service import get_setting, set_setting

router = APIRouter(prefix="/api/admin", tags=["management"])


# ════════════════════════════════ 역할/권한 매트릭스 ════════════════════════════════
@router.get("/roles")
def roles(user: dict = Depends(current_user)):
    """역할·권한 카탈로그 — 계정 생성 화면용."""
    return role_catalog()


# ════════════════════════════════ 가입자 병원 ════════════════════════════════
class HospitalBody(BaseModel):
    code: str
    name: str = ""
    ae_title: str = ""
    address: str = ""
    phone: str = ""
    contact: str = ""
    max_accounts: int = 0
    enforce_isolation: bool = False
    enabled: bool = True
    note: str = ""


def _hospital_dict(h: Hospital, account_count: int = 0) -> dict:
    return {
        "id": h.id, "code": h.code, "name": h.name, "ae_title": h.ae_title,
        "address": h.address, "phone": h.phone, "contact": h.contact,
        "max_accounts": h.max_accounts, "enforce_isolation": h.enforce_isolation,
        "enabled": h.enabled, "note": h.note, "account_count": account_count,
        "created_at": h.created_at.isoformat() if h.created_at else None,
    }


@router.get("/hospitals")
def list_hospitals(db: Session = Depends(get_db), user: dict = Depends(require_perm("hospitals.manage"))):
    rows = db.execute(select(Hospital).order_by(Hospital.id)).scalars().all()
    counts = dict(
        db.execute(
            select(Account.hospital_id, func.count()).group_by(Account.hospital_id)
        ).all()
    )
    return {"items": [_hospital_dict(h, counts.get(h.id, 0)) for h in rows]}


@router.post("/hospitals")
def create_hospital(body: HospitalBody, db: Session = Depends(get_db),
                    user: dict = Depends(require_perm("hospitals.manage"))):
    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="병원 코드는 필수입니다")
    if db.execute(select(Hospital).where(Hospital.code == code)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 존재하는 병원 코드입니다")
    h = Hospital(
        code=code, name=body.name.strip(), ae_title=body.ae_title.strip().upper(),
        address=body.address.strip(), phone=body.phone.strip(), contact=body.contact.strip(),
        max_accounts=max(0, body.max_accounts), enforce_isolation=body.enforce_isolation,
        enabled=body.enabled, note=body.note.strip(),
    )
    db.add(h)
    db.flush()
    db.add(AuditLog(account_id=user.get("uid"), action="hospital_create",
                    target_type="hospital", target_id=str(h.id), detail={"code": code}))
    db.commit()
    return _hospital_dict(h)


@router.put("/hospitals/{hid}")
def update_hospital(hid: int, body: HospitalBody, db: Session = Depends(get_db),
                    user: dict = Depends(require_perm("hospitals.manage"))):
    h = db.get(Hospital, hid)
    if not h:
        raise HTTPException(status_code=404, detail="병원을 찾을 수 없습니다")
    if body.code.strip() and body.code.strip() != h.code:
        if db.execute(select(Hospital).where(Hospital.code == body.code.strip())).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="이미 존재하는 병원 코드입니다")
        h.code = body.code.strip()
    h.name = body.name.strip()
    h.ae_title = body.ae_title.strip().upper()
    h.address = body.address.strip()
    h.phone = body.phone.strip()
    h.contact = body.contact.strip()
    h.max_accounts = max(0, body.max_accounts)
    h.enforce_isolation = body.enforce_isolation
    h.enabled = body.enabled
    h.note = body.note.strip()
    db.add(AuditLog(account_id=user.get("uid"), action="hospital_update",
                    target_type="hospital", target_id=str(hid)))
    db.commit()
    return _hospital_dict(h)


@router.delete("/hospitals/{hid}")
def delete_hospital(hid: int, db: Session = Depends(get_db),
                    user: dict = Depends(require_perm("hospitals.manage"))):
    h = db.get(Hospital, hid)
    if not h:
        raise HTTPException(status_code=404, detail="병원을 찾을 수 없습니다")
    if db.execute(select(func.count()).select_from(Account).where(Account.hospital_id == hid)).scalar():
        raise HTTPException(status_code=409, detail="소속 계정이 있어 삭제할 수 없습니다(먼저 계정을 이전/삭제)")
    db.delete(h)
    db.add(AuditLog(account_id=user.get("uid"), action="hospital_delete",
                    target_type="hospital", target_id=str(hid)))
    db.commit()
    return {"ok": True}


# ════════════════════════════════ 계정/역할 ════════════════════════════════
class AccountCreate(BaseModel):
    username: str
    password: str
    role: str = "radiologist"
    hospital_id: int | None = None
    display_name: str = ""
    license_no: str = ""
    email: str = ""
    enabled: bool = True


class AccountUpdate(BaseModel):
    role: str | None = None
    hospital_id: int | None = None
    display_name: str | None = None
    license_no: str | None = None
    email: str | None = None
    enabled: bool | None = None
    password: str | None = None  # 있으면 비밀번호 재설정


def _account_dict(a: Account, hospital_name: str = "") -> dict:
    return {
        "id": a.id, "username": a.username, "role": a.role,
        "role_label": ROLES.get(a.role, a.role),
        "hospital_id": a.hospital_id, "hospital_name": hospital_name,
        "display_name": a.display_name, "license_no": a.license_no,
        "email": a.email, "enabled": a.enabled,
        "last_login": a.last_login.isoformat() if a.last_login else None,
    }


def _hospital_names(db: Session) -> dict[int, str]:
    return {h.id: (h.name or h.code) for h in db.execute(select(Hospital)).scalars().all()}


@router.get("/accounts")
def list_accounts(db: Session = Depends(get_db), user: dict = Depends(require_perm("users.manage"))):
    names = _hospital_names(db)
    rows = db.execute(select(Account).order_by(Account.id)).scalars().all()
    return {"items": [_account_dict(a, names.get(a.hospital_id, "")) for a in rows]}


def _validate_role_hospital(db: Session, role: str, hospital_id: int | None) -> None:
    if role not in ROLES:
        raise HTTPException(status_code=400, detail=f"알 수 없는 역할: {role}")
    if hospital_id is not None and not db.get(Hospital, hospital_id):
        raise HTTPException(status_code=400, detail="존재하지 않는 병원입니다")


@router.post("/accounts")
def create_account(body: AccountCreate, db: Session = Depends(get_db),
                   user: dict = Depends(require_perm("users.manage"))):
    username = body.username.strip()
    if not username or len(body.password) < 8:
        raise HTTPException(status_code=400, detail="아이디 필수 · 비밀번호는 8자 이상")
    if db.execute(select(Account).where(Account.username == username)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 존재하는 아이디입니다")
    _validate_role_hospital(db, body.role, body.hospital_id)
    # 라이선스(병원 계정 수) 검사
    if body.hospital_id is not None:
        h = db.get(Hospital, body.hospital_id)
        if h and h.max_accounts > 0:
            cur = db.execute(
                select(func.count()).select_from(Account).where(Account.hospital_id == h.id)
            ).scalar() or 0
            if cur >= h.max_accounts:
                raise HTTPException(status_code=409,
                                    detail=f"라이선스 한도 초과({h.max_accounts}계정)")
    a = Account(
        username=username, password_hash=hash_password(body.password), role=body.role,
        hospital_id=body.hospital_id, display_name=body.display_name.strip()[:64],
        license_no=body.license_no.strip()[:32], email=body.email.strip()[:128],
        enabled=body.enabled,
    )
    db.add(a)
    db.flush()
    db.add(AuditLog(account_id=user.get("uid"), action="account_create",
                    target_type="account", target_id=username, detail={"role": body.role}))
    db.commit()
    names = _hospital_names(db)
    return _account_dict(a, names.get(a.hospital_id, ""))


@router.put("/accounts/{aid}")
def update_account(aid: int, body: AccountUpdate, db: Session = Depends(get_db),
                   user: dict = Depends(require_perm("users.manage"))):
    a = db.get(Account, aid)
    if not a:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    # 자기 자신 비활성/강등 방지
    if a.id == user.get("uid"):
        if body.enabled is False:
            raise HTTPException(status_code=400, detail="자기 계정은 비활성화할 수 없습니다")
        if body.role and body.role != "admin":
            raise HTTPException(status_code=400, detail="자기 계정의 관리자 권한은 해제할 수 없습니다")
    if body.role is not None or body.hospital_id is not None:
        new_role = body.role if body.role is not None else a.role
        new_hid = body.hospital_id if body.hospital_id is not None else a.hospital_id
        _validate_role_hospital(db, new_role, new_hid)
        # 마지막 관리자 보호
        if a.role == "admin" and new_role != "admin":
            other_admin = db.execute(
                select(func.count()).select_from(Account).where(
                    Account.role == "admin", Account.enabled.is_(True), Account.id != a.id
                )
            ).scalar() or 0
            if other_admin == 0:
                raise HTTPException(status_code=400, detail="마지막 관리자는 강등할 수 없습니다")
        a.role = new_role
        a.hospital_id = new_hid
    if body.display_name is not None:
        a.display_name = body.display_name.strip()[:64]
    if body.license_no is not None:
        a.license_no = body.license_no.strip()[:32]
    if body.email is not None:
        a.email = body.email.strip()[:128]
    if body.enabled is not None:
        if not body.enabled and a.role == "admin":
            other_admin = db.execute(
                select(func.count()).select_from(Account).where(
                    Account.role == "admin", Account.enabled.is_(True), Account.id != a.id
                )
            ).scalar() or 0
            if other_admin == 0:
                raise HTTPException(status_code=400, detail="마지막 관리자는 비활성화할 수 없습니다")
        a.enabled = body.enabled
    if body.password is not None:
        if len(body.password) < 8:
            raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다")
        a.password_hash = hash_password(body.password)
    db.add(AuditLog(account_id=user.get("uid"), action="account_update",
                    target_type="account", target_id=a.username))
    db.commit()
    names = _hospital_names(db)
    return _account_dict(a, names.get(a.hospital_id, ""))


@router.delete("/accounts/{aid}")
def delete_account(aid: int, db: Session = Depends(get_db),
                   user: dict = Depends(require_perm("users.manage"))):
    a = db.get(Account, aid)
    if not a:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    if a.id == user.get("uid"):
        raise HTTPException(status_code=400, detail="자기 계정은 삭제할 수 없습니다")
    if a.role == "admin":
        other_admin = db.execute(
            select(func.count()).select_from(Account).where(
                Account.role == "admin", Account.enabled.is_(True), Account.id != a.id
            )
        ).scalar() or 0
        if other_admin == 0:
            raise HTTPException(status_code=400, detail="마지막 관리자는 삭제할 수 없습니다")
    username = a.username
    db.delete(a)
    db.add(AuditLog(account_id=user.get("uid"), action="account_delete",
                    target_type="account", target_id=username))
    db.commit()
    return {"ok": True}


# ════════════════════════════════ 등록 장비(Modality) ════════════════════════════════
class ModalityBody(BaseModel):
    name: str
    ae_title: str = ""
    host: str = ""
    port: int = 104
    modality_type: str = ""
    role: str = "scu"
    manufacturer: str = ""
    hospital_id: int | None = None
    allow_receive: bool = True
    enabled: bool = True
    note: str = ""


def _modality_dict(m: Modality, hospital_name: str = "") -> dict:
    return {
        "id": m.id, "name": m.name, "ae_title": m.ae_title, "host": m.host, "port": m.port,
        "modality_type": m.modality_type, "role": m.role, "manufacturer": m.manufacturer,
        "hospital_id": m.hospital_id, "hospital_name": hospital_name,
        "allow_receive": m.allow_receive, "enabled": m.enabled, "note": m.note,
    }


@router.get("/modalities")
def list_modalities(db: Session = Depends(get_db),
                    user: dict = Depends(require_perm("modalities.manage"))):
    names = _hospital_names(db)
    rows = db.execute(select(Modality).order_by(Modality.name)).scalars().all()
    return {"items": [_modality_dict(m, names.get(m.hospital_id, "")) for m in rows]}


def _valid_node(name: str, aet: str, port: int) -> None:
    if not name:
        raise HTTPException(status_code=400, detail="장비 이름은 필수입니다")
    if not (0 < port < 65536):
        raise HTTPException(status_code=400, detail="Port는 1~65535 범위여야 합니다")
    if not aet:
        raise HTTPException(status_code=400, detail="AE Title은 필수입니다")


@router.post("/modalities")
def create_modality(body: ModalityBody, db: Session = Depends(get_db),
                    user: dict = Depends(require_perm("modalities.manage"))):
    name = body.name.strip()
    _valid_node(name, body.ae_title.strip(), body.port)
    if db.execute(select(Modality).where(Modality.name == name)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 존재하는 장비 이름입니다")
    if body.hospital_id is not None and not db.get(Hospital, body.hospital_id):
        raise HTTPException(status_code=400, detail="존재하지 않는 병원입니다")
    m = Modality(
        name=name, ae_title=body.ae_title.strip().upper(), host=body.host.strip(),
        port=body.port, modality_type=body.modality_type.strip().upper(),
        role=body.role if body.role in ("scu", "scp", "both") else "scu",
        manufacturer=body.manufacturer.strip(), hospital_id=body.hospital_id,
        allow_receive=body.allow_receive, enabled=body.enabled, note=body.note.strip(),
    )
    db.add(m)
    db.flush()
    db.add(AuditLog(account_id=user.get("uid"), action="modality_create",
                    target_type="modality", target_id=name))
    db.commit()
    names = _hospital_names(db)
    return _modality_dict(m, names.get(m.hospital_id, ""))


@router.put("/modalities/{mid}")
def update_modality(mid: int, body: ModalityBody, db: Session = Depends(get_db),
                    user: dict = Depends(require_perm("modalities.manage"))):
    m = db.get(Modality, mid)
    if not m:
        raise HTTPException(status_code=404, detail="장비를 찾을 수 없습니다")
    name = body.name.strip()
    _valid_node(name, body.ae_title.strip(), body.port)
    if name != m.name and db.execute(
        select(Modality).where(Modality.name == name)
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 존재하는 장비 이름입니다")
    if body.hospital_id is not None and not db.get(Hospital, body.hospital_id):
        raise HTTPException(status_code=400, detail="존재하지 않는 병원입니다")
    m.name = name
    m.ae_title = body.ae_title.strip().upper()
    m.host = body.host.strip()
    m.port = body.port
    m.modality_type = body.modality_type.strip().upper()
    m.role = body.role if body.role in ("scu", "scp", "both") else m.role
    m.manufacturer = body.manufacturer.strip()
    m.hospital_id = body.hospital_id
    m.allow_receive = body.allow_receive
    m.enabled = body.enabled
    m.note = body.note.strip()
    db.add(AuditLog(account_id=user.get("uid"), action="modality_update",
                    target_type="modality", target_id=name))
    db.commit()
    names = _hospital_names(db)
    return _modality_dict(m, names.get(m.hospital_id, ""))


@router.delete("/modalities/{mid}")
def delete_modality(mid: int, db: Session = Depends(get_db),
                    user: dict = Depends(require_perm("modalities.manage"))):
    m = db.get(Modality, mid)
    if not m:
        raise HTTPException(status_code=404, detail="장비를 찾을 수 없습니다")
    name = m.name
    db.delete(m)
    db.add(AuditLog(account_id=user.get("uid"), action="modality_delete",
                    target_type="modality", target_id=name))
    db.commit()
    return {"ok": True}


@router.post("/modalities/apply")
def apply_modalities(db: Session = Depends(get_db),
                     user: dict = Depends(require_perm("modalities.manage"))):
    """활성 장비를 Orthanc DicomModalities로 반영 — C-STORE/C-FIND/C-MOVE 대상 등록.

    enabled=False 또는 allow_receive=False 장비는 Orthanc에서 제거(통신 차단).
    """
    from app.dicom.orthanc import OrthancClient

    rows = db.execute(select(Modality)).scalars().all()
    client = OrthancClient()
    try:
        if not client.alive():
            return {"ok": False, "detail": "Orthanc에 연결할 수 없습니다", "applied": 0}
        applied = 0
        removed = 0
        errors: list[str] = []
        for m in rows:
            active = m.enabled and m.allow_receive and m.host and 0 < m.port < 65536
            if active:
                r = client._client.put(f"/modalities/{m.name}", json=[m.ae_title, m.host, m.port])
                if r.status_code in (200, 204):
                    applied += 1
                else:
                    errors.append(f"{m.name}: HTTP {r.status_code}")
            else:
                rd = client._client.delete(f"/modalities/{m.name}")
                if rd.status_code in (200, 204):
                    removed += 1
        db.add(AuditLog(account_id=user.get("uid"), action="modality_apply",
                        target_type="orthanc", target_id="modalities",
                        detail={"applied": applied, "removed": removed, "errors": errors}))
        db.commit()
        return {"ok": True, "applied": applied, "removed": removed, "errors": errors}
    finally:
        client.close()


# ════════════════════════════════ SCP 수신 제어 ════════════════════════════════
SCP_KEY = "scp.config"
SCP_DEFAULT = {
    "receive_enabled": True,   # SCP로서 C-STORE 수신 허용
    "registered_only": False,  # 등록 장비(IP/AET)만 통신 허용 (DicomCheckModalityHost)
    "check_called_aet": False, # Called AE Title 검증
}


def _repo_root() -> Path:
    # backend/app/api/management.py → parents[3] = 저장소 루트
    return Path(__file__).resolve().parents[3]


@router.get("/scp-status")
def scp_status(db: Session = Depends(get_db),
               user: dict = Depends(require_perm("modalities.manage"))):
    """현재 SCP(수신) 상태 — Orthanc DICOM 포트/AET + 등록 장비 수 + 적용 정책."""
    from app.dicom.orthanc import OrthancClient

    cfg = {**SCP_DEFAULT, **(get_setting(db, SCP_KEY, default={}) or {})}
    n_mod = db.execute(select(func.count()).select_from(Modality)).scalar() or 0
    n_active = db.execute(
        select(func.count()).select_from(Modality).where(
            Modality.enabled.is_(True), Modality.allow_receive.is_(True)
        )
    ).scalar() or 0
    out = {"config": cfg, "modalities_total": n_mod, "modalities_active": n_active,
           "orthanc": None}
    client = OrthancClient()
    try:
        if client.alive():
            sys_info = client._client.get("/system").json()
            registered = client._client.get("/modalities").json()
            out["orthanc"] = {
                "alive": True, "aet": sys_info.get("DicomAet"),
                "dicom_port": sys_info.get("DicomPort"),
                "registered_modalities": registered,
            }
        else:
            out["orthanc"] = {"alive": False}
    finally:
        client.close()
    return out


class ScpConfigBody(BaseModel):
    receive_enabled: bool = True
    registered_only: bool = False
    check_called_aet: bool = False


@router.post("/scp-config")
def scp_config(body: ScpConfigBody, db: Session = Depends(get_db),
               user: dict = Depends(require_perm("modalities.manage"))):
    """SCP 수신 정책 저장 + Orthanc 적용용 설정 파일 생성.

    실동작: 등록 장비를 Orthanc DicomModalities로 즉시 반영(런타임).
    포트 개폐·등록장비 전용 수신(DicomCheckModalityHost) 같은 수신 데몬 설정은
    Orthanc 기동 시 로드되므로 deploy/orthanc-generated.json을 생성하고 재기동을 안내한다.
    """
    import json

    cfg = {"receive_enabled": body.receive_enabled, "registered_only": body.registered_only,
           "check_called_aet": body.check_called_aet}
    set_setting(db, SCP_KEY, cfg, scope="global")

    # 등록 장비 → Orthanc 설정 스니펫
    mods = db.execute(select(Modality).where(
        Modality.enabled.is_(True), Modality.allow_receive.is_(True)
    )).scalars().all()
    dicom_modalities = {
        m.name: [m.ae_title, m.host, m.port] for m in mods if m.host and 0 < m.port < 65536
    }
    from app.config import get_settings

    s = get_settings()
    orthanc_conf = {
        "DicomModalities": dicom_modalities,
        # 등록 장비 전용 수신 — 미등록 호스트/AET의 C-STORE 거부
        "DicomCheckModalityHost": bool(body.registered_only),
        "DicomCheckCalledAet": bool(body.check_called_aet),
        "DicomAlwaysAllowStore": (not body.registered_only) and body.receive_enabled,
        "DicomAlwaysAllowEcho": True,
        # SCP 수신 비활성 시 DICOM 포트를 닫는다(0=리스너 비활성)
        "DicomServerEnabled": bool(body.receive_enabled),
    }
    out_path = _repo_root() / "deploy" / "orthanc-generated.json"
    written = False
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(orthanc_conf, indent=2, ensure_ascii=False), encoding="utf-8")
        written = True
    except OSError as e:
        errors = str(e)
    else:
        errors = ""

    # 런타임 즉시 반영(장비 목록) — 수신 정책은 재기동 필요
    applied = apply_modalities(db=db, user=user)  # 동일 권한 게이트 통과한 user 재사용

    db.add(AuditLog(account_id=user.get("uid"), action="scp_config",
                    target_type="orthanc", target_id="scp", detail=cfg))
    db.commit()
    return {
        "ok": True, "config": cfg,
        "generated_file": str(out_path) if written else None,
        "write_error": errors or None,
        "runtime_modalities": applied,
        "note": (
            "장비 목록은 Orthanc에 즉시 반영되었습니다. "
            "수신 포트 개폐·등록장비 전용 수신(DicomCheckModalityHost) 정책은 "
            f"생성된 {out_path.name}을(를) Orthanc 컨테이너에 마운트한 뒤 재기동해야 적용됩니다. "
            f"(현재 Orthanc 기본 AET={s.orthanc_url})"
        ),
    }
