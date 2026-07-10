// Saintview 2D 뷰어 — WADO-RS /rendered 기반(픽셀 보장) + Zetta/INFINITT 레이아웃
// 설정 연동: 팔레트/썸네일 방향·크기, 썸네일 모드(시리즈/전체), 행잉(모달리티→분할), 판독 도크
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, openViewer, type Anno, type InstanceNode, type SeriesNode, type StudyDetail } from "../api";
import { annoLabel, contentRect, measureAnno, refLineOn, screenToImage } from "../lib/annotations";
import { GridPicker } from "../lib/GridPicker";
import { screenFeatures } from "../lib/screens";
import { onStudySync, postStudySync } from "../lib/sync";
import { Splitter, clampSz } from "../lib/Splitter";
import { DEFAULT_WL_PRESETS, type HpRule } from "../lib/viewerConfig";
import { ToolIcon } from "../lib/toolIcons";
import { AnatomyIcon } from "../lib/anatomyIcons";
import { ReportDock } from "../components/ReportDock";
import { DICOMWEB_ROOT } from "../lib/cornerstone";

// 내장 MPR/MIP — 새 창 없이 현재 뷰포트 영역에 Axial/Sagittal/Coronal+MIP 표시
const Viewer3DEmbed = lazy(() => import("./Viewer3D").then((m) => ({ default: m.Viewer3D })));
// 뷰어 내 설정 — 워크리스트로 돌아가지 않고 Setting 진입
const SettingsModalLazy = lazy(() => import("./SettingsModal").then((m) => ({ default: m.SettingsModal })));

type ToolKind = "length" | "angle" | "rect" | "ellipse" | "arrow" | "text"
  | "cobb" | "leg" | "pelvis" | "spineCurve";
const TOOL_DEFS: [ToolKind, string, string][] = [
  ["length", "Len", "길이 계측 (2점, mm)"],
  ["angle", "Ang", "각도 계측 (3점)"],
  ["rect", "Rect", "사각 ROI (면적)"],
  ["ellipse", "Elps", "타원 ROI (면적)"],
  ["arrow", "Arrw", "화살표"],
  ["text", "Text", "텍스트 주석"],
];
// 해부학 측정 툴 4종 (Anatomy) — 콥각/다리길이/골반/척추외곡
const ANATOMY_TOOL_DEFS: [ToolKind, string, string][] = [
  ["cobb", "Cobb", "콥 각(척추측만) — 4점: 첫 선 2점 → 둘째 선 2점, 두 직선 사이 예각(°)"],
  ["leg", "Leg", "다리 길이 — 4점: 좌측 라인 2점 → 우측 라인 2점, 각 길이(mm)와 좌우 차이"],
  ["pelvis", "Pelvis", "골반 틀어짐 — 2점: 좌·우 장골능, 수평 대비 각도(°)와 높이차(mm)"],
  ["spineCurve", "Spine", "척추 외곡 — 3점 이상 클릭 후 더블클릭으로 종료, 기준선 대비 최대 편위(mm)"],
];

