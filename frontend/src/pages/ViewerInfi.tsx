// In Viewer — INFINITT PACS User Guide 기반 Client 뷰어 (v3).
// User Guide p.11~14 §3.4 Toolbar buttons 전 툴(약 50종) 구성 + §3.5 마우스 체계.
// 실동작: Select/Pan/Zoom/Windowing/Fit/Capture/Reset/Print/Refresh Exam/Flip V·H/Rotate L·R·180/
//         B/W Inverse/Sharpen/Average/Pseudo/Auto Scroll/Calibrate/Measure 2D Line/Measure 2D Angle
// 미구현(반투명): Magnification/3D Cursor/Dictation 계열/Select All 계열/Shutter 3종/CT Ratio/
//         Limb Length/Center Line/Profile/2D Table/Spine Label/Volume/3D 주석/2D 주석·ROI 계열/Cobb/Marking/Lens
import { Fragment, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Splitter } from "../lib/Splitter";

// Setting(p.12 'Open the setting window of Viewer') — 워크리스트 헤더의 설정과 동일한 설정 창
const SettingsModal = lazy(() => import("./SettingsModal").then((m) => ({ default: m.SettingsModal })));
// 3D — Cornerstone3D MPR/MIP 볼륨 뷰어 (전체 오버레이)
const Viewer3D = lazy(() => import("./Viewer3D").then((m) => ({ default: m.Viewer3D })));
import { api, type InstanceNode, type Report, type SeriesNode, type StudyDetail } from "../api";
import { DICOMWEB_ROOT } from "../lib/cornerstone";
import { IN_PALETTE, IN_CROSSLINK_MODES, IN_LAYOUTS, IN_WL_PRESETS_CT, IN_WL_PRESETS_MR } from "../lib/infiConfig";

interface Pane {
  series: SeriesNode | null;
  studyUid: string;          // 페인의 검사 소속 — Sync With Other Exams 판별(과거검사 비교)
  index: number;
  zoom: number; tx: number; ty: number; rot: number;
  flipH: boolean; flipV: boolean; invert: boolean;
  wl: string;
  fx: "" | "sharpen" | "smooth" | "pseudo";   // p.13 필터(Sharpens/Average/Pseudo)
  il: { r: number; c: number };  // Image Layout — DICOM 계층: 페인(Series) 내부의 이미지 타일 분할(페인별)
  shutter?: { kind: "rect" | "ellipse" | "poly"; pts: { x: number; y: number }[] } | null;  // 표시 셔터
}
const initPane = (studyUid = ""): Pane => ({
  series: null, studyUid, index: 0, zoom: 1, tx: 0, ty: 0, rot: 0,
  flipH: false, flipV: false, invert: false, wl: "", fx: "", il: { r: 1, c: 1 },
});
/** "00 x 00" 임의 레이아웃 입력(1~10) */
function askLayout(cur: { r: number; c: number }): { r: number; c: number } | null {
  const v = prompt("Image Layout — 행 x 열 (1~10)", `${cur.r} x ${cur.c}`);
  if (!v) return null;
  const m = v.match(/(\d+)\s*[xX*]\s*(\d+)/);
  if (!m) return null;
  const clamp = (n: number) => Math.min(10, Math.max(1, n));
  return { r: clamp(+m[1]), c: clamp(+m[2]) };
}

/* ── Scout line 기하 — DICOM ImagePosition/Orientation 으로 소스 이미지의 절단선을
      타깃 이미지 픽셀좌표에 투영 (§3.3 ④⑤ Scout Line / All Lines) ── */
type V3 = number[];
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
interface Geom { pos: V3; row: V3; col: V3; rs: number; cs: number; n: V3; rows: number; cols: number }
/** 평면의 지배 축(0=SAG,1=COR,2=AX 근사) — 크로스 라인 축별 1개 제한용 */
function axisOf(g: Geom): number {
  const a = [Math.abs(g.n[0]), Math.abs(g.n[1]), Math.abs(g.n[2])];
  return a.indexOf(Math.max(...a));
}
function geomOf(inst: InstanceNode): Geom | null {
  if (inst.position?.length !== 3 || inst.orientation?.length !== 6 || inst.pixel_spacing?.length !== 2) return null;
  const row = inst.orientation.slice(0, 3), col = inst.orientation.slice(3, 6);
  return { pos: inst.position, row, col, rs: inst.pixel_spacing[0], cs: inst.pixel_spacing[1],
           n: vcross(row, col), rows: inst.rows || 1, cols: inst.cols || 1 };
}
/** 소스 평면(src)과 타깃(tgt) 평면의 **정확한 교차선**을 타깃 픽셀좌표로 반환.
 *  타깃 이미지 경계를 약간(5%) 넘는 범위로 클리핑 — 상하/좌우 전체를 관통하는 풀 레인지 라인.
 *  평행 평면이면 null. (기존 모서리 투영 근사는 대각선 오류가 있어 폐기) */
function scoutSegment(src: Geom, tgt: Geom): { x1: number; y1: number; x2: number; y2: number } | null {
  const nsLen = Math.hypot(...src.n), ntLen = Math.hypot(...tgt.n);
  if (nsLen < 1e-9 || ntLen < 1e-9) return null;
  if (Math.abs(vdot(src.n, tgt.n) / (nsLen * ntLen)) > 0.999) return null;   // 평행
  // 타깃 평면 위 점 Q(x,y) = pos + (x·cs)·row + (y·rs)·col 가 소스 평면 위에 있을 조건:
  //   A·x + B·y + C = 0  (x=열 px, y=행 px)
  const A = vdot(src.n, tgt.row) * tgt.cs;
  const B = vdot(src.n, tgt.col) * tgt.rs;
  const C = vdot(src.n, vsub(tgt.pos, src.pos));
  // 이미지 경계 + 5% 여유로 클리핑
  const mx = Math.max(2, (tgt.cols - 1) * 0.05), my = Math.max(2, (tgt.rows - 1) * 0.05);
  const X0 = -mx, X1 = (tgt.cols - 1) + mx, Y0 = -my, Y1 = (tgt.rows - 1) + my;
  const pts: { x: number; y: number }[] = [];
  const add = (x: number, y: number) => {
    if (x >= X0 - 1e-6 && x <= X1 + 1e-6 && y >= Y0 - 1e-6 && y <= Y1 + 1e-6) pts.push({ x, y });
  };
  if (Math.abs(B) > 1e-9) { add(X0, (-C - A * X0) / B); add(X1, (-C - A * X1) / B); }
  if (Math.abs(A) > 1e-9) { add((-C - B * Y0) / A, Y0); add((-C - B * Y1) / A, Y1); }
  if (pts.length < 2) return null;
  let bi: [number, number] = [0, 1], bd = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    if (d > bd) { bd = d; bi = [i, j]; }
  }
  if (bd < 1e-6) return null;
  return { x1: pts[bi[0]].x, y1: pts[bi[0]].y, x2: pts[bi[1]].x, y2: pts[bi[1]].y };
}

function instUrl(studyUid: string, s: SeriesNode, inst: InstanceNode, wl: string): string {
  const q = wl ? `?window=${wl},linear` : "";
  return `${DICOMWEB_ROOT}/studies/${studyUid}/series/${s.series_uid}/instances/${inst.sop_uid}/rendered${q}`;
}
function paneFilter(p: Pane): string | undefined {
  const parts: string[] = [];
  if (p.invert) parts.push("invert(1)");
  if (p.fx === "sharpen") parts.push("url(#in-sharpen)");
  if (p.fx === "smooth") parts.push("blur(1.2px)");
  if (p.fx === "pseudo") parts.push("sepia(1) saturate(5) hue-rotate(175deg)");   // 근사 컬러맵
  return parts.length ? parts.join(" ") : undefined;
}

type Tool = string;   // select/pan/zoom/wl + 점 클릭형 측정·주석·셔터·렌즈 등 (IN_PALETTE mode)
interface Anno2 { kind: string; pts: { x: number; y: number }[]; text?: string; value?: string }

// 점 클릭형 툴의 필요 점 수 (polyline/shutPoly 는 더블클릭 종료)
const TOOL_PTS: Record<string, number> = {
  mline: 2, mangle: 3, arrow2d: 2, box2d: 2, circle: 2, mellipse: 2, mrect: 2,
  cobb: 4, centerline: 4, limb: 4, ctr: 4, profile: 2, table2d: 2,
  text2d: 1, marking: 1, spine: 1, lens: 1, cursor3d: 1, shutRect: 2, shutEl: 2,
};
const OPEN_ENDED = new Set(["polyline", "shutPoly"]);
const isPointTool = (t: string) => t in TOOL_PTS || OPEN_ENDED.has(t);

// ── 렌더 이미지 픽셀 샘플러 (ROI 통계/Profile/Table/Lens) ──
// WADO-RS rendered PNG(8bit) 를 canvas 로 읽는다. W/L(c,w)을 알면 근사 원값으로 역변환:
//   raw ≈ (v/255)·w + (c − w/2)  — 표기는 '≈' (근사값, 원본 픽셀 아님)
const _pixCache = new Map<string, ImageData>();
async function samplePixels(url: string, cols: number, rows: number): Promise<ImageData | null> {
  const hit = _pixCache.get(url);
  if (hit) return hit;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = cols; cv.height = rows;
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(img, 0, 0, cols, rows);
        const data = ctx.getImageData(0, 0, cols, rows);
        if (_pixCache.size > 40) _pixCache.clear();   // 캐시 상한
        _pixCache.set(url, data);
        resolve(data);
      } catch { resolve(null); }   // CORS taint 등
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
function rawOf(v: number, wl: string): number {
  if (!wl) return v;
  const [c, w] = wl.split(",").map(Number);
  if (Number.isNaN(c) || Number.isNaN(w)) return v;
  return (v / 255) * w + (c - w / 2);
}
function roiStats(data: ImageData, x0: number, y0: number, x1: number, y1: number,
                  ellipse: boolean, wl: string) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  let n = 0, sum = 0, sq = 0, mn = Infinity, mx = -Infinity;
  for (let y = Math.max(0, Math.floor(Math.min(y0, y1))); y < Math.min(data.height, Math.max(y0, y1)); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(x0, x1))); x < Math.min(data.width, Math.max(x0, x1)); x++) {
      if (ellipse && rx > 0 && ry > 0) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
      }
      const v = rawOf(data.data[(y * data.width + x) * 4], wl);
      n++; sum += v; sq += v * v;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
  }
  if (!n) return null;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  return { n, mean, sd, mn, mx };
}

const PALETTE = IN_PALETTE;

