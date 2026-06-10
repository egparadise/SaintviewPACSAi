# PiViewSTAR 화면별 기능 분석 — Saintview PACS AI 화면 설계 기초

> 작성일: 2026-06-11. 분석 대상: PiViewSTAR **Worklist 화면**과 **Image Viewer 화면** 실제 스크린샷 + 구조 분석(`ANALYSIS_INFINITT_PiViewSTAR_분석.md`) 교차 검증.
> 목적: 화면 영역(zone) 단위로 기능을 분해하고, 각 영역을 Saintview PACS AI의 **React 화면·컴포넌트 설계로 매핑**한다.
> 본 문서는 화면 구성·기능 수준의 벤치마크다. 시각 디자인(아이콘·스킨)은 복제하지 않는다.

---

## 1. Worklist 화면 분해

### 1.1 화면 전체 구조 (위→아래 9개 존)

```
┌─[Z1] 데이터소스 선택 │ [Z2] 메인 툴바 (검사 단위 액션)──────────────┐
├─[Z3] 워크플로 바: 위저드 │ Custom Folder │ Hanging Protocol │ Refer │ Priority ─┤
├─[Z4] 검색 필터 그리드 (13개 조건 + Search)─────────────────────────┤
├─[Z5] 검사 그리드 (메인 결과 목록, 행 확장[+] = 시리즈 트리)─────────────┤
├─[Z6] 보조 그리드 (선택/관련 검사 영역, 동일 컬럼)───────────────────────┤
├─[Z7] 리포트 미리보기 ─────────┬─[Z8] Information / Image View 미리보기 탭─┤
└─[Z9] 상태바: 디스크 용량 게이지 │ "N Exams (M Images) Selected / Total K"──┘
```

### 1.2 존별 기능과 Saintview 매핑

**[Z1] 데이터소스 선택기** — `Master Local ▾`
드롭다운: **Master Local / Server / DICOM Query / DICOM CDR / Backup DB▸**
같은 워크리스트 UI로 5종 소스를 전환: 로컬 캐시 DB, 서버 PACS, 원격 DICOM Q/R, CD/DVD 미디어, 백업 DB. 소스가 바뀌어도 그리드·검색 UI는 동일.

> **매핑:** 웹 제품은 서버 단일 소스가 기본이므로 축소하되 개념은 유지 — `내부 아카이브(기본) / 외부 PACS Q/R(P2) / 가져오기(업로드)` 소스 탭. "동일 UI에 소스만 교체" 원칙은 그대로 채택(컴포넌트 재사용).

**[Z2] 메인 툴바** — 선택된 검사에 대한 액션 버튼 열
`Open File / Import… / Pictorial·Text(목록 표시모드) / Config / Clear / Delete / Send / View / View&Dictate / Key Img / Explore / Close`

| 버튼 | 기능 | Saintview 대응 |
|---|---|---|
| Open File / Import | 외부 DICOM 파일 열기/일괄 가져오기 | 업로드(STOW) 다이얼로그 (F-19) |
| Pictorial/Text | 목록을 텍스트 행 ↔ 썸네일 카드로 전환 | 워크리스트 뷰 모드 토글 (P1) |
| Delete | 검사 삭제(관리자 전용) | 권한 기반 삭제 (audit_log 필수) |
| Send | 선택 검사를 원격 AE로 전송 | P2 (외부 PACS 전송) |
| **View** | 뷰어로 열기 | Study 페이지 이동 |
| **View&Dictate** | **뷰어 열기 + 딕테이션 동시 시작** (판독 모드 원클릭) | **View&Draft: 뷰어 + AI 초안 패널 동시 오픈 — 핵심 버튼.** 원클릭 판독 진입이 제품의 중심 동선 |
| Key Img | 키 이미지만 보기 | 키 이미지 필터 (F-16) |
| Explore | 저장 폴더 탐색 | 관리자 진단 도구 (G-9) |

**[Z3] 워크플로 바**
- `위저드(No wizard ▾)`: 저장된 검색조건 프리셋(Worklist Wizard) — 자주 쓰는 검색을 1클릭 호출.
- `Custom Folder`: 티칭/케이스 폴더 (분석 문서 §5.1).
- `Default Hanging protocol ▾`: 뷰어로 열 때 적용할 행잉 프로토콜을 **워크리스트에서 미리 선택**.
- `Refer`: 의뢰(타과 참조), `Study Priority`: 우선순위 변경.

> **매핑:** ① 검색 프리셋 = 저장된 필터(우리: URL 쿼리 + 사용자별 저장 필터, P1). ② 행잉 프로토콜 선택은 Study 페이지 진입 파라미터로 전달(F-18). ③ Priority = Emergency/STAT 플래그 UI(F-15)와 통합.

**[Z4] 검색 필터 그리드** — 13개 조건이 항상 펼쳐진 고밀도 폼
`Patient ID / Patient sex / Study ID / Study description / Modality / Body part / Diagnosis code / Diagnosis / Finding code / Finding / Time / Study Date / Status` + 돋보기(Search)
- 모든 필드가 `*Any …` 기본값의 콤보박스(자유입력+최근값) — "빈 값 = 전체"의 일관 규칙.
- **Diagnosis/Finding 코드 검색**이 1급 필드 — 판독 결과가 코드화되어 역검색 가능함을 의미.

> **매핑:** MVP는 핵심 6필드(환자ID/이름, 기간, 모달리티, 상태, Accession, 신체부위)를 항상 노출 + "고급 필터" 확장에 나머지. **Diagnosis/Finding 검색은 우리의 차별 기능으로 격상** — SR이 구조화(JSONB)되어 있으므로 소견 텍스트·중증도 검색이 표준 PACS보다 강력해야 한다(RAG 인덱스 재활용). → 설계 F-2 보강.

