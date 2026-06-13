"""역할(Role) 기반 권한 — 가입자 병원 운영 모델.

요청 사양: 관리자 · 의사 · 영상의학과 의사 · 방사선사 · 기타 의료인.
권한은 키 단위로 정의하고, 역할마다 허용 키 집합을 둔다(확장 용이).
관리자(admin)는 모든 권한을 가진다.
"""
from __future__ import annotations

# 역할 키 → 표시명 (계정 생성/UI에 그대로 노출)
ROLES: dict[str, str] = {
    "admin": "시스템 관리자",
    "doctor": "의사",
    "radiologist": "영상의학과 의사",
    "technologist": "방사선사",
    "staff": "기타 의료인",
}

# 권한 키 → 설명
PERMISSIONS: dict[str, str] = {
    "users.manage": "계정 관리(생성·역할·소속)",
    "hospitals.manage": "가입자 병원 관리",
    "modalities.manage": "장비(SCU/SCP)·수신 관리",
    "server.manage": "서버 네트워크·백업 설정",
    "settings.global": "전역 설정 변경",
    "audit.view": "감사 로그 조회",
    "worklist.view": "워크리스트 조회",
    "study.import": "검사 수신·등록(영상 관리)",
    "report.read": "판독 조회",
    "report.write": "판독 작성·수정(초안)",
    "report.finalize": "판독 확정(서명)",
    "report.confirm2": "판독 2차 승인",
}

_ALL = set(PERMISSIONS.keys())

# 역할별 허용 권한 — admin은 _ALL
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "admin": set(_ALL),
    # 영상의학과 의사: 판독의 — 작성·확정·2차 승인까지
    "radiologist": {
        "worklist.view", "report.read", "report.write", "report.finalize", "report.confirm2",
    },
    # 의사(임상의): 조회·작성·확정(소속 진료과)
    "doctor": {
        "worklist.view", "report.read", "report.write", "report.finalize",
    },
    # 방사선사: 영상 수신·등록 + 조회(판독 작성·확정 불가)
    "technologist": {
        "worklist.view", "study.import", "report.read",
    },
    # 기타 의료인: 조회만
    "staff": {
        "worklist.view", "report.read",
    },
}


def perms_for(role: str) -> set[str]:
    return ROLE_PERMISSIONS.get(role, set())


def has_perm(role: str, perm: str) -> bool:
    if role == "admin":
        return True
    return perm in ROLE_PERMISSIONS.get(role, set())


def role_catalog() -> dict:
    """UI용 — 역할/권한 목록과 매트릭스."""
    return {
        "roles": [
            {"key": k, "label": v, "perms": sorted(perms_for(k))} for k, v in ROLES.items()
        ],
        "permissions": [{"key": k, "label": v} for k, v in PERMISSIONS.items()],
    }
