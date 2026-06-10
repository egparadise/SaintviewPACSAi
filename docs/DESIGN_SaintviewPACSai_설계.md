# Saintview PACS AI — 제품 설계 문서 (v0.1 초안)

> 작성일: 2026-06-10. 이 문서는 Saintview PACS AI의 **기준 설계 문서(SSOT)** 다.
> 구현 전 본 문서를 검토·확정하고, 변경 시 §0 결정 기록을 갱신한다.

---

## 0. 확정된 핵심 결정 (Decision Record)

| 항목 | 결정 | 일자 | 비고 |
|---|---|---|---|
| 제품 형태 | **웹 기반 PACS 플랫폼** | 2026-06-10 | 데스크톱 아님. 브라우저로 구동 |
| 핵심 가치 | 자체 영상 DB + 판독 DB를 **RAG로 분석**하여 **Structured Report 초안 생성·제공** | 2026-06-10 | |
| 백엔드 | **Python FastAPI** | 2026-06-10 | SaintRouter에서 축적한 pydicom/pynetdicom 노하우 재활용 |
| 프론트엔드 | **React + OHIF Viewer (Cornerstone3D)** | 2026-06-10 | 의료영상 웹뷰어 사실상 표준. DICOMweb으로 연동 |
| LLM | **Claude API (`claude-opus-4-8`)** | 2026-06-10 | adaptive thinking + structured outputs. PHI 비식별화 후 전송(§8) |
| SaintRouter와의 관계 | **완전 독립 제품** | 2026-06-10 | 별도 저장소·별도 DB·자체 C-STORE 수신부 |
| 첫 산출물 | 설계 문서 → 검토 후 MVP 구현 | 2026-06-10 | |
| 기능 벤치마크 | **INFINITT PiViewSTAR/RapidiaMPR 정밀 분석** 채택 | 2026-06-11 | `docs/ANALYSIS_INFINITT_PiViewSTAR_분석.md` — 기능 갭 G-1~G-12를 §2.1에 반영 |
| **화면 디자인** | **차세대 PACS 레퍼런스 디자인 채택** | 2026-06-11 | `docs/UI_DESIGN_Saintview_화면디자인.md` — 다크 토큰·워크리스트 5구역·검사 탭+도구 팔레트 뷰어. PiViewSTAR 기능 × 레퍼런스 디자인 결합 |
| **신규 기획문서 채택** | PACS_AI 개발문서(01~06)+UBPACS-Z 지침을 보완 명세로 채택 | 2026-06-11 | `docs/ANALYSIS_신규기획문서_갭분석.md` — 03b 훅 5대 정책은 필수 게이트, 05 Mode Profile은 차별화 로드맵(대), UBPACS-Z UX 체크리스트 순차 반영 |

**미결정 확정(2026-06-11):**
| ID | 결정 | 비고 |
|---|---|---|
| D-1 | **PostgreSQL + pgvector** | 단일 DB로 메타데이터+벡터. 개발 환경은 SQLite 폴백(벡터는 인메모리) |
| D-2 | **임베딩 추상화 계층** (`rag/embeddings.py`) | 운영: Voyage AI 우선(키 필요), 개발/테스트: 결정적 로컬 해시 임베딩 폴백. 한국어 성능 비교 후 최종 모델 교체 가능 |
| D-3 | **Orthanc 내장** (docker-compose) | DICOMweb(QIDO/WADO/STOW) 위임, 자체 DB는 메타 동기화 |
| D-4 | **PDF 우선** → DICOM SR(P1 후반) → FHIR(P2) | |

---

## 1. 제품 개요

**Saintview PACS AI**는 의료영상을 수신·보관·조회하는 웹 PACS에, **AI 판독 보조**를 결합한 플랫폼이다.

핵심 흐름:

```
[Modality/타 PACS] --C-STORE/STOW-RS--> [수신·저장 계층] --> 영상 DB (메타데이터 + 픽셀)
                                                              │
[기존 판독문 아카이브] --인제스트--> 판독 DB --임베딩--> 벡터 인덱스
                                                              │
신규 검사 도착 ──> RAG 파이프라인 ──────────────────────────────┤
   ① 검사 메타데이터·영상(키 이미지) 추출                        │
   ② 판독 DB에서 유사 사례·과거 판독 검색 (환자 과거력 + 유사증례)  │
   ③ Claude API 분석 → Structured Report 초안 생성              │
                                                              ▼
[웹 UI: OHIF 뷰어 + 워크리스트 + SR 편집기] ──> 판독의 검토·수정·승인 ──> 확정 판독 저장(판독 DB로 환류)
```

