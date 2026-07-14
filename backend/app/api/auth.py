from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db import get_db
from app.services.auth_service import authenticate, create_token


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else ""

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    role: str
    hospital_id: int | None = None
    hospital_name: str = ""


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)) -> LoginResponse:
    """관리자/서버 운영 로그인 (홈 페이지 Login) — 관리 콘솔용.

    레인 S 보안 훅: 계정·IP 연속 실패 잠금(security.policy) — 잠금 중 401, 성공 시 카운터 리셋.
    """
    from app.services import security_service

    ip = _client_ip(request)
    security_service.ensure_login_allowed(db, body.username, ip)
    account = authenticate(db, body.username, body.password)
    if not account:
        security_service.record_login_failure(db, body.username, ip)
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다")
    security_service.reset_login_failures(body.username, ip)
    return LoginResponse(token=create_token(account), username=account.username, role=account.role,
                         hospital_id=account.hospital_id)


class ClientLoginRequest(BaseModel):
    hospital_id: str   # 병원 ID = 병원 코드
    username: str       # 개별 ID
    password: str


@router.post("/client-login", response_model=LoginResponse)
def client_login(body: ClientLoginRequest, request: Request, db: Session = Depends(get_db)) -> LoginResponse:
    """Saintview PACS AI Client 뷰어 로그인 — 병원 ID + 개별 ID + Password.

    병원 ID로 병원을 식별하고, 해당 병원 소속 계정만 그 병원 PACS Viewer에 로그인된다.
    레인 S 보안 훅: 관리 콘솔 로그인과 동일한 실패 잠금 적용.
    """
    from sqlalchemy import func, or_, select

    from app.models import Hospital
    from app.services import security_service

    ip = _client_ip(request)
    security_service.ensure_login_allowed(db, body.username, ip)
    # 병원 식별 — 병원 코드(HOSP002) 또는 병원 이름("광주씨티병원") 둘 다 허용(대소문자·공백 무시).
    # 이름은 유니크가 아니므로: 코드 정확일치 우선 → 활성 병원 우선 → id 오름차순으로 1건.
    norm = body.hospital_id.strip().lower()
    hospital = db.execute(
        select(Hospital)
        .where(or_(
            func.lower(func.trim(Hospital.code)) == norm,
            func.lower(func.trim(Hospital.name)) == norm,
        ))
        .order_by(
            (func.lower(func.trim(Hospital.code)) == norm).desc(),
            Hospital.enabled.desc(),
            Hospital.id.asc(),
        )
    ).scalars().first()
    if not hospital or not hospital.enabled:
        raise HTTPException(status_code=401, detail="병원 ID가 올바르지 않거나 비활성 병원입니다")
    account = authenticate(db, body.username, body.password)
    if not account:
        security_service.record_login_failure(db, body.username, ip)
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다")
    security_service.reset_login_failures(body.username, ip)
    # 시스템 관리자(병원 미소속 admin)는 어느 병원이든 접속 가능(운영/지원).
    # 그 외에는 자기 소속 병원만.
    is_system_admin = account.role == "admin" and not account.hospital_id
    if not is_system_admin and account.hospital_id != hospital.id:
        raise HTTPException(status_code=403, detail="이 병원에 소속된 계정이 아닙니다")
    return LoginResponse(token=create_token(account, hospital_id=hospital.id),
                         username=account.username, role=account.role,
                         hospital_id=hospital.id, hospital_name=hospital.name)


class ProfileBody(BaseModel):
    display_name: str = ""
    license_no: str = ""


@router.get("/profile")
def get_profile(db: Session = Depends(get_db), user: dict = Depends(current_user)):
    """판독의(Reading) 정보 — 확정 서명에 이름·면허번호가 기록된다."""
    from sqlalchemy import select

    from app.models import Account

    account = db.execute(select(Account).where(Account.username == user["sub"])).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    return {
        "username": account.username, "role": account.role,
        "display_name": account.display_name, "license_no": account.license_no,
    }


@router.put("/profile")
def put_profile(
    body: ProfileBody, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    from sqlalchemy import select

    from app.models import Account, AuditLog

    account = db.execute(select(Account).where(Account.username == user["sub"])).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    account.display_name = body.display_name.strip()[:64]
    account.license_no = body.license_no.strip()[:32]
    db.add(AuditLog(account_id=account.id, action="profile_update", target_type="account",
                    target_id=account.username))
    db.commit()
    return {"ok": True}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    """비밀번호 변경 — 현재 비밀번호 재확인 + 최소 8자 (PiViewSTAR 4~16 정책을 강화 승계)."""
    from sqlalchemy import select

    from app.models import Account, AuditLog
    from app.services.auth_service import hash_password, verify_password

    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="새 비밀번호는 8자 이상이어야 합니다")
    account = db.execute(select(Account).where(Account.username == user["sub"])).scalar_one_or_none()
    if not account or not verify_password(body.current_password, account.password_hash):
        raise HTTPException(status_code=401, detail="현재 비밀번호가 올바르지 않습니다")
    account.password_hash = hash_password(body.new_password)
    db.add(AuditLog(account_id=account.id, action="password_change", target_type="account",
                    target_id=account.username))
    db.commit()
    return {"ok": True}
