# 신규 기획문서 갭 분석 (2026-06-11)

> 원본: `C:\Users\egpar\Claude\Projects\saintvidw pacs ai\` (PACS_AI_개발문서 01~06 + UBPACS-Z 기능분석).
> 본 문서는 에이전트 정밀 분석의 채택 요약 — 상세는 원본 참조. 설계 Decision Record에 채택 기록.

## 문서 구성 요지
- 01 기능카탈로그: 상용 3사(INFINITT/UBPACS-Z/SonicPACS) 122개 기능 매트릭스, Core vs 특화 분류
- 02/03/03b/03c/06: 에이전트 아키텍처·스킬 59종·**훅 가드레일 5대 정책**·프롬프트 8종·AppContext — 대부분 내부 아키텍처, 단 **03b(PHI·파괴적액션·AI안전)는 제품 필수**
- 04 구현스펙: 기능×빌딩블록 매핑, P0~P3 로드맵 — 우리 F-1~F-22와 정합
- 05 제품모드: **Core + Mode Profile(JSON)** — 제품별(INFINITT/UBPACS-Z/SonicPACS/saintvidw) UI 에뮬레이션 전환
- UBPACS-Z 지침: 자동로그인·단축키 24종·패널 복구·상태값 모드 등 UX 체크리스트

## 현재 구현 대비: P0 85%+, P1 ~70%, P2~P3 30~50%

## 즉시 적용 완료 (2026-06-11, 9차)
| 항목 | 출처 | 구현 |
|---|---|---|
| 자동 로그인(유지 체크) | UBPACS-Z §1 | 로그인 체크박스 → localStorage 토큰 |
| 판독 단축키 1차 | UBPACS-Z §5 | 워크리스트 Enter/B/E, 뷰어 ←→·I·R·F·L·1/2/4·Space·Esc |
| 파괴적 액션 확인 | 03b 정책2 | 일괄 확정에 건수 명시 confirm 강제 |

## 채택 로드맵 (우선순위 상위 — 차기 세션)
| # | 항목 | 난이도 | 비고 |
|---|---|---|---|
| 1 | 상용구 관리 고도화(Modality×BodyPart 분류 콤보, ClassA/B) | 중 | 현 패널 group 필드 확장 |
| 2 | 자동 최적 W/L(AI — 03c Image Manipulation 프롬프트) | 중 | "AI 적용" 배지 + 수동 우선 |
| 3 | ~~report_copy / report_merge(묶음판독)~~ | 중 | **완료** — copy 10차, merge 12차(`POST /api/reports/merge`) |
| 4 | 변화 강조(Prior 비교 정량화 — F-14 확장) | 중 | RAG comparison과 연동 |
| 5 | ~~**Mode Profile JSON 4종 + 전환**(05)~~ | 대 | **완료** — 프리셋 10차, 서버 JSON화 12차(`mode.profiles`) |
| 6 | 패널 배치 사용자화(드래그) | 대 | 5구역 레이아웃 엔진 |
| 7 | 위치기준 W/L, EDIT 탭, commentWindow/memoWindow, searchWizard | 소~중 | UBPACS-Z UX 세부 |
| 8 | 외부 AI 결과 병합(F-12), 2차 승인(F-17 UI), 음성 STT(P3) | 중~대 | |

## 03b 훅 5대 정책 적용 현황
- PHI 보호 ✓(deid 게이트·이미지 가드) / 파괴적 액션 ✓(일괄확정 confirm, 삭제는 관리자+감사) /
  AI 안전 ✓(초안 배지·caveats·critical 개별검토 강제) / 무결성 ✓(버전 보존·확정 수정 불가) /
  입력 신뢰 △(외부 입력 검증 — 차기)
