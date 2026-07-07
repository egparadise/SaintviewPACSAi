// In Viewer — INFINITT PACS User Guide 기반 Client 뷰어 (v3).
// User Guide p.11~14 §3.4 Toolbar buttons 전 툴(약 50종) 구성 + §3.5 마우스 체계.
// 실동작: Select/Pan/Zoom/Windowing/Fit/Capture/Reset/Print/Refresh Exam/Flip V·H/Rotate L·R·180/
//         B/W Inverse/Sharpen/Average/Pseudo/Auto Scroll/Calibrate/Measure 2D Line/Measure 2D Angle
// 미구현(반투명): Magnification/3D Cursor/Dictation 계열/Select All 계열/Shutter 3종/CT Ratio/
//         Limb Length/Center Line/Profile/2D Table/Spine Label/Volume/3D 주석/2D 주석·ROI 계열/Cobb/Marking/Lens
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type InstanceNode, type SeriesNode, type StudyDetail } from "../api";
import { DICOMWEB_ROOT } from "../lib/cornerstone";
import { IN_CROSSLINK_MODES, IN_LAYOUTS, IN_WL_PRESETS_CT, IN_WL_PRESETS_MR } from "../lib/infiConfig";

interface Pane {
  series: SeriesNode | null;
  studyUid: string;          // 페인의 검사 소속 — Sync With Other Exams 판별(과거검사 비교)
  index: number;
  zoom: number; tx: number; ty: number; rot: number;
  flipH: boolean; flipV: boolean; invert: boolean;
  wl: string;
  fx: "" | "sharpen" | "smooth" | "pseudo";   // p.13 필터(Sharpens/Average/Pseudo)
}
const initPane = (studyUid = ""): Pane => ({
  series: null, studyUid, index: 0, zoom: 1, tx: 0, ty: 0, rot: 0,
  flipH: false, flipV: false, invert: false, wl: "", fx: "",
});

/* ── Scout line 기하 — DICOM ImagePosition/Orientation 으로 소스 이미지의 절단선을
      타깃 이미지 픽셀좌표에 투영 (§3.3 ④⑤ Scout Line / All Lines) ── */
type V3 = number[];
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
interface Geom { pos: V3; row: V3; col: V3; rs: number; cs: number; n: V3; rows: number; cols: number }
function geomOf(inst: InstanceNode): Geom | null {
  if (inst.position?.length !== 3 || inst.orientation?.length !== 6 || inst.pixel_spacing?.length !== 2) return null;
  const row = inst.orientation.slice(0, 3), col = inst.orientation.slice(3, 6);
  return { pos: inst.position, row, col, rs: inst.pixel_spacing[0], cs: inst.pixel_spacing[1],
           n: vcross(row, col), rows: inst.rows || 1, cols: inst.cols || 1 };
}
/** 소스 평면(src)의 이미지 사각형을 타깃(tgt) 픽셀좌표에 투영 → 절단선 세그먼트. 평행 평면이면 null */
function scoutSegment(src: Geom, tgt: Geom): { x1: number; y1: number; x2: number; y2: number } | null {
  const nA = Math.hypot(...src.n), nB = Math.hypot(...tgt.n);
  if (Math.abs(vdot(src.n, tgt.n) / (nA * nB)) > 0.98) return null;   // 평행 → 절단선 없음
  const corner = (r: number, c: number): V3 => [
    src.pos[0] + src.row[0] * src.cs * c + src.col[0] * src.rs * r,
    src.pos[1] + src.row[1] * src.cs * c + src.col[1] * src.rs * r,
    src.pos[2] + src.row[2] * src.cs * c + src.col[2] * src.rs * r,
  ];
  const pts = [corner(0, 0), corner(0, src.cols - 1), corner(src.rows - 1, 0), corner(src.rows - 1, src.cols - 1)]
    .map((q) => {
      const d = vsub(q, tgt.pos);
      return { x: vdot(d, tgt.row) / tgt.cs, y: vdot(d, tgt.col) / tgt.rs };
    });
  let best: [number, number] = [0, 1], bd = -1;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    if (d > bd) { bd = d; best = [i, j]; }
  }
  return { x1: pts[best[0]].x, y1: pts[best[0]].y, x2: pts[best[1]].x, y2: pts[best[1]].y };
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

