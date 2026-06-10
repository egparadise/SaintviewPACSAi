"""RAG 품질 평가 하네스 (설계 §10 릴리스 게이트의 골격).

평가 항목:
1. 스키마 적합률 — 생성물이 SR_SCHEMA 필수 구조를 충족하는가 (목표 100%)
2. 근거 반영률 — 과거 판독이 있을 때 comparison에 반영되는가
3. critical 검출 — critical 임상정보 케이스에서 severity=critical 생성되는가
4. PHI 게이트 — 컨텍스트에 PHI 잔존 0

mock 모드에서는 파이프라인 회귀 게이트로, live 모드에서는 실제 품질 측정으로 사용.
실행: py -3.11 harness/eval_rag.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

CASES = [
    {"modality": "CT", "body_part": "CHEST", "desc": "CT Chest (CE)", "clinical": "만성 기침", "critical": False},
    {"modality": "CR", "body_part": "CHEST", "desc": "Chest PA", "clinical": "기흉 의심 외상", "critical": True},
    {"modality": "MR", "body_part": "BRAIN", "desc": "MR Brain", "clinical": "급성 경색 r/o", "critical": True},
    {"modality": "US", "body_part": "ABDOMEN", "desc": "Abdomen US", "clinical": "검진", "critical": False},
    {
        "modality": "CT", "body_part": "CHEST",
        "desc": "CT Chest 홍길동 850101-1234567",  # PHI 주입 케이스
        "clinical": "환자번호 1234567, 연락처 010-1111-2222", "critical": False, "phi": True,
    },
]


def main() -> int:
    from app.rag.deid import mask
    from app.rag.generate import GenerationInput, build_context, generate_draft
    from app.rag.schemas import SR_SCHEMA, has_critical

    results = {"schema_ok": 0, "critical_ok": 0, "critical_total": 0, "phi_ok": 0, "phi_total": 0}

    for case in CASES:
        gi = GenerationInput(
            modality=case["modality"],
            body_part=case["body_part"],
            study_desc=mask(case["desc"], patient_names=["홍길동"]).text,
            clinical_info=mask(case["clinical"]).text,
        )
        # PHI 게이트 검사
        if case.get("phi"):
            results["phi_total"] += 1
            ctx = build_context(gi)
            leaked = any(tok in ctx for tok in ("850101-1234567", "홍길동", "010-1111-2222"))
            if not leaked:
                results["phi_ok"] += 1
            else:
                print(f"  PHI 누출! {case['desc']}")

        out = generate_draft(gi)
        # 1) 스키마 적합
        if all(k in out.sr_json for k in SR_SCHEMA["required"]):
            results["schema_ok"] += 1
        # 3) critical 검출
        if case["critical"]:
            results["critical_total"] += 1
            if has_critical(out.sr_json):
                results["critical_ok"] += 1

    total = len(CASES)
    print(f"스키마 적합률   : {results['schema_ok']}/{total}")
    print(f"critical 검출   : {results['critical_ok']}/{results['critical_total']}")
    print(f"PHI 게이트      : {results['phi_ok']}/{results['phi_total']}")

    ok = (
        results["schema_ok"] == total
        and results["critical_ok"] == results["critical_total"]
        and results["phi_ok"] == results["phi_total"]
    )
    print("EVAL PASS" if ok else "EVAL FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
