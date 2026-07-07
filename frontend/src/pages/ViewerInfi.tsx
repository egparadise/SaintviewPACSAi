// In Viewer — INFINITT PACS User Guide 기반 Client 뷰어 (v1).
// 설계: docs/ANALYSIS_INFINITT_UserGuide.md (§3~7) + docs/ANALYSIS_INFINITT_파일정밀분석.md
// 구성: lib/infiConfig.ts. Viewer2D(TY)와 동일 props 계약 — ViewerWindow 컴포넌트 맵에서 선택.
//
// 가이드 재현 요소:
// - 좌측 세로 툴바(§3.4 Select/Pan/Zoom/Windowing/Fit/Flip/Rotate/Invert/Reset/Capture)
// - 시리즈 썸네일 열 + Combine Series(Step 6)
// - Crosslink 바(§3.3 Auto sync·Scout lines 등) + 레이아웃 1x1~4x4(Step 7)
// - 마우스 체계(§3.5): 좌드래그=선택 도구, **우드래그=W/L**, 휠=스택, Ctrl+휠=Zoom, **더블클릭=최대화**
// - W/L 3방법(§3.2): 도구 / 프리셋(CT·MR 실측값) / 우드래그
// - Close Exam 옵션(Step 8), 4코너 오버레이
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type InstanceNode, type SeriesNode, type StudyDetail } from "../api";
import { DICOMWEB_ROOT } from "../lib/cornerstone";
import { IN_CROSSLINK_MODES, IN_LAYOUTS, IN_WL_PRESETS_CT, IN_WL_PRESETS_MR } from "../lib/infiConfig";

interface Pane {
  series: SeriesNode | null;
  index: number;
  zoom: number; tx: number; ty: number; rot: number;
  flipH: boolean; flipV: boolean; invert: boolean;
  wl: string;   // "c,w" — ""=서버 기본
}
const initPane = (): Pane => ({
  series: null, index: 0, zoom: 1, tx: 0, ty: 0, rot: 0,
  flipH: false, flipV: false, invert: false, wl: "",
});

function imgUrl(studyUid: string, p: Pane): string | null {
  const inst = p.series?.instances[p.index];
  if (!p.series || !inst) return null;
  const wl = p.wl ? `?window=${p.wl},linear` : "";
  return `${DICOMWEB_ROOT}/studies/${studyUid}/series/${p.series.series_uid}/instances/${inst.sop_uid}/rendered${wl}`;
}

