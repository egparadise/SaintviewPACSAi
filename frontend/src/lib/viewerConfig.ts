// 뷰어 설정 공용 정의 — Viewer2D와 SettingsModal이 함께 사용 (경량, cornerstone 미포함)

/** Mammo(MG) view 분류 — series_desc 파싱(laterality R/L + view CC/MLO).
 *  DICOM ImageLaterality/ViewPosition 이 미노출이라 first-cut(검사명 파싱). 정확도 필요 시 백엔드 태그 노출로 강화. */
export function mammoView(desc: string): { lat: "R" | "L" | ""; view: "CC" | "MLO" | "" } {
  const d = (desc || "").toUpperCase().replace(/[_-]/g, " ");
  const view: "CC" | "MLO" | "" = d.includes("MLO") ? "MLO" : d.includes("CC") ? "CC" : "";   // "RCC"(무공백) 도 인식
  let lat: "R" | "L" | "" = "";
  if (/\bR\s?CC\b|\bR\s?MLO\b|\bR\s?ML\b|\bRIGHT\b/.test(d)) lat = "R";
  else if (/\bL\s?CC\b|\bL\s?MLO\b|\bL\s?ML\b|\bLEFT\b/.test(d)) lat = "L";
  if (!lat) { if (/\bRT?\b/.test(d)) lat = "R"; else if (/\bLT?\b/.test(d)) lat = "L"; }
  return { lat, view };
}
/** Mammo 표준 2×2 배치 순서 — [R CC, L CC, R MLO, L MLO]. 없는 뷰는 null(빈 페인). */
export function mammoAssign<T extends { series_desc: string }>(list: T[]): (T | null)[] {
  const pick = (lat: "R" | "L", view: "CC" | "MLO") =>
    list.find((s) => { const v = mammoView(s.series_desc); return v.lat === lat && v.view === view; }) ?? null;
  return [pick("R", "CC"), pick("L", "CC"), pick("R", "MLO"), pick("L", "MLO")];
}
/** Image 분할(타일)에서 표시 시작 인덱스를 페이지 경계로 맞춘다.
 *  안 맞추면 분할을 키운 순간 첫 칸이 시리즈 중간에서 시작해(기본 시작 인덱스=중앙)
 *  2장짜리 시리즈를 1×2 로 나눴을 때 마지막 한 장만 보이는 식이 된다.
 *  타일이 1개면 기존과 동일(범위 클램프만). */
export function alignTileIndex(index: number, tiles: number, len: number): number {
  if (len <= 0) return 0;
  const t = Math.max(1, Math.floor(tiles) || 1);
  const last = Math.floor((len - 1) / t) * t;                 // 마지막 페이지의 시작
  const start = Math.floor(Math.max(0, index) / t) * t;
  return Math.min(start, last);
}

/** 표준 4-view 가 하나라도 잡히는가 — 맘모 전용 배치를 쓸지(아니면 순서대로 폴백할지) 판정.
 *  mammoOrder 의 반환 길이(분할 칸수)와 무관해야 하므로 별도 함수로 둔다(1:2 에서 CC 만 보는 문제 방지). */
export function hasMammoView<T extends { series_desc: string }>(list: T[]): boolean {
  return mammoAssign(list).some(Boolean);
}
/** 표준 4-view 배치를 `count` 칸(그리드 `cols` 열)으로 확장.
 *  · 좌우 쌍(CC 쌍 / MLO 쌍)은 **같은 행의 인접 두 열**에 놓는다 — 맞붙임(2D-MG)이 성립하려면 짝이 옆에 있어야 한다.
 *    (2열 4칸이면 [R CC, L CC, R MLO, L MLO] 로 기존과 완전히 동일)
 *  · 칸이 4 미만이면 실제로 잡힌 쌍을 앞세운다(1:2 인데 CC 없이 MLO 만 있는 검사 대응).
 *  · 남는 칸은 아직 걸리지 않은 시리즈로 채운다(빈 페인 방지). */