export function ViewerInfi({ detail, onClose, addDetail, stackDetail, keySops, withOpen }: {
  detail: StudyDetail;
  onClose: () => void;
  addDetail?: StudyDetail | null;    // ② Add View: 기존 유지 + 이 검사를 분할 추가
  stackDetail?: StudyDetail | null;  // ③ Stack View: 기존 유지 + 이 검사를 같은 페인에 중첩
  keySops?: string[] | null;         // ⑤ Key Image View: 이 SOP 목록만 표시 (F-16)
  withOpen?: { mode: "add" | "stack"; ids: number[] } | null;  // Study With Open
}) {
  const [series, setSeries] = useState<SeriesNode[]>([]);
  // 과거검사(Related Exam) 시리즈 — Sync With Other Exams 용 (클릭 시 로드)
  const [priorSeries, setPriorSeries] = useState<{ uid: string; label: string; s: SeriesNode }[]>([]);
  const [priorLoaded, setPriorLoaded] = useState<Set<number>>(new Set());
  // 검사 누적(원본 Exam 탭) — 워크리스트가 sv_viewer 창을 재사용해 URL 교체하므로,
  // 열린 검사 id 를 localStorage 에 누적하고 각 검사를 오른쪽 페인으로 배치한다
  const [exams, setExams] = useState<{ d: StudyDetail; series: SeriesNode[] }[]>([]);
  const [activeExam, setActiveExam] = useState(0);
  const [sLayout, setSLayout] = useState<{ r: number; c: number }>({ r: 1, c: 1 });
  const [panes, setPanes] = useState<Pane[]>([initPane()]);
  const [active, setActive] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [maximized, setMaximized] = useState<number | null>(null);
  const [cine, setCine] = useState(false);
  const [closeMenu, setCloseMenu] = useState(false);
  const [wlPanel, setWlPanel] = useState(false);
  // §3.3 Crosslink 5기능 — 전부 동작: crosslink=마스터, auto_sync=같은 검사, sync_other=다른 검사(과거),
  // scout=활성 페인 현재 이미지 절단선, all_lines=활성 시리즈 전체 절단선
  const [xlink, setXlink] = useState<Record<string, boolean>>({ crosslink: true, auto_sync: true, scout: true });
  const [toast, setToast] = useState("");
  // §3.1 툴바 상단(원본): Report 도크 + Prev/Next 워크리스트 내비게이션
  const [reportDock, setReportDock] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  // Setting — 앱 공통 설정 창(SettingsModal)과 동일 동작. role 은 프로필에서
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [show3d, setShow3d] = useState(false);   // 정보바 3D 버튼 — 현재 검사 MPR/MIP
  // Compare — 같은 환자 과거검사 선택 비교 (선택 검사들을 페인으로 추가 + Sync With Other Exams)
  const [cmpOpen, setCmpOpen] = useState(false);
  const [cmpSel, setCmpSel] = useState<Set<number>>(new Set());
  const [role, setRole] = useState("user");
  useEffect(() => { api.profile().then((p) => setRole(p.role)).catch(() => {}); }, []);
  // 측정 주석 — sop_uid 별 (Measure 2D Line/Angle)
  const [annos, setAnnos] = useState<Record<string, Anno2[]>>({});
  const [pend, setPend] = useState<{ sop: string; pts: { x: number; y: number }[] } | null>(null);
  // 3D Cursor 마커(페인별, 일시적) · 돋보기 위치 · 픽셀값 표 모달 · 딕테이션
  const [cross3d, setCross3d] = useState<Record<number, { sop: string; x: number; y: number }>>({});
  const [magPos, setMagPos] = useState<{ pi: number; t: number; mx: number; my: number;
                                         nx: number; ny: number; sc: number } | null>(null);
  const [tableData, setTableData] = useState<{ title: string; rows: string[][] } | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<Record<number, Blob>>({});
  const [recording, setRecording] = useState(false);
  const spineSeq = useRef<{ base: string; n: number }>({ base: "L", n: 1 });
  const drag = useRef<{ x: number; y: number; btn: number; pane: number } | null>(null);

  const tilesOf = (p?: Pane) => (p ? p.il.r * p.il.c : 1);

  const EXAMS_KEY = "sv_infi_exams";
  useEffect(() => {
    let ids: number[] = [];
    try { ids = JSON.parse(localStorage.getItem(EXAMS_KEY) ?? "[]"); } catch { /* 초기화 */ }
    if (!ids.includes(detail.id)) ids.push(detail.id);
    // ② Add / ③ Stack: 대상 검사도 목록에 추가 (기존 유지). Study With Open 은 지정 id 들 일괄 추가
    for (const ex of [addDetail, stackDetail]) {
      if (ex && !ids.includes(ex.id)) ids.push(ex.id);
    }
    for (const wid of withOpen?.ids ?? []) {
      if (!ids.includes(wid)) ids.push(wid);
    }
    localStorage.setItem(EXAMS_KEY, JSON.stringify(ids));
    // Compare 로 재진입한 경우 — Sync With Other Exams 자동 ON
    if (localStorage.getItem("sv_infi_cmp") === "1") {
      localStorage.removeItem("sv_infi_cmp");
      setXlink((x) => ({ ...x, sync_other: true }));
    }
    Promise.all(ids.map(async (id) => {
      const d = id === detail.id ? detail : await api.study(id);
      const t = await api.seriesTree(id);
      return { d, series: t.series };
    })).then(async (list) => {
      // Modality 기본 레이아웃(설정>뷰어 — 행잉과 별도) 로드
      const prefsV = (await api.getSetting("viewer.prefs").catch(() => ({ value: {} }))).value as
        { infi_default_layout?: Record<string, { s?: { r: number; c: number } | null;
                                                 i?: { r: number; c: number } | null }> };
      const defMap = prefsV.infi_default_layout ?? {};
      // ⑤ Key Image View: 주 검사의 시리즈를 키이미지 SOP 만 남긴 [KEY] 시리즈로 필터
      if (keySops?.length) {
        const prim = list.find((e) => e.d.id === detail.id);
        if (prim) {
          prim.series = prim.series
            .map((s) => ({ ...s, series_desc: `[KEY] ${s.series_desc}`,
                           instances: s.instances.filter((i) => keySops.includes(i.sop_uid)) }))
            .filter((s) => s.instances.length > 0);
        }
      }
      // 환자 혼합 방지 — 암묵적 열기(더블클릭/내비)에서는 같은 환자 검사만 유지.
      // 다른 환자 비교는 명시적 동선(+Add/Stack/With Open/Compare)으로만.
      const explicit = !!(addDetail || stackDetail || (withOpen?.ids?.length ?? 0) || keySops?.length);
      if (!explicit) {
        const same = list.filter((e) => e.d.patient_key === detail.patient_key);
        if (same.length !== list.length) {
          list.splice(0, list.length, ...same);
          localStorage.setItem(EXAMS_KEY, JSON.stringify(list.map((e) => e.d.id)));
        }
      }
      setExams(list);
      const ai = Math.max(0, list.findIndex((e) => e.d.id === detail.id));
      setActiveExam(ai);
      setSeries(list[ai]?.series ?? []);
      // ③ Stack View: 페인을 늘리지 않고(1x1 유지) 활성 페인에 스택 검사를 중첩 — 탭으로 전환
      if (stackDetail) {
        const si = list.findIndex((e) => e.d.id === stackDetail.id);
        const st = list[si];
        setSLayout({ r: 1, c: 1 });
        setPanes([{ ...initPane(st?.d.study_uid ?? detail.study_uid), series: st?.series[0] ?? null }]);
        if (si >= 0) { setActiveExam(si); setSeries(st.series); }
        setActive(0);
        return;
      }
      // ①②: 페인 구성 — 단독 검사는 Modality 기본 레이아웃(설정) 우선, 다중 검사는 오른쪽 누적
      const single = list.length === 1;
      const mod = list[0]?.d.modality ?? "";
      const defCfg = single ? (defMap[mod] ?? defMap["*"]) : undefined;
      let r: number, c: number;
      if (defCfg?.s) { r = defCfg.s.r; c = defCfg.s.c; }
      else { const n = Math.max(1, list.length); c = Math.min(n, 4); r = Math.ceil(n / c); }
      setSLayout({ r, c });
      setPanes(Array.from({ length: r * c }, (_, i) => {
        if (single) {
          // 단독 검사: 페인마다 시리즈를 순서대로(부족하면 빈 페인), Image 레이아웃은 설정값
          const s0 = list[0].series[i] ?? null;
          const p = { ...initPane(list[0].d.study_uid), series: s0 };
          if (defCfg?.i) p.il = defCfg.i;
          else if (i === 0 && r * c === 1 && ["CT", "MR"].includes(mod)
                   && (list[0].series[0]?.instances.length ?? 0) >= 9) {
            p.il = { r: 3, c: 3 };   // 설정 없을 때 기본 행잉 (원본)
          }
          return p;
        }
        const ex = list[i];
        return ex ? { ...initPane(ex.d.study_uid), series: ex.series[0] ?? null } : initPane();
      }));
      setActive(ai);
    }).catch(() => {});
  }, [detail]);
  // Refresh Exam — 활성 검사 시리즈 재로드
  const loadSeries = () => {
    const ex = exams[activeExam];
    if (!ex) return;
    api.seriesTree(ex.d.id).then((t) => {
      setSeries(t.series);
      setExams((es) => es.map((e, i) => (i === activeExam ? { ...e, series: t.series } : e)));
    }).catch(() => {});
  };
  // 검사 닫기 — 누적 목록에서 제거 후 남은 검사로 재구성(전부 닫히면 워크리스트로)
  const closeExam = (i: number) => {
    const remain = exams.filter((_, k) => k !== i).map((e) => e.d.id);
    localStorage.setItem(EXAMS_KEY, JSON.stringify(remain));
    if (!remain.length) {
      gotoWorklist();
      window.close();
      onClose();
    } else {
      location.search = `?viewer=2d&study=${remain[remain.length - 1]}`;
    }
  };
  const curD = exams[activeExam]?.d ?? detail;
  const wlPresets = curD.modality === "MR" ? IN_WL_PRESETS_MR : IN_WL_PRESETS_CT;

  const applySLayout = (l: { r: number; c: number }) => {
    setSLayout(l);
    setMaximized(null);
    setPanes((ps) => {
      // 시리즈가 레이아웃보다 적으면 순환 반복하지 않고 빈 페인으로 둔다.
      // 유지되는 기존 페인이 이미 보여주는 시리즈는 건너뛰고 다음 미표시 시리즈를 순서대로 배치.
      const n = l.r * l.c;
      const used = new Set(
        ps.slice(0, n).map((p) => p?.series?.series_uid).filter(Boolean) as string[]);
      let cursor = 0;
      return Array.from({ length: n }, (_, i) => {
        if (ps[i]) return ps[i];
        while (cursor < series.length && used.has(series[cursor].series_uid)) cursor += 1;
        const s = series[cursor] ?? null;
        if (s) { used.add(s.series_uid); cursor += 1; }
        return { ...initPane(detail.study_uid), series: s };
      });
    });
  };
  // 과거검사 시리즈 로드 (Related Exam 버튼)
  const loadPrior = (reId: number, uid: string, label: string) => {
    if (priorLoaded.has(reId)) return;
    api.seriesTree(reId).then((r) => {
      setPriorLoaded((s) => new Set(s).add(reId));
      setPriorSeries((ps) => [...ps, ...r.series.map((s) => ({ uid, label, s }))]);
    }).catch(() => {});
  };
  const upd = useCallback((i: number, patch: Partial<Pane>) => {
    setPanes((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  }, []);

  // ── 멀티 페인 선택 (Crosslink 연동 조작) ──
  // Shift+클릭=처음~클릭 페인 범위, Ctrl+클릭=활성+클릭 페인 토글, 'A'=전체 선택.
  // 선택된 페인들은 Zoom/Pan/W-L(드래그·프리셋·툴)이 함께 동작. 휠 스크롤은 기존(다음 이미지).
  const [selPanes, setSelPanes] = useState<Set<number>>(new Set());
  const updMany = useCallback((idxs: number[], f: (p: Pane) => Partial<Pane>) => {
    setPanes((ps) => ps.map((p, k) => (idxs.includes(k) && p.series ? { ...p, ...f(p) } : p)));
  }, []);
  const targetsOf = (pi: number): number[] =>
    xlink.crosslink && selPanes.size > 1 && selPanes.has(pi) ? [...selPanes] : [pi];

  const scroll = useCallback((i: number, delta: number) => {
    setPanes((ps) => ps.map((p, k) => {
      // §3.3: crosslink 마스터 ON 일 때 — auto_sync=같은 검사 페인, sync_other=다른 검사(과거) 페인 동기
      const sameExam = p.studyUid === ps[i]?.studyUid;
      const linked = xlink.crosslink && ((xlink.auto_sync && sameExam) || (xlink.sync_other && !sameExam));
      if (!(k === i || (linked && p.series)) || !p.series) return p;
      const max = Math.max(0, p.series.instances.length - 1);
      return { ...p, index: Math.min(max, Math.max(0, p.index + delta)) };
    }));
  }, [xlink.crosslink, xlink.auto_sync, xlink.sync_other]);

  useEffect(() => {
    if (!cine) return;
    const t = setInterval(() => {
      setPanes((ps) => ps.map((p, k) => {
        if (k !== active || !p.series) return p;
        return { ...p, index: (p.index + p.il.r * p.il.c) % p.series.instances.length };
      }));
    }, 150);
    return () => clearInterval(t);
  }, [cine, active]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  const fire = (id: string) => {
    const p = panes[active];
    if (!p) return;
    switch (id) {
      case "fit": updMany(targetsOf(active), () => ({ zoom: 1, tx: 0, ty: 0 })); break;
      case "invert": updMany(targetsOf(active), (q) => ({ invert: !q.invert })); break;
      case "flipH": updMany(targetsOf(active), (q) => ({ flipH: !q.flipH })); break;
      case "flipV": updMany(targetsOf(active), (q) => ({ flipV: !q.flipV })); break;
      case "rotL": updMany(targetsOf(active), (q) => ({ rot: (q.rot + 270) % 360 })); break;
      case "rotR": updMany(targetsOf(active), (q) => ({ rot: (q.rot + 90) % 360 })); break;
      case "rot180": updMany(targetsOf(active), (q) => ({ rot: (q.rot + 180) % 360 })); break;
      case "sharpen": upd(active, { fx: p.fx === "sharpen" ? "" : "sharpen" }); break;
      case "smooth": upd(active, { fx: p.fx === "smooth" ? "" : "smooth" }); break;
      case "pseudo": upd(active, { fx: p.fx === "pseudo" ? "" : "pseudo" }); break;
      case "key2d": {   // F-16: 현재 이미지 키이미지 토글 → DB(study.key_images) 저장
        const inst = p.series?.instances[p.index];
        if (!p.series || !inst) break;
        const exd = exams.find((e) => e.d.study_uid === p.studyUid)?.d ?? curD;
        api.instances(exd.id).then((r) => {
          const cur = r.key_images ?? [];
          const exists = cur.some((k) => k.sop_uid === inst.sop_uid);
          const next = exists
            ? cur.filter((k) => k.sop_uid !== inst.sop_uid)
            : [...cur, { sop_uid: inst.sop_uid, orthanc_id: inst.orthanc_id,
                         instance_number: inst.instance_number }];
          return api.setKeyImages(exd.id, next).then(() =>
            say(exists ? `🔑 키이미지 해제 — 남은 ${next.length}장`
                       : `🔑 키이미지 등록 (${next.length}장) — 워크리스트에 🔑 표시`));
        }).catch(() => say("키이미지 저장 실패"));
        break;
      }
      case "reset": upd(active, { ...initPane(), series: p.series, index: p.index }); break;
      case "cine": setCine((c) => !c); break;
      case "print": window.print(); break;
      case "refreshExam": loadSeries(); say("검사 정보를 갱신했습니다"); break;
      case "clrAnno":
        setAnnos({}); setPend(null); setCross3d({});
        setPanes((ps) => ps.map((q) => ({ ...q, shutter: null })));
        say("측정·주석·셔터를 모두 지웠습니다");
        break;
      case "selAll":   // Select All — 모든 페인 선택 (키 'A' 와 동일)
        setSelPanes(new Set(panes.map((_, k) => k)));
        break;
      case "selInv":   // Select All Inverse — 선택 반전
        setSelPanes((prev) => new Set(panes.map((_, k) => k).filter((k) => !prev.has(k))));
        break;
      case "anno3d":   // 3D 주석은 3D 뷰어(Crosshair)에서 — 뷰어 호출
        setShow3d(true);
        break;
      case "dictation": {   // 음성 녹음 시작/정지 (세션 보관 — 서버 저장은 차기)
        if (recording) {
          recRef.current?.stop();
          break;
        }
        navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
          const chunks: BlobPart[] = [];
          const mr = new MediaRecorder(stream);
          mr.ondataavailable = (ev) => chunks.push(ev.data);
          mr.onstop = () => {
            audioRef.current[curD.id] = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
            stream.getTracks().forEach((t) => t.stop());
            setRecording(false);
            say("🎙 녹음 저장됨 — 🔊 로 재생 (세션 보관)");
          };
          mr.start();
          recRef.current = mr;
          setRecording(true);
          say("🎙 녹음 중… 다시 누르면 정지");
        }).catch(() => say("마이크 권한이 필요합니다"));
        break;
      }
      case "playdict": {
        const blob = audioRef.current[curD.id];
        if (!blob) { say("이 검사의 녹음이 없습니다"); break; }
        void new Audio(URL.createObjectURL(blob)).play();
        break;
      }
      case "calibrate": {
        const inst = p.series?.instances[p.index];
        const sp = inst?.pixel_spacing;
        say(sp?.length === 2
          ? `Pixel Spacing: ${sp[0].toFixed(3)} × ${sp[1].toFixed(3)} mm (${inst!.rows}×${inst!.cols}px)`
          : "Pixel Spacing 정보 없음 — 측정은 px 단위로 표시");
        break;
      }
      case "capture": {
        const inst = p.series?.instances[p.index];
        if (p.series && inst) {
          const a = document.createElement("a");
          a.href = instUrl(p.studyUid || detail.study_uid, p.series, inst, p.wl);
          a.download = "capture.png"; a.click();
        }
        break;
      }
      default: {
        const item = PALETTE.find((t) => t.id === id);
        if (["select", "pan", "zoom", "wl"].includes(id) || item?.mode) {
          setTool(id as Tool);
          setPend(null);
          const hint = item?.label?.split("—")[1]?.trim();
          if (hint) say(hint);
        }
      }
    }
  };

  // ── 점 클릭형 툴 공통: 화면좌표 → 이미지 픽셀좌표 (fit 배치 + zoom/pan 역변환, rot/flip 미적용 전제) ──
  const addAnno = (sop: string, a: Anno2) =>
    setAnnos((prev) => ({ ...prev, [sop]: [...(prev[sop] ?? []), a] }));

  const finishTool = (pi: number, p: Pane, inst: InstanceNode, pts: { x: number; y: number }[]) => {
    const sop = inst.sop_uid;
    const url = p.series ? instUrl(p.studyUid || curD.study_uid, p.series, inst, p.wl) : "";
    const sp = inst.pixel_spacing?.length === 2 ? inst.pixel_spacing : null;
    switch (tool) {
      // ── 주석 ──
      case "mline": addAnno(sop, { kind: "line", pts }); break;
      case "mangle": addAnno(sop, { kind: "angle", pts }); break;
      case "arrow2d": addAnno(sop, { kind: "arrow", pts }); break;
      case "circle": addAnno(sop, { kind: "circle", pts }); break;
      case "polyline": addAnno(sop, { kind: "poly", pts }); break;
      case "cobb": addAnno(sop, { kind: "cobb", pts }); break;
      case "centerline": addAnno(sop, { kind: "centerline", pts }); break;
      case "limb": addAnno(sop, { kind: "limb", pts }); break;
      case "ctr": addAnno(sop, { kind: "ctr", pts }); break;
      case "text2d": {
        const text = prompt("표시할 문구");
        if (text) addAnno(sop, { kind: "text", pts, text });
        break;
      }
      case "marking": {
        const text = prompt("Marking (짧은 표기, 예: ①, R, ✓)");
        if (text) addAnno(sop, { kind: "marking", pts, text });
        break;
      }
      case "box2d": {
        const text = prompt("메모 제목");
        if (text !== null) addAnno(sop, { kind: "box", pts, text: text || "" });
        break;
      }
      case "spine": {
        if (spineSeq.current.n === 1) {
          const base = prompt("시작 라벨 (예: C1, T1, L1)", "L1");
          if (!base) break;
          const m = base.match(/^([A-Za-z]+)(\d+)$/);
          spineSeq.current = m ? { base: m[1].toUpperCase(), n: Number(m[2]) } : { base: base.toUpperCase(), n: 1 };
        }
        addAnno(sop, { kind: "spine", pts, text: `${spineSeq.current.base}${spineSeq.current.n}` });
        spineSeq.current.n += 1;
        break;
      }
      // ── 셔터 (페인 표시 가림) ──
      case "shutRect": upd(pi, { shutter: { kind: "rect", pts } }); say("사각 셔터 적용 — 🧹로 해제"); break;
      case "shutEl": upd(pi, { shutter: { kind: "ellipse", pts } }); say("타원 셔터 적용 — 🧹로 해제"); break;
      case "shutPoly": upd(pi, { shutter: { kind: "poly", pts } }); say("다각 셔터 적용 — 🧹로 해제"); break;
      // ── 3D Cursor: 클릭 지점을 모든 페인의 동일 3D 위치로 ──
      case "cursor3d": {
        const g = geomOf(inst);
        if (!g) { say("기하 정보가 없어 3D Cursor 를 쓸 수 없습니다"); break; }
        const P: number[] = [0, 1, 2].map((k) =>
          g.pos[k] + pts[0].x * g.cs * g.row[k] + pts[0].y * g.rs * g.col[k]);
        const markers: Record<number, { sop: string; x: number; y: number }> = {};
        setPanes((ps) => ps.map((q, k) => {
          const s = q.series;
          if (!s) return q;
          let best = -1, bd = Infinity;
          for (let idx = 0; idx < s.instances.length; idx++) {
            const qg = geomOf(s.instances[idx]);
            if (!qg) continue;
            const nl = Math.hypot(...qg.n) || 1;
            const d = Math.abs(vdot(qg.n, vsub(P, qg.pos))) / nl;
            if (d < bd) { bd = d; best = idx; }
          }
          if (best < 0) return q;
          const bi = s.instances[best];
          const bg = geomOf(bi)!;
          const dvec = vsub(P, bg.pos);
          markers[k] = { sop: bi.sop_uid, x: vdot(dvec, bg.row) / bg.cs, y: vdot(dvec, bg.col) / bg.rs };
          return { ...q, index: best };
        }));
        setCross3d(markers);
        break;
      }
      // ── 픽셀값 계열 (렌더 8bit 근사 — W/L 역변환 '≈' 표기) ──
      case "lens": {
        void samplePixels(url, inst.cols || 1, inst.rows || 1).then((data) => {
          if (!data) { say("픽셀 샘플 실패(CORS)"); return; }
          const x = Math.round(pts[0].x), y = Math.round(pts[0].y);
          const v = rawOf(data.data[(Math.max(0, Math.min(data.height - 1, y)) * data.width +
                                     Math.max(0, Math.min(data.width - 1, x))) * 4], p.wl);
          addAnno(sop, { kind: "lens", pts, value: `≈${v.toFixed(0)}` });
        });
        break;
      }
      case "mellipse": case "mrect": {
        const ell = tool === "mellipse";
        void samplePixels(url, inst.cols || 1, inst.rows || 1).then((data) => {
          if (!data) { say("픽셀 샘플 실패(CORS)"); return; }
          const st = roiStats(data, pts[0].x, pts[0].y, pts[1].x, pts[1].y, ell, p.wl);
          if (!st) return;
          const areaMm = sp
            ? Math.abs((pts[1].x - pts[0].x) * sp[1] * (pts[1].y - pts[0].y) * sp[0]) * (ell ? Math.PI / 4 : 1)
            : 0;
          const area = areaMm ? ` · ${(areaMm / 100).toFixed(2)}cm²` : "";
          addAnno(sop, { kind: ell ? "mellipse" : "mrect", pts,
                         value: `≈${st.mean.toFixed(0)}±${st.sd.toFixed(0)} [${st.mn.toFixed(0)}~${st.mx.toFixed(0)}]${area}` });
        });
        break;
      }
      case "profile": {
        void samplePixels(url, inst.cols || 1, inst.rows || 1).then((data) => {
          if (!data) { say("픽셀 샘플 실패(CORS)"); return; }
          const N = 80;
          const vals: number[] = [];
          for (let k = 0; k <= N; k++) {
            const x = Math.round(pts[0].x + (pts[1].x - pts[0].x) * (k / N));
            const y = Math.round(pts[0].y + (pts[1].y - pts[0].y) * (k / N));
            if (x < 0 || y < 0 || x >= data.width || y >= data.height) { vals.push(0); continue; }
            vals.push(rawOf(data.data[(y * data.width + x) * 4], p.wl));
          }
          addAnno(sop, { kind: "profile", pts, vals } as Anno2 & { vals: number[] });
        });
        break;
      }
      case "table2d": {
        void samplePixels(url, inst.cols || 1, inst.rows || 1).then((data) => {
          if (!data) { say("픽셀 샘플 실패(CORS)"); return; }
          const x0 = Math.floor(Math.min(pts[0].x, pts[1].x)), x1 = Math.ceil(Math.max(pts[0].x, pts[1].x));
          const y0 = Math.floor(Math.min(pts[0].y, pts[1].y)), y1 = Math.ceil(Math.max(pts[0].y, pts[1].y));
          const step = Math.max(1, Math.ceil(Math.max(x1 - x0, y1 - y0) / 14));   // 최대 ~14×14
          const rows: string[][] = [];
          for (let y = y0; y <= y1; y += step) {
            const row: string[] = [];
            for (let x = x0; x <= x1; x += step) {
              row.push(x < 0 || y < 0 || x >= data.width || y >= data.height ? "-"
                : rawOf(data.data[(y * data.width + x) * 4], p.wl).toFixed(0));
            }
            rows.push(row);
          }
          setTableData({ title: `2D Table ≈픽셀값 (${x0},${y0})~(${x1},${y1}) step ${step}`, rows });
        });
        break;
      }
    }
  };

  const measureClick = (e: React.MouseEvent, tileEl: HTMLElement, pi: number, p: Pane, inst: InstanceNode) => {
    const r = tileEl.getBoundingClientRect();
    const s0 = Math.min(r.width / (inst.cols || 1), r.height / (inst.rows || 1));
    const s = s0 * p.zoom;
    const ix = (e.clientX - (r.left + r.width / 2 + p.tx)) / s + inst.cols / 2;
    const iy = (e.clientY - (r.top + r.height / 2 + p.ty)) / s + inst.rows / 2;
    const cur = pend?.sop === inst.sop_uid ? pend.pts : [];
    const pts = [...cur, { x: ix, y: iy }];
    if (OPEN_ENDED.has(tool)) { setPend({ sop: inst.sop_uid, pts }); return; }   // 더블클릭 종료
    const need = TOOL_PTS[tool] ?? 2;
    if (pts.length >= need) {
      finishTool(pi, p, inst, pts);
      setPend(null);
    } else setPend({ sop: inst.sop_uid, pts });
  };

  // polyline/shutPoly 더블클릭 종료
  const finishOpenEnded = (pi: number, p: Pane, inst: InstanceNode) => {
    if (!OPEN_ENDED.has(tool) || !pend || pend.sop !== inst.sop_uid || pend.pts.length < 3) return false;
    finishTool(pi, p, inst, pend.pts);
    setPend(null);
    return true;
  };

  const onPaneMouseDown = (e: React.MouseEvent, i: number) => {
    if (e.shiftKey) {
      // 처음(첫 페인)부터 클릭한 페인까지 순서대로 범위 선택
      setSelPanes(new Set(Array.from({ length: i + 1 }, (_, k) => k)));
    } else if (e.ctrlKey) {
      // 활성 페인과 클릭한 페인을 크로스링크 집합으로 토글
      setSelPanes((s) => {
        const n = new Set(s.size ? s : [active]);
        if (n.has(i) && i !== active) n.delete(i); else n.add(i);
        return n;
      });
    } else if (selPanes.size && !selPanes.has(i)) {
      setSelPanes(new Set());   // 일반 클릭 — 선택 집합 밖이면 해제
    }
    setActive(i);
    const measuring = isPointTool(tool) && e.button === 0;
    if (!measuring && (e.button === 0 || e.button === 2)) {
      drag.current = { x: e.clientX, y: e.clientY, btn: e.button, pane: i };
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    const p = panes[d.pane];
    if (!p) return;
    const mode: Tool = d.btn === 2 ? "wl" : tool;
    const tg = targetsOf(d.pane);   // Crosslink 선택 집합이면 함께 조작
    if (mode === "pan") updMany(tg, (q) => ({ tx: q.tx + dx, ty: q.ty + dy }));
    else if (mode === "zoom") updMany(tg, (q) => ({ zoom: Math.max(0.05, Math.min(30, q.zoom * (1 - dy / 200))) }));
    else if (mode === "wl") {
      updMany(tg, (q) => {
        const [c0, w0] = q.wl ? q.wl.split(",").map(Number) : [128, 256];
        return { wl: `${Math.round(c0 + dy)},${Math.max(1, Math.round(w0 + dx))}` };
      });
    }
  };
  const endDrag = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent, i: number) => {
    if (tHeld.current) {   // T+스크롤 — 오버레이 글자 크기 (계정 저장)
      const nf = Math.min(24, Math.max(6, ovlFont + (e.deltaY < 0 ? 0.5 : -0.5)));
      setOvlFont(nf);
      persistPrefs({ infi_overlay_font: nf });
      return;
    }
    if (e.ctrlKey) {
      updMany(targetsOf(i), (q) =>
        ({ zoom: Math.max(0.05, Math.min(30, q.zoom * (e.deltaY < 0 ? 1.1 : 0.9))) }));
    } else {
      const p = panes[i];
      scroll(i, (e.deltaY > 0 ? 1 : -1) * (p && tilesOf(p) > 1 ? p.il.c : 1));
    }
  };

  const combine = () => {
    const all: InstanceNode[] = series.flatMap((s) => s.instances);
    if (!all.length) return;
    upd(active, {
      series: { series_uid: series[0].series_uid, modality: curD.modality,
                series_desc: `[Combine] ${series.length} series`, series_number: 0, instances: all },
      index: 0, studyUid: curD.study_uid,
    });
  };

  // Prev/Next(§3.1) — 워크리스트에서 현재 검사의 위/아래 검사를 이 창에서 열기
  const nav = async (dir: number) => {
    try {
      const r = await api.worklist({});
      const idx = r.items.findIndex((it) => it.id === curD.id);
      const nxt = idx >= 0 ? r.items[idx + dir] : undefined;
      if (nxt) location.search = `?viewer=2d&study=${nxt.id}`;
      else say(dir < 0 ? "워크리스트에 위 검사가 없습니다" : "워크리스트에 아래 검사가 없습니다");
    } catch { say("워크리스트 조회 실패"); }
  };
  // Worklist 버튼(§3.1) — 워크리스트 창을 최전면으로 (다른 모니터에 있어도)
  // named window 재-open 은 브라우저가 해당 창을 raise 한다 (opener.focus() 는 대부분 무시됨)
  const gotoWorklist = () => {
    const w = window.open("", "sv_worklist");
    if (w) {
      try {
        // 워크리스트가 닫혀 있어 빈 창이 새로 열린 경우 → 홈으로 이동
        if (w.location.href === "about:blank") w.location.href = `${window.location.origin}/`;
      } catch { /* 접근 제약 시 무시 */ }
      w.focus();
      return;
    }
    if (window.opener && !window.opener.closed) window.opener.focus();
    else window.open("/", "_blank");
  };
  // Report 버튼(§3.1) — 현재 검사 판독 도크
  useEffect(() => {
    if (!reportDock) return;
    api.reports(curD.id).then((r) => setReport(r.items[0] ?? null)).catch(() => setReport(null));
  }, [reportDock, curD.id]);

  const layoutLabel = (l: { r: number; c: number }) => `${l.r} x ${l.c}`;

  // ── 표시 설정 (계정별 viewer.prefs 로밍): 오버레이 글자 크기/표시, 멀티선택 색 ──
  // 단축키: T+마우스스크롤=글자 크기, T+Del=오버레이 숨김/표시 토글. 변경은 자동 저장.
  const [ovlFont, setOvlFont] = useState(9.5);
  const [ovlVisible, setOvlVisible] = useState(true);
  const [selColor, setSelColor] = useState("#d946ef");
  // 툴바 사용자화 — 설정에서 끈 툴은 팔레트에서 숨김 (viewer.prefs.infi_toolbar)
  const [tbShow, setTbShow] = useState<Record<string, boolean>>({});
  const tHeld = useRef(false);
  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    api.getSetting("viewer.prefs").then((r) => {
      const v = r.value as { infi_overlay_font?: number; infi_overlay_visible?: boolean;
                             infi_sel_color?: string; infi_toolbar?: Record<string, boolean> };
      if (v.infi_overlay_font) setOvlFont(v.infi_overlay_font);
      if (v.infi_overlay_visible !== undefined) setOvlVisible(v.infi_overlay_visible);
      if (v.infi_sel_color) setSelColor(v.infi_sel_color);
      if (v.infi_toolbar) setTbShow(v.infi_toolbar);
    }).catch(() => {});
  }, []);
  const persistPrefs = (patch: Record<string, unknown>) => {
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      api.getSetting("viewer.prefs").then((r) =>
        api.putSetting("viewer.prefs", { ...r.value, ...patch }, "user")).catch(() => {});
    }, 600);
  };

  // 기능 영역(툴바/썸네일/W-L/Report) 폭 — 경계 스플리터로 조절, localStorage 보존
  const UI_KEY = "sv_infi_ui";
  const [ui, setUi] = useState<{ toolW: number; thumbW: number; wlW: number; dockW: number }>(() => {
    const def = { toolW: 158, thumbW: 88, wlW: 108, dockW: 280 };   // 툴 아이콘+이름 행 기준
    try { return { ...def, ...JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") }; } catch { return def; }
  });
  const uiRef = useRef(ui);
  useEffect(() => { uiRef.current = ui; }, [ui]);
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(uiRef.current)); } catch { /* quota */ } };
  const clampW = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  // 페인 크기 분율(fr) — 경계 스플리터 드래그로 좌우(colFr)/상하(rowFr) 조절. 레이아웃 변경 시 초기화
  const vpRef = useRef<HTMLDivElement>(null);
  const [colFr, setColFr] = useState<number[]>([1]);
  const [rowFr, setRowFr] = useState<number[]>([1]);
  useEffect(() => {
    setColFr(Array(sLayout.c).fill(1));
    setRowFr(Array(sLayout.r).fill(1));
    setSelPanes(new Set());   // 레이아웃 변경 — 멀티 선택 초기화
  }, [sLayout.r, sLayout.c]);

  // 'A' = 전체 페인 선택, Esc = 해제, T(홀드)+스크롤 = 오버레이 글자 크기, T+Del = 오버레이 토글
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.toLowerCase() === "t") { tHeld.current = true; return; }
      if (e.key === "Delete" && tHeld.current) {
        e.preventDefault();
        setOvlVisible((v) => {
          persistPrefs({ infi_overlay_visible: !v });
          return !v;
        });
        return;
      }
      if (e.key.toLowerCase() === "a" && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setSelPanes(new Set(panes.map((_, i) => i)));
      } else if (e.key === "Escape") {
        setSelPanes(new Set());
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "t") tHeld.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes.length]);
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

  // Series 페인 렌더 — 뷰포트 중첩 flex(경계 스플리터) 안에서 사용
  const renderPane = (pi: number) => {
    const p = panes[pi];
    if (!p) return <div style={{ flex: 1 }} />;
    const insts = p.series?.instances ?? [];
    const wlText = p.wl ? p.wl.replace(",", " / ") : "기본";
    return (
      <div onMouseDown={(e) => onPaneMouseDown(e, pi)} onMouseMove={onMouseMove}
           onWheel={(e) => onWheel(e, pi)}
           onDoubleClick={() => {
             // 열린 다각(polyline/셔터) 진행 중이면 더블클릭=완료, 아니면 최대화 토글
             if (OPEN_ENDED.has(tool) && pend) {
               const inst2 = p.series?.instances.find((x) => x.sop_uid === pend.sop);
               if (inst2 && finishOpenEnded(pi, p, inst2)) return;
             }
             setMaximized((m) => (m === null ? pi : null));
           }}
           style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, background: "#000",
                    // 멀티 선택(Crosslink)=설정 색(기본 자주색), 활성=초록
                    outline: active === pi ? "2px solid #4ade80"
                      : selPanes.has(pi) ? `2px solid ${selColor}` : "1px solid #1e293b",
                    display: "grid", cursor: isPointTool(tool) ? "copy" : "crosshair",
                    gridTemplateColumns: `repeat(${p.il.c}, 1fr)`,
                    gridTemplateRows: `repeat(${p.il.r}, 1fr)`, gap: 1 }}>
        {Array.from({ length: tilesOf(p) }, (_, t) => {
          const idx = p.index + t;
          const inst = insts[idx];
          return (
            <div key={t} style={{ position: "relative", overflow: "hidden", background: "#000" }}
                 onMouseDown={(e) => {
                   if (isPointTool(tool) && e.button === 0 && p.series && inst) {
                     measureClick(e, e.currentTarget, pi, p, inst);
                   }
                 }}
                 onMouseMove={(e) => {   // Magnification — 마우스 따라 부분 확대경
                   if (tool !== "magnify" || !p.series || !inst) return;
                   const r = e.currentTarget.getBoundingClientRect();
                   const s0 = Math.min(r.width / (inst.cols || 1), r.height / (inst.rows || 1));
                   const s = s0 * p.zoom;
                   const ix = (e.clientX - (r.left + r.width / 2 + p.tx)) / s + inst.cols / 2;
                   const iy = (e.clientY - (r.top + r.height / 2 + p.ty)) / s + inst.rows / 2;
                   setMagPos({ pi, t, mx: e.clientX - r.left, my: e.clientY - r.top,
                               nx: ix / (inst.cols || 1), ny: iy / (inst.rows || 1), sc: s });
                 }}
                 onMouseLeave={() => { if (tool === "magnify") setMagPos(null); }}>
              {p.series && inst ? (() => {
                const pd = exams.find((e) => e.d.study_uid === p.studyUid)?.d ?? curD;
                return (
                <>
                  <img src={instUrl(p.studyUid || pd.study_uid, p.series, inst, p.wl)} alt="" draggable={false}
                       style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                                objectFit: "contain",
                                transform: `translate(${p.tx}px,${p.ty}px) scale(${p.zoom * (p.flipH ? -1 : 1)},${p.zoom * (p.flipV ? -1 : 1)}) rotate(${p.rot}deg)`,
                                filter: paneFilter(p), userSelect: "none" }} />
                  <TileAnno inst={inst} pane={p}
                            annos={annos[inst.sop_uid] ?? []}
                            pend={pend?.sop === inst.sop_uid ? pend.pts : []}
                            scout={scoutFor(inst, p.series.series_uid)}
                            shutter={p.shutter ?? undefined}
                            cross={cross3d[pi]?.sop === inst.sop_uid ? cross3d[pi] : undefined} />
                  {/* Magnification 확대경 — 마우스 위치 3배 확대 */}
                  {tool === "magnify" && magPos && magPos.pi === pi && magPos.t === t && (
                    <div style={{
                      position: "absolute", left: magPos.mx - 80, top: magPos.my - 80,
                      width: 160, height: 160, borderRadius: "50%", zIndex: 4, pointerEvents: "none",
                      border: "2px solid #38bdf8", backgroundColor: "#000", backgroundRepeat: "no-repeat",
                      backgroundImage: `url(${instUrl(p.studyUid || pd.study_uid, p.series, inst, p.wl)})`,
                      backgroundSize: `${(inst.cols || 1) * magPos.sc * 3}px ${(inst.rows || 1) * magPos.sc * 3}px`,
                      backgroundPosition:
                        `${80 - magPos.nx * (inst.cols || 1) * magPos.sc * 3}px ` +
                        `${80 - magPos.ny * (inst.rows || 1) * magPos.sc * 3}px`,
                      filter: p.invert ? "invert(1)" : undefined,
                    }} />
                  )}
                  {ovlVisible && (
                    <>
                      <div style={ovl("tl", ovlFont)}>{pd.patient_name}<br />{pd.patient_key}</div>
                      <div style={ovl("tr", ovlFont)}>{pd.modality} {pd.study_date}</div>
                      <div style={ovl("bl", ovlFont)}>Se:{p.series.series_number} Im:{idx + 1}/{insts.length}<br />W/L: {wlText}</div>
                      <div style={ovl("br", ovlFont)}>Zoom {(p.zoom * 100).toFixed(0)}%{p.fx ? ` · ${p.fx}` : ""}</div>
                    </>
                  )}
                </>
                );
              })() : p.series ? null : (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12 }}>
                  상단 썸네일에서 시리즈 선택
                </div>
              )}
            </div>
          );
        })}
        {insts.length > 1 && <ScrollBar index={p.index} total={insts.length} />}
      </div>
    );
  };

  // 썸네일 테두리 색 — 우선순위: 다중 선택(자주) > 활성(초록) > 출력 중(주황) > 기본
  const shownUids = new Set(panes.map((p) => p.series?.series_uid).filter(Boolean) as string[]);
  const selUids = new Set([...selPanes].map((i) => panes[i]?.series?.series_uid)
    .filter(Boolean) as string[]);
  const activeUid = panes[active]?.series?.series_uid;
  const thumbBorder = (uid: string, fallback: string) =>
    selUids.has(uid) ? `2px solid ${selColor}`
      : uid === activeUid ? "2px solid #4ade80"
      : shownUids.has(uid) ? "2px solid #f97316"
      : fallback;

  // 좌측 세로 썸네일 열 (원본 이미지4 — 툴바 옆 세로 스택)
  const thumbCol = (
    <div style={{ width: ui.thumbW, background: "var(--bg-canvas)", borderRight: "1px solid var(--border)",
                  overflowY: "auto", padding: 4, display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
      <button onClick={combine} title="Combine Series — 시리즈 결합" style={{ fontSize: 10.5 }}>Combine</button>
      {series.map((s, sIdx) => (
        <div key={s.series_uid}
             onClick={(e) => {
               // 썸네일에서도 다중 선택: Ctrl=해당 시리즈가 표시된 페인 토글, Shift=처음~클릭 시리즈의 페인 범위
               if (e.ctrlKey) {
                 const pi = panes.findIndex((p) => p.series?.series_uid === s.series_uid);
                 if (pi >= 0) {
                   setSelPanes((prev) => {
                     const n = new Set(prev.size ? prev : [active]);
                     if (n.has(pi) && pi !== active) n.delete(pi); else n.add(pi);
                     return n;
                   });
                 }
                 return;
               }
               if (e.shiftKey) {
                 const uids = new Set(series.slice(0, sIdx + 1).map((x) => x.series_uid));
                 setSelPanes(new Set(panes.map((p, k) => (p.series && uids.has(p.series.series_uid) ? k : -1))
                   .filter((k) => k >= 0)));
                 return;
               }
               upd(active, { series: s, index: 0, studyUid: curD.study_uid });
             }}
             title={`Se${s.series_number} · ${s.series_desc}\n(Ctrl=페인 선택 토글 · Shift=범위 선택)`}
             style={{ cursor: "pointer", textAlign: "center", fontSize: 10, flexShrink: 0,
                      border: thumbBorder(s.series_uid, "1px solid var(--border)"),
                      borderRadius: 3, background: "#000" }}>
          {s.instances[0] && (
            <img src={s.instances[0].preview_url} alt="" style={{ width: "100%", display: "block" }} />
          )}
          <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {s.series_number}/{s.instances.length}
          </div>
        </div>
      ))}
      {(curD.related_exams ?? []).map((re) => !priorLoaded.has(re.id) && (
        <button key={re.id} onClick={() => loadPrior(re.id, re.study_uid, re.study_date)}
                title={`과거검사 열기 — ${re.modality} ${re.study_desc}`}
                style={{ fontSize: 10, color: "#facc15" }}>
          +{re.study_date.slice(4)} {re.modality}
        </button>
      ))}
      {priorSeries.map((e) => (
        <div key={`${e.uid}-${e.s.series_uid}`}
             onClick={() => upd(active, { series: e.s, index: 0, studyUid: e.uid })}
             title={`[과거 ${e.label}] Se${e.s.series_number} · ${e.s.series_desc}`}
             style={{ cursor: "pointer", textAlign: "center", fontSize: 10, flexShrink: 0,
                      border: thumbBorder(e.s.series_uid, "1px solid #854d0e"),
                      borderRadius: 3, background: "#000" }}>
        {e.s.instances[0] && (
          <img src={e.s.instances[0].preview_url} alt="" style={{ width: "100%", display: "block" }} />
        )}
        <div style={{ color: "#facc15", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          P·{e.label.slice(4)}
        </div>
        </div>
      ))}
    </div>
  );

  // §3.3 ④⑤ Scout lines — 활성 페인 시리즈의 절단선을 다른 시리즈 타일에 투영
  // (scout=현재 이미지 1선, all_lines=시리즈 전체. 같은 시리즈·평행 평면은 제외)
  const scoutFor = (tileInst: InstanceNode, tileSeriesUid: string) => {
    if (!xlink.scout && !xlink.all_lines) return [];
    const tg = geomOf(tileInst);
    if (!tg) return [];
    const act = panes[active];
    const out: { x1: number; y1: number; x2: number; y2: number;
                 current: boolean; cross?: boolean; label?: string }[] = [];
    // 1) 활성(기준) 시리즈의 절단선 — 다른 시리즈 타일 위 (노랑=현재, 파랑=All Lines)
    if (act?.series && act.series.series_uid !== tileSeriesUid) {
      const srcs = xlink.all_lines ? act.series.instances
        : act.series.instances[act.index] ? [act.series.instances[act.index]] : [];
      const total = act.series.instances.length;
      srcs.forEach((si, k) => {
        const sg = geomOf(si);
        if (!sg) return;
        const seg = scoutSegment(sg, tg);
        if (!seg) return;
        const current = xlink.all_lines ? k === act.index : true;
        out.push({ ...seg, current,
                   label: current ? `${act.index + 1}/${total}` : undefined });   // "현재/전체"
      });
    }
    // 2) 상호 참조(십자) — §3.3 ① 'Crosslink'는 다중 이미지 연동의 마스터.
    //    따라서 Crosslink ON 일 때만, 기준 페인 자신·평행 평면 페인에 다른 페인들의
    //    현재 이미지 절단선을 축별 1개 표시. (Scout Line 단독 ON = 기준 이미지 선만)
    if (!out.length && xlink.crosslink) {
      const seen = new Set([tileSeriesUid]);
      const usedAxis = new Set<number>([axisOf(tg)]);   // 자기 축(평행)은 제외
      const order = panes.map((_, k) => k)
        .sort((a, b) => Number(selPanes.has(b)) - Number(selPanes.has(a)));   // 다중 선택 페인 우선
      for (const k of order) {
        const q = panes[k];
        const s = q?.series;
        if (!s || seen.has(s.series_uid)) continue;
        seen.add(s.series_uid);
        const qi = s.instances[q.index];
        if (!qi) continue;
        const qg = geomOf(qi);
        if (!qg) continue;
        const ax = axisOf(qg);
        if (usedAxis.has(ax)) continue;   // 같은 축 평면은 1개만
        const seg = scoutSegment(qg, tg);
        if (!seg) continue;
        usedAxis.add(ax);
        out.push({ ...seg, current: false, cross: true,
                   label: `${q.index + 1}/${s.instances.length}` });
      }
    }
    return out;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#000", color: "var(--text-secondary)" }}
         onContextMenu={(e) => e.preventDefault()} onMouseUp={endDrag} onMouseLeave={endDrag}>
      {/* CSS 선예화 필터 정의 (Sharpens Filter — feConvolveMatrix) */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="in-sharpen">
          <feConvolveMatrix order="3" kernelMatrix="0 -1 0 -1 5 -1 0 -1 0" preserveAlpha="true" />
        </filter>
      </svg>

      {/* ── 상단 헤더 (원본 이미지3: 로고 + 환자 블록(노랑 ID/초록 이름) + 검사 탭) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "3px 10px",
                    background: "#0b0f14", borderBottom: "1px solid var(--border)", flexShrink: 0, fontSize: 11.5 }}>
        <b style={{ color: "var(--text-primary)", fontSize: 12.5 }}>
          ◈ Saintview <span style={{ color: "var(--accent)" }}>In Viewer</span>
        </b>
        <span style={{ lineHeight: 1.2 }}>
          <span style={{ color: "#facc15" }}>{curD.patient_key}</span>{" "}
          <span style={{ color: "#4ade80" }}>{curD.patient_name}</span>{" "}
          <span>[{curD.sex}]</span>
        </span>
        {/* Exam 탭 — 연 검사들이 오른쪽으로 누적. 클릭=활성 전환, ✕=그 검사만 닫기 */}
        {exams.map((e, i) => (
          <span key={e.d.id} title={`${e.d.patient_name} · ${e.d.study_desc}`}
                onClick={() => {
                  setActiveExam(i);
                  setSeries(e.series);
                  const pi = panes.findIndex((p) => p.studyUid === e.d.study_uid);
                  if (pi >= 0) setActive(pi);
                }}
                style={{ border: `1px solid ${i === activeExam ? "var(--accent)" : "var(--border)"}`,
                         borderRadius: 4, padding: "1px 8px", cursor: "pointer",
                         background: i === activeExam ? "var(--bg-elevated)" : "transparent",
                         fontSize: 10.5, lineHeight: 1.25 }}>
            {e.d.modality}(Original) {e.d.patient_name}<br />
            {e.d.study_date} {(e.d.study_desc ?? "").slice(0, 14)}
            <span onClick={(ev) => { ev.stopPropagation(); closeExam(i); }}
                  title="이 검사 닫기" style={{ marginLeft: 6, color: "var(--stat-emergency)" }}>✕</span>
          </span>
        ))}
      </div>

      {/* ── 정보바 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "3px 10px",
                    background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", fontSize: 12, flexShrink: 0 }}>
        <span style={{ color: "#4ade80" }}>
          Examined, {curD.study_date}, {curD.patient_name}, {curD.patient_key}
        </span>
        <span style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 10 }}>
          Series
          <select value={layoutLabel(sLayout)} title="화면을 시리즈 페인으로 분할 (DICOM Series 단위)"
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      const res = askLayout(sLayout);
                      if (res) applySLayout(res);
                      return;
                    }
                    const [r, c] = e.target.value.split(" x ").map(Number);
                    applySLayout({ r, c });
                  }} style={{ fontSize: 11 }}>
            {IN_LAYOUTS.map((l) => <option key={layoutLabel(l)}>{layoutLabel(l)}</option>)}
            {!IN_LAYOUTS.some((l) => layoutLabel(l) === layoutLabel(sLayout)) && (
              <option>{layoutLabel(sLayout)}</option>
            )}
            <option value="custom">직접 입력(00 x 00)…</option>
          </select>
          Image
          <select value={layoutLabel(panes[active]?.il ?? { r: 1, c: 1 })}
                  title="선택된 페인 안에서 해당 시리즈의 연속 이미지를 타일로 분할 (DICOM Image 단위, 페인별 적용)"
                  onChange={(e) => {
                    const cur = panes[active]?.il ?? { r: 1, c: 1 };
                    if (e.target.value === "custom") {
                      const res = askLayout(cur);
                      if (res) upd(active, { il: res });
                      return;
                    }
                    const [r, c] = e.target.value.split(" x ").map(Number);
                    upd(active, { il: { r, c } });
                  }} style={{ fontSize: 11 }}>
            {IN_LAYOUTS.map((l) => <option key={layoutLabel(l)}>{layoutLabel(l)}</option>)}
            {!IN_LAYOUTS.some((l) => layoutLabel(l) === layoutLabel(panes[active]?.il ?? { r: 1, c: 1 })) && (
              <option>{layoutLabel(panes[active]?.il ?? { r: 1, c: 1 })}</option>
            )}
            <option value="custom">직접 입력(00 x 00)…</option>
          </select>
          <button title="3D — 현재 검사의 MPR/MIP 볼륨 뷰어 열기"
                  onClick={() => setShow3d(true)}
                  style={{ marginLeft: 8, padding: "2px 12px", fontSize: 12, fontWeight: 700 }}>
            3D
          </button>
          <button title="Compare — 같은 환자의 과거검사를 골라 나란히 비교(동기 스크롤)"
                  onClick={() => { setCmpSel(new Set()); setCmpOpen(true); }}
                  style={{ marginLeft: 4, padding: "2px 12px", fontSize: 12, fontWeight: 700 }}>
            ⇄ Compare
          </button>
        </span>
        {toast && <span style={{ color: "#facc15" }}>{toast}</span>}
        <span style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {IN_CROSSLINK_MODES.map((m) => (
            <label key={m.key} title={m.desc}
                   style={{ display: "flex", gap: 3, alignItems: "center",
                            opacity: m.key === "crosslink" || xlink.crosslink || ["scout", "all_lines"].includes(m.key) ? 1 : 0.45 }}>
              <input type="checkbox" checked={!!xlink[m.key]}
                     onChange={(e) => setXlink((x) => ({ ...x, [m.key]: e.target.checked }))} />
              {m.label}
            </label>
          ))}
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ── 좌측 2열 아이콘 툴바 (p.11~14 전 툴) ── */}
        <div style={{ width: ui.toolW, background: "var(--bg-panel)", borderRight: "1px solid var(--border)",
                      display: "flex", flexDirection: "column", padding: "6px 5px", gap: 5, flexShrink: 0 }}>
          {/* §3.1 툴바 상단(원본 이미지2): Prev/Next · Crosslink · 행잉 · Worklist/Report · Close */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button title="Prev — 워크리스트의 위 검사 열기" onClick={() => void nav(-1)}
                    style={{ fontSize: 16, padding: "3px 12px" }}>◀</button>
            <span style={{ fontSize: 18 }}>👤</span>
            <button title="Next — 워크리스트의 아래 검사 열기" onClick={() => void nav(1)}
                    style={{ fontSize: 16, padding: "3px 12px" }}>▶</button>
          </div>
          <button title="Crosslink 마스터 토글 (§3.3)"
                  onClick={() => setXlink((x) => ({ ...x, crosslink: !x.crosslink }))}
                  style={{ fontSize: 12.5, padding: "5px 0", background: xlink.crosslink ? "var(--accent)" : undefined,
                           color: xlink.crosslink ? "#fff" : undefined }}>
            ⛓ Crosslink
          </button>
          <select title="행잉 프로토콜 (Default hanging protocol)" defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "stack") { applySLayout({ r: 1, c: 1 }); upd(0, { il: { r: 1, c: 1 } }); }
                    else if (v === "tile") { applySLayout({ r: 1, c: 1 }); upd(0, { il: { r: 3, c: 3 } }); }
                    else if (v === "cmp") applySLayout({ r: 1, c: 2 });
                    e.target.value = "";
                  }} style={{ fontSize: 10 }}>
            <option value="" disabled>Default …</option>
            <option value="stack">Stack 1x1</option>
            <option value="tile">Tile 3x3</option>
            <option value="cmp">Compare 1x2</option>
          </select>
          <div style={{ display: "flex", gap: 2 }}>
            <button title="Worklist — 워크리스트 화면 열기" onClick={gotoWorklist}
                    style={{ flex: 1, fontSize: 18, padding: "5px 0" }}>🗂</button>
            <button title="Report 도크 — 판독 요약 패널 열기/닫기" onClick={() => setReportDock((v) => !v)}
                    style={{ flex: 1, fontSize: 18, padding: "5px 0", background: reportDock ? "var(--accent)" : undefined }}>📄</button>
            <button title="Report 창 — 판독 작성 창(별도 웹창) 열기"
                    onClick={() => {
                      const w = window.open(
                        `${window.location.origin}${window.location.pathname}?report=1&study=${curD.id}`,
                        "sv_report", "width=1280,height=860");
                      w?.focus();
                    }}
                    style={{ flex: 1, fontSize: 18, padding: "5px 0" }}>📝</button>
          </div>
          <span style={{ position: "relative" }}>
            <button title="Close — 검사 닫기(현재/전체) 후 워크리스트로" onClick={() => setCloseMenu((v) => !v)}
                    style={{ width: "100%", fontSize: 12.5, padding: "5px 0" }}>⊠ Close</button>
            {closeMenu && (
              <div style={{ position: "absolute", left: 0, top: "105%", zIndex: 30, background: "var(--bg-elevated)",
                            border: "1px solid var(--border)", borderRadius: 4, minWidth: 150, fontSize: 11.5 }}>
                {[["현재 검사 닫기", () => closeExam(activeExam)],
                  ["모든 검사 닫기", () => {
                    localStorage.removeItem(EXAMS_KEY); gotoWorklist(); window.close(); onClose();
                  }]].map(([label, fn]) => (
                  <div key={label as string} onClick={fn as () => void}
                       style={{ padding: "5px 8px", cursor: "pointer" }}>{label as string}</div>
                ))}
              </div>
            )}
          </span>
          <div style={{ borderTop: "1px solid var(--border)" }} />
          {/* 툴 목록 — 아이콘(입체) + 이름 행 (첨부 레퍼런스 디자인) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
            {PALETTE.filter((t) => tbShow[t.id] !== false).map((t) => {
              const activeBtn = (t.mode && tool === t.id) || (t.id === "cine" && cine)
                || (["sharpen", "smooth", "pseudo"].includes(t.id) && panes[active]?.fx === t.id)
                || (t.id === "dictation" && recording);
              const name = t.label.split("—")[0].trim();
              return (
                <button key={t.id} title={t.label} onClick={() => t.impl && fire(t.id)}
                        style={{ display: "flex", alignItems: "center", gap: 8, height: 32,
                                 padding: "0 5px", textAlign: "left",
                                 opacity: t.impl ? 1 : 0.32,
                                 background: activeBtn ? "rgba(56,189,248,0.16)" : "transparent",
                                 color: activeBtn ? "var(--text-primary)" : "var(--text-secondary)",
                                 border: "none", borderRadius: 6,
                                 cursor: t.impl ? "pointer" : "default" }}>
                  {/* 3D(입체) 아이콘 칩 — 볼록(기본) / 눌림(활성) */}
                  <span style={{
                    width: 26, height: 26, flexShrink: 0, display: "grid", placeItems: "center",
                    fontSize: 13.5, borderRadius: 7,
                    color: activeBtn ? "#fff" : "#cbd5e1",
                    background: activeBtn
                      ? "linear-gradient(145deg, #1e40af, #38bdf8)"
                      : "linear-gradient(145deg, #3b4759, #171d29)",
                    boxShadow: activeBtn
                      ? "inset 2px 2px 5px rgba(0,0,0,0.55), inset -1px -1px 2px rgba(255,255,255,0.15)"
                      : "2.5px 2.5px 5px rgba(0,0,0,0.55), -1.5px -1.5px 3px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.14)",
                    textShadow: "0 1.5px 2px rgba(0,0,0,0.85)",
                  }}>{t.icon}</span>
                  <span style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis",
                                 whiteSpace: "nowrap" }}>{name}</span>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            <button title="W/L Preset 패널 토글" onClick={() => setWlPanel((v) => !v)}
                    style={{ fontSize: 12.5, padding: "5px 0", background: wlPanel ? "var(--accent)" : undefined,
                             color: wlPanel ? "#fff" : undefined }}>
              W/L
            </button>
            <button title="Setting — 뷰어 설정 창 열기 (워크리스트의 설정과 동일)"
                    onClick={() => setSettingsOpen(true)}
                    style={{ fontSize: 12.5, padding: "5px 0", background: settingsOpen ? "var(--accent)" : undefined,
                             color: settingsOpen ? "#fff" : undefined }}>
              Setting
            </button>
          </div>
        </div>

        {/* 툴바 ↔ 썸네일 폭 조절 */}
        <Splitter dir="v" onEnd={saveUi}
                  onDrag={(dx) => setUi((u) => ({ ...u, toolW: clampW(u.toolW + dx, 72, 240) }))} />

        {/* ── 세로 시리즈 썸네일 열 (원본 이미지4) ── */}
        {thumbCol}

        {/* 썸네일 ↔ 뷰포트 폭 조절 */}
        <Splitter dir="v" onEnd={saveUi}
                  onDrag={(dx) => setUi((u) => ({ ...u, thumbW: clampW(u.thumbW + dx, 56, 260) }))} />

        {/* ── 뷰포트: Series 페인 — 경계 스플리터로 좌우/상하 크기 조절 ── */}
        <div ref={vpRef} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          {(maximized !== null
            ? [[maximized]]
            : Array.from({ length: sLayout.r }, (_, ri) =>
                Array.from({ length: sLayout.c }, (_, ci) => ri * sLayout.c + ci))
          ).map((rowPanes, ri) => (
            <Fragment key={ri}>
              {ri > 0 && (
                <Splitter dir="h" onEnd={() => {}}
                          onDrag={(dy) => adjFr(setRowFr, ri - 1, dy, vpRef.current?.clientHeight ?? 600)} />
              )}
              <div style={{ display: "flex", flex: maximized !== null ? 1 : (rowFr[ri] ?? 1), minHeight: 0, minWidth: 0 }}>
                {rowPanes.map((pi, ci) => (
                  <Fragment key={pi}>
                    {ci > 0 && (
                      <Splitter dir="v" onEnd={() => {}}
                                onDrag={(dx) => adjFr(setColFr, ci - 1, dx, vpRef.current?.clientWidth ?? 800)} />
                    )}
                    <div style={{ flex: maximized !== null ? 1 : (colFr[ci] ?? 1),
                                  minWidth: 0, minHeight: 0, display: "flex" }}>
                      {renderPane(pi)}
                    </div>
                  </Fragment>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
        {/* ── W/L Preset 패널 (Setting 토글) ── */}
        {wlPanel && (
          <Splitter dir="v" onEnd={saveUi}
                    onDrag={(dx) => setUi((u) => ({ ...u, wlW: clampW(u.wlW - dx, 80, 260) }))} />
        )}
        {wlPanel && (
          <div style={{ width: ui.wlW, background: "var(--bg-panel)", borderLeft: "1px solid var(--border)",
                        padding: 6, overflowY: "auto", fontSize: 11.5, flexShrink: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>
              W/L ({detail.modality === "MR" ? "MR" : "CT"})
            </div>
            {wlPresets.map((w) => (
              <div key={w.key} onClick={() => updMany(targetsOf(active), () => ({ wl: w.q }))}
                   title={w.q ? `W/L ${w.q}` : "서버 기본"}
                   style={{ padding: "3px 6px", borderRadius: 3, cursor: "pointer",
                            background: panes[active]?.wl === w.q ? "var(--accent-subtle)" : undefined }}>
                {w.label}
              </div>
            ))}
          </div>
        )}

        {/* ── Report 도크 (§3.1 Report 버튼 — 현재 검사 판독) ── */}
        {reportDock && (
          <Splitter dir="v" onEnd={saveUi}
                    onDrag={(dx) => setUi((u) => ({ ...u, dockW: clampW(u.dockW - dx, 180, 520) }))} />
        )}
        {reportDock && (
          <div style={{ width: ui.dockW, background: "var(--bg-panel)", borderLeft: "1px solid var(--border)",
                        padding: 10, overflowY: "auto", fontSize: 12, flexShrink: 0 }}>
            <div style={{ fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
              Report — {curD.modality} {curD.study_date}
            </div>
            {report ? (
              <>
                <div style={{ marginBottom: 6, color: "var(--text-secondary)" }}>
                  상태: {report.status}
                  {report.created_by === "ai" && <span className="badge ai" style={{ marginLeft: 6 }}>AI 초안</span>}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, lineHeight: 1.5 }}>
                  {report.narrative_text}
                </pre>
              </>
            ) : (
              <div style={{ color: "var(--text-secondary)" }}>이 검사의 판독이 없습니다.</div>
            )}
          </div>
        )}
      </div>

      {/* ── Compare — 같은 환자 과거검사 선택 → 나란히 비교 ── */}
      {cmpOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 250,
                      display: "grid", placeItems: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setCmpOpen(false); }}>
          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
                        width: "min(560px, 94vw)", maxHeight: "80vh", overflow: "auto", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <b style={{ fontSize: 13 }}>⇄ Compare — {curD.patient_name} 의 과거검사</b>
              <button style={{ marginLeft: "auto" }} onClick={() => setCmpOpen(false)}>✕</button>
            </div>
            {(curD.related_exams ?? []).length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: 8 }}>
                이 환자의 과거검사가 없습니다.<br />
                다른 환자와 비교하려면 워크리스트의 <b>＋Add</b> 버튼을 사용하세요(명시적 비교).
              </div>
            )}
            {(curD.related_exams ?? []).map((re) => (
              <label key={re.id}
                     style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 6px",
                              borderRadius: 4, fontSize: 12.5, cursor: "pointer",
                              background: cmpSel.has(re.id) ? "var(--accent-subtle)" : undefined }}>
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
              <button className="primary" disabled={!cmpSel.size}
                      onClick={() => {
                        // 선택 검사를 누적 목록에 추가 후 재구성 — Sync With Other Exams 자동 ON
                        let ids: number[] = [];
                        try { ids = JSON.parse(localStorage.getItem(EXAMS_KEY) ?? "[]"); } catch { /* 초기화 */ }
                        for (const id of cmpSel) if (!ids.includes(id)) ids.push(id);
                        localStorage.setItem(EXAMS_KEY, JSON.stringify(ids));
                        localStorage.setItem("sv_infi_cmp", "1");
                        window.location.search = `?viewer=2d&study=${curD.id}`;
                      }}>
                비교 열기 ({cmpSel.size}건)
              </button>
              <button onClick={() => setCmpOpen(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 2D Table — 영역 픽셀값 표 (근사값) ── */}
      {tableData && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 250,
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
                      <td key={ci} style={{ border: "1px solid #24303f", padding: "1px 5px",
                                            textAlign: "right", color: "var(--text-secondary)" }}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10.5, color: "var(--text-secondary)", marginTop: 6 }}>
              렌더 영상 기반 근사값(W/L 역변환 ≈) — 원본 픽셀값 아님
            </div>
          </div>
        </div>
      )}

      {/* ── 3D MPR/MIP — 활성 페인 검사의 볼륨 뷰어 (전체 오버레이) ── */}
      {show3d && (
        <Suspense fallback={
          <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200,
                        display: "grid", placeItems: "center", color: "var(--text-secondary)" }}>
            3D 뷰어 로딩…
          </div>
        }>
          <Viewer3D studyUid={panes[active]?.studyUid || curD.study_uid}
                    onClose={() => setShow3d(false)} />
        </Suspense>
      )}

      {/* ── Setting — 앱 공통 설정 창 (워크리스트 '설정' 버튼과 동일 기능) ── */}
      {settingsOpen && (
        <Suspense fallback={
          <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center",
                        background: "rgba(0,0,0,0.5)", zIndex: 100, color: "var(--text-secondary)" }}>
            설정 로딩…
          </div>
        }>
          <SettingsModal role={role} onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

/* ── 측정 오버레이 — 이미지 픽셀좌표를 타일 화면좌표로 사상(fit+zoom/pan), mm=Pixel Spacing ── */
function TileAnno({ inst, pane, annos, pend, scout = [], shutter, cross }: {
  inst: InstanceNode; pane: Pane; annos: Anno2[]; pend: { x: number; y: number }[];
  scout?: { x1: number; y1: number; x2: number; y2: number;
            current: boolean; cross?: boolean; label?: string }[];
  shutter?: { kind: "rect" | "ellipse" | "poly"; pts: { x: number; y: number }[] };
  cross?: { x: number; y: number };   // 3D Cursor 마커
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDim({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!annos.length && !pend.length && !scout.length && !shutter && !cross) {
    return <svg ref={ref} style={svgStyle} />;
  }

  const s0 = Math.min(dim.w / (inst.cols || 1), dim.h / (inst.rows || 1));
  const s = s0 * pane.zoom;
  const X = (pt: { x: number; y: number }) => dim.w / 2 + (pt.x - inst.cols / 2) * s + pane.tx;
  const Y = (pt: { x: number; y: number }) => dim.h / 2 + (pt.y - inst.rows / 2) * s + pane.ty;
  const sp = inst.pixel_spacing?.length === 2 ? inst.pixel_spacing : null;
  const distLabel = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    return sp ? `${Math.hypot(dx * sp[1], dy * sp[0]).toFixed(1)} mm` : `${Math.hypot(dx, dy).toFixed(0)} px`;
  };
  const angleLabel = (p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x), a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let d = Math.abs(a1 - a2) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    return `${d.toFixed(1)}°`;
  };

  return (
    <svg ref={ref} style={svgStyle}>
      {/* Scout lines — 현재 이미지 선은 진한 노랑, All Lines 는 가는 파랑 */}
      {scout.map((sc, i) => {
        const p1 = { x: X({ x: sc.x1, y: sc.y1 }), y: Y({ x: sc.x1, y: sc.y1 }) };
        const p2 = { x: X({ x: sc.x2, y: sc.y2 }), y: Y({ x: sc.x2, y: sc.y2 }) };
        // 라벨은 라인의 오른쪽 끝에 — 화면 밖으로 나가지 않게 클램프
        const e = p1.x >= p2.x ? p1 : p2;
        const lx = Math.min(Math.max(e.x - 34, 2), dim.w - 40);
        const ly = Math.min(Math.max(e.y - 4, 10), dim.h - 4);
        const color = sc.current ? "#facc15" : sc.cross ? "#22d3ee" : "#38bdf8";
        return (
          <g key={`s${i}`}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke={color}
                  strokeWidth={sc.current ? 1.6 : sc.cross ? 1.1 : 0.7}
                  opacity={sc.current ? 1 : sc.cross ? 0.85 : 0.65} />
            {sc.label && (
              <text x={lx} y={ly} fill={color} fontSize={11} fontWeight={700}
                    style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 3 }}>
                {sc.label}
              </text>
            )}
          </g>
        );
      })}
      {/* 셔터 — 영역 밖 가림 (evenodd) */}
      {shutter && shutter.pts.length >= 2 && (() => {
        const outer = `M0,0 H${dim.w} V${dim.h} H0 Z`;
        let inner = "";
        if (shutter.kind === "rect") {
          const x0 = X(shutter.pts[0]), y0 = Y(shutter.pts[0]);
          const x1 = X(shutter.pts[1]), y1 = Y(shutter.pts[1]);
          inner = `M${Math.min(x0, x1)},${Math.min(y0, y1)} H${Math.max(x0, x1)} ` +
                  `V${Math.max(y0, y1)} H${Math.min(x0, x1)} Z`;
        } else if (shutter.kind === "ellipse") {
          const cx = (X(shutter.pts[0]) + X(shutter.pts[1])) / 2;
          const cy = (Y(shutter.pts[0]) + Y(shutter.pts[1])) / 2;
          const rx = Math.abs(X(shutter.pts[1]) - X(shutter.pts[0])) / 2;
          const ry = Math.abs(Y(shutter.pts[1]) - Y(shutter.pts[0])) / 2;
          inner = `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0 Z`;
        } else {
          inner = "M" + shutter.pts.map((pt, k) => `${k ? "L" : ""}${X(pt)},${Y(pt)}`).join(" ") + " Z";
        }
        return <path d={`${outer} ${inner}`} fill="#000" fillRule="evenodd" stroke="none" />;
      })()}
      {annos.map((a, i) => {
        const T = (x: number, y: number, txt: string, color: string, size = 11) => (
          <text x={x} y={y} fill={color} stroke="#000" strokeWidth={3} fontSize={size} fontWeight={700}
                style={{ paintOrder: "stroke" }}>{txt}</text>
        );
        const L = (p0: { x: number; y: number }, p1: { x: number; y: number }, color: string, dash?: string) => (
          <line x1={X(p0)} y1={Y(p0)} x2={X(p1)} y2={Y(p1)} stroke={color} strokeWidth={1.5}
                strokeDasharray={dash} />
        );
        const mid = (p0: { x: number; y: number }, p1: { x: number; y: number }) =>
          ({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 });
        switch (a.kind) {
          case "line": return (
            <g key={i} fill="none">{L(a.pts[0], a.pts[1], "#facc15")}
              {T((X(a.pts[0]) + X(a.pts[1])) / 2 + 5, (Y(a.pts[0]) + Y(a.pts[1])) / 2 - 5,
                 distLabel(a.pts[0], a.pts[1]), "#facc15")}</g>);
          case "angle": return (
            <g key={i} fill="none">
              <polyline points={a.pts.map((pt) => `${X(pt)},${Y(pt)}`).join(" ")}
                        stroke="#4ade80" strokeWidth={1.5} />
              {T(X(a.pts[1]) + 6, Y(a.pts[1]) - 6, angleLabel(a.pts[0], a.pts[1], a.pts[2]), "#4ade80")}</g>);
          case "arrow": {
            const ang = Math.atan2(Y(a.pts[1]) - Y(a.pts[0]), X(a.pts[1]) - X(a.pts[0]));
            const hx = X(a.pts[1]), hy = Y(a.pts[1]);
            return (
              <g key={i} fill="#7dd3fc">{L(a.pts[0], a.pts[1], "#7dd3fc")}
                <polygon points={`${hx},${hy} ${hx - 11 * Math.cos(ang - 0.42)},${hy - 11 * Math.sin(ang - 0.42)} ${hx - 11 * Math.cos(ang + 0.42)},${hy - 11 * Math.sin(ang + 0.42)}`} /></g>);
          }
          case "text": return <g key={i}>{T(X(a.pts[0]), Y(a.pts[0]), a.text ?? "", "#7dd3fc", 12)}</g>;
          case "marking": return <g key={i}>{T(X(a.pts[0]) - 6, Y(a.pts[0]) + 5, a.text ?? "", "#f97316", 14)}</g>;
          case "spine": return (
            <g key={i}><circle cx={X(a.pts[0])} cy={Y(a.pts[0])} r={2.5} fill="#4ade80" />
              {T(X(a.pts[0]) + 6, Y(a.pts[0]) + 4, a.text ?? "", "#4ade80", 12)}</g>);
          case "box": {
            const x0 = Math.min(X(a.pts[0]), X(a.pts[1])), y0 = Math.min(Y(a.pts[0]), Y(a.pts[1]));
            return (
              <g key={i} fill="none">
                <rect x={x0} y={y0} width={Math.abs(X(a.pts[1]) - X(a.pts[0]))}
                      height={Math.abs(Y(a.pts[1]) - Y(a.pts[0]))} stroke="#7dd3fc" strokeWidth={1.3} />
                {a.text && T(x0 + 2, y0 - 4, a.text, "#7dd3fc")}</g>);
          }
          case "circle": {
            const r = Math.hypot(X(a.pts[1]) - X(a.pts[0]), Y(a.pts[1]) - Y(a.pts[0]));
            return (
              <g key={i} fill="none">
                <circle cx={X(a.pts[0])} cy={Y(a.pts[0])} r={r} stroke="#7dd3fc" strokeWidth={1.3} />
                {T(X(a.pts[0]) + r + 4, Y(a.pts[0]), `R ${distLabel(a.pts[0], a.pts[1])}`, "#7dd3fc")}</g>);
          }
          case "poly": {
            let mm = 0;
            for (let k = 1; k < a.pts.length; k++) {
              const dx = a.pts[k].x - a.pts[k - 1].x, dy = a.pts[k].y - a.pts[k - 1].y;
              mm += sp ? Math.hypot(dx * sp[1], dy * sp[0]) : Math.hypot(dx, dy);
            }
            return (
              <g key={i} fill="none">
                <polyline points={a.pts.map((pt) => `${X(pt)},${Y(pt)}`).join(" ")}
                          stroke="#facc15" strokeWidth={1.5} />
                {T(X(a.pts[a.pts.length - 1]) + 5, Y(a.pts[a.pts.length - 1]),
                   `${mm.toFixed(1)} ${sp ? "mm" : "px"}`, "#facc15")}</g>);
          }
          case "mrect": case "mellipse": {
            const x0 = Math.min(X(a.pts[0]), X(a.pts[1])), y0 = Math.min(Y(a.pts[0]), Y(a.pts[1]));
            const w = Math.abs(X(a.pts[1]) - X(a.pts[0])), h = Math.abs(Y(a.pts[1]) - Y(a.pts[0]));
            return (
              <g key={i} fill="none">
                {a.kind === "mrect"
                  ? <rect x={x0} y={y0} width={w} height={h} stroke="#facc15" strokeWidth={1.3} />
                  : <ellipse cx={x0 + w / 2} cy={y0 + h / 2} rx={w / 2} ry={h / 2}
                             stroke="#facc15" strokeWidth={1.3} />}
                {a.value && T(x0, y0 - 5, a.value, "#facc15", 10.5)}</g>);
          }
          case "cobb": {
            const a1 = Math.atan2(a.pts[1].y - a.pts[0].y, a.pts[1].x - a.pts[0].x);
            const a2 = Math.atan2(a.pts[3].y - a.pts[2].y, a.pts[3].x - a.pts[2].x);
            let d = Math.abs(a1 - a2) * 180 / Math.PI;
            if (d > 180) d = 360 - d;
            if (d > 90) d = 180 - d;
            const m = mid(a.pts[1], a.pts[2]);
            return (
              <g key={i} fill="none">{L(a.pts[0], a.pts[1], "#4ade80")}{L(a.pts[2], a.pts[3], "#4ade80")}
                {L(mid(a.pts[0], a.pts[1]), mid(a.pts[2], a.pts[3]), "#4ade80", "4 4")}
                {T(X(m) + 6, Y(m), `Cobb ${d.toFixed(1)}°`, "#4ade80")}</g>);
          }
          case "centerline": {
            const m1 = mid(a.pts[0], a.pts[1]), m2 = mid(a.pts[2], a.pts[3]);
            return (
              <g key={i} fill="none">{L(a.pts[0], a.pts[1], "#7dd3fc")}{L(a.pts[2], a.pts[3], "#7dd3fc")}
                {L(m1, m2, "#facc15", "6 4")}
                {T(X(mid(m1, m2)) + 5, Y(mid(m1, m2)) - 5, "Center", "#facc15")}</g>);
          }
          case "limb": {
            const d1 = distLabel(a.pts[0], a.pts[1]), d2 = distLabel(a.pts[2], a.pts[3]);
            const v1 = parseFloat(d1), v2 = parseFloat(d2);
            return (
              <g key={i} fill="none">{L(a.pts[0], a.pts[1], "#facc15")}{L(a.pts[2], a.pts[3], "#4ade80")}
                {T(X(a.pts[1]) + 5, Y(a.pts[1]), `L1 ${d1}`, "#facc15")}
                {T(X(a.pts[3]) + 5, Y(a.pts[3]), `L2 ${d2} (Δ${Math.abs(v1 - v2).toFixed(1)})`, "#4ade80")}</g>);
          }
          case "ctr": {
            const heart = Math.hypot(a.pts[1].x - a.pts[0].x, a.pts[1].y - a.pts[0].y);
            const thorax = Math.hypot(a.pts[3].x - a.pts[2].x, a.pts[3].y - a.pts[2].y);
            const ratio = thorax > 0 ? (heart / thorax) * 100 : 0;
            return (
              <g key={i} fill="none">{L(a.pts[0], a.pts[1], "#f97316")}{L(a.pts[2], a.pts[3], "#7dd3fc")}
                {T(X(a.pts[3]) + 5, Y(a.pts[3]) - 5,
                   `CTR ${ratio.toFixed(1)}%${ratio > 50 ? " ⚠" : ""}`, ratio > 50 ? "#f87171" : "#4ade80")}</g>);
          }
          case "lens": return (
            <g key={i} stroke="#22d3ee" strokeWidth={1.3} fill="none">
              <line x1={X(a.pts[0]) - 7} y1={Y(a.pts[0])} x2={X(a.pts[0]) + 7} y2={Y(a.pts[0])} />
              <line x1={X(a.pts[0])} y1={Y(a.pts[0]) - 7} x2={X(a.pts[0])} y2={Y(a.pts[0]) + 7} />
              {T(X(a.pts[0]) + 9, Y(a.pts[0]) - 4, a.value ?? "", "#22d3ee")}</g>);
          case "profile": {
            const vals = (a as Anno2 & { vals?: number[] }).vals ?? [];
            if (!vals.length) return null;
            const bx = Math.min(X(a.pts[0]), X(a.pts[1]));
            const by = Math.max(Y(a.pts[0]), Y(a.pts[1])) + 8;
            const bw = 130, bh = 42;
            const mn = Math.min(...vals), mx = Math.max(...vals);
            const pts = vals.map((v, k) =>
              `${bx + (k / (vals.length - 1)) * bw},${by + bh - ((v - mn) / Math.max(1, mx - mn)) * bh}`).join(" ");
            return (
              <g key={i} fill="none">{L(a.pts[0], a.pts[1], "#facc15", "3 3")}
                <rect x={bx - 2} y={by - 2} width={bw + 4} height={bh + 4} fill="#000a" stroke="#334155" />
                <polyline points={pts} stroke="#facc15" strokeWidth={1.2} />
                {T(bx, by - 5, `${mn.toFixed(0)}~${mx.toFixed(0)}`, "#facc15", 9.5)}</g>);
          }
          default: return null;
        }
      })}
      {pend.map((pt, i) => (
        <circle key={`p${i}`} cx={X(pt)} cy={Y(pt)} r={3} fill="#f87171" />
      ))}
      {pend.length > 1 && (
        <polyline points={pend.map((pt) => `${X(pt)},${Y(pt)}`).join(" ")}
                  stroke="#f87171" strokeWidth={1} strokeDasharray="3 3" fill="none" />
      )}
      {/* 3D Cursor 마커 */}
      {cross && (
        <g stroke="#f472b6" strokeWidth={1.6} fill="none">
          <line x1={X(cross) - 12} y1={Y(cross)} x2={X(cross) + 12} y2={Y(cross)} />
          <line x1={X(cross)} y1={Y(cross) - 12} x2={X(cross)} y2={Y(cross) + 12} />
          <circle cx={X(cross)} cy={Y(cross)} r={5} />
        </g>
      )}
    </svg>
  );
}
const svgStyle: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 2 };

function ovl(corner: "tl" | "tr" | "bl" | "br", fs = 9.5): React.CSSProperties {
  return {
    position: "absolute", fontSize: fs, lineHeight: 1.3, color: "#7dd3fc", pointerEvents: "none",
    textShadow: "0 0 3px #000", zIndex: 2,
    top: corner[0] === "t" ? 3 : undefined, bottom: corner[0] === "b" ? 3 : undefined,
    left: corner[1] === "l" ? 5 : undefined, right: corner[1] === "r" ? 5 : undefined,
    textAlign: corner[1] === "r" ? "right" : "left",
  };
}

function ScrollBar({ index, total }: { index: number; total: number }) {
  return (
    <div style={{ position: "absolute", right: 1, top: "8%", bottom: "8%", width: 3, background: "#1e293b", borderRadius: 2, zIndex: 3 }}>
      <div style={{ position: "absolute", left: 0, right: 0, borderRadius: 2, background: "#4ade80",
                    top: `${(index / Math.max(1, total - 1)) * 92}%`, height: "8%" }} />
    </div>
  );
}