**[Z5] 검사 그리드** — 컬럼 정의 (스크린샷 실측)
`Status(아이콘+색) / Name / ID / Sex / Study Date / Study ID / Mdl / Srs(시리즈수) / Img(영상수) / Body part / Backup / Dx / Fx / PrivateDef / Comment`
- **Status**: Unread(노란 폴더)/Read(문서 아이콘) — 아이콘+색상 이중 인코딩. 행 앞 `[+]` 확장 → 시리즈 레벨 트리.
- **Srs/Img 수치**: 도착 완전성 확인(예: CT인데 Img:5면 수신 미완료 의심).
- **Dx/Fx(진단/소견)·PrivateDef·Comment**: 판독 결과·사용자 정의 필드가 목록에서 바로 보임.
- 더블클릭 = View, 컬럼 정렬 = 헤더 클릭.

> **매핑(우리 워크리스트 컬럼):** `상태배지(received/draft_ready/reading/finalized + Emergency)` / 환자명·ID / 검사일시 / Modality / 부위 / Srs·Img / **AI 초안 상태(생성중·완료·실패)** / **Critical 플래그** / 핵심 소견 요약(impression 1행) / 담당의. INFINITT의 Dx/Fx 컬럼 자리에 **AI impression 미리보기**가 들어가는 것이 차별점. 행 확장 트리는 P1.

**[Z6] 보조 그리드** — 메인 그리드와 동일 컬럼의 두 번째 목록(선택 검사 모음/비교 대상 스테이징).
> **매핑:** 생략하고 대신 **Related Exams 패널**(F-14)을 검사 선택 시 하단에 표시 — 같은 화면 자산으로 더 명확한 용도.

**[Z7] 리포트 미리보기** — 검사 선택 시 판독문을 목록 화면에서 즉시 열람(`<< >>`로 과거 리포트 이동).
> **매핑:** **P0.** 검사 클릭 → 우측/하단 패널에 AI 초안 또는 확정 판독 미리보기. 판독문 확인을 위해 뷰어까지 들어가지 않게 하는 것이 워크리스트 체류 효율의 핵심.

**[Z8] Information / Image View 탭** — 검사 상세정보 ↔ 영상 미리보기 전환(Prev/Next/Stop/Refresh, Auto update).
> **매핑:** 동일 패턴 채택 — 미리보기 패널 탭: `정보 / 영상(썸네일) / AI 초안`. Auto update = 워크리스트 자동 갱신(WebSocket/폴링) 토글.

**[Z9] 상태바** — 디스크 용량 게이지 + `0 Exams (0 Images) Selected / Total 0 Exams`.
> **매핑:** 선택/전체 카운트는 동일 채택. 디스크 게이지는 관리자 대시보드로 이동(일반 사용자에겐 불필요).

---

## 2. Image Viewer 화면 분해

### 2.1 화면 전체 구조

```
┌─[V1] 글로벌 툴바 (도구 플라이아웃) ──────┬─[V2] Related Exam 스트립─┬ Min/Exit ┐
├─[V3] 썸네일 스트립 (시리즈/이미지 네비게이션)──────────────────────────────┤
├─[V4] 뷰포트 컨트롤 바 (시리즈선택·스코프·레이아웃·Config·상태)──────────────┤
│                                                                        │
│   [V5] 뷰포트 그리드 (영상 + 4코너 오버레이 + 방향마커 + 스케일 룰러)        │ [V6]
│                                                                        │ 페이지
└────────────────────────────────────────────────────────────────────────┘  탭
```

### 2.2 [V1] 글로벌 툴바 — **플라이아웃 그룹화 패턴**

스크린샷 실측 도구 구성:

| 그룹(꾹 누르면 펼침) | 포함 도구 |
|---|---|
| 표시 변환 그룹 | **Fit / Reverse / Flip / Rotate / Rotate CCW / Inverse(반전) / Oval·Rect·Free(셔터) / Marking** |
| 주석·측정 그룹 (T) | **Lens(돋보기) / Angle / Memo / Pseudo(컬러) / CT line / C-ROI(원) / R-ROI(사각) / Free ROI / 임플란트 / CT ratio(심흉비)** |
| 단독 노출 도구 | **WL / Zoom / Pan / Mag(확대경) / Line / Caliper / Text / Angle / Copy / Print / Key(키이미지) / Setting** |
| 탐색 | Prev/Next(환자 단위 이동), Local(DB), 모니터 선택 `1▾`, 레이아웃 프리셋 2종 |

**추가 확인된 플라이아웃 2종 (후속 스크린샷):**

| 그룹 | 포함 도구 | 성격 |
|---|---|---|
| 유틸리티 그룹 (O) | **Calibrate(픽셀 캘리브레이션) / Histo(히스토그램) / Filter ×2(영상처리 필터) / Delete / Exam(검사 조작) / Convert / Send(전송) / Network(상태) / Info(헤더 정보)** | 영상 자체가 아닌 **검사·데이터 단위 조작**을 뷰어 안에서 수행 — 워크리스트로 복귀하지 않는 동선 |
| **외부 모듈 런처** (□) | **3D(RapidiaMPR) / VGate / TGate / Composer / Implant / About** + 빈 슬롯 다수 | 별도 프로세스 모듈(분석 문서 §3)을 **현재 검사 컨텍스트와 함께 호출**하는 런처. 빈 슬롯 = 라이선스/설치에 따라 채워지는 확장 구조 |

**읽히는 설계 원칙:**
1. **고빈도 도구는 1클릭 노출, 저빈도는 같은 계열 플라이아웃에 수납** — 툴바 한 줄 유지.
2. **마지막 사용 도구가 그룹 대표 아이콘으로 승격**(플라이아웃 관례) — 반복 작업 최적화.
3. W/L, Zoom, Pan은 도구이자 **마우스 버튼 바인딩**(좌드래그/우드래그/휠) — 도구 전환 없이 항상 가능.
4. **외부 모듈은 뷰어 툴바의 1급 시민** — 모듈 분리 아키텍처(프로세스 분리)가 UI에서는 단일 툴바로 통합되어 보인다. 빈 슬롯 기반 확장.