export function mammoOrder<T extends { series_desc: string }>(
  list: T[], count: number, cols = 2,
): (T | null)[] {
  const n = Math.max(0, count);
  const base = mammoAssign(list);
  const cc = base.slice(0, 2), mlo = base.slice(2, 4);
  // 쌍 우선순위 — 기본은 CC → MLO. 표시 칸이 4 미만이면 실제로 잡힌 쌍을 먼저 보여준다.
  const pairs = (n < 4 && !cc.some(Boolean) && mlo.some(Boolean)) ? [mlo, cc] : [cc, mlo];
  const used = new Set(base.filter(Boolean) as T[]);
  const rest = list.filter((s) => !used.has(s));
  const c = Math.max(1, cols);
  const flat = [...pairs[0], ...pairs[1]];
  const out: (T | null)[] = [];
  let ri = 0;
  for (let i = 0; i < n; i++) {
    if (c < 2) { out.push(i < 4 ? flat[i] ?? null : rest[ri++] ?? null); continue; }   // 1열 — 쌍 개념 없음
    const row = Math.floor(i / c), col = i % c;
    const pair = pairs[row];
    // 2열 이상이면 각 행의 0·1 열이 그 행의 좌우 쌍, 나머지 열은 여분 시리즈.
    // 그 행에 짝을 놓을 자리가 없으면(칸 수 부족) 쌍을 반쪽만 걸지 않는다 — 표준 뷰 유실 방지.
    if (pair && col < 2 && (col === 1 || row * c + 1 < n)) out.push(pair[col] ?? null);
    else out.push(rest[ri++] ?? null);
  }
  return out;
}

/** Client 뷰어 레지스트리 — Setting>뷰어>선택 뷰어.
 *  현행 자체 뷰어(Viewer2D) = TY Viewer. 신규 뷰어는 여기 등록 + ViewerWindow의 컴포넌트 맵에 연결.
 *  available=false 면 설정 콤보에서 비활성(개발 중) 표시. */
// 표기·순서 규약: SaintView → I-View → T-View (설정 트리·모드 프로파일 콤보와 동일)
export const CLIENT_VIEWERS: { id: string; label: string; desc: string; available: boolean }[] = [
  { id: "sv", label: "SaintView", desc: "SaintView 스타일 뷰어 — 상단 가로 메뉴 툴바(Image Tool·Measurement·Reading Support·Additional). 엔진·기능은 T-View 재사용", available: true },
  { id: "infi", label: "I-View", desc: "INFINITT 스타일 뷰어 — 세로 툴바·격자 1x1~4x4·우드래그 W/L·Auto Sync·Combine Series", available: true },
  { id: "ty", label: "T-View", desc: "자체 Client 뷰어 (현행 — 세로 팔레트·2단 썸네일)", available: true },
];
export const DEFAULT_CLIENT_VIEWER = "ty";

/** 행잉 프로토콜 — 디스플레이(모니터) 한 개. role=viewer 는 Series 그리드를 가짐,
 *  worklist_report 는 워크리스트+판독 창(뷰어 미사용). 물리적 배치는 정보용(런타임 배치는 추후). */
export interface HpDisplay {
  id: string;
  role: "viewer" | "worklist_report";
  label: string;          // 표시용 인덱스 라벨 ("1-2", "2-1" …)
  resolution: string;     // 정보용 ("2560 * 1080 (100%)")
  grid: { r: number; c: number };   // viewer 그리드(Series 분할)
  cells: (number | null)[];         // 셀별 시리즈 순번(1-base, null=자동) — 길이 r*c
  /** 이 모니터의 Image 분할(페인 내 타일). 없으면 규칙의 i 를 쓴다 */
  image?: { r: number; c: number };
  /** 셀별로 어떤 시점의 영상을 띄울지 — 길이 r*c(없으면 전부 current) */
  sources?: HpSlotSource[];
  /** source="range" 인 셀의 기간(일). from~to 일 전 사이의 검사 */
  range?: { from: number; to: number };
}

/* ── 행잉 프로토콜 확장 정의 ────────────────────────────────────────────────
   장비 목록은 고정이 아니다 — 현장에서 쓰는 장비를 추가할 수 있다(설정에서 직접 입력). */
export const HP_MODALITIES = ["DX", "DR", "CR", "MG", "US", "CT", "MR", "XA", "NM", "PT", "OT"];