**중요한 제품 포지셔닝:** AI가 생성하는 것은 **판독 초안(draft)** 이며, 최종 판독은 반드시 의료인이 검토·승인한다. 이는 UX·데이터모델·규제 대응(§8.3) 전반의 전제다.

---

## 2. 요구사항

### 2.1 기능 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| F-1 | DICOM C-STORE SCP 수신 + STOW-RS 업로드로 영상 입수 | P0 |
| F-2 | 영상 메타데이터 인덱싱(환자/검사/시리즈/인스턴스 4계층) 및 검색(QIDO-RS). **진단·소견 검색 포함**(SR JSONB의 findings/impression/severity 조건 검색 — 화면분석 §1.2 Z4, 표준 PACS 대비 우위 지점) | P0 |
| F-3 | 웹 뷰어(OHIF)에서 영상 조회(WADO-RS), 윈도잉·측정 등 기본 도구 | P0 |
| F-4 | 판독 DB: 기존 판독문 대량 인제스트 + 신규 확정 판독 저장 | P0 |
| F-5 | RAG: 신규 검사에 대해 환자 과거 판독 + 유사 증례 검색 | P0 |
| F-6 | Claude 기반 분석 → **Structured Report 초안** 자동 생성 | P0 |
| F-7 | SR 편집기: 초안 검토·수정·승인 워크플로(초안→검토중→확정) | P0 |
| F-8 | 워크리스트: 미판독/AI초안완료/확정 상태별 검사 목록. **컬럼 구성·검색필드 구성·패널 배치 사용자화**(서버 저장 로밍, 화면분석 §5.5) | P1 |
| F-9 | SR 출력: PDF + DICOM SR(TID 1500) 및/또는 FHIR DiagnosticReport | P1 |
| F-10 | 사용자/권한: 판독의·관리자 역할, 감사 로그. **설정 2계층**(사용자 설정: 기본필터·정렬·자동검색·레이아웃·툴바 프리셋·더블클릭 동작 / 관리자 설정: DICOM 노드 관리+C-ECHO 테스트·스토리지·AI 정책) — IA는 화면분석 §5.5 | P1 (사용자 기본필터·자동검색은 P0) |
| F-11 | 영상 자체 분석(키 이미지 vision 분석)을 RAG 컨텍스트에 추가 | P2 |
| F-12 | 외부 AI 결과(SaintRouter 경유 등) 수신·SR에 병합 | P2 |
| F-13 | 뷰어 측정·주석 최소 세트: W/L 프리셋, Zoom/Pan, 길이/각도/ROI, Cobb's angle, CT ratio, 픽셀 캘리브레이션 (벤치마크 G-1) | P0 |
| F-14 | Related Exams: 동일 환자 과거검사 자동 연결 + 비교 뷰포트 (벤치마크 G-4, RAG 환자 축의 UI 노출) | P0 |
| F-15 | Emergency/STAT 플래그 + 워크리스트 상태 색상 — critical findings(§6.2)와 통합 (벤치마크 G-6) | P0 |
| F-16 | 주석·키이미지의 DICOM 표준 보존: GSPS + Key Object Selection (벤치마크 G-2) | P1 |
| F-17 | 2차 승인(approved2, 옵션) + 전자서명 메타데이터 (벤치마크 G-3) | P1 |
| F-18 | SR 편집기 상용구(Predefined Readings) + 행잉 프로토콜(모달리티별 레이아웃) (벤치마크 G-5/G-10). **상용구·진단·소견 코드 사전은 `Modality × BodyPart` 축으로 분류 관리**(화면분석 §5.6 — RAG 유사증례 1차 필터와 동일 축), 공통 `CodeDictionaryEditor` 컴포넌트. AI impression→사이트 진단코드 자동 매핑은 P2 | P1 |
| F-19 | 비DICOM 영상 업로드→SC 변환, Exam Merge/Split, DICOM 헤더 뷰어, 만료형 공유 링크 (벤치마크 G-7~G-9/G-11) | P2 |
| F-20 | **AI-판독의 불일치 추적**: 초안 vs 확정본 차이 지표(diff·수정률) 저장 → AI 품질 대시보드(§10 수용도의 데이터 원천) + critical 소견 탈락/추가 시 리뷰 알림 (화면분석 §5.10 — PiViewSTAR의 ED 예비판독 불일치 워크플로를 AI에 전환) | P2 |
| F-21 | 외부 연동 링크: 나가는 링크(변수 치환 URL 템플릿, 관리자 설정 슬롯) + 들어오는 딥링크(`/study/{studyUid}`) (화면분석 §5.11) | P2 |
| F-22 | **AI 초안 일괄 검토 모드**: critical 없음+고신뢰 초안을 다중 선택 → 순차 검토·일괄 확정 (디자인 명세 §3.3 — 레퍼런스 Multi Report/Concurrent Confirm의 AI 전환, 판독 처리량 핵심 동선) | P1 |

