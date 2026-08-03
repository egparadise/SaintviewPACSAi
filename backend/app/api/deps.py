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


def download_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    token: str = "",
) -> dict:
    """다운로드 전용 인증 — 헤더가 없으면 ?token= 을 받는다.

    브라우저의 파일 내려받기(location 이동·<a download>)는 Authorization 헤더를 붙일 수 없다.
    그래서 이 통로만 쿼리 토큰을 허용한다. 검증은 current_user 와 같은 decode_token 이고,
    쓰는 곳은 반출 패키지(ZIP/ISO) 하나뿐이다.
    """
    raw = creds.credentials if creds else token
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증이 필요합니다")
    try:
        return decode_token(raw)
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰입니다")


# ── WebSocket 인증 (협진) ────────────────────────────────────────────────────
# 브라우저 WebSocket API 는 요청 헤더를 못 붙인다 — Authorization 을 실을 방법이 없다.
# 그래서 표준 우회로인 **서브프로토콜**에 토큰을 싣는다: `Sec-WebSocket-Protocol: sv.bearer, <jwt>`.
#
# 왜 ?token= 쿼리가 아닌가: nginx 기본 combined 로그의 $request 에 쿼리가 그대로 남고,
#   리퍼러·히스토리도 마찬가지다. WS 는 연결이 몇 시간씩 살아 있어 그 한 줄이 오래 남는 로그가 된다.
# JWT 의 문자 집합(base64url + '.')은 RFC 7230 token 문자에 모두 포함되므로 서브프로토콜
# 값으로 적법하다. 서버는 선택한 서브프로토콜(sv.bearer)을 반드시 echo 해야 브라우저가
# 핸드셰이크를 받아들인다.
WS_SUBPROTOCOL = "sv.bearer"


def ws_token(websocket) -> str | None:
    """핸드셰이크 헤더에서 JWT 추출 — 형식이 아니면 None."""
    raw = websocket.headers.get("sec-websocket-protocol", "")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) < 2 or parts[0] != WS_SUBPROTOCOL:
        return None
    return parts[1]


def ws_user(websocket) -> dict | None:
    """WS 핸드셰이크 인증 → 사용자 dict, 실패면 None(호출부가 close 코드를 정한다).

    검증은 HTTP 경로와 **완전히 같은** decode_token 이다 — 인증 규칙이 두 벌로 갈리지 않게.
    """
    tok = ws_token(websocket)
    if not tok:
        return None
    try:
        return decode_token(tok)
    except pyjwt.PyJWTError:
        return None


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


def require_effective(perm: str):
    """병원별 오버라이드('perm.matrix')를 반영한 유효 권한 게이트.

    require_perm 과 달리 사용자의 소속 병원(hid) 매트릭스를 반영한다
    (판독 작성/확정, 영상 관리 등 병원별 등급 권한 강제 지점용).
    """
    from app.services.permissions import effective_perms

    def _dep(db: Session = Depends(get_db), user: dict = Depends(current_user)) -> dict:
        if perm not in effective_perms(db, user.get("role", ""), user.get("hid")):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="이 작업에 대한 권한이 없습니다"
            )
        return user

    return _dep


def require_effective_download(perm: str):
    """require_effective 와 같은 게이트인데 인증만 download_user 를 쓴다.

    ⚠ 다운로드 경로라고 권한을 낮추면 안 된다 — 반출은 PHI 가 브라우저 밖으로 나가는
      동작이라 오히려 가장 강한 게이트가 필요하다. 헤더를 못 붙이는 것은 **인증 전달
      수단**의 한계일 뿐이므로, 토큰 출처만 넓히고 권한 판정은 그대로 둔다.
    """
    from app.services.permissions import effective_perms

    def _dep(db: Session = Depends(get_db), user: dict = Depends(download_user)) -> dict:
        if perm not in effective_perms(db, user.get("role", ""), user.get("hid")):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="이 작업에 대한 권한이 없습니다"
            )
        return user

    return _dep


DbSession = Depends(get_db)
__all__ = ["current_user", "download_user", "admin_user", "require_perm", "require_effective",
           "require_effective_download", "get_db", "Session",
           "WS_SUBPROTOCOL", "ws_token", "ws_user"]