/** Body Part 를 찾을 DICOM 필드 — 장비/기관마다 부위를 넣는 자리가 다르다.
 *  선택한 필드들의 값에서 부위 문자열을 **포함 검색**한다(대소문자 무시). */
export const HP_BP_SOURCES: { key: string; label: string; tag: string }[] = [
  { key: "body_part", label: "Body Part Examined", tag: "0018,0015" },
  { key: "study_desc", label: "Study Description", tag: "0008,1030" },
  { key: "protocol_name", label: "Protocol Name", tag: "0018,1030" },
  { key: "procedure_code", label: "Procedure Code", tag: "0008,1032" },
  { key: "procedure_desc", label: "Requested Procedure Description", tag: "0032,1060" },
  { key: "step_desc", label: "Performed Procedure Step Description", tag: "0040,0254" },
  { key: "series_desc", label: "Series Description", tag: "0008,103E" },
];
export const HP_BP_SOURCE_DEFAULT = ["body_part", "study_desc"];

/** 이 자리에 띄울 영상 — 현재 검사 또는 과거검사를 시점으로 고른다 */
export type HpSlotSource =
  | "current"    // 현재(방금 연) 검사
  | "prior"      // 바로 이전 영상
  | "w1"         // 1주 내
  | "m1"         // 1개월 내
  | "y1"         // 1년 내
  | "range"      // 기간 직접 지정(days_from~days_to)
  | "vol3d";     // 3D(MPR/MIP) 볼륨
export const HP_SLOT_SOURCES: { k: HpSlotSource; label: string }[] = [
  { k: "current", label: "현재 검사" },
  { k: "prior", label: "바로 이전 영상" },
  { k: "w1", label: "1주 내" },
  { k: "m1", label: "1개월 내" },
  { k: "y1", label: "1년 내" },
  { k: "range", label: "기간 지정" },
  { k: "vol3d", label: "3D 영상(MPR/MIP)" },
];

/** 검사에서 부위 문자열을 찾을 대상 값들 — HpRule.bp_sources 가 고른 필드만 모은다.
 *  study 는 StudyDetail 류(느슨한 레코드), extra 는 시리즈 설명 등 추가 후보. */
export function hpBodyPartHaystack(
  study: Record<string, unknown>, sources?: string[], extra: string[] = [],
): string {
  const keys = sources && sources.length ? sources : HP_BP_SOURCE_DEFAULT;
  const vals = keys.map((k) => (k === "series_desc" ? extra.join(" ") : String(study[k] ?? "")));
  return vals.join(" ").toUpperCase();
}

/** 이 규칙이 이 검사에 맞는가 — 장비·부위·Projection 전부 통과해야 한다(빈값=무관) */
export function hpMatches(
  rule: HpRule, study: Record<string, unknown>, seriesDescs: string[] = [],
): boolean {
  const up = (v: unknown) => String(v ?? "").toUpperCase();
  if (rule.modality && up(rule.modality) !== up(study.modality)) return false;
  if (rule.body_part && !hpBodyPartHaystack(study, rule.bp_sources, seriesDescs).includes(up(rule.body_part))) return false;
  if (rule.projection && !up(study.study_desc).includes(up(rule.projection))) return false;
  return true;
}

/** 자동 적용할 규칙 하나 — '가장 우선 적용'(priority) 규칙을 먼저 훑고, 없으면 등록 순서.
 *  use_on_exam_open === false 인 규칙은 자동 적용 대상에서 제외(메뉴로 수동 적용). */
export function hpPickRule(
  rules: HpRule[], study: Record<string, unknown>, seriesDescs: string[] = [],
): HpRule | null {
  const usable = rules.filter((r) => r.use_on_exam_open !== false);
  const ordered = [...usable.filter((r) => r.priority), ...usable.filter((r) => !r.priority)];
  return ordered.find((r) => hpMatches(r, study, seriesDescs)) ?? null;
}