> **벤치마크 출처:** `docs/ANALYSIS_INFINITT_PiViewSTAR_분석.md` (INFINITT PiViewSTAR 전수 기능 조사). 의도적 제외 항목(음성 딕테이션/전사, DICOM Print, CD 굽기, 모뎀 원격판독, 임플란트 템플레이팅, 3D MPR)은 동 문서 §7 참조.
> **화면 설계 기준:** 기능-화면 매핑은 `docs/UI_ANALYSIS_PiViewSTAR_화면분석.md`(존 모델), **시각 디자인·레이아웃은 `docs/UI_DESIGN_Saintview_화면디자인.md`(2026-06-11 확정)** — 다크 디자인 토큰, 워크리스트 5구역 레이아웃(한 화면 컨텍스트 원칙), 검사 탭+좌측 도구 팔레트형 뷰어, **보라=AI 생성물 전용 색상**. 핵심 동선: **워크리스트→판독 시작 ≤ 2클릭(View&Draft), AI 초안 확인 ≤ 1클릭(리포트 패널)**, 마우스 바인딩(우드래그 W/L·휠 스크롤), 뷰포트 4코너 오버레이 규칙.
> **UX 원칙(벤치마크 §6 채택):** 판독실 다크 테마 기본 + 키보드 우선 설계. 워크플로는 `도착→AI 초안(draft)→검토(in_review)→확정(finalized)` — INFINITT의 Dictate/Transcribe 2단계를 AI 초안이 대체하는 것이 핵심 차별점.

### 2.2 비기능 요구사항

| 항목 | 목표 |
|---|---|
| 동시 사용자 | 초기 10~30명(병원 1곳 판독실 규모) |
| 영상 조회 첫 이미지 표시 | < 2s (LAN) |
| AI 초안 생성 소요 | 검사 도착 후 < 60s (비동기, 도착 즉시 백그라운드 생성) |
| 저장 규모 | 초기 10TB급, 확장 가능 설계 |
| 가용성 | 단일 서버 + 일일 백업으로 시작, HA는 후순위 |
| PHI 보호 | LLM 외부 전송 데이터는 비식별화 필수(§8.1) |

---

## 3. 시스템 아키텍처

```
┌──────────────────────────── 웹 브라우저 ────────────────────────────┐
│  React SPA: 워크리스트 │ OHIF Viewer │ SR 편집기 │ 관리 설정          │
└──────────────┬──────────────────────────────────────────────────────┘
               │ HTTPS (REST + DICOMweb)
┌──────────────▼──────────────────────────────────────────────────────┐
│                    FastAPI 백엔드 (api/)                             │
│  auth │ worklist │ reports │ rag │ admin │ DICOMweb(QIDO/WADO/STOW) │
└──┬───────────┬───────────────┬──────────────────┬───────────────────┘
   │           │               │                  │
   │     ┌─────▼─────┐   ┌─────▼──────┐    ┌──────▼───────┐
   │     │ RDBMS     │   │ 벡터 인덱스 │    │ 작업 큐       │
   │     │ (메타데이터│   │ (pgvector) │    │ (RAG 워커)    │
   │     │ +판독 DB) │   └─────┬──────┘    └──────┬───────┘
   │     └───────────┘         │                  │
┌──▼────────────────┐          │           ┌──────▼─────────────────┐
│ DICOM 저장 계층     │          │           │ RAG 파이프라인 (rag/)   │
│ - C-STORE SCP     │          └───────────│ 검색→프롬프트→Claude API│
│ - 파일 스토리지     │                      │ →SR 초안 저장           │
└───────────────────┘                      └────────────────────────┘
```