> **매핑(원칙 4):** 우리의 "확장 슬롯"은 **AI 기능 진입점**이다 — `AI 초안 / 유사증례 검색 / (P2) vision 분석`을 뷰어 툴바 1급 버튼으로. 외부 모듈 런처 개념은 P2에 플러그인 슬롯(예: 3D 뷰어, 외부 분석 도구 URL 호출)으로 일반화.

> **매핑:** OHIF 툴바를 동일 원칙으로 구성 — 항상 노출: `WL / Zoom / Pan / 길이 / 스크롤 / 키이미지 / AI초안 토글`. 플라이아웃: 측정 그룹(각도·Cobb·ROI·CT ratio·캘리브레이션), 변환 그룹(회전·플립·반전·Fit), 주석 그룹(텍스트·화살표·메모). 마우스 기본 바인딩: 좌=도구, 우드래그=W/L, 휠=스택 스크롤, 중클릭=Pan (방사선과 관례).

### 2.3 [V2] Related Exam 스트립 — 화면 최상단 고정 영역
현재 환자의 과거 검사를 **뷰어 안에서 항상 노출**, 클릭으로 비교 로드. 분석 문서 G-4의 UI 실체.

> **매핑:** **P0.** OHIF Study Browser 패널로 구현하되, 각 과거검사에 **확정 판독 요약 1줄 + AI 초안의 comparison 섹션이 참조한 검사 하이라이트** 표시 — RAG 근거(ai_sources)와 UI를 연결하는 지점.

### 2.4 [V3] 썸네일 스트립
시리즈/이미지 썸네일 가로 스트립, 현재 표시 항목 노란 테두리, 드래그로 뷰포트에 배치.

> **매핑:** OHIF 기본 제공(좌측 패널). 드래그&드롭 시리즈 배치 유지.

### 2.5 [V4] 뷰포트 컨트롤 바
`시리즈 선택 [1]▾ / 스코프(Exam▾: Exam·Series 단위 넘김) / 레이아웃(1x1▾) / Config / All(전체 적용) / Undo / 시네 / 리포트 / 저장 / 새로고침 / 클립보드 / [Unread] M(상태+성별 표시) / 즐겨찾기 / 꺼내기 / Prev·Next / 분할 ▾`

핵심 패턴: **(1)** 도구 적용 범위 토글 `All`(전체 뷰포트 vs 활성 뷰포트), **(2)** 검사 상태 `[Unread]`가 뷰어 안에도 상시 표시, **(3)** 레이아웃 변경이 뷰포트 바에서 즉시 가능.

> **매핑:** 뷰포트 헤더에 `시리즈명 / 상태배지 / 레이아웃 선택 / 전체적용 토글 / 리포트 열기` 유지. "리포트" 버튼은 우리의 **AI 초안 패널 토글**로 대체.

### 2.6 [V5] 뷰포트 — 오버레이 4코너 규칙 (스크린샷 실측)

| 위치 | PiViewSTAR 표시 내용 | 채택 |
|---|---|---|
| 좌상 | 환자명(성별) / 검사부위 / 검사일 / 시각 | ✅ 동일 (마스킹 옵션 추가) |
| 우상 | 기관명 / 장비(스테이션) / Srs:n / Img:n | ✅ 동일 |
| 좌하 | 기술 파라미터 (Sens:400.00 — 모달리티별 가변) | ✅ 모달리티별 템플릿 |
| 우하 | **Z:36.54%(줌) / L:427 / W:633(윈도우)** | ✅ 동일 — 판독 재현성 정보 |
| 영상 내 | 방향 마커(R/PA), 좌측 보조마커(<LY>) | ✅ DICOM Orientation 기반 |
| 우측 변 | **스케일 룰러(18 Cm)** — 실거리 눈금 | ✅ 캘리브레이션과 연동(F-13) |

오버레이는 DemographicManager로 **레이아웃 편집 가능**(존재 자체가 요구사항: 병원마다 표기 규칙이 다름).

> **매핑:** OHIF 오버레이 커스터마이징으로 4코너 규칙 구현 + 관리자 설정에서 코너별 항목 편집(P1). 모든 항목 토글 가능(Alt+A 같은 단축키로 주석 전체 on/off).

### 2.7 [V6] 우측 페이지 탭 (1, 2)
멀티 모니터/페이지 전환 탭 — 한 모니터에서 여러 행잉 페이지를 넘기는 장치.

> **매핑:** 웹은 브라우저 창 분리 + 행잉 프로토콜 스테이지 넘김(OHIF 지원)으로 대체. 듀얼 모니터는 별도 창 팝아웃(P1).

---

## 3. 화면 간 동선 (관찰된 워크플로)

```
PiViewSTAR:
워크리스트(검색→행 선택→[Z7]리포트 미리보기 확인)
  → View&Dictate (뷰어 + 딕테이션 동시 시작)
    → 뷰어: Related Exam에서 과거검사 비교 → 측정·키이미지 → 딕테이션 완료
  → 워크리스트 복귀, 상태 갱신(Unread→Read→…)

Saintview PACS AI (목표 동선 — 한 단계 더 짧다):
워크리스트(검사 도착 시점에 AI 초안 이미 생성됨 → 목록에서 impression 미리보기)
  → View&Draft (뷰어 + AI 초안 패널 동시 오픈)
    → 뷰어: Related Exam(과거판독 요약 포함) 비교 → 초안 수정 → 확정(서명)
  → 워크리스트 복귀, draft_ready→finalized
```

차이의 본질: **PiViewSTAR는 뷰어 진입 후 판독문 생산이 시작**되지만, 우리는 **뷰어 진입 전에 초안이 존재**한다. 따라서 워크리스트의 정보 밀도(임프레션 미리보기, critical 정렬)가 INFINITT보다 더 중요해진다.

---

## 4. React 화면·컴포넌트 매핑 (frontend/src 설계)