type Tool = "select" | "pan" | "zoom" | "wl" | "mline" | "mangle";
interface Anno2 { kind: "line" | "angle"; pts: { x: number; y: number }[] }

// ── User Guide p.11~14 툴 카탈로그 (표 순서 유지) — impl=false 는 반투명(개발 대상) ──
const PALETTE: { id: string; icon: string; label: string; impl: boolean; mode?: boolean }[] = [
  // p.11 §3.4 기본 6종
  { id: "select", icon: "➤", label: "Select — 이미지 선택/해제", impl: true, mode: true },
  { id: "pan", icon: "✥", label: "Pan — 이미지 이동(창보다 클 때 유용)", impl: true, mode: true },
  { id: "zoom", icon: "🔍", label: "Zoom — 드래그로 확대/축소 (Ctrl+휠)", impl: true, mode: true },
  { id: "wl", icon: "◐", label: "Windowing — W/L 적용(우드래그 기본)", impl: true, mode: true },
  { id: "magnify", icon: "⌕", label: "Magnification — 부분 확대경 (개발 예정)", impl: false },
  { id: "fit", icon: "▣", label: "Fit — 창 크기에 맞춤", impl: true },
  // p.12 상단
  { id: "capture", icon: "📷", label: "Capture All — 현재 이미지 저장", impl: true },
  { id: "reset", icon: "↺", label: "Reset — 초기값 복원", impl: true },
  { id: "print", icon: "🖨", label: "Print — 리포트/이미지 인쇄", impl: true },
  { id: "cursor3d", icon: "✛", label: "3D Cursor — 3D 위치 표시 (개발 예정)", impl: false },
  { id: "dictation", icon: "🎙", label: "Dictation — 음성 녹음 (개발 예정)", impl: false },
  { id: "playdict", icon: "🔊", label: "Play Dictation (개발 예정)", impl: false },
  { id: "refreshExam", icon: "🔄", label: "Refresh Exam — 검사 정보 갱신", impl: true },
  // p.12 중단 — 선택/방향
  { id: "selAll", icon: "⊞", label: "Select All — 전체 선택 (개발 예정)", impl: false },
  { id: "selInv", icon: "⊟", label: "Select All Inverse (개발 예정)", impl: false },
  { id: "flipV", icon: "⇵", label: "Flip Vertical — 상하 반전", impl: true },
  { id: "flipH", icon: "⇋", label: "Flip Horizontal — 좌우 반전", impl: true },
  { id: "rotL", icon: "⟲", label: "Rotate Left 90 — 반시계 90도", impl: true },
  { id: "rotR", icon: "⟳", label: "Rotate Right 90 — 시계 90도", impl: true },
  { id: "rot180", icon: "◒", label: "Rotate 180", impl: true },
  { id: "invert", icon: "◑", label: "B/W Inverse — 흑백 반전", impl: true },
  { id: "shutEl", icon: "◙", label: "Ellipse Shutter (개발 예정)", impl: false },
  { id: "shutRect", icon: "▣", label: "Rectangle Shutter (개발 예정)", impl: false },
  { id: "shutPoly", icon: "⬠", label: "Polyline Shutter (개발 예정)", impl: false },
  // p.13 상단 — 필터/스크롤
  { id: "sharpen", icon: "◮", label: "Sharpens Filter — 선예화", impl: true },
  { id: "smooth", icon: "◍", label: "Average Filter — 평활화", impl: true },
  { id: "pseudo", icon: "🎨", label: "Pseudo — 의사 컬러(핵의학)", impl: true },
  { id: "cine", icon: "▶", label: "Auto Scroll — 이미지 자동 스크롤", impl: true },
  // p.13 측정/분석
  { id: "ctr", icon: "♥", label: "CT Ratio — 심흉비 (개발 예정)", impl: false },
  { id: "limb", icon: "🦵", label: "Limb Length Discrepancy (개발 예정)", impl: false },
  { id: "centerline", icon: "╂", label: "Center Line (개발 예정)", impl: false },
  { id: "profile", icon: "📈", label: "Profile — 픽셀 그래프 (개발 예정)", impl: false },
  { id: "table2d", icon: "▤", label: "2D Table — 픽셀값 표 (개발 예정)", impl: false },
  { id: "calibrate", icon: "📐", label: "Calibrate — Pixel Spacing 정보", impl: true },
  { id: "spine", icon: "🦴", label: "Spine Label (개발 예정)", impl: false },
  { id: "anno3d", icon: "🧊", label: "3D Arrow/Text/Line/Curve (개발 예정)", impl: false },
  // p.13~14 — 2D 주석/측정
  { id: "arrow2d", icon: "↗", label: "2D Arrow (개발 예정)", impl: false },
  { id: "text2d", icon: "T", label: "2D Text (개발 예정)", impl: false },
  { id: "box2d", icon: "▭", label: "2D Box — 메모 (개발 예정)", impl: false },
  { id: "key2d", icon: "🔑", label: "2D Key — 키이미지 (개발 예정)", impl: false },
  { id: "circle", icon: "◯", label: "Circle (개발 예정)", impl: false },
  { id: "polyline", icon: "〰", label: "Polyline/Freehand (개발 예정)", impl: false },
  { id: "mline", icon: "📏", label: "Measure 2D Line — 두 점 클릭 = 거리(mm)", impl: true, mode: true },
  { id: "mangle", icon: "∠", label: "Measure 2D Angle — 세 점 클릭 = 각도", impl: true, mode: true },
  { id: "mellipse", icon: "⬭", label: "Measure 2D Ellipse ROI (개발 예정)", impl: false },
  { id: "mrect", icon: "⬜", label: "Measure 2D Rectangle ROI (개발 예정)", impl: false },
  { id: "cobb", icon: "⟁", label: "Measure Cobb Angle (개발 예정)", impl: false },
  { id: "marking", icon: "M", label: "Marking (개발 예정)", impl: false },
  { id: "lens", icon: "🎯", label: "Lens/Hounsfield/SUV (개발 예정)", impl: false },
  { id: "clrAnno", icon: "🧹", label: "측정 전체 지우기", impl: true },
];

