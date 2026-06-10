# CLAUDE.md — Saintview PACS AI 개발 가이드

> 이 파일은 Claude(Code/Cowork)가 Saintview PACS AI를 개발할 때 따르는 **단일 진실 공급원(SSOT)** 이다.
> 제품 설계는 `docs/DESIGN_SaintviewPACSai_설계.md` 참조. 모든 작업은 설계 문서의 결정(§0)과 로드맵(§11)을 따른다.
> 상용 PACS 기능 벤치마크는 `docs/ANALYSIS_INFINITT_PiViewSTAR_분석.md` 참조(기능 정의·UX 원칙·DICOM 적합성 목표의 근거).
> 프론트엔드 화면·컴포넌트 작업 시: 기능-화면 매핑은 `docs/UI_ANALYSIS_PiViewSTAR_화면분석.md`(존 모델), **시각 디자인·레이아웃·컴포넌트 구조는 `docs/UI_DESIGN_Saintview_화면디자인.md`가 최종 기준**(디자인 토큰 §1, 워크리스트 5구역 §3, 뷰어 §4, 구현 순서 §5). 보라(#a78bfa)는 AI 생성물 전용 색 — 다른 용도 사용 금지.

---

## 1. 제품 한 줄 요약

**웹 기반 PACS + AI 판독 보조 플랫폼.** DICOM을 수신·보관·조회(OHIF 뷰어)하고, 자체 영상 DB와 판독 DB를 RAG로 분석해 **Structured Report 초안**을 생성·제공한다. 최종 판독은 반드시 의료인이 검토·승인한다(초안 포지셔닝 — 절대 변경 금지).

## 2. 기술 스택 (확정)

| 계층 | 기술 |
|---|---|
| 백엔드 | Python 3.11+ / FastAPI / SQLAlchemy / Alembic |
| 프론트엔드 | React + OHIF Viewer (Cornerstone3D), DICOMweb 연동 |
| LLM | Claude API `claude-opus-4-8`, adaptive thinking, structured outputs(`output_config.format`), 프롬프트 캐싱, 대량 백필은 Batches API |
| DICOM | Orthanc(권장, PoC로 확정) + pydicom/highdicom |
| DB | PostgreSQL + pgvector 권장 (설계 §3.3, 미확정 D-1) |
| 배포 | docker-compose (deploy/) |

## 3. 절대 규칙

1. **PHI 게이트:** Claude API로 나가는 모든 텍스트·이미지는 `rag/deid.py` 비식별화 계층을 통과해야 한다. 우회 호출 금지. 로그에 환자명/등록번호 출력 금지.
2. **초안 포지셔닝:** AI 산출물은 어디서나 "초안(draft)"으로 표기. 확정(finalize)은 사용자 행위로만 가능.
3. **LLM 추상화:** Claude 호출은 `rag/generate.py` 단일 진입점 경유(온프레미스 폴백 R-2 대비).
4. **시크릿:** API 키·DB 자격증명은 환경변수로만. 코드/커밋에 평문 금지.
5. **하네스 우선:** S0 하네스(합성 DICOM 스모크 + RAG 평가셋) 없이 코어 기능 구현 금지. RAG 프롬프트/모델 변경 시 평가 하네스 회귀 확인 후 머지.
6. **계층 의존성:** `frontend → api → services → repositories`. API 라우터에 도메인 로직 금지, services에서 DB 직접 SQL 금지(repository 경유).

## 4. Claude API 사용 규칙

```python
# rag/generate.py 표준 호출 형태
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=16000,
    thinking={"type": "adaptive"},
    output_config={
        "effort": "high",
        "format": {"type": "json_schema", "schema": SR_SCHEMA},  # 설계 §6.2
    },
    system=[{"type": "text", "text": SYSTEM_PROMPT,             # 고정 prefix
             "cache_control": {"type": "ephemeral"}}],
    messages=[{"role": "user", "content": build_context(study)}],  # 가변부는 캐시 뒤
)
```

- `temperature`/`top_p`/`budget_tokens`는 opus-4-8에서 400 에러 — 사용 금지.
- 긴 출력은 `messages.stream()` 사용.
- 모든 호출에 사용 토큰(usage) 로깅 → 검사당 비용 추적(설계 §10).

## 5. 코딩 컨벤션

- Python: PEP8, snake_case, type hints 필수. Pydantic v2 스키마.
- TypeScript: 함수형 컴포넌트 + hooks. OHIF 커스터마이징은 `frontend/src/ohif/`에 격리.
- 한글 주석/로그 허용(운영팀 가독성). 사용자 노출 메시지는 한국어.
- 새 의존성 추가 시 `requirements.txt`/`package.json` 갱신 + 사유 기록.
- DB 변경은 반드시 Alembic 마이그레이션으로.

## 6. 빌드 / 실행 / 테스트

```bash
# 인프라 (Postgres + Orthanc)
docker compose -f deploy/docker-compose.yml up -d

# 백엔드
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload

# 프론트엔드
cd frontend && npm install && npm run dev

# 테스트 / 하네스
cd backend && pytest
python harness/smoke_dicom_pipeline.py     # 합성 DICOM → 수신 → 뷰어 표시
python harness/eval_rag.py                 # RAG 품질 회귀 평가 (릴리스 게이트)
```

## 7. 현재 상태 / 다음 단계

- [x] 설계 문서 v0.1 (`docs/DESIGN_SaintviewPACSai_설계.md`)
- [x] INFINITT PiViewSTAR 벤치마크 분석 → 기능 요구 F-13~F-19 반영 (`docs/ANALYSIS_INFINITT_PiViewSTAR_분석.md`)
- [x] Worklist/Viewer 화면별 기능 분석 → React 컴포넌트 매핑 (`docs/UI_ANALYSIS_PiViewSTAR_화면분석.md` — 프론트엔드 구현 기준 문서)
- [x] 설정(Setting options)·툴바 플라이아웃 추가 분석 → 설정 IA 2계층(사용자/관리자) 확정 (화면분석 §5)
- [x] Worklist 소스별 설정·Report 외부연동 분석 → `app_setting` scope 모델(global/source/user), 컬럼·검색필드 사용자화 F-8 반영 (화면분석 §5.5~5.7)
- [x] Report 코드사전(Reading/Dx/Fx)·Print·Viewer 설정 분석 → 코드사전 Modality×BodyPart 축(F-18), PDF 템플릿 설정, 오버레이 3계층 토글(Alt+I/A/S)·도구별 주석 색상 (화면분석 §5.6~5.8)
- [x] Window 설정·Find criteria/Header Columns/External Link·Print 다이얼로그 분석 → **F-20(AI-판독의 불일치 추적)·F-21(외부 링크/딥링크) 신설**, 워크리스트 필드 인벤토리·듀얼리스트 패턴·출력 파이프라인 UX (화면분석 §5.9~5.12) — **INFINITT 화면 분석 전체 완결**
- [x] **목표 화면 디자인 확정** (`docs/UI_DESIGN_Saintview_화면디자인.md`) — 차세대 PACS 레퍼런스 기반 다크 디자인 토큰, 워크리스트 5구역(한 화면 컨텍스트), 검사 탭+도구 팔레트 뷰어, F-22(일괄 검토 모드) 신설, 컴포넌트 트리·구현 순서 확정
- [x] 미결정 확정(2026-06-11): D-1 PostgreSQL+pgvector / D-2 임베딩 추상화(local 폴백) / D-3 Orthanc / D-4 PDF 우선
- [x] **S0~S4 백엔드 구현 완료(2026-06-11)**: FastAPI(auth/worklist/reports/admin) + 모델 9종 + RAG(deid/embeddings/retrieval/generate mock·live) + AI 워커 + Orthanc 동기화. **pytest 15/15 통과**
- [x] 하네스: `harness/smoke_dicom_pipeline.py` **SMOKE PASS**(DICOM→Orthanc→QIDO→Postgres 동기화→AI 초안), `harness/eval_rag.py` **EVAL PASS**(스키마 5/5·critical 2/2·PHI 1/1)
- [x] 프론트엔드: Vite+React+TS, 디자인 토큰(theme.css), 로그인+워크리스트(필터바·StudyGrid·Related Exams·AI 리포트 패널·확정 흐름). 빌드 통과
- [x] **2차 구현 완료(2026-06-11)**: OHIF 뷰어 통합(compose `ohif` 서비스 + nginx `/dicom-web` 프록시, View&Draft 더블클릭/버튼 연동) · Orthanc 자동 동기화 워커(변경 피드 폴링, seq 영속화) · Alembic 초기 마이그레이션(`bc8a938bfda7`, 신규 DB 검증) · **PDF 출력**(한글 CID 폰트, 사이트 템플릿 `pdf.template`, AI 초안 경고) · **F-22 일괄 검토**(critical 자동 제외 + batch-finalize + 모달). **pytest 20/20**
- [x] **live AI 모드 검증 완료(2026-06-11)**: `claude-opus-4-8` 실호출 — 구조화 출력 100% 유효, prior UID 반영(프롬프트 보정 1fa52e2), **환각 억제 확인**(근거 없는 케이스에서 "자료 부족, 재판독 필요"로 응답). 서버 전구간 E2E(업로드→자동 감지→live 초안) PASS. 비용 ≈ \$0.02/건, 11~23s. 키는 `backend/.env`(gitignore) — **절대 커밋 금지**
- [ ] 남은 것: DICOM SR 출력(P1 후반), 행잉 프로토콜·GSPS(F-16/F-18), 사용자 설정 화면, 키이미지 vision 분석(F-11, P2)
- 실행: `docker compose -f deploy/docker-compose.yml up -d` (db+orthanc+**OHIF:3000**) → `cd backend && py -3.11 -m uvicorn app.main:app` → `cd frontend && npm run dev` (admin/admin1234, 운영 전 변경). DB 스키마는 `alembic upgrade head`

---

*작업 전 설계 문서의 관련 섹션을 읽고, 결정 변경 시 설계 §0 Decision Record를 갱신하라.*