type Tool = "select" | "pan" | "zoom" | "wl";
const TOOLS: { id: Tool | string; icon: string; label: string; impl: boolean }[] = [
  { id: "select", icon: "➤", label: "Select — 이미지 선택", impl: true },
  { id: "pan", icon: "✥", label: "Pan — 이미지 이동(좌드래그)", impl: true },
  { id: "zoom", icon: "🔍", label: "Zoom — 좌드래그 확대/축소 (Ctrl+휠)", impl: true },
  { id: "wl", icon: "◐", label: "Windowing — W/L (우드래그는 항상 W/L)", impl: true },
  { id: "magnify", icon: "⌕", label: "Magnification — 부분 확대(개발 예정)", impl: false },
  { id: "fit", icon: "▣", label: "Fit — 창 크기에 맞춤", impl: true },
  { id: "invert", icon: "◑", label: "B/W Inverse — 흑백 반전", impl: true },
  { id: "flipH", icon: "⇋", label: "Flip Horizontal — 좌우", impl: true },
  { id: "flipV", icon: "⇵", label: "Flip Vertical — 상하", impl: true },
  { id: "rotL", icon: "⟲", label: "Rotate Left 90", impl: true },
  { id: "rotR", icon: "⟳", label: "Rotate Right 90", impl: true },
  { id: "cine", icon: "▶", label: "Auto Scroll — 시네 재생/정지", impl: true },
  { id: "capture", icon: "📷", label: "Capture — 현재 이미지 PNG 저장", impl: true },
  { id: "measure", icon: "📏", label: "Measure 2D Line/Angle/Cobb — 개발 예정", impl: false },
  { id: "shutter", icon: "◙", label: "Shutter Ellipse/Rect/Polyline — 개발 예정", impl: false },
  { id: "reset", icon: "↺", label: "Reset — 초기값 복원", impl: true },
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
  const [layout, setLayout] = useState<{ r: number; c: number }>({ r: 1, c: 1 });
  const [panes, setPanes] = useState<Pane[]>([initPane()]);
  const [active, setActive] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [maximized, setMaximized] = useState<number | null>(null);
  const [cine, setCine] = useState(false);
  const [closeMenu, setCloseMenu] = useState(false);
  // Crosslink 바 상태 (§3.3) — auto_sync 만 v1 동작, 나머지는 표시(개발 예정)
  const [xlink, setXlink] = useState<Record<string, boolean>>({ auto_sync: true });
  const drag = useRef<{ x: number; y: number; btn: number; pane: number } | null>(null);

  const wlPresets = detail.modality === "MR" ? IN_WL_PRESETS_MR : IN_WL_PRESETS_CT;

  useEffect(() => {
    api.seriesTree(detail.id).then((r) => {
      setSeries(r.series);
      if (r.series.length) setPanes((ps) => {
        const next = [...ps];
        next[0] = { ...initPane(), series: r.series[0] };
        return next;
      });
    }).catch(() => {});
  }, [detail.id]);

  // 레이아웃 변경 — 페인 수 조정, 빈 페인은 다음 시리즈 순서대로 자동 배치(행잉 기본)
  const applyLayout = (l: { r: number; c: number }) => {
    setLayout(l);
    setMaximized(null);
    setPanes((ps) => {
      const n = l.r * l.c;
      const next = Array.from({ length: n }, (_, i) =>
        ps[i] ?? { ...initPane(), series: series[i % Math.max(series.length, 1)] ?? null });
      return next;
    });
  };

  const upd = useCallback((i: number, patch: Partial<Pane>) => {
    setPanes((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  }, []);

  // 스택 스크롤(+Auto Sync: 같은 검사의 다른 페인도 델타 동기 — §3.3 ②)
  const scroll = useCallback((i: number, delta: number) => {
    setPanes((ps) => ps.map((p, k) => {
      const target = k === i || (xlink.auto_sync && p.series);
      if (!target || !p.series) return p;
      const n = p.series.instances.length;
      return { ...p, index: Math.min(n - 1, Math.max(0, p.index + delta)) };
    }));
  }, [xlink.auto_sync]);

  // 시네(Auto Scroll)
  useEffect(() => {
    if (!cine) return;
    const t = setInterval(() => {
      setPanes((ps) => ps.map((p, k) => {
        if (k !== active || !p.series) return p;
        return { ...p, index: (p.index + 1) % p.series.instances.length };
      }));
    }, 100);
    return () => clearInterval(t);
  }, [cine, active]);

  // 툴바 원샷 동작
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
      case "reset": upd(active, { ...initPane(), series: p.series, index: p.index }); break;
      case "cine": setCine((c) => !c); break;
      case "capture": {
        const u = imgUrl(detail.study_uid, p);
        if (u) { const a = document.createElement("a"); a.href = u; a.download = "capture.png"; a.click(); }
        break;
      }
      default:
        if (["select", "pan", "zoom", "wl"].includes(id)) setTool(id as Tool);
    }
  };

  // 마우스 체계 (§3.5)
  const onMouseDown = (e: React.MouseEvent, i: number) => {
    setActive(i);
    if (e.button === 0 || e.button === 2) {
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
    const mode: Tool = d.btn === 2 ? "wl" : tool;   // 우드래그는 항상 W/L(가이드 §3.2·3.5)
    if (mode === "pan") upd(d.pane, { tx: p.tx + dx, ty: p.ty + dy });
    else if (mode === "zoom") upd(d.pane, { zoom: Math.max(0.05, Math.min(30, p.zoom * (1 - dy / 200))) });
    else if (mode === "wl") {
      const [c0, w0] = p.wl ? p.wl.split(",").map(Number) : [128, 256];
      const c = Math.round(c0 + dy), w = Math.max(1, Math.round(w0 + dx));
      upd(d.pane, { wl: `${c},${w}` });
    }
  };
  const endDrag = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent, i: number) => {
    if (e.ctrlKey) {
      const p = panes[i];
      if (p) upd(i, { zoom: Math.max(0.05, Math.min(30, p.zoom * (e.deltaY < 0 ? 1.1 : 0.9))) });
    } else scroll(i, e.deltaY > 0 ? 1 : -1);
  };

  // Combine Series (Step 6) — 모든 시리즈 인스턴스를 하나로 합친 가상 시리즈
  const combine = () => {
    const all: InstanceNode[] = series.flatMap((s) => s.instances);
    if (!all.length) return;
    const comb: SeriesNode = {
      series_uid: series[0].series_uid, modality: detail.modality,
      series_desc: `[Combine] ${series.length} series`, series_number: 0, instances: all,
    };
    // 주의: rendered URL 은 시리즈 UID 필요 — 인스턴스별 원 시리즈 UID 를 찾도록 개별 시리즈 유지가 정확하나
    // v1 은 단일 시리즈 UID 로 동작(동일 시리즈 UID 인스턴스만 정확). 다중 시리즈 정밀 결합은 차기.
    upd(active, { series: comb, index: 0 });
  };

  const gridPanes = maximized !== null ? [maximized] : panes.map((_, i) => i);
  const cols = maximized !== null ? 1 : layout.c;
  const rows = maximized !== null ? 1 : layout.r;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#000", color: "var(--text-secondary)" }}
         onContextMenu={(e) => e.preventDefault()} onMouseUp={endDrag} onMouseLeave={endDrag}>
      {/* 상단 바 — 환자 정보 + Crosslink 바(§3.3) + 레이아웃 + Close */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 10px",
                    background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
        <b style={{ color: "var(--text-primary)" }}>In Viewer</b>
        <span>{detail.patient_key} · {detail.patient_name} · {detail.modality} · {detail.study_date}</span>
        <span style={{ display: "flex", gap: 8, marginLeft: 12 }}>
          {IN_CROSSLINK_MODES.map((m) => (
            <label key={m.key} title={m.desc + (m.key === "auto_sync" ? "" : " (개발 예정)")}
                   style={{ display: "flex", gap: 3, alignItems: "center",
                            opacity: m.key === "auto_sync" ? 1 : 0.5 }}>
              <input type="checkbox" checked={!!xlink[m.key]} disabled={m.key !== "auto_sync"}
                     onChange={(e) => setXlink((x) => ({ ...x, [m.key]: e.target.checked }))} />
              {m.label}
            </label>
          ))}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
          {IN_LAYOUTS.map((l) => (
            <button key={`${l.r}x${l.c}`} onClick={() => applyLayout(l)}
                    style={{ padding: "1px 7px", fontSize: 11,
                             background: layout.r === l.r && layout.c === l.c ? "var(--accent)" : undefined,
                             color: layout.r === l.r && layout.c === l.c ? "#fff" : undefined }}>
              {l.r}x{l.c}
            </button>
          ))}
          <span style={{ position: "relative" }}>
            <button onClick={() => setCloseMenu((v) => !v)} style={{ padding: "1px 10px", fontSize: 11 }}>
              Close Exam ▾
            </button>
            {closeMenu && (
              <div style={{ position: "absolute", right: 0, top: "110%", zIndex: 30, background: "var(--bg-elevated)",
                            border: "1px solid var(--border)", borderRadius: 4, minWidth: 180, fontSize: 12 }}>
                {[["현재 검사 닫기", onClose],
                  ["모든 검사 닫기", () => window.close()],
                  ["닫고 Worklist 로", () => { onClose(); window.close(); }]].map(([label, fn]) => (
                  <div key={label as string} onClick={fn as () => void}
                       style={{ padding: "6px 10px", cursor: "pointer" }}>{label as string}</div>
                ))}
                <div style={{ padding: "6px 10px", opacity: 0.45 }} title="개발 예정">닫으며 자동 Verify</div>
              </div>
            )}
          </span>
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 좌측 세로 툴바 (§3.4) */}
        <div style={{ width: 44, background: "var(--bg-panel)", borderRight: "1px solid var(--border)",
                      display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 0", gap: 2, overflowY: "auto" }}>
          {TOOLS.map((t) => (
            <button key={t.id} title={t.label} onClick={() => t.impl && fire(t.id)}
                    style={{ width: 34, height: 30, fontSize: 14, padding: 0,
                             opacity: t.impl ? 1 : 0.35,
                             background: (tool === t.id || (t.id === "cine" && cine)) ? "var(--accent)" : "transparent",
                             color: (tool === t.id || (t.id === "cine" && cine)) ? "#fff" : "var(--text-secondary)",
                             border: "1px solid transparent", borderRadius: 4, cursor: t.impl ? "pointer" : "default" }}>
              {t.icon}
            </button>
          ))}
        </div>

        {/* 시리즈 썸네일 열 (Step 6) */}
        <div style={{ width: 120, background: "var(--bg-canvas)", borderRight: "1px solid var(--border)",
                      overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={combine} title="Combine Series — 시리즈를 하나로 합쳐 표시" style={{ fontSize: 11 }}>
            Combine
          </button>
          {series.map((s) => (
            <div key={s.series_uid}
                 onClick={() => upd(active, { series: s, index: 0 })}
                 style={{ cursor: "pointer", textAlign: "center", fontSize: 10.5,
                          border: panes[active]?.series?.series_uid === s.series_uid
                            ? "2px solid var(--accent)" : "1px solid var(--border)",
                          borderRadius: 4, padding: 2 }}>
              {s.instances[0] && (
                <img src={s.instances[0].preview_url} alt="" style={{ width: "100%", display: "block", borderRadius: 2 }} />
              )}
              <div style={{ padding: "1px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Se{s.series_number} · {s.instances.length}장
              </div>
            </div>
          ))}
        </div>

        {/* 뷰포트 격자 (Step 7) */}
        <div style={{ flex: 1, display: "grid", minWidth: 0,
                      gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gap: 1 }}>
          {gridPanes.map((i) => {
            const p = panes[i];
            const url = p ? imgUrl(detail.study_uid, p) : null;
            const inst = p?.series?.instances[p.index];
            const wlText = p?.wl ? p.wl.replace(",", " / ") : "기본";
            return (
              <div key={i}
                   onMouseDown={(e) => onMouseDown(e, i)} onMouseMove={onMouseMove}
                   onWheel={(e) => onWheel(e, i)}
                   onDoubleClick={() => setMaximized((m) => (m === null ? i : null))}
                   style={{ position: "relative", overflow: "hidden", background: "#000",
                            outline: active === i ? "1px solid var(--accent)" : "1px solid #222", cursor: "crosshair" }}>
                {url ? (
                  <img src={url} alt="" draggable={false}
                       style={{ position: "absolute", inset: 0, margin: "auto", maxWidth: "100%", maxHeight: "100%",
                                transform: `translate(${p.tx}px,${p.ty}px) scale(${p.zoom * (p.flipH ? -1 : 1)},${p.zoom * (p.flipV ? -1 : 1)}) rotate(${p.rot}deg)`,
                                filter: p.invert ? "invert(1)" : undefined, userSelect: "none" }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12 }}>
                    시리즈를 선택하세요
                  </div>
                )}
                {/* 4코너 오버레이 (DemographicManager 모델) */}
                {p?.series && (
                  <>
                    <div style={ovl("tl")}>{detail.patient_name}<br />{detail.patient_key}<br />{detail.sex}</div>
                    <div style={ovl("tr")}>{detail.modality} {detail.body_part}<br />{detail.study_date}</div>
                    <div style={ovl("bl")}>Se:{p.series.series_number} Im:{p.index + 1}/{p.series.instances.length}<br />W/L: {wlText}</div>
                    <div style={ovl("br")}>Zoom {(p.zoom * 100).toFixed(0)}%<br />{p.series.series_desc}</div>
                  </>
                )}
                {inst && <ScrollBar index={p.index} total={p.series!.instances.length} />}
              </div>
            );
          })}
        </div>

        {/* 우측 W/L 프리셋 (§3.2 ② Windowing Preset) */}
        <div style={{ width: 108, background: "var(--bg-panel)", borderLeft: "1px solid var(--border)",
                      padding: 6, overflowY: "auto", fontSize: 11.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>
            W/L Preset ({detail.modality === "MR" ? "MR" : "CT"})
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
      </div>
    </div>
  );
}

function ovl(corner: "tl" | "tr" | "bl" | "br"): React.CSSProperties {
  return {
    position: "absolute", fontSize: 10.5, lineHeight: 1.35, color: "#7dd3fc", pointerEvents: "none",
    textShadow: "0 0 3px #000",
    top: corner[0] === "t" ? 4 : undefined, bottom: corner[0] === "b" ? 4 : undefined,
    left: corner[1] === "l" ? 6 : undefined, right: corner[1] === "r" ? 6 : undefined,
    textAlign: corner[1] === "r" ? "right" : "left",
  };
}

function ScrollBar({ index, total }: { index: number; total: number }) {
  if (total <= 1) return null;
  return (
    <div style={{ position: "absolute", right: 2, top: "10%", bottom: "10%", width: 3, background: "#222", borderRadius: 2 }}>
      <div style={{ position: "absolute", left: 0, right: 0, borderRadius: 2, background: "var(--accent)",
                    top: `${(index / (total - 1)) * 92}%`, height: "8%" }} />
    </div>
  );
}
