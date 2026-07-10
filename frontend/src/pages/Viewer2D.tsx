// Saintview 2D 뷰어 — WADO-RS /rendered 기반(픽셀 보장) + Zetta/INFINITT 레이아웃
// 설정 연동: 팔레트/썸네일 방향·크기, 썸네일 모드(시리즈/전체), 행잉(모달리티→분할), 판독 도크
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, openViewer, type Anno, type InstanceNode, type SeriesNode, type StudyDetail } from "../api";
import { annoLabel, contentRect, measureAnno, refLineOn, screenToImage } from "../lib/annotations";
import { GridPicker } from "../lib/GridPicker";
import { screenFeatures } from "../lib/screens";
import { onStudySync, postStudySync } from "../lib/sync";
import { Splitter, clampSz } from "../lib/Splitter";
import { DEFAULT_WL_PRESETS, type HpRule } from "../lib/viewerConfig";
import { ToolIconTy } from "../components/ToolIconTy";
import { AnatomyIcon } from "../lib/anatomyIcons";
import { ReportDock } from "../components/ReportDock";
import { DICOMWEB_ROOT } from "../lib/cornerstone";
import { rawAt, samplePixels } from "../lib/pixelTools";

// 내장 MPR/MIP — 새 창 없이 현재 뷰포트 영역에 Axial/Sagittal/Coronal+MIP 표시
const Viewer3DEmbed = lazy(() => import("./Viewer3D").then((m) => ({ default: m.Viewer3D })));
// 뷰어 내 설정 — 워크리스트로 돌아가지 않고 Setting 진입
const SettingsModalLazy = lazy(() => import("./SettingsModal").then((m) => ({ default: m.SettingsModal })));

type ToolKind = "length" | "angle" | "rect" | "ellipse" | "arrow" | "text"
  | "cobb" | "leg" | "pelvis" | "spineCurve"
  // TY-2 이식(In Viewer): 측정·주석·픽셀·셔터 계열
  | "poly" | "circle" | "centerline" | "mctr" | "box" | "spine" | "marking"
  | "lens" | "profile" | "table2d" | "shutRect" | "shutEl" | "shutPoly"
  // TY-3 이식: 3D Cursor — 클릭점을 다른 페인 동일 3D 위치로 (In cursor3d)
  | "cursor3d";
const TOOL_DEFS: [ToolKind, string, string][] = [
  ["length", "Len", "길이 계측 (2점, mm)"],
  ["angle", "Ang", "각도 계측 (3점)"],
  ["rect", "Rect", "사각 ROI (면적)"],
  ["ellipse", "Elps", "타원 ROI (면적)"],
  ["arrow", "Arrw", "화살표"],
  ["text", "Text", "텍스트 주석"],
  ["poly", "Poly", "폴리라인 — 경로 길이(여러 점 클릭, 더블클릭 종료)"],
  ["circle", "Circ", "원 계측 — 중심→가장자리 2점, 반지름"],
  ["centerline", "CLine", "중앙선 — 두 선(4점: 선1 2점 → 선2 2점)의 중앙선 표시"],
  ["mctr", "CTR4", "수동 심흉비 — 4점: 심장 폭 2점 → 흉곽 폭 2점, CTR % (AI CTR 과 별개)"],
  ["box", "Box", "박스 메모 — 두 점 + 제목 입력"],
  ["spine", "SpLbl", "Spine Label — 클릭 연번 라벨(첫 클릭에 시작 라벨 입력, 예: L1)"],
  ["marking", "Mark", "Marking — 클릭 + 짧은 표기 입력(①, R, ✓ 등)"],
];
// 해부학 측정 툴 4종 (Anatomy) — 콥각/다리길이/골반/척추외곡
const ANATOMY_TOOL_DEFS: [ToolKind, string, string][] = [
  ["cobb", "Cobb", "콥 각(척추측만) — 4점: 첫 선 2점 → 둘째 선 2점, 두 직선 사이 예각(°)"],
  ["leg", "Leg", "다리 길이 — 4점: 좌측 라인 2점 → 우측 라인 2점, 각 길이(mm)와 좌우 차이"],
  ["pelvis", "Pelvis", "골반 틀어짐 — 2점: 좌·우 장골능, 수평 대비 각도(°)와 높이차(mm)"],
  ["spineCurve", "Spine", "척추 외곡 — 3점 이상 클릭 후 더블클릭으로 종료, 기준선 대비 최대 편위(mm)"],
];
// 픽셀 도구 3종 (In Viewer 이식) — 렌더 8bit + W/L 역변환 근사('≈' 표기)
const PIXEL_TOOL_DEFS: [ToolKind, string, string][] = [
  ["lens", "Lens", "Lens — 클릭 지점 픽셀값 근사 HU('≈' 표기)"],
  ["profile", "Prof", "Profile — 두 점 선의 픽셀값 그래프"],
  ["table2d", "Tbl", "2D Table — 두 점 영역 픽셀값 표"],
];
// 셔터 3종 (In Viewer 이식) — 페인 표시 가림(evenodd), 주석 저장 대상 아님. Clr/Reset 으로 해제
const SHUTTER_TOOL_DEFS: [ToolKind, string, string][] = [
  ["shutRect", "ShR", "사각 셔터 — 두 점 영역 밖 가림(활성 페인, Clr/Reset 해제)"],
  ["shutEl", "ShE", "타원 셔터 — 두 점 영역 밖 가림(활성 페인, Clr/Reset 해제)"],
  ["shutPoly", "ShP", "다각 셔터 — 여러 점 클릭 후 더블클릭 종료(활성 페인, Clr/Reset 해제)"],
];
// 툴별 필요 점 수 — Infinity=open-ended(더블클릭 종료, In Viewer OPEN_ENDED 동치)
const TOOL_PTS: Record<ToolKind, number> = {
  length: 2, angle: 3, rect: 2, ellipse: 2, arrow: 2, text: 1,
  cobb: 4, leg: 4, pelvis: 2, spineCurve: Infinity,
  poly: Infinity, circle: 2, centerline: 4, mctr: 4, box: 2, spine: 1, marking: 1,
  lens: 1, profile: 2, table2d: 2, shutRect: 2, shutEl: 2, shutPoly: Infinity,
  cursor3d: 1,
};
const OPEN_ENDED = new Set<ToolKind>(["spineCurve", "poly", "shutPoly"]);
// 4점(선 2개) 도구 — 초안에서 선1(p0,p1)만 잇는다(p1→p2 연결선은 오해 소지)
const FOUR_PT_TOOLS = new Set<ToolKind>(["cobb", "leg", "centerline", "mctr"]);

const PANE_IDS = Array.from({ length: 100 }, (_, i) => `p${i}`);  // 최대 10×10 임의 레이아웃
// Related Study 상태 → 색 칩 (theme.css --stat-* 의미 체계와 동일)
const STAT_COLOR: Record<string, string> = {
  received: "var(--stat-received)", draft_ready: "var(--stat-draft)",
  reading: "var(--stat-reading)", finalized: "var(--stat-final)",
  critical: "var(--stat-emergency)", emergency: "var(--stat-emergency)",
};
// Series Layout — 뷰포트 분할(최대 10×10 — GridPicker 직접 지정, UBPACS View Screen Composition)
const LAYOUTS: Record<string, { cols: number; rows: number; count: number }> = {};
for (let r = 1; r <= 10; r++) {
  for (let c = 1; c <= 10; c++) {
    LAYOUTS[`${r}x${c}`] = { rows: r, cols: c, count: r * c };
  }
}
/** ② 자동 최적 W/L (03c Image-Manipulation 의도, v1=결정적 규칙. 추후 AI 추론 교체 지점) */
function autoWL(modality: string, bodyPart: string): { q: string; label: string } | null {
  const bp = (bodyPart || "").toUpperCase();
  if (modality === "CT") {
    if (bp.includes("CHEST") || bp.includes("LUNG")) return { q: "-600,1500", label: "폐" };
    if (bp.includes("BRAIN") || bp.includes("HEAD")) return { q: "40,80", label: "뇌" };
    if (bp.includes("ABD") || bp.includes("PEL")) return { q: "60,400", label: "복부" };
    return { q: "40,400", label: "종격동" };
  }
  return null; // MR/CR 등은 서버 VOI 기본
}

const WL_PRESETS = DEFAULT_WL_PRESETS;  // 기본값 — 실제 목록은 viewer.prefs.wl_presets(설정 편집)

interface PaneState {
  studyUid: string;       // 비교 검사 지원(F-14): 페인마다 다른 검사 가능
  series: SeriesNode | null;
  index: number;
  zoom: number; tx: number; ty: number; rot: number;
  flipH: boolean; flipV: boolean; invert: boolean;
  wl: string;             // window=c,w 쿼리 ("" = 서버 기본)
  fx: "" | "sharpen" | "smooth" | "pseudo";  // 필터 3종(Sharpen/Average/Pseudo — In Viewer 이식)
  // 셔터 — 페인 시각 상태(주석 저장 대상 아님, In Viewer shutter 이식). 좌표는 정규화(0~1)
  shutter: { kind: "rect" | "ellipse" | "poly"; pts: number[][] } | null;
  // TY-3: 페인별 독립 시네(재생 여부·간격 초 — 없으면 ty_cine_sec) + 로컬 미디어(jpg/png/avi/mp4)
  playing?: boolean;
  cineSec?: number;
  media?: { url: string; kind: "image" | "video"; name: string } | null;
}
const initPane = (studyUid: string): PaneState => ({
  studyUid, series: null, index: 0, zoom: 1, tx: 0, ty: 0, rot: 0,
  flipH: false, flipV: false, invert: false, wl: "", fx: "", shutter: null,
  playing: false, media: null,
});

/* ── TY-3: Crosslink 5모드 — 기존 Link 단일 토글을 확장 (In IN_CROSSLINK_MODES 이식, 단일 선택형) ── */
type XlinkMode = "off" | "auto_sync" | "sync_other" | "scout" | "all_lines";
const XLINK_MODES: { key: XlinkMode; label: string; desc: string }[] = [
  { key: "off", label: "Link:Off", desc: "연동 없음" },
  { key: "auto_sync", label: "AutoSync", desc: "같은 검사 페인 동기 스크롤" },
  { key: "sync_other", label: "SyncOther", desc: "다른 검사(과거) 포함 전체 페인 동기 스크롤" },
  { key: "scout", label: "Scout", desc: "활성 페인 현재 이미지의 교차선 표시 (기존 Ref 통합)" },
  { key: "all_lines", label: "AllLines", desc: "활성 시리즈 전체 이미지의 교차선 표시" },
];

/* ── TY-3: 3D Cursor 기하 — DICOM Position/Orientation 평면 계산 (In geomOf 이식, 최소 부분) ── */
type V3 = number[];
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
interface Geom3 { pos: V3; row: V3; col: V3; rs: number; cs: number; n: V3 }
function geomOf(inst: InstanceNode): Geom3 | null {
  if (inst.position?.length !== 3 || inst.orientation?.length !== 6 || inst.pixel_spacing?.length !== 2) return null;
  const row = inst.orientation.slice(0, 3), col = inst.orientation.slice(3, 6);
  return { pos: inst.position, row, col, rs: inst.pixel_spacing[0], cs: inst.pixel_spacing[1], n: vcross(row, col) };
}

/* ── TY-3: 작업 히스토리 스냅샷 — 시각조정(줌/팬/회전/반전/W-L/필터/셔터)+주석 (In takeSnap 이식) ── */
type VisSnap = Pick<PaneState, "zoom" | "tx" | "ty" | "rot" | "flipH" | "flipV" | "invert" | "wl" | "fx" | "shutter">;
type Snap = { vis: Record<string, VisSnap>; annos: Anno[] };
/** 페인 CSS filter — 반전 + 필터 3종 조합 (In Viewer paneFilter 동치, sharpen 은 SVG feConvolveMatrix) */
function paneFilter(p: PaneState): string | undefined {
  const parts: string[] = [];
  if (p.invert) parts.push("invert(1)");
  if (p.fx === "sharpen") parts.push("url(#ty-sharpen)");
  if (p.fx === "smooth") parts.push("blur(1.2px)");
  if (p.fx === "pseudo") parts.push("sepia(1) saturate(5) hue-rotate(175deg)");   // 근사 컬러맵
  return parts.length ? parts.join(" ") : undefined;
}

function renderedUrlAt(p: PaneState, idx: number): string | null {
  const inst = p.series?.instances[idx];
  if (!p.series || !inst) return null;
  const wl = p.wl ? `?window=${p.wl},linear` : "";
  return `${DICOMWEB_ROOT}/studies/${p.studyUid}/series/${p.series.series_uid}/instances/${inst.sop_uid}/rendered${wl}`;
}
function renderedUrl(p: PaneState): string | null {
  return renderedUrlAt(p, p.index);
}

interface ViewerPrefs {
  paletteSide: "left" | "top" | "right";   // Toolbar 위치 (Setting>Viewer)
  thumbSide: "left" | "bottom" | "right";  // Thumbnail 위치
  thumbSize: number;        // px
  thumbMode: "series" | "all";
  hanging2d: Record<string, string>;  // modality → layout key
  reportDock: boolean;
  paletteW: number;         // 팔레트 폭 (스플리터 조절, 계정 로밍)
  dockW: number;            // 판독 도크 폭
  toolbar: Record<string, boolean>;  // 툴바 버튼 표시 여부 (기본 모두 표시)
  wl_presets: { key: string; label: string; q: string }[];  // W/L Presetting
  close_mode: "ask" | "save_current" | "save_all" | "discard";  // 닫기 동작 (Setting>Viewer)
  monitor?: { screens?: number[]; worklist?: number | null; report?: number | null };  // 창별 모니터 배치
}
const DEFAULT_PREFS: ViewerPrefs = {
  paletteSide: "left", thumbSide: "left", thumbSize: 128,
  thumbMode: "series", hanging2d: {}, reportDock: true,
  paletteW: 138, dockW: 340, toolbar: {}, wl_presets: WL_PRESETS,
  close_mode: "ask",
};

// Exam 탭 영속 — 새 창 뷰어가 재사용/재오픈돼도 ✕/전체닫기 전까지 우측에 계속 쌓인다 (UBPACS)
const TABS_KEY = "sv_viewer_tabs";
function loadPersistedTabs(): { id: number; uid: string; label: string }[] {
  try { return JSON.parse(localStorage.getItem(TABS_KEY) ?? "[]"); } catch { return []; }
}
function savePersistedTabs(tabs: { id: number; uid: string; label: string }[]) {
  try { localStorage.setItem(TABS_KEY, JSON.stringify(tabs)); } catch { /* quota */ }
}

