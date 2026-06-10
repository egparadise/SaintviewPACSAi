"""Claude 호출 단일 진입점 — CLAUDE.md 절대 규칙 3 (LLM 추상화).

- mode=live: claude-opus-4-8 + adaptive thinking + structured outputs(SR_SCHEMA).
- mode=mock: 결정적 초안 생성(개발/테스트/하네스) — API 키·네트워크 불필요.
모든 입력 텍스트는 deid.mask()를 통과한 상태로 전달되어야 하며,
본 모듈은 전송 직전 assert 검사로 이중 방어한다(절대 규칙 1).
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

from app.config import get_settings
from app.rag.deid import mask
from app.rag.retrieval import PriorReport, SimilarCase
from app.rag.schemas import SR_SCHEMA

SYSTEM_PROMPT = """당신은 영상의학과 판독 보조 시스템이다. 주어진 검사 정보, 동일 환자의 과거 판독,
유사 증례를 근거로 Structured Report 초안을 생성한다.

규칙:
1. 근거 없는 소견을 만들지 마라. 과거 판독·유사 증례·임상정보에 근거가 없으면 findings에 넣지 않는다.
2. 유사 증례가 부족하면 comparison.summary에 "참고 증례 부족"을 명시한다.
3. 모든 출력은 한국어 의학 문체. 계측치는 근거 자료에 있는 값만 사용한다.
4. 이것은 초안(draft)이며 최종 판독은 의료인이 한다. ai_meta.caveats에 한계를 명시한다.
5. critical 소견(기흉, 대량출혈, 급성 경색 의심 등)은 severity='critical'로 표기한다.
6. comparison.prior_study_refs에는 비교에 사용한 과거 검사의 StudyUID 값을 자료에 적힌 그대로
   복사해 넣는다(날짜·검사명으로 바꾸지 마라). 비교하지 않았다면 빈 배열로 둔다."""


@dataclass
class GenerationInput:
    modality: str
    body_part: str
    study_desc: str
    clinical_info: str
    priors: list[PriorReport] = field(default_factory=list)
    similars: list[SimilarCase] = field(default_factory=list)


@dataclass
class GenerationResult:
    sr_json: dict
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_sec: float = 0.0
    sources: dict = field(default_factory=dict)


def build_context(gi: GenerationInput) -> str:
    """가변 컨텍스트(캐시 브레이크포인트 뒤) — PHI는 호출 전에 마스킹돼 있어야 한다."""
    parts = [
        f"## 검사 정보\n- Modality: {gi.modality}\n- 부위: {gi.body_part}\n"
        f"- 검사명: {gi.study_desc}\n- 임상정보: {gi.clinical_info or '(없음)'}",
    ]
    if gi.priors:
        lines = [
            f"- [{p.study_date}] {p.modality} {p.study_desc} (StudyUID: {p.study_uid})\n"
            f"{p.narrative_text}".strip()
            for p in gi.priors
        ]
        parts.append("## 동일 환자 과거 판독 (시간 역순)\n" + "\n\n".join(lines))
    else:
        parts.append("## 동일 환자 과거 판독\n(없음)")
    if gi.similars:
        lines = [f"- (유사도 {s.score}) {s.chunk_text}" for s in gi.similars]
        parts.append("## 유사 증례 판독 (참고)\n" + "\n".join(lines))
    else:
        parts.append("## 유사 증례 판독\n(참고 증례 부족)")
    return "\n\n".join(parts)


def generate_draft(gi: GenerationInput) -> GenerationResult:
    settings = get_settings()
    sources = {
        "prior_report_ids": [p.report_id for p in gi.priors],
        "similar_report_ids": [{"id": s.report_id, "score": s.score} for s in gi.similars],
    }
    if settings.ai_mode == "live":
        return _generate_live(gi, sources)
    return _generate_mock(gi, sources)


def _generate_live(gi: GenerationInput, sources: dict) -> GenerationResult:
    import anthropic

    from app.rag.deid import assert_no_phi

    context = build_context(gi)
    assert_no_phi(context)  # 이중 방어 — PHI 잔존 시 전송 중단

    settings = get_settings()
    client = anthropic.Anthropic()
    t0 = time.monotonic()
    response = client.messages.create(
        model=settings.ai_model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={
            "effort": "high",
            "format": {"type": "json_schema", "schema": SR_SCHEMA},
        },
        system=[{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},  # 고정 prefix 캐싱
        }],
        messages=[{"role": "user", "content": context}],
    )
    latency = time.monotonic() - t0
    text = next(b.text for b in response.content if b.type == "text")
    return GenerationResult(
        sr_json=json.loads(text),
        model=settings.ai_model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        latency_sec=round(latency, 2),
        sources=sources,
    )


def _generate_mock(gi: GenerationInput, sources: dict) -> GenerationResult:
    """결정적 mock 초안 — 검색 결과를 실제로 반영해 RAG 파이프라인을 검증 가능하게 한다."""
    has_priors = bool(gi.priors)
    comparison_summary = (
        f"과거 검사 {len(gi.priors)}건과 비교함 (최근: {gi.priors[0].study_date})."
        if has_priors
        else "비교 가능한 과거 검사 없음."
    )
    if not gi.similars:
        comparison_summary += " 참고 증례 부족."

    # 임상정보/검사명에서 critical 키워드 탐지 (mock 수준의 휴리스틱)
    crit_keywords = ("pneumothorax", "기흉", "hemorrhage", "출혈", "infarct", "경색")
    text_pool = f"{gi.study_desc} {gi.clinical_info}".lower()
    is_critical = any(k in text_pool for k in crit_keywords)

    findings = [
        {
            "organ": gi.body_part or "전반",
            "observation": (
                f"{gi.study_desc} 검사에서 임상정보({mask(gi.clinical_info).text or '없음'}) 관련 "
                "이상 소견 평가함."
            ),
            "severity": "critical" if is_critical else "normal",
            "measurements": [],
        }
    ]
    impression = [
        {
            "rank": 1,
            "statement": (
                "임상적으로 의심되는 급성 소견 가능성 — 즉시 확인 필요."
                if is_critical
                else "특이 급성 소견 시사 근거 없음 (초안)."
            ),
            "confidence": "moderate" if has_priors else "low",
            "codes": [],
        }
    ]
    sr = {
        "exam": {
            "modality": gi.modality,
            "body_part": gi.body_part,
            "technique": gi.study_desc,
        },
        "comparison": {
            "prior_study_refs": [p.study_uid for p in gi.priors],
            "summary": comparison_summary,
        },
        "findings": findings,
        "impression": impression,
        "recommendations": (
            [{"action": "임상 소견과 대조 및 응급 확인", "timeframe": "즉시"}] if is_critical else []
        ),
        "ai_meta": {"caveats": ["AI 생성 초안 — 반드시 판독의 검토 필요", "mock 모드 생성물"]},
    }
    return GenerationResult(sr_json=sr, model="mock", sources=sources)
