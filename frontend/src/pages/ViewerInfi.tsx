// In Viewer — INFINITT PiViewSTAR 스타일 Client 뷰어 (v2).
// 원본 화면 구성(사용자 첨부 원본 스크린샷 + User Guide §3) 재현:
//   [상단] 가로 시리즈 썸네일 스트립 → [정보바] Examined·환자 + Series/Image Layout 콤보 + Crosslink
//   [좌측] 2열 아이콘 툴바(원본 툴 팔레트) — 하단 Setting(W/L 패널 토글)
//   [중앙] Image Layout NxM = 활성 시리즈의 연속 이미지 타일(원본 CT 3x3 방식),
//          Series Layout NxM = 페인별 독립 시리즈. 이미지는 타일에 맞춤(fit) 후 Zoom 배율.
// 마우스(§3.5): 좌드래그=선택 도구, 우드래그=항상 W/L, 휠=스택, Ctrl+휠=Zoom, 더블클릭=최대화.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type InstanceNode, type SeriesNode, type StudyDetail } from "../api";
import { DICOMWEB_ROOT } from "../lib/cornerstone";
import { IN_CROSSLINK_MODES, IN_LAYOUTS, IN_WL_PRESETS_CT, IN_WL_PRESETS_MR } from "../lib/infiConfig";

interface Pane {
  series: SeriesNode | null;
  index: number;
  zoom: number; tx: number; ty: number; rot: number;
  flipH: boolean; flipV: boolean; invert: boolean;
  wl: string;
}
const initPane = (): Pane => ({
  series: null, index: 0, zoom: 1, tx: 0, ty: 0, rot: 0,
  flipH: false, flipV: false, invert: false, wl: "",
});

function instUrl(studyUid: string, s: SeriesNode, inst: InstanceNode, wl: string): string {
  const q = wl ? `?window=${wl},linear` : "";
  return `${DICOMWEB_ROOT}/studies/${studyUid}/series/${s.series_uid}/instances/${inst.sop_uid}/rendered${q}`;
}