// eslint-disable-next-line react-refresh/only-export-components
export function Viewer2D({ detail, onClose, addDetail, stackDetail, keySops, withOpen }: {
  detail: StudyDetail;
  onClose: () => void;
  addDetail?: StudyDetail | null;    // ② Add View: 기존(detail) 유지 + 이 검사를 분할 추가
  stackDetail?: StudyDetail | null;  // ③ Stack View: 기존 유지 + 이 검사를 같은 페인에 중첩
  keySops?: string[] | null;         // ⑤ Key Image View: 이 SOP 목록만 표시 (F-16)
  withOpen?: { mode: "add" | "stack"; ids: number[] } | null;  // Study With Open (p.13)
}) {
  const [prefs, setPrefs] = useState<ViewerPrefs>(DEFAULT_PREFS);
  // OHIF 표시 — 기본 숨김, 설정>뷰어>OHIF 허용 시에만 (viewer.prefs.ohif_enabled)
  const [ohifOn, setOhifOn] = useState(false);
  useEffect(() => {
    api.getSetting("viewer.prefs").then((r) =>
      setOhifOn(!!(r.value as { ohif_enabled?: boolean }).ohif_enabled)).catch(() => {});
  }, []);
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  const [series, setSeries] = useState<SeriesNode[]>([]);
  const [layout, setLayout] = useState<keyof typeof LAYOUTS>("1x1");
  // Image Layout — 페인 내부 이미지 분할(연속 이미지 N×M 타일, UBPACS)
  const [imgLay, setImgLay] = useState({ r: 1, c: 1 });
  // 페인 최대화(더블클릭 토글) + 페인 경계 스플리터 분율 (In Viewer 이식)
  const [maximized, setMaximized] = useState<string | null>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const [colFr, setColFr] = useState<number[]>([1]);
  const [rowFr, setRowFr] = useState<number[]>([1]);
  // 확대경(Magnification) — 마우스 추적 3배 렌즈 (In Viewer 이식, 단일 이미지 페인)
  const [magOn, setMagOn] = useState(false);
  const [magPos, setMagPos] = useState<{ pid: string; mx: number; my: number;
                                         nx: number; ny: number; sc: number } | null>(null);
  // 신규 prefs 계약: ty_sel_color=활성(선택) 페인 테두리 색, ty_cine_sec=시네 간격(초)
  const [tySelColor, setTySelColor] = useState("#d946ef");
  const [tyCineSec, setTyCineSec] = useState(0.15);
  /* 레이아웃 변경 — 최대화 해제 + 경계 분율 초기화 */
  useEffect(() => {
    setMaximized(null);
    setColFr(Array(LAYOUTS[layout].cols).fill(1));
    setRowFr(Array(LAYOUTS[layout].rows).fill(1));
    setSelPanes(new Set());   // 레이아웃 변경 — 멀티 선택 초기화 (In 동일)
  }, [layout]);
  /* 경계 스플리터 — 인접 두 행/열의 flex 분율을 픽셀 이동량만큼 주고받기 (In Viewer adjFr 동치) */
  const adjFr = (set: React.Dispatch<React.SetStateAction<number[]>>, i: number,
                 deltaPx: number, totalPx: number) =>
    set((fr) => {
      const sum = fr.reduce((a, b) => a + b, 0) || 1;
      const d = (deltaPx / Math.max(totalPx, 1)) * sum;
      const next = [...fr];
      next[i] = Math.max(0.15, (next[i] ?? 1) + d);
      next[i + 1] = Math.max(0.15, (next[i + 1] ?? 1) - d);
      return next;
    });
  // HP(행잉 프로토콜) + W/L 프리셋(All 적용) + 타이틀바 드롭다운
  const [hpRules, setHpRules] = useState<HpRule[]>([]);
  const [hpName, setHpName] = useState("기본");
  const [wlAll, setWlAll] = useState(false);  // W/L 프리셋을 전체 페인에 적용 (UBPACS All)
  const [menu, setMenu] = useState<null | "opened" | "related" | "series" | "hp">(null);
  const [mprOn, setMprOn] = useState(false);  // 내장 MPR/MIP (CT/MR — 뷰포트 영역 전환)
  const [settingsOpen, setSettingsOpen] = useState(false);  // 뷰어 내 Setting
  // ◀▶ 환자 이동 — 시간대별 한 단계(워크리스트 정렬: 최신이 위/앞).
  // 방향은 Setting>정책(nav_left)을 따른다: past=◀가 과거(아래 행) / recent=◀가 최신(위 행)
  const [wlIds, setWlIds] = useState<number[]>([]);
  const [navLeft, setNavLeft] = useState<"past" | "recent">("past");
  useEffect(() => {
    api.worklist({ limit: "500" }).then((r) => setWlIds(r.items.map((it) => it.id))).catch(() => {});
    api.getSetting("worklist.prefs").then((r) => {
      const nl = (r.value as { nav_left?: "past" | "recent" }).nav_left;
      if (nl) setNavLeft(nl);
    }).catch(() => {});
  }, []);
  /** 현재 활성 페인에 보이는 검사 id — ◀▶ 이동의 기준점 */
  const currentNavId = () => {
    const curUid = panes[activePane]?.studyUid || detail.study_uid;
    return openTabsRef.current.find((t) => t.uid === curUid)?.id ?? detail.id;
  };
  /** visual: -1=◀, 1=▶ → 정책에 따른 목록 스텝(목록은 최신이 idx 0) */
  const navTarget = (visual: 1 | -1): number | undefined => {
    const idx = wlIds.indexOf(currentNavId());
    if (idx < 0) return undefined;
    const leftStep = navLeft === "past" ? 1 : -1;  // 과거 = 목록 아래(idx 증가)
    return wlIds[idx + (visual === -1 ? leftStep : -leftStep)];
  };
  const navPatient = (visual: 1 | -1) => {
    const target = navTarget(visual);
    if (target === undefined) return;
    postStudySync(target, "viewer");  // Worklist·Reading 연동
    // 이미 열린 환자(Exam 탭)면 → 새로고침 없이 그 탭으로 전환
    const opened = openTabsRef.current.find((t) => t.id === target);
    if (opened) { void loadIntoActive(opened.id); return; }
    // 미오픈 → 열면서 이동 (창 네비게이트, 탭은 localStorage로 유지·누적)
    const p = new URLSearchParams(window.location.search);
    if (p.get("viewer") === "2d") {
      p.set("study", String(target));
      ["add", "stack", "keysops", "wo_mode", "wo_ids"].forEach((k) => p.delete(k));
      window.location.search = p.toString();
    }
  };
  // 다른 창(Worklist/Reading)에서 환자가 바뀌면 — 열린 탭이면 그 탭으로 전환
  const loadIntoActiveRef = useRef<(id: number) => Promise<void>>(async () => {});
  const openTabsRef = useRef<{ id: number; uid: string; label: string }[]>([]);
  useEffect(() => {
    const off = onStudySync("viewer", (id) => {
      const opened = openTabsRef.current.find((t) => t.id === id);
      if (opened) void loadIntoActiveRef.current(opened.id);
    });
    return off;
  }, []);
  const [activePane, setActivePane] = useState("p0");
  const [panes, setPanes] = useState<Record<string, PaneState>>(
    Object.fromEntries(PANE_IDS.map((p) => [p, initPane(detail.study_uid)])),
  );
  const [selSeries, setSelSeries] = useState<string | null>(null);
  const [mouseMode, setMouseMode] = useState<"wl" | "zoom" | "pan">("zoom");
  // 팔레트 섹션 — 기본 전체 펼침(헤더 클릭으로 개별 접기)
  const [openSecs, setOpenSecs] = useState<Set<string>>(new Set(["common", "anno", "anatomy", "px", "shut", "2d", "etc"]));
  const toggleSec = (k: string) => setOpenSecs((p) => {
    const n = new Set(p);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  // TY-3(3): Crosslink 5모드 — 기존 syncScroll(Link 단일)을 확장. off/auto_sync/sync_other/scout/all_lines
  const [xmode, setXmode] = useState<XlinkMode>("off");
  // TY-3(2): 멀티 페인 선택 — Shift=범위/Ctrl=토글/A=전체, 선택 페인 연동 조작 (In selPanes 이식)
  const [selPanes, setSelPanes] = useState<Set<string>>(new Set());
  const selPanesRef = useRef(selPanes);
  useEffect(() => { selPanesRef.current = selPanes; }, [selPanes]);
  // TY-3(4): 3D Cursor 십자 마커 — 페인별 {sop, 정규화 x/y} (In cross3d 이식)
  const [cross3d, setCross3d] = useState<Record<string, { sop: string; x: number; y: number }>>({});
  // TY-3(5): 페인별 시네 미니 컨트롤 표시용 호버 페인
  const [hoverPane, setHoverPane] = useState<string | null>(null);
  // TY-3(7): 로컬 미디어(jpg/png/bmp/avi/mp4) 파일 선택
  const mediaInputRef = useRef<HTMLInputElement>(null);
  // TY-3(8): 딕테이션 — MediaRecorder 녹음(검사 id별 세션 보관, In dictation 이식)
  const recRef = useRef<MediaRecorder | null>(null);
  const audioBlobs = useRef<Record<number, Blob>>({});
  const [recording, setRecording] = useState(false);
  // TY-3(9): Compare 모달 — 같은 환자 과거검사 다중 선택 비교
  const [cmpOpen, setCmpOpen] = useState(false);
  const [cmpSel, setCmpSel] = useState<Set<number>>(new Set());
  const [thumbOpen, setThumbOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [overlayOn, setOverlayOn] = useState(true);
  const [cine, setCine] = useState(false);
  const cineRef = useRef<number | null>(null);
  const [status, setStatus] = useState("");
  // 판독 도크 — 공유 컴포넌트 ReportDock 로 추출(상태·로직 포함 이사, components/ReportDock.tsx)
  // TY 팔레트 개인화 (viewer.prefs — 계정 로밍): 아이콘 크기/라벨/퀵로우/사용패턴/오버레이 폰트
  const [tySize, setTySize] = useState(17);          // ty_tool_size
  const [tyLabels, setTyLabels] = useState(true);    // ty_tool_labels
  const [tyIcon3d, setTyIcon3d] = useState(true);    // ty_icon_3d — false 면 플랫(평면) 아이콘
  const [tyQuickRow, setTyQuickRow] = useState(true);  // ty_quick_row — ★ Quick 행 표시
  const [tyUsageRec, setTyUsageRec] = useState(true);  // ty_usage_rec — 사용 패턴 기록 on/off
  const [tyUsage, setTyUsage] = useState<Record<string, number>>({});  // ty_usage
  const tyUsageRef = useRef<Record<string, number>>({});
  const [tyOvFont, setTyOvFont] = useState(10.5);    // ty_overlay_font — T+스크롤
  const tHeld = useRef(false);   // T 홀드 — T+스크롤=오버레이 글자 크기, T+Del=오버레이 토글
  // viewer.prefs 부분 패치 저장 — 디바운스(연속 조작 병합, 계정 로밍)
  const pendingPrefs = useRef<Record<string, unknown>>({});
  const prefsTimer = useRef<number | null>(null);
  const persistPrefsPatch = (patch: Record<string, unknown>, delay = 600) => {
    pendingPrefs.current = { ...pendingPrefs.current, ...patch };
    if (prefsTimer.current) window.clearTimeout(prefsTimer.current);
    prefsTimer.current = window.setTimeout(() => {
      const p = pendingPrefs.current;
      pendingPrefs.current = {};
      api.getSetting("viewer.prefs").then((r) =>
        api.putSetting("viewer.prefs", { ...r.value, ...p }, "user")).catch(() => {});
    }, delay);
  };
  /* 언마운트 시 디바운스 대기 중인 패치 즉시 저장 — 뷰어 닫힘 직전 조작(사용 카운트 등) 유실 방지.
     페인 로컬 미디어 오브젝트 URL 도 함께 해제(누수 방지) */
  useEffect(() => () => {
    if (prefsTimer.current) window.clearTimeout(prefsTimer.current);
    const p = pendingPrefs.current;
    if (Object.keys(p).length) {
      pendingPrefs.current = {};
      api.getSetting("viewer.prefs").then((r) =>
        api.putSetting("viewer.prefs", { ...r.value, ...p }, "user")).catch(() => {});
    }
    Object.values(panesRef.current).forEach((q) => {
      if (q.media) URL.revokeObjectURL(q.media.url);
    });
  }, []);
  /* 사용 패턴 기록 — 툴·액션 버튼 활성화 시 카운트+1, 상위 50개만 유지, 2초 디바운스 저장 */
  const recordUse = (id: string) => {
    if (!tyUsageRec) return;
    const merged = { ...tyUsageRef.current, [id]: (tyUsageRef.current[id] ?? 0) + 1 };
    const top = Object.fromEntries(Object.entries(merged).sort((a, b) => b[1] - a[1]).slice(0, 50));
    tyUsageRef.current = top;
    setTyUsage(top);
    persistPrefsPatch({ ty_usage: top }, 2000);
  };
  /* 오버레이 표시 토글 — INFO ● 버튼·T+Del 공용, ty_overlay_visible 로밍 */
  const toggleOverlay = () => setOverlayOn((o) => {
    persistPrefsPatch({ ty_overlay_visible: !o });
    return !o;
  });
  const [priorTrees, setPriorTrees] = useState<Record<number, { uid: string; series: SeriesNode[] }>>({});

  /* 검사별 환자·검사 메타(uid 키) — 페인 오버레이가 '그 페인의 검사' 환자 정보를 표기하도록 (타 환자 오표기 방지) */
  type StudyMetaLite = { patient_name: string; sex: string; patient_key: string; modality: string; study_date: string; study_desc: string };
  const [studyMeta, setStudyMeta] = useState<Record<string, StudyMetaLite>>({});
  const metaReqRef = useRef<Set<string>>(new Set());
  const metaOf = (d: StudyMetaLite): StudyMetaLite => ({
    patient_name: d.patient_name, sex: d.sex, patient_key: d.patient_key,
    modality: d.modality, study_date: d.study_date, study_desc: d.study_desc,
  });
  const ensureMeta = (examId: number, uid: string) => {
    if (metaReqRef.current.has(uid)) return;
    metaReqRef.current.add(uid);
    api.study(examId).then((d) => setStudyMeta((m) => ({ ...m, [uid]: metaOf(d) })))
      .catch(() => metaReqRef.current.delete(uid));
  };
  useEffect(() => {
    setStudyMeta((m) => {
      const n = { ...m, [detail.study_uid]: metaOf(detail) };
      if (addDetail) n[addDetail.study_uid] = metaOf(addDetail);
      if (stackDetail) n[stackDetail.study_uid] = metaOf(stackDetail);
      return n;
    });
  }, [detail, addDetail, stackDetail]);
  // 오픈 검사 탭 — 여러 검사가 열리면 좌→우로 탭이 쌓인다(브라우저 창 메타포, UBPACS Opened Study List)
  const [openTabs, setOpenTabs] = useState<{ id: number; uid: string; label: string }[]>([]);
  useEffect(() => { if (openTabs.length) savePersistedTabs(openTabs); }, [openTabs]);  // ✕/전체닫기 전까지 유지
  openTabsRef.current = openTabs;  // 동기 리스너·◀▶ 기준점에서 최신값 사용
  const [closeDlg, setCloseDlg] = useState(false);
  // 측정/주석 (07 A.4) + Reference line
  const [tool, setTool] = useState<ToolKind | null>(null);
  const [annos, setAnnos] = useState<Anno[]>([]);
  const [draft, setDraft] = useState<{ pid: string; sop_uid: string; series_uid: string; points: number[][] } | null>(null);
  const [refOn, setRefOn] = useState(false);
  // TY-2 이식 상태 — Spine Label 연번, Profile 그래프·2D Table 모달 (In Viewer 이식)
  const spineSeq = useRef<{ base: string; n: number }>({ base: "L", n: 1 });
  const [profileData, setProfileData] = useState<{ title: string; vals: number[] } | null>(null);
  const [tableData, setTableData] = useState<{ title: string; rows: string[][] } | null>(null);
  const paneSizes = useRef<Record<string, { w: number; h: number }>>({});
  const [, setSizeTick] = useState(0);
  const observers = useRef<Record<string, ResizeObserver>>({});
  const paneRefCbs = useRef<Record<string, (el: HTMLDivElement | null) => void>>({});

  const getPaneRef = (pid: string) => {
    if (!paneRefCbs.current[pid]) {
      paneRefCbs.current[pid] = (el) => {
        observers.current[pid]?.disconnect();
        delete observers.current[pid];
        if (el) {
          const ro = new ResizeObserver((es) => {
            const r = es[0].contentRect;
            paneSizes.current[pid] = { w: r.width, h: r.height };
            setSizeTick((t) => t + 1);
          });
          ro.observe(el);
          observers.current[pid] = ro;
        }
      };
    }
    return paneRefCbs.current[pid];
  };

  const patch = useCallback((pid: string, p: Partial<PaneState>) => {
    setPanes((prev) => ({ ...prev, [pid]: { ...prev[pid], ...p } }));
  }, []);

  /* ── TY-3(2): 멀티 페인 연동 조작 공용 — updMany/targetsOf (In 이식, ref 로 항상 최신 선택 집합) ── */
  const updMany = useCallback((pids: string[], f: (p: PaneState) => Partial<PaneState>) => {
    setPanes((prev) => {
      const next = { ...prev };
      for (const id of pids) {
        if (next[id]?.series) next[id] = { ...next[id], ...f(next[id]) };
      }
      return next;
    });
  }, []);
  const targetsOf = (pid: string): string[] => {
    const s = selPanesRef.current;
    return s.size > 1 && s.has(pid) ? [...s] : [pid];
  };

  /* ── TY-3(1): 작업 히스토리 ◀◯▶ — 스냅샷 최대 50, Undo/초기화/Redo (In pushHist/histGo 이식) ── */
  const panesRef = useRef(panes);
  useEffect(() => { panesRef.current = panes; }, [panes]);
  const annosRef = useRef(annos);
  useEffect(() => { annosRef.current = annos; }, [annos]);
  const histRef = useRef<Snap[]>([]);
  const histIdx = useRef(-1);
  const [histTick, setHistTick] = useState(0);
  const takeSnap = (): Snap => ({
    vis: Object.fromEntries(Object.entries(panesRef.current).map(([k, p]) => [k, {
      zoom: p.zoom, tx: p.tx, ty: p.ty, rot: p.rot, flipH: p.flipH, flipV: p.flipV,
      invert: p.invert, wl: p.wl, fx: p.fx, shutter: p.shutter,
    }])),
    annos: annosRef.current,
  });
  const pushHist = () => {
    const s = takeSnap();
    const h = histRef.current;
    if (h[histIdx.current] && JSON.stringify(h[histIdx.current]) === JSON.stringify(s)) return;
    histRef.current = [...h.slice(0, histIdx.current + 1), s].slice(-50);   // redo 꼬리 절단, 최대 50
    histIdx.current = histRef.current.length - 1;
    setHistTick((t) => t + 1);
  };
  const schedHist = () => { window.setTimeout(pushHist, 50); };   // 상태 반영 후 캡처 (In 동일)
  const applySnap = (s: Snap) => {
    setPanes((prev) => Object.fromEntries(
      Object.entries(prev).map(([k, p]) => [k, s.vis[k] ? { ...p, ...s.vis[k] } : p])));
    setAnnos(s.annos);
  };
  const histGo = (d: -1 | 1) => {
    const ni = histIdx.current + d;
    if (ni < 0 || ni >= histRef.current.length) return;
    histIdx.current = ni;
    applySnap(histRef.current[ni]);
    setHistTick((t) => t + 1);
  };
  const histReset = () => {
    if (!histRef.current[0]) return;
    applySnap(histRef.current[0]);
    histIdx.current = 0;
    setHistTick((t) => t + 1);
    setStatus("초기 상태로 되돌렸습니다");
  };
  // 히스토리에 기록할 원샷 조작(act) — 방향 전환/반전/필터/초기화 등 (In HIST_OPS 동일 취지)
  const HIST_OPS = useMemo(() => new Set(
    ["fit", "reset", "invert", "rotL", "rotR", "rot180", "flipH", "flipV", "sharpen", "average", "pseudo"]), []);

  /* ── TY-3(5): 페인별 독립 시네 엔진 — 100ms 틱, 페인 간격(cineSec ?? ty_cine_sec) 경과 시 전진.
        전역 Space 시네(cineRef)와 공존: 페인별 재생 중인 페인은 전역 스텝을 건너뛴다(페인별 우선).
        주의: 간격 판정·cineLastRef 갱신은 updater 밖에서(순수 updater — StrictMode 이중 호출 안전) ── */
  const cineLastRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      const stride = Math.max(1, imgLay.r * imgLay.c);
      const due: string[] = [];
      for (const pid of PANE_IDS) {
        const p = panesRef.current[pid];
        if (!p?.playing || !p.series?.instances.length || p.media) continue;
        const sec = p.cineSec ?? tyCineSec;
        if (now - (cineLastRef.current[pid] ?? 0) < Math.max(0.05, sec) * 1000) continue;
        cineLastRef.current[pid] = now;
        due.push(pid);
      }
      if (!due.length) return;
      setPanes((ps) => {
        const next = { ...ps };
        for (const pid of due) {
          const p = ps[pid];
          if (!p?.playing || !p.series?.instances.length || p.media) continue;
          next[pid] = { ...p, index: (p.index + stride) % p.series.instances.length };
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(t);
  }, [imgLay, tyCineSec]);

  /* HP 규칙 적용 — Series/Image layout + W/L 프리셋 */
  const applyHp = useCallback((rule: HpRule) => {
    const key = `${Math.min(rule.s.r, 10)}x${Math.min(rule.s.c, 10)}`;
    if (LAYOUTS[key]) setLayout(key);
    setImgLay({ r: Math.min(rule.i.r, 10), c: Math.min(rule.i.c, 10) });
    if (rule.wl !== undefined) {
      setPanes((prev) => Object.fromEntries(
        Object.entries(prev).map(([k, p]) => [k, { ...p, wl: rule.wl ?? "" }])));
    }
    setHpName(rule.name);
  }, []);

  /* 설정 로드 + 행잉 적용(모달리티→분할) + HP 규칙 자동 매칭 */
  useEffect(() => {
    api.getSetting("viewer.prefs").then((r) => {
      const v = r.value as Partial<ViewerPrefs> & { hanging2d?: Record<string, string> };
      const merged = { ...DEFAULT_PREFS, ...v };
      if (!merged.wl_presets?.length) merged.wl_presets = WL_PRESETS;
      // 구 기본값 업그레이드(23차: 팔레트·썸네일 확대) — 직접 조절한 값은 유지
      if (merged.thumbSize === 84) merged.thumbSize = 128;
      if (merged.paletteW === 100) merged.paletteW = 138;
      if (merged.dockW === 250) merged.dockW = 340;  // 판독 도크 에디터화(26차)에 맞춰 확대
      setPrefs(merged);
      const hp = merged.hanging2d?.[detail.modality];
      if (hp && LAYOUTS[hp]) setLayout(hp as keyof typeof LAYOUTS);
      // TY 팔레트·오버레이 개인화 키 소비 (viewer.prefs 통짜 — 계정 로밍)
      const t = r.value as {
        ty_tool_size?: number; ty_tool_labels?: boolean; ty_icon_3d?: boolean; ty_quick_row?: boolean;
        ty_usage_rec?: boolean; ty_usage?: Record<string, number>;
        ty_overlay_font?: number; ty_overlay_visible?: boolean;
        ty_sel_color?: string; ty_cine_sec?: number;
      };
      if (t.ty_tool_size) setTySize(t.ty_tool_size);
      if (t.ty_tool_labels !== undefined) setTyLabels(t.ty_tool_labels);
      if (t.ty_icon_3d !== undefined) setTyIcon3d(t.ty_icon_3d);
      if (t.ty_quick_row !== undefined) setTyQuickRow(t.ty_quick_row);
      if (t.ty_usage_rec !== undefined) setTyUsageRec(t.ty_usage_rec);
      if (t.ty_usage) { tyUsageRef.current = t.ty_usage; setTyUsage(t.ty_usage); }
      if (t.ty_overlay_font) setTyOvFont(t.ty_overlay_font);
      if (t.ty_overlay_visible !== undefined) setOverlayOn(t.ty_overlay_visible);
      if (t.ty_sel_color) setTySelColor(t.ty_sel_color);
      if (t.ty_cine_sec) setTyCineSec(Math.min(10, Math.max(0.05, t.ty_cine_sec)));
    }).catch(() => {});
    // HP: 장비×부위×Projection 매칭 — 첫 일치 규칙 자동 적용 (hanging2d보다 우선)
    api.getSetting("viewer.hp").then((r) => {
      const rules = ((r.value as { rules?: HpRule[] }).rules) ?? [];
      setHpRules(rules);
      const up = (s: string) => (s || "").toUpperCase();
      const m = rules.find((x) =>
        (!x.modality || x.modality === detail.modality) &&
        (!x.body_part || up(detail.body_part).includes(up(x.body_part))) &&
        (!x.projection || up(detail.study_desc).includes(up(x.projection))));
      if (m) applyHp(m);
    }).catch(() => {});
  }, [detail.modality, detail.body_part, detail.study_desc, applyHp]);

  /* 시리즈 트리 + 리포트 로드 */
  useEffect(() => {
    // Exam 탭 영속 복원: 기존 탭(좌측) + 새로 연 검사(우측). #id로 동일 라벨 검사 구분
    const main = {
      id: detail.id, uid: detail.study_uid,
      label: `${detail.modality} ${detail.body_part || detail.patient_name} ${detail.study_date} #${detail.id}`,
    };
    setOpenTabs([...loadPersistedTabs().filter((t) => t.id !== detail.id), main]);
    postStudySync(detail.id, "viewer");  // Worklist·Reading 연동
    // TY-3(1): 검사 전환 — 작업 히스토리 재시작 (초기 스냅샷은 로드 완료 후)
    histRef.current = [];
    histIdx.current = -1;
    setHistTick((t) => t + 1);
    api.seriesTree(detail.id).then((r) => {
      let imgSeries = r.series.filter((s) => !["SR", "KO", "PR", "SEG"].includes(s.modality));
      // ⑤ Key Image View: 키 이미지 SOP만 남긴다 (빈 시리즈 제거)
      if (keySops?.length) {
        const keep = new Set(keySops);
        imgSeries = imgSeries
          .map((s) => ({ ...s, instances: s.instances.filter((i) => keep.has(i.sop_uid)) }))
          .filter((s) => s.instances.length > 0);
        setStatus(`Key Image View — 키 이미지 ${keySops.length}장만 표시`);
      }
      setSeries(imgSeries);
      if (imgSeries[0]) {
        setSelSeries(imgSeries[0].series_uid);
        // ② AI 추천 W/L 자동 적용(수동 변경 가능). 합성/비보정 데이터(PixelSpacing 없음)는
        //    HU 윈도우가 화면을 날리므로 적용하지 않는다(서버 VOI 기본 유지)
        const mod = detail.modality || imgSeries[0].modality;
        const bp = detail.body_part || detail.study_desc;
        const realData = !!imgSeries[0].instances[0]?.pixel_spacing?.length;
        const ai = realData ? autoWL(mod, bp) : null;
        setPanes((prev) => {
          const next = { ...prev };
          PANE_IDS.forEach((pid, i) => {
            const s = imgSeries[Math.min(i, imgSeries.length - 1)];
            next[pid] = { ...initPane(detail.study_uid), series: s,
                          index: Math.floor(s.instances.length / 2), wl: ai?.q ?? "" };
          });
          return next;
        });
        if (ai) setStatus(`AI 추천 W/L 적용: ${ai.label} (2D 섹션에서 변경 가능)`);
      }
      // ② Add View / ③ Stack View — 기본 로드 완료 후 추가 검사 로드 (UBPACS-Z Study Open)
      if (addDetail) void loadPrior(addDetail.id);
      if (stackDetail) void loadStack(stackDetail.id);
      // Study With Open (p.13): Related Study List 검사들을 한번에 같이 오픈
      if (withOpen?.ids.length) {
        if (withOpen.mode === "add") void loadAddMany(withOpen.ids);
        else void loadStackMany(withOpen.ids);
      }
      window.setTimeout(pushHist, 300);   // TY-3(1): 로드 완료 후 초기 스냅샷
    }).catch(() => setStatus("시리즈 조회 실패"));
    // 리포트/상용구/판독설정 로드는 ReportDock 내부로 이동 (detail.id 변경 시 자체 재로드)
    api.annotations(detail.id).then((r) => { setAnnos(r.items); schedHist(); }).catch(() => {});
    return () => {
      // 검사 전환/언마운트 — 전역 시네 정지 시 ref·표시 상태까지 재정렬(재생 버튼 잔상 방지)
      if (cineRef.current) { window.clearInterval(cineRef.current); cineRef.current = null; }
      setCine(false);
      Object.values(observers.current).forEach((o) => o.disconnect());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id, detail.study_uid, addDetail?.id, stackDetail?.id, keySops?.length]);

  /* 시리즈 트리 캐시 — 비교/탭 전환 공용 */
  const getTree = async (examId: number) => {
    let tree = priorTrees[examId];
    if (!tree) {
      const r = await api.seriesTree(examId);
      tree = { uid: r.study_uid, series: r.series.filter((s) => !["SR", "KO", "PR", "SEG"].includes(s.modality)) };
      setPriorTrees((p) => ({ ...p, [examId]: tree }));
    }
    ensureMeta(examId, tree.uid);  // 오버레이용 환자 메타 확보(1회)
    return tree;
  };

  /* 시리즈 → 소속 검사 uid (썸네일/시리즈 메뉴 클릭 시 검사 오귀속 방지) */
  const uidOfSeries = (su: string): string => {
    for (const t of Object.values(priorTrees)) if (t.series.some((x) => x.series_uid === su)) return t.uid;
    return detail.study_uid;
  };

  /* 오픈 탭 — 추가 검사가 열릴 때마다 좌→우로 탭이 쌓인다 */
  const tabLabel = (id: number): string => {
    const rel = detail.related_exams.find((x) => x.id === id);
    if (rel) return `${rel.modality} ${rel.study_date}`;
    if (addDetail?.id === id) return `${addDetail.modality} ${addDetail.study_date}`;
    if (stackDetail?.id === id) return `${stackDetail.modality} ${stackDetail.study_date}`;
    return `검사 #${id}`;
  };
  const addOpenTab = (id: number, uid: string) =>
    setOpenTabs((prev) => prev.some((t) => t.id === id) ? prev : [...prev, { id, uid, label: tabLabel(id) }]);

  /* Opened 메뉴 부제 — modality · 검사일 */
  const tabSub = (id: number): string | undefined => {
    if (id === detail.id) return `${detail.modality} · ${detail.study_date}`;
    const rel = detail.related_exams.find((x) => x.id === id);
    if (rel) return `${rel.modality} · ${rel.study_date}`;
    if (addDetail?.id === id) return `${addDetail.modality} · ${addDetail.study_date}`;
    if (stackDetail?.id === id) return `${stackDetail.modality} · ${stackDetail.study_date}`;
    return undefined;
  };

  /* 탭 클릭: 해당 검사를 활성 페인에 표시 (UBPACS Opened Study List 전환) */
  const loadIntoActive = async (id: number) => {
    if (id === detail.id) {
      const s = series[0];
      if (s) patch(activePane, { ...initPane(detail.study_uid), series: s, index: Math.floor(s.instances.length / 2) });
      return;
    }
    try {
      const tree = await getTree(id);
      const s = tree.series[0];
      if (!s) { setStatus("이 검사에 표시할 영상 시리즈가 없습니다"); return; }
      patch(activePane, { ...initPane(tree.uid), series: s, index: Math.floor(s.instances.length / 2) });
    } catch { setStatus("검사 전환 실패"); }
  };
  loadIntoActiveRef.current = loadIntoActive;  // 동기 리스너에서 최신 클로저 사용

  /* 탭 닫기: 목록에서 제거 + 해당 검사를 보이던 페인은 주 검사로 복귀 */
  const closeTab = (id: number) => {
    const tab = openTabs.find((t) => t.id === id);
    setOpenTabs((prev) => prev.filter((t) => t.id !== id));
    if (!tab) return;
    setPanes((prev) => {
      const next = { ...prev };
      const main = series[0];
      for (const pid of PANE_IDS) {
        if (next[pid].studyUid === tab.uid && main) {
          next[pid] = { ...initPane(detail.study_uid), series: main, index: Math.floor(main.instances.length / 2) };
        }
      }
      return next;
    });
  };

  /* 과거검사 비교 로드(요청 5): related exam 클릭 → 활성 페인에 */
  const loadPrior = async (examId: number) => {
    const tree = await getTree(examId);
    const s = tree.series[0];
    if (!s) return;
    addOpenTab(examId, tree.uid);
    // ④ 변화강조 비교 동선: 1x1이면 자동 1x2 전환, 현재=좌(p0)·과거=우(p1), Link 동기 on
    if (LAYOUTS[layout].count === 1) {
      setLayout("1x2");
      patch("p1", { ...initPane(tree.uid), series: s, index: Math.floor(s.instances.length / 2) });
      setActivePane("p1");
    } else {
      patch(activePane, { ...initPane(tree.uid), series: s, index: Math.floor(s.instances.length / 2) });
    }
    setXmode("sync_other");
    setStatus("비교 모드: 과거검사 로드 + 동기 스크롤 ON (SyncOther)");
  };

  /* ③ Stack View (UBPACS-Z): 기존 시리즈는 썸네일에 유지 + 선택 검사를 활성 페인에 중첩 로드 */
  const loadStack = async (examId: number) => {
    try {
      const r = await getTree(examId);
      const imgSeries = r.series.map((s) => ({ ...s, series_desc: `[중첩] ${s.series_desc || s.modality}` }));
      if (!imgSeries.length) { setStatus("Stack View: 추가 검사에 영상 시리즈 없음"); return; }
      addOpenTab(examId, r.uid);
      setSeries((prev) => [...prev, ...imgSeries.filter((s) => !prev.some((p) => p.series_uid === s.series_uid))]);
      const s = imgSeries[0];
      patch(activePane, {
        ...initPane(r.uid), series: s, index: Math.floor(s.instances.length / 2),
      });
      setStatus("Stack View: 선택 검사 중첩 — 기존 영상은 썸네일·다른 페인에 유지");
    } catch { setStatus("Stack View 로드 실패"); }
  };

  /* Refresh Exam — 활성 페인의 검사 시리즈를 서버에서 재조회해 갱신 (In Viewer loadSeries 이식) */
  const refreshExam = async () => {
    const uid = panes[activePane]?.studyUid || detail.study_uid;
    const id = openTabsRef.current.find((t) => t.uid === uid)?.id ?? detail.id;
    try {
      const r = await api.seriesTree(id);
      const imgSeries = r.series.filter((s) => !["SR", "KO", "PR", "SEG"].includes(s.modality));
      if (id === detail.id) setSeries(imgSeries);
      else setPriorTrees((prev) => ({ ...prev, [id]: { uid: r.study_uid, series: imgSeries } }));
      // 같은 검사를 보이는 페인들의 시리즈 객체를 새 데이터로 교체(인덱스 범위 보정)
      setPanes((prev) => Object.fromEntries(Object.entries(prev).map(([k, p]) => {
        if (p.studyUid !== uid || !p.series) return [k, p];
        const ns = imgSeries.find((s) => s.series_uid === p.series!.series_uid);
        return [k, ns ? { ...p, series: ns, index: Math.min(p.index, ns.instances.length - 1) } : p];
      })));
      setStatus("Refresh Exam — 활성 검사 시리즈를 재조회했습니다");
    } catch { setStatus("Refresh Exam 실패"); }
  };

  /* Combine Series — 현재 검사의 모든 시리즈를 하나의 스택으로 합쳐 활성 페인에 (In Viewer combine 이식) */
  const combineSeries = () => {
    const all: InstanceNode[] = series.flatMap((s) => s.instances);
    if (!series.length || !all.length) { setStatus("Combine Series — 합칠 시리즈가 없습니다"); return; }
    patch(activePane, {
      studyUid: detail.study_uid,
      series: { ...series[0], series_desc: `[Combine] ${series.length} series`, instances: all },
      index: 0,
    });
    setStatus(`Combine Series — ${series.length}개 시리즈 ${all.length}장을 한 스택으로 결합`);
  };

  /* Study With Open — ADD: Related 최대 3건을 p1~p3 분할 오픈 / STACK: 순차 중첩 */
  const loadAddMany = async (ids: number[]) => {
    const take = ids.slice(0, 3);
    setLayout(take.length >= 2 ? "2x2" : "1x2");
    for (let i = 0; i < take.length; i++) {
      try {
        const tree = await getTree(take[i]);
        const s = tree.series[0];
        if (!s) continue;
        addOpenTab(take[i], tree.uid);
        patch(PANE_IDS[i + 1], { ...initPane(tree.uid), series: s, index: Math.floor(s.instances.length / 2) });
      } catch { /* 개별 실패 무시 */ }
    }
    setXmode("sync_other");
    setStatus(`Study With Open (ADD VIEW): Related ${take.length}건 함께 오픈`);
  };
  const loadStackMany = async (ids: number[]) => {
    for (const id of ids) await loadStack(id);
    setStatus(`Study With Open (STACK VIEW): Related ${ids.length}건 중첩 오픈`);
  };

  const step = useCallback((pid: string, dir: number) => {
    setPanes((prev) => {
      const next = { ...prev };
      const stride = Math.max(1, imgLay.r * imgLay.c);  // Image Layout 분할 시 페이지 단위 이동
      const apply = (id: string) => {
        const p = next[id];
        if (!p?.series) return;
        next[id] = { ...p, index: Math.min(Math.max(p.index + dir * stride, 0), p.series.instances.length - 1) };
      };
      // Crosslink 모드: auto_sync=같은 검사 페인, sync_other=전체(과거검사 포함) — In §3.3 이식
      const vis = PANE_IDS.slice(0, LAYOUTS[layout].count);
      const targets = new Set<string>([pid]);
      if (xmode === "sync_other") vis.forEach((v) => targets.add(v));
      else if (xmode === "auto_sync") {
        vis.forEach((v) => { if (prev[v]?.studyUid === prev[pid]?.studyUid) targets.add(v); });
      }
      // 멀티 선택 페인 연동 스크롤 (선택 집합에 포함된 페인에서 스크롤 시)
      const sel = selPanesRef.current;
      if (sel.size > 1 && sel.has(pid)) sel.forEach((v) => targets.add(v));
      targets.forEach(apply);
      return next;
    });
  }, [xmode, layout, imgLay]);

  /* 뷰어 단축키: ←→=이미지, I=반전, R=회전, F=Fit, L=Link, 1/2/4=분할, Space=Cine, Esc=닫기 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.toLowerCase() === "t") { tHeld.current = true; return; }  // T 홀드 시작
      if (e.key === "Delete" && tHeld.current) {  // T+Del = 오버레이 토글 (In Viewer 패리티)
        e.preventDefault();
        toggleOverlay();
        return;
      }
      switch (e.key) {
        case "ArrowRight": case "ArrowDown": e.preventDefault(); step(activePane, 1); break;
        case "ArrowLeft": case "ArrowUp": e.preventDefault(); step(activePane, -1); break;
        case "Escape":
          if (menu) setMenu(null);
          else if (draft) setDraft(null);
          else if (tool) setTool(null);
          else if (selPanes.size) setSelPanes(new Set());  // 멀티 선택 해제 (In 동일)
          else if (maximized) setMaximized(null);   // 최대화 복원
          else requestCloseRef.current();
          break;
        case " ": e.preventDefault(); act("cine"); break;
        case "1": setLayout("1x1"); break;
        case "2": setLayout("1x2"); break;
        case "4": setLayout("2x2"); break;
        default:
          if (e.ctrlKey || e.altKey || e.metaKey) break;   // 브라우저 조합키(Ctrl+A 등) 보존
          switch (e.key.toLowerCase()) {
            case "i": act("invert"); break;
            case "r": act("rotR"); break;
            case "f": act("fit"); break;
            case "l": setXmode((x) => (x === "off" ? "auto_sync" : "off")); break;  // Crosslink 토글 (In 'l' 등가)
            case "a":   // 전체 페인 선택 (In 'A' 동일)
              e.preventDefault();
              setSelPanes(new Set(PANE_IDS.slice(0, LAYOUTS[layout].count)));
              break;
          }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "t") tHeld.current = false;  // T 홀드 해제
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePane, step, tool, draft, menu, maximized, selPanes, layout]);

  /* 마우스 상호작용 — TY-3(2): Shift=범위 선택/Ctrl=토글, 선택 밖 일반 클릭=해제 (In 이식) */
  const dragRef = useRef<{ pid: string; x: number; y: number; btn: number; moved: boolean } | null>(null);
  const onPaneMouseDown = (pid: string, e: React.MouseEvent) => {
    const vis = PANE_IDS.slice(0, LAYOUTS[layout].count);
    if (e.shiftKey) {
      const idx = vis.indexOf(pid);
      if (idx >= 0) setSelPanes(new Set(vis.slice(0, idx + 1)));   // 처음~클릭 페인 범위
    } else if (e.ctrlKey) {
      setSelPanes((s) => {
        const n = new Set(s.size ? s : [activePane]);              // 활성+클릭 페인 토글
        if (n.has(pid) && pid !== activePane) n.delete(pid); else n.add(pid);
        return n;
      });
    } else if (selPanes.size && !selPanes.has(pid)) {
      setSelPanes(new Set());   // 선택 집합 밖 일반 클릭 — 해제
    }
    setActivePane(pid);
    if (tool && e.button === 0 && !e.shiftKey && !e.ctrlKey) { handleAnnoPoint(pid, e); return; }  // 측정 도구 우선
    dragRef.current = { pid, x: e.clientX, y: e.clientY, btn: e.button, moved: false };
  };

  /* 측정 도구 — 클릭 점 수집 → 완성 시 주석 생성(계측값 자동 계산)
     open-ended(spineCurve/poly/shutPoly)는 점 수 제한 없이 수집, 더블클릭(finishOpenEnded)으로 종료 */
  const handleAnnoPoint = (pid: string, e: React.MouseEvent) => {
    const p = panes[pid];
    const inst = p.series?.instances[p.index];
    if (!tool || !p.series || !inst) return;
    if (OPEN_ENDED.has(tool) && e.detail > 1) return;  // 더블클릭 2번째 mousedown 은 점 추가 안 함
    const aspect = inst.cols && inst.rows ? inst.cols / inst.rows : 1;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const pt = screenToImage(e.clientX, e.clientY, rect, p, aspect);
    if (!pt) return;
    const need = TOOL_PTS[tool] ?? 2;
    const d = draft && draft.pid === pid
      ? draft
      : { pid, sop_uid: inst.sop_uid, series_uid: p.series.series_uid, points: [] as number[][] };
    const points = [...d.points, pt];
    if (points.length < need) { setDraft({ ...d, points }); return; }
    completeTool(tool, pid, d, points, inst);
  };

  /* 주석 확정 공용 — 계측값/텍스트를 붙여 로컬 주석 목록에 추가 */
  const pushAnno = (
    d: { sop_uid: string; series_uid: string }, kind: string, points: number[][],
    m: { value: number | null; unit: string; text?: string } | null, text = "",
  ) => {
    setAnnos((prev) => [...prev, {
      series_uid: d.series_uid, sop_uid: d.sop_uid, kind, points,
      value: m?.value ?? null, unit: m?.unit ?? "", text: m?.text ?? text, source: "user",
    }]);
    schedHist();   // TY-3(1): 주석 추가 — 히스토리 기록
  };

  /* 필요 점이 모두 모인 툴의 완료 처리 — 주석/셔터/픽셀 도구 분기 (In Viewer finishTool 이식) */
  const completeTool = (
    tk: ToolKind, pid: string,
    d: { sop_uid: string; series_uid: string }, points: number[][], inst: InstanceNode,
  ) => {
    setDraft(null);
    const p = panes[pid];
    switch (tk) {
      // ── 셔터 3종 — 페인 시각 상태(주석 아님), Clr/Reset 으로 해제 ──
      case "shutRect": case "shutEl": case "shutPoly": {
        const kind = tk === "shutRect" ? "rect" : tk === "shutEl" ? "ellipse" : "poly";
        patch(pid, { shutter: { kind, pts: points } });
        setStatus("셔터 적용 — Clr(주석 전체 삭제) 또는 Reset 으로 해제");
        schedHist();
        return;
      }
      // ── TY-3(4): 3D Cursor — 클릭점의 3D 위치로 다른 페인 인덱스 이동 + 십자 마커 (In cursor3d 이식) ──
      case "cursor3d": {
        const vis = PANE_IDS.slice(0, LAYOUTS[layout].count);
        const g = geomOf(inst);
        const markers: Record<string, { sop: string; x: number; y: number }> = {};
        if (g) {
          // 기하 있음 — 클릭점을 3D 좌표로 → 각 페인 시리즈에서 평면 거리 최소 인스턴스로 이동
          const px = points[0][0] * (inst.cols || 1), py = points[0][1] * (inst.rows || 1);
          const P: V3 = [0, 1, 2].map((k) => g.pos[k] + px * g.cs * g.row[k] + py * g.rs * g.col[k]);
          setPanes((prev) => {
            const next = { ...prev };
            for (const id of vis) {
              const q = prev[id];
              const s = q?.series;
              if (!s) continue;
              let best = -1, bd = Infinity;
              for (let k = 0; k < s.instances.length; k++) {
                const qg = geomOf(s.instances[k]);
                if (!qg) continue;
                const nl = Math.hypot(...qg.n) || 1;
                const dist = Math.abs(vdot(qg.n, vsub(P, qg.pos))) / nl;
                if (dist < bd) { bd = dist; best = k; }
              }
              if (best < 0) continue;
              const bi = s.instances[best];
              const bg = geomOf(bi)!;
              const dv = vsub(P, bg.pos);
              markers[id] = { sop: bi.sop_uid,
                              x: vdot(dv, bg.row) / bg.cs / (bi.cols || 1),
                              y: vdot(dv, bg.col) / bg.rs / (bi.rows || 1) };
              next[id] = { ...q, index: best };
            }
            return next;
          });
        } else {
          // 기하 정보 없음 — 같은 시리즈 index 비율 동기 근사 (마커는 동일 정규화 좌표)
          const src = p.series!;
          const ratio = src.instances.length > 1 ? p.index / (src.instances.length - 1) : 0;
          setPanes((prev) => {
            const next = { ...prev };
            for (const id of vis) {
              const q = prev[id];
              const s = q?.series;
              if (!s) continue;
              const k = Math.round(ratio * (s.instances.length - 1));
              const bi = s.instances[k];
              if (!bi) continue;
              markers[id] = { sop: bi.sop_uid, x: points[0][0], y: points[0][1] };
              next[id] = { ...q, index: k };
            }
            return next;
          });
          setStatus("3D Cursor — 기하 정보 없음: index 비율 근사 동기");
        }
        setCross3d(markers);
        return;
      }
      // ── 텍스트 계열 — 입력 프롬프트 ──
      case "text": {
        const text = window.prompt("주석 텍스트") ?? "";
        if (!text) return;
        pushAnno(d, "text", points, null, text);
        return;
      }
      case "box": {
        const text = window.prompt("메모 제목");
        if (text === null) return;
        pushAnno(d, "box", points, null, text || "");
        return;
      }
      case "marking": {
        const text = window.prompt("Marking (짧은 표기, 예: ①, R, ✓)");
        if (!text) return;
        pushAnno(d, "marking", points, null, text);
        return;
      }
      case "spine": {
        // 첫 클릭에 시작 라벨 입력(예: C1/T1/L1) → 이후 클릭마다 연번 증가
        if (spineSeq.current.n === 1) {
          const base = window.prompt("시작 라벨 (예: C1, T1, L1)", "L1");
          if (!base) return;
          const m = base.match(/^([A-Za-z]+)(\d+)$/);
          spineSeq.current = m ? { base: m[1].toUpperCase(), n: Number(m[2]) } : { base: base.toUpperCase(), n: 1 };
        }
        pushAnno(d, "spine", points, null, `${spineSeq.current.base}${spineSeq.current.n}`);
        spineSeq.current.n += 1;
        return;
      }
      // ── 픽셀 도구 3종 — 렌더 8bit + W/L 역변환 근사('≈'), lib/pixelTools ──
      case "lens": {
        const url = renderedUrlAt(p, p.index);
        const cols = inst.cols || 1000, rows = inst.rows || 1000;
        if (!url) return;
        void samplePixels(url, cols, rows).then((data) => {
          if (!data) { setStatus("픽셀 샘플 실패(CORS)"); return; }
          const v = rawAt(data, points[0][0] * cols, points[0][1] * rows, p.wl);
          pushAnno(d, "lens", points, null, `≈${v.toFixed(0)}`);
        });
        return;
      }
      case "profile": {
        const url = renderedUrlAt(p, p.index);
        const cols = inst.cols || 1000, rows = inst.rows || 1000;
        if (!url) return;
        void samplePixels(url, cols, rows).then((data) => {
          if (!data) { setStatus("픽셀 샘플 실패(CORS)"); return; }
          const N = 80;
          const vals: number[] = [];
          for (let k = 0; k <= N; k++) {
            vals.push(rawAt(data,
              (points[0][0] + (points[1][0] - points[0][0]) * (k / N)) * cols,
              (points[0][1] + (points[1][1] - points[0][1]) * (k / N)) * rows, p.wl));
          }
          const px = (q: number[]) => `(${Math.round(q[0] * cols)},${Math.round(q[1] * rows)})`;
          setProfileData({ title: `Profile ≈픽셀값 ${px(points[0])}→${px(points[1])}`, vals });
        });
        return;
      }
      case "table2d": {
        const url = renderedUrlAt(p, p.index);
        const cols = inst.cols || 1000, rows = inst.rows || 1000;
        if (!url) return;
        void samplePixels(url, cols, rows).then((data) => {
          if (!data) { setStatus("픽셀 샘플 실패(CORS)"); return; }
          const x0 = Math.floor(Math.min(points[0][0], points[1][0]) * cols);
          const x1 = Math.ceil(Math.max(points[0][0], points[1][0]) * cols);
          const y0 = Math.floor(Math.min(points[0][1], points[1][1]) * rows);
          const y1 = Math.ceil(Math.max(points[0][1], points[1][1]) * rows);
          const step = Math.max(1, Math.ceil(Math.max(x1 - x0, y1 - y0) / 14));   // 최대 ~14×14
          const trows: string[][] = [];
          for (let y = y0; y <= y1; y += step) {
            const row: string[] = [];
            for (let x = x0; x <= x1; x += step) {
              row.push(x < 0 || y < 0 || x >= data.width || y >= data.height ? "-"
                : rawAt(data, x, y, p.wl).toFixed(0));
            }
            trows.push(row);
          }
          setTableData({ title: `2D Table ≈픽셀값 (${x0},${y0})~(${x1},${y1}) step ${step}`, rows: trows });
        });
        return;
      }
      // ── 계측 — measureAnno 가 값/단위/복합 라벨 계산 ──
      default: {
        const m = measureAnno(tk, points, inst);
        pushAnno(d, tk, points, m);
      }
    }
  };

  /* open-ended(spineCurve/poly/shutPoly) 종료 — 페인 더블클릭. 최소 점 미만이면 계속 수집 */
  const finishOpenEnded = () => {
    if (!tool || !OPEN_ENDED.has(tool) || !draft) return;
    const points = draft.points;
    const minPts = tool === "poly" ? 2 : 3;
    if (points.length < minPts) {
      setStatus(tool === "poly"
        ? "폴리라인: 2점 이상 클릭 후 더블클릭으로 종료하세요"
        : tool === "shutPoly"
          ? "다각 셔터: 3점 이상 클릭 후 더블클릭으로 종료하세요"
          : "척추 외곡: 3점 이상 클릭 후 더블클릭으로 종료하세요");
      return;
    }
    if (tool === "shutPoly") {
      patch(draft.pid, { shutter: { kind: "poly", pts: points } });
      setStatus("다각 셔터 적용 — Clr(주석 전체 삭제) 또는 Reset 으로 해제");
      setDraft(null);
      schedHist();
      return;
    }
    const p = panes[draft.pid];
    const inst = p.series?.instances.find((i) => i.sop_uid === draft.sop_uid) ?? p.series?.instances[p.index];
    const m = measureAnno(tool, points, inst);
    setAnnos((prev) => [...prev, {
      series_uid: draft.series_uid, sop_uid: draft.sop_uid, kind: tool, points,
      value: m?.value ?? null, unit: m?.unit ?? "", text: m?.text ?? "", source: "user",
    }]);
    setDraft(null);
    schedHist();   // TY-3(1): open-ended 주석 완료 — 히스토리 기록
  };

  /* S2 자동계측 CTR — AI 초안 라벨 필수 */
  const doCtr = async () => {
    setStatus("AI CTR 계측 중…");
    try {
      const r = await api.ctr(detail.id);
      const a = await api.annotations(detail.id);
      setAnnos((prev) => [...prev.filter((x) => x.kind !== "ctr"), ...a.items.filter((x) => x.kind === "ctr")]);
      schedHist();
      setStatus(r.verified && r.ctr != null
        ? `AI CTR ${r.ctr} · 신뢰도 ${(r.confidence * 100).toFixed(0)}% (초안 — 확정 아님)`
        : `CTR 검증 실패: ${r.verify_note || r.note}`);
    } catch (e) { setStatus(e instanceof Error ? e.message : "CTR 실패"); }
  };

  const saveAnnos = async () => {
    try {
      await api.saveAnnotations(detail.id, annos);
      setStatus(`주석 ${annos.length}건 저장됨 (서버)`);
    } catch { setStatus("주석 저장 실패"); }
  };

  /* GSPS 내보내기 — 주석 + 현재 W/L을 표준 Presentation State로 */
  const doGsps = async () => {
    const p = panes[activePane];
    const inst = p.series?.instances[p.index];
    if (!p.series || !inst) return;
    const findInst = (sop: string): { i: InstanceNode; s: SeriesNode } | null => {
      for (const s of series) {
        const i = s.instances.find((x) => x.sop_uid === sop);
        if (i) return { i, s };
      }
      return null;
    };
    const images = new Map<string, { sop_uid: string; series_uid: string; rows: number; cols: number }>();
    for (const a of annos) {
      if (!a.sop_uid) continue;
      const f = findInst(a.sop_uid);
      if (f) images.set(a.sop_uid, { sop_uid: a.sop_uid, series_uid: f.s.series_uid, rows: f.i.rows, cols: f.i.cols });
    }
    if (images.size === 0) {
      images.set(inst.sop_uid, { sop_uid: inst.sop_uid, series_uid: p.series.series_uid, rows: inst.rows, cols: inst.cols });
    }
    const [wc, ww] = p.wl ? p.wl.split(",").map(Number) : [null, null];
    // sop 미지정 주석(CTR 등 study 단위)은 현재 이미지에 귀속해 내보냄
    const list = annos.map((a) => a.sop_uid ? a : { ...a, sop_uid: inst.sop_uid, series_uid: p.series!.series_uid });
    try {
      await api.sendGsps(detail.id, { images: [...images.values()], annotations: list, wc, ww });
      setStatus("GSPS 저장됨 — Orthanc 동일 검사 귀속");
    } catch (e) { setStatus(e instanceof Error ? e.message : "GSPS 실패"); }
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      d.moved = true;
      // 좌=선택 모드, 우=Zoom 고정, 중=Pan 고정 (디자인 §4.2). 멀티 선택 페인이면 함께 조작 (TY-3)
      const mode = d.btn === 2 ? "zoom" : d.btn === 1 ? "pan" : mouseMode;
      const tg = targetsOf(d.pid);
      if (mode === "zoom") updMany(tg, (p) => ({ zoom: Math.max(0.2, p.zoom * (1 - dy * 0.005)) }));
      else if (mode === "pan") updMany(tg, (p) => ({ tx: p.tx + dx, ty: p.ty + dy }));
      else if (mode === "wl") {
        // 드래그 W/L — 서버 /rendered?window=C,W 라운드트립(가로=Width, 세로=Center)
        updMany(tg, (p) => {
          const cur = p.wl ? p.wl.split(",").map(Number) : null;
          const base = cur && cur.length >= 2 && !Number.isNaN(cur[0])
            ? [cur[0], cur[1]]
            : (p.series?.modality === "CT" ? [40, 400] : [128, 256]);
          const w = Math.max(1, base[1] + dx * 2);
          const c = base[0] - dy * 2;
          return { wl: `${Math.round(c)},${Math.round(w)}` };
        });
      }
    };
    const up = () => {
      if (dragRef.current?.moved) schedHist();   // 드래그 종료 시점에 히스토리 기록 (In 동일)
      dragRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mouseMode]);

  const act = (a: string) => {
    const p = panes[activePane];
    const tg = targetsOf(activePane);   // TY-3(2): 멀티 선택 페인 연동 조작
    switch (a) {
      case "invert": updMany(tg, (q) => ({ invert: !q.invert })); break;
      case "rotL": updMany(tg, (q) => ({ rot: (q.rot - 90 + 360) % 360 })); break;
      case "rotR": updMany(tg, (q) => ({ rot: (q.rot + 90) % 360 })); break;
      case "rot180": updMany(tg, (q) => ({ rot: (q.rot + 180) % 360 })); break;
      case "flipH": updMany(tg, (q) => ({ flipH: !q.flipH })); break;
      case "flipV": updMany(tg, (q) => ({ flipV: !q.flipV })); break;
      case "sharpen": updMany(tg, (q) => ({ fx: q.fx === "sharpen" ? "" : "sharpen" })); break;
      case "average": updMany(tg, (q) => ({ fx: q.fx === "smooth" ? "" : "smooth" })); break;
      case "pseudo": updMany(tg, (q) => ({ fx: q.fx === "pseudo" ? "" : "pseudo" })); break;
      case "fit": case "reset":
        updMany(tg, () => ({ zoom: 1, tx: 0, ty: 0, rot: 0, flipH: false, flipV: false,
                             ...(a === "reset" ? { invert: false, wl: "", fx: "" as const, shutter: null } : {}) }));
        break;
      case "print": window.print(); break;
      case "rfsh": void refreshExam(); break;
      case "comb": combineSeries(); break;
      case "calib": {
        // Calibrate — 픽셀 간격(PixelSpacing) 정보 안내 (In Viewer calibrate 이식)
        const inst = p.series?.instances[p.index];
        const sp = inst?.pixel_spacing;
        setStatus(sp?.length === 2
          ? `Calibrate — Pixel Spacing ${sp[0].toFixed(3)} × ${sp[1].toFixed(3)} mm (${inst!.rows}×${inst!.cols}px)`
          : "Calibrate — Pixel Spacing 정보 없음, 측정은 px 단위로 표시됩니다");
        break;
      }
      case "capture": {
        const url = renderedUrl(p);
        if (url) { const el = document.createElement("a"); el.href = url; el.download = `saintview_${Date.now()}.png`; el.click(); }
        break;
      }
      case "cine": {
        if (cineRef.current) { window.clearInterval(cineRef.current); cineRef.current = null; setCine(false); return; }
        setCine(true);
        // 간격 = viewer.prefs.ty_cine_sec (기본 0.15초). 페인별 시네 재생 중인 페인은 건너뜀(페인별 우선)
        cineRef.current = window.setInterval(() => {
          if (panesRef.current[activePane]?.playing) return;
          step(activePane, 1);
        }, Math.max(30, tyCineSec * 1000));
        break;
      }
    }
    if (HIST_OPS.has(a)) schedHist();   // TY-3(1): 원샷 시각조정 — 히스토리 기록
  };

  /* ── TY-3(6): 키이미지 등록/해제 — 현재 이미지 setKeyImages 토글 (In key2d 이식, 워크리스트 🔑 연동) ── */
  const toggleKeyImage = () => {
    const p = panes[activePane];
    const inst = p.series?.instances[p.index];
    if (!p.series || !inst) return;
    const id = openTabsRef.current.find((t) => t.uid === p.studyUid)?.id ?? detail.id;
    api.instances(id).then((r) => {
      const cur = r.key_images ?? [];
      const exists = cur.some((k) => k.sop_uid === inst.sop_uid);
      const next = exists
        ? cur.filter((k) => k.sop_uid !== inst.sop_uid)
        : [...cur, { sop_uid: inst.sop_uid, orthanc_id: inst.orthanc_id,
                     instance_number: inst.instance_number }];
      return api.setKeyImages(id, next).then(() =>
        setStatus(exists ? `🔑 키이미지 해제 — 남은 ${next.length}장`
                         : `🔑 키이미지 등록 (${next.length}장) — 워크리스트 🔑 표시`));
    }).catch(() => setStatus("키이미지 저장 실패"));
  };

  /* ── TY-3(8): 딕테이션 — MediaRecorder 녹음/재생 (검사별 세션 보관, In dictation 이식. 서버 저장은 차기) ── */
  const toggleDictation = () => {
    if (recording) { recRef.current?.stop(); return; }
    const examId = currentNavId();
    navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
      const chunks: BlobPart[] = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (ev) => chunks.push(ev.data);
      mr.onstop = () => {
        audioBlobs.current[examId] = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setStatus("🎙 녹음 저장됨 — Play 로 재생 (세션 보관)");
      };
      mr.start();
      recRef.current = mr;
      setRecording(true);
      setStatus("🎙 녹음 중… Dict 를 다시 누르면 정지");
    }).catch(() => setStatus("마이크 권한이 필요합니다"));
  };
  const playDictation = () => {
    const blob = audioBlobs.current[currentNavId()];
    if (!blob) { setStatus("이 검사의 녹음이 없습니다"); return; }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);   // 재생 종료 시 오브젝트 URL 해제(누수 방지)
    void audio.play();
  };

  /* ── TY-3(9): Compare — 같은 환자 과거검사 다중 선택 비교 오픈 (In Compare 이식, 페이지 리로드 없이).
        related_exams 만 노출하므로 환자 혼합이 원천 차단된다(다른 환자 비교는 +Add 명시 동선). ── */
  const openCompare = async () => {
    const ids = [...cmpSel].slice(0, 29);           // 3열×10행 상한(주 검사 포함 30) — LAYOUTS 범위 보장
    setCmpOpen(false);
    if (!ids.length) return;
    const n = ids.length + 1;                       // 주 검사(p0) + 선택 검사들
    const c = n <= 2 ? 2 : n <= 4 ? 2 : 3;
    const key = `${Math.ceil(n / c)}x${c}`;
    if (LAYOUTS[key]) setLayout(key as keyof typeof LAYOUTS);
    for (let i = 0; i < ids.length; i++) {
      try {
        const tree = await getTree(ids[i]);
        const s = tree.series[0];
        if (!s) continue;
        addOpenTab(ids[i], tree.uid);
        patch(PANE_IDS[i + 1], { ...initPane(tree.uid), series: s, index: Math.floor(s.instances.length / 2) });
      } catch { /* 개별 실패 무시 */ }
    }
    setXmode("sync_other");
    setStatus(`Compare — 과거검사 ${ids.length}건 비교 오픈 (SyncOther ON)`);
  };

  /* 주석/Reference line SVG 오버레이 — 이미지 콘텐츠 사각형에 정합(viewBox=픽셀 격자) */
  const annoSvg = (pid: string, p: PaneState, inst: InstanceNode) => {
    const size = paneSizes.current[pid];
    if (!size || size.w < 10 || size.h < 10) return null;
    const cols = inst.cols || 1000, rows = inst.rows || 1000;
    const cr = contentRect(size.w, size.h, cols / rows);
    const sx = (v: number) => v * cols, sy = (v: number) => v * rows;
    const fs = Math.max(cols, rows) * 0.022;
    const items = annos.filter((a) =>
      a.sop_uid === inst.sop_uid || (!a.sop_uid && p.studyUid === detail.study_uid));
    const dr = draft && draft.pid === pid ? draft : null;
    // 교차선(Scout) — 기존 Ref 토글 + TY-3(3) Crosslink scout/all_lines 모드 통합.
    // scout/Ref=활성 페인 현재 이미지 1선, all_lines=활성 시리즈 전체(현재 이미지는 진하게)
    const refSegs: { seg: [number, number][]; current: boolean }[] = [];
    if ((refOn || xmode === "scout" || xmode === "all_lines") && pid !== activePane) {
      const act = panes[activePane];
      const actInst = act.series?.instances[act.index];
      if (act.series && actInst) {
        if (xmode === "all_lines") {
          act.series.instances.forEach((si, k) => {
            if (si.sop_uid === inst.sop_uid) return;
            const seg = refLineOn(si, inst);
            if (seg) refSegs.push({ seg, current: k === act.index });
          });
        } else if (actInst.sop_uid !== inst.sop_uid) {
          const seg = refLineOn(actInst, inst);
          if (seg) refSegs.push({ seg, current: true });
        }
      }
    }
    // TY-3(4): 3D Cursor 십자 마커 — 해당 페인의 마커가 현재 이미지에 귀속될 때만
    const c3 = cross3d[pid];
    const c3on = c3 && c3.sop === inst.sop_uid;
    const sh = p.shutter;
    if (items.length === 0 && !dr && !refSegs.length && !sh && !c3on) return null;
    return (
      <svg viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none"
           style={{ position: "absolute", left: cr.left, top: cr.top, width: cr.width, height: cr.height,
                    pointerEvents: "none", overflow: "visible" }}>
        {/* 셔터 — 영역 밖 가림(evenodd, In Viewer 이식). 주석보다 아래에 렌더 */}
        {sh && sh.pts.length >= 2 && (() => {
          const outer = `M0,0 H${cols} V${rows} H0 Z`;
          let inner: string;
          const x0 = sx(sh.pts[0][0]), y0 = sy(sh.pts[0][1]);
          const x1 = sx(sh.pts[1][0]), y1 = sy(sh.pts[1][1]);
          if (sh.kind === "rect") {
            inner = `M${Math.min(x0, x1)},${Math.min(y0, y1)} H${Math.max(x0, x1)} ` +
                    `V${Math.max(y0, y1)} H${Math.min(x0, x1)} Z`;
          } else if (sh.kind === "ellipse") {
            const ecx = (x0 + x1) / 2, ecy = (y0 + y1) / 2;
            const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
            inner = `M${ecx - rx},${ecy} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0 Z`;
          } else {
            inner = "M" + sh.pts.map((q, k) => `${k ? "L" : ""}${sx(q[0])},${sy(q[1])}`).join(" ") + " Z";
          }
          return <path d={`${outer} ${inner}`} fill="#000" fillRule="evenodd" stroke="none" />;
        })()}
        {items.map((a, i) => <AnnoShape key={a.id ?? `local${i}`} a={a} sx={sx} sy={sy} fs={fs} />)}
        {dr && dr.points.map((pt, i) => (
          <circle key={i} cx={sx(pt[0])} cy={sy(pt[1])} r={fs * 0.25} fill="#ffd54a" />
        ))}
        {dr && dr.points.length >= 2 && (
          tool && FOUR_PT_TOOLS.has(tool) ? (
            // 4점 도구 초안 — 선1(p0,p1)만 잇는다(p1→p2 연결선은 오해 소지)
            <line x1={sx(dr.points[0][0])} y1={sy(dr.points[0][1])}
                  x2={sx(dr.points[1][0])} y2={sy(dr.points[1][1])}
                  stroke="#ffd54a" strokeWidth={fs * 0.08} />
          ) : (
            <polyline points={dr.points.map((q) => `${sx(q[0])},${sy(q[1])}`).join(" ")}
                      stroke="#ffd54a" fill="none" strokeWidth={fs * 0.08} />
          )
        )}
        {refSegs.map((r, i) => (
          <line key={`ref${i}`} x1={sx(r.seg[0][0])} y1={sy(r.seg[0][1])} x2={sx(r.seg[1][0])} y2={sy(r.seg[1][1])}
                stroke="#4dd0e1" strokeDasharray={`${fs * 0.6} ${fs * 0.4}`}
                strokeWidth={fs * (r.current ? 0.08 : 0.05)} opacity={r.current ? 1 : 0.35} />
        ))}
        {c3on && (
          <g stroke="#22d3ee" strokeWidth={fs * 0.1}>
            <line x1={sx(c3.x) - fs} y1={sy(c3.y)} x2={sx(c3.x) + fs} y2={sy(c3.y)} />
            <line x1={sx(c3.x)} y1={sy(c3.y) - fs} x2={sx(c3.x)} y2={sy(c3.y) + fs} />
          </g>
        )}
      </svg>
    );
  };

  /* 판독 도크 동작·상태 — components/ReportDock.tsx 로 이사(리포트 로드/저장/승인/상용구/Ctrl+S 단축키) */

  /* 닫기 동작 — 3종 선택(체크 시 기본 저장 → viewer.prefs.close_mode, Setting>뷰어) */
  const doClose = async (mode: "save_current" | "save_all" | "discard", remember: boolean) => {
    setCloseDlg(false);
    if (remember) {
      setPrefs((p) => ({ ...p, close_mode: mode }));
      api.getSetting("viewer.prefs").then((r) =>
        api.putSetting("viewer.prefs", { ...r.value, close_mode: mode }, "user")).catch(() => {});
    }
    try {
      if (mode === "save_current") {
        await api.saveAnnotations(detail.id, annos);
      } else if (mode === "save_all") {
        await api.saveAnnotations(detail.id, annos);
        await doGsps();  // 전체 변경사항 = 주석 + 표시상태(GSPS) 저장
      }
    } catch { /* 저장 실패해도 닫기는 진행 */ }
    onClose();
  };
  const requestClose = () => {
    if (prefs.close_mode === "ask") setCloseDlg(true);
    else void doClose(prefs.close_mode, false);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const closeAllTabs = () => {
    try { localStorage.removeItem(TABS_KEY); } catch { /* 무시 */ }
    setOpenTabs([]);
    requestClose();
  };

  /* 툴바 표시 여부 (Setting>뷰어>Tools bar — 계정 로밍, 기본 모두 표시) */
  const tbOn = (id: string) => prefs.toolbar?.[id] !== false;

  /* W/L 프리셋 적용 — All 모드면 모든 페인에 (UBPACS All), 아니면 활성+멀티 선택 페인 (TY-3) */
  const applyWl = (q: string) => {
    if (wlAll) {
      setPanes((prev) => Object.fromEntries(
        Object.entries(prev).map(([k, p]) => [k, { ...p, wl: q }])));
    } else {
      updMany(targetsOf(activePane), () => ({ wl: q }));
    }
    schedHist();
  };

  /* 패널 크기 영속화 (paletteW/dockW/thumbSize — 계정 로밍) */
  const persistViewerSizes = () => {
    api.getSetting("viewer.prefs").then((r) =>
      api.putSetting("viewer.prefs", {
        ...r.value, paletteW: prefsRef.current.paletteW,
        dockW: prefsRef.current.dockW, thumbSize: prefsRef.current.thumbSize,
      }, "user")).catch(() => {});
  };

  const L = LAYOUTS[layout];
  const paletteHoriz = prefs.paletteSide === "top";
  const paletteRight = prefs.paletteSide === "right";
  const thumbHoriz = prefs.thumbSide === "bottom";
  const thumbRight = prefs.thumbSide === "right";
  const ts = prefs.thumbSize;
  const tileCount = imgLay.r * imgLay.c;

  /* 페인 1개 렌더 — 경계 스플리터 뷰포트(행×열 flex) 안에서 사용.
     더블클릭=최대화/복원(spineCurve 드래프트 수집 중에는 종료 전용 — 최대화 금지), 확대경=마우스 추적 3배 렌즈 */
  const renderPane = (pid: string) => {
    const p = panes[pid];
    const url = renderedUrl(p);
    const isPrior = p.studyUid !== detail.study_uid;
    const inst = p.series?.instances[p.index];
    // 페인 테두리 — 멀티 선택=ty_sel_color 2px, 활성=ty_sel_color 1px (TY-3(2))
    const outline = selPanes.has(pid) ? `2px solid ${tySelColor}`
      : activePane === pid ? `1px solid ${tySelColor}` : "1px solid var(--border)";
    // TY-3(7): 로컬 미디어 페인 — jpg/png/bmp/avi/mp4 표시·재생 (In media 분기 이식)
    if (p.media) {
      return (
        <div onMouseDown={() => setActivePane(pid)}
             style={{ position: "relative", overflow: "hidden", minHeight: 0, minWidth: 0, flex: 1,
                      background: "#000", display: "grid", placeItems: "center", outline }}>
          {p.media.kind === "video"
            ? <video src={p.media.url} controls autoPlay loop
                     style={{ maxWidth: "100%", maxHeight: "100%" }} />
            : <img src={p.media.url} alt=""
                   style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
          <div style={{ position: "absolute", top: 4, left: 6, fontSize: 10.5, color: "var(--accent)",
                        textShadow: "0 0 3px #000", pointerEvents: "none" }}>
            📂 {p.media.name}
          </div>
          <button title="미디어 닫기 — DICOM 표시로 복귀"
                  onClick={() => { URL.revokeObjectURL(p.media!.url); patch(pid, { media: null }); }}
                  style={{ position: "absolute", top: 3, right: 4, fontSize: 11, padding: "0 6px" }}>✕</button>
        </div>
      );
    }
    return (
      <div ref={getPaneRef(pid)}
           onMouseDown={(e) => onPaneMouseDown(pid, e)}
           onMouseEnter={() => setHoverPane(pid)}
           onWheel={(e) => {
             if (tHeld.current) {  // T+스크롤 — 오버레이 글자 크기 (In Viewer 패리티, 계정 저장)
               const nf = Math.min(24, Math.max(6, tyOvFont + (e.deltaY < 0 ? 0.5 : -0.5)));
               setTyOvFont(nf);
               persistPrefsPatch({ ty_overlay_font: nf });
               return;
             }
             step(pid, e.deltaY > 0 ? 1 : -1);
           }}
           onDoubleClick={() => {
             if (tool && OPEN_ENDED.has(tool)) { finishOpenEnded(); return; }  // 수집 종료 — 최대화 충돌 회피
             if (!tool) setMaximized((m) => (m === pid ? null : pid));   // 더블클릭 = 페인 최대화/복원
           }}
           onMouseMove={(e) => {   // Magnification — 단일 이미지 페인에서 마우스 추적 (In Viewer 이식)
             if (!magOn || !inst || tileCount > 1) return;
             const r = e.currentTarget.getBoundingClientRect();
             const cols = inst.cols || 1, rows = inst.rows || 1;
             const s = Math.min(r.width / cols, r.height / rows) * p.zoom;
             if (!s) return;
             const ix = (e.clientX - (r.left + r.width / 2 + p.tx)) / s + cols / 2;
             const iy = (e.clientY - (r.top + r.height / 2 + p.ty)) / s + rows / 2;
             setMagPos({ pid, mx: e.clientX - r.left, my: e.clientY - r.top,
                         nx: ix / cols, ny: iy / rows, sc: s });
           }}
           onMouseLeave={() => { if (magOn) setMagPos(null); setHoverPane((h) => (h === pid ? null : h)); }}
           style={{ position: "relative", overflow: "hidden", minHeight: 0, minWidth: 0, flex: 1,
                    background: "#000", cursor: tool ? "copy" : "crosshair", outline }}>
        {url && (
          <div style={{
            position: "absolute", inset: 0,
            transform: `translate(${p.tx}px,${p.ty}px) scale(${p.zoom * (p.flipH ? -1 : 1)},${p.zoom * (p.flipV ? -1 : 1)}) rotate(${p.rot}deg)`,
          }}>
            {tileCount <= 1 ? (
              <>
                <img src={url} alt="" draggable={false}
                     style={{
                       width: "100%", height: "100%", objectFit: "contain", userSelect: "none",
                       filter: paneFilter(p),
                     }} />
                {inst && annoSvg(pid, p, inst)}
              </>
            ) : (
              /* Image Layout — 연속 이미지 N×M 타일 (UBPACS p.14) */
              <div style={{
                width: "100%", height: "100%", display: "grid", gap: 1,
                gridTemplateColumns: `repeat(${imgLay.c}, 1fr)`,
                gridTemplateRows: `repeat(${imgLay.r}, 1fr)`,
              }}>
                {Array.from({ length: tileCount }, (_, k) => {
                  const u = renderedUrlAt(p, p.index + k);
                  return u ? (
                    <img key={k} src={u} alt="" draggable={false}
                         style={{
                           width: "100%", height: "100%", objectFit: "contain", userSelect: "none",
                           minWidth: 0, minHeight: 0,
                           filter: paneFilter(p),
                         }} />
                  ) : <div key={k} />;
                })}
              </div>
            )}
          </div>
        )}
        {/* 확대경 렌즈 — 마우스 위치 3배 확대 (배경이미지 트릭, In Viewer 동일) */}
        {magOn && magPos && magPos.pid === pid && url && inst && tileCount <= 1 && (
          <div style={{
            position: "absolute", left: magPos.mx - 80, top: magPos.my - 80,
            width: 160, height: 160, borderRadius: "50%", zIndex: 4, pointerEvents: "none",
            border: "2px solid var(--accent)", backgroundColor: "#000", backgroundRepeat: "no-repeat",
            backgroundImage: `url(${url})`,
            backgroundSize: `${(inst.cols || 1) * magPos.sc * 3}px ${(inst.rows || 1) * magPos.sc * 3}px`,
            backgroundPosition:
              `${80 - magPos.nx * (inst.cols || 1) * magPos.sc * 3}px ` +
              `${80 - magPos.ny * (inst.rows || 1) * magPos.sc * 3}px`,
            filter: p.invert ? "invert(1)" : undefined,
          }} />
        )}
        {overlayOn && p.series && (() => {
          const meta = studyMeta[p.studyUid] ?? detail;  // 페인의 검사 기준 — 다른 환자 영상에 주검사 환자명 오표기 방지
          const priorMark = isPrior && meta.patient_key === detail.patient_key;  // 같은 환자의 과거검사만 [비교/과거]
          return (
          <>
            <div style={ov("tl", tyOvFont)}>
              {meta.patient_name} ({meta.sex})<br />
              {priorMark ? "[비교/과거] " : ""}{meta.study_desc}<br />{meta.study_date}
            </div>
            <div style={ov("tr", tyOvFont)}>
              S{p.series.series_number} {p.series.series_desc || p.series.modality}<br />
              Img: {p.index + 1}{tileCount > 1 && `~${Math.min(p.index + tileCount, p.series.instances.length)}`}/{p.series.instances.length}
            </div>
            <div style={ov("bl", tyOvFont)}>{meta.modality} · {meta.patient_key}</div>
            <div style={ov("br", tyOvFont)}>
              Z: {(p.zoom * 100).toFixed(0)}%{p.wl && <><br />W/L: {p.wl}</>}{p.fx && <><br />{p.fx}</>}
            </div>
          </>
          );
        })()}
        {/* TY-3(5): 페인별 독립 시네 — 호버(또는 재생 중) 시 ▶/⏸+간격(초) 미니 컨트롤 (In 이식) */}
        {tbOn("pcine") && p.series && p.series.instances.length > 1 && (hoverPane === pid || p.playing) && (
          <div onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
               onWheel={(e) => e.stopPropagation()}
               style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
                        zIndex: 4, display: "flex", gap: 4, alignItems: "center",
                        background: "rgba(0,0,0,0.72)", borderRadius: 6, padding: "1px 7px" }}>
            <span title={p.playing ? "Pause — 이 페인 정지 (멀티 선택 시 함께)" : "Play — 이 페인만 재생 (멀티 선택 시 함께)"}
                  style={{ cursor: "pointer", fontSize: 12.5,
                           color: p.playing ? "var(--accent)" : "var(--text-secondary)" }}
                  onClick={() => {
                    const nv = !p.playing;
                    for (const k of targetsOf(pid)) cineLastRef.current[k] = 0;
                    updMany(targetsOf(pid), () => ({ playing: nv }));
                  }}>
              {p.playing ? "⏸" : "▶"}
            </span>
            <input type="number" min={0.05} max={10} step={0.05}
                   title="이 페인의 넘김 간격(초) — 기본값은 Setting>뷰어 ty_cine_sec"
                   value={p.cineSec ?? tyCineSec}
                   onChange={(e) => updMany(targetsOf(pid), () => ({
                     cineSec: Math.min(10, Math.max(0.05, Number(e.target.value) || tyCineSec)),
                   }))}
                   style={{ width: 48, fontSize: 10, padding: "0 2px" }} />
            <span style={{ fontSize: 9.5, color: "var(--text-secondary)" }}>초</span>
          </div>
        )}
      </div>
    );
  };

  /* 팔레트 버튼 내부 — 아이콘 크기(ty_tool_size)·라벨 표시(ty_tool_labels) 개인화 반영 */
  const TyInner = ({ id, label, anatomy }: { id: string; label: string; anatomy?: boolean }) => (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1 }}>
      {anatomy ? <AnatomyIcon id={id} size={tySize} flat={!tyIcon3d} />
               : <ToolIconTy id={id} size={tySize} flat={!tyIcon3d} />}
      {tyLabels && <span style={{ fontSize: 10 }}>{label}</span>}
    </span>
  );
  const ModeBtn = ({ k, label, title }: { k: "wl" | "zoom" | "pan"; label: string; title: string }) => (
    <button onClick={() => { recordUse(k); setMouseMode(k); }} title={title}
            style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                     background: mouseMode === k ? "var(--accent)" : undefined }}>
      <TyInner id={k} label={label} />
    </button>
  );
  // 액션 → 아이콘 매핑 (UBPACS 아이콘 표)
  const ACT_ICON: Record<string, string> = {
    fit: "fit", invert: "inv", rotL: "rotL", rotR: "rotR", flipH: "flipH",
    flipV: "flipV", cine: "cine", capture: "cap", reset: "reset",
  };
  const ActBtn = ({ a, label, title, on }: { a: string; label: string; title: string; on?: boolean }) => (
    <button onClick={() => { recordUse(a); act(a); }} title={title}
            style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                     background: on ? "var(--accent)" : undefined }}>
      <TyInner id={ACT_ICON[a] ?? a} label={label} />
    </button>
  );

  /* ★ Quick 행 디스패치 — 기록된 사용 id → 실행 (툴/마우스모드/액션 공용) */
  const quickDefs: Record<string, { icon: string; label: string; anatomy?: boolean; run: () => void }> = {
    zoom: { icon: "zoom", label: "Zoom", run: () => setMouseMode("zoom") },
    pan: { icon: "pan", label: "Pan", run: () => setMouseMode("pan") },
    wl: { icon: "wl", label: "W/L", run: () => setMouseMode("wl") },
    fit: { icon: "fit", label: "Fit", run: () => act("fit") },
    invert: { icon: "inv", label: "Inv", run: () => act("invert") },
    rotL: { icon: "rotL", label: "⟲90", run: () => act("rotL") },
    rotR: { icon: "rotR", label: "⟳90", run: () => act("rotR") },
    flipH: { icon: "flipH", label: "⇋", run: () => act("flipH") },
    flipV: { icon: "flipV", label: "⇵", run: () => act("flipV") },
    cine: { icon: "cine", label: "Cine", run: () => act("cine") },
    capture: { icon: "cap", label: "Cap", run: () => act("capture") },
    reset: { icon: "reset", label: "Reset", run: () => act("reset") },
    ref: { icon: "ref", label: "Ref", run: () => setRefOn((r) => !r) },
    rot180: { icon: "rot180", label: "⟳180", run: () => act("rot180") },
    sharpen: { icon: "sharpen", label: "Shrp", run: () => act("sharpen") },
    average: { icon: "average", label: "Avg", run: () => act("average") },
    pseudo: { icon: "pseudo", label: "Psd", run: () => act("pseudo") },
    mag: { icon: "mag", label: "Mag", run: () => setMagOn((m) => { if (m) setMagPos(null); return !m; }) },
    rfsh: { icon: "rfsh", label: "Rfsh", run: () => act("rfsh") },
    comb: { icon: "comb", label: "Comb", run: () => act("comb") },
    print: { icon: "print", label: "Print", run: () => act("print") },
    calib: { icon: "calib", label: "Calib", run: () => act("calib") },
    ...Object.fromEntries([...TOOL_DEFS, ...ANATOMY_TOOL_DEFS, ...PIXEL_TOOL_DEFS, ...SHUTTER_TOOL_DEFS]
      .map(([tk, label]) => [tk, {
        icon: tk, label, anatomy: ANATOMY_TOOL_DEFS.some(([k]) => k === tk),
        run: () => { setTool(tool === tk ? null : tk); setDraft(null); },
      }])),
  };
  // 사용 상위 6개(3회 미만 비표시), ty_quick_row=false 면 행 자체를 숨김
  const quickIds = tyQuickRow
    ? Object.entries(tyUsage)
        .filter(([id, n]) => n >= 3 && quickDefs[id])
        .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id)
    : [];

  /* 팔레트(방향 전환 가능 — 요청 2) */
  const palette = paletteOpen && (
    <div style={{
      display: "flex", flexDirection: paletteHoriz ? "row" : "column", gap: 3, padding: 4,
      background: "var(--bg-panel)", flexShrink: 0, overflow: "auto", alignItems: paletteHoriz ? "center" : undefined,
      ...(paletteHoriz ? { borderBottom: "1px solid var(--border)" }
        : { width: prefs.paletteW, ...(paletteRight ? { borderLeft: "1px solid var(--border)" }
                                                    : { borderRight: "1px solid var(--border)" }) }),
    }}>
      {/* ★ Quick — 사용 상위 6개 툴 자동 추천 (ty_quick_row·ty_usage, 팔레트 최상단) */}
      {quickIds.length > 0 && (
        <div style={paletteHoriz ? { display: "flex", gap: 3, alignItems: "center" } : undefined}>
          <div title="자주 쓰는 툴 자동 추천 — 사용 3회 이상, 상위 6개 (설정>뷰어에서 끌 수 있음)"
               style={{ padding: "4px 6px", fontSize: 11, fontWeight: 700, borderRadius: 3,
                        color: "var(--accent)", background: "var(--bg-elevated)" }}>
            ★ Quick
          </div>
          <div style={{ display: paletteHoriz ? "flex" : "grid", gap: 3,
                        ...(paletteHoriz ? {} : { gridTemplateColumns: "1fr 1fr", padding: "3px 0" }) }}>
            {quickIds.map((id) => {
              const q = quickDefs[id];
              return (
                <button key={id} title={`★ ${q.label} — 사용 ${tyUsage[id]}회`}
                        onClick={() => { recordUse(id); q.run(); }}
                        style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                 background: tool === id || mouseMode === id ? "var(--accent)" : undefined }}>
                  <TyInner id={q.icon} label={q.label} anatomy={q.anatomy} />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* ◀▶ 환자 이동 — 시간대별 한 단계 (방향=Setting>정책, 열려 있으면 그 탭으로 전환) */}
      <div style={{ display: "flex", gap: 3, ...(paletteHoriz ? {} : { width: "100%" }) }}>
        <button title={`◀ ${navLeft === "past" ? "한 단계 과거" : "한 단계 최신"} 검사 — 열려 있으면 그 Exam 탭으로 (정책에서 변경)`}
                onClick={() => navPatient(-1)} disabled={navTarget(-1) === undefined}
                style={{ flex: 1, padding: "5px 0", fontSize: 13, fontWeight: 700 }}>◀</button>
        <button title={`▶ ${navLeft === "past" ? "한 단계 최신" : "한 단계 과거"} 검사 — 열려 있으면 그 Exam 탭으로 (정책에서 변경)`}
                onClick={() => navPatient(1)} disabled={navTarget(1) === undefined}
                style={{ flex: 1, padding: "5px 0", fontSize: 13, fontWeight: 700 }}>▶</button>
      </div>
      <select value={layout} onChange={(e) => setLayout(e.target.value as keyof typeof LAYOUTS)}
              style={{ fontSize: 12, width: paletteHoriz ? 76 : "100%", padding: "4px 2px" }}>
        <option value="1x1">1 X 1</option><option value="1x2">1 X 2</option><option value="2x2">2 X 2</option>
      </select>
      {/* TY-3(3): Crosslink 5모드 — off/AutoSync(같은 검사)/SyncOther(과거 포함)/Scout/AllLines (In §3.3) */}
      {tbOn("xlink") && (
        <select value={xmode} onChange={(e) => setXmode(e.target.value as XlinkMode)}
                title={`Crosslink 모드 (L 키=Off↔AutoSync 토글) — ${XLINK_MODES.map((m) => `${m.label}: ${m.desc}`).join(" · ")}`}
                style={{ fontSize: 11, width: paletteHoriz ? 86 : "100%", padding: "4px 2px",
                         background: xmode !== "off" ? "var(--accent)" : undefined,
                         color: xmode !== "off" ? "#fff" : undefined }}>
          {XLINK_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      )}
      <button style={{ padding: "6px 6px", fontSize: 12 }} onClick={() => setThumbOpen((t) => !t)}>Thumb</button>
      <button style={{ padding: "6px 6px", fontSize: 12 }} onClick={() => setPaletteOpen(false)}>Hide</button>
      {([["common", "Common"], ["anno", "Anno"], ["anatomy", "Anatomy(해부)"], ["px", "Pixel"], ["shut", "Shutter"], ["2d", "2D"], ["etc", "ETC"]] as const).map(([k, label]) => (
        <div key={k} style={paletteHoriz ? { display: "flex", gap: 3, alignItems: "center" } : undefined}>
          <div onClick={() => toggleSec(k)}
               title="클릭=섹션 접기/펼치기 (기본 전체 펼침)"
               style={{ padding: "4px 6px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                        color: openSecs.has(k) ? "var(--text-primary)" : "var(--text-secondary)",
                        background: "var(--bg-elevated)", borderRadius: 3, marginTop: 2 }}>
            {openSecs.has(k) ? "▾" : "▸"} {label}
          </div>
          {openSecs.has(k) && (
            <div style={{
              display: paletteHoriz ? "flex" : "grid", gap: 3,
              ...(paletteHoriz ? {} : { gridTemplateColumns: "1fr 1fr", padding: "3px 0" }),
            }}>
              {k === "common" && (<>
                {tbOn("zoom") && <ModeBtn k="zoom" label="Zoom" title="좌드래그=확대 (우드래그 항상 Zoom)" />}
                {tbOn("pan") && <ModeBtn k="pan" label="Pan" title="좌드래그=이동 (중드래그 항상 Pan)" />}
                {tbOn("fit") && <ActBtn a="fit" label="Fit" title="화면 맞춤" />}
                {tbOn("inv") && <ActBtn a="invert" label="Inv" title="반전" on={panes[activePane].invert} />}
                {tbOn("rotL") && <ActBtn a="rotL" label="⟲90" title="좌회전" />}
                {tbOn("rotR") && <ActBtn a="rotR" label="⟳90" title="우회전" />}
                {tbOn("rot180") && <ActBtn a="rot180" label="⟳180" title="180도 회전" />}
                {tbOn("flipH") && <ActBtn a="flipH" label="⇋" title="좌우반전" />}
                {tbOn("flipV") && <ActBtn a="flipV" label="⇵" title="상하반전" />}
                {tbOn("cine") && <ActBtn a="cine" label={cine ? "■" : "▶"} title={`시네 재생 — 간격 ${tyCineSec}초 (설정>뷰어에서 변경)`} on={cine} />}
                {tbOn("cap") && <ActBtn a="capture" label="Cap" title="PNG 저장" />}
                {tbOn("reset") && <ActBtn a="reset" label="Reset" title="초기화 (W/L·확대·필터 포함)" />}
                {tbOn("sharpen") && <ActBtn a="sharpen" label="Shrp" title="Sharpen 필터 — 윤곽 선명화 (활성 페인 토글)" on={panes[activePane].fx === "sharpen"} />}
                {tbOn("average") && <ActBtn a="average" label="Avg" title="Average 필터 — 부드럽게(블러, 활성 페인 토글)" on={panes[activePane].fx === "smooth"} />}
                {tbOn("pseudo") && <ActBtn a="pseudo" label="Psd" title="Pseudo Color — 의사색 컬러맵 근사 (활성 페인 토글)" on={panes[activePane].fx === "pseudo"} />}
                {tbOn("mag") && (
                  <button title="확대경 — 마우스 위치를 따라다니는 3배 렌즈 (다시 누르면 해제)"
                          onClick={() => { recordUse("mag"); setMagOn((m) => { if (m) setMagPos(null); return !m; }); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: magOn ? "var(--accent)" : undefined }}>
                    <TyInner id="mag" label={`Mag${magOn ? "●" : ""}`} />
                  </button>
                )}
              </>)}
              {k === "anno" && (<>
                {TOOL_DEFS.filter(([tk]) => tbOn(tk)).map(([tk, label, title]) => (
                  <button key={tk} title={title}
                          onClick={() => { recordUse(tk); setTool(tool === tk ? null : tk); setDraft(null); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: tool === tk ? "var(--accent)" : undefined }}>
                    <TyInner id={tk} label={label} />
                  </button>
                ))}
                {tbOn("ref") && (
                  <button title="Reference line — 활성 페인 평면을 다른 페인에 투영(scout)"
                          onClick={() => { recordUse("ref"); setRefOn((r) => !r); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: refOn ? "var(--accent)" : undefined }}>
                    <TyInner id="ref" label={`Ref${refOn ? "●" : ""}`} />
                  </button>
                )}
                {tbOn("cursor3d") && (
                  <button title="3D Cursor — 클릭점을 다른 페인의 동일 3D 위치로 이동+십자 마커 (기하 정보 없으면 index 비율 근사)"
                          onClick={() => { recordUse("cursor3d"); setTool(tool === "cursor3d" ? null : "cursor3d"); setDraft(null); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: tool === "cursor3d" ? "var(--accent)" : undefined }}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1 }}>
                      <span style={{ fontSize: tySize * 0.8 }}>✛</span>
                      {tyLabels && <span style={{ fontSize: 10 }}>3DC</span>}
                    </span>
                  </button>
                )}
                {tbOn("ctr") && (detail.modality === "CR" || detail.modality === "DX") && (
                  <button title="AI 심흉비 자동계측 (S2) — 초안, 확정 아님" onClick={doCtr}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   color: "var(--ai)", fontWeight: 700 }}>
                    <TyInner id="ctr" label="CTR" />
                  </button>
                )}
                {tbOn("save") && (
                  <button title="주석 서버 저장 (로밍)" onClick={saveAnnos}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <TyInner id="save" label="Save" />
                  </button>
                )}
                {tbOn("gsps") && (
                  <button title="GSPS 내보내기 — 주석·W/L 표준 저장(Orthanc)" onClick={doGsps}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <TyInner id="gsps" label="GSPS" />
                  </button>
                )}
                {tbOn("gsps") && (
                  <button title="타사 PR(GSPS) 불러오기 — 외부 주석을 녹색으로 표시" onClick={async () => {
                    try {
                      const r = await api.loadGsps(detail.id);
                      const ext = r.items.flatMap((it) => it.annotations.map((a) => ({ ...a, source: "external" as const })));
                      if (ext.length === 0) { alert("불러올 GSPS(PR)가 없습니다"); return; }
                      // 기존 외부 주석 교체(중복 방지) + 사용자/AI 주석 유지
                      setAnnos((p) => [...p.filter((x) => x.source !== "external"), ...ext]);
                      schedHist();
                    } catch (e) { alert(e instanceof Error ? e.message : "GSPS 불러오기 실패"); }
                  }} style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <TyInner id="gsps" label="PR↓" />
                  </button>
                )}
                {tbOn("rect") && (
                  <button title="HU ROI 통계 — 마지막 사각형/타원 ROI의 평균·최소·최대 HU" onClick={async () => {
                    const roi = [...annos].reverse().find((a) => (a.kind === "rect" || a.kind === "ellipse") && a.sop_uid);
                    if (!roi) { alert("먼저 사각형 또는 타원 ROI를 그리세요"); return; }
                    try {
                      const s = await api.roiStats(detail.id, { sop_uid: roi.sop_uid, kind: roi.kind, points: roi.points });
                      if (s.error) { alert(s.error); return; }
                      alert(`HU ROI 통계 (${s.count}px${s.area_mm2 ? `, ${s.area_mm2}mm²` : ""})\n평균 ${s.mean} · 최소 ${s.min} · 최대 ${s.max} · 표준편차 ${s.std} (${s.unit})`);
                    } catch (e) { alert(e instanceof Error ? e.message : "ROI 통계 실패"); }
                  }} style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <TyInner id="rect" label="HU" />
                  </button>
                )}
                {tbOn("del") && (
                  <button title="마지막 주석 삭제" onClick={() => { setAnnos((p) => p.slice(0, -1)); schedHist(); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <TyInner id="del" label="Del" />
                  </button>
                )}
                {tbOn("clr") && (
                  <button title="주석·셔터 전체 삭제 (In Viewer 🧹 동일 — 측정/주석/셔터 일괄)" onClick={() => {
                    if (window.confirm(`주석 ${annos.length}건과 셔터를 모두 삭제할까요? (저장 전이면 복구 불가)`)) {
                      setAnnos([]);
                      setDraft(null);
                      setCross3d({});   // 3D Cursor 마커도 함께 해제 (In clrAnno 동일)
                      setPanes((prev) => Object.fromEntries(
                        Object.entries(prev).map(([k, q]) => [k, { ...q, shutter: null }])));
                      schedHist();
                    }
                  }} style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <TyInner id="clr" label="Clr" />
                  </button>
                )}
              </>)}
              {k === "anatomy" && (<>
                {ANATOMY_TOOL_DEFS.filter(([tk]) => tbOn(tk)).map(([tk, label, title]) => (
                  <button key={tk} title={title}
                          onClick={() => { recordUse(tk); setTool(tool === tk ? null : tk); setDraft(null); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: tool === tk ? "var(--accent)" : undefined }}>
                    <TyInner id={tk} label={label} anatomy />
                  </button>
                ))}
              </>)}
              {k === "px" && (<>
                {PIXEL_TOOL_DEFS.filter(([tk]) => tbOn(tk)).map(([tk, label, title]) => (
                  <button key={tk} title={title}
                          onClick={() => { recordUse(tk); setTool(tool === tk ? null : tk); setDraft(null); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: tool === tk ? "var(--accent)" : undefined }}>
                    <TyInner id={tk} label={label} />
                  </button>
                ))}
              </>)}
              {k === "shut" && (<>
                {SHUTTER_TOOL_DEFS.filter(([tk]) => tbOn(tk)).map(([tk, label, title]) => (
                  <button key={tk} title={title}
                          onClick={() => { recordUse(tk); setTool(tool === tk ? null : tk); setDraft(null); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: tool === tk ? "var(--accent)" : undefined }}>
                    <TyInner id={tk} label={label} />
                  </button>
                ))}
              </>)}
              {k === "2d" && (<>
                <button title="All — W/L 프리셋을 모든 페인(전체 이미지)에 적용 (UBPACS All)"
                        onClick={() => setWlAll((a) => !a)}
                        style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                 background: wlAll ? "var(--accent)" : undefined, fontWeight: 700 }}>
                  <TyInner id="all" label={`All${wlAll ? "●" : ""}`} />
                </button>
                {prefs.wl_presets.map((pr) => (
                  <button key={pr.key} title={`W/L ${pr.q || "기본"} (Presetting — 설정>뷰어에서 편집)`}
                          onClick={() => applyWl(pr.q)}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: panes[activePane].wl === pr.q ? "var(--accent)" : undefined }}>
                    <TyInner id="wl" label={pr.label} />
                  </button>
                ))}
              </>)}
              {k === "etc" && (<>
                {tbOn("ohif") && ohifOn && (
                  <button style={{ padding: "6px 4px", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}
                          onClick={() => openViewer(detail.study_uid)}>
                    <TyInner id="ohif" label="OHIF" />
                  </button>
                )}
                {tbOn("3d") && (
                  <button title="내장 MPR/MIP — 현재 검사를 Axial/Sagittal/Coronal+MIP로 (새 창 없음)"
                          onClick={() => setMprOn((m) => !m)}
                          style={{ padding: "6px 4px", fontSize: 12, fontWeight: 700, width: paletteHoriz ? 60 : "100%",
                                   background: mprOn ? "var(--accent)" : undefined }}>
                    <TyInner id="mpr" label={`MPR${mprOn ? "●" : ""}`} />
                  </button>
                )}
                {tbOn("rfsh") && <ActBtn a="rfsh" label="Rfsh" title="Refresh Exam — 활성 검사 시리즈 재조회" />}
                {tbOn("comb") && <ActBtn a="comb" label="Comb" title="Combine Series — 같은 검사의 모든 시리즈를 한 스택으로 결합" />}
                {tbOn("print") && <ActBtn a="print" label="Print" title="인쇄 — 현재 화면을 브라우저 인쇄(window.print)" />}
                {tbOn("calib") && <ActBtn a="calib" label="Calib" title="Calibrate — 현재 이미지 Pixel Spacing 정보 안내" />}
                {tbOn("key2d") && (
                  <button title="Key — 현재 이미지를 키이미지로 등록/해제 (워크리스트 🔑·Key Image View 연동)"
                          onClick={() => { recordUse("key2d"); toggleKeyImage(); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1 }}>
                      <span style={{ fontSize: tySize * 0.8 }}>🔑</span>
                      {tyLabels && <span style={{ fontSize: 10 }}>Key</span>}
                    </span>
                  </button>
                )}
                {tbOn("media") && (
                  <button title="Media — 로컬 이미지(JPG/PNG/BMP)·동영상(AVI/MP4)을 활성 페인에 표시/재생"
                          onClick={() => { recordUse("media"); mediaInputRef.current?.click(); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1 }}>
                      <span style={{ fontSize: tySize * 0.8 }}>🎞</span>
                      {tyLabels && <span style={{ fontSize: 10 }}>Media</span>}
                    </span>
                  </button>
                )}
                {tbOn("dict") && (
                  <button title="Dictation — 음성 녹음 시작/정지 (검사별 세션 보관, 서버 저장은 차기)"
                          onClick={() => { recordUse("dict"); toggleDictation(); }}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%",
                                   background: recording ? "var(--accent)" : undefined }}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1 }}>
                      <span style={{ fontSize: tySize * 0.8 }}>🎙</span>
                      {tyLabels && <span style={{ fontSize: 10 }}>{recording ? "Rec●" : "Dict"}</span>}
                    </span>
                  </button>
                )}
                {tbOn("dict") && (
                  <button title="Play Dictation — 이 검사의 녹음 재생"
                          onClick={playDictation}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1 }}>
                      <span style={{ fontSize: tySize * 0.8 }}>🔊</span>
                      {tyLabels && <span style={{ fontSize: 10 }}>Play</span>}
                    </span>
                  </button>
                )}
              </>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  /* 썸네일(방향·크기·모드 — 요청 2): series 모드=시리즈 카드+선택 전개 / all 모드=전체 개별 나열
     — 활성 페인의 '검사' 기준 목록: Exam 탭 전환 시 이전 환자 시리즈가 남는 버그 수정.
       Stack View 로 병합([중첩])된 검사는 병합 목록을 유지한다. */
  const activeUid = panes[activePane].studyUid || detail.study_uid;
  const thumbSeries = useMemo(() => {
    if (activeUid === detail.study_uid) return series;
    const tree = Object.values(priorTrees).find((t) => t.uid === activeUid);
    if (!tree || !tree.series.length) return series;
    const merged = tree.series.some((ts) => series.some((s) => s.series_uid === ts.series_uid));
    return merged ? series : tree.series;
  }, [activeUid, series, priorTrees, detail.study_uid]);
  const allInstances = useMemo(
    () => thumbSeries.flatMap((s) => s.instances.map((i, idx) => ({ s, i, idx }))),
    [thumbSeries],
  );
  const thumbs = thumbOpen && (
    <div style={{
      display: "flex", flexDirection: thumbHoriz ? "row" : "column", gap: 4, padding: 4,
      background: "var(--bg-panel)", overflow: "auto", flexShrink: 0,
      ...(thumbHoriz ? { borderTop: "1px solid var(--border)", height: ts + 34 }
        : { width: ts + 34, ...(thumbRight ? { borderLeft: "1px solid var(--border)" }
                                           : { borderRight: "1px solid var(--border)" }) }),
    }}>
      {prefs.thumbMode === "series" ? thumbSeries.map((s) => (
        <div key={s.series_uid} style={{ flexShrink: 0 }}>
          <div onClick={() => setSelSeries(selSeries === s.series_uid ? null : s.series_uid)}
               onDoubleClick={() => patch(activePane, { ...initPane(uidOfSeries(s.series_uid)), series: s, index: Math.floor(s.instances.length / 2) })}
               title={`${s.series_desc || s.modality} — 더블클릭: 활성 페인 로드`}
               style={{ border: selSeries === s.series_uid ? "2px solid var(--accent)" : "1px solid var(--border)",
                        borderRadius: 4, overflow: "hidden", cursor: "pointer", position: "relative", width: ts }}>
            {s.instances[Math.floor(s.instances.length / 2)] && (
              <img src={s.instances[Math.floor(s.instances.length / 2)].preview_url} alt=""
                   style={{ width: ts, height: ts * 0.78, objectFit: "cover", display: "block" }} />
            )}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, fontSize: 9,
                          background: "rgba(0,0,0,0.65)", padding: "1px 3px" }}>
              S{s.series_number}·{s.instances.length}장
            </div>
          </div>
          {selSeries === s.series_uid && (
            <div style={{ display: "flex", flexDirection: thumbHoriz ? "row" : "column", gap: 2, padding: 2 }}>
              {s.instances.slice(0, 60).map((inst, idx) => (
                <img key={inst.sop_uid} src={inst.preview_url} alt="" title={`Img ${inst.instance_number}`}
                     onClick={() => patch(activePane, { studyUid: uidOfSeries(s.series_uid), series: s, index: idx })}
                     style={{ width: ts * 0.6, height: ts * 0.45, objectFit: "cover", borderRadius: 2, cursor: "pointer", flexShrink: 0,
                              border: panes[activePane].series?.series_uid === s.series_uid && panes[activePane].index === idx
                                ? "2px solid var(--anno-keyimage)" : "1px solid var(--border)" }} />
              ))}
            </div>
          )}
        </div>
      )) : allInstances.slice(0, 200).map(({ s, i, idx }) => (
        <img key={i.sop_uid} src={i.preview_url} alt="" title={`S${s.series_number} Img${i.instance_number}`}
             onClick={() => patch(activePane, { studyUid: uidOfSeries(s.series_uid), series: s, index: idx })}
             style={{ width: ts * 0.8, height: ts * 0.6, objectFit: "cover", borderRadius: 2, cursor: "pointer", flexShrink: 0,
                      border: "1px solid var(--border)" }} />
      ))}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200, display: "flex", flexDirection: "column" }}
         onContextMenu={(e) => e.preventDefault()}>
      {/* Sharpen 필터 정의 (feConvolveMatrix — In Viewer 동일 커널) */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="ty-sharpen">
          <feConvolveMatrix order="3" kernelMatrix="0 -1 0 -1 5 -1 0 -1 0" preserveAlpha="true" />
        </filter>
      </svg>
      {/* 상단 검사탭 바 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                    background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
        <button onClick={requestClose} style={{ fontWeight: 700 }}>WORKLIST</button>
        {/* 좌상단: Series Layout(뷰포트 분할) · Image Layout(페인 내 이미지 타일) — UBPACS p.14 */}
        <GridPicker label="Srs" max={10}
                    value={{ r: LAYOUTS[layout].rows, c: LAYOUTS[layout].cols }}
                    onPick={(v) => setLayout(`${v.r}x${v.c}`)} />
        <GridPicker label="Img" max={10} value={imgLay} onPick={setImgLay} />
        {/* 오픈 검사 탭 — 좌→우로 쌓임. 클릭=활성 페인에 표시, ✕=닫기(주 검사로 복귀) */}
        <div style={{ display: "flex", gap: 2, alignSelf: "flex-end", overflowX: "auto", maxWidth: "55%" }}>
          {openTabs.map((t) => {
            const isActive = panes[activePane].studyUid === t.uid;
            return (
              <div key={t.id}
                   onClick={() => {
                     void loadIntoActive(t.id);
                     postStudySync(t.id, "viewer");  // Worklist·Reading 선택 동기
                   }}
                   title={t.id === detail.id ? "주 검사" : "클릭=활성 페인에 표시"}
                   style={{
                     display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                     background: isActive ? "var(--accent)" : "var(--bg-elevated)",
                     color: isActive ? "#fff" : "var(--text-secondary)",
                     borderRadius: "4px 4px 0 0", padding: "4px 11px", fontSize: 11.5,
                     fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", borderBottom: "none",
                   }}>
                {t.label}
                <span title={t.id === detail.id ? "주 검사 닫기 = 뷰어 닫기" : "이 Exam 닫기"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (t.id === detail.id) requestClose();
                        else closeTab(t.id);
                      }}
                      style={{ fontSize: 10, opacity: 0.75 }}>✕</span>
              </div>
            );
          })}
        </div>
        {status && <span style={{ fontSize: 11.5, color: "var(--stat-emergency)" }}>{status}</span>}
        <div style={{ flex: 1 }} />
        {/* TY-3(1): 작업 히스토리 — ◀ Undo · ◯ 초기 상태 · ▶ Redo (시각조정+주석 스냅샷 최대 50) */}
        {tbOn("hist") && (
          <span style={{ display: "flex", gap: 2, alignItems: "center" }} data-hist-tick={histTick}>
            <button title="Undo — 이전 작업 상태로 (시각조정·주석 스냅샷)" onClick={() => histGo(-1)}
                    disabled={histIdx.current <= 0} style={{ padding: "3px 9px", fontWeight: 700 }}>◀</button>
            <button title="초기 상태로 되돌리기 — 모든 조정/주석을 처음으로" onClick={histReset}
                    disabled={histIdx.current < 0}
                    style={{ width: 26, height: 24, borderRadius: "50%", padding: 0,
                             display: "grid", placeItems: "center", fontSize: 11 }}>◯</button>
            <button title="Redo — 다음 작업 상태로" onClick={() => histGo(1)}
                    disabled={histIdx.current >= histRef.current.length - 1}
                    style={{ padding: "3px 9px", fontWeight: 700 }}>▶</button>
          </span>
        )}
        {/* TY-3(9): Compare — 같은 환자 과거검사 다중 선택 비교 (Related [+Add] 와 별개 진입점) */}
        {tbOn("cmp") && (
          <button title="Compare — 같은 환자의 과거검사를 골라 나란히 비교 (동기 스크롤 ON)"
                  onClick={() => { setCmpSel(new Set()); setCmpOpen(true); }}
                  style={{ fontWeight: 700 }}>⇄</button>
        )}
        {/* TY-3(7): 로컬 미디어 파일 선택 (팔레트 ETC>Media 버튼에서 오픈) */}
        <input ref={mediaInputRef} type="file" hidden
               accept="image/*,video/*,.bmp,.avi,.mpg,.mpeg,.mp4"
               onChange={(e) => {
                 const f = e.target.files?.[0];
                 if (!f) return;
                 const kind = f.type.startsWith("video") || /\.(avi|mpe?g|mp4|mov)$/i.test(f.name)
                   ? "video" as const : "image" as const;
                 // 같은 페인의 기존 미디어 URL은 교체 전에 해제(오브젝트 URL 누수 방지)
                 const old = panesRef.current[activePane]?.media?.url;
                 if (old) URL.revokeObjectURL(old);
                 patch(activePane, { media: { url: URL.createObjectURL(f), kind, name: f.name } });
                 e.target.value = "";
               }} />
        <button onClick={() => setSettingsOpen(true)} title="설정 — 뷰어에서 바로 Setting 진입">Settings</button>
        <button title="Reading — 전용 판독 창(새 페이지) 열기 · 모니터 배치는 Setting>모니터"
                onClick={() => {
                  const rm = prefs.monitor?.report;
                  void screenFeatures(rm != null ? [rm] : null, "width=440,height=1020").then((features) => {
                    const w = window.open(
                      `${window.location.origin}${window.location.pathname}?report=1&study=${detail.id}`,
                      "sv_report", features);
                    w?.focus();
                  });
                }}>
          Reading
        </button>
        <button onClick={toggleOverlay} title="오버레이 표시 토글 (T+Del) · 글자 크기는 T+마우스스크롤 — 계정 저장">
          {overlayOn ? "INFO ●" : "INFO ○"}
        </button>
        <button onClick={closeAllTabs} className="primary"
                title={`All Close — 모든 Exam 탭을 닫고 뷰어 종료. 저장 동작: ${
                  prefs.close_mode === "ask" ? "항상 묻기"
                  : prefs.close_mode === "save_current" ? "현재 화면 저장"
                  : prefs.close_mode === "save_all" ? "전체 저장" : "저장 안 함"} (Setting>뷰어)`}
                style={{ fontWeight: 700 }}>
          All Close ✕
        </button>
      </div>

      {/* Study/Series Titlebar (UBPACS p.14·p.16 — Opened/Related/Series/HP 드롭다운) */}
      <div style={{
        display: "flex", gap: 8, alignItems: "center", padding: "2px 10px",
        background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)",
        fontSize: 11, color: "var(--text-secondary)", flexShrink: 0,
      }}>
        <TitleMenu id="opened" icon="▤" title="Opened Study List — 열린 검사 전환 · 항목 ✕=그 Exam 탭만 닫기"
                   menu={menu} setMenu={setMenu}
                   items={openTabs.map((t) => ({
                     label: t.label,
                     sub: tabSub(t.id),
                     active: t.uid === panes[activePane].studyUid,
                     onClick: () => void loadIntoActive(t.id),
                     onClose: () => { if (t.id === detail.id) requestClose(); else closeTab(t.id); },
                   }))} />
        <TitleMenu id="related" icon="🗂" title="Related Study List — Open=활성 페인 비교 · +Add=현재 유지+중첩 로드"
                   menu={menu} setMenu={setMenu}
                   items={detail.related_exams.map((e) => ({
                     label: `${e.modality} · ${e.study_date} · ${e.study_desc}`,
                     sub: `${e.status} / ${detail.patient_key}`,
                     chip: STAT_COLOR[e.status] ?? "var(--stat-received)",
                     onClick: () => void loadPrior(e.id),
                     actions: [
                       { label: "Open", title: "활성 페인에 비교 로드 (1x1이면 자동 1x2)", onClick: () => void loadPrior(e.id) },
                       { label: "+Add", title: "현재 화면 유지 + 이 검사를 중첩 로드(Stack View)", onClick: () => void loadStack(e.id) },
                     ],
                   }))} />
        <TitleMenu id="series" icon="≣" title="Open Series — 시리즈 전환 (●=현재 시리즈)" menu={menu} setMenu={setMenu}
                   items={thumbSeries.map((s) => ({
                     label: `S${s.series_number} ${s.series_desc || s.modality} (${s.instances.length}장)`,
                     active: panes[activePane].series?.series_uid === s.series_uid,
                     onClick: () => patch(activePane, {
                       ...initPane(uidOfSeries(s.series_uid)), series: s, index: Math.floor(s.instances.length / 2),
                     }),
                   }))} />
        <TitleMenu id="hp" icon={`HP:${hpName}`} title="Hanging Protocol — 설정>행잉(HP)에서 규칙 관리" menu={menu} setMenu={setMenu}
                   items={[
                     { label: "기본 (HP 해제)", onClick: () => { setHpName("기본"); setImgLay({ r: 1, c: 1 }); setLayout("1x1"); } },
                     ...hpRules.map((r) => ({
                       label: `${r.name} — ${r.modality || "*"}/${r.body_part || "*"}/${r.projection || "*"} · S${r.s.r}×${r.s.c} I${r.i.r}×${r.i.c}${r.wl ? ` · W/L ${r.wl}` : ""}`,
                       onClick: () => applyHp(r),
                     })),
                   ]} />
        <span>[{panes[activePane].index + 1}/{panes[activePane].series?.instances.length ?? 0}]</span>
        <span style={{ color: "var(--text-primary)" }}>
          {detail.status.toUpperCase()}, {detail.patient_name}, {detail.modality}, {detail.study_date}, {detail.study_desc}
        </span>
        {panes[activePane].series && (
          <span>
            │ Srs:{panes[activePane].series!.series_number} {panes[activePane].series!.series_desc || panes[activePane].series!.modality}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span>Series {LAYOUTS[layout].rows}×{LAYOUTS[layout].cols} · Image {imgLay.r}×{imgLay.c}</span>
      </div>

      {paletteHoriz && palette}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {prefs.paletteSide === "left" && palette}
        {prefs.paletteSide === "left" && paletteOpen && (
          <Splitter dir="v" onEnd={persistViewerSizes}
                    onDrag={(dx) => setPrefs((p) => ({ ...p, paletteW: clampSz(p.paletteW + dx, 64, 240) }))} />
        )}
        {!paletteOpen && prefs.paletteSide === "left" && (
          <button onClick={() => setPaletteOpen(true)} style={{ width: 18, borderRadius: 0, padding: 0 }}>▸</button>
        )}
        {prefs.thumbSide === "left" && thumbs}
        {prefs.thumbSide === "left" && thumbOpen && (
          <Splitter dir="v" onEnd={persistViewerSizes}
                    onDrag={(dx) => setPrefs((p) => ({ ...p, thumbSize: clampSz(p.thumbSize + dx, 48, 260) }))} />
        )}

        {/* 뷰포트 영역 — MPR 모드면 내장 3D(Axial/Sagittal/Coronal+MIP)로 전환 */}
        {mprOn ? (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
            <Suspense fallback={
              <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-secondary)" }}>
                MPR/MIP 로딩…
              </div>
            }>
              <Viewer3DEmbed studyUid={panes[activePane].studyUid || detail.study_uid}
                             embedded onClose={() => setMprOn(false)} />
            </Suspense>
          </div>
        ) : (
        <div ref={vpRef} style={{ flex: 1, display: "flex", flexDirection: "column",
                                  minWidth: 0, minHeight: 0, padding: 2 }}>
          {/* 최대화 시 그 페인만 전체 표시. 평시엔 행×열 flex — 페인 경계 Splitter 로 크기 조절 */}
          {(maximized !== null
            ? [[maximized]]
            : Array.from({ length: L.rows }, (_, ri) =>
                Array.from({ length: L.cols }, (_, ci) => PANE_IDS[ri * L.cols + ci]))
          ).map((rowPids, ri) => (
            <Fragment key={ri}>
              {ri > 0 && (
                <Splitter dir="h" onEnd={() => {}}
                          onDrag={(dy) => adjFr(setRowFr, ri - 1, dy, vpRef.current?.clientHeight ?? 600)} />
              )}
              <div style={{ display: "flex", flex: maximized !== null ? 1 : (rowFr[ri] ?? 1),
                            minHeight: 0, minWidth: 0 }}>
                {rowPids.map((pid, ci) => (
                  <Fragment key={pid}>
                    {ci > 0 && (
                      <Splitter dir="v" onEnd={() => {}}
                                onDrag={(dx) => adjFr(setColFr, ci - 1, dx, vpRef.current?.clientWidth ?? 800)} />
                    )}
                    <div style={{ flex: maximized !== null ? 1 : (colFr[ci] ?? 1),
                                  minWidth: 0, minHeight: 0, display: "flex" }}>
                      {renderPane(pid)}
                    </div>
                  </Fragment>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
        )}

        {thumbRight && thumbOpen && (
          <Splitter dir="v" onEnd={persistViewerSizes}
                    onDrag={(dx) => setPrefs((p) => ({ ...p, thumbSize: clampSz(p.thumbSize - dx, 48, 260) }))} />
        )}
        {thumbRight && thumbs}
        {paletteRight && paletteOpen && (
          <Splitter dir="v" onEnd={persistViewerSizes}
                    onDrag={(dx) => setPrefs((p) => ({ ...p, paletteW: clampSz(p.paletteW - dx, 64, 240) }))} />
        )}
        {paletteRight && palette}
        {!paletteOpen && paletteRight && (
          <button onClick={() => setPaletteOpen(true)} style={{ width: 18, borderRadius: 0, padding: 0 }}>◂</button>
        )}
        {prefs.reportDock && (
          <Splitter dir="v" onEnd={persistViewerSizes}
                    onDrag={(dx) => setPrefs((p) => ({ ...p, dockW: clampSz(p.dockW - dx, 180, 480) }))} />
        )}
        {/* 판독 도크 — 공유 컴포넌트 (리포트 로드/저장/승인/상용구/단축키 내장) */}
        {prefs.reportDock && (
          <ReportDock detail={detail} width={prefs.dockW}
                      onLoadPrior={(id) => void loadPrior(id)} onStatus={setStatus} />
        )}
      </div>
      {thumbHoriz && thumbs}
      {/* ── Profile — 두 점 선의 픽셀값 그래프 모달 (In Viewer 이식, ≈근사값) ── */}
      {profileData && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 500,
                      display: "grid", placeItems: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setProfileData(null); }}>
          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
                        padding: 14, maxWidth: "90vw", maxHeight: "85vh", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 10 }}>
              <b style={{ fontSize: 12.5 }}>📈 {profileData.title}</b>
              <button style={{ marginLeft: "auto" }} onClick={() => setProfileData(null)}>✕</button>
            </div>
            {(() => {
              const vals = profileData.vals;
              const W = 440, H = 150, PAD = 6;
              const mn = Math.min(...vals), mx = Math.max(...vals);
              const pl = vals.map((v, k) =>
                `${PAD + (k / Math.max(1, vals.length - 1)) * W},` +
                `${PAD + H - ((v - mn) / Math.max(1, mx - mn)) * H}`).join(" ");
              return (
                <>
                  <svg width={W + PAD * 2} height={H + PAD * 2}
                       style={{ background: "#000", border: "1px solid var(--border)", display: "block" }}>
                    <polyline points={pl} stroke="#facc15" strokeWidth={1.4} fill="none" />
                  </svg>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
                    min {mn.toFixed(0)} · max {mx.toFixed(0)} · {vals.length}표본
                    (≈근사값 — 렌더 8bit + W/L 역변환, 원본 픽셀 아님)
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
      {/* ── 2D Table — 두 점 영역 픽셀값 표 모달 (In Viewer 이식, ≈근사값) ── */}
      {tableData && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 500,
                      display: "grid", placeItems: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setTableData(null); }}>
          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
                        padding: 14, maxWidth: "90vw", maxHeight: "85vh", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 10 }}>
              <b style={{ fontSize: 12.5 }}>▤ {tableData.title}</b>
              <button style={{ marginLeft: "auto" }} onClick={() => setTableData(null)}>✕</button>
            </div>
            <table style={{ borderCollapse: "collapse", fontSize: 10.5, fontFamily: "monospace" }}>
              <tbody>
                {tableData.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((v, ci) => (
                      <td key={ci} style={{ border: "1px solid var(--border)", padding: "1px 5px",
                                            textAlign: "right", color: "var(--text-secondary)" }}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
              ≈근사값 — 렌더 8bit + W/L 역변환, 원본 픽셀 아님
            </div>
          </div>
        </div>
      )}
      {/* ── TY-3(9): Compare — 같은 환자 과거검사 다중 선택 → 나란히 비교 (In Compare 이식) ── */}
      {cmpOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 500,
                      display: "grid", placeItems: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setCmpOpen(false); }}>
          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
                        width: "min(560px, 94vw)", maxHeight: "80vh", overflow: "auto", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <b style={{ fontSize: 13 }}>⇄ Compare — {detail.patient_name} 의 과거검사</b>
              <button style={{ marginLeft: "auto" }} onClick={() => setCmpOpen(false)}>✕</button>
            </div>
            {(detail.related_exams ?? []).length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: 8 }}>
                이 환자의 과거검사가 없습니다.<br />
                다른 환자와 비교하려면 워크리스트의 <b>＋Add</b> 버튼을 사용하세요(명시적 비교 — 환자 혼합 방지).
              </div>
            )}
            {(detail.related_exams ?? []).map((re) => (
              <label key={re.id}
                     style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 6px",
                              borderRadius: 4, fontSize: 12.5, cursor: "pointer",
                              background: cmpSel.has(re.id) ? "var(--bg-elevated)" : undefined }}>
                <input type="checkbox" checked={cmpSel.has(re.id)}
                       onChange={(e) => setCmpSel((s) => {
                         const n = new Set(s);
                         if (e.target.checked) n.add(re.id); else n.delete(re.id);
                         return n;
                       })} />
                <span style={{ width: 78 }}>{re.study_date}</span>
                <span style={{ width: 36 }}>{re.modality}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {re.study_desc}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{re.status}</span>
              </label>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="primary" disabled={!cmpSel.size} onClick={() => void openCompare()}>
                비교 열기 ({cmpSel.size}건)
              </button>
              <button onClick={() => setCmpOpen(false)}>취소</button>
            </div>
          </div>
        </div>
      )}
      {closeDlg && (
        <CloseDialog onPick={(m, r) => void doClose(m, r)} onCancel={() => setCloseDlg(false)} />
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModalLazy
            role={localStorage.getItem("sv_role") ?? sessionStorage.getItem("sv_role") ?? "radiologist"}
            onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

/* 닫기 옵션 다이얼로그 — 체크박스 선택 시 해당 동작이 기본이 되어 다음부터 묻지 않음 (Setting>뷰어 저장) */
function CloseDialog({ onPick, onCancel }: {
  onPick: (mode: "save_current" | "save_all" | "discard", remember: boolean) => void;
  onCancel: () => void;
}) {
  const [chk, setChk] = useState<Record<string, boolean>>({});
  const Row = ({ mode, label, desc, primary }: {
    mode: "save_current" | "save_all" | "discard"; label: string; desc: string; primary?: boolean;
  }) => (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <button className={primary ? "primary" : ""} onClick={() => onPick(mode, !!chk[mode])}
              style={{ flex: 1, textAlign: "left", padding: "8px 12px" }}>
        <b style={{ fontSize: 12.5 }}>{label}</b>
        <div style={{ fontSize: 11, color: primary ? undefined : "var(--text-secondary)", marginTop: 2 }}>{desc}</div>
      </button>
      <label title="체크하고 닫으면 다음부터 묻지 않고 이 동작으로 닫습니다 (Setting>뷰어>닫기 동작에서 변경)"
             style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, color: "var(--text-secondary)", flexShrink: 0 }}>
        <input type="checkbox" checked={!!chk[mode]}
               onChange={(e) => setChk((p) => ({ ...p, [mode]: e.target.checked }))} />
        기본으로
      </label>
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 500 }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
                    width: 430, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 13 }}>뷰어 닫기 — 변경사항을 저장할까요?</b>
        <Row mode="save_current" primary label="현재 화면 저장하고 닫기"
             desc="현재 검사의 주석/측정을 서버에 저장합니다" />
        <Row mode="save_all" label="전체 화면 변경사항 저장하고 닫기"
             desc="주석/측정 저장 + 표시 상태(W/L·주석)를 GSPS로 Orthanc에 보존합니다" />
        <Row mode="discard" label="어떤 것도 저장하지 않고 닫기"
             desc="저장하지 않은 주석/측정은 사라집니다" />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onCancel}>취소 (계속 판독)</button>
        </div>
      </div>
    </div>
  );
}