/** 검사일(YYYYMMDD) 사이의 일수 — 과거검사 시점 판정용 */
function daysBetween(baseYmd: string, otherYmd: string): number | null {
  const d = (v: string) => (/^\d{8}$/.test(v) ? new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)) : null);
  const a = d(baseYmd), b = d(otherYmd);
  if (!a || !b) return null;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/** HP 슬롯(칸)에 넣을 과거검사 하나를 고른다.
 *  · prior  = 바로 이전 검사(현재보다 과거인 것 중 가장 최근)
 *  · w1/m1/y1 = 각각 7·30·365일 이내(현재 검사일 기준)에서 가장 최근
 *  · range  = from~to 일 전 사이
 *  후보는 항상 **같은 환자의 과거검사**(related_exams)이며, 이미 쓰인 id 는 건너뛴다.
 *  current/vol3d 는 과거검사를 쓰지 않으므로 null 을 돌려준다. */
export function hpPickPrior<T extends { id: number; study_date: string }>(
  related: T[], baseYmd: string, source: HpSlotSource,
  range?: { from: number; to: number }, used: Set<number> = new Set(),
): T | null {
  if (source === "current" || source === "vol3d") return null;
  // 경과일 경계 — related_exams 는 현재 검사를 이미 제외하므로 같은 날(0일) 과거검사도 후보다
  const win: Record<string, [number, number]> = { prior: [0, Infinity], w1: [0, 7], m1: [0, 30], y1: [0, 365] };
  const [lo, hi] = source === "range"
    ? [Math.min(range?.from ?? 0, range?.to ?? 0), Math.max(range?.from ?? 0, range?.to ?? 0)]
    : win[source] ?? [1, Infinity];
  const cand = related
    .filter((r) => !used.has(r.id))
    .map((r) => ({ r, d: daysBetween(baseYmd, r.study_date) }))
    .filter((x) => x.d != null && (x.d as number) >= 0 && (x.d as number) >= lo && (x.d as number) <= hi)
    .sort((a, b) => (a.d as number) - (b.d as number));   // 가장 최근(경과일 작은 것) 우선
  return cand[0]?.r ?? null;
}

/** 현재 뷰어 화면에서 읽어낸 구성 — '직접설정' 저장이 이 형태로 규칙을 만든다 */
export interface HpCapture {
  s: { r: number; c: number };            // Series 분할
  i: { r: number; c: number };            // Image 분할(활성 페인 기준)
  wl?: string;                            // 활성 페인 W/L ("c,w", 빈값=서버 기본)
  xlink?: Record<string, boolean>;        // Crosslink/AutoSync/Scout 토글 현재 상태
  /** 페인별 영상 시점 — 과거검사를 띄운 페인은 prior 로 기록(길이=s.r*s.c) */
  sources?: HpSlotSource[];
  /** 페인별 시리즈 순번(1-base, null=자동) */
  cells?: (number | null)[];
}

/** 화면 구성 + 검사 정보 → 저장할 HpRule. 이름·매칭 조건은 저장 다이얼로그가 채운다. */
export function buildHpRule(
  base: { name: string; modality: string; body_part: string; projection: string;
          description?: string; bp_sources?: string[]; priority?: boolean; use_on_exam_open?: boolean },
  cap: HpCapture,
  id = `hp${Date.now().toString(36)}`,
): HpRule {
  const n = Math.max(1, cap.s.r * cap.s.c);
  const x = cap.xlink ?? {};
  return {
    id,
    name: base.name.trim() || "새 프로토콜",
    modality: (base.modality || "").toUpperCase().trim(),
    body_part: (base.body_part || "").toUpperCase().trim(),
    projection: (base.projection || "").toUpperCase().trim(),
    description: base.description ?? "",
    s: { r: cap.s.r, c: cap.s.c },
    i: { r: cap.i.r, c: cap.i.c },
    wl: cap.wl ?? "",
    bp_sources: base.bp_sources ?? [...HP_BP_SOURCE_DEFAULT],
    priority: !!base.priority,
    use_on_exam_open: base.use_on_exam_open !== false,
    full_link: !!x.auto_sync,
    full_scroll_sync: !!x.sync_other,
    cross_link: !!x.crosslink,
    scout_image: !!x.scout,
    all_lines: !!x.all_lines,
    displays: [{
      id: "d1", role: "viewer", label: "1", resolution: "",
      grid: { r: cap.s.r, c: cap.s.c },
      cells: Array.from({ length: n }, (_, k) => cap.cells?.[k] ?? null),
      image: { r: cap.i.r, c: cap.i.c },
      sources: Array.from({ length: n }, (_, k) => cap.sources?.[k] ?? "current"),
    }],
  };
}

