"""협진 버튼을 누르면 **화면이 튕겨 나가던 것** — 재발 방지 계약.

실제 사고: 로컬 Account 행이 없는 세션(외부 인증으로 만들어진 세션 등)의 사용자가
워크리스트/뷰어에서 [협진]을 누르는 순간 로그인 화면으로 튕겨 나갔다.

사슬은 이랬다:
  ① 세션은 있는데 Account 행이 없다(uid=None 또는 이름이 안 맞는 sub)
  ② 협진은 Account.id 기반 — account_of() 가 행을 못 찾는다
  ③ _me() 가 **401** 을 냈다
  ④ 프론트 전역 401 처리기는 '세션 만료' 로 보고 setToken(null) + 강제 리로드
  → 멀쩡한 세션이 협진 클릭 한 번에 로그아웃됐다

계약: '계정 행 없음' 은 **403** 이다 — 401 은 세션 만료 전용(프론트가 그 코드로 로그아웃한다).
WS 도 같은 이유로 close 코드를 구분한다(4403 vs 4401) — 같으면 "인증이 만료되었습니다" 라는
거짓 안내가 뜬다.

⚠ 이 저장소에는 외부 PACS 계정 미러(ensure_mirror)가 없다 — 그 경로의 테스트는 제외했다.
  여기 계정은 전부 로컬 Account 이므로 위 사슬의 ①은 드물지만, 403/401 구분 자체는
  프론트 동작(강제 로그아웃)에 직결되므로 계약으로 고정한다.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.collab import _me


def test_missing_account_is_403_not_401(db):
    """★ 핵심 회귀 방어 — 401 로 되돌리면 협진 클릭이 다시 사용자를 로그아웃시킨다."""
    ghost = {"sub": "존재하지않는계정", "uid": None, "sid": "s1"}
    with pytest.raises(HTTPException) as e:
        _me(db, ghost)
    assert e.value.status_code == 403, (
        f"{e.value.status_code} — 401 이면 프론트 전역 처리기가 강제 로그아웃한다(그 사고다)")


def test_ws_close_codes_are_distinct():
    """WS: '계정 없음(4403)' 과 '인증 만료(4401)' 는 달라야 한다 — 같으면 거짓 안내가 뜬다."""
    from app.api import collab_ws as ws

    assert ws.CLOSE_NO_ACCOUNT != ws.CLOSE_UNAUTHORIZED
    assert ws.CLOSE_NO_ACCOUNT == 4403


def test_collab_paths_are_exempt_from_global_logout():
    """프론트 방어선 — /api/collab/* 의 401 은 전역 로그아웃에서 면제된다.

    백엔드를 403 으로 고쳤어도, 구 백엔드가 섞인 배포 전환기에는 401 이 올 수 있다.
    그때도 튕기지 않도록 프론트에 같은 선을 긋는다 — 그 선이 사라지면 사고가 되돌아온다.
    """
    from pathlib import Path

    api_ts = Path(__file__).resolve().parents[2] / "frontend" / "src" / "api.ts"
    src = api_ts.read_text(encoding="utf-8")
    assert 'res.status === 401 && !path.startsWith("/api/collab/")' in src, (
        "api.ts 의 401 처리기에서 협진 면제가 사라졌다 — 협진 클릭이 다시 로그아웃시킨다")