export function ViewerInfi({ detail, onClose }: {
  detail: StudyDetail;
  onClose: () => void;
  addDetail?: StudyDetail | null;
  stackDetail?: StudyDetail | null;
  keySops?: string[] | null;
  withOpen?: { mode: "add" | "stack"; ids: number[] } | null;
}) {
  const [series, setSeries] = useState<SeriesNode[]>([]);
  // 과거검사(Related Exam) 시리즈 — Sync With Other Exams 용 (클릭 시 로드)
  const [priorSeries, setPriorSeries] = useState<{ uid: string; label: string; s: SeriesNode }[]>([]);
  const [priorLoaded, setPriorLoaded] = useState<Set<number>>(new Set());
  const [sLayout, setSLayout] = useState<{ r: number; c: number }>({ r: 1, c: 1 });
  const [iLayout, setILayout] = useState<{ r: number; c: number }>({ r: 1, c: 1 });
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
  // 측정 주석 — sop_uid 별 (Measure 2D Line/Angle)
  const [annos, setAnnos] = useState<Record<string, Anno2[]>>({});
  const [pend, setPend] = useState<{ sop: string; pts: { x: number; y: number }[] } | null>(null);
  const drag = useRef<{ x: number; y: number; btn: number; pane: number } | null>(null);

  const wlPresets = detail.modality === "MR" ? IN_WL_PRESETS_MR : IN_WL_PRESETS_CT;
  const tilesPerPane = iLayout.r * iLayout.c;

  const loadSeries = useCallback(() => {
    api.seriesTree(detail.id).then((r) => {
      setSeries(r.series);
      setPanes((ps) => {
        if (ps[0]?.series) return ps;
        const next = [...ps];
        next[0] = { ...initPane(detail.study_uid), series: r.series[0] ?? null };
        return next;
      });
      const first = r.series[0];
      if (first && ["CT", "MR"].includes(first.modality) && first.instances.length >= 9) {
        setILayout((cur) => (cur.r * cur.c === 1 ? { r: 3, c: 3 } : cur));
      }
    }).catch(() => {});
  }, [detail.id]);
  useEffect(loadSeries, [loadSeries]);

  const applySLayout = (l: { r: number; c: number }) => {
    setSLayout(l);
    setMaximized(null);
    setPanes((ps) => Array.from({ length: l.r * l.c }, (_, i) =>
      ps[i] ?? { ...initPane(detail.study_uid), series: series[i % Math.max(series.length, 1)] ?? null }));
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
        return { ...p, index: (p.index + tilesPerPane) % p.series.instances.length };
      }));
    }, 150);
    return () => clearInterval(t);
  }, [cine, active, tilesPerPane]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  const fire = (id: string) => {
    const p = panes[active];
    if (!p) return;
    switch (id) {
      case "fit": upd(active, { zoom: 1, tx: 0, ty: 0 }); break;
      case "invert": upd(active, { invert: !p.invert }); break;
      case "flipH": upd(active, { flipH: !p.flipH }); break;
      case "flipV": upd(active, { flipV: !p.flipV }); break;
      case "rotL": upd(active, { rot: (p.rot + 270) % 360 }); break;
      case "rotR": upd(active, { rot: (p.rot + 90) % 360 }); break;
      case "rot180": upd(active, { rot: (p.rot + 180) % 360 }); break;
      case "sharpen": upd(active, { fx: p.fx === "sharpen" ? "" : "sharpen" }); break;
      case "smooth": upd(active, { fx: p.fx === "smooth" ? "" : "smooth" }); break;
      case "pseudo": upd(active, { fx: p.fx === "pseudo" ? "" : "pseudo" }); break;
      case "reset": upd(active, { ...initPane(), series: p.series, index: p.index }); break;
      case "cine": setCine((c) => !c); break;
      case "print": window.print(); break;
      case "refreshExam": loadSeries(); say("검사 정보를 갱신했습니다"); break;
      case "clrAnno": setAnnos({}); setPend(null); say("측정을 모두 지웠습니다"); break;
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
      default:
        if (["select", "pan", "zoom", "wl", "mline", "mangle"].includes(id)) {
          setTool(id as Tool);
          if (id === "mline") say("두 점을 클릭하면 거리(mm)가 측정됩니다");
          if (id === "mangle") say("세 점을 클릭하면 각도가 측정됩니다 (가운데=꼭짓점)");
        }
    }
  };

  // ── 측정 클릭: 화면좌표 → 이미지 픽셀좌표 (fit 배치 + zoom/pan 역변환, rot/flip 미적용 전제) ──
  const measureClick = (e: React.MouseEvent, tileEl: HTMLElement, p: Pane, inst: InstanceNode) => {
    const r = tileEl.getBoundingClientRect();
    const s0 = Math.min(r.width / (inst.cols || 1), r.height / (inst.rows || 1));
    const s = s0 * p.zoom;
    const ix = (e.clientX - (r.left + r.width / 2 + p.tx)) / s + inst.cols / 2;
    const iy = (e.clientY - (r.top + r.height / 2 + p.ty)) / s + inst.rows / 2;
    const need = tool === "mline" ? 2 : 3;
    const cur = pend?.sop === inst.sop_uid ? pend.pts : [];
    const pts = [...cur, { x: ix, y: iy }];
    if (pts.length >= need) {
      setAnnos((a) => ({
        ...a,
        [inst.sop_uid]: [...(a[inst.sop_uid] ?? []), { kind: tool === "mline" ? "line" : "angle", pts }],
      }));
      setPend(null);
    } else setPend({ sop: inst.sop_uid, pts });
  };

  const onPaneMouseDown = (e: React.MouseEvent, i: number) => {
    setActive(i);
    const measuring = (tool === "mline" || tool === "mangle") && e.button === 0;
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
    if (mode === "pan") upd(d.pane, { tx: p.tx + dx, ty: p.ty + dy });
    else if (mode === "zoom") upd(d.pane, { zoom: Math.max(0.05, Math.min(30, p.zoom * (1 - dy / 200))) });
    else if (mode === "wl") {
      const [c0, w0] = p.wl ? p.wl.split(",").map(Number) : [128, 256];
      upd(d.pane, { wl: `${Math.round(c0 + dy)},${Math.max(1, Math.round(w0 + dx))}` });
    }
  };
  const endDrag = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent, i: number) => {
    if (e.ctrlKey) {
      const p = panes[i];
      if (p) upd(i, { zoom: Math.max(0.05, Math.min(30, p.zoom * (e.deltaY < 0 ? 1.1 : 0.9))) });
    } else scroll(i, (e.deltaY > 0 ? 1 : -1) * (tilesPerPane > 1 ? iLayout.c : 1));
  };

  const combine = () => {
    const all: InstanceNode[] = series.flatMap((s) => s.instances);
    if (!all.length) return;
    upd(active, {
      series: { series_uid: series[0].series_uid, modality: detail.modality,
                series_desc: `[Combine] ${series.length} series`, series_number: 0, instances: all },
      index: 0,
    });
  };

  const paneIdxs = maximized !== null ? [maximized] : panes.map((_, i) => i);
  const layoutLabel = (l: { r: number; c: number }) => `${l.r} x ${l.c}`;

  // §3.3 ④⑤ Scout lines — 활성 페인 시리즈의 절단선을 다른 시리즈 타일에 투영
  // (scout=현재 이미지 1선, all_lines=시리즈 전체. 같은 시리즈·평행 평면은 제외)
  const scoutFor = (tileInst: InstanceNode, tileSeriesUid: string) => {
    if (!xlink.scout && !xlink.all_lines) return [];
    const act = panes[active];
    if (!act?.series || act.series.series_uid === tileSeriesUid) return [];
    const tg = geomOf(tileInst);
    if (!tg) return [];
    const srcs = xlink.all_lines ? act.series.instances
      : act.series.instances[act.index] ? [act.series.instances[act.index]] : [];
    const out: { x1: number; y1: number; x2: number; y2: number; current: boolean }[] = [];
    srcs.forEach((si, k) => {
      const sg = geomOf(si);
      if (!sg) return;
      const seg = scoutSegment(sg, tg);
      if (seg) out.push({ ...seg, current: xlink.all_lines ? k === act.index : true });
    });
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

      {/* ── 상단 가로 썸네일 스트립 ── */}
      <div style={{ display: "flex", gap: 4, padding: "4px 6px", background: "var(--bg-panel)",
                    borderBottom: "1px solid var(--border)", overflowX: "auto", flexShrink: 0, alignItems: "center" }}>
        <b style={{ color: "var(--text-primary)", fontSize: 12, flexShrink: 0 }}>In Viewer</b>
        <button onClick={combine} title="Combine Series" style={{ fontSize: 11, flexShrink: 0 }}>Combine</button>
        {series.map((s) => (
          <div key={s.series_uid} onClick={() => upd(active, { series: s, index: 0, studyUid: detail.study_uid })}
               title={`Se${s.series_number} · ${s.series_desc}`}
               style={{ flexShrink: 0, width: 76, cursor: "pointer", textAlign: "center", fontSize: 10,
                        border: panes[active]?.series?.series_uid === s.series_uid
                          ? "2px solid #4ade80" : "1px solid var(--border)", borderRadius: 3, background: "#000" }}>
            {s.instances[0] && (
              <img src={s.instances[0].preview_url} alt="" style={{ width: "100%", height: 56, objectFit: "cover", display: "block" }} />
            )}
            <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {s.series_number}/{s.instances.length}
            </div>
          </div>
        ))}
        {/* 과거검사(Related Exam) — 클릭 로드 후 노란 테두리 썸네일, Sync With Other Exams 대상 */}
        {(detail.related_exams ?? []).map((re) => !priorLoaded.has(re.id) && (
          <button key={re.id} onClick={() => loadPrior(re.id, re.study_uid, re.study_date)}
                  title={`과거검사 열기 — ${re.modality} ${re.study_desc}`}
                  style={{ fontSize: 10.5, flexShrink: 0, color: "#facc15" }}>
            +{re.study_date} {re.modality}
          </button>
        ))}
        {priorSeries.map((e) => (
          <div key={`${e.uid}-${e.s.series_uid}`}
               onClick={() => upd(active, { series: e.s, index: 0, studyUid: e.uid })}
               title={`[과거 ${e.label}] Se${e.s.series_number} · ${e.s.series_desc}`}
               style={{ flexShrink: 0, width: 76, cursor: "pointer", textAlign: "center", fontSize: 10,
                        border: panes[active]?.series?.series_uid === e.s.series_uid
                          ? "2px solid #facc15" : "1px solid #854d0e", borderRadius: 3, background: "#000" }}>
            {e.s.instances[0] && (
              <img src={e.s.instances[0].preview_url} alt="" style={{ width: "100%", height: 56, objectFit: "cover", display: "block" }} />
            )}
            <div style={{ color: "#facc15", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              P·{e.label.slice(4)}
            </div>
          </div>
        ))}
        <span style={{ marginLeft: "auto" }} />
        <span style={{ position: "relative", flexShrink: 0 }}>
          <button onClick={() => setCloseMenu((v) => !v)} style={{ fontSize: 11 }}>Close Exam ▾</button>
          {closeMenu && (
            <div style={{ position: "absolute", right: 0, top: "110%", zIndex: 30, background: "var(--bg-elevated)",
                          border: "1px solid var(--border)", borderRadius: 4, minWidth: 170, fontSize: 12 }}>
              {[["현재 검사 닫기", onClose], ["모든 검사 닫기", () => window.close()]].map(([label, fn]) => (
                <div key={label as string} onClick={fn as () => void}
                     style={{ padding: "6px 10px", cursor: "pointer" }}>{label as string}</div>
              ))}
              <div style={{ padding: "6px 10px", opacity: 0.45 }} title="개발 예정">닫으며 자동 Verify</div>
            </div>
          )}
        </span>
      </div>

      {/* ── 정보바 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "3px 10px",
                    background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", fontSize: 12, flexShrink: 0 }}>
        <span style={{ color: "#4ade80" }}>
          Examined, {detail.study_date}, {detail.patient_name}, {detail.patient_key}
        </span>
        <span style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 10 }}>
          Series
          <select value={layoutLabel(sLayout)} onChange={(e) => {
            const [r, c] = e.target.value.split(" x ").map(Number);
            applySLayout({ r, c });
          }} style={{ fontSize: 11 }}>
            {IN_LAYOUTS.map((l) => <option key={layoutLabel(l)}>{layoutLabel(l)}</option>)}
          </select>
          Image
          <select value={layoutLabel(iLayout)} onChange={(e) => {
            const [r, c] = e.target.value.split(" x ").map(Number);
            setILayout({ r, c });
          }} style={{ fontSize: 11 }}>
            {IN_LAYOUTS.map((l) => <option key={layoutLabel(l)}>{layoutLabel(l)}</option>)}
          </select>
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
        <div style={{ width: 72, background: "var(--bg-panel)", borderRight: "1px solid var(--border)",
                      display: "flex", flexDirection: "column", padding: "6px 4px", gap: 4, flexShrink: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, overflowY: "auto" }}>
            {PALETTE.map((t) => {
              const activeBtn = (t.mode && tool === t.id) || (t.id === "cine" && cine)
                || (["sharpen", "smooth", "pseudo"].includes(t.id) && panes[active]?.fx === t.id);
              return (
                <button key={t.id} title={t.label} onClick={() => t.impl && fire(t.id)}
                        style={{ height: 28, fontSize: 13, padding: 0,
                                 opacity: t.impl ? 1 : 0.32,
                                 background: activeBtn ? "var(--accent)" : "var(--bg-elevated)",
                                 color: activeBtn ? "#fff" : "var(--text-secondary)",
                                 border: "1px solid var(--border)", borderRadius: 3,
                                 cursor: t.impl ? "pointer" : "default" }}>
                  {t.icon}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            <button title="More (개발 예정)" style={{ fontSize: 10.5, opacity: 0.4 }}>More</button>
            <button title="Setting — W/L Preset 패널 토글 (p.12 Setting)" onClick={() => setWlPanel((v) => !v)}
                    style={{ fontSize: 10.5, background: wlPanel ? "var(--accent)" : undefined,
                             color: wlPanel ? "#fff" : undefined }}>
              Setting
            </button>
          </div>
        </div>

        {/* ── 뷰포트 ── */}
        <div style={{ flex: 1, display: "grid", minWidth: 0,
                      gridTemplateColumns: `repeat(${maximized !== null ? 1 : sLayout.c}, 1fr)`,
                      gridTemplateRows: `repeat(${maximized !== null ? 1 : sLayout.r}, 1fr)`, gap: 1 }}>
          {paneIdxs.map((pi) => {
            const p = panes[pi];
            if (!p) return <div key={pi} />;
            const insts = p.series?.instances ?? [];
            const wlText = p.wl ? p.wl.replace(",", " / ") : "기본";
            return (
              <div key={pi}
                   onMouseDown={(e) => onPaneMouseDown(e, pi)} onMouseMove={onMouseMove}
                   onWheel={(e) => onWheel(e, pi)}
                   onDoubleClick={() => setMaximized((m) => (m === null ? pi : null))}
                   style={{ position: "relative", minWidth: 0, minHeight: 0, background: "#000",
                            outline: active === pi ? "1px solid #4ade80" : "1px solid #1e293b",
                            display: "grid", cursor: (tool === "mline" || tool === "mangle") ? "copy" : "crosshair",
                            gridTemplateColumns: `repeat(${iLayout.c}, 1fr)`,
                            gridTemplateRows: `repeat(${iLayout.r}, 1fr)`, gap: 1 }}>
                {Array.from({ length: tilesPerPane }, (_, t) => {
                  const idx = p.index + t;
                  const inst = insts[idx];
                  return (
                    <div key={t} style={{ position: "relative", overflow: "hidden", background: "#000" }}
                         onMouseDown={(e) => {
                           if ((tool === "mline" || tool === "mangle") && e.button === 0 && p.series && inst) {
                             measureClick(e, e.currentTarget, p, inst);
                           }
                         }}>
                      {p.series && inst ? (
                        <>
                          <img src={instUrl(p.studyUid || detail.study_uid, p.series, inst, p.wl)} alt="" draggable={false}
                               style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                                        objectFit: "contain",
                                        transform: `translate(${p.tx}px,${p.ty}px) scale(${p.zoom * (p.flipH ? -1 : 1)},${p.zoom * (p.flipV ? -1 : 1)}) rotate(${p.rot}deg)`,
                                        filter: paneFilter(p), userSelect: "none" }} />
                          <TileAnno inst={inst} pane={p}
                                    annos={annos[inst.sop_uid] ?? []}
                                    pend={pend?.sop === inst.sop_uid ? pend.pts : []}
                                    scout={scoutFor(inst, p.series.series_uid)} />
                          <div style={ovl("tl")}>{detail.patient_name}<br />{detail.patient_key}</div>
                          <div style={ovl("tr")}>{detail.modality} {detail.study_date}</div>
                          <div style={ovl("bl")}>Se:{p.series.series_number} Im:{idx + 1}/{insts.length}<br />W/L: {wlText}</div>
                          <div style={ovl("br")}>Zoom {(p.zoom * 100).toFixed(0)}%{p.fx ? ` · ${p.fx}` : ""}</div>
                        </>
                      ) : p.series ? null : (
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
          })}
        </div>

        {/* ── W/L Preset 패널 (Setting 토글) ── */}
        {wlPanel && (
          <div style={{ width: 108, background: "var(--bg-panel)", borderLeft: "1px solid var(--border)",
                        padding: 6, overflowY: "auto", fontSize: 11.5, flexShrink: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>
              W/L ({detail.modality === "MR" ? "MR" : "CT"})
            </div>
            {wlPresets.map((w) => (
              <div key={w.key} onClick={() => upd(active, { wl: w.q })}
                   title={w.q ? `W/L ${w.q}` : "서버 기본"}
                   style={{ padding: "3px 6px", borderRadius: 3, cursor: "pointer",
                            background: panes[active]?.wl === w.q ? "var(--accent-subtle)" : undefined }}>
                {w.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 측정 오버레이 — 이미지 픽셀좌표를 타일 화면좌표로 사상(fit+zoom/pan), mm=Pixel Spacing ── */
function TileAnno({ inst, pane, annos, pend, scout = [] }: {
  inst: InstanceNode; pane: Pane; annos: Anno2[]; pend: { x: number; y: number }[];
  scout?: { x1: number; y1: number; x2: number; y2: number; current: boolean }[];
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
  if (!annos.length && !pend.length && !scout.length) return <svg ref={ref} style={svgStyle} />;

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
      {scout.map((sc, i) => (
        <line key={`s${i}`}
              x1={X({ x: sc.x1, y: sc.y1 })} y1={Y({ x: sc.x1, y: sc.y1 })}
              x2={X({ x: sc.x2, y: sc.y2 })} y2={Y({ x: sc.x2, y: sc.y2 })}
              stroke={sc.current ? "#facc15" : "#38bdf8"}
              strokeWidth={sc.current ? 1.6 : 0.7} opacity={sc.current ? 1 : 0.65} />
      ))}
      {annos.map((a, i) => a.kind === "line" ? (
        <g key={i} stroke="#facc15" strokeWidth={1.5} fill="none">
          <line x1={X(a.pts[0])} y1={Y(a.pts[0])} x2={X(a.pts[1])} y2={Y(a.pts[1])} />
          <text x={(X(a.pts[0]) + X(a.pts[1])) / 2 + 5} y={(Y(a.pts[0]) + Y(a.pts[1])) / 2 - 5}
                fill="#facc15" stroke="none" fontSize={11}>{distLabel(a.pts[0], a.pts[1])}</text>
        </g>
      ) : (
        <g key={i} stroke="#4ade80" strokeWidth={1.5} fill="none">
          <polyline points={a.pts.map((pt) => `${X(pt)},${Y(pt)}`).join(" ")} />
          <text x={X(a.pts[1]) + 6} y={Y(a.pts[1]) - 6} fill="#4ade80" stroke="none" fontSize={11}>
            {angleLabel(a.pts[0], a.pts[1], a.pts[2])}
          </text>
        </g>
      ))}
      {pend.map((pt, i) => (
        <circle key={`p${i}`} cx={X(pt)} cy={Y(pt)} r={3} fill="#f87171" />
      ))}
    </svg>
  );
}
const svgStyle: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 2 };

function ovl(corner: "tl" | "tr" | "bl" | "br"): React.CSSProperties {
  return {
    position: "absolute", fontSize: 9.5, lineHeight: 1.3, color: "#7dd3fc", pointerEvents: "none",
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
