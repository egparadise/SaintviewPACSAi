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
- [x] **3차 구현(2026-06-11)**: **DICOM SR 출력**(Basic Text SR, 동일 StudyUID 귀속 → `send-sr`로 Orthanc 저장, live 검증: 검사 시리즈 [CT, SR] 확인) · **설정 API+화면**(화이트리스트 키, 사용자/관리자 scope, PDF 템플릿·AI 정책 GUI) · **F-11 vision**(Orthanc preview→Claude vision, `ai.policy.vision` opt-in, "[영상 참고 관찰]" 구분 규칙) · **F-20 품질 통계**(`/api/admin/ai-quality`: 수용률·수정률·critical 변경, 설정 화면 표시). **pytest 24/24**
- [x] **4차 구현(2026-06-11)**: **F-16 키이미지/KOS**(선택 UI→KOS 88.59 생성→Orthanc, live: [CT,KO] 확인, PDF 자동 첨부) · **F-18 행잉 매핑**(viewer.prefs: 모달리티→default/mpr, OHIF URL 연동) · **사용자 환경설정 적용**(자동갱신 주기·기본 필터) · **이미지 가드**(vision 전송 전 상·하단 10% 번인 마스킹) · **FHIR DiagnosticReport**(format=fhir, AI 확장 표시). 마이그레이션 c1d2e3f4. **pytest 28/28**
- [x] **5차 구현(2026-06-11)**: **Cornerstone3D 내장 3D 뷰어**(`pages/Viewer3D.tsx` — wadors 볼륨, MPR 3면+MIP slab, 프리뷰 실증: 팬텀 구체·결절 정확 렌더. ⚠ vite는 `viteCommonjs`+`optimizeDeps.exclude` 필수) · 뷰어 아이콘(`saintview-viewer.svg`) · **Slicer devtools**(`devtools/slicer/` — pull·MPR/MIP 교차검증·분할 프로토타입) · **실데이터 평가**(`harness/eval_cases/` JSONL+`--judge` LLM 채점, live 기준선: 환각 0건) · **배포 보안**(prod 게이트·change-password·compose.prod·README_PILOT). **pytest 31/31**
- [x] **6차(95371cc)**: OHIF 검은화면 수정(app-config 필수키 extensions/modes 누락) · 워크리스트 5구역 전면 재구축(과거검사/비교세트/상용구/리포트 메타테이블/오더/컨텍스트메뉴) · INFINITT식 설정 트리(컬럼 듀얼리스트·Orthanc 연결테스트)
- [x] **7~8차(d376564, eb12362)**: 필드별 검색콤보(pid/pname/sex/desc)+Find criteria 설정 · **자체 Viewer2D**(세로 팔레트 Common/Anno/2D/ETC, 시리즈→개별 2단 썸네일, 1/2/4분할, 4코너 오버레이, 판독도크) · **픽셀 렌더링 해결**: WADO-RS /rendered 전환 + **nginx에서 /rendered Accept를 image/png 강제**(Orthanc가 브라우저 img Accept를 400 거부 — 핵심 함정!) · 팔레트/썸네일 방향·크기·모드 설정화 · Link 동기스크롤 · 2D행잉
- [x] **9~10차(52a9633, af3ae07)**: 신규 기획문서(`PACS_AI_개발문서/` 11종) 채택·갭분석(`docs/ANALYSIS_신규기획문서_갭분석.md`) · 자동로그인 · 단축키(워크리스트 Enter/B/E, 뷰어 ←→IRFL/1·2·4/Space/Esc) · 일괄확정 confirm(03b) · 상용구 Modality 맞춤필터 · **자동 W/L(AI v1+배지)** · report_copy · **비교 동선(도크 과거검사→자동 1x2+Link)** · **Mode Profile v1**(saintvidw/INFINITT/UBPACS-Z/Sonic 프리셋 전환)
- [x] **11차(8c2f701)**: 07_PLAN 대조 — 검색 연산자(=정확/접두%/!제외) · SearchShortcut(바로가기) · 판독 보류(suspended) · F-17 2차승인(Conf2). **pytest 31/31**
- [x] **12차(2026-06-11)**: **자연어검색 S1**(`rag/nl_query.py` mock 휴리스틱 + live `generate_nl_query`(NL_QUERY_SCHEMA·deid 게이트, live 실패 시 휴리스틱 폴백) → `POST /api/worklist/nl-query`, 툴바 AI검색 입력→해석 미리보기 배너→사용자 적용. status=`unread`(≠finalized) 신설) · **묶음판독 report_merge**(`merge_reports`: 동일환자 검증·부속 소견 [MOD 검사일] 태그 병합·prior_study_refs 기록 → `POST /api/reports/merge`, 비교세트 패널 "묶음판독" 버튼+건수 confirm) · **Mode Profile 서버 JSON화 S7**(`services/mode_profiles.py` 기본 4종 → `mode.profiles` 전역설정(global 전용 강제), 설정화면 동적 로드+관리자 JSON 편집기). **pytest 38/38**, EVAL PASS
- [x] **13차(2026-06-11)**: 차기 목록 전체 구현 — **측정/ROI**(Cornerstone 우회: Viewer2D 자체 SVG 주석 레이어 — Len/Ang/Rect/Elps/Arrw/Text, 역변환 매핑 `lib/annotations.ts`, PixelSpacing mm 계측·px 폴백, `annotations` 테이블 영속화) · **Reference line**(평면 교차 투영 — series-tree에 Position/Orientation 태그 추가) · **GSPS**(`dicom/gsps.py` — 주석·W/L→Presentation State, DISPLAY 좌표, send-gsps) · **CTR 자동계측 S2**(`rag/ctr.py` mock 결정적+live vision `generate_ctr`+`numeric_verify`, CR/DX 한정, AI 주석 보라 표시) · **패널 드래그**(D/E구역 그립 드래그 교환, worklist.prefs.panel_order 로밍) · **외부 AI 병합 F-12**(`POST /studies/{id}/external-ai` — 03b 입력검증, [외부AI vendor] 라벨, critical→응급) · **음성 STT**(Web Speech API ko-KR → Conclusion 받아쓰기) · **MWL/MPPS**(`orders` 테이블+CRUD, MPPS 상태 전이 검증, `dicom/mwl.py` .wl 내보내기, compose Orthanc worklists 플러그인) · **번인 OCR**(image_guard 2단: 스트립+pytesseract 텍스트박스, 미설치 폴백). 마이그레이션 d3e4f5a6b7c8(Postgres 적용 확인). **pytest 48/48**, EVAL PASS
- [x] **14차(2026-06-11)**: UBPACS-Z 매뉴얼 분석 반영 — **워크리스트 페이지 탭**(저장된 검색 정의를 WORKLIST 1/CR/응급실 탭으로 등록·전환, 최대 10페이지(UBPACS 규격) 서버 검증, `worklist.tabs`) · **검색 폴더 트리**(탐색기형 계층 — 폴더별 부분 조건을 경로 누적 병합 적용(예: 응급실›DR›Chest), 추가/수정/삭제 + FolderEditModal, `worklist.tree`) · 공용 모듈 `pages/WorklistTree.tsx` — **워크리스트 좌측 레일과 Setting 화면이 동일 데이터·동일 편집기** 사용(즉시 서버 저장·로밍) · **Study Open 5종**(UBPACS p.12 — ①View 교체 ②Add View 분할추가(직전 검사 유지) ③Stack View 같은 페인 중첩(기존 시리즈 썸네일 유지) ④Advance View=OHIF ⑤Key Image View=key_images SOP 필터, 툴바+컨텍스트메뉴). **pytest 49/49**
- [x] **15차(2026-06-11)**: UBPACS-Z 심화 — **Study With Open**(p.13: 툴바 With Open 체크+ADD/STACK 모드 → 더블클릭 시 Related 검사 최대 3건 함께 오픈) · **뷰어 오픈 탭**(여러 검사가 열리면 좌→우로 탭 누적(브라우저 창 메타포), 클릭=활성 페인 전환·✕=닫기(주 검사 복귀), 트리 캐시 공용 getTree) · **DICOM 헤더 조회 컬럼 확장**(studies.institution/referring_physician/memo + 검사시각·판독일시 컬럼, Orthanc 동기화 태그 추출, Setting>워크리스트 듀얼리스트에서 USE/NO USE — 마이그레이션 e5f6a7b8c9d0) · **Worklist 구성 p.8 재배치**(D행=Order|Related-1|Related-2, E행=Thumbnail|Reference(상용구)|Comment+MEMO|Report — 신규 ThumbnailPanel·CommentMemoPanel(`PUT /studies/{id}/memo`), 구성요소 표시/숨김 설정(worklist.prefs.panels) + 설정화면 병합 저장 수정). **pytest 50/50**
- [x] **16차(2026-06-11)**: **오더 등록 폼**(Study ID/Accession 자동 채번 버튼, Last^First PN, Body part·Projection — MWL .wl에 StudyID(0020,0010)·BodyPartExamined(0018,0015) 반영) · **SCP/SCU 노드 설정**(`dicom.nodes` 전역설정 — AE Title/IP/Port 행 추가·삭제·편집, `POST /api/admin/dicom-nodes/apply`→Orthanc DicomModalities 등록) · **상용구 DB화**(`phrases` 테이블 + CRUD API, 레거시 report.phrases 자동 이관, Modality×부위 분류 + **Alt+단축키**(중복 검증) 즉시 삽입, Worklist 패널·설정 양쪽 동일 편집 모달) · **리포트 2열 분리**(AI Structured Report(보라) → [적용 ▶] → Report(의료인), 확정 시 **전자서명**(이름·면허번호, diff_metrics.signature → 패널·PDF 표기), 설정>판독(Reading)에서 판독의 등록 `GET/PUT /api/auth/profile`) · **레이아웃 스플리터**(레일 폭·D/E행 높이·E행 패널 폭 드래그 조절 → worklist.prefs.layout_sizes 계정별 로밍). 마이그레이션 f6a7b8c9d0e1(Postgres 적용). **pytest 54/54**
- [x] **17차(2026-06-11)**: UBPACS Filter Setting 충족 — **컬럼 4종 추가**(부서 DEPT(InstitutionalDepartmentName 동기화)·AE TITLE(RemoteAET)·BOOKMARK ★(토글 endpoint+컨텍스트메뉴)·ORDER NAME(accession↔오더 매칭), 총 22종 — 마이그레이션 a7b8c9d0e1f2) · **Filter Setting UI**(설정>워크리스트: ITEM|USE/NO USE 클릭 토글+▲▼ 순서 — DualList 대체) · **Thumbnail Series/Image Layout**(그리드 픽커 N×M 호버 선택 — 시리즈 그리드/이미지 그리드 분할, worklist.prefs.thumb_layout 로밍). **pytest 55/55**
- [x] **18차(2026-06-11)**: UBPACS View Screen Composition(p.14) 정합 — **Series Layout 3×3 확장**(뷰포트 9페인, LAYOUTS 동적 생성 + 좌상단 GridPicker) · **Image Layout**(페인 내 연속 이미지 N×M 타일, 휠=페이지 단위 이동, 오버레이 Img 범위 표시) · **Study/Series Titlebar**(탭 아래 전용 띠 — HP·[idx/total]·검사·시리즈 정보) · **Toolbar/Thumbnail 위치 right 추가**(Setting>Viewer: left/top/right · left/bottom/right) · GridPicker 공용화(`lib/GridPicker.tsx`). **pytest 55/55**
- [x] **19차(2026-06-11)**: UBPACS Study View·Toolbar 정합 — **HP(행잉 프로토콜)**(`viewer.hp` user 설정 + 설정>행잉(HP) 규칙 편집기: 장비×부위×Projection→Series/Image layout·W/L, 뷰어 오픈 시 첫 일치 자동 적용 + 타이틀바 HP 메뉴 수동 전환) · **타이틀바 드롭다운 3종**(▤Opened Study List·🗂Related Study List·≣Open Series — p.16/17) · **W/L 프리셋 설정화**(viewer.prefs.wl_presets 편집 테이블 + **All 토글**(전체 페인 적용, UBPACS All)) · **뷰어 패널 크기조절**(팔레트 폭·썸네일 크기·판독도크 폭 스플리터 → viewer.prefs 로밍, Hide/Thumb 토글 기존 유지) · **Tools bar 구성**(`lib/viewerConfig.ts` 카탈로그(UBPACS p.18~21 매핑) — 설정>뷰어 체크박스로 버튼별 표시/숨김, 계정 로밍). **pytest 56/56**
- [x] **20차(2026-06-11)**: UBPACS Report Composition(p.22) + STT/MPR — **리포트 구성 설정**(`report.prefs`: AI 패널 표시·**AI 초안 자동 적용 선택**(해제 시 빈 양식+[적용▶]만), 설정>리포트) · **◀▶ 다음 환자 이동** · **판독 이력 콤보**(과거 버전 읽기전용 보기) · **AI 별도 창(↗)**(팝업 — 별도 모니터 배치용) · **Whisper STT**(`/api/stt` — faster-whisper(오픈소스 로컬, 모델 캐시)→openai-whisper 폴백→미설치 501 안내 / OpenAI API(키는 env `OPENAI_API_KEY`만, 외부전송 경고) / 브라우저, 설정>AI 정책에서 엔진·모델 선택, 프론트 MediaRecorder 녹음→전사) · **뷰어 내장 MPR/MIP**(ETC `3D/MPR` 토글 — 새 창 없이 뷰포트 영역을 Viewer3D(embedded prop) Axial/Sagittal/Coronal+MIP로 전환). **pytest 58/58**
- [x] **21차(2026-06-11)**: 뷰어 닫기 UX — **Exam 탭 영속**(모듈 레벨 persistedTabs: 뷰어 재오픈에도 ✕/전체닫기 전까지 우측 누적, 주 탭 ✕=뷰어 닫기) · **전체 닫기 버튼**(탭 스트립 우측) · **닫기 다이얼로그 3종**(현재 화면 저장(주석) / 전체 변경사항 저장(주석+GSPS) / 저장 안 함 — 각 항목 "기본으로" 체크 시 다음부터 묻지 않음) · **Setting>뷰어>닫기 동작**(viewer.prefs.close_mode: ask/save_current/save_all/discard — 다이얼로그 체크와 양방향 연동, 계정 로밍). Esc/WORKLIST/닫기 버튼 모두 동일 플로우. **pytest 58/58**
- [x] **22차(2026-06-11)**: **뷰어 새 창(별도 웹페이지)** — `?viewer=2d&study=ID`(+add/stack/keysops/wo_mode·wo_ids) 라우트(`pages/ViewerWindow.tsx`), openV2가 `window.open(name="sv_viewer")`로 단일 뷰어 창 재사용(검사는 탭 누적), **세션 토큰 인계**(`window.opener.__svToken` — sessionStorage 탭 미공유 해결), Exam 탭 영속을 localStorage(`sv_viewer_tabs`)로 전환(창 네비게이션 생존), 워크리스트 오버레이 제거 · **합성 데이터 W/L 화이트아웃 수정**(PixelSpacing 없으면 AI 추천 W/L 미적용 — 서버 VOI 기본). **pytest 58/58**
- [x] **31차(2026-06-11)**: **시간대별 ◀▶ 정책**(설정>정책(Policy): nav_left=past/recent — ◀▶가 워크리스트 정렬(최신 위) 기준 한 단계씩, ▶는 항상 반대 방향. 뷰어·판독 창 공통) · **3창 연동**(`lib/sync.ts` BroadcastChannel — Worklist 선택·Viewer 탭/이동·Reading 이동이 서로 환자 추적: 뷰어는 열린 탭이면 전환, Reading은 해당 검사 로드, Worklist는 행 선택) · Exam 탭 라벨 #id 구분(동일 환자·검사명 중복 식별). **pytest 61/61**
- [x] **30차(2026-06-11)**: **판독 창 3컬럼 레이아웃**(레퍼런스 정합 — 좌: 판독 기록(이전 버전·관련 확정판독, 빈 상태+영상 요청 버튼)/기록지(검사 메타시트), 중앙: Font size 바·(/) 헤더·CVR Notice·◀▶·초기화/저장/승인 + **ID/Reporter/Report Day·Hospital Comment(=memo 저장)·Study/Req·Refer Comment·Reading·Conclusion**, 우: 단축키/템플릿 — 기본 탭은 Setting>판독 옵션) · **◀▶ 환자 이동 통일**(뷰어 팔레트 상단 + 판독 창 — 워크리스트 순서, 미오픈=열며 이동·오픈=해당 Exam 탭 전환(창 네비게이트, 탭 영속 유지)). **pytest 61/61**
- [x] **29차(2026-06-11)**: **서버 선택 버튼**(워크리스트 탭 바 우측 [Local Server][Web Server] — Local: 공유 폴더 목록/다운로드 팝오버(`/api/share`, path traversal 차단), Web: IP·Port·Name·AET 표시) · **설정>서버 네트워크**(공유 디렉토리·웹서버 설정(전역) + **Ping(ICMP+TCP)·DICOM C-ECHO(pynetdicom)·DB 연동(SELECT 1) 테스트** `/api/admin/net-test/*`) · 모니터 확인(번호 1,2,3 표시) 포함. **pytest 61/61**
- [x] **28차(2026-06-11)**: 창별 모니터 배치 — 설정>모니터 테이블 확장(모니터별 **뷰어☑(다중=스팬)·워크리스트◉·판독◉** 지정, viewer.prefs.monitor.{screens,worklist,report}) · 뷰어 [Reading] 버튼이 판독 모니터에 창 배치 · [워크리스트를 해당 모니터로 열기] 버튼(현재 창 이동은 브라우저 제한 — 새 창) · `lib/screens.ts` 공용화. **pytest 59/59**
- [x] **27차(2026-06-11)**: **설정>모니터(Display) 항목 신설**(뷰어 페이지에 숨어 있던 모니터 감지를 독립 페이지로 — ①감지 ②선택 ③OK ④적용 단계 안내, 저장된 선택 표시, 뷰어 별도 포트 안내 포함) · **Reading 전용 판독 창**(뷰어 [판독창]→[Reading] 버튼 — `?report=1&study=ID` 새 페이지(`pages/ReportWindow.tsx`): 판독/판독기록/단축키/템플릿 탭·Font·CVR·◀▶(관련검사 판독 이동)·초기화/저장/승인·서명, 시스템 단축키·Alt상용구·저장 후 다음 열기 옵션 적용. 우측 도크는 유지). **pytest 59/59**
- [x] **26차(2026-06-11)**: 판독 창 레퍼런스 디자인 — **뷰어 판독 도크 재설계**(탭 [판독|판독 기록|단축키|템플릿], Font size ±, CVR Notice(critical 경고 배너), ◀▶ 과거검사 비교, **초기화/저장/승인(확정·서명)**, Reading/Conclusion 자유 편집(SR 매핑: findings↔판독문·impression[0]↔결론), 시스템 단축키 Ctrl+S/Ctrl+Shift+A 적용, dockW 기본 340) · **Setting>판독(Reading) 3탭**(기본 설정: 판독의 정보+레포트 옵션(저장 후 다음 열기·저장 알림·CVR 등)+사이드바/패널 기본탭+삽입 위치+시스템 단축키 키캡처 / **단축키 설정**·**템플릿 설정**: 목록|폼(모달리티·단축키 코드 캡처·이름·판독·결론) — phrases.kind/reading_text 컬럼, 마이그레이션 b8c9d0e1f2a3) · 워크리스트 확정 후 다음 레포트 자동 이동 옵션 연동. **pytest 59/59**
- [x] **25차(2026-06-11)**: **뷰어 별도 포트**(`VITE_VIEWER_BASE` + `npm run dev:viewer`(5174) — 타 출처 토큰은 postMessage 핸드셰이크(`ensureToken`, 출처 검증), CORS 5174 추가) · **모니터 설정**(설정>뷰어 모니터 감지(`getScreenDetails`) → 표시 모니터 선택(다중=스팬), `viewer.prefs.monitor` — openV2가 좌표·크기 계산해 해당 모니터에 창 배치, Series Layout으로 영상 분할) · **뷰어 내 설정 버튼**(판독창 왼쪽 — SettingsModal lazy). **pytest 58/58**
- [x] **24차(2026-06-11)**: **Tools 아이콘**(`lib/toolIcons.tsx` — 26종 인라인 SVG(UBPACS 아이콘 표 대응), 팔레트 전 버튼 아이콘+라벨 세로 스택, 설정>Tools bar 체크박스에도 아이콘 표시). frontend build 통과
- [x] **23차(2026-06-11)**: 뷰어 Tools UX — **팔레트 섹션 전체 펼침 기본**(Common/Anno/2D/ETC 동시 표시, 헤더 ▾/▸ 클릭으로 개별 접기) · **버튼 확대**(fontSize 12·padding 8px, 팔레트 폭 기본 138) · **썸네일 확대**(기본 128px, 슬라이더·스플리터 최대 260) · 구 기본값(84/100) 저장분 자동 업그레이드(직접 조절값은 유지). frontend build 통과
- [x] **33차(2026-06-13) — 서버 관리 1단계(경량 테넌시)**: **가입자 병원(Hospital) 마스터**(코드·AET·계정 라이선스 한도·데이터 격리 토글, CRUD `/api/admin/hospitals`) · **계정/역할 5종**(`services/permissions.py` — 관리자/의사/영상의학과의사/방사선사/기타, 권한 매트릭스 + `require_perm` 게이트, 계정 CRUD `/api/admin/accounts` — 병원 소속·비활성·비번 재설정·마지막 관리자 보호, 로그인 시 비활성 거부·토큰 `hid`) · **등록 장비(Modality) 테이블**(Name·AET·IP·Port·종류·역할 scu/scp/both·수신허용, CRUD + `apply`→Orthanc DicomModalities 런타임 등록/제거) · **SCP 수신 제어**(`scp.config` — 수신 포트 개폐·등록장비 전용(DicomCheckModalityHost)·Called AE 검증, `deploy/orthanc-generated.json` 생성+재기동 안내, `scp-status`) · **검사 테넌시 태깅**(수신 AET→장비→병원 자동 귀속 + 격리 병원 계정은 워크리스트 자기 병원만) · 프론트 설정 트리 3탭(병원/사용자/장비·수신, `pages/admin/ServerAdmin.tsx`). 마이그레이션 b1c2d3e4f5a6. **pytest 67/67**. ⏭ 2단계(차기): 저장공간 관리·기간 백업·압축(JPEG/JPEG2000)
- [x] **34차(2026-06-13) — 서버 관리 2단계(저장공간·백업·압축)**: **저장공간 현황**(`/api/admin/storage` — Orthanc `/statistics` 디스크 사용량(압축/원본)·검사/시리즈/인스턴스, DB 검사 수, 백업 대상 디스크 여유(`shutil.disk_usage`), 보존 기간 초과 후보) · **백업 정책**(`backup.policy` 전역 — 자동 백업 on/off·예정 시각(매일 HH:MM)·보존 기간(일)·압축 포맷·백업 경로) · **압축(트랜스코드)**(`backup_service.TRANSFER_SYNTAX` — 비압축/JPEG2000 무손실·손실/JPEG 무손실·손실, Orthanc `instance_file(transcode=UID)` 실동작, 코덱 없으면 원본 폴백 + 작업기록 표시 — **live 검증: 실제 35개 DICOM 백업, 매직바이트 DICM 확인**) · **수동/스케줄 백업**(`BackupJob` 이력 테이블, 수동 실행은 FastAPI BackgroundTasks, 스케줄은 워커 폴링 `maybe_run_scheduled_backup` 예정시각·당일중복 방지) · **보존 정책 삭제**(`purge-preview`/`purge` — confirm=true 필수, Orthanc+DB 종속행 정리, 자동삭제 안 함) · 프론트 설정>저장·백업 패널. SQLite busy_timeout 30s. 마이그레이션 c2d3e4f5a6b7. **pytest 73/73**(8회 반복 안정)
- [x] **35차(2026-06-13) — 서버 관리 마무리(압축 실검증·SCP 정책 적용 배선)**: **JPEG2000 트랜스코딩 실측 확인**(orthancteam/orthanc:24.10.1는 JPEG2000 무손실 4.90·손실 4.91·JPEG 무손실 4.70·JPEG-LS 4.80 **기본 지원**, 별도 코덱 플러그인 불필요 — JPEG 베이스라인 4.50만 8비트 전용. live 인스턴스 전송구문 검증) · **압축 옵션 정비**(JPEG-LS 무손실 추가, 베이스라인 8비트 표기) · **실 JPEG2000 백업 E2E 테스트**(`test_backup_real_jpeg2000_transcode` — 실 Orthanc 검사 백업 후 출력 TransferSyntaxUID==4.90 확인, 미가동 시 skip) · **SCP 수신 정책 적용 배선**(이미지가 `/tmp/orthanc.json`을 env로 생성·단일 로드 → 설정파일 마운트 불가 확인. `ORTHANC__DICOM_CHECK_MODALITY_HOST/CHECK_CALLED_AET/DICOM_SERVER_ENABLED`를 compose에 `.env` 구동 변수로 추가, 컨테이너 재생성으로 적용 검증(명명 볼륨 데이터 보존 확인) · 장비 목록은 런타임 REST 등록이라 재기동 불필요) · scp-config가 `deploy/scp-policy.env` 스니펫 생성(.env 반영→`docker compose up -d orthanc`). **pytest 74/74**
- [x] **36차(2026-06-13) — 남은 백로그 일괄 처리**: **실 MPPS SCP**(`dicom/mpps_scp.py` — pynetdicom 리스너가 장비의 N-CREATE/N-SET(Modality Performed Procedure Step) 수신 → 오더 상태(IN PROGRESS→in_progress·COMPLETED→completed·DISCONTINUED→cancelled) 갱신. lifespan 백그라운드 기동(포트 11112, `SAINTVIEW_MPPS_*`), 실 DIMSE SCU↔SCP 왕복 테스트 + live 리스너 바인딩 확인) · **GSPS 불러오기(타사 PR 표시)**(`gsps.parse_gsps_dataset`/`read_gsps_bytes` — GraphicAnnotationSequence·VOI LUT 파싱, DISPLAY/PIXEL 단위 0~1 정규화, `GET /studies/{id}/gsps`로 Orthanc의 PR 객체 조회, 뷰어 PR↓ 버튼이 외부 주석을 녹색(source=external)으로 표시. 생성→파싱 라운드트립 테스트) · **HU ROI 통계 + 드래그 W/L**(Cornerstone 전면 재작성 대신 서버 픽셀 경로 — `dicom/roi.roi_statistics`(rect/ellipse HU 평균·최소·최대·SD·면적), `POST /studies/{id}/roi-stats`(+기본 W/L), 뷰어 HU 버튼 + wl모드 드래그가 `/rendered?window=C,W` 라운드트립) · **번인 OCR 보강**(sparse-text `--psm 11`·언어/신뢰도 env·언어팩 폴백, `docs/OCR_TESSERACT_설치가이드.md`) · **STT 서버측 회귀 고정**(엔진 선택·빈오디오·키미설정 501 테스트 — 구현은 20차 완료). **pytest 87/87**(3회 안정)
- [x] **37차(2026-06-13) — 가입·홈 기본 구조**: PACS 서버 진입 흐름을 **홈(소개·가입) → 가입 → 로그인 → 병원별 페이지**로 구성 · **공개 가입**(`POST /api/signup` — 병원 정보(이름·주소·진료과·연락처·fax·홈페이지)·License(Client 뷰어 수)·연결 Modality 수·가입자 등록(이름·직책·성별·주민번호 앞6자리·전화·휴대폰·이메일·ID·PW확인·계정 admin default)·결재(월별이체/카드 — **카드 마지막 4자리만 저장**) → Hospital+초기 admin Account 생성, `signup_enabled` 플래그) · **관리자 운영 감독**(`GET /api/admin/overview` — 병원별 정보·Client(라이선스)·Modality 등록 수·검사 수·결재 + 서버/Orthanc/MPPS·저장·로그 상태 집계, 설정>운영 현황(감독) 패널) · **프론트**(`pages/Landing.tsx` 소개+가입/로그인, `pages/Signup.tsx` 가입 폼, App 라우팅 landing/login/signup, OverviewPanel) · Hospital(fax·homepage·departments·license_clients·modality_limit·billing) + Account(title·sex·birth6·phone·mobile) 컬럼. 마이그레이션 d3a4b5c6e7f8. **pytest 92/92**. live E2E(가입→로그인→감독) 검증 · **로그인 회귀 수정**(레거시 NULL enabled, 65fc12c)
- [x] **38차(2026-06-14) — 로그인 후 흐름 전면 재설계 + 메인 서버/병원 자원관리**: **메인 Server 페이지**(`/api/admin/server-status` — API·Orthanc(8042)·OHIF·PostgreSQL·앱DB·MPPS 6종 HTTP/TCP 점검 + 관리 링크, 설정>서버(Server) 탭 10초 갱신) · 홈 공개 상태(`/api/status`) · **로그인 후 흐름 재구성**(기존 로그인→바로 뷰어 ❌ → **로그인 → 병원 목록 → 병원 선택 → 병원별 자원관리(영상 용량·DB 용량·클라이언트 수·접속 상태) → Client(좌석) 선택 → 해당 병원 PACS Viewer 진입**) · **Client 모델**(병원 좌석, last_seen online, 라이선스 한도) + `/api/my/hospitals`·`/api/hospitals/{id}/resources`·clients CRUD+enter/heartbeat · **테넌시 강화**(시스템 관리자=전체, 병원 소속=자기 병원, worklist 선택 병원 스코프) · 프론트 `HospitalSelect`·`HospitalConsole`·App 3단 stage. 마이그레이션 e4b5c6d7f8a9. **pytest 95/95**, live E2E 검증
- [x] **39~40차(2026-06-14)**: **관리자 콘솔 좌측 트리**(`AdminConsole` — 서버 상태/Storage/Database·운영현황·사용자 + 등록 병원→병원별 정보/Client/Modality/Storage/Database) · **Client 뷰어 3필드 로그인**(`/api/auth/client-login` — 병원 ID(코드)+개별 ID+PW, 소속 계정만·시스템관리자 거부) · **샘플 시드**(`seed_sample.py` — SAMPLE01 병원+계정3종(sample_admin/sample_dr/sample_rt, PW sample1234)+좌석+장비) · **병원별 DICOM 네트워크**(Hospital에 server_host·scp_aet/port·qr_aet/port, 병원별 포트 자동 배정(SCP 11200+id·QR 11600+id 상이), 병원 정보에서 편집 + `POST /api/admin/hospitals/{id}/net-test`(TCP+C-ECHO) 연결 점검 — ⚠ 단일 Orthanc 한계로 실제 병원별 포트 리스닝은 병원별 인스턴스/라우터 필요) · **상태바 위치 이동**(공개 Landing에서 제거 → 관리자 콘솔 서버 페이지에만). 마이그레이션 f5b6c7d8e9a0. **pytest 96/96**
- [x] **41차(2026-07-02)**: **모드 프로파일 ↔ Client 뷰어 정렬** — 기본 4종 재구성: `ubpacs`→**`ty`(TY — 현행 자체 뷰어 레이아웃)**, `infinitt`→**`infi`(신규 뷰어 개발 중 — 레이아웃 저장소)**. 프로파일 viewer에 `client_viewer` 포함(적용 시 뷰어 구현까지 전환 — CLIENT_VIEWERS 레지스트리와 짝) · **설정>환경 [현재 화면을 프로파일에 저장]**(관리자 — worklist.prefs 컬럼/검색필드/더블클릭 + viewer.prefs 배치/썸네일/선택 뷰어를 선택 프로파일에 캡처, mode.profiles 전역 저장 — 신규 infi 뷰어 레이아웃을 여기에 채우는 동선) · **Client 로그인 장애 수정**(실행 중 백엔드는 Postgres인데 샘플 병원 시드가 SQLite에만 — seed_sample.py는 서버가 보는 DB에 실행할 것). **pytest 96/96**
- [x] **42차(2026-07-03~07-10) — 뷰어 완성·포털 분리·병원별 관리 대전환** (다중 워크플로, pytest 96→214):
  - **두 클라이언트 뷰어 완전 기능 동등화**: TY(Viewer2D)↔In(ViewerInfi) 상호 부재 기능 33종 이식(TY←In 21·In←TY 12) · 전 도구 3D 입체 아이콘 · 해부학 측정 도구(Cobb/Leg Length/척추측만/골반) · Compare(⇄)·A/Shift/Ctrl 다중선택 통일 · Scout(Ref)·ScrollBar 설정화 · 3D 해상도 개선(Cal 시리즈 자동선택 배제+Norm16) · ◀👤▶ 환자 이동 리로드 제거(sv-nav-study) · 환자 혼합 방지(암묵 전환=전체 재행잉) · 시리즈<레이아웃 빈 페인
  - **포털 3분리**: 5173=Landing · 5174=관리자 포털 · 5175=Client 포털(portalRole by port) · 진입점 9000 portal_listener(302) · 바탕화면 아이콘+start_saintview.bat(CRLF 필수)
  - **부모(Admin System)/자식(병원) 컨테이너 모델**: 병원별 관리 13탭(계정 등급 Doctor/Radiologist/Radiographer/Medician·권한 매트릭스(effective_perms)·Modality SCP+Echo/Ping 상태등·SCU·용량·연결 대시보드·로그·통계(그래프+Excel)·데이터·연동·컨테이너·Exam Control) · 시스템 14기능(백업 스케줄·DICOM 압축·DB 뷰어·가입환경·시스템 로그·사용량 통계·미러링·시점 복원·데이터 지우기/복원·AI 등록 placeholder) · 시스템 구조도 라이브 대시보드(SystemMap) · 병원별 Orthanc 컨테이너 구조화(Web 8100+n/DICOM 4300+n) · DDNS · 보안(MLLP 캡·브루트포스 잠금·Defender·무결성 스냅샷)
  - **연동**: HL7 중간테이블(ADT/ORM/ORU)·원격판독 API·MWL SCP(병원별, services/mwl.py)·MPPS · 가상 환자 생성기(RIS 오더 입력형, Modality별 카탈로그: CT=Brain/Scan·MG=Breast/View 등)
  - **Local Server 모드**: 공유 경로에 DB/Image/Temp 로컬 PACS(sqlite) — Import→Image 폴더 저장·표시, 서버 데이터 완전 숨김 · **Exam Control**(관리자 QC — Series/Image 소프트삭제·Recovery·Unassign/Assign(sop 분할 왕복), 서버·로컬 동형 /api/local/examctl, 블록 리사이즈)