```
pages/Worklist/
├── SourceTabs            # [Z1] 아카이브/Q-R/가져오기 (MVP: 아카이브만)
├── WorklistToolbar       # [Z2] View&Draft·키이미지·업로드·삭제 + [Z3] 필터프리셋·행잉선택
├── SearchFilterBar       # [Z4] 핵심 6필드 + 고급 필터 확장(Dx/Finding 검색 포함)
├── ExamGrid              # [Z5] 상태배지·Critical 정렬·AI초안 상태·임프레션 1행
│   └── ExamRow(expand)   #      시리즈 트리 (P1)
├── PreviewPanel          # [Z7]+[Z8] 탭: 판독문(AI초안/확정) | 정보 | 썸네일
│   └── RelatedExamsList  # [Z6 대체] 동일환자 과거검사 (F-14)
└── StatusBar             # [Z9] 선택/전체 카운트 (+ 자동갱신 토글)

pages/Study/  (OHIF 통합)
├── ViewerToolbar         # [V1] 상시도구 + 플라이아웃 그룹, 마우스 바인딩
├── RelatedExamStrip      # [V2] 과거검사 + AI comparison 근거 하이라이트
├── SeriesBrowser         # [V3] 썸네일 (OHIF 기본)
├── ViewportHeader        # [V4] 상태배지·레이아웃·전체적용·AI초안 토글
├── ViewportOverlay       # [V5] 4코너 규칙 + 방향마커 + 스케일 룰러 (관리자 편집 P1)
└── ReportDraftPanel      # 우측 도킹: AI 초안 편집기(SR 스키마 폼+자유텍스트, 근거 표시, 확정 버튼)
```

**구현 체크리스트(P0 화면 기준):**
- [ ] 워크리스트: 상태배지 색상 체계(received=회색, draft_ready=파랑, reading=노랑, finalized=초록, Emergency=빨강 테두리) — [Z5]/F-15
- [ ] 워크리스트: 행 선택 → PreviewPanel에 AI 초안 즉시 표시 — [Z7]/§3
- [ ] View&Draft 버튼 + 더블클릭 동선 — [Z2]
- [ ] 뷰어: 마우스 기본 바인딩(우드래그 W/L, 휠 스크롤) — [V1]
- [ ] 뷰어: 4코너 오버레이 + Z/L/W 표시 — [V5]
- [ ] 뷰어: Related Exam 스트립 + 과거판독 요약 — [V2]/F-14
- [ ] 뷰어: 키이미지 지정 → SR 초안에 자동 첨부 — [V1] Key/F-16
- [ ] 단축키: W(WL)/Z(Zoom)/스페이스(도구 해제)/K(키이미지)/D(초안 패널) 등 키맵 정의 — 분석 §6.1 원칙

---

## 5. Setting options 화면 분석 — 설정 정보구조(IA)의 전모

설정 다이얼로그(좌측 트리 + 우측 페이지) 스크린샷으로 **설정 체계 전체**가 확인되었다.

### 5.1 설정 트리 구조 (실측)

```
Environment                    # 사용자 작업환경 (레이아웃·시작화면·툴박스·모니터)
Network                        # DICOM 네트워크 (AE·포트·TLS·수신·원격호스트)
Worklist
├── Local / Server / DICOM Q/R / DICOM CDR    # 데이터소스별 개별 설정 ([Z1]과 1:1)
Report
├── Reading / Diagnosis / Finding              # 판독·진단코드·소견코드 설정
Print / Viewer / Window
```

핵심 관찰: **워크리스트 설정이 데이터소스별로 분기**되고(Z1 드롭다운과 1:1 대응), **Report 설정에 Diagnosis/Finding 코드 체계가 별도 페이지**로 존재(Z4의 코드 검색 필드와 연결 — 코드 사전을 사이트에서 관리한다는 의미).

### 5.2 Environment 페이지 — 사용자 작업환경

| 설정 항목 (실측) | 의미 | Saintview 매핑 |
|---|---|---|
| Default Layout (Row 2 × Col 2) | 뷰포트 기본 분할 | 사용자 설정 (P0) |
| **Modality layout** (CR ▾ + Add/Edit/Delete) | **모달리티별 기본 레이아웃 CRUD** | 행잉 프로토콜 관리(F-18). 모달리티 키 기반 |
| Main Window: 시작화면 선택 ("Worklist - Master local") | 로그인 직후 진입 화면 지정 | 사용자 설정: 시작 페이지 (P1) |
| **Main ToolBox: "Diagnose" 프리셋 + Add/Edit/Delete** | **툴박스 자체가 이름 있는 프리셋** — 역할·작업별 도구 구성을 만들어 전환 | **역할 기반 툴바 프리셋** (P1): 판독의/촬영실/참조의에게 다른 도구 세트. Tool text·Tooltip 표시 토글 포함 |
| Default DB Folder Options: **Double Click → View / Report 선택** | 더블클릭이라는 마이크로 동작까지 사용자화 | 더블클릭 동작 설정(View vs View&Draft) (P1) |
| Display monitors (개수, 사용자 정의 위치) | 멀티모니터 배치 | 창 팝아웃 설정 (P1) |
| Default hanging protocol | 기본 행잉 지정 | F-18 |
| ToolBox Position (Horizontal) | 툴바 위치 | 사용자 설정 (P2) |
| NLS Encoding (ISO IR 6) | DICOM 문자셋 기본값 | 시스템 설정 — 한글(ISO IR 149) 처리 필수 |
| Temp Directory / **External program location** | 외부 프로그램 연동 경로 | 플러그인 슬롯 설정 (P2) |

### 5.3 Network 페이지 — DICOM 네트워크 (시스템 설정)