/** 행잉 프로토콜 규칙 (Setting>행잉(HP)) — 장비×부위×Projection → 레이아웃·옵션·디스플레이.
 *  s/i/wl 은 하위호환(단일 뷰어 Series/Image 분할). displays 가 있으면 viewer 디스플레이가 우선. */
export interface HpRule {
  id: string;
  name: string;
  modality: string;     // 빈값=모든 장비
  body_part: string;    // 부위 포함 매칭 (빈값=무관)
  projection: string;   // 검사명에 포함 매칭 (PA/AP/LAT…, 빈값=무관)
  description?: string;  // 설명
  s: { r: number; c: number };  // Series layout (하위호환)
  i: { r: number; c: number };  // Image layout
  wl?: string;          // "center,width" (빈값=기본)
  // 옵션 (그림) — 뷰어 런타임 반영
  use_on_exam_open?: boolean;   // Exam 열 때 HP 자동 사용
  full_link?: boolean;          // 전체 링크(페인 동기)
  full_scroll_sync?: boolean;   // 전체 스크롤 동기화
  cross_link?: boolean;         // Cross Link(교차 위치 동기)
  scout_image?: boolean;        // Scout 이미지(교차선) 사용
  all_lines?: boolean;          // All Lines(기준 시리즈 전체 교차선) 사용
  displays?: HpDisplay[];       // 디스플레이 레이아웃(멀티모니터)
  /** Body Part 를 찾을 DICOM 필드들(빈값=기본: Body Part Examined + Study Description) */
  bp_sources?: string[];
  /** 가장 우선 적용 — 켜면 다른 판정보다 먼저 이 규칙을 감지해 적용한다. 기본 꺼짐 */
  priority?: boolean;
}

/** HP 디스플레이 기본값 — 그림 등가(뷰어 1 + 워크리스트+판독 1) */
export const DEFAULT_HP_DISPLAYS = (): HpDisplay[] => [
  { id: "d1", role: "viewer", label: "1-2", resolution: "2560 * 1080 (100%)", grid: { r: 1, c: 1 }, cells: [null] },
  { id: "d2", role: "worklist_report", label: "2-1", resolution: "1600 * 1067 (150%)", grid: { r: 1, c: 1 }, cells: [null] },
];

/** W/L 프리셋 (Presetting — Setting>뷰어에서 편집, 계정 로밍) */
export interface WlPreset { key: string; label: string; q: string }

export const DEFAULT_WL_PRESETS: WlPreset[] = [
  { key: "auto", label: "Auto", q: "" },
  { key: "lung", label: "폐", q: "-600,1500" },
  { key: "medi", label: "종격동", q: "40,400" },
  { key: "bone", label: "뼈", q: "300,1500" },
  { key: "brain", label: "뇌", q: "40,80" },
  { key: "abd", label: "복부", q: "60,400" },
];

