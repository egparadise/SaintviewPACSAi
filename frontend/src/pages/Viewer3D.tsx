// Saintview 3D 뷰어 — Cornerstone3D(WebGL) 기반 MPR 3면 + MIP 볼륨 렌더링
// 디자인 명세 §4 [VP] 오버레이·활성 테두리 규칙 준수. OHIF 보완용 내장 뷰어.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Enums,
  RenderingEngine,
  init as csInit,
  setVolumesForViewports,
  volumeLoader,
  type Types,
} from "@cornerstonejs/core";
import {
  Enums as ToolsEnums,
  PanTool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  addTool,
  init as toolsInit,
} from "@cornerstonejs/tools";
import { init as dicomImageLoaderInit, wadors } from "@cornerstonejs/dicom-image-loader";

const DICOMWEB_ROOT = import.meta.env.VITE_DICOMWEB_ROOT ?? "http://localhost:3000/dicom-web";

const RENDERING_ENGINE_ID = "sv-engine";
const TOOL_GROUP_ID = "sv-tools";
const VOLUME_ID = "cornerstoneStreamingImageVolume:sv-vol";

const VIEWPORTS = [
  { id: "vp-axial", label: "Axial (MPR)", orientation: Enums.OrientationAxis.AXIAL, mip: false },
  { id: "vp-sagittal", label: "Sagittal (MPR)", orientation: Enums.OrientationAxis.SAGITTAL, mip: false },
  { id: "vp-coronal", label: "Coronal (MPR)", orientation: Enums.OrientationAxis.CORONAL, mip: false },
  { id: "vp-mip", label: "MIP", orientation: Enums.OrientationAxis.AXIAL, mip: true },
] as const;

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  await csInit();
  dicomImageLoaderInit();
  toolsInit();
  addTool(WindowLevelTool);
  addTool(PanTool);
  addTool(ZoomTool);
  addTool(StackScrollTool);
  initialized = true;
}

/** DICOMweb에서 영상 시리즈를 골라 wadors imageId 목록 구성 + 메타데이터 등록 */
async function buildImageIds(studyUid: string): Promise<string[]> {
  const seriesRes = await fetch(`${DICOMWEB_ROOT}/studies/${studyUid}/series`);
  if (!seriesRes.ok) throw new Error("시리즈 조회 실패");
  const seriesList: Record<string, { Value?: unknown[] }>[] = await seriesRes.json();

  // SR/KO/PR 등 비영상 시리즈 제외, 인스턴스 수 최대 시리즈 선택
  const candidates = seriesList
    .map((s) => ({
      uid: String(s["0020000E"]?.Value?.[0] ?? ""),
      modality: String(s["00080060"]?.Value?.[0] ?? ""),
      count: Number(s["00201209"]?.Value?.[0] ?? 0),
    }))
    .filter((s) => s.uid && !["SR", "KO", "PR", "SEG"].includes(s.modality));
  if (candidates.length === 0) throw new Error("영상 시리즈가 없습니다");
  candidates.sort((a, b) => b.count - a.count);
  const series = candidates[0];

  const metaRes = await fetch(
    `${DICOMWEB_ROOT}/studies/${studyUid}/series/${series.uid}/metadata`,
  );
  if (!metaRes.ok) throw new Error("시리즈 메타데이터 조회 실패");
  const instances: Record<string, { Value?: unknown[] }>[] = await metaRes.json();

  const withIds = instances
    .map((meta) => {
      const sop = String(meta["00080018"]?.Value?.[0] ?? "");
      const num = Number(meta["00200013"]?.Value?.[0] ?? 0);
      const imageId =
        `wadors:${DICOMWEB_ROOT}/studies/${studyUid}/series/${series.uid}` +
        `/instances/${sop}/frames/1`;
      return { imageId, num, meta };
    })
    .filter((x) => x.imageId.includes("instances/") && !x.imageId.endsWith("instances//frames/1"))
    .sort((a, b) => a.num - b.num);

  for (const { imageId, meta } of withIds) {
    wadors.metaDataManager.add(imageId, meta as never);
  }
  return withIds.map((x) => x.imageId);
}

