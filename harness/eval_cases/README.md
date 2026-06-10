# RAG 평가 케이스 (실데이터)

실제 병원 판독문으로 AI 초안 품질을 측정하는 케이스 풀. `eval_rag.py --cases harness/eval_cases` 로 실행.

## 케이스 포맷 (JSONL — 한 줄 = 한 케이스)

```json
{
  "id": "CT-CHEST-001",
  "modality": "CT", "body_part": "CHEST",
  "study_desc": "CT Chest (CE)",
  "clinical_info": "65세 남성, 만성 기침",
  "priors": [
    {"study_uid": "uid-1", "study_date": "20250110", "modality": "CT",
     "study_desc": "CT Chest", "narrative_text": "...과거 판독 전문..."}
  ],
  "ground_truth": "...실제 확정 판독 전문 (LLM-judge 채점 기준)...",
  "checks": {
    "must_include": ["폐결절", "추적"],
    "must_not_include": ["좌상엽"],
    "critical": false
  }
}
```

## 실데이터 반입 절차 (⚠ PHI 게이트)

1. 판독문에서 환자명·등록번호·연락처를 제거하거나 그대로 두되 — **eval 로더가 deid.mask()를 강제 통과**시킨다(이중 방어).
2. 케이스 파일은 **이 디렉터리의 `real_*.jsonl` 이름으로 저장** — `.gitignore`에 의해 커밋되지 않는다(원내 보관).
3. `sample_cases.jsonl`(합성 예시)로 포맷을 확인한 후 동일 구조로 작성.

## 채점

| 모드 | 방법 |
|---|---|
| 결정적(기본) | 스키마 적합 + checks(must_include/must_not_include/critical) |
| `--judge` (live) | claude-opus-4-8 채점자가 ground_truth 대비 5점 루브릭(핵심소견 일치/누락/환각/권고 적절성) — 평가셋 릴리스 게이트(설계 §10 환각률) |
