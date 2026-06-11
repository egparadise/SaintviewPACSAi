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
- [x] **26차(2026-06-11)**: 판독 창 레퍼런스 디자인 — **뷰어 판독 도크 재설계**(탭 [판독|판독 기록|단축키|템플릿], Font size ±, CVR Notice(critical 경고 배너), ◀▶ 과거검사 비교, **초기화/저장/승인(확정·서명)**, Reading/Conclusion 자유 편집(SR 매핑: findings↔판독문·impression[0]↔결론), 시스템 단축키 Ctrl+S/Ctrl+Shift+A 적용, dockW 기본 340) · **Setting>판독(Reading) 3탭**(기본 설정: 판독의 정보+레포트 옵션(저장 후 다음 열기·저장 알림·CVR 등)+사이드바/패널 기본탭+삽입 위치+시스템 단축키 키캡처 / **단축키 설정**·**템플릿 설정**: 목록|폼(모달리티·단축키 코드 캡처·이름·판독·결론) — phrases.kind/reading_text 컬럼, 마이그레이션 b8c9d0e1f2a3) · 워크리스트 확정 후 다음 레포트 자동 이동 옵션 연동. **pytest 59/59**
- [x] **25차(2026-06-11)**: **뷰어 별도 포트**(`VITE_VIEWER_BASE` + `npm run dev:viewer`(5174) — 타 출처 토큰은 postMessage 핸드셰이크(`ensureToken`, 출처 검증), CORS 5174 추가) · **모니터 설정**(설정>뷰어 모니터 감지(`getScreenDetails`) → 표시 모니터 선택(다중=스팬), `viewer.prefs.monitor` — openV2가 좌표·크기 계산해 해당 모니터에 창 배치, Series Layout으로 영상 분할) · **뷰어 내 설정 버튼**(판독창 왼쪽 — SettingsModal lazy). **pytest 58/58**
- [x] **24차(2026-06-11)**: **Tools 아이콘**(`lib/toolIcons.tsx` — 26종 인라인 SVG(UBPACS 아이콘 표 대응), 팔레트 전 버튼 아이콘+라벨 세로 스택, 설정>Tools bar 체크박스에도 아이콘 표시). frontend build 통과
- [x] **23차(2026-06-11)**: 뷰어 Tools UX — **팔레트 섹션 전체 펼침 기본**(Common/Anno/2D/ETC 동시 표시, 헤더 ▾/▸ 클릭으로 개별 접기) · **버튼 확대**(fontSize 12·padding 8px, 팔레트 폭 기본 138) · **썸네일 확대**(기본 128px, 슬라이더·스플리터 최대 260) · 구 기본값(84/100) 저장분 자동 업그레이드(직접 조절값은 유지). frontend build 통과
- [ ] 남은 것(차기): Cornerstone 스택 렌더 경로 복구(드래그 W/L·HU ROI 통계용 — 자체 SVG 레이어로 측정은 해결됨) · 실 MPPS(DIMSE N-CREATE/N-SET 수신) · STT 서버측(Whisper 등) 대체 · GSPS 불러오기(타사 PR 표시) · 번인 OCR 정밀도(tesseract 설치 가이드)
- 실행: `docker compose -f deploy/docker-compose.yml up -d` (db+orthanc+**OHIF:3000**) → `cd backend && py -3.11 -m uvicorn app.main:app` → `cd frontend && npm run dev` (admin/admin1234, 운영 전 변경). DB 스키마는 `alembic upgrade head`
- **작업 마무리 규칙:** 코드 작업이 끝나면(커밋 후) 항상 백엔드(uvicorn:8000)·프론트엔드(vite:5173)를 재실행해 변경이 반영된 상태로 마친다. 재실행 후 `/api/health`와 5173 응답을 확인할 것. ⚠ `backend/.env`가 `AI_MODE=live`이므로 하네스·일괄 테스트는 `SAINTVIEW_AI_MODE=mock` 강제 후 실행(실 API 비용).

---

*작업 전 설계 문서의 관련 섹션을 읽고, 결정 변경 시 설계 §0 Decision Record를 갱신하라.*
