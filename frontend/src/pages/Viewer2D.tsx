// Saintview 2D 뷰어 — WADO-RS /rendered 기반(픽셀 보장) + Zetta/INFINITT 레이아웃
// 설정 연동: 팔레트/썸네일 방향·크기, 썸네일 모드(시리즈/전체), 행잉(모달리티→분할), 판독 도크
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, openViewer, type Report, type SeriesNode, type StudyDetail } from "../api";
import { DICOMWEB_ROOT } from "../lib/cornerstone";

const PANE_IDS = ["p0", "p1", "p2", "p3"];
const LAYOUTS: Record<string, { cols: number; rows: number; count: number }> = {
  "1x1": { cols: 1, rows: 1, count: 1 },
  "1x2": { cols: 2, rows: 1, count: 2 },
  "2x2": { cols: 2, rows: 2, count: 4 },
};
const WL_PRESETS = [
  { key: "auto", label: "Auto", q: "" },
  { key: "lung", label: "폐", q: "-600,1500" },
  { key: "medi", label: "종격동", q: "40,400" },
  { key: "bone", label: "뼈", q: "300,1500" },
  { key: "brain", label: "뇌", q: "40,80" },
  { key: "abd", label: "복부", q: "60,400" },
];

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

function renderedUrl(p: PaneState): string | null {
  const inst = p.series?.instances[p.index];
  if (!p.series || !inst) return null;
  const wl = p.wl ? `?window=${p.wl},linear` : "";
  return `${DICOMWEB_ROOT}/studies/${p.studyUid}/series/${p.series.series_uid}/instances/${inst.sop_uid}/rendered${wl}`;
}

interface ViewerPrefs {
  paletteSide: "left" | "top";
  thumbSide: "left" | "bottom";
  thumbSize: number;        // px
  thumbMode: "series" | "all";
  hanging2d: Record<string, string>;  // modality → layout key
  reportDock: boolean;
}
const DEFAULT_PREFS: ViewerPrefs = {
  paletteSide: "left", thumbSide: "left", thumbSize: 84,
  thumbMode: "series", hanging2d: {}, reportDock: true,
};