### 3.1 계층 규칙

`ui(React) → api(FastAPI) → service → repository(DB)/dicom(저장)`. UI는 REST/DICOMweb만 사용. RAG 워커는 service 계층을 공유하되 HTTP를 거치지 않고 직접 호출.

### 3.2 DICOM 저장 계층 — 선택지 (미결정 D-3)

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. **Orthanc 내장** (권장) | 오픈소스 DICOM 서버 Orthanc를 저장·DICOMweb 백엔드로 두고 FastAPI가 프록시·확장 | C-STORE/QIDO/WADO/STOW 검증된 구현을 즉시 확보, OHIF 연동 실적 풍부 | 외부 의존성, Orthanc DB와 자체 DB 이중화 관리 |
| B. 자체 구현 | pynetdicom SCP + 자체 스토리지 + DICOMweb 직접 구현 | 단일 코드베이스, SaintRouter 노하우 활용 | DICOMweb 전체 스펙 구현 비용 큼(특히 WADO-RS 프레임/썸네일) |

**권고:** MVP는 **A안**. 자체 DB에는 워크리스트·판독·RAG에 필요한 메타데이터만 동기화(Orthanc 이벤트 훅 활용)하고, 픽셀 접근은 Orthanc DICOMweb에 위임한다.

### 3.3 RDBMS — 선택지 (미결정 D-1)

**PostgreSQL + pgvector 권장.** 판독문 임베딩 벡터 검색을 같은 DB에서 처리(별도 벡터DB 불필요), JSONB로 SR 구조 저장 용이. 팀이 MariaDB에 익숙하지만 본 제품은 독립 신규 구축이므로 RAG 적합성을 우선한다. MariaDB 채택 시 벡터 검색은 별도 구성 필요.

---

## 4. RAG 파이프라인 설계

### 4.1 인제스트 (판독 DB 구축)

```
기존 판독문(텍스트/HL7/DB덤프) → 정규화(검사식별자 매핑, 섹션 분리: 소견/결론/권고)
→ PHI 마스킹 → 청킹(판독문 단위 기본, 장문은 섹션 단위) → 임베딩 → report_embeddings 저장
```

- **임베딩 모델(미결정 D-2):** Claude API는 임베딩을 제공하지 않는다. 후보: Voyage AI `voyage-3`(Anthropic 권장 파트너, 의료 텍스트 성능 양호) 또는 온프레미스 한국어 임베딩(예: BGE-M3 로컬 서빙). 한국어 판독문 비중이 높으므로 **다국어 성능 기준으로 비교 평가 후 결정**. 추상화 계층(`rag/embeddings.py`)을 두어 교체 가능하게 설계.
- 신규 확정 판독은 승인 시점에 자동 인제스트(환류 루프).

### 4.2 검색 (Retrieval)

신규 검사에 대해 두 축으로 검색한다:

1. **환자 축(필수):** 동일 환자의 과거 검사·판독 전체를 시간순 수집 — 비교판독(comparison)의 근거. 벡터 검색이 아닌 정확 조회.
2. **유사 증례 축:** 검사 메타데이터(모달리티·부위·검사명)로 1차 필터 후, 의뢰사유/임상정보 텍스트로 벡터 검색 top-k(k=5~10). 확정 판독만 대상.

### 4.3 생성 (Claude API)

- 모델: `claude-opus-4-8`, `thinking={"type": "adaptive"}`, `output_config={"effort": "high"}`.
- **Structured Outputs 사용:** SR 스키마(§6.2)를 `output_config.format`의 `json_schema`로 강제 → 파싱 실패 없는 구조화 출력 보장.
- **프롬프트 캐싱:** 시스템 프롬프트(판독 지침·SR 작성 규칙·모달리티별 템플릿)는 고정 prefix로 두고 `cache_control` 적용. 검사별 가변 컨텍스트(과거 판독, 유사 증례, 임상정보)는 캐시 브레이크포인트 뒤에 배치.
- **영상 vision 분석(F-11, P2):** 키 이미지를 PNG 렌더링 후 vision 입력으로 추가 가능. 단, **Claude는 의료영상 진단용으로 검증된 모델이 아니므로** 영상 소견은 "참고 관찰"로만 표기하고 텍스트 RAG 근거와 구분한다.
- 비동기 처리: 검사 도착 이벤트 → 작업 큐 → RAG 워커가 생성 → `reports` 테이블에 `status='draft'`로 저장. 대량 백필(과거 검사 일괄 분석)은 **Batches API**(50% 비용)로 처리.