const PANE_IDS = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
// Related Study 상태 → 색 칩 (theme.css --stat-* 의미 체계와 동일)
const STAT_COLOR: Record<string, string> = {
  received: "var(--stat-received)", draft_ready: "var(--stat-draft)",
  reading: "var(--stat-reading)", finalized: "var(--stat-final)",
  critical: "var(--stat-emergency)", emergency: "var(--stat-emergency)",
};
// Series Layout — 뷰포트 분할(최대 3×3, UBPACS View Screen Composition)
const LAYOUTS: Record<string, { cols: number; rows: number; count: number }> = {};
for (let r = 1; r <= 3; r++) {
  for (let c = 1; c <= 3; c++) {
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
}
const initPane = (studyUid: string): PaneState => ({
  studyUid, series: null, index: 0, zoom: 1, tx: 0, ty: 0, rot: 0,
  flipH: false, flipV: false, invert: false, wl: "",
});

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
  const [openSecs, setOpenSecs] = useState<Set<string>>(new Set(["common", "anno", "anatomy", "2d", "etc"]));
  const toggleSec = (k: string) => setOpenSecs((p) => {
    const n = new Set(p);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const [syncScroll, setSyncScroll] = useState(false);   // 화면 연동(요청 3)
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
  /* 언마운트 시 디바운스 대기 중인 패치 즉시 저장 — 뷰어 닫힘 직전 조작(사용 카운트 등) 유실 방지 */
  useEffect(() => () => {
    if (prefsTimer.current) window.clearTimeout(prefsTimer.current);
    const p = pendingPrefs.current;
    if (Object.keys(p).length) {
      pendingPrefs.current = {};
      api.getSetting("viewer.prefs").then((r) =>
        api.putSetting("viewer.prefs", { ...r.value, ...p }, "user")).catch(() => {});
    }
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

  /* HP 규칙 적용 — Series/Image layout + W/L 프리셋 */
  const applyHp = useCallback((rule: HpRule) => {
    const key = `${Math.min(rule.s.r, 3)}x${Math.min(rule.s.c, 3)}`;
    if (LAYOUTS[key]) setLayout(key);
    setImgLay({ r: Math.min(rule.i.r, 3), c: Math.min(rule.i.c, 3) });
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
      };
      if (t.ty_tool_size) setTySize(t.ty_tool_size);
      if (t.ty_tool_labels !== undefined) setTyLabels(t.ty_tool_labels);
      if (t.ty_icon_3d !== undefined) setTyIcon3d(t.ty_icon_3d);
      if (t.ty_quick_row !== undefined) setTyQuickRow(t.ty_quick_row);
      if (t.ty_usage_rec !== undefined) setTyUsageRec(t.ty_usage_rec);
      if (t.ty_usage) { tyUsageRef.current = t.ty_usage; setTyUsage(t.ty_usage); }
      if (t.ty_overlay_font) setTyOvFont(t.ty_overlay_font);
      if (t.ty_overlay_visible !== undefined) setOverlayOn(t.ty_overlay_visible);
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
    }).catch(() => setStatus("시리즈 조회 실패"));
    // 리포트/상용구/판독설정 로드는 ReportDock 내부로 이동 (detail.id 변경 시 자체 재로드)
    api.annotations(detail.id).then((r) => setAnnos(r.items)).catch(() => {});
    return () => {
      if (cineRef.current) window.clearInterval(cineRef.current);
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
    return tree;
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
      if (!s) return;
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
    setSyncScroll(true);
    setStatus("비교 모드: 과거검사 로드 + 동기 스크롤 ON");
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
    setSyncScroll(true);
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
        if (!p.series) return;
        next[id] = { ...p, index: Math.min(Math.max(p.index + dir * stride, 0), p.series.instances.length - 1) };
      };
      if (syncScroll) PANE_IDS.slice(0, LAYOUTS[layout].count).forEach(apply);  // 화면 연동
      else apply(pid);
      return next;
    });
  }, [syncScroll, layout, imgLay]);

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
          else requestCloseRef.current();
          break;
        case " ": e.preventDefault(); act("cine"); break;
        case "1": setLayout("1x1"); break;
        case "2": setLayout("1x2"); break;
        case "4": setLayout("2x2"); break;
        default:
          switch (e.key.toLowerCase()) {
            case "i": act("invert"); break;
            case "r": act("rotR"); break;
            case "f": act("fit"); break;
            case "l": setSyncScroll((s) => !s); break;
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
  }, [activePane, step, tool, draft, menu]);

  /* 마우스 상호작용 */
  const dragRef = useRef<{ pid: string; x: number; y: number; btn: number } | null>(null);
  const onPaneMouseDown = (pid: string, e: React.MouseEvent) => {
    setActivePane(pid);
    if (tool && e.button === 0) { handleAnnoPoint(pid, e); return; }  // 측정 도구 우선
    dragRef.current = { pid, x: e.clientX, y: e.clientY, btn: e.button };
  };

  /* 측정 도구 — 클릭 점 수집 → 완성 시 주석 생성(계측값 자동 계산)
     spineCurve 는 open-ended: 점 수 제한 없이 수집, 더블클릭(finishSpineCurve)으로 종료 */
  const handleAnnoPoint = (pid: string, e: React.MouseEvent) => {
    const p = panes[pid];
    const inst = p.series?.instances[p.index];
    if (!tool || !p.series || !inst) return;
    if (tool === "spineCurve" && e.detail > 1) return;  // 더블클릭 2번째 mousedown 은 점 추가 안 함
    const aspect = inst.cols && inst.rows ? inst.cols / inst.rows : 1;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const pt = screenToImage(e.clientX, e.clientY, rect, p, aspect);
    if (!pt) return;
    const need = tool === "angle" ? 3 : tool === "text" ? 1
      : tool === "cobb" || tool === "leg" ? 4
      : tool === "spineCurve" ? Infinity : 2;
    const d = draft && draft.pid === pid
      ? draft
      : { pid, sop_uid: inst.sop_uid, series_uid: p.series.series_uid, points: [] as number[][] };
    const points = [...d.points, pt];
    if (points.length < need) { setDraft({ ...d, points }); return; }
    let text = "";
    if (tool === "text") {
      text = window.prompt("주석 텍스트") ?? "";
      if (!text) { setDraft(null); return; }
    }
    const m = measureAnno(tool, points, inst);
    setAnnos((prev) => [...prev, {
      series_uid: d.series_uid, sop_uid: d.sop_uid, kind: tool, points,
      value: m?.value ?? null, unit: m?.unit ?? "", text: m?.text ?? text, source: "user",
    }]);
    setDraft(null);
  };

  /* 척추 외곡(open-ended) 종료 — 페인 더블클릭. 3점 이상이면 확정, 미만이면 계속 수집 */
  const finishSpineCurve = () => {
    if (tool !== "spineCurve" || !draft) return;
    const points = draft.points;
    if (points.length < 3) { setStatus("척추 외곡: 3점 이상 클릭 후 더블클릭으로 종료하세요"); return; }
    const p = panes[draft.pid];
    const inst = p.series?.instances.find((i) => i.sop_uid === draft.sop_uid) ?? p.series?.instances[p.index];
    const m = measureAnno("spineCurve", points, inst);
    setAnnos((prev) => [...prev, {
      series_uid: draft.series_uid, sop_uid: draft.sop_uid, kind: "spineCurve", points,
      value: m?.value ?? null, unit: m?.unit ?? "", text: m?.text ?? "", source: "user",
    }]);
    setDraft(null);
  };

  /* S2 자동계측 CTR — AI 초안 라벨 필수 */
  const doCtr = async () => {
    setStatus("AI CTR 계측 중…");
    try {
      const r = await api.ctr(detail.id);
      const a = await api.annotations(detail.id);
      setAnnos((prev) => [...prev.filter((x) => x.kind !== "ctr"), ...a.items.filter((x) => x.kind === "ctr")]);
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
      setPanes((prev) => {
        const p = prev[d.pid];
        // 좌=선택 모드, 우=Zoom 고정, 중=Pan 고정 (디자인 §4.2)
        const mode = d.btn === 2 ? "zoom" : d.btn === 1 ? "pan" : mouseMode;
        if (mode === "zoom") return { ...prev, [d.pid]: { ...p, zoom: Math.max(0.2, p.zoom * (1 - dy * 0.005)) } };
        if (mode === "pan") return { ...prev, [d.pid]: { ...p, tx: p.tx + dx, ty: p.ty + dy } };
        if (mode === "wl") {
          // 드래그 W/L — 서버 /rendered?window=C,W 라운드트립(가로=Width, 세로=Center)
          const cur = p.wl ? p.wl.split(",").map(Number) : null;
          const base = cur && cur.length >= 2 && !Number.isNaN(cur[0])
            ? [cur[0], cur[1]]
            : (p.series?.modality === "CT" ? [40, 400] : [128, 256]);
          const w = Math.max(1, base[1] + dx * 2);
          const c = base[0] - dy * 2;
          return { ...prev, [d.pid]: { ...p, wl: `${Math.round(c)},${Math.round(w)}` } };
        }
        return prev;
      });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [mouseMode]);

  const act = (a: string) => {
    const p = panes[activePane];
    switch (a) {
      case "invert": patch(activePane, { invert: !p.invert }); break;
      case "rotL": patch(activePane, { rot: (p.rot - 90 + 360) % 360 }); break;
      case "rotR": patch(activePane, { rot: (p.rot + 90) % 360 }); break;
      case "flipH": patch(activePane, { flipH: !p.flipH }); break;
      case "flipV": patch(activePane, { flipV: !p.flipV }); break;
      case "fit": case "reset":
        patch(activePane, { zoom: 1, tx: 0, ty: 0, rot: 0, flipH: false, flipV: false, ...(a === "reset" ? { invert: false, wl: "" } : {}) });
        break;
      case "capture": {
        const url = renderedUrl(p);
        if (url) { const el = document.createElement("a"); el.href = url; el.download = `saintview_${Date.now()}.png`; el.click(); }
        break;
      }
      case "cine": {
        if (cineRef.current) { window.clearInterval(cineRef.current); cineRef.current = null; setCine(false); return; }
        setCine(true);
        cineRef.current = window.setInterval(() => step(activePane, 1), 150);
        break;
      }
    }
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
    let refSeg: [number, number][] | null = null;
    if (refOn && pid !== activePane) {
      const act = panes[activePane];
      const actInst = act.series?.instances[act.index];
      if (actInst && actInst.sop_uid !== inst.sop_uid) refSeg = refLineOn(actInst, inst);
    }
    if (items.length === 0 && !dr && !refSeg) return null;
    return (
      <svg viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none"
           style={{ position: "absolute", left: cr.left, top: cr.top, width: cr.width, height: cr.height,
                    pointerEvents: "none", overflow: "visible" }}>
        {items.map((a, i) => <AnnoShape key={a.id ?? `local${i}`} a={a} sx={sx} sy={sy} fs={fs} />)}
        {dr && dr.points.map((pt, i) => (
          <circle key={i} cx={sx(pt[0])} cy={sy(pt[1])} r={fs * 0.25} fill="#ffd54a" />
        ))}
        {dr && dr.points.length >= 2 && (
          tool === "cobb" || tool === "leg" ? (
            // 4점 도구 초안 — 선1(p0,p1)만 잇는다(p1→p2 연결선은 오해 소지)
            <line x1={sx(dr.points[0][0])} y1={sy(dr.points[0][1])}
                  x2={sx(dr.points[1][0])} y2={sy(dr.points[1][1])}
                  stroke="#ffd54a" strokeWidth={fs * 0.08} />
          ) : (
            <polyline points={dr.points.map((q) => `${sx(q[0])},${sy(q[1])}`).join(" ")}
                      stroke="#ffd54a" fill="none" strokeWidth={fs * 0.08} />
          )
        )}
        {refSeg && (
          <line x1={sx(refSeg[0][0])} y1={sy(refSeg[0][1])} x2={sx(refSeg[1][0])} y2={sy(refSeg[1][1])}
                stroke="#4dd0e1" strokeDasharray={`${fs * 0.6} ${fs * 0.4}`} strokeWidth={fs * 0.08} />
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

  /* W/L 프리셋 적용 — All 모드면 모든 페인에 (UBPACS All) */
  const applyWl = (q: string) => {
    if (wlAll) {
      setPanes((prev) => Object.fromEntries(
        Object.entries(prev).map(([k, p]) => [k, { ...p, wl: q }])));
    } else {
      patch(activePane, { wl: q });
    }
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

  /* 팔레트 버튼 내부 — 아이콘 크기(ty_tool_size)·라벨 표시(ty_tool_labels) 개인화 반영 */
  const TyInner = ({ id, label, anatomy }: { id: string; label: string; anatomy?: boolean }) => (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1 }}>
      {anatomy ? <AnatomyIcon id={id} size={tySize} flat={!tyIcon3d} />
               : <ToolIcon id={id} size={tySize} flat={!tyIcon3d} />}
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
    ...Object.fromEntries([...TOOL_DEFS, ...ANATOMY_TOOL_DEFS].map(([tk, label]) => [tk, {
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
      <button style={{ padding: "6px 6px", fontSize: 12, background: syncScroll ? "var(--accent)" : undefined }}
              title="화면 연동: 모든 페인 동시 스크롤 (CrossLink)" onClick={() => setSyncScroll((s) => !s)}>
        Link{syncScroll ? "●" : ""}
      </button>
      <button style={{ padding: "6px 6px", fontSize: 12 }} onClick={() => setThumbOpen((t) => !t)}>Thumb</button>
      <button style={{ padding: "6px 6px", fontSize: 12 }} onClick={() => setPaletteOpen(false)}>Hide</button>
      {([["common", "Common"], ["anno", "Anno"], ["anatomy", "Anatomy(해부)"], ["2d", "2D"], ["etc", "ETC"]] as const).map(([k, label]) => (
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
                {tbOn("flipH") && <ActBtn a="flipH" label="⇋" title="좌우반전" />}
                {tbOn("flipV") && <ActBtn a="flipV" label="⇵" title="상하반전" />}
                {tbOn("cine") && <ActBtn a="cine" label={cine ? "■" : "▶"} title="시네" on={cine} />}
                {tbOn("cap") && <ActBtn a="capture" label="Cap" title="PNG 저장" />}
                {tbOn("reset") && <ActBtn a="reset" label="Reset" title="초기화" />}
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
                  <button title="마지막 주석 삭제" onClick={() => setAnnos((p) => p.slice(0, -1))}
                          style={{ padding: "6px 0", fontSize: 12, width: paletteHoriz ? 60 : "100%" }}>
                    <TyInner id="del" label="Del" />
                  </button>
                )}
                {tbOn("clr") && (
                  <button title="주석 전체 삭제" onClick={() => {
                    if (window.confirm(`주석 ${annos.length}건을 모두 삭제할까요? (저장 전이면 복구 불가)`)) setAnnos([]);
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
              </>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  /* 썸네일(방향·크기·모드 — 요청 2): series 모드=시리즈 카드+선택 전개 / all 모드=전체 개별 나열 */
  const allInstances = useMemo(
    () => series.flatMap((s) => s.instances.map((i, idx) => ({ s, i, idx }))),
    [series],
  );
  const thumbs = thumbOpen && (
    <div style={{
      display: "flex", flexDirection: thumbHoriz ? "row" : "column", gap: 4, padding: 4,
      background: "var(--bg-panel)", overflow: "auto", flexShrink: 0,
      ...(thumbHoriz ? { borderTop: "1px solid var(--border)", height: ts + 34 }
        : { width: ts + 34, ...(thumbRight ? { borderLeft: "1px solid var(--border)" }
                                           : { borderRight: "1px solid var(--border)" }) }),
    }}>
      {prefs.thumbMode === "series" ? series.map((s) => (
        <div key={s.series_uid} style={{ flexShrink: 0 }}>
          <div onClick={() => setSelSeries(selSeries === s.series_uid ? null : s.series_uid)}
               onDoubleClick={() => patch(activePane, { ...initPane(detail.study_uid), series: s, index: Math.floor(s.instances.length / 2) })}
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
                     onClick={() => patch(activePane, { studyUid: detail.study_uid, series: s, index: idx })}
                     style={{ width: ts * 0.6, height: ts * 0.45, objectFit: "cover", borderRadius: 2, cursor: "pointer", flexShrink: 0,
                              border: panes[activePane].series?.series_uid === s.series_uid && panes[activePane].index === idx
                                ? "2px solid var(--anno-keyimage)" : "1px solid var(--border)" }} />
              ))}
            </div>
          )}
        </div>
      )) : allInstances.slice(0, 200).map(({ s, i, idx }) => (
        <img key={i.sop_uid} src={i.preview_url} alt="" title={`S${s.series_number} Img${i.instance_number}`}
             onClick={() => patch(activePane, { studyUid: detail.study_uid, series: s, index: idx })}
             style={{ width: ts * 0.8, height: ts * 0.6, objectFit: "cover", borderRadius: 2, cursor: "pointer", flexShrink: 0,
                      border: "1px solid var(--border)" }} />
      ))}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200, display: "flex", flexDirection: "column" }}
         onContextMenu={(e) => e.preventDefault()}>
      {/* 상단 검사탭 바 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                    background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
        <button onClick={requestClose} style={{ fontWeight: 700 }}>WORKLIST</button>
        {/* 좌상단: Series Layout(뷰포트 분할) · Image Layout(페인 내 이미지 타일) — UBPACS p.14 */}
        <GridPicker label="Srs" max={3}
                    value={{ r: LAYOUTS[layout].rows, c: LAYOUTS[layout].cols }}
                    onPick={(v) => setLayout(`${v.r}x${v.c}`)} />
        <GridPicker label="Img" max={3} value={imgLay} onPick={setImgLay} />
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
                   items={series.map((s) => ({
                     label: `S${s.series_number} ${s.series_desc || s.modality} (${s.instances.length}장)`,
                     active: panes[activePane].series?.series_uid === s.series_uid,
                     onClick: () => patch(activePane, {
                       ...initPane(detail.study_uid), series: s, index: Math.floor(s.instances.length / 2),
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
        <div style={{ flex: 1, display: "grid", minWidth: 0, minHeight: 0,
                      gridTemplateColumns: `repeat(${L.cols}, 1fr)`, gridTemplateRows: `repeat(${L.rows}, 1fr)`,
                      gap: 2, padding: 2 }}>
          {PANE_IDS.slice(0, L.count).map((pid) => {
            const p = panes[pid];
            const url = renderedUrl(p);
            const isPrior = p.studyUid !== detail.study_uid;
            const inst = p.series?.instances[p.index];
            return (
              <div key={pid} ref={getPaneRef(pid)}
                   onMouseDown={(e) => onPaneMouseDown(pid, e)}
                   onWheel={(e) => {
                     if (tHeld.current) {  // T+스크롤 — 오버레이 글자 크기 (In Viewer 패리티, 계정 저장)
                       const nf = Math.min(24, Math.max(6, tyOvFont + (e.deltaY < 0 ? 0.5 : -0.5)));
                       setTyOvFont(nf);
                       persistPrefsPatch({ ty_overlay_font: nf });
                       return;
                     }
                     step(pid, e.deltaY > 0 ? 1 : -1);
                   }}
                   onDoubleClick={() => { if (tool === "spineCurve") finishSpineCurve(); else if (!tool) act("fit"); }}
                   style={{ position: "relative", overflow: "hidden", minHeight: 0, minWidth: 0,
                            background: "#000", cursor: tool ? "copy" : "crosshair",
                            outline: activePane === pid ? "1px solid var(--accent)" : "1px solid var(--border)" }}>
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
                               filter: p.invert ? "invert(1)" : undefined,
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
                                   filter: p.invert ? "invert(1)" : undefined,
                                 }} />
                          ) : <div key={k} />;
                        })}
                      </div>
                    )}
                  </div>
                )}
                {overlayOn && p.series && (
                  <>
                    <div style={ov("tl", tyOvFont)}>
                      {detail.patient_name} ({detail.sex})<br />
                      {isPrior ? "[비교/과거]" : detail.study_desc}<br />{detail.study_date}
                    </div>
                    <div style={ov("tr", tyOvFont)}>
                      S{p.series.series_number} {p.series.series_desc || p.series.modality}<br />
                      Img: {p.index + 1}{tileCount > 1 && `~${Math.min(p.index + tileCount, p.series.instances.length)}`}/{p.series.instances.length}
                    </div>
                    <div style={ov("bl", tyOvFont)}>{detail.modality} · {detail.patient_key}</div>
                    <div style={ov("br", tyOvFont)}>
                      Z: {(p.zoom * 100).toFixed(0)}%{p.wl && <><br />W/L: {p.wl}</>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
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