type Tool = "select" | "pan" | "zoom" | "wl";
// 원본 툴 팔레트(3번 이미지) — 2열 그리드. impl=false 는 반투명(개발 대상)
const PALETTE: { id: string; icon: string; label: string; impl: boolean }[] = [
  { id: "select", icon: "➤", label: "Select", impl: true },
  { id: "zoom", icon: "🔍", label: "Zoom (Ctrl+휠)", impl: true },
  { id: "magnify", icon: "⌕", label: "Magnification (개발 예정)", impl: false },
  { id: "wl", icon: "◐", label: "Windowing — 우드래그도 W/L", impl: true },
  { id: "invert", icon: "◑", label: "B/W Inverse", impl: true },
  { id: "pan", icon: "✥", label: "Pan", impl: true },
  { id: "fit", icon: "▣", label: "Fit(원크기 복원)", impl: true },
  { id: "text", icon: "T", label: "Text Annotation (개발 예정)", impl: false },
  { id: "memo", icon: "M", label: "Memo Post-it (개발 예정)", impl: false },
  { id: "line", icon: "╱", label: "2D Line 측정 (개발 예정)", impl: false },
  { id: "angle", icon: "∠", label: "Angle 측정 (개발 예정)", impl: false },
  { id: "ruler", icon: "📏", label: "Caliper (개발 예정)", impl: false },
  { id: "roi", icon: "▭", label: "ROI Rect/Oval (개발 예정)", impl: false },
  { id: "shutter", icon: "◙", label: "Shutter (개발 예정)", impl: false },
  { id: "flipH", icon: "⇋", label: "Flip Horizontal", impl: true },
  { id: "flipV", icon: "⇵", label: "Flip Vertical", impl: true },
  { id: "rotL", icon: "⟲", label: "Rotate Left 90", impl: true },
  { id: "rotR", icon: "⟳", label: "Rotate Right 90", impl: true },
  { id: "cine", icon: "▶", label: "Auto Scroll(Cine)", impl: true },
  { id: "capture", icon: "📷", label: "Capture PNG", impl: true },
  { id: "print", icon: "🖨", label: "Print (개발 예정)", impl: false },
  { id: "reset", icon: "↺", label: "Reset", impl: true },
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
  // Series Layout(페인별 시리즈) × Image Layout(페인 내 연속 이미지 타일) — 원본 콤보 2개
  const [sLayout, setSLayout] = useState<{ r: number; c: number }>({ r: 1, c: 1 });
  const [iLayout, setILayout] = useState<{ r: number; c: number }>({ r: 1, c: 1 });
  const [panes, setPanes] = useState<Pane[]>([initPane()]);
  const [active, setActive] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [maximized, setMaximized] = useState<number | null>(null);
  const [cine, setCine] = useState(false);
  const [closeMenu, setCloseMenu] = useState(false);
  const [wlPanel, setWlPanel] = useState(false);   // 툴바 하단 Setting 토글
  const [xlink, setXlink] = useState<Record<string, boolean>>({ auto_sync: true });
  const drag = useRef<{ x: number; y: number; btn: number; pane: number } | null>(null);

  const wlPresets = detail.modality === "MR" ? IN_WL_PRESETS_MR : IN_WL_PRESETS_CT;
  const tilesPerPane = iLayout.r * iLayout.c;

  useEffect(() => {
    api.seriesTree(detail.id).then((r) => {
      setSeries(r.series);
      if (r.series.length) setPanes((ps) => {
        const next = [...ps];
        next[0] = { ...initPane(), series: r.series[0] };
        return next;
      });
      // 원본 기본 행잉: CT/MR 다층 시리즈면 Image Layout 3x3 (원본 CT 화면)
      const first = r.series[0];
      if (first && ["CT", "MR"].includes(first.modality) && first.instances.length >= 9) {
        setILayout({ r: 3, c: 3 });
      }
    }).catch(() => {});
  }, [detail.id]);

  const applySLayout = (l: { r: number; c: number }) => {
    setSLayout(l);
    setMaximized(null);
    setPanes((ps) => Array.from({ length: l.r * l.c }, (_, i) =>
      ps[i] ?? { ...initPane(), series: series[i % Math.max(series.length, 1)] ?? null }));
  };

  const upd = useCallback((i: number, patch: Partial<Pane>) => {
    setPanes((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  }, []);

  const scroll = useCallback((i: number, delta: number) => {
    setPanes((ps) => ps.map((p, k) => {
      const target = k === i || (xlink.auto_sync && p.series);
      if (!target || !p.series) return p;
      const max = Math.max(0, p.series.instances.length - 1);
      return { ...p, index: Math.min(max, Math.max(0, p.index + delta)) };
    }));
  }, [xlink.auto_sync]);

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
        const inst = p.series?.instances[p.index];
        if (p.series && inst) {
          const a = document.createElement("a");
          a.href = instUrl(detail.study_uid, p.series, inst, p.wl);
          a.download = "capture.png"; a.click();
        }
        break;
      }
      default:
        if (["select", "pan", "zoom", "wl"].includes(id)) setTool(id as Tool);
    }
  };

  const onMouseDown = (e: React.MouseEvent, i: number) => {
    setActive(i);
    if (e.button === 0 || e.button === 2) drag.current = { x: e.clientX, y: e.clientY, btn: e.button, pane: i };
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#000", color: "var(--text-secondary)" }}
         onContextMenu={(e) => e.preventDefault()} onMouseUp={endDrag} onMouseLeave={endDrag}>

      {/* ── 상단 가로 썸네일 스트립 (원본 최상단) ── */}
      <div style={{ display: "flex", gap: 4, padding: "4px 6px", background: "var(--bg-panel)",
                    borderBottom: "1px solid var(--border)", overflowX: "auto", flexShrink: 0, alignItems: "center" }}>
        <b style={{ color: "var(--text-primary)", fontSize: 12, flexShrink: 0 }}>In Viewer</b>
        <button onClick={combine} title="Combine Series" style={{ fontSize: 11, flexShrink: 0 }}>Combine</button>
        {series.map((s) => (
          <div key={s.series_uid} onClick={() => upd(active, { series: s, index: 0 })}
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

      {/* ── 정보바 (원본: Examined, 일시, 환자명, ID + Layout/Exam 콤보) ── */}
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
        <span style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {IN_CROSSLINK_MODES.map((m) => (
            <label key={m.key} title={m.desc + (m.key === "auto_sync" ? "" : " (개발 예정)")}
                   style={{ display: "flex", gap: 3, alignItems: "center", opacity: m.key === "auto_sync" ? 1 : 0.5 }}>
              <input type="checkbox" checked={!!xlink[m.key]} disabled={m.key !== "auto_sync"}
                     onChange={(e) => setXlink((x) => ({ ...x, [m.key]: e.target.checked }))} />
              {m.label}
            </label>
          ))}
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ── 좌측 2열 아이콘 툴바 (원본 툴 팔레트) ── */}
        <div style={{ width: 72, background: "var(--bg-panel)", borderRight: "1px solid var(--border)",
                      display: "flex", flexDirection: "column", padding: "6px 4px", gap: 4, flexShrink: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, overflowY: "auto" }}>
            {PALETTE.map((t) => (
              <button key={t.id} title={t.label} onClick={() => t.impl && fire(t.id)}
                      style={{ height: 28, fontSize: 13, padding: 0,
                               opacity: t.impl ? 1 : 0.32,
                               background: (tool === t.id || (t.id === "cine" && cine)) ? "var(--accent)" : "var(--bg-elevated)",
                               color: (tool === t.id || (t.id === "cine" && cine)) ? "#fff" : "var(--text-secondary)",
                               border: "1px solid var(--border)", borderRadius: 3,
                               cursor: t.impl ? "pointer" : "default" }}>
                {t.icon}
              </button>
            ))}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            <button title="More (개발 예정)" style={{ fontSize: 10.5, opacity: 0.4 }}>More</button>
            <button title="W/L Preset 패널 토글" onClick={() => setWlPanel((v) => !v)}
                    style={{ fontSize: 10.5, background: wlPanel ? "var(--accent)" : undefined,
                             color: wlPanel ? "#fff" : undefined }}>
              Setting
            </button>
          </div>
        </div>

        {/* ── 뷰포트: Series Layout 페인 × 페인 내 Image Layout 타일 ── */}
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
                   onMouseDown={(e) => onMouseDown(e, pi)} onMouseMove={onMouseMove}
                   onWheel={(e) => onWheel(e, pi)}
                   onDoubleClick={() => setMaximized((m) => (m === null ? pi : null))}
                   style={{ position: "relative", minWidth: 0, minHeight: 0, background: "#000",
                            outline: active === pi ? "1px solid #4ade80" : "1px solid #1e293b",
                            display: "grid", cursor: "crosshair",
                            gridTemplateColumns: `repeat(${iLayout.c}, 1fr)`,
                            gridTemplateRows: `repeat(${iLayout.r}, 1fr)`, gap: 1 }}>
                {Array.from({ length: tilesPerPane }, (_, t) => {
                  const idx = p.index + t;
                  const inst = insts[idx];
                  return (
                    <div key={t} style={{ position: "relative", overflow: "hidden", background: "#000" }}>
                      {p.series && inst ? (
                        <>
                          <img src={instUrl(detail.study_uid, p.series, inst, p.wl)} alt="" draggable={false}
                               style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                                        objectFit: "contain",
                                        transform: `translate(${p.tx}px,${p.ty}px) scale(${p.zoom * (p.flipH ? -1 : 1)},${p.zoom * (p.flipV ? -1 : 1)}) rotate(${p.rot}deg)`,
                                        filter: p.invert ? "invert(1)" : undefined, userSelect: "none" }} />
                          {/* 타일 4코너 오버레이 (원본: 타일마다 표시) */}
                          <div style={ovl("tl")}>{detail.patient_name}<br />{detail.patient_key}</div>
                          <div style={ovl("tr")}>{detail.modality} {detail.study_date}</div>
                          <div style={ovl("bl")}>Se:{p.series.series_number} Im:{idx + 1}/{insts.length}<br />W/L: {wlText}</div>
                          <div style={ovl("br")}>Zoom {(p.zoom * 100).toFixed(0)}%</div>
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

        {/* ── W/L Preset 패널 (툴바 Setting 토글 — 원본은 우클릭 메뉴) ── */}
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
