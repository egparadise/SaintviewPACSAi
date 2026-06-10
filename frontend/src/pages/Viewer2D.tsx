// Saintview 2D 뷰어 — Zetta/INFINITT 분석 기반 자체 스택 뷰어
// 구조: [상단 검사탭바] [좌: 세로 툴 팔레트(Common/Annotation/2D/ETC)] [세로 썸네일(시리즈→개별)] [뷰포트 그리드]
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Enums,
  RenderingEngine,
  eventTarget,
  type Types,
} from "@cornerstonejs/core";
import {
  AngleTool,
  ArrowAnnotateTool,
  EllipticalROITool,
  Enums as ToolsEnums,
  LengthTool,
  MagnifyTool,
  PanTool,
  RectangleROITool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  annotation,
} from "@cornerstonejs/tools";
import { api, openViewer, type SeriesNode, type StudyDetail } from "../api";
import { ensureCornerstone, registerSeriesImageIds } from "../lib/cornerstone";

const ENGINE_ID = "sv2d-engine";
const TOOL_GROUP_ID = "sv2d-tools";
const PANE_IDS = ["p0", "p1", "p2", "p3"];
const LAYOUTS: Record<string, { cols: number; rows: number; count: number }> = {
  "1x1": { cols: 1, rows: 1, count: 1 },
  "1x2": { cols: 2, rows: 1, count: 2 },
  "2x2": { cols: 2, rows: 2, count: 4 },
};

/* 활성 도구(Primary 버튼) 후보 — Zetta Common/Annotation 의미 매핑 */
const PRIMARY_TOOLS = {
  wl: WindowLevelTool.toolName,
  zoom: ZoomTool.toolName,
  pan: PanTool.toolName,
  scroll: StackScrollTool.toolName,
  mag: MagnifyTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  rect: RectangleROITool.toolName,
  ellipse: EllipticalROITool.toolName,
  arrow: ArrowAnnotateTool.toolName,
} as const;
type PrimaryKey = keyof typeof PRIMARY_TOOLS;

/* 2D 섹션 — W/L 프리셋 (INFINITT lut/프리셋 의미) */
const WL_PRESETS: { key: string; label: string; c: number; w: number }[] = [
  { key: "lung", label: "폐", c: -600, w: 1500 },
  { key: "medi", label: "종격동", c: 40, w: 400 },
  { key: "bone", label: "뼈", c: 300, w: 1500 },
  { key: "brain", label: "뇌", c: 40, w: 80 },
  { key: "abd", label: "복부", c: 60, w: 400 },
];

interface PaneInfo {
  seriesUid: string | null;
  index: number;
  total: number;
  wc: number | null;
  ww: number | null;
  zoom: number | null;
  desc: string;
}