/** 툴바 기능 카탈로그 (UBPACS p.18~21) — Setting>뷰어>Tools bar에서 표시 여부 설정(계정 로밍) */
export const TOOLBAR_DEFS: { section: string; items: { id: string; label: string; desc: string }[] }[] = [
  { section: "Common Tools", items: [
    { id: "zoom", label: "Zoom", desc: "확대/축소 (좌드래그)" },
    { id: "pan", label: "Pan", desc: "이동" },
    { id: "fit", label: "Fit", desc: "화면맞춤 — 영상 Layout에 이미지 크기를 맞춤" },
    { id: "inv", label: "Inv", desc: "화면 반전" },
    { id: "rotL", label: "⟲90", desc: "반시계방향 90도 회전" },
    { id: "rotR", label: "⟳90", desc: "90도 회전" },
    { id: "rot180", label: "⟳180", desc: "180도 회전" },
    { id: "flipH", label: "⇋", desc: "좌우변경" },
    { id: "flipV", label: "⇵", desc: "상하변경" },
    { id: "cine", label: "▶", desc: "시네 재생 (녹음 재생 계열)" },
    { id: "cap", label: "Cap", desc: "내보내기 — 이미지를 PNG 파일로 저장" },
    { id: "reset", label: "Reset", desc: "초기화 — 조작된 W/L·확대축소 등 초기화" },
    { id: "sharpen", label: "Shrp", desc: "Sharpen 필터 — 윤곽 선명화 (활성 페인 토글)" },
    { id: "average", label: "Avg", desc: "Average 필터 — 부드럽게(블러, 활성 페인 토글)" },
    { id: "pseudo", label: "Psd", desc: "Pseudo Color — 의사색 컬러맵 근사 (활성 페인 토글)" },
    { id: "mag", label: "Mag", desc: "확대경 — 마우스 위치를 따라다니는 3배 렌즈" },
  ]},
  { section: "Annotation Tools", items: [
    { id: "length", label: "Len", desc: "선/길이 측정 (Caliper)" },
    { id: "angle", label: "Ang", desc: "각도 측정" },
    { id: "rect", label: "Rect", desc: "사각형 + 영역정보(ROI 측정값)" },
    { id: "ellipse", label: "Elps", desc: "원/타원 + 영역정보(ROI 측정값)" },
    { id: "arrow", label: "Arrw", desc: "화살표" },
    { id: "text", label: "Text", desc: "Text/Memo 입력" },
    { id: "poly", label: "Poly", desc: "폴리라인 — 경로 길이 측정(여러 점 클릭, 더블클릭 종료)" },
    { id: "circle", label: "Circ", desc: "원 계측 — 중심→가장자리 2점, 반지름" },
    { id: "centerline", label: "CLine", desc: "Center Line — 두 선(4점)의 중앙선 표시" },
    { id: "mctr", label: "CTR4", desc: "수동 심흉비 — 심장 2점+흉곽 2점 → CTR % (AI CTR 과 별개)" },
    { id: "box", label: "Box", desc: "박스 메모 — 두 점 + 제목 입력" },
    { id: "spine", label: "SpLbl", desc: "Spine Label — 클릭 연번 라벨(첫 클릭에 시작 라벨 입력)" },
    { id: "marking", label: "Mark", desc: "Marking — 클릭 + 짧은 표기 입력(①, R, ✓ 등)" },
    { id: "ref", label: "Ref", desc: "Cross link — Scout 라인 확인" },
    { id: "ctr", label: "CTR", desc: "CT Ratio — 폐·심장 비율 측정(AI 초안)" },
    { id: "save", label: "Save", desc: "저장 — 영상에 조작된 작업(주석) 저장" },
    { id: "gsps", label: "GSPS", desc: "표시 상태 표준 저장(Presentation State)" },
    { id: "del", label: "Del", desc: "마지막 주석 삭제" },
    { id: "clr", label: "Clr", desc: "주석·셔터 전체 삭제 (초기화)" },
  ]},
  // TY 해부학 측정 4종 — Viewer2D ANATOMY_TOOL_DEFS 와 id/label 1:1 (tbOn 기본 표시, 여기서 끄기 가능)
  { section: "Anatomy Tools", items: [
    { id: "cobb", label: "Cobb", desc: "콥 각(척추측만) — 4점: 두 직선 사이 예각(°)" },
    { id: "leg", label: "Leg", desc: "다리 길이 — 4점: 좌/우 라인 각 길이(mm)와 좌우 차이" },
    { id: "pelvis", label: "Pelvis", desc: "골반 틀어짐 — 좌·우 장골능 2점, 수평 대비 각도(°)·높이차(mm)" },
    { id: "spineCurve", label: "Spine", desc: "척추 외곡 — 3점 이상 더블클릭 종료, 기준선 대비 최대 편위(mm)" },
  ]},
  { section: "Pixel & Shutter Tools", items: [
    { id: "lens", label: "Lens", desc: "Lens — 클릭 지점 픽셀값 근사 HU('≈' 표기)" },
    { id: "profile", label: "Prof", desc: "Profile — 두 점 선의 픽셀값 그래프" },
    { id: "table2d", label: "Tbl", desc: "2D Table — 두 점 영역 픽셀값 표" },
    { id: "shutRect", label: "ShR", desc: "사각 셔터 — 영역 밖 가림(페인별, Clr/Reset 해제)" },
    { id: "shutEl", label: "ShE", desc: "타원 셔터 — 영역 밖 가림(페인별, Clr/Reset 해제)" },
    { id: "shutPoly", label: "ShP", desc: "다각 셔터 — 여러 점 클릭, 더블클릭 종료" },
  ]},
  { section: "ETC Tools", items: [
    { id: "ohif", label: "OHIF", desc: "Advanced View — OHIF 뷰어 호출" },
    { id: "3d", label: "3D", desc: "3D MPR/MIP 뷰어" },
    { id: "rfsh", label: "Rfsh", desc: "Refresh Exam — 활성 검사 시리즈 재조회" },
    { id: "comb", label: "Comb", desc: "Combine Series — 같은 검사의 모든 시리즈를 한 스택으로 결합" },
    { id: "print", label: "Print", desc: "인쇄 — 현재 화면을 브라우저 인쇄(window.print)" },
    { id: "calib", label: "Calib", desc: "Calibrate — 현재 이미지 Pixel Spacing 정보 안내" },
  ]},
  // TY-3: 워크플로·연동 계열 (In Viewer 이식)
  { section: "Workflow Tools", items: [
    { id: "hist", label: "◀◯▶", desc: "작업 히스토리 — Undo/초기화/Redo (시각조정+주석 스냅샷 최대 50, 상단바)" },
    { id: "xlink", label: "Link", desc: "Crosslink 5모드 — Off/AutoSync(같은 검사)/SyncOther(과거 포함)/Scout/AllLines" },
    { id: "cursor3d", label: "3DC", desc: "3D Cursor — 클릭점을 다른 페인의 동일 3D 위치로 이동+십자 마커" },
    { id: "pcine", label: "▶p", desc: "페인별 시네 — 페인 호버 시 재생/정지+간격(초) 미니 컨트롤" },
    { id: "key2d", label: "Key", desc: "키이미지 등록/해제 — 현재 이미지 토글 (워크리스트 🔑 연동)" },
    { id: "media", label: "Media", desc: "미디어 재생 — 로컬 이미지/동영상을 활성 페인에 표시" },
    { id: "dict", label: "Dict", desc: "딕테이션 — 음성 녹음/재생 (세션 보관)" },
    { id: "cmp", label: "⇄", desc: "Compare — 같은 환자 과거검사 다중 선택 비교 오픈 (상단바)" },
  ]},
];

