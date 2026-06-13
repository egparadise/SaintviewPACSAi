"""API 공통 의존성 — DB 세션, 인증 사용자."""
from __future__ import annotations

import jwt as pyjwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.auth_service import decode_token

_bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증이 필요합니다")
    try:
        return decode_token(creds.credentials)
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰입니다")


def admin_user(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다")
    return user


def require_perm(perm: str):
    """역할 기반 권한 게이트 — app.services.permissions 매트릭스 사용."""
    from app.services.permissions import has_perm

    def _dep(user: dict = Depends(current_user)) -> dict:
        if not has_perm(user.get("role", ""), perm):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="이 작업에 대한 권한이 없습니다"
            )
        return user

    return _dep


DbSession = Depends(get_db)
__all__ = ["current_user", "admin_user", "require_perm", "get_db", "Session"]
