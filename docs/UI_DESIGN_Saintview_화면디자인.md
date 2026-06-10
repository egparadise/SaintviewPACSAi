# Saintview PACS AI — 목표 화면 디자인 명세

> 작성일: 2026-06-11. 근거: 사용자 제공 차세대 PACS 레퍼런스 스크린샷 5종(다크 테마 워크리스트·뷰어·컨텍스트 메뉴·MG 행잉).
> **결정: Saintview PACS AI의 화면 디자인은 본 레퍼런스 스타일을 따른다.** 기능 정의는 설계 문서 F-1~F-21, 기능-화면 매핑은 `UI_ANALYSIS_PiViewSTAR_화면분석.md`(존 모델)를 유지하고, **시각 디자인·레이아웃을 본 문서로 대체·구체화**한다.
> ⚠ 레퍼런스의 시각 자산(아이콘·로고)을 복제하지 않는다. 토큰·배치·패턴 수준으로 채택한다.

---

## 1. 디자인 시스템 (Design Tokens)

레퍼런스에서 추출한 시각 언어를 Saintview 토큰으로 정의한다.

### 1.1 색상 토큰

```css
/* 배경 계층 (다크, 깊이 3단계) */
--bg-canvas:    #0b0c0e;   /* 뷰포트·최하층 (영상 영역은 순수 검정 #000) */
--bg-panel:     #1c1f23;   /* 패널·그리드 영역 */
--bg-elevated:  #2a2e34;   /* 툴바·그리드 헤더·카드 */
--bg-hover:     #353a41;

/* 텍스트 */
--text-primary:   #e8eaed;
--text-secondary: #9aa0a6;
--text-disabled:  #5f6368;

/* 액센트 (선택·활성) */
--accent:         #1e6fd9;  /* 선택 탭·활성 버튼 (레퍼런스의 파란 탭) */
--accent-subtle:  #173a63;

/* 상태 색상 (워크리스트 STUDY STAT 의미론 — 레퍼런스 실측) */
--stat-received:  #9aa0a6;  /* 도착(미처리) — 회색 */
--stat-draft:     #38bdf8;  /* AI 초안 완료 — 시안/하늘 (우리 고유 상태) */
--stat-reading:   #fbbf24;  /* 판독중(EXAMINED 노랑 대응) */
--stat-final:     #ef4444 → #22c55e;
  /* 레퍼런스는 CONFIRMED=빨강 체크. 우리는 finalized=초록 채택, 빨강은 Emergency/Critical 전용으로 예약 */
--stat-emergency: #ef4444;  /* Emergency/Critical — 행 테두리·배지 */

/* 주석 도구 색상 (화면분석 §5.8 의미론 유지) */
--anno-measure: #ef4444;  --anno-roi: #22d3ee;  --anno-keyimage: #22c55e;
--anno-text: #ffffff;     --anno-ai: #a78bfa;   /* AI 생성 주석/하이라이트 전용 보라 — 사람 주석과 시각 구분 */
```

### 1.2 타이포·밀도

- 폰트: 시스템 산세리프(Pretendard/Noto Sans KR), 그리드 12~13px, 패널 제목 11px 대문자, 오버레이 12px.
- **고밀도 그리드**: 행높이 26~28px(레퍼런스 수준). 판독실은 정보 밀도가 가독성보다 우선되는 도메인 — 일반 웹 SaaS의 여백 기준을 적용하지 않는다.
- 아이콘: 1.5px 스트로크 라인 아이콘, 18~20px. 도구 팔레트는 28×28 버튼 2열.

### 1.3 컴포넌트 패턴

| 패턴 | 레퍼런스 관찰 | 채택 |
|---|---|---|
| 워크스페이스 탭 | 상단 `WORK 1 [+] EDIT PATIENT` — 작업공간 복수 운용 | 탭 모델 채택: `워크리스트 [+]` 복수 탭(서로 다른 필터 상태 유지) + 고정 탭 |
| 콤보 필터 바 | 모든 컬럼 필터가 상단 한 줄 콤보로 | [Z4] 구현형: 한 줄 콤보 필터 + 우측 대형 SEARCH |
| 상태 아이콘+색 | 노랑/빨강 체크박스형 배지 | 배지(아이콘+색+텍스트) — §1.1 상태 토큰 |
| 우클릭 컨텍스트 메뉴 | 워크리스트의 액션 허브(§3.3) | 전 그리드에 컨텍스트 메뉴 표준화 |
| 접이식 도구 팔레트 | 뷰어 좌측 `Common/Annotation/2D/ETC` 섹션 | OHIF 좌측 팔레트 커스텀(§4.2) |
| 뷰포트 헤더바 | 뷰포트마다 상태·환자·검사 요약 + 미니 아이콘 | OHIF 뷰포트 헤더 커스텀(§4.3) |
| 하단 상태바 | 서버 URL·로그인·결과/선택 수·시각 | 동일 채택 |