export function Viewer2D({ detail, onClose }: { detail: StudyDetail; onClose: () => void }) {
  const elRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const engineRef = useRef<RenderingEngine | null>(null);
  const imageIdsCache = useRef<Map<string, string[]>>(new Map());
  const cineTimer = useRef<number | null>(null);

  const [series, setSeries] = useState<SeriesNode[]>([]);
  const [selSeries, setSelSeries] = useState<string | null>(null); // 썸네일 확장 대상
  const [layout, setLayout] = useState<keyof typeof LAYOUTS>("1x1");
  const [activePane, setActivePane] = useState("p0");
  const [activeTool, setActiveTool] = useState<PrimaryKey>("wl");
  const [section, setSection] = useState<"common" | "anno" | "2d" | "etc">("common");
  const [thumbOpen, setThumbOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [cine, setCine] = useState(false);
  const [status, setStatus] = useState("");
  const [panes, setPanes] = useState<Record<string, PaneInfo>>(
    Object.fromEntries(PANE_IDS.map((p) => [p, { seriesUid: null, index: 0, total: 0, wc: null, ww: null, zoom: null, desc: "" }])),
  );
  const [overlayOn, setOverlayOn] = useState(true); // Alt+I (정보 계층)

  const patchPane = useCallback((pid: string, patch: Partial<PaneInfo>) => {
    setPanes((prev) => ({ ...prev, [pid]: { ...prev[pid], ...patch } }));
  }, []);

  /* ── 엔진/뷰포트 구성 (레이아웃 변경 시 재구성) ── */
  const setupViewports = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const count = LAYOUTS[layout].count;
    const ids = PANE_IDS.slice(0, count);
    engine.setViewports(
      ids.map((pid) => ({
        viewportId: pid,
        type: Enums.ViewportType.STACK,
        element: elRefs.current[pid]!,
        defaultOptions: { background: [0.043, 0.047, 0.055] as Types.Point3 },
      })),
    );
    const old = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    if (old) ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
    const group = ToolGroupManager.createToolGroup(TOOL_GROUP_ID)!;
    Object.values(PRIMARY_TOOLS).forEach((t) => group.addTool(t));
    // 고정 바인딩(디자인 §4.2): 우=Zoom, 중=Pan, 휠=스크롤 / 좌=활성도구
    group.setToolActive(PRIMARY_TOOLS[activeTool], { bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }] });
    group.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: ToolsEnums.MouseBindings.Secondary }] });
    group.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: ToolsEnums.MouseBindings.Auxiliary }] });
    group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }] });
    ids.forEach((pid) => group.addViewport(pid, ENGINE_ID));
    engine.resize(true, true);
    engine.render();
  }, [layout, activeTool]);

  /* ── 시리즈를 페인에 로드 ── */
  const loadSeriesToPane = useCallback(async (seriesUid: string, pid: string, jumpIndex = 0) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      setStatus("시리즈 로딩…");
      let imageIds = imageIdsCache.current.get(seriesUid);
      if (!imageIds) {
        imageIds = await registerSeriesImageIds(detail.study_uid, seriesUid);
        imageIdsCache.current.set(seriesUid, imageIds);
      }
      const vp = engine.getViewport(pid) as Types.IStackViewport;
      await vp.setStack(imageIds, Math.min(jumpIndex, imageIds.length - 1));
      vp.render();
      const s = series.find((x) => x.series_uid === seriesUid);
      patchPane(pid, {
        seriesUid, total: imageIds.length, index: jumpIndex,
        desc: s ? `S${s.series_number} ${s.series_desc || s.modality}` : "",
      });
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "로드 실패");
    }
  }, [detail.study_uid, series, patchPane]);

  /* ── 초기화 ── */
  useEffect(() => {
    let disposed = false;
    (async () => {
      await ensureCornerstone();
      if (disposed) return;
      const engine = new RenderingEngine(ENGINE_ID);
      engineRef.current = engine;
      // 디버그 노출 (개발 전용)
      (window as unknown as Record<string, unknown>).__sv2d = engine;
      const tree = await api.seriesTree(detail.id);
      if (disposed) return;
      const imgSeries = tree.series.filter((s) => !["SR", "KO", "PR", "SEG"].includes(s.modality));
      setSeries(imgSeries);
      if (imgSeries[0]) setSelSeries(imgSeries[0].series_uid);
    })();
    return () => {
      disposed = true;
      if (cineTimer.current) window.clearInterval(cineTimer.current);
      try {
        ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
        engineRef.current?.destroy();
      } catch { /* 정리 오류 무시 */ }
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  /* 레이아웃/도구 변경 시 뷰포트 재구성 + 첫 시리즈 자동 로드 */
  useEffect(() => {
    if (!engineRef.current || series.length === 0) return;
    setupViewports();
    const count = LAYOUTS[layout].count;
    PANE_IDS.slice(0, count).forEach((pid, i) => {
      const prev = panes[pid];
      const target = prev.seriesUid ?? series[Math.min(i, series.length - 1)]?.series_uid;
      if (target) void loadSeriesToPane(target, pid, prev.index);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, layout, setupViewports]);

  /* 오버레이 갱신: 이미지 인덱스/W/L/줌 이벤트 */
  useEffect(() => {
    const onNewImage = (evt: Event) => {
      const d = (evt as CustomEvent).detail as { viewportId?: string; imageIdIndex?: number };
      if (d?.viewportId && typeof d.imageIdIndex === "number") {
        patchPane(d.viewportId, { index: d.imageIdIndex });
      }
    };
    const onVoi = (evt: Event) => {
      const d = (evt as CustomEvent).detail as { viewportId?: string; range?: { lower: number; upper: number } };
      if (d?.viewportId && d.range) {
        const w = d.range.upper - d.range.lower;
        patchPane(d.viewportId, { wc: Math.round(d.range.lower + w / 2), ww: Math.round(w) });
      }
    };
    const onCam = (evt: Event) => {
      const d = (evt as CustomEvent).detail as { viewportId?: string };
      if (!d?.viewportId || !engineRef.current) return;
      try {
        const vp = engineRef.current.getViewport(d.viewportId) as Types.IStackViewport;
        patchPane(d.viewportId, { zoom: Math.round(vp.getZoom() * 100) });
      } catch { /* viewport 미존재 */ }
    };
    const onLoadFail = (evt: Event) => {
      console.error("[Viewer2D] IMAGE_LOAD_FAILED", (evt as CustomEvent).detail);
      setStatus("이미지 로드 실패 — 콘솔 확인");
    };
    eventTarget.addEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
    eventTarget.addEventListener(Enums.Events.VOI_MODIFIED, onVoi);
    eventTarget.addEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, onLoadFail);
    return () => {
      eventTarget.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
      eventTarget.removeEventListener(Enums.Events.VOI_MODIFIED, onVoi);
      eventTarget.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_FAILED, onLoadFail);
    };
  }, [patchPane]);

  /* ── 도구/액션 ── */
  const vp = useCallback((): Types.IStackViewport | null => {
    try { return (engineRef.current?.getViewport(activePane) as Types.IStackViewport) ?? null; }
    catch { return null; }
  }, [activePane]);

  const setPrimaryTool = (key: PrimaryKey) => {
    setActiveTool(key);
    const group = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    if (!group) return;
    group.setToolPassive(PRIMARY_TOOLS[activeTool]);
    group.setToolActive(PRIMARY_TOOLS[key], { bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }] });
  };

  const act = (a: string) => {
    const v = vp();
    if (!v) return;
    const cam = v.getCamera();
    switch (a) {
      case "invert": {
        const p = v.getProperties();
        v.setProperties({ invert: !p.invert });
        break;
      }
      case "rotL": {
        const r = v.getViewPresentation().rotation ?? 0;
        v.setViewPresentation({ rotation: (r - 90 + 360) % 360 });
        break;
      }
      case "rotR": {
        const r = v.getViewPresentation().rotation ?? 0;
        v.setViewPresentation({ rotation: (r + 90) % 360 });
        break;
      }
      case "flipH": v.setCamera({ flipHorizontal: !cam.flipHorizontal }); break;
      case "flipV": v.setCamera({ flipVertical: !cam.flipVertical }); break;
      case "fit": v.resetCamera(); break;
      case "reset": v.resetCamera(); v.resetProperties(); break;
      case "clearAnno":
        annotation.state.removeAllAnnotations();
        engineRef.current?.render();
        return;
      case "capture": {
        const canvas = v.getCanvas();
        const a2 = document.createElement("a");
        a2.href = canvas.toDataURL("image/png");
        a2.download = `saintview_${detail.patient_key}_${Date.now()}.png`;
        a2.click();
        return;
      }
      case "cine": {
        if (cineTimer.current) { window.clearInterval(cineTimer.current); cineTimer.current = null; setCine(false); return; }
        setCine(true);
        cineTimer.current = window.setInterval(() => {
          const cv = vp();
          if (!cv) return;
          const n = cv.getImageIds().length;
          cv.setImageIdIndex((cv.getCurrentImageIdIndex() + 1) % n);
        }, 120);
        return;
      }
    }
    v.render();
  };

  const applyPreset = (c: number, w: number) => {
    const v = vp();
    if (!v) return;
    v.setProperties({ voiRange: { lower: c - w / 2, upper: c + w / 2 } });
    v.render();
  };

  const stepSeries = (dir: 1 | -1) => {
    const cur = panes[activePane].seriesUid;
    const i = series.findIndex((s) => s.series_uid === cur);
    const next = series[(i + dir + series.length) % series.length];
    if (next) void loadSeriesToPane(next.series_uid, activePane);
  };

  /* ── 렌더 ── */
  const L = LAYOUTS[layout];

  const ToolBtn = ({ k, label, title }: { k: PrimaryKey; label: string; title: string }) => (
    <button onClick={() => setPrimaryTool(k)} title={title}
            style={{
              padding: "5px 0", fontSize: 10.5, width: "100%",
              background: activeTool === k ? "var(--accent)" : undefined,
              borderColor: activeTool === k ? "var(--accent)" : undefined,
            }}>
      {label}
    </button>
  );
  const ActBtn = ({ a, label, title, on }: { a: string; label: string; title: string; on?: boolean }) => (
    <button onClick={() => act(a)} title={title}
            style={{ padding: "5px 0", fontSize: 10.5, width: "100%",
                     background: on ? "var(--accent)" : undefined }}>
      {label}
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200, display: "flex", flexDirection: "column" }}>
      {/* 상단: WORKLIST 복귀 + 검사 탭 (Zetta 패턴) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
        <button onClick={onClose} style={{ fontWeight: 700 }}>WORKLIST</button>
        <div style={{
          background: "var(--accent)", borderRadius: "4px 4px 0 0", padding: "4px 14px",
          fontSize: 12, fontWeight: 600, alignSelf: "flex-end",
        }}>
          {detail.modality},{detail.body_part || detail.patient_name},{detail.study_date} ✕
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
          {detail.status},{detail.patient_name},,{detail.modality},{detail.study_date}
        </span>
        {status && <span style={{ fontSize: 11.5, color: "var(--stat-draft)" }}>{status}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => openViewer(detail.study_uid)} title="OHIF 풀 뷰어(보조)">OHIF</button>
        <button onClick={() => setOverlayOn((o) => !o)} title="오버레이 정보 토글 (Alt+I)">
          {overlayOn ? "INFO ●" : "INFO ○"}
        </button>
        <button onClick={onClose}>닫기</button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 좌: 세로 툴 팔레트 (Zetta Common/Annotation/2D/ETC) */}
        {paletteOpen && (
          <div style={{
            width: 96, background: "var(--bg-panel)", borderRight: "1px solid var(--border)",
            display: "flex", flexDirection: "column", padding: 4, gap: 3, flexShrink: 0, overflow: "auto",
          }}>
            <select value={layout} onChange={(e) => setLayout(e.target.value as keyof typeof LAYOUTS)}
                    style={{ width: "100%", fontSize: 11 }}>
              <option value="1x1">1 X 1</option>
              <option value="1x2">1 X 2</option>
              <option value="2x2">2 X 2</option>
            </select>
            <div style={{ display: "flex", gap: 3 }}>
              <button style={{ flex: 1, padding: "3px 0" }} title="이전 시리즈" onClick={() => stepSeries(-1)}>◀</button>
              <button style={{ flex: 1, padding: "3px 0" }} title="다음 시리즈" onClick={() => stepSeries(1)}>▶</button>
            </div>
            <button style={{ padding: "3px 0", fontSize: 10.5 }} onClick={() => setPaletteOpen(false)}>Hide</button>
            <button style={{ padding: "3px 0", fontSize: 10.5, background: thumbOpen ? "var(--accent-subtle)" : undefined }}
                    onClick={() => setThumbOpen((t) => !t)}>Thumbnail</button>

            {/* 섹션 헤더 */}
            {([["common", "Common"], ["anno", "Annotation"], ["2d", "2D"], ["etc", "ETC"]] as const).map(([k, label]) => (
              <div key={k}>
                <div onClick={() => setSection(k)}
                     style={{
                       padding: "4px 6px", fontSize: 10.5, fontWeight: 700, cursor: "pointer",
                       background: section === k ? "var(--bg-elevated)" : undefined,
                       color: "var(--text-secondary)", borderTop: "1px solid var(--border)",
                     }}>
                  {section === k ? "▾" : "▸"} {label}
                </div>
                {section === k && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, padding: "3px 0" }}>
                    {k === "common" && (
                      <>
                        <ToolBtn k="wl" label="W/L" title="Window/Level (좌드래그)" />
                        <ToolBtn k="zoom" label="Zoom" title="확대/축소" />
                        <ToolBtn k="pan" label="Pan" title="이동" />
                        <ToolBtn k="scroll" label="Scrl" title="스택 스크롤" />
                        <ToolBtn k="mag" label="Mag" title="돋보기" />
                        <ActBtn a="fit" label="Fit" title="화면 맞춤" />
                        <ActBtn a="invert" label="Inv" title="흑백 반전" />
                        <ActBtn a="reset" label="Reset" title="전체 초기화" />
                        <ActBtn a="rotL" label="⟲90" title="좌회전" />
                        <ActBtn a="rotR" label="⟳90" title="우회전" />
                        <ActBtn a="flipH" label="⇋" title="좌우 반전" />
                        <ActBtn a="flipV" label="⇵" title="상하 반전" />
                        <ActBtn a="cine" label={cine ? "■" : "▶Cine"} title="시네 재생" on={cine} />
                        <ActBtn a="capture" label="Cap" title="화면 캡처(PNG)" />
                      </>
                    )}
                    {k === "anno" && (
                      <>
                        <ToolBtn k="length" label="Len" title="길이 측정" />
                        <ToolBtn k="angle" label="Ang" title="각도 측정" />
                        <ToolBtn k="rect" label="R-ROI" title="사각 ROI" />
                        <ToolBtn k="ellipse" label="O-ROI" title="타원 ROI" />
                        <ToolBtn k="arrow" label="Arrow" title="화살표 주석" />
                        <ActBtn a="clearAnno" label="Clear" title="주석 전체 삭제" />
                      </>
                    )}
                    {k === "2d" && WL_PRESETS.map((p) => (
                      <button key={p.key} onClick={() => applyPreset(p.c, p.w)}
                              title={`W/L 프리셋 C${p.c}/W${p.w}`}
                              style={{ padding: "5px 0", fontSize: 10.5 }}>
                        {p.label}
                      </button>
                    ))}
                    {k === "etc" && (
                      <>
                        <button style={{ padding: "5px 0", fontSize: 10.5, gridColumn: "1/3" }}
                                onClick={() => openViewer(detail.study_uid)}>OHIF 뷰어</button>
                        <button style={{ padding: "5px 0", fontSize: 10.5, gridColumn: "1/3" }}
                                onClick={() => window.dispatchEvent(new CustomEvent("sv-open-3d", { detail: detail.study_uid }))}>
                          3D (MPR/MIP)
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div style={{ flex: 1 }} />
          </div>
        )}
        {!paletteOpen && (
          <button onClick={() => setPaletteOpen(true)}
                  style={{ width: 18, borderRadius: 0, padding: 0, flexShrink: 0 }}>▸</button>
        )}

        {/* 세로 썸네일: 시리즈 카드 → 선택 시 개별 이미지 (INFINITT 의미) */}
        {thumbOpen && (
          <div style={{
            width: 118, background: "var(--bg-panel)", borderRight: "1px solid var(--border)",
            overflow: "auto", padding: 4, display: "flex", flexDirection: "column", gap: 4, flexShrink: 0,
          }}>
            {series.map((s) => (
              <div key={s.series_uid}>
                <div
                  onClick={() => setSelSeries(s.series_uid)}
                  onDoubleClick={() => void loadSeriesToPane(s.series_uid, activePane)}
                  title={`${s.series_desc || s.modality} — 더블클릭: 활성 페인에 로드`}
                  style={{
                    border: selSeries === s.series_uid ? "2px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: 4, overflow: "hidden", cursor: "pointer", position: "relative",
                  }}>
                  {s.instances[Math.floor(s.instances.length / 2)] && (
                    <img src={s.instances[Math.floor(s.instances.length / 2)].preview_url}
                         alt="" style={{ width: "100%", height: 76, objectFit: "cover", display: "block" }} />
                  )}
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0, fontSize: 9.5,
                    background: "rgba(0,0,0,0.65)", padding: "1px 4px", color: "var(--text-primary)",
                  }}>
                    S{s.series_number} · {s.instances.length}장 {s.modality}
                  </div>
                </div>
                {/* 개별 이미지 썸네일 (선택 시리즈만 — 세로 전개) */}
                {selSeries === s.series_uid && s.instances.length > 1 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, padding: "3px 0 0 6px" }}>
                    {s.instances.slice(0, 40).map((inst, idx) => (
                      <img key={inst.sop_uid} src={inst.preview_url} alt={`#${inst.instance_number}`}
                           title={`Image ${inst.instance_number}`}
                           onClick={() => void loadSeriesToPane(s.series_uid, activePane, idx)}
                           style={{
                             width: "100%", height: 42, objectFit: "cover", borderRadius: 2, cursor: "pointer",
                             border: panes[activePane].seriesUid === s.series_uid && panes[activePane].index === idx
                               ? "2px solid var(--anno-keyimage)" : "1px solid var(--border)",
                           }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {series.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--text-secondary)", padding: 6 }}>시리즈 없음</div>
            )}
          </div>
        )}

        {/* 뷰포트 그리드 */}
        <div style={{
          flex: 1, display: "grid", minWidth: 0,
          gridTemplateColumns: `repeat(${L.cols}, 1fr)`, gridTemplateRows: `repeat(${L.rows}, 1fr)`,
          gap: 2, padding: 2,
        }}>
          {PANE_IDS.slice(0, L.count).map((pid) => {
            const info = panes[pid];
            return (
              <div key={pid} onMouseDown={() => setActivePane(pid)}
                   style={{
                     position: "relative", minHeight: 0, minWidth: 0,
                     outline: activePane === pid ? "1px solid var(--accent)" : "1px solid var(--border)",
                   }}>
                {overlayOn && (
                  <>
                    <div style={ovStyle("tl")}>
                      {detail.patient_name} ({detail.sex})<br />
                      {detail.study_desc}<br />{detail.study_date}
                    </div>
                    <div style={ovStyle("tr")}>
                      {info.desc}<br />
                      Img: {info.total ? info.index + 1 : 0}/{info.total}
                    </div>
                    <div style={ovStyle("bl")}>{detail.modality} · {detail.patient_key}</div>
                    <div style={ovStyle("br")}>
                      {info.zoom !== null && <>Z: {info.zoom}%<br /></>}
                      {info.wc !== null && <>WC: {info.wc} WW: {info.ww}</>}
                    </div>
                  </>
                )}
                <div ref={(el) => { elRefs.current[pid] = el; }}
                     style={{ width: "100%", height: "100%" }}
                     onContextMenu={(e) => e.preventDefault()} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ovStyle(pos: "tl" | "tr" | "bl" | "br"): React.CSSProperties {
  return {
    position: "absolute", zIndex: 1, fontSize: 10.5, lineHeight: 1.45, pointerEvents: "none",
    color: "var(--text-primary)", textShadow: "0 0 4px #000", padding: 5,
    ...(pos === "tl" ? { top: 0, left: 0 } : {}),
    ...(pos === "tr" ? { top: 0, right: 0, textAlign: "right" } : {}),
    ...(pos === "bl" ? { bottom: 0, left: 0 } : {}),
    ...(pos === "br" ? { bottom: 0, right: 0, textAlign: "right" } : {}),
  };
}