| 설정 항목 (실측) | 의미 | Saintview 매핑 |
|---|---|---|
| Local Configuration: AETitle(PIVIEW) + Port(104) | **뷰어 자신이 SCP** (수신 가능) | Orthanc AE/포트 설정 — 관리자 화면 |
| Security: **Enable TLS** + Config | DICOM TLS 옵션 | DICOM TLS(P2) + 웹은 HTTPS 기본 |
| Destination DB / Log directory + **Log level** | 수신 저장 경로·로그 수준 | 시스템 설정 (관리자) |
| **Check calling/called AETitle** | 수신 시 발신자/수신자 AE 검증 토글 | 수신 보안 옵션 — Orthanc 설정 노출 (P1) |
| Routing spool directory + **Use spooling** | 라우팅 스풀 on/off | 본 제품 범위 외 (SaintRouter 영역) — 단 동일 패턴 확인 |
| **Remote Host Configuration**: AETitle/Host/Port/Desc/Alias 그리드 + **Network test**/Add/Edit/Delete | 원격 DICOM 노드 레지스트리 + **연결 테스트 버튼** | **DICOM 노드 관리 화면 (P1)**: 노드 CRUD + C-ECHO 테스트. SaintRouter의 Modality/Destination 관리와 동일 패턴 — UI 일관성 참고 |
| Default AETitle for Q/R | 기본 Q/R 서버 지정 | 외부 PACS 연동 설정 (P2) |

### 5.4 Worklist 페이지 — 목록 동작 설정

| 설정 항목 (실측) | 의미 | Saintview 매핑 |
|---|---|---|
| Default searching conditions: Duration(All)/Sort by(Study Date)/Order(Desc) + **Use auto search** | 진입 시 자동 검색 + 기본 정렬 | 사용자 설정: 기본 필터·정렬 (P0) — 화면 열면 바로 오늘 검사 표시 |
| Local DB Status / Spectra DB 필터 기본값 | 상태 필터 기본값 | 기본 상태 필터(예: 미확정만) (P0) |
| **Related Exam: Use auto related exam list** | 검사 선택 시 과거검사 자동 조회 토글 | F-14 — 기본 on |
| **Status Check Duration** / **Auto DB check duration** (Every 3 Days) | 상태 폴링 주기·DB 무결성 점검 주기 | 자동 갱신 주기(WebSocket 폴백 폴링) + 무결성 점검 배치(관리자, P2) |
| Backup Media / Archiving Device 목록 (이름+경로) | 아카이브 미디어 레지스트리 | 스토리지 계층 설정(관리자, P2) |

### 5.5 Worklist 소스별 페이지 (Local / Server / DICOM Q/R / DICOM CDR)

**구조적 발견: 4개 소스 페이지가 공통 설정 템플릿을 공유하고, 소스 특성에 따라 항목이 활성/비활성·추가된다.**

공통 항목 (Local·Server·CDR 동일 레이아웃):

| 설정 항목 (실측) | 의미 | Saintview 매핑 |
|---|---|---|
| **Worklist layout** (4종 라디오 — 패널 배치 다이어그램) | 그리드/미리보기/리포트 패널의 **화면 배치 프리셋 선택** ([Z5]~[Z8] 배치 변형) | 워크리스트 패널 배치 옵션 (P1): 미리보기 우측/하단/숨김 등 3~4종 프리셋 |
| Type of report window ("Do not use" ▾) | 리포트 창 표시 방식(미사용/도킹/별도창) | 미리보기 패널 모드 설정 (P1). CDR에서는 비활성 — 소스 능력에 따른 디그레이드 패턴 |
| Text list / Report — Font name·size | 목록·리포트 폰트 | 웹 타이포그래피 설정 (P2, 접근성) |
| **Patient ID Prefix** (체크+텍스트) | **소스별 환자 ID 접두어** — 다기관/다소스 ID 충돌 회피(네임스페이스) | Issuer of Patient ID 개념으로 수용 (P2): 외부 PACS 연동 시 `발급기관+ID` 복합키. 데이터 모델 `patients.patient_key`에 issuer 반영 검토 |
| **Find criteria..** | **검색 필드 구성을 소스별로 사용자화** ([Z4]의 13개 필드 선택·배치) | 검색 필터 필드 구성 설정 (P1) |
| **Header Columns..** | **그리드 컬럼 구성 사용자화** ([Z5] 컬럼 표시/숨김/순서) | **워크리스트 컬럼 사용자화 (P1)** — PACS 사용자의 표준 기대치 |
| Web Interface.. / External Link.. | 내장 웹 UI·외부 시스템 링크 구성 | 외부 링크(EMR 등) 버튼 설정 (P2) |
| Wizard option: Auto update after log in / **Save To·Load From server** | 검색 프리셋(위저드)의 **서버 저장·로밍** — Local 소스에서는 비활성, Server 소스에서만 활성 | 웹은 서버 저장이 기본 — 데스크톱 PACS의 약점이 우리에겐 공짜라는 우위 포인트 |

Server 페이지 추가 항목:

| 항목 | 의미 | 매핑 |
|---|---|---|
| Report — Default Study Date / Default Report Date (Within last 1 Year) | 리포트 조회 기본 기간(서버 부하 제어) | 기본 조회 기간 설정 (P1) — 대량 DB에서 무한 조회 방지 |

DICOM Q/R 페이지 (소스 특성이 가장 다름):

| 항목 (실측) | 의미 | 매핑 |
|---|---|---|
| Patient ID restriction: Length 8 + **Allow wildcard** | 원격 조회 시 ID 입력 제약(과도 질의 방지) | 외부 PACS Q/R 가드레일 (P2) |
| **Use C_MOVE when retrieve** | C-MOVE vs C-GET 선택(방화벽/포트 사정 대응) | Orthanc Q/R 옵션 노출 (P2) |
| Set remaining suboperation | 수신 진행률(남은 서브오퍼레이션) 표시 | 가져오기 진행률 UI (P2) |
| Default DICOM Q/R Root (Patient ▾) | Patient/Study Root 모델 선택 | Q/R 루트 설정 (P2) |

**읽히는 설계 원칙 (소스별 설정):**
1. **공통 스키마 + 소스별 오버라이드** — 설정 모델을 소스 수만큼 복제하지 않고 템플릿 상속. 우리 `app_setting`도 `scope(global/source/user) + key` 구조로 설계.
2. **소스 능력에 따른 항목 비활성**(CDR엔 리포트 없음, Local엔 서버 로밍 없음) — UI에서 숨기지 않고 회색 처리(왜 없는지 학습 가능).
3. **운영 가드레일이 설정에 내장**(ID 길이 제한, 와일드카드 허용, 기본 조회 기간) — 사용자 실수로 인한 서버 과부하를 설정 차원에서 차단.