/* ── Compare 기준 — 무엇을 '비교 대상'으로 볼 것인가 ─────────────────────────────
   · patient (기본) : 같은 환자의 과거검사 전부. 환자가 기준이므로 항상 이게 기본이다.
   · match          : 그중 **같은 Modality·같은 검사부위** 만(현재 판독과 직접 비교되는 것).
   두 경우 모두 후보는 같은 환자(같은 차트번호)의 검사로 제한된다 — 환자 혼합은 원천 차단. */
export type CompareBasis = "patient" | "match";

/** 두 검사가 '같은 종류' 인가 — Modality 일치 + 부위(없으면 검사명) 일치 */
export function sameExamKind(
  a: { modality?: string; body_part?: string; study_desc?: string },
  b: { modality?: string; body_part?: string; study_desc?: string },
): boolean {
  const norm = (v?: string) => (v ?? "").trim().toUpperCase();
  if (norm(a.modality) !== norm(b.modality)) return false;
  const ap = norm(a.body_part), bp = norm(b.body_part);
  if (ap && bp) return ap === bp;
  // 부위가 비어 있으면 검사명으로 대체 판정(앞 단어 기준 — "CHEST PA" ↔ "CHEST AP")
  const head = (v?: string) => norm(v).split(/[\s,()/-]+/).filter(Boolean)[0] ?? "";
  return !!head(a.study_desc) && head(a.study_desc) === head(b.study_desc);
}

/** Compare 후보 목록 — 기준에 따라 관련검사를 거른다 */
export function compareCandidates<T extends { modality?: string; body_part?: string; study_desc?: string }>(
  related: T[], base: { modality?: string; body_part?: string; study_desc?: string }, basis: CompareBasis,
): T[] {
  return basis === "match" ? related.filter((r) => sameExamKind(r, base)) : related;
}