### 4.4 SR 초안 품질 장치

- 모든 초안에 **근거 출처 명시**: 어떤 과거 판독/유사 증례를 참조했는지 ID와 함께 SR 메타데이터에 기록(추적성).
- 유사 증례가 임계치 미달(검색 점수 낮음)이면 해당 섹션을 비우고 "참고 증례 부족"으로 표기 — 환각 억제.
- 초안 화면에 "AI 생성 초안 — 반드시 검토 필요" 배지 상시 표시.

---

## 5. 데이터 모델 (초안)

```sql
-- 영상 계층 (Orthanc 채택 시 동기화 사본; 워크리스트·RAG 조인용)
patients(id, patient_key, name_masked, birth_date, sex, created_at)
studies(id, patient_id, study_uid UNIQUE, accession_no, study_date, modality,
        body_part, study_desc, clinical_info, orthanc_id, status, created_at)
        -- status: received | draft_ready | reading | finalized
series(id, study_id, series_uid UNIQUE, modality, series_desc, instance_count)

-- 판독 DB
reports(id, study_id, version, status,           -- draft | in_review | finalized | rejected
        sr_json JSONB,                           -- §6.2 구조
        narrative_text,                          -- 전문(全文) 텍스트
        created_by,                              -- 'ai' | user_id
        reviewed_by, finalized_at,
        ai_model, ai_sources JSONB,              -- 참조한 과거판독/증례 ID 목록
        created_at, updated_at)

report_embeddings(id, report_id, chunk_seq, section, embedding vector(1024),
                  chunk_text, created_at)

-- 운영
accounts(id, username UNIQUE, password_hash, algo, role,  -- radiologist | admin
         created_at, last_login)
audit_log(id, account_id, action, target_type, target_id, detail JSONB, created_at)
ai_jobs(id, study_id, kind, status, error, started_at, finished_at)
app_setting(id, scope, scope_id, key, value JSONB, updated_at)
  -- scope: 'global' | 'source' | 'user' — 우선순위 user > source > global (화면분석 §5.7 교훈 5)
  -- 워크리스트 컬럼구성·검색필드·패널배치 등 사용자 설정의 서버 저장(로밍) 포함
```

판독 이력은 `reports.version`으로 보존(초안→수정본→확정본 모두 행으로 남김). 확정본만 임베딩 인제스트 대상.

---

## 6. Structured Report 설계

### 6.1 표준 정합성

내부 표현은 **자체 JSON 스키마**(§6.2)로 단일화하고, 출력 시 변환한다:

- **PDF** (P1): 병원 배포용 — 내부 JSON → 템플릿 렌더링. **헤더/푸터/기관·부서명/페이지번호는 사이트 설정으로 외부화**(화면분석 §5.7 — 공식 문서로서의 판독서 요구).
- **DICOM SR TID 1500** (P1): PACS 생태계 호환 — pydicom `highdicom` 라이브러리로 생성.
- **FHIR DiagnosticReport** (P2): EMR 연동 대비.

### 6.2 내부 SR JSON 스키마 (Claude structured output 스키마와 동일)

```json
{
  "exam": {"modality": "CT", "body_part": "...", "technique": "..."},
  "comparison": {"prior_study_refs": ["..."], "summary": "..."},
  "findings": [
    {"organ": "...", "observation": "...", "severity": "normal|minor|significant|critical",
     "measurements": [{"name": "...", "value": 0, "unit": "mm"}]}
  ],
  "impression": [{"rank": 1, "statement": "...", "confidence": "low|moderate|high",
                  "codes": []}],  // 사이트 진단/소견 코드 매핑(P2, 화면분석 §5.6) — 검색·통계·RAG 라벨용
  "recommendations": [{"action": "...", "timeframe": "..."}],
  "ai_meta": {"generated_by": "claude-opus-4-8", "source_report_ids": [], "caveats": ["..."]}
}
```