### 5.6 Report 페이지 — 외부 연동 + 코드 사전(Reading/Diagnosis/Finding)

**Report 루트 — 외부 리포팅 연동:**

| 항목 (실측) | 의미 | Saintview 매핑 |
|---|---|---|
| **Use an external report** (경로/URL) | 내장 리포트 대신 외부 리포팅 시스템 사용 | 역방향 시사점: **우리가 타 PACS의 "external report"가 될 수 있다** — Saintview SR 편집기를 URL 호출(검사 컨텍스트 파라미터)로 노출하는 연동 모드 검토 (P2, 시장 진입 전략) |
| Call an external report directly | 판독 시작 시 외부 리포트 자동 호출 | 동일 — View&Draft 딥링크(`/study/{uid}/report`) 제공 |

**Reading / Diagnosis / Finding 서브페이지 — 3종이 완전히 동일한 CRUD 템플릿:**

화면 구성(공통): `Modality ▾ × Body Part ▾ (+ Add BodyPart)` 분류 선택 → 텍스트 입력 + `Code` 부여 + Add → `Predefined ___ (Code/Text 그리드)` + Edit/Copy/Delete.

| 사전 종류 | 내용 | Saintview 매핑 |
|---|---|---|
| **Reading** (판독문 상용구) | 자주 쓰는 판독문 전문을 코드로 등록 | F-18 상용구 — **모달리티×부위 축 분류 채택**: SR 편집기에서 현재 검사의 modality/body_part에 맞는 상용구만 우선 노출 |
| **Diagnosis** (진단 사전) | 코드+문구. 워크리스트 Dx 컬럼·검색 필드([Z4]/[Z5])의 값 원천 | SR 스키마 impression과 연결. **AI 초안의 impression에 사이트 진단코드 자동 매핑(P2)** — 통계·청구·검색 가치 |
| **Finding** (소견 사전) | 코드+문구. Fx 컬럼·검색의 값 원천 | SR findings와 연결. 동일하게 자동 매핑 후보 |

**핵심 통찰:**
1. **`Modality × BodyPart`가 코드 사전의 1차 분류축** — 우리 SR 템플릿·상용구·RAG 유사증례 검색의 1차 필터와 정확히 동일한 축이다(설계 §4.2와 일치 확인).
2. **사전 3종 = 동일 컴포넌트 재사용** — 프론트엔드 `CodeDictionaryEditor` 공통 컴포넌트 1개로 구현(분류 선택 + 코드/텍스트 그리드 + CRUD).
3. 진단·소견의 **코드화는 RAG 학습 데이터의 라벨 품질**로 직결 — 확정 판독 인제스트 시 코드가 있으면 임베딩 메타데이터로 저장(검색 정밀도·통계 향상). `reports.sr_json`에 `codes[]` 필드 추가 검토.

### 5.7 Print 페이지 — 리포트 인쇄 템플릿

| 항목 (실측) | 의미 | Saintview 매핑 |
|---|---|---|
| Header / Footer (Text + 정렬 Left/Center/Right) | 인쇄물 머리글·바닥글 | **PDF 리포트 템플릿 설정(P1)** — 설계 §6.1 PDF 출력의 사이트 설정: 머리글/바닥글/정렬 |
| Page Number (+정렬) | 페이지 번호 | PDF 페이지 번호 옵션 |
| User Information: Hospital / Department | 기관·부서명 — 인쇄물 표기 | 기관 정보는 시스템 설정(관리자)에서 1회 입력 → PDF·화면 공통 사용 |
| Overlay color: Color/Grayscale | 주석 오버레이 인쇄 색상 | PDF 내 주석 색상/흑백 옵션 (P2) |
| fast color printing / interpolation | 인쇄 품질 옵션 | 해당 없음(서버 렌더링) |

> 매핑 원칙: 필름/용지 인쇄 자체는 레거시로 제외하지만, **"기관 헤더가 박힌 공식 문서로서의 판독서 PDF"** 요구는 그대로 유효 — 헤더/푸터/기관정보/페이지번호를 사이트 설정으로 외부화.

### 5.8 Viewer 페이지 — 표시·주석 환경의 전면 설정화

| 그룹 (실측) | 항목 | Saintview 매핑 |
|---|---|---|
| Image Screen | Image Out line / **Image Focus line**(활성 뷰포트 테두리) / Patient Name 표시 | 활성 뷰포트 하이라이트(P0 — 멀티 뷰포트 필수), 환자명 표시 토글(개인정보 모드) |
| **오버레이 토글 + 단축키** | **Information(Alt+I) / Annotation(Alt+A) / Scale Bar(Alt+S)** | **단축키 키맵에 채택(P0)**: 오버레이 3계층(정보/주석/스케일)을 독립 토글 — §4 체크리스트의 키맵 구체화 |
| 표시 품질 | Use LUT / Use interpolation / **Gamma correction(1.00)** | 보간·감마 사용자 설정 (P1) |
| 동작 | Display W/L Msg box / real size clipboard / MsgBox delay(5초) | 토스트 지속시간 설정 (P2) |
| 주석 표시 | Show ROI property / Show DICOM Overlay / Show all scout lines | 주석 상세표시 토글 (P1) |
| **Screen Color — 도구별 색상 12종** | Caliper(빨강)/Angle(초록)/Scale Bar/Information/Histogram/**Key Image(초록)**/Arrow(시안)/Text/Rect ROI(시안)/Oval/Free ROI/Pseudo(빨강) | **주석 도구별 색상 팔레트(P1)** — 도구 종류마다 다른 색 = 영상 위에서 측정 종류를 색으로 즉시 구분하는 관례. 우리 기본 팔레트도 도구별 차등 적용 |
| 정밀도 | Free line ROI: 5 dots/line | 프리핸드 ROI 정밀도 (P2) |
| 기타 | Type of ECG(Transparent), Screen Font | US/ECG 파형 표시 모드 (P2), 오버레이 폰트 크기(P1 — 고해상도 모니터 대응) |