export function Viewer3D({ studyUid, onClose, embedded }: {
  studyUid: string;
  onClose: () => void;
  embedded?: boolean;  // Viewer2D 내장 MPR/MIP — 새 창 없이 현재 뷰포트 영역에 표시
}) {
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const gridRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const [status, setStatus] = useState("초기화 중…");
  const [error, setError] = useState("");
  const [slabMm, setSlabMm] = useState(30);
  const [activeVp, setActiveVp] = useState("vp-axial");
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const applySlab = useCallback((mm: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const vp = engine.getViewport("vp-mip") as Types.IVolumeViewport | undefined;
    if (!vp) return;
    vp.setBlendMode(Enums.BlendModes.MAXIMUM_INTENSITY_BLEND);
    vp.setProperties({ slabThickness: mm });
    vp.render();
  }, []);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        await ensureInit();
        setStatus("시리즈 메타데이터 로딩…");
        const imageIds = await buildImageIds(studyUid);
        if (disposed) return;
        if (imageIds.length < 2) {
          throw new Error(`볼륨 구성에 슬라이스가 부족합니다 (${imageIds.length}장)`);
        }
        setStatus(`볼륨 로딩… (${imageIds.length} 슬라이스)`);

        const engine = new RenderingEngine(RENDERING_ENGINE_ID);
        engineRef.current = engine;
        engine.setViewports(
          VIEWPORTS.map((v) => ({
            viewportId: v.id,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: containerRefs.current[v.id]!,
            defaultOptions: { orientation: v.orientation, background: [0.04, 0.04, 0.055] },
          })),
        );

        // 도구: 좌=W/L, 우=Zoom, 중=Pan, 휠=스크롤 (디자인 §4.2 마우스 바인딩)
        const old = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
        if (old) ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
        const group = ToolGroupManager.createToolGroup(TOOL_GROUP_ID)!;
        group.addTool(WindowLevelTool.toolName);
        group.addTool(ZoomTool.toolName);
        group.addTool(PanTool.toolName);
        group.addTool(StackScrollTool.toolName);
        group.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
        });
        group.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Secondary }],
        });
        group.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Auxiliary }],
        });
        group.setToolActive(StackScrollTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }],
        });
        for (const v of VIEWPORTS) group.addViewport(v.id, RENDERING_ENGINE_ID);

        const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, { imageIds });
        await (volume as { load: () => Promise<unknown> | unknown }).load?.();
        await setVolumesForViewports(
          engine,
          [{ volumeId: VOLUME_ID }],
          VIEWPORTS.map((v) => v.id),
        );
        applySlab(slabMm);
        engine.render();
        // 레이아웃 확정 후 캔버스 크기 동기화 + 컨테이너 리사이즈 추적
        requestAnimationFrame(() => {
          engine.resize(true, true);
          engine.render();
        });
        if (gridRef.current) {
          const ro = new ResizeObserver(() => {
            engineRef.current?.resize(true, true);
            engineRef.current?.render();
          });
          ro.observe(gridRef.current);
          resizeObserverRef.current = ro;
        }
        if (!disposed) setStatus("");
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("");
        }
      }
    })();

    return () => {
      disposed = true;
      try {
        resizeObserverRef.current?.disconnect();
        ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
        engineRef.current?.destroy();
      } catch {
        /* 정리 중 오류 무시 */
      }
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyUid]);

  return (
    <div style={{
      ...(embedded
        ? { position: "relative" as const, width: "100%", height: "100%", minHeight: 0 }
        : { position: "fixed" as const, inset: 0, zIndex: 200 }),
      background: "var(--bg-canvas)",
      display: "flex", flexDirection: "column",
    }}>
      {/* 헤더 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "6px 12px",
        background: "var(--bg-panel)", borderBottom: "1px solid var(--border)",
      }}>
        <img src="/saintview-viewer.svg" alt="" width={20} height={20} />
        <b>Saintview 3D</b>
        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          MPR + MIP · WebGL (Cornerstone3D)
        </span>
        {status && <span style={{ color: "var(--stat-draft)", fontSize: 12 }}>{status}</span>}
        {error && <span style={{ color: "var(--stat-emergency)", fontSize: 12 }}>⚠ {error}</span>}
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          MIP slab {slabMm}mm
          <input
            type="range" min={5} max={120} step={5} value={slabMm}
            onChange={(e) => { const v = Number(e.target.value); setSlabMm(v); applySlab(v); }}
          />
        </label>
        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          좌드래그 W/L · 우드래그 Zoom · 휠 스크롤 · 중클릭 Pan
        </span>
        <button onClick={onClose}>닫기</button>
      </div>

      {/* 2×2 뷰포트 그리드 */}
      <div ref={gridRef} style={{
        flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr",
        gap: 2, padding: 2, minHeight: 0,
      }}>
        {VIEWPORTS.map((v) => (
          <div
            key={v.id}
            onMouseDown={() => setActiveVp(v.id)}
            style={{
              position: "relative", minHeight: 0,
              outline: activeVp === v.id ? "1px solid var(--accent)" : "1px solid var(--border)",
            }}
          >
            <div style={{
              position: "absolute", top: 4, left: 6, zIndex: 1, fontSize: 11,
              color: v.mip ? "var(--ai)" : "var(--text-secondary)", pointerEvents: "none",
              textShadow: "0 0 4px #000",
            }}>
              {v.label}
            </div>
            <div
              ref={(el) => { containerRefs.current[v.id] = el; }}
              style={{ width: "100%", height: "100%" }}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
