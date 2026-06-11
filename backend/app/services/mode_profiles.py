"""05 제품 모드 프로파일(S7 applyMode) — Core 기능은 동일, 화면 구성만 제품별 전환.

`mode.profiles` 전역 설정의 기본값. 관리자가 설정 화면(JSON 편집)에서 덮어쓸 수 있고,
설정이 없으면 본 기본값이 그대로 노출된다(07 A.7 ModeProfile 스키마의 v1 구현).
"""
from __future__ import annotations

_DEFAULT_COLUMNS = [
    "status", "ai", "patient_key", "patient_name", "sex", "study_date",
    "modality", "body_part", "study_desc", "impression", "series_count", "instance_count", "priority",
]
_DEFAULT_FIND_FIELDS = ["pid", "pname", "sex", "modality", "date", "desc", "status", "finding", "emergency"]

DEFAULT_MODE_PROFILES: dict = {
    "profiles": {
        "saintvidw": {
            "label": "saintvidw (기본 — AI 중심)",
            "worklist": {
                "columns": _DEFAULT_COLUMNS,
                "find_fields": _DEFAULT_FIND_FIELDS,
                "dbl_action": "viewer2d",
            },
            "viewer": {
                "paletteSide": "left", "thumbSide": "left",
                "thumbMode": "series", "reportDock": True,
            },
        },
        "infinitt": {
            "label": "INFINITT 에뮬레이션",
            "worklist": {
                "columns": ["status", "patient_name", "patient_key", "sex", "study_date",
                            "accession_no", "modality", "series_count", "instance_count",
                            "body_part", "impression"],
                "find_fields": _DEFAULT_FIND_FIELDS,
                "dbl_action": "viewer2d",
            },
            "viewer": {
                "paletteSide": "top", "thumbSide": "bottom",
                "thumbMode": "series", "reportDock": False,
            },
        },
        "ubpacs": {
            "label": "UBPACS-Z 에뮬레이션",
            "worklist": {
                "columns": _DEFAULT_COLUMNS,
                "find_fields": ["pid", "pname", "sex", "modality", "date", "desc", "status"],
                "dbl_action": "viewer2d",
            },
            "viewer": {
                "paletteSide": "left", "thumbSide": "left",
                "thumbMode": "all", "reportDock": True,
            },
        },
        "sonic": {
            "label": "SonicPACS 에뮬레이션",
            "worklist": {
                "columns": ["status", "patient_key", "patient_name", "study_date",
                            "modality", "study_desc", "impression"],
                "find_fields": ["pid", "pname", "modality", "date"],
                "dbl_action": "ohif",
            },
            "viewer": {
                "paletteSide": "top", "thumbSide": "bottom",
                "thumbMode": "series", "reportDock": False,
            },
        },
    },
}