**핵심 통찰:** 오버레이가 **정보/주석/스케일 3계층으로 분리**되어 독립 토글된다는 것, 그리고 **주석 색상이 도구 의미론**(빨강=캘리퍼·시안=ROI·초록=키이미지)이라는 것. 우리 ViewportOverlay 컴포넌트를 3계층 구조로 설계하고, 도구 색상은 테마 토큰으로 정의한다.

### 5.9 Window 페이지 — 뷰어 동작·성능 설정

| 그룹 (실측) | 항목 | Saintview 매핑 |
|---|---|---|
| Default window size | Magnifier 200×200 / Magic glass Auto mode | 확대경 크기 사용자 설정 (P2) |
| **Apply All option** | Default is ON / Synchro Window Level / Apply Zoom·Pan | **도구 전체적용의 기본값과 항목별 범위**([V4]의 All 토글 상세): W/L 동기는 빼고 Zoom/Pan만 전체 적용하는 식의 세분화 — 우리 전체적용 토글도 항목별 체크(P1) |
| Image displaying order | Ascending/Descending | 스택 정렬 방향 (P1) |
| **CR image option** | **W/L optimizer / Auto filtering** | **CR/DX 자동 W/L 최적화(P1)** — 평판영상 표시 품질의 자동 보정. OHIF 기본 VOI + 히스토그램 기반 최적화 검토 |
| Auto close (5 Exams) | N개 초과 검사 자동 닫기 — 메모리 관리 | 웹 대응: 뷰어 탭/캐시 상한 관리(브라우저 메모리) — 성능 설계 노트 |
| Window/Level Memory | virtual/real memory | 해당 없음(데스크톱 메모리 전략) |
| **Ignore series** | 모달리티 체크(CR/CT/MR/US/NM/XA) + **시리즈 설명 패턴 4슬롯(AA/BB/CC/DD)** | **시리즈 제외 규칙(P2)**: 스카웃/로컬라이저 등 설명 패턴 기반 자동 제외. **RAG 키이미지 선정에도 동일 규칙 재사용**(분석 대상에서 스카웃 제외) |
| **Show as real size** | 모달리티별(CR/XA/US/ES/CT) 1:1 실제 크기 표시 | 모달리티별 실측 표시 옵션(P2) — 캘리브레이션(F-13) 연계 |
| Thumbnail window / Multiframe | 썸네일 표시 / **High speed + Auto Play** | 멀티프레임(US/XA 시네) 자동재생 옵션 (P1) |

### 5.10 Find criteria / Header Columns 다이얼로그 — 듀얼리스트 패턴 + 전체 필드 인벤토리

두 다이얼로그 모두 **Available ↔ Selected 듀얼 리스트 + 화살표 이동 + Up/Down 순서 조정** — 사용자화 UI의 표준 패턴(우리도 동일 패턴 채택, P1).

**실측 필드 인벤토리(두 다이얼로그 합집합)** — 워크리스트가 다룰 수 있는 필드의 전체 후보 풀:

```
신원/검사: Patient ID·Name·Age·Sex, Birth Date, Study Date Time, Study Description,
          Modality, Body part, Accession Number, Study ID, Institution, Number of series/images
인력:     Referring Physician(의뢰의), Radiologist(판독의), Attending/Consulting Doctor,
          ER Physician, Department(Branch of Service)
판독 산출: Diagnosis, Diagnosis Code, Disease Code, Finding, Exam status, Backup
워크플로 타임스탬프: Admit Date, Approval Date, Dictate Date, Approver1, Approver2, Dictator
응급판독 워크플로: ED Initial State, ED Final State, ED Agree State, ED Discrepancy State,
          ED Note State, ED Stat
```

**핵심 발견 2건:**
1. **Approver1/Approver2 + Dictator + 각 단계 타임스탬프가 필드로 존재** — 판독 워크플로의 각 단계가 '누가·언제'로 기록됨(F-17 2차 승인의 데이터 근거 확인). 우리 `reports`에 단계별 actor/timestamp가 이미 있으나(버전 행 보존), **검색·통계 필드로 노출**하는 것까지가 요구사항.
2. **ED(응급) 판독 불일치 추적 워크플로**: Initial(예비판독) → Final(최종판독) → **Agree/Discrepancy(일치/불일치 판정)** → Note. 응급실 예비판독과 영상의학과 최종판독의 불일치를 시스템이 추적 — 환자 안전 기능. **우리 제품에서는 'AI 초안 vs 판독의 확정'의 불일치 추적으로 전환**되는 매우 중요한 개념(§아래 매핑).

> **매핑(발견 2):** `reports`에 **AI 초안과 확정본의 차이 지표**(diff 요약, 수정률) 저장 → ① AI 품질 대시보드(설계 §10 "초안 수용도"의 데이터 원천) ② critical 소견이 초안에 있었는데 확정에서 빠진 경우(또는 역) 알림 — **AI-판독의 불일치 리뷰 워크플로(P2, 신규 F-20)**.

### 5.11 External Link 다이얼로그 — 컨텍스트 변수 치환 연동

4개 슬롯 × (Title + Command + **Link with exam** 토글), **치환 변수 12종**:
`%pi`(Patient ID) `%pn`(Name) `%ps`(Sex) `%pf`(Patient Info) `%si`(Study ID) `%sd`(Study Date) `%su`(**Study Instance UID**) `%an`(Accession No) `%sk`(Study Key) `%ex`(Export Files) `%opi`(Other Patient ID) `%id`(Login ID)