- [x] **43차(2026-07-11) — QC 병합 + 판독 상태 + 확정 잠금** (`657ded5`, 6레인 워크플로+적대검증 12건 수정, **pytest 231**):
  - **환자 Merge/Unmerge**(Exam Control — Master/Slave 지정 다이얼로그, 병합 아이콘(components/readState.tsx MergeIcon), PatientMerge 테이블, 병원 스코프 가드, 활성 병합 중 신규 수신 자동 귀속, 로컬 동형+권한 대칭)
  - **워크리스트 '판독' 컬럼**(#↔상태 사이): ○Unread/👁Open/✍Reading/✔Read/🔒Fixed + 보조(▤판독문DB·…입력중·Δ영상변경) — `StudyActivity` 하트비트(뷰어·판독창 45s, TTL 120s, /api/activity/heartbeat), `activity_service.qc_meta` 배치
  - **판독 확정(Fixed) 잠금**(Study.report_locked): 판독창 🔒 체크 → update/finalize/suspend/merge/external-ai/AI재생성(TOCTOU)/HL7 원격판독 전 경로 409, 병원 스코프·감사·창 간 동기화
- [x] **44차(2026-07-12) — MWL 오더 관리 + 뷰어 우클릭 + 아이콘 확대 + STT 마이크** (`c7a25b7`·`b284370`·`8990cab`, pytest 239→240, `npm run build`(tsc -b) green):
  - **MWL 오더**: 오더 CRUD 확장(GET taken·hospital_id 필터·PUT scheduled만·DELETE) · MWL SCP 응답 시 `taken_aet/taken_at` 관찰 기록(mark_taken, status 불변) · 공용 `OrderEntryRis`+`OrderList`(등록/가져간 2섹션, 인라인 수정·삭제·5초 폴링) · 생성기·Worklist 새 오더 모달 통일 · testgen 확장 필드(생년월일·예약일/시각·AET·StudyID)
  - **뷰어 우클릭 3기능**(초기 분석 §7): 우클릭=컨텍스트 메뉴(공용 `ViewerContextMenu`) · 우드래그=기본 도구(rdragTool 기본 W/L) · Shift+우클릭=Zoom Out. TY·In 양쪽, 5px 임계값
  - **빌드 정상화**: 실제 타입 게이트는 `tsc -b`(=`npm run build`) — `tsc --noEmit -p tsconfig.json`은 solution 파일이라 app 미검사. 선재 `useNorm16Texture` 타입 오류 캐스팅으로 해결
  - **TY 팔레트 아이콘 3배**(17→51px, 팔레트 폭 200), 설정 슬라이더 13~64, 구값 자동 승격
  - **STT 음성 판독**: 판독창(ReportWindow·ReportDock) Font 왼쪽 마이크 버튼 — 공용 `useDictation` 훅(browser=WebSpeech / whisper_local·openai_api=녹음→`/api/stt`), 마지막 포커스 필드 삽입 · Settings 'AI 정책'→'AI 기능' 탭 + 설치/키 상태 · Server AI 등록 하단 `SttServerPanel`(엔진/모델·상태·마이크 테스트, 전역 ai.policy) · `GET /api/stt/status` · 전역 ai.policy 라 모든 병원·Client 공통 구동(연동)
- [x] **45차(2026-07-13~07-17) — 뷰어 상호작용·SAINT VIEW 스킨·원격 HTTPS 전용·테넌시 보안·한글 인코딩·뷰어 가속** (116커밋, pytest **244**, 세션별 상세는 Obsidian 'Saintview PACS AI 개발기록' 노트):
  - **뷰어 상호작용(TY·In 공통)**: 툴 드래그 그리기+주석 선택/이동/크기/삭제(Esc/Select 초기화) · 마퀴(녹색 점선) 다중선택+일괄삭제 · 툴 토글·표시상태 저장/재현(W/L·방향·필터·셔터) · 썸네일 시리즈→페인 드래그앤드롭 · 키이미지 🔑 마크 · Rec 딕테이션→Whisper STT·Calibrate 실구현 · 스크롤 무한 순환
  - **Combine·행잉·판독**: 진짜 Combine(여러 시리즈 연속 스크롤+Circle Menu+토글) · 행잉 편집기 재설계+Mammo(MG) 2×2 CC/MLO 행잉 · 듀얼모드 Stack 동기(Spatial↔Index, 'G' 토글) · 판독창 History(과거검사 이미지·1:2 Compare·판독 복사) · 워크리스트 다중 Exam 선택(Shift/Ctrl)
  - **SAINT VIEW 스킨**: 뷰어 명칭 통일(T-View/In-View/SaintView) · SV 워크리스트 스킨(상태 카운트 바·SV 컬럼·정확 카운트 API) · In 레이아웃 GridPicker화
  - **원격 배포·HTTPS 전용**: Tailscale 지원(host 0.0.0.0·API/DICOMweb 프록시·프리뷰 상대경로) → 자체서명 HTTPS 3포털 → **HTTPS 전용 고정(2f0948b)**: vite http 폴백 제거(인증서 없으면 기동 거부)·CORS https 오리진·9000 리다이렉트 https 조립. **바탕화면 런처 실행 불가 근본 수정(0ec24f7)**: cmd `set VAR=1 &&`가 값에 공백 포함("1 ")→vite `==='1'` 실패→조용한 http 폴백→런처는 https만 열어 SSL 오류 페이지가 원인. 런처는 스킴 단일화+비-https 점유 종료 후 재기동+중복 기동 방지+Docker Desktop 자동 시작+openssl 인증서 자동 생성
  - **보안·계정**: 감사 발견 테넌시 IDOR 일괄 수정(per-study/report 병원 스코프 가드, 오더/예약 병원 격리 CRITICAL) · 발급 계정 비밀번호 라이프사이클(최초 강제변경·admin 뷰/리셋) · 중복 로그인 세션 인계(Yes/No+10초 카운트다운) · 병원·계정 설정 백업/복원(JSON export/import)
  - **랜딩·가입**: Inviz 라이트 리디자인+기능 카드 캐러셀+실제 뷰어 목업 히어로(`assets/hero-laptop.png`) · 가입 주소 검색(우편번호) · 병원 이름으로 Client 로그인+3필드 자동로그인
  - **품질·성능**: EUC-KR 한글 깨짐 근본 수정(Orthanc `DefaultEncoding=Korean` 3컨테이너+운영 DB 12건 복구+`POST /api/maintenance/repair-encoding`) · 저장 토스트 25곳(`lib/toast.ts`) · 워크리스트 설정 병원 계층(`/api/hospitals/{hid}/wl-setting`, user>hospital 폴백) · **뷰어 가속 3단계(2a7b8c2)**: series-tree 1179장 7.2~16.1s→**1.5s**(프리페치 `lib/framePrefetch`·orthanc N+1→requestedTags 배치·httpx 연결풀·rendered 1h 캐시·휠 rAF 코얼레싱·3D 진행률 렌더)
- [x] **46차(2026-07-20) — 우클릭 확장박스 재발 차단·AI 판독 보류·3D 커서·툴 토글 통일** (pytest **249**, 적대검증 워크플로 4회):
  - **우클릭 확장(Linkclump 류) 빨간 링크박스 재발 차단(3a80eee)**: 재발 메커니즘 = 우클릭(무이동)→컨텍스트 메뉴가 페인 트리 밖 fixed 로 열림→그 위에서 시작한 우드래그가 cap 의 [data-pid] 가드를 우회. 메뉴/Circle 오버레이/미디어·빈 페인에 실드([data-sv-ctxmenu]/[data-sv-rshield]) · **In-View 에 캡처 차단 전면 이식**(pointerdown preventDefault→compat mousedown 미생성, 우드래그는 window pointer 구동) · **3D(MPR/MIP/VR)**: Cornerstone tools 가 mousedown 기반이라 차단+Zoom setZoom 재구현(아래 드래그=확대, 감도 5/높이) · Shift+우드래그 영역 W/L 박스 빨강→황색 점선+라벨(확장 박스와 혼동 제거). 한계: 좌드래그 중 우버튼 chord 는 pointerdown 미생성이라 차단 불가(주석 명시)
  - **AI 판독 초안 기능 보류(b4bb3f7)**: RAG Structured Report 개편 전까지 **기본 OFF** — 마스터 스위치 `ai.policy.draft_enabled`(설정>AI 정책 GUI) < env `SAINTVIEW_AI_DRAFT_ENABLED`(테스트/하네스 오버라이드). 단일 관문 `queue_ai_job`(자동 Orthanc 동기화·Import·수동 재생성 전 경로)·`/analyze` 409 안내·워커 대기 잡 드레인(skipped — 재활성 시 비용 폭주 방지). 기존 초안 열람·확정·출력·NL검색·STT·CTR 은 무영향. conftest·smoke 는 env=1 로 생성 기계 검증 유지, test_ai_hold 5건 신규
  - **3D Cursor 홀드-드래그 전 뷰어 통일(a970fb2)**: In-View 클릭 1회 배치→V2D(996b4b4) 동형 연속 추적(rAF·앵커 sop 고정 — Image Layout 타일 t>0 index 피드백 발산을 적대검증이 사전 차단) · 기하 없음 index 근사 폴백·Off 시 마커 제거 이식 · 양 뷰어 창 밖 pointerup 유실 가드
  - **툴 토글·기본 툴 통일(5232ec2·bd1bd6e)**: 재클릭=해제+버튼 색 원복(V2D ModeBtn/Quick 행·In 팔레트 mode 툴·In 셔터 무장 상태) · **해제 시 기본 툴 항상 Select**(V2D 시작값 zoom→select, 모든 setTool(null) 경로 effect 일괄 보장 — In-View 정합)
- [ ] 남은 것(차기): **AI 판독 재활성(RAG SR 개편 시 설정>AI 마스터 스위치 ON)** · 서버 Whisper 설치(`pip install faster-whisper`)/OPENAI_API_KEY · Client 좌석 접속 실시간 연동 · 가입 결재 실연동 · OCR 현장 튜닝 · 딕테이션 결과 서버 저장 · In 뷰어 아이콘 확대(infi_tool_size) · deploy/generated 런타임 아티팩트 gitignore
- 실행: **`start_saintview.bat`(바탕화면 'Saintview PACS AI' 아이콘)** 또는 수동: `docker compose -f deploy/docker-compose.yml up -d` → `cd backend && py -3.11 -m uvicorn app.main:app --port 8000` → vite 3종(5173 Landing·5174 관리자·5175 Client, `--strictPort`). **프론트는 HTTPS 전용**(원격 PC 다중 모니터 감지 `getScreenDetails`=secure context 필수) — vite가 `frontend/certs/dev.{key,crt}`로 https 고정(인증서 없으면 기동 거부, 런처가 자동 생성)·CORS도 https 오리진. admin/admin1234(운영 전 변경). DB 스키마는 `alembic upgrade head`(개발은 init_db의 `_sync_columns` 자가 보정)
- **작업 마무리 규칙:** 코드 작업이 끝나면(커밋 후) 항상 백엔드(uvicorn:8000)·프론트엔드(vite:5173)를 재실행해 변경이 반영된 상태로 마친다. 재실행 후 `/api/health`와 5173 응답을 확인할 것. ⚠ `backend/.env`가 `AI_MODE=live`이므로 하네스·일괄 테스트는 `SAINTVIEW_AI_MODE=mock` 강제 후 실행(실 API 비용).

---

*작업 전 설계 문서의 관련 섹션을 읽고, 결정 변경 시 설계 §0 Decision Record를 갱신하라.*