/* 타이틀바 드롭다운 메뉴 (Opened/Related/Series/HP — UBPACS p.16)
   기능 강화: 히트영역·아이콘 약 1.4배, 항목 수 배지, 부제(modality·날짜)/상태 색 칩,
   항목별 ✕(Exam 탭 닫기)·[Open]/[+Add] 액션, 호버 하이라이트, Esc(뷰어 키 핸들러)·외부클릭 닫기 */
type TitleMenuItem = {
  label: string;
  sub?: string;                       // 부제 — modality · 검사일 등
  active?: boolean;                   // ● 현재 항목 표시
  chip?: string;                      // 상태 색 칩 (CSS 색상)
  onClick?: () => void;               // 항목 클릭 기본 동작
  onClose?: () => void;               // 항목별 ✕ — 그 Exam 탭만 닫기
  actions?: { label: string; title?: string; onClick: () => void }[];  // [Open]/[+Add]
};
function TitleMenu({ id, icon, title, items, menu, setMenu }: {
  id: "opened" | "related" | "series" | "hp";
  icon: string; title: string;
  items: TitleMenuItem[];
  menu: string | null;
  setMenu: (m: "opened" | "related" | "series" | "hp" | null) => void;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const open = menu === id;
  // 외부 클릭 닫기 — Esc 는 뷰어 전역 키 핸들러가 menu 우선으로 처리
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, setMenu]);
  return (
    <span ref={wrapRef} style={{ position: "relative" }}>
      <button onClick={() => setMenu(open ? null : id)} title={title}
              style={{ padding: "3px 10px", fontSize: 15.5, display: "inline-flex", alignItems: "center",
                       gap: 5, background: open ? "var(--accent)" : undefined }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: 700, padding: "0 5px", borderRadius: 8, lineHeight: "14px",
                       background: open ? "rgba(255,255,255,0.25)" : "var(--bg-elevated)",
                       color: open ? "#fff" : "var(--text-secondary)", border: "1px solid var(--border)" }}>
          {items.length}
        </span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 360, minWidth: 280, maxHeight: 320,
          overflow: "auto", background: "var(--bg-elevated)", border: "1px solid var(--border)",
          borderRadius: 5, boxShadow: "0 6px 20px rgba(0,0,0,0.5)", padding: "3px 0",
        }}>
          {items.map((it, i) => (
            <div key={i}
                 onClick={() => { if (it.onClick) { it.onClick(); setMenu(null); } }}
                 style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 12px",
                          fontSize: 11.5, cursor: it.onClick ? "pointer" : "default", whiteSpace: "nowrap" }}
                 onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                 onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
              {it.chip && <span style={{ width: 8, height: 8, borderRadius: "50%", background: it.chip, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: it.active ? 700 : 400,
                              color: it.active ? "var(--text-primary)" : undefined }}>
                  {it.active ? "● " : ""}{it.label}
                </div>
                {it.sub && <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 1 }}>{it.sub}</div>}
              </div>
              {it.actions?.map((a, j) => (
                <button key={j} title={a.title}
                        onClick={(e) => { e.stopPropagation(); a.onClick(); setMenu(null); }}
                        style={{ fontSize: 10, padding: "1px 7px", flexShrink: 0 }}>
                  {a.label}
                </button>
              ))}
              {it.onClose && (
                <span title="이 Exam 탭만 닫기"
                      onClick={(e) => { e.stopPropagation(); it.onClose!(); }}
                      style={{ fontSize: 11, opacity: 0.7, cursor: "pointer", padding: "0 3px", flexShrink: 0 }}>✕</span>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--text-secondary)" }}>항목 없음</div>
          )}
        </div>
      )}
    </span>
  );
}