export function Viewer2D({ detail, onClose }: { detail: StudyDetail; onClose: () => void }) {
  const [prefs, setPrefs] = useState<ViewerPrefs>(DEFAULT_PREFS);
  const [series, setSeries] = useState<SeriesNode[]>([]);
  const [layout, setLayout] = useState<keyof typeof LAYOUTS>("1x1");
  const [activePane, setActivePane] = useState("p0");
  const [panes, setPanes] = useState<Record<string, PaneState>>(
    Object.fromEntries(PANE_IDS.map((p) => [p, initPane(detail.study_uid)])),
  );
  const [selSeries, setSelSeries] = useState<string | null>(null);
  const [mouseMode, setMouseMode] = useState<"wl" | "zoom" | "pan">("zoom");
  const [section, setSection] = useState<"common" | "anno" | "2d" | "etc">("common");
  const [syncScroll, setSyncScroll] = useState(false);   // 화면 연동(요청 3)
  const [thumbOpen, setThumbOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [overlayOn, setOverlayOn] = useState(true);
  const [cine, setCine] = useState(false);
  const cineRef = useRef<number | null>(null);
  const [status, setStatus] = useState("");
  // 판독 도크(요청 5)
  const [report, setReport] = useState<Report | null>(null);
  const [priorTrees, setPriorTrees] = useState<Record<number, { uid: string; series: SeriesNode[] }>>({});

  const patch = useCallback((pid: string, p: Partial<PaneState>) => {
    setPanes((prev) => ({ ...prev, [pid]: { ...prev[pid], ...p } }));
  }, []);

  /* 설정 로드 + 행잉 적용(요청 4: 모달리티→분할) */
  useEffect(() => {
    api.getSetting("viewer.prefs").then((r) => {
      const v = r.value as Partial<ViewerPrefs> & { hanging2d?: Record<string, string> };
      const merged = { ...DEFAULT_PREFS, ...v };
      setPrefs(merged);
      const hp = merged.hanging2d?.[detail.modality];
      if (hp && LAYOUTS[hp]) setLayout(hp as keyof typeof LAYOUTS);
    }).catch(() => {});
  }, [detail.modality]);

  /* 시리즈 트리 + 리포트 로드 */
  useEffect(() => {
    api.seriesTree(detail.id).then((r) => {
      const imgSeries = r.series.filter((s) => !["SR", "KO", "PR", "SEG"].includes(s.modality));
      setSeries(imgSeries);
      if (imgSeries[0]) {
        setSelSeries(imgSeries[0].series_uid);
        setPanes((prev) => {
          const next = { ...prev };
          PANE_IDS.forEach((pid, i) => {
            const s = imgSeries[Math.min(i, imgSeries.length - 1)];
            next[pid] = { ...initPane(detail.study_uid), series: s, index: Math.floor(s.instances.length / 2) };
          });
          return next;
        });
      }
    }).catch(() => setStatus("시리즈 조회 실패"));
    api.reports(detail.id).then((r) => setReport(r.items[0] ?? null)).catch(() => {});
    return () => { if (cineRef.current) window.clearInterval(cineRef.current); };
  }, [detail.id, detail.study_uid]);

  /* 과거검사 비교 로드(요청 5): related exam 클릭 → 활성 페인에 */
  const loadPrior = async (examId: number) => {
    let tree = priorTrees[examId];
    if (!tree) {
      const r = await api.seriesTree(examId);
      tree = { uid: r.study_uid, series: r.series.filter((s) => !["SR", "KO", "PR", "SEG"].includes(s.modality)) };
      setPriorTrees((p) => ({ ...p, [examId]: tree }));
    }
    const s = tree.series[0];
    if (s) patch(activePane, { ...initPane(tree.uid), series: s, index: Math.floor(s.instances.length / 2) });
  };

  const step = useCallback((pid: string, dir: number) => {
    setPanes((prev) => {
      const next = { ...prev };
      const apply = (id: string) => {
        const p = next[id];
        if (!p.series) return;
        next[id] = { ...p, index: Math.min(Math.max(p.index + dir, 0), p.series.instances.length - 1) };
      };
      if (syncScroll) PANE_IDS.slice(0, LAYOUTS[layout].count).forEach(apply);  // 화면 연동
      else apply(pid);
      return next;
    });
  }, [syncScroll, layout]);

  /* 마우스 상호작용 */
  const dragRef = useRef<{ pid: string; x: number; y: number; btn: number } | null>(null);
  const onPaneMouseDown = (pid: string, e: React.MouseEvent) => {
    setActivePane(pid);
    dragRef.current = { pid, x: e.clientX, y: e.clientY, btn: e.button };
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
        return prev; // wl 모드: /rendered는 프리셋 기반(2D 섹션) — 드래그 W/L은 Cornerstone 경로 복구 후
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

  const L = LAYOUTS[layout];
  const paletteHoriz = prefs.paletteSide === "top";
  const thumbHoriz = prefs.thumbSide === "bottom";
  const ts = prefs.thumbSize;

  const ModeBtn = ({ k, label, title }: { k: "wl" | "zoom" | "pan"; label: string; title: string }) => (
    <button onClick={() => setMouseMode(k)} title={title}
            style={{ padding: "5px 0", fontSize: 10.5, width: paletteHoriz ? 52 : "100%",
                     background: mouseMode === k ? "var(--accent)" : undefined }}>{label}</button>
  );
  const ActBtn = ({ a, label, title, on }: { a: string; label: string; title: string; on?: boolean }) => (
    <button onClick={() => act(a)} title={title}
            style={{ padding: "5px 0", fontSize: 10.5, width: paletteHoriz ? 52 : "100%",
                     background: on ? "var(--accent)" : undefined }}>{label}</button>
  );

  /* 팔레트(방향 전환 가능 — 요청 2) */
  const palette = paletteOpen && (
    <div style={{
      display: "flex", flexDirection: paletteHoriz ? "row" : "column", gap: 3, padding: 4,
      background: "var(--bg-panel)", flexShrink: 0, overflow: "auto", alignItems: paletteHoriz ? "center" : undefined,
      ...(paletteHoriz ? { borderBottom: "1px solid var(--border)" } : { width: 100, borderRight: "1px solid var(--border)" }),
    }}>
      <select value={layout} onChange={(e) => setLayout(e.target.value as keyof typeof LAYOUTS)}
              style={{ fontSize: 11, width: paletteHoriz ? 70 : "100%" }}>
        <option value="1x1">1 X 1</option><option value="1x2">1 X 2</option><option value="2x2">2 X 2</option>
      </select>
      <button style={{ padding: "3px 6px", fontSize: 10.5, background: syncScroll ? "var(--accent)" : undefined }}
              title="화면 연동: 모든 페인 동시 스크롤 (CrossLink)" onClick={() => setSyncScroll((s) => !s)}>
        Link{syncScroll ? "●" : ""}
      </button>
      <button style={{ padding: "3px 6px", fontSize: 10.5 }} onClick={() => setThumbOpen((t) => !t)}>Thumb</button>
      <button style={{ padding: "3px 6px", fontSize: 10.5 }} onClick={() => setPaletteOpen(false)}>Hide</button>
      {([["common", "Common"], ["anno", "Anno"], ["2d", "2D"], ["etc", "ETC"]] as const).map(([k, label]) => (
        <div key={k} style={paletteHoriz ? { display: "flex", gap: 3, alignItems: "center" } : undefined}>
          <div onClick={() => setSection(k)}
               style={{ padding: "3px 6px", fontSize: 10, fontWeight: 700, cursor: "pointer",
                        color: "var(--text-secondary)", background: section === k ? "var(--bg-elevated)" : undefined }}>
            {label}
          </div>
          {section === k && (
            <div style={{
              display: paletteHoriz ? "flex" : "grid", gap: 3,
              ...(paletteHoriz ? {} : { gridTemplateColumns: "1fr 1fr", padding: "3px 0" }),
            }}>
              {k === "common" && (<>
                <ModeBtn k="zoom" label="Zoom" title="좌드래그=확대 (우드래그 항상 Zoom)" />
                <ModeBtn k="pan" label="Pan" title="좌드래그=이동 (중드래그 항상 Pan)" />
                <ActBtn a="fit" label="Fit" title="화면 맞춤" />
                <ActBtn a="invert" label="Inv" title="반전" on={panes[activePane].invert} />
                <ActBtn a="rotL" label="⟲90" title="좌회전" />
                <ActBtn a="rotR" label="⟳90" title="우회전" />
                <ActBtn a="flipH" label="⇋" title="좌우반전" />
                <ActBtn a="flipV" label="⇵" title="상하반전" />
                <ActBtn a="cine" label={cine ? "■" : "▶"} title="시네" on={cine} />
                <ActBtn a="capture" label="Cap" title="PNG 저장" />
                <ActBtn a="reset" label="Reset" title="초기화" />
              </>)}
              {k === "anno" && (
                <span style={{ fontSize: 9.5, color: "var(--text-secondary)", padding: 4, gridColumn: "1/3", maxWidth: 90 }}>
                  측정·ROI는 Cornerstone 렌더 경로 복구 후 활성화(차기)
                </span>
              )}
              {k === "2d" && WL_PRESETS.map((pr) => (
                <button key={pr.key} title={`W/L ${pr.q || "기본"}`}
                        onClick={() => patch(activePane, { wl: pr.q })}
                        style={{ padding: "5px 0", fontSize: 10.5, width: paletteHoriz ? 52 : "100%",
                                 background: panes[activePane].wl === pr.q ? "var(--accent)" : undefined }}>
                  {pr.label}
                </button>
              ))}
              {k === "etc" && (<>
                <button style={{ padding: "5px 4px", fontSize: 10.5 }} onClick={() => openViewer(detail.study_uid)}>OHIF</button>
                <button style={{ padding: "5px 4px", fontSize: 10.5 }}
                        onClick={() => window.dispatchEvent(new CustomEvent("sv-open-3d", { detail: detail.study_uid }))}>3D</button>
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
                     : { borderRight: "1px solid var(--border)", width: ts + 34 }),
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

  /* 판독 도크(요청 5): 현재 리포트 + 과거검사(클릭→비교 로드) */
  const dock = prefs.reportDock && (
    <div style={{ width: 250, borderLeft: "1px solid var(--border)", background: "var(--bg-panel)",
                  display: "flex", flexDirection: "column", flexShrink: 0, overflow: "auto" }}>
      <div style={{ padding: "4px 8px", fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)",
                    background: "var(--bg-elevated)" }}>REPORT {report?.created_by === "ai" && "· AI 초안"}</div>
      <div style={{ padding: 8, fontSize: 11.5, whiteSpace: "pre-wrap", flex: 1, overflow: "auto" }}>
        {report?.narrative_text || "리포트 없음"}
      </div>
      <div style={{ padding: "4px 8px", fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)",
                    background: "var(--bg-elevated)", borderTop: "1px solid var(--border)" }}>
        과거검사 (클릭=활성 페인 비교)
      </div>
      <div style={{ maxHeight: 170, overflow: "auto" }}>
        {detail.related_exams.map((e) => (
          <div key={e.id} onClick={() => void loadPrior(e.id)}
               style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", borderBottom: "1px solid #24282d" }}
               onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
               onMouseLeave={(ev) => (ev.currentTarget.style.background = "")}>
            {e.study_date} {e.modality} <span style={{ color: "var(--text-secondary)" }}>{e.study_desc}</span>
          </div>
        ))}
        {detail.related_exams.length === 0 && (
          <div style={{ padding: 8, fontSize: 11, color: "var(--text-secondary)" }}>과거 검사 없음</div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200, display: "flex", flexDirection: "column" }}
         onContextMenu={(e) => e.preventDefault()}>
      {/* 상단 검사탭 바 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                    background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
        <button onClick={onClose} style={{ fontWeight: 700 }}>WORKLIST</button>
        <div style={{ background: "var(--accent)", borderRadius: "4px 4px 0 0", padding: "4px 14px",
                      fontSize: 12, fontWeight: 600, alignSelf: "flex-end" }}>
          {detail.modality},{detail.body_part || detail.patient_name},{detail.study_date} ✕
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
          [{panes[activePane].index + 1}/{panes[activePane].series?.instances.length ?? 0}]
          {detail.status},,{detail.modality},{detail.study_date},{detail.study_desc}
        </span>
        {status && <span style={{ fontSize: 11.5, color: "var(--stat-emergency)" }}>{status}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setPrefs((p) => ({ ...p, reportDock: !p.reportDock }))}>판독창</button>
        <button onClick={() => setOverlayOn((o) => !o)}>{overlayOn ? "INFO ●" : "INFO ○"}</button>
        <button onClick={onClose}>닫기</button>
      </div>

      {paletteHoriz && palette}
      <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: thumbHoriz ? "column" : "row" }}>
        {!paletteHoriz && palette}
        {!paletteOpen && !paletteHoriz && (
          <button onClick={() => setPaletteOpen(true)} style={{ width: 18, borderRadius: 0, padding: 0 }}>▸</button>
        )}
        {!thumbHoriz && thumbs}

        {/* 뷰포트 그리드 */}
        <div style={{ flex: 1, display: "grid", minWidth: 0, minHeight: 0,
                      gridTemplateColumns: `repeat(${L.cols}, 1fr)`, gridTemplateRows: `repeat(${L.rows}, 1fr)`,
                      gap: 2, padding: 2 }}>
          {PANE_IDS.slice(0, L.count).map((pid) => {
            const p = panes[pid];
            const url = renderedUrl(p);
            const isPrior = p.studyUid !== detail.study_uid;
            return (
              <div key={pid}
                   onMouseDown={(e) => onPaneMouseDown(pid, e)}
                   onWheel={(e) => step(pid, e.deltaY > 0 ? 1 : -1)}
                   onDoubleClick={() => act("fit")}
                   style={{ position: "relative", overflow: "hidden", minHeight: 0, minWidth: 0,
                            background: "#000", cursor: "crosshair",
                            outline: activePane === pid ? "1px solid var(--accent)" : "1px solid var(--border)" }}>
                {url && (
                  <img src={url} alt="" draggable={false}
                       style={{
                         width: "100%", height: "100%", objectFit: "contain", userSelect: "none",
                         transform: `translate(${p.tx}px,${p.ty}px) scale(${p.zoom * (p.flipH ? -1 : 1)},${p.zoom * (p.flipV ? -1 : 1)}) rotate(${p.rot}deg)`,
                         filter: p.invert ? "invert(1)" : undefined,
                       }} />
                )}
                {overlayOn && p.series && (
                  <>
                    <div style={ov("tl")}>
                      {detail.patient_name} ({detail.sex})<br />
                      {isPrior ? "[비교/과거]" : detail.study_desc}<br />{detail.study_date}
                    </div>
                    <div style={ov("tr")}>
                      S{p.series.series_number} {p.series.series_desc || p.series.modality}<br />
                      Img: {p.index + 1}/{p.series.instances.length}
                    </div>
                    <div style={ov("bl")}>{detail.modality} · {detail.patient_key}</div>
                    <div style={ov("br")}>
                      Z: {(p.zoom * 100).toFixed(0)}%{p.wl && <><br />W/L: {p.wl}</>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {dock}
      </div>
      {thumbHoriz && thumbs}
    </div>
  );
}

function ov(pos: "tl" | "tr" | "bl" | "br"): React.CSSProperties {
  return {
    position: "absolute", zIndex: 1, fontSize: 10.5, lineHeight: 1.45, pointerEvents: "none",
    color: "var(--text-primary)", textShadow: "0 0 4px #000", padding: 5,
    ...(pos === "tl" ? { top: 0, left: 0 } : {}),
    ...(pos === "tr" ? { top: 0, right: 0, textAlign: "right" } : {}),
    ...(pos === "bl" ? { bottom: 0, left: 0 } : {}),
    ...(pos === "br" ? { bottom: 0, right: 0, textAlign: "right" } : {}),
  };
}