---

## 2. 화면 프레임 구조

```
┌ 글로벌 헤더: [로고] 워크스페이스 탭(WORK1 + EDIT PATIENT→우리: 워크리스트/관리/환자) ─ 사용자·알림 ┐
│                                                                                            │
│  (워크리스트 워크스페이스 §3  |  뷰어 워크스페이스 §4)                                          │
│                                                                                            │
└ 상태바: 서버·로그인 사용자(역할) · N results M selected · AI 큐 상태 · 시각 ──────────────────────┘
```

뷰어는 별도 라우트가 아니라 **검사 탭으로 열림**(레퍼런스: `WORKLIST` 버튼 + `MR,20181203` `CT,HEAD,20190203` 탭) — 워크리스트↔뷰어 전환이 탭 클릭 1회. 멀티 검사 동시 오픈.

---

## 3. 워크리스트 워크스페이스 — 5구역 레이아웃

레퍼런스의 핵심 가치: **한 화면에 판독에 필요한 모든 컨텍스트**(목록+과거검사+비교세트+리포트+상용구+오더)가 동시에 보인다. 기존 존 모델([Z1]~[Z9])을 이 레이아웃에 재배치한다.

```
┌─[A] 툴바: 뷰어 모니터 보내기 │ 열기/삭제/전송/설정/링크/검색 │ SEARCH 대형 입력 ──────────────┐
├─[B] 콤보 필터 바: ID│NAME│SEX│MODALITY│STUDY DATE│DESCRIPTION│… (사용자 구성 F-8) ──────────┤
├─[C-좌] 날짜/폴더 트리      │ [C] 메인 검사 그리드 ────────────────────────────────────────┤
│   (Today, 기간, 폴더)      │  # │확장│STUDY STAT│ID│NAME│SEX│IO│MOD│BODYPART│DESCRIPTION│  │
│                           │  STUDY DATE│REMARK│SRS│INST│PRIORITY│ + AI초안·Critical 컬럼   │
├─[D-좌] 과거검사 그리드(동일환자, 기간·상태 필터, With Open) │ [D-우] 비교세트(Complementary) ──┤
├─[E-좌] 상용구 패널        │ [E-중] 리포트 패널              │ [E-우] 오더/예약 그리드 ────────┤
│  Std│Linked│History│GKey  │  Reading/Conclusion/Recommend  │  (RIS 오더 연동 P2)          │
│  그룹·분류 그리드+검색      │  +환자·검사·판독자 메타 테이블    │                             │
│  Copy/New/Edit/Del        │  ★우리: AI 초안이 여기 표시       │                             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 구역별 정의 (기능 ID 연결)

| 구역 | 내용 | 기능 연결 |
|---|---|---|
| [A] 툴바 | 모니터별 뷰어 열기(1·2·3), Import, 삭제, 전송, 설정, 외부링크, 내보내기 + **View&Draft 주버튼** | [Z2], F-21 |
| [B] 필터 바 | 콤보 필터(구성 가능) + 대형 검색. 진단·소견 검색 포함 | [Z4], F-2, F-8 |
| [C] 메인 그리드 | 레퍼런스 컬럼 세트 채택 + **우리 고유 컬럼: AI초안 상태·Critical 플래그·임프레션 1행** | [Z5], F-15, F-20 |
| [C-좌] 트리 | Today 기본 + 기간·커스텀 폴더(티칭) | [Z3] |
| [D-좌] 과거검사 | 선택 환자의 과거검사 자동 로드(`REPORTED`·`6 MONTH`·`With Open` 필터 — 레퍼런스 그대로), 더블클릭 비교 오픈 | **F-14 Related Exams의 구현형** |
| [D-우] 비교세트 | 현재검사와 함께 열 검사 스테이징(Complementary set) | F-14 확장 |
| [E-좌] 상용구 | Std/Linked/History/G Key 탭 + 그룹·분류 체계 + CRUD | **F-18 구현형** (Modality×BodyPart 분류는 GROUP/Class 콤보로) |
| [E-중] 리포트 | Reading/Conclusion/Recommend 3단 + 메타(Dictator·Reader·**Conf1·Conf2**) | **AI 초안 표시 위치(P0).** SR 스키마 §6.2의 findings→Reading, impression→Conclusion, recommendations→Recommend 직접 매핑. Conf1/Conf2 = F-17 2차 승인 표기 확인 |
| [E-우] 오더/예약 | RIS 오더·예약 목록(ACCESSION 매칭) | P2 (MWL 연동) |

### 3.2 리포트 패널 [E-중] — AI 초안의 1급 표면

레퍼런스의 Reading/Conclusion/Recommend 3단 구조가 **우리 SR JSON 스키마와 정확히 일치**한다. 적용:
- 검사 행 선택 → 패널에 AI 초안 즉시 렌더(draft 배지 + 생성시각 + 모델). 확정본 있으면 확정본 우선, 토글로 초안 대비(diff 하이라이트 — F-20).
- AI 근거(ai_sources) 링크를 Reading 섹션 하단에 1줄 표기 → 클릭 시 [D-좌] 과거검사 해당 행 하이라이트.
- 패널 내 인라인 수정 가능(간단 수정은 뷰어 진입 없이) → "Direct Report" 동선(§3.3)과 합치.

### 3.3 컨텍스트 메뉴 (레퍼런스 실측 → 우리 메뉴)

레퍼런스 메뉴 구성을 그대로 그룹 구조로 채택, 항목은 우리 기능으로 치환:

```
검색:   Add Search Value / Clear Study List / Query
보기:   View / Add View / Stack View / Advance View / Key Image Open
        → 우리: View&Draft / 비교로 추가 / 키이미지 열기 / (Stack·Advance는 P2)