/* 주석 1건 SVG 도형 — 사용자=노랑, AI=보라(생성물 전용 색) */
function AnnoShape({ a, sx, sy, fs }: {
  a: Anno; sx: (v: number) => number; sy: (v: number) => number; fs: number;
}) {
  // 보라(#a78bfa)=AI 전용 · 녹색=타사 PR(GSPS 불러오기) · 노랑=사용자
  const color = a.source === "ai" ? "#a78bfa" : a.source === "external" ? "#67e8a0" : "#ffd54a";
  const sw = fs * 0.08;
  const pts = a.points;
  if (!pts?.length) return null;
  const P = (i: number) => ({ x: sx(pts[i][0]), y: sy(pts[i][1]) });
  const label = annoLabel(a);
  const mid = pts.length >= 2
    ? { x: (P(0).x + P(1).x) / 2, y: (P(0).y + P(1).y) / 2 }
    : P(0);
  let labelAt = mid;  // 라벨 기준점 — 해부학 도구는 케이스별로 재지정
  let shape: React.ReactNode = null;
  switch (a.kind) {
    case "length": case "line": case "ctr":
      if (pts.length < 2) return null;
      shape = <line x1={P(0).x} y1={P(0).y} x2={P(1).x} y2={P(1).y} stroke={color} strokeWidth={sw} />;
      break;
    case "arrow": {
      if (pts.length < 2) return null;
      const dx = P(1).x - P(0).x, dy = P(1).y - P(0).y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, hs = fs * 0.6;
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <line x1={P(0).x} y1={P(0).y} x2={P(1).x} y2={P(1).y} />
          <line x1={P(1).x} y1={P(1).y} x2={P(1).x - hs * (ux + uy * 0.5)} y2={P(1).y - hs * (uy - ux * 0.5)} />
          <line x1={P(1).x} y1={P(1).y} x2={P(1).x - hs * (ux - uy * 0.5)} y2={P(1).y - hs * (uy + ux * 0.5)} />
        </g>
      );
      break;
    }
    case "angle":
      if (pts.length < 3) return null;
      shape = <polyline points={pts.map((q) => `${sx(q[0])},${sy(q[1])}`).join(" ")}
                        stroke={color} fill="none" strokeWidth={sw} />;
      break;
    case "rect":
      if (pts.length < 2) return null;
      shape = <rect x={Math.min(P(0).x, P(1).x)} y={Math.min(P(0).y, P(1).y)}
                    width={Math.abs(P(1).x - P(0).x)} height={Math.abs(P(1).y - P(0).y)}
                    stroke={color} fill="none" strokeWidth={sw} />;
      break;
    case "ellipse":
      if (pts.length < 2) return null;
      shape = <ellipse cx={(P(0).x + P(1).x) / 2} cy={(P(0).y + P(1).y) / 2}
                       rx={Math.abs(P(1).x - P(0).x) / 2} ry={Math.abs(P(1).y - P(0).y) / 2}
                       stroke={color} fill="none" strokeWidth={sw} />;
      break;
    case "text":
      break;
    // ── TY-2 이식 (In Viewer 측정·주석·픽셀) ──
    case "poly":
      // 폴리라인 — 경로 길이(라벨=값), 끝점에 라벨
      if (pts.length < 2) return null;
      shape = <polyline points={pts.map((q) => `${sx(q[0])},${sy(q[1])}`).join(" ")}
                        stroke={color} fill="none" strokeWidth={sw} />;
      labelAt = P(pts.length - 1);
      break;
    case "circle": {
      // 원 — 중심(p0)→가장자리(p1), 반지름 라벨
      if (pts.length < 2) return null;
      const r = Math.hypot(P(1).x - P(0).x, P(1).y - P(0).y);
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <circle cx={P(0).x} cy={P(0).y} r={r} />
          <circle cx={P(0).x} cy={P(0).y} r={sw * 1.2} fill={color} stroke="none" />
        </g>
      );
      labelAt = { x: P(0).x + r, y: P(0).y };
      break;
    }
    case "centerline": {
      // 중앙선 — 두 선(p0-p1, p2-p3)의 중점 연결(점선)
      if (pts.length < 4) return null;
      const m1 = { x: (P(0).x + P(1).x) / 2, y: (P(0).y + P(1).y) / 2 };
      const m2 = { x: (P(2).x + P(3).x) / 2, y: (P(2).y + P(3).y) / 2 };
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <line x1={P(0).x} y1={P(0).y} x2={P(1).x} y2={P(1).y} />
          <line x1={P(2).x} y1={P(2).y} x2={P(3).x} y2={P(3).y} />
          <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y}
                strokeDasharray={`${fs * 0.5} ${fs * 0.35}`} />
        </g>
      );
      labelAt = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 };
      break;
    }
    case "mctr":
      // 수동 심흉비 — 심장 폭(p0-p1) + 흉곽 폭(p2-p3), 라벨=CTR %(text)
      if (pts.length < 4) return null;
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <line x1={P(0).x} y1={P(0).y} x2={P(1).x} y2={P(1).y} />
          <line x1={P(2).x} y1={P(2).y} x2={P(3).x} y2={P(3).y} />
        </g>
      );
      labelAt = P(3);
      break;
    case "box": {
      // 박스 메모 — 사각 + 제목(text)을 좌상단에
      if (pts.length < 2) return null;
      const bx = Math.min(P(0).x, P(1).x), by = Math.min(P(0).y, P(1).y);
      shape = <rect x={bx} y={by} width={Math.abs(P(1).x - P(0).x)} height={Math.abs(P(1).y - P(0).y)}
                    stroke={color} fill="none" strokeWidth={sw} />;
      labelAt = { x: bx, y: by };
      break;
    }
    case "spine":
      // Spine Label — 점 + 연번 라벨(text)
      shape = <circle cx={P(0).x} cy={P(0).y} r={fs * 0.22} fill={color} stroke="none" />;
      break;
    case "marking":
      // Marking — 짧은 표기(text)만 표시
      break;
    case "lens":
      // Lens — 십자 마커 + 근사 픽셀값(text, '≈')
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <line x1={P(0).x - fs * 0.5} y1={P(0).y} x2={P(0).x + fs * 0.5} y2={P(0).y} />
          <line x1={P(0).x} y1={P(0).y - fs * 0.5} x2={P(0).x} y2={P(0).y + fs * 0.5} />
        </g>
      );
      break;
    // ── 해부학 측정 4종 ──
    case "cobb":
      // 두 실선(선1 p0-p1, 선2 p2-p3) 사이 예각
      if (pts.length < 4) return null;
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <line x1={P(0).x} y1={P(0).y} x2={P(1).x} y2={P(1).y} />
          <line x1={P(2).x} y1={P(2).y} x2={P(3).x} y2={P(3).y} />
        </g>
      );
      labelAt = { x: (P(1).x + P(2).x) / 2, y: (P(1).y + P(2).y) / 2 };
      break;
    case "leg":
      // 좌(p0-p1)·우(p2-p3) 라인 + 끝점 표시
      if (pts.length < 4) return null;
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <line x1={P(0).x} y1={P(0).y} x2={P(1).x} y2={P(1).y} />
          <line x1={P(2).x} y1={P(2).y} x2={P(3).x} y2={P(3).y} />
          {[0, 1, 2, 3].map((i) => (
            <circle key={i} cx={P(i).x} cy={P(i).y} r={sw * 1.3} fill={color} stroke="none" />
          ))}
        </g>
      );
      labelAt = { x: (P(1).x + P(3).x) / 2, y: (P(1).y + P(3).y) / 2 };
      break;
    case "pelvis":
      // 좌우 장골능 실선 + 수평 기준 점선(좌측 점 기준)
      if (pts.length < 2) return null;
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <line x1={P(0).x} y1={P(0).y} x2={P(1).x} y2={P(1).y} />
          <line x1={P(0).x} y1={P(0).y} x2={P(1).x} y2={P(0).y}
                strokeDasharray={`${fs * 0.5} ${fs * 0.35}`} opacity={0.8} />
        </g>
      );
      break;
    case "spineCurve": {
      // 기준선(첫점→끝점, 점선) + 경유 폴리라인 + 최대 수직 편차 지점 마커
      if (pts.length < 3) return null;
      const A = P(0), B = P(pts.length - 1);
      const abx = B.x - A.x, aby = B.y - A.y;
      const ab2 = abx * abx + aby * aby || 1;
      let mi = 1, md = -1, fx2 = A.x, fy2 = A.y;
      for (let i = 1; i < pts.length - 1; i++) {
        const Q = P(i);
        const t = ((Q.x - A.x) * abx + (Q.y - A.y) * aby) / ab2;
        const px2 = A.x + t * abx, py2 = A.y + t * aby;
        const d = Math.hypot(Q.x - px2, Q.y - py2);
        if (d > md) { md = d; mi = i; fx2 = px2; fy2 = py2; }
      }
      shape = (
        <g stroke={color} strokeWidth={sw} fill="none">
          <line x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                strokeDasharray={`${fs * 0.5} ${fs * 0.35}`} opacity={0.85} />
          <polyline points={pts.map((q) => `${sx(q[0])},${sy(q[1])}`).join(" ")} />
          <line x1={P(mi).x} y1={P(mi).y} x2={fx2} y2={fy2}
                strokeDasharray={`${fs * 0.25} ${fs * 0.2}`} />
          <circle cx={P(mi).x} cy={P(mi).y} r={fs * 0.3} strokeWidth={sw * 1.5} />
        </g>
      );
      labelAt = P(mi);
      break;
    }
    default:
      return null;
  }
  return (
    <g>
      {shape}
      {label && (
        <text x={labelAt.x + fs * 0.3} y={labelAt.y - fs * 0.3} fill={color} fontSize={fs}
              stroke="#000" strokeWidth={fs * 0.1} style={{ paintOrder: "stroke" }}>
          {label}
        </text>
      )}
    </g>
  );
}

function ov(pos: "tl" | "tr" | "bl" | "br", fontSize = 10.5): React.CSSProperties {
  return {
    position: "absolute", zIndex: 1, fontSize, lineHeight: 1.45, pointerEvents: "none",
    color: "var(--text-primary)", textShadow: "0 0 4px #000", padding: 5,
    ...(pos === "tl" ? { top: 0, left: 0 } : {}),
    ...(pos === "tr" ? { top: 0, right: 0, textAlign: "right" } : {}),
    ...(pos === "bl" ? { bottom: 0, left: 0 } : {}),
    ...(pos === "br" ? { bottom: 0, right: 0, textAlign: "right" } : {}),
  };
}
