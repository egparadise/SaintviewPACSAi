# INFINITT PACS User Guide(2013, Abex IIT) 분석 — In Viewer/Worklist 설계 기준

> 원본: `INFINITT Healtcare User Guide.pdf` 15p (사용자 제공 설계 문서). 스크린샷·표 전수 판독.
> 관계 문서: 파일 수준 분석 `ANALYSIS_INFINITT_파일정밀분석.md`, 화면 분석 `UI_ANALYSIS_PiViewSTAR_화면분석.md`.
> 구성 상수: `frontend/src/lib/infiConfig.ts` (IN_EXAM_STATUSES/IN_CROSSLINK_MODES/IN_MOUSE_OPS 등).

## 1. Worklist 화면 — 7구역 구성 (p.5)

| # | 구역 | 내용 | Saintview 매핑 |
|---|---|---|---|
| ① | Main Tool bar | 상단 우측 아이콘 열 | ActionToolbar |
| ② | 검색조건 행 | Patient Name / Patient ID / Study Date / Exam Description 콤보 + Clear Cond + 🔍(우상단 Search=DB 재조회) | FilterBar(FIND_FIELDS) + SEARCH |
| ③ | Search results | 메인 검사 그리드 — 상태아이콘·ID·Name·Sex·Series·Images·Modality·Study Date·Study Desc·병원 | StudyGrid |
| ④ | Related Exam | 선택 환자의 과거검사 그리드(메인 그리드 바로 아래, 동일 컬럼) | PriorStudiesGrid |
| ⑤ | Report | 선택 검사 판독문 — Accession No/Patient/Exam Date[상태]/Study Comment(Disease)/Sex·Age/**Dictator·Dictated·Transcriber·Approver·Approver2**/Report Date | ReportPanel(메타표 포함) |
| ⑥ | Preview | 좌하단 선택 검사 썸네일 미리보기 | KeyImageStrip/썸네일 |
| ⑦ | Search Filter | **좌측 트리: 모달리티 트리(CT/MR/US/XA/CR…) + Favorites(자주 쓰는 검색조건 등록·사용)** | SearchRail 모달리티 트리(본 구현) + 검색 바로가기 |

## 2. 검사 상태(Exam Status) 12단계 (p.5 표)

기본 7 + Addendum 5. 각 상태는 아이콘 쌍(검사/폴더)으로 워크리스트에 표시.

| 상태 | 의미 | | 상태 | 의미 |
|---|---|---|---|---|
| Examined | Unread exam(미판독) | | Approved | Confirmed report by Approver |
| Verified | After changes saved | | Addendum Dictating | 추가판독 녹음 중 |
| Dictating | After voice recording 중 | | Addendum Dictated | 추가판독 녹음 완료 |
| Dictated | After voice recorded | | Addendum Transcribing | 추가판독 작성 중 |
| Transcribing | After reporting 중 | | Addendum Transcribed | 추가판독 작성 완료 |
| Transcribed | After reported | | Addendum Approved | 추가판독 승인 |

Saintview 상태 매핑: received→Examined, draft_ready→Transcribed(AI 리포트 작성됨), reading→Transcribing, in_review→Verified, finalized→Approved, +2차승인(confirm2)=Approver2 기록.

## 3. 기본 조작 Step 1~9 (p.4~9)

1. 로그인(ID/PW) + 비밀번호 변경(현재→새→새 확인).
2. Worklist 검색(§1). 3. View 버튼→영상 표시. 4. 툴바 도구 선택. 5. Related exam 표시.
6. **Show series**: 열린 검사의 시리즈 목록 — 시리즈 선택 시 창에 표시, **Combine Series**로 여러 시리즈 합침.
7. 화면 Layout 선택. 8. **Close Exam 5옵션**: 현재만/전체/현재 환자/닫으며 자동 Verify/닫은 뒤 동작(그냥·Worklist 열기·다음 검사 열기). 9. 종료.

## 4. W/L 조작 3방법 (p.10)

① Windowing 툴 ② **Windowing Preset에 핫키 지정 후 사용** ③ **마우스 우클릭 드래그**.

## 5. Crosslink 5모드 (p.11)

① Crosslink(다중 이미지) ② Auto Sync(같은 검사의 시리즈 동기) ③ **Sync With Other Exams**(같은 환자 과거검사와 동기) ④ Scout Line 표시 ⑤ All Lines(활성 시리즈의 모든 참조선).

## 6. 툴바 버튼 전체 카탈로그 (p.11~14 표 전수)

- **기본**: Select, Pan, Zoom(드래그), Windowing, Magnification(부분 확대), Fit
- **유틸**: Capture All(전 모니터 캡처), Reset, Print, Setting(뷰어 설정), 3D Cursor(옵션), Dictation/Tape Dictated/Play Dictation, Refresh Exam
- **선택**: Select All / Select All Inverse / Select Image Set
- **방향**: Flip Vertical/Horizontal, Rotate Left 90/Right 90/Right 180, B/W Inverse
- **셔터**: Ellipse / Rectangle / Polyline Shutter
- **필터**: Sharpens / Average(평활) / Pseudo(NM 컬러) / Auto Scroll
- **전문 측정**: CT Ratio(심흉비), Limb Length Discrepancy(양측 다리), Center Line, Profile(픽셀 그래프), 2D Table(범위 픽셀값), Calibrate(Pixel Spacing), Spine Label(척추 번호), Volume Measure(US 볼륨)
- **3D 주석**: 3D Arrow/Text/Line/Curve
- **2D 주석**: 2D Arrow/Text/Box(메모)/Key(키이미지 지정)/Circle/Rectangle/Polyline/Freehand, Marking(문자), Lens/Hounsfield unit/SUV(픽셀 정보)
- **2D 측정**: Measure 2D Line/Curve/Angle/Ellipse/Rectangle/Area freehand/Cobb Angle

## 7. 마우스 조작 (p.14)

| 조작 | 동작 |
|---|---|
| 좌클릭 | 이미지/객체 선택 |
| Ctrl+좌클릭 | 다중 선택 |
| Shift+좌클릭 | 연속 다중 선택 · MPR에선 Zoom In |
| Shift+우클릭 | MPR Zoom Out |
| 좌드래그 | 툴바 지정 도구 실행 |
| **더블클릭** | **이미지 최대화/해제** |
| 우클릭 | 컨텍스트 메뉴 |
| **우드래그** | **기본 지정 도구(W/L) 실행** |
| Ctrl+휠 | 2D Zoom in/out |