> **매핑:** EMR 등 외부 시스템 호출의 업계 표준 패턴. 우리는 **양방향으로 정의**한다(P2):
> - **나가는 링크**: 관리자 설정에 외부 링크 슬롯(제목+URL 템플릿+변수 치환 `{patientId}` `{accessionNumber}` `{studyUid}` `{loginId}`), 워크리스트/뷰어 컨텍스트 메뉴에 노출.
> - **들어오는 딥링크**: `/study/{studyUid}?accession={an}` — 타 시스템(EMR·타 PACS의 External Report 설정)이 우리를 호출하는 진입점(§5.6 역방향 전략과 한 쌍).

### 5.12 Print 다이얼로그(실행 시) — 출력 범위·구성 선택

탭 3종: **Paper Print / DICOM Print / Presentation**.

| 영역 (실측) | 항목 | Saintview 매핑 |
|---|---|---|
| Overlay 토글 5종 | Information / Simple / Annotation / Patient Name / Scale Bar — **출력 시점에 오버레이 선택** | PDF/이미지 내보내기 옵션에 동일 5토글 (P1) — §5.8의 3계층 + 환자명/간소 모드 |
| **Printing 범위** | Current Exam(Row×Col) / Current Series / Current Page / **Selected Images** / **User defined layout** | 내보내기 범위 선택기 (P1): 검사 전체·현재 화면·선택 영상·키이미지 |
| Print with Report / **Attach Key Images** | 판독문 동봉·키이미지 첨부 | **판독서 PDF에 키이미지 자동 첨부(P1)** — F-16과 연결, AI 초안 근거 영상 동봉 |
| User defined layout 목록 | SAMPLE1·A4·PORTRAIT (.lda 재사용) | 내보내기 레이아웃 프리셋 (P2) |
| Preview / # of Pages | 인쇄 미리보기·페이지 수 | PDF 미리보기 (P1) |

> Paper/DICOM Print 탭 자체는 레거시 제외 대상이지만, **"범위 선택 + 오버레이 선택 + 키이미지 첨부 + 미리보기"라는 출력 파이프라인 UX**는 PDF 내보내기에 그대로 이식한다.

### 5.13 설정 체계의 교훈 → Saintview 설정 IA

1. **2계층 분리가 명확하다**: Environment/Worklist 일부 = *사용자* 환경, Network/아카이브 = *시스템(관리자)*. PiViewSTAR는 한 다이얼로그에 섞여 있으나(데스크톱 단일 사용자 가정), 웹 다중 사용자에서는 분리가 필수.
2. **마이크로 UX까지 설정화**(더블클릭 동작, 툴팁 표시, 자동검색) — 사이트·개인 관행 수용이 PACS 정착의 조건.
3. **연결 테스트가 설정 화면에 내장**(Network test 버튼) — SaintRouter 축 B와 동일 교훈 재확인.
4. **코드 사전(Diagnosis/Finding)을 사이트가 관리** — 우리는 SR 스키마의 severity·권고 어휘를 사이트 설정으로 노출할지 검토(P2).
5. **설정 모델은 공통 스키마 + 스코프 오버라이드**(§5.5) — `app_setting(scope, key, value)`: scope = global → source → user 순으로 우선 적용. 소스 능력에 없는 항목은 회색 비활성으로 노출.
6. **사용자화의 깊이가 곧 정착률** — 검색필드 구성(Find criteria), 그리드 컬럼(Header Columns), 패널 배치(Worklist layout)까지 사용자가 바꾼다. 웹 구현은 컬럼 설정을 서버에 저장해 어디서 로그인해도 동일하게(데스크톱 PACS 대비 우위).

```
Saintview 설정 IA (제안):
사용자 설정 (프로필 메뉴)                       관리자 설정 (Admin 페이지)
├── 워크리스트: 기본필터·정렬·자동검색             ├── DICOM: AE/포트, 노드 관리(+C-ECHO 테스트), 수신 검증
│   ├── 컬럼 구성(표시/숨김/순서)                 ├── 외부 PACS Q/R: 루트·C-MOVE/GET·가드레일 (P2)
│   ├── 검색 필드 구성                          ├── 스토리지: 보관 경로·정책
│   └── 패널 배치(미리보기 위치)                  ├── AI: 모델·자동생성 on/off·임계치·비용 한도
├── 뷰어: 기본 레이아웃, 행잉, 더블클릭 동작        ├── 사용자/권한, 감사 로그 조회
├── 툴바 프리셋(역할 기반)                       ├── 연동: EMR 외부링크, 딥링크/external-report 모드 (P2)
├── 단축키 키맵(Alt+I/A/S 오버레이 3계층 포함)     ├── 코드 사전(Reading/Diagnosis/Finding, 모달리티×부위 축)·SR 템플릿
└── 표시: 오버레이 토글, 다크/라이트, 폰트 크기,    └── PDF 템플릿(헤더/푸터/기관정보), 기본 조회기간 (P1~P2)
        도구별 주석 색상, 감마/보간
※ 모든 사용자 설정은 서버 저장(로밍) — PiViewSTAR의 "Save To server"가 기본값인 셈
```

---

## 6. 설계 문서 반영 사항

- §2.1 F-2(검색)에 **진단·소견 코드/텍스트 검색** 명시(우리는 SR JSONB + RAG 인덱스로 우위 확보 가능).
- §2.1 F-14(Related Exams)의 UI 정의를 본 문서 §2.3으로 구체화.
- 프론트엔드 컴포넌트 구조(§4)를 S1(워크리스트)·S4(SR 편집기) Phase 산출물 기준으로 사용.
- "View&Draft 원클릭 판독 진입"을 §5.2 사용성 기준에 추가 권고: **워크리스트→판독 시작 ≤ 2클릭, 초안 확인 ≤ 1클릭.**
- **설정 IA(§5.5)를 F-10(사용자/권한·관리)의 화면 설계 기준으로 채택** — 사용자 설정/관리자 설정 2계층 분리, DICOM 노드 관리에 C-ECHO 연결 테스트 내장, 워크리스트 자동검색·기본필터는 사용자 설정 P0.
- 뷰어 툴바에 **AI 기능 1급 버튼**(AI 초안 토글·유사증례) 배치 — §2.2 원칙 4.