전송:   Send / CD Burn / Export Result / Print
        → 우리: 외부 전송(P2) / 공유 링크(F-19) / PDF 내보내기 / 결과 CSV
관리:   Delete / Comment / Label / Assign▸ / Priority▸ / Bookmark▸
        → 우리: 삭제(권한) / 코멘트 / 라벨 / 판독의 배정▸ / 우선순위(Emergency)▸ / 북마크▸
판독:   Direct Report / Direct Report-Read▸ / Direct Report-Confirm▸ /
        Dictation / Multi Report / Copy Report / Concurrent Confirm / Set Status▸
        → 우리: 초안 바로 편집(Direct Draft) / 초안 재생성 / 일괄 확정(Multi-Confirm, 정상소견 묶음 처리) /
                상태 변경▸. Dictation은 제외(AI 대체), Multi Report→여러 검사 초안 일괄 검토(P1)
```

> **Multi Report·Concurrent Confirm의 시사점:** 레퍼런스는 여러 검사를 묶어 한 번에 판독·승인하는 동선을 1급으로 제공한다. 우리 버전 = **"AI 초안 일괄 검토 모드"**: 정상(critical 없음 + 높은 confidence) 초안들을 목록에서 다중 선택 → 순차 검토·일괄 확정. 판독 처리량의 핵심 동선으로 P1 채택.

---

## 4. 뷰어 워크스페이스

```
┌ [T] 검사 탭 바: [WORKLIST] │ MR,TMJ,20190125 ✕ │ CT,HEAD,20190203 ✕ │ …──────────────────┐
├─[L] 좌측 도구 팔레트 │ [H] 행잉 바: 레이아웃(1×2▾)·페이지 ◀▶·Hide·Thumbnail·HP·AL          │
│  레이아웃 선택(1▾,1×2▾)│ ┌─[VP] 뷰포트 헤더: 상태,,모달리티,날짜 + 미니 아이콘 + 시리즈 번호─┐ │
│  ◀▶ 페이지            │ │                                                              │ │
│  [Common]   2열 아이콘 │ │   영상 + 오버레이(§4.3)                                       │ │
│  select/pan/zoom/WL/  │ │                                                              │ │
│  ROI/fit/rotate/layout│ └──────────────────────────────────────────────────────────────┘ │
│  [Annotation] 접이식   │   (그리드 분할 시 뷰포트 반복, 활성 뷰포트 테두리 하이라이트)          │
│  [2D] [ETC] [AI]★     │                                                                  │
└─ 하단: 패널 접기 토글 ──┴──────────────────────────────────────────────────────────────────┘
```

### 4.1 검사 탭 바 [T]
- `WORKLIST` 복귀 버튼 고정 + 열린 검사 탭(닫기 ✕). 탭 제목 = `MOD,부위,날짜` 요약.
- 비교 검사를 같은 워크스페이스의 추가 뷰포트로 열거나(1×2) 새 탭으로 — [D-우] 비교세트에서 전달.

### 4.2 좌측 도구 팔레트 [L]
- 상단: 행잉 레이아웃 2종 콤보(모니터 구성 / 뷰포트 분할), 페이지 ◀▶, Hide(팔레트 접기), Thumbnail(썸네일 패널 토글).
- 섹션(접이식, 레퍼런스 구성 준용): **Common**(선택·Pan·Zoom·Zoom ROI·W/L·ROI·확대경·Fit·반전·회전·레이아웃·링크싱크·캡처·저장·내보내기), **Annotation**(텍스트·화살표·각도·Cobb·캘리브레이션·키이미지), **2D**(필터·Pseudo·히스토그램), **ETC**.
- **[AI] 섹션 신설(우리 고유, 팔레트 최상단 고정):** `AI 초안 패널 토글 / 유사증례 / AI 주석 표시(보라 토큰) / 초안 재생성`. 레퍼런스의 mic(딕테이션) 아이콘 자리에 해당하는 위상.
- 모든 도구 툴팁에 단축키 표기. PiViewSTAR 분석의 플라이아웃 원칙은 "섹션 접이식"으로 대체(레퍼런스 방식).

### 4.3 뷰포트 [VP]
- **뷰포트 헤더바**(레퍼런스 채택): `상태,모달리티,날짜` 요약 + 미니 아이콘(레이아웃·시리즈 교체·동기화·스크롤 모드) + 우측 시리즈 번호. 더블클릭 = 1×1 확대 토글.
- 오버레이(다크 최적화, 화면분석 §2.6 4코너 규칙 유지):
  - 좌상: 방향(F)·날짜시각·SL/SP(슬라이스)·자세(HFS)·기술 파라미터
  - 우상: 장비명·Srs/Img 번호
  - 좌하: [F]/[PL] 방향 마커 / 우하: **Z(줌)·WC·WW** + 스케일 바(5cm/14cm)
  - 우측 변: 스택 스크롤 인디케이터(현재/전체)
  - Alt+I/A/S 3계층 토글(화면분석 §5.8) 유지. **AI 하이라이트 계층(Alt+D)** 추가 — AI가 참조한 키이미지·영역 표시(보라).
- 활성 뷰포트: 액센트 테두리 1px(Image Focus line 대응).

### 4.4 모달리티 행잉 (레퍼런스 검증 사례)
- **MG**: RCC│LCC 상단, RMLO│LMLO 하단 4-view, 좌우 흉벽 맞붙임(레퍼런스 5번째 화면 그대로) — F-18 행잉의 MG 기본값.
- **CT/MR 혼합**: 2D 단면 + MIP/MRA + (P2+) 3D VR 뷰포트 혼합 행잉 — 레퍼런스 2번째 화면. MVP는 2D+MPR 기본(3D VR은 범위 외 유지).
- **MR 다중 시리즈**: 1×2 세로 스택 비교(3번째 화면).

---

## 5. 구현 지침 (frontend)

1. **테마**: §1.1 토큰을 CSS 변수+Tailwind 토큰으로 정의, OHIF 테마 오버라이드에 동일 토큰 주입(뷰어-앱 시각 일관성). 다크 단일 테마로 시작(라이트는 P2).
2. **레이아웃**: 워크리스트 5구역은 CSS Grid + 패널 리사이저(드래그 분할 조정, 상태 서버 저장 — app_setting user scope). [D]·[E] 구역은 개별 접기 가능.
3. **그리드 컴포넌트**: 고밀도(28px 행)·가상 스크롤·컬럼 구성(F-8 듀얼리스트)·정렬·우클릭 메뉴를 갖춘 공통 `StudyGrid` 1개로 [C]/[D-좌]/[D-우]/[E-우] 전부 구현.
4. **기존 컴포넌트 트리 갱신**: 화면분석 §4의 `pages/Worklist` 구조를 본 문서 5구역으로 개편 — `WorkspaceTabs / FilterBar / DateTree / StudyGrid(main) / PriorStudiesPanel / ComparisonSetPanel / PhrasePanel / ReportPanel / OrdersPanel / StatusBar`. `pages/Study`는 §4 구조(`StudyTabs / ToolPalette / HangingBar / ViewportGrid / ViewportHeader / ViewportOverlay / AIDraftPanel`).
5. **우선 구현 순서(S1·S4 연동)**: ① 프레임+테마+상태바 ② [B]+[C](StudyGrid) ③ [E-중] 리포트 패널(AI 초안) ④ [D-좌] 과거검사 ⑤ 컨텍스트 메뉴 ⑥ 뷰어 프레임([T][L][VP]) ⑦ 일괄 검토 모드.

---

## 6. 설계 문서 반영

- UX 원칙 갱신: "판독실 다크 테마 + 키보드 우선" → **"레퍼런스 디자인 시스템(본 문서 §1) + 한 화면 컨텍스트 원칙(§3) + 키보드 우선"**.
- F-18 행잉의 MG 4-view 기본값, F-14의 [D] 구역 구현형, F-20의 diff 토글 위치([E-중]) 확정.
- **신규 P1 동선: AI 초안 일괄 검토 모드**(§3.3 Multi Report 전환) — 설계 §2.1에 F-22로 추가.
- AI 시각 아이덴티티: **보라(#a78bfa) = AI 생성물** 전용 토큰 — 사람 주석·판독과 절대 혼동되지 않게(규제·신뢰 관점).