`severity=critical` 항목 존재 시 워크리스트에서 해당 검사를 최우선 정렬 + 시각 경고(critical findings 알림은 판독 지연을 줄이는 핵심 가치).

---

## 7. API 설계 (초안)

```
POST   /api/auth/login                     로그인(JWT)
GET    /api/worklist?status=&modality=     워크리스트
GET    /api/studies/{id}                   검사 상세(+ AI 초안 상태)
POST   /api/studies/{id}/analyze           AI 초안 (재)생성 트리거
GET    /api/studies/{id}/reports           판독 이력
PUT    /api/reports/{id}                   초안 수정 저장
POST   /api/reports/{id}/finalize          확정(서명) → 인제스트 환류
GET    /api/reports/{id}/export?format=pdf|dicom-sr
GET    /api/admin/ai-jobs                  AI 작업 모니터링
-- DICOMweb (Orthanc 프록시)
GET    /dicom-web/studies?...              QIDO-RS (OHIF 데이터소스)
GET    /dicom-web/studies/{uid}/...        WADO-RS
POST   /dicom-web/studies                  STOW-RS
```

---

## 8. 보안·프라이버시·규제

### 8.1 PHI 비식별화 (LLM 전송 게이트) — **필수 게이트**

Claude API로 전송되는 모든 텍스트·이미지는 비식별화 계층(`rag/deid.py`)을 통과한다:

- 환자명·등록번호·생년월일·연락처·주소를 토큰으로 치환(`[PATIENT]`, `[ID]` 등). 나이·성별은 판독에 필요하므로 유지.
- DICOM 픽셀 전송 시(P2) 번인(burn-in) 텍스트 영역 검사·마스킹.
- 비식별화 전/후 매핑은 서버 내부에만 보관. **외부 전송 로그에 원본 PHI 금지.**
- Anthropic API는 기본적으로 입력을 모델 학습에 사용하지 않으나, 병원 계약·심의 요건에 따라 [Zero Data Retention 등 계약 옵션] 검토를 도입 병원과 협의.

### 8.2 일반 보안

- 전 구간 HTTPS. JWT + 역할 기반 권한(판독의/관리자). 비밀번호 argon2 해시.
- 모든 판독 확정·수정·조회는 `audit_log` 기록(의료법상 추적성).
- DB 자격증명·API 키는 환경변수/OS 보안 저장소 — 코드·설정파일 평문 금지(SaintRouter §8 규칙 승계).

### 8.3 규제 메모 (한국)

- **AI 판독 초안 생성 기능은 식약처 의료기기 소프트웨어(SaMD) 해당 가능성이 높다.** "진단 보조" 표방 수준에 따라 2~3등급 인허가 대상이 될 수 있음 → **사업화 전 인허가 전략 검토 필수**(원내 연구용/비임상 보조 포지셔닝으로 시작하는 단계적 접근 권장).
- 개인정보보호법·의료법상 의료영상 외부(클라우드 API) 전송은 비식별화 + 병원 IRB/보안심의 대상. 온프레미스 LLM 폴백 경로(§12 R-2)를 아키텍처에 남겨둔다.

> 이 항목은 법률 자문이 아니다. 사업화 단계에서 전문 검토 필요.

---

## 9. 모듈 구조 (저장소 레이아웃)

```
SaintviewPACSai/
├── CLAUDE.md                  # 개발 가이드 (SSOT)
├── docs/                      # 본 설계 문서 등
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 엔트리
│   │   ├── api/               # 라우터 (auth/worklist/reports/admin/dicomweb 프록시)
│   │   ├── services/          # 도메인 로직
│   │   ├── repositories/      # DB 접근 (SQLAlchemy)
│   │   ├── models/            # ORM + Pydantic 스키마
│   │   ├── rag/               # deid.py, embeddings.py, retrieval.py, generate.py, schemas.py
│   │   ├── dicom/             # Orthanc 클라이언트, 이벤트 훅, SR 변환(highdicom)
│   │   └── workers/           # AI 작업 큐 워커
│   ├── migrations/            # Alembic
│   └── tests/                 # pytest (RAG 회귀 평가셋 포함)
├── frontend/
│   ├── src/
│   │   ├── pages/             # Worklist, Study, ReportEditor, Admin
│   │   ├── components/
│   │   └── ohif/              # OHIF 설정·확장
│   └── package.json
├── deploy/                    # docker-compose (orthanc, postgres, backend, frontend)
└── harness/                   # 합성 DICOM 송수신 + RAG 품질 평가 하네스
```

---

## 10. 평가 기준

| 축 | 지표 | 목표 |
|---|---|---|
| 사용성 | 워크리스트→판독 시작 | ≤ 2클릭 (View&Draft) |
| 사용성 | AI 초안 확인 | ≤ 1클릭 (워크리스트 미리보기 패널) |
| 속도 | 워크리스트 로딩 | < 1s |
| 속도 | 뷰어 첫 이미지 | < 2s (LAN) |
| 속도 | AI 초안 생성(도착→초안) | < 60s |
| AI 품질 | SR 스키마 적합률 | 100% (structured outputs로 보장) |
| AI 품질 | 판독의 초안 수용도(수정 없이/경미 수정 승인 비율) | 파일럿에서 측정 → 기준선 수립 |
| AI 품질 | 환각률(근거 없는 소견 비율, 평가셋 기준) | 평가 하네스로 측정, 릴리스 게이트 |
| 비용 | 검사당 AI 비용 | 측정 후 목표 설정 (캐싱+Batch로 최적화) |
| 보안 | LLM 전송 데이터 PHI 잔존 | 0 (deid 테스트 통과 필수) |

**RAG 평가 하네스(`harness/`):** 확정 판독 일부를 정답셋으로 떼어, AI 초안과의 섹션별 일치도(임상의 루브릭 기반 LLM-judge + 핵심 소견 누락 검사)를 자동 채점. 프롬프트·모델 변경 시 회귀 게이트로 사용 — SaintRouter의 통합 하네스 철학을 승계한다.

---

## 11. 구현 로드맵

각 Phase는 독립 완료 단위. **S0(골격+하네스) 없이 본 구현 금지**(SaintRouter 원칙 승계).

| Phase | 내용 | 산출물 |
|---|---|---|
| **S0** | 저장소 골격 + docker-compose(Postgres/Orthanc) + 합성 DICOM 수신→OHIF 표시 스모크 | 영상이 브라우저에 뜨는 최소 파이프 |
| **S1** | 영상 DB 동기화 + 워크리스트 + 로그인/권한 | 검사 목록·상태 관리 |
| **S2** | 판독 DB + 인제스트 파이프라인(deid→임베딩) + 검색 API | 과거 판독 검색 동작 |
| **S3** | RAG 생성: Claude 연동 + SR 스키마 + 초안 자동 생성 워커 | 검사 도착→초안 생성 |
| **S4** | SR 편집기 + 승인 워크플로 + 환류 인제스트 | 판독의 end-to-end 사용 가능 (**MVP 완성**) |
| **S5** | PDF/DICOM SR 출력 + critical findings 알림 + 감사 로그 | 운영 기능 |
| **S6** | 영상 vision 분석(P2) + 외부 AI 결과 병합 + 평가 하네스 고도화 | 차별화 기능 |

---

## 12. 리스크 & 미결정 사항

| ID | 항목 | 내용 / 다음 행동 |
|---|---|---|
| D-1 | RDBMS | PostgreSQL+pgvector 권장. 확정 필요 |
| D-2 | 임베딩 모델 | Voyage AI vs 온프레미스(BGE-M3 등). 한국어 판독문 샘플로 검색 품질 비교 후 결정 |
| D-3 | DICOM 백엔드 | Orthanc 내장(권장) vs 자체 구현. S0에서 Orthanc PoC로 검증 |
| D-4 | SR 출력 표준 | PDF 우선, DICOM SR/FHIR 순서 확정 필요 |
| R-1 | 규제(SaMD) | 사업화 전 인허가 전략 검토. 초기엔 원내 연구/보조 포지셔닝 |
| R-2 | 클라우드 API 제약 | 병원 보안정책상 외부 API 불가 시 → 온프레미스 LLM 폴백. `rag/generate.py`에 LLM 추상화 계층 유지 |
| R-3 | 판독문 데이터 확보 | RAG 품질은 판독 DB 규모·품질에 직결. 초기 인제스트 데이터 출처·정제 계획 필요 |
| R-4 | 환각 | §4.4 장치 + 평가 하네스 게이트. "초안" 포지셔닝 일관 유지 |

---

*다음 단계: 본 문서 검토 → D-1~D-4 확정 → S0 착수.*
