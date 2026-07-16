// Saintview 3D 뷰어 — Cornerstone3D(WebGL) 기반 MPR 3면 + MIP 볼륨 렌더링 (강화판)
// - 시리즈 선택: 볼륨 적합 시리즈 목록에서 선택(자동 선택 실패 대비 — 예: MR 보정 시리즈 회피)
// - Crosshairs: 세 MPR 십자선 연동 — 한 평면의 라인을 끌면 다른 평면들의 중심이 그 위치로 이동
// - MIP: 방향(AX/SAG/COR) 전환 + slab 두께 조절
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
  CrosshairsTool,
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
const TG_MPR = "sv-tools-mpr";
const TG_MIP = "sv-tools-mip";

const MPR_VIEWPORTS = [
  { id: "vp-axial", label: "Axial (MPR)", orientation: Enums.OrientationAxis.AXIAL },
  { id: "vp-sagittal", label: "Sagittal (MPR)", orientation: Enums.OrientationAxis.SAGITTAL },
  { id: "vp-coronal", label: "Coronal (MPR)", orientation: Enums.OrientationAxis.CORONAL },
] as const;
const MIP_ID = "vp-mip";

// Crosshairs 참조선 색 — 평면별 구분(축=노랑, 새지털=시안, 코로날=초록)
const REF_COLORS: Record<string, string> = {
  "vp-axial": "#eab308", "vp-sagittal": "#38bdf8", "vp-coronal": "#4ade80",
};

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  // useNorm16Texture: CT/MR 16비트 픽셀을 저정밀 텍스처로 양자화하지 않도록 — 계조 뭉개짐(banding) 방지
  // 설치된 @cornerstonejs 타입 정의엔 없으나 런타임 옵션은 유효 — 인자 캐스팅으로 타입만 통과
  await csInit({ rendering: { useNorm16Texture: true } } as unknown as Parameters<typeof csInit>[0]);
  dicomImageLoaderInit();
  toolsInit();
  addTool(WindowLevelTool);
  addTool(PanTool);
  addTool(ZoomTool);
  addTool(StackScrollTool);
  addTool(CrosshairsTool);
  initialized = true;
}

interface SeriesCand { uid: string; modality: string; count: number; desc: string }

/* 비진단 시리즈(보정/로컬라이저/스카우트/선량보고 등) — 슬라이스가 많아도 3D 볼륨 기본 선택에서 후순위 */
const NON_DIAG_RE = /cal|calib|localizer|3.?plane|scout|screen ?save|dose|report|survey/i;

/** 볼륨 적합 시리즈 후보 목록 (비영상 제외) — 진단 시리즈 우선, 그다음 매트릭스×슬라이스 크기순.
    기존엔 슬라이스 수만으로 정렬해 128×128 보정(Cal) 시리즈가 기본 선택돼 3D 가 뿌옇게 보였다. */
async function listSeries(studyUid: string): Promise<SeriesCand[]> {
  const res = await fetch(`${DICOMWEB_ROOT}/studies/${studyUid}/series`);
  if (!res.ok) throw new Error("시리즈 조회 실패");
  const seriesList: Record<string, { Value?: unknown[] }>[] = await res.json();
  const cands = seriesList
    .map((s) => ({
      uid: String(s["0020000E"]?.Value?.[0] ?? ""),
      modality: String(s["00080060"]?.Value?.[0] ?? ""),
      count: Number(s["00201209"]?.Value?.[0] ?? 0),
      desc: String((s["0008103E"]?.Value?.[0] as string) ?? ""),
    }))
    .filter((s) => s.uid && !["SR", "KO", "PR", "SEG"].includes(s.modality));
  // 각 후보의 매트릭스(Rows×Cols)를 QIDO 인스턴스 1건으로 조회 — 해상도 가중치(실패 시 0=순서 영향 없음)
  const area = await Promise.all(cands.map(async (s) => {
    try {
      const r = await fetch(
        `${DICOMWEB_ROOT}/studies/${studyUid}/series/${s.uid}/instances?limit=1&includefield=00280010&includefield=00280011`);
      if (!r.ok) return 0;
      const [inst] = await r.json() as Record<string, { Value?: unknown[] }>[];
      return Number(inst?.["00280010"]?.Value?.[0] ?? 0) * Number(inst?.["00280011"]?.Value?.[0] ?? 0);
    } catch { return 0; }
  }));
  return cands
    .map((s, i) => ({ ...s, _score: (NON_DIAG_RE.test(s.desc) ? 0 : 1e12) + (area[i] || 1) * Math.max(1, s.count) }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...s }) => s);
}

/** 지정 시리즈의 wadors imageId 목록 구성 + 메타데이터 등록 */
async function buildImageIds(studyUid: string, seriesUid: string): Promise<string[]> {
  const metaRes = await fetch(
    `${DICOMWEB_ROOT}/studies/${studyUid}/series/${seriesUid}/metadata`,
  );
  if (!metaRes.ok) throw new Error("시리즈 메타데이터 조회 실패");
  const instances: Record<string, { Value?: unknown[] }>[] = await metaRes.json();

  const withIds = instances
    .map((meta) => {
      const sop = String(meta["00080018"]?.Value?.[0] ?? "");
      const num = Number(meta["00200013"]?.Value?.[0] ?? 0);
      const imageId =
        `wadors:${DICOMWEB_ROOT}/studies/${studyUid}/series/${seriesUid}` +
        `/instances/${sop}/frames/1`;
      return { imageId, num, sop, meta };
    })
    .filter((x) => x.sop)
    .sort((a, b) => a.num - b.num);

  for (const { imageId, meta } of withIds) {
    wadors.metaDataManager.add(imageId, meta as never);
  }
  return withIds.map((x) => x.imageId);
}

export function Viewer3D({ studyUid, onClose, embedded, seriesUid }: {
  studyUid: string;
  onClose: () => void;
  embedded?: boolean;  // Viewer2D 내장 MPR/MIP — 새 창 없이 현재 뷰포트 영역에 표시
  seriesUid?: string;  // 외부(좌측 썸네일 클릭)에서 지정한 볼륨 시리즈 — 변경 시 볼륨 재구성
}) {
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const gridRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const [status, setStatus] = useState("초기화 중…");
  const [error, setError] = useState("");
  const [slabMm, setSlabMm] = useState(10);
  const [blend, setBlend] = useState<"mip" | "minip" | "avip" | "off">("mip");   // 강도 투영 모드
  const [mipSetOpen, setMipSetOpen] = useState(false);                            // MIP Settings 패널
  const [vrOn, setVrOn] = useState(false);                                        // 3D 볼륨 렌더링 페인(슬랩 조정 시 자동)
  const volumeIdRef = useRef("");
  const [activeVp, setActiveVp] = useState("vp-axial");
  const [seriesList, setSeriesList] = useState<SeriesCand[]>([]);
  const [selSeries, setSelSeries] = useState("");
  const [toolMode, setToolMode] = useState<"crosshair" | "wl">("crosshair");
  const [mipOrient, setMipOrient] = useState<"AXIAL" | "SAGITTAL" | "CORONAL">("AXIAL");
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const applySlab = useCallback((mm: number, mode?: "mip" | "minip" | "avip" | "off") => {
    const engine = engineRef.current;
    if (!engine) return;
    const vp = engine.getViewport(MIP_ID) as Types.IVolumeViewport | undefined;
    if (!vp) return;
    const m = mode ?? "mip";
    try {
      // 강도 투영 모드 — MIP(최대)/MinIP(최소)/AvIP(평균)/끄기(일반 컴포지트 렌더링)
      const BM = Enums.BlendModes;
      vp.setBlendMode(m === "mip" ? BM.MAXIMUM_INTENSITY_BLEND
                    : m === "minip" ? BM.MINIMUM_INTENSITY_BLEND
                    : m === "avip" ? BM.AVERAGE_INTENSITY_BLEND
                    : BM.COMPOSITE);
      vp.setProperties({ slabThickness: m === "off" ? 0.1 : mm });
      vp.render();
    } catch { /* 뷰포트 미준비 */ }
  }, []);

  // 도구 모드 전환 — Crosshair(십자선 연동) ↔ W/L (MPR 3면 좌클릭)
  const applyToolMode = useCallback((mode: "crosshair" | "wl") => {
    const g = ToolGroupManager.getToolGroup(TG_MPR);
    if (!g) return;
    try {
      if (mode === "crosshair") {
        g.setToolPassive(WindowLevelTool.toolName);
        g.setToolActive(CrosshairsTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
        });
      } else {
        g.setToolDisabled(CrosshairsTool.toolName);
        g.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
        });
      }
      engineRef.current?.render();
    } catch { /* 그룹 미준비 */ }
  }, []);

  // MIP 방향 전환
  const applyMipOrient = useCallback((o: "AXIAL" | "SAGITTAL" | "CORONAL") => {
    const vp = engineRef.current?.getViewport(MIP_ID) as Types.IVolumeViewport | undefined;
    if (!vp) return;
    try {
      vp.setOrientation(Enums.OrientationAxis[o]);
      vp.render();
    } catch { /* 미지원 시 무시 */ }
  }, []);

  // 좌측 썸네일 클릭 → 볼륨 시리즈 전환(목록에 있는 시리즈만) — 3D 를 원하는 시리즈로 재구성
  useEffect(() => {
    if (!seriesUid) return;
    setSelSeries((cur) => (seriesUid !== cur && seriesList.some((x) => x.uid === seriesUid) ? seriesUid : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesUid, seriesList]);

  // 시리즈 목록 로드 → 기본(최다 슬라이스, 10장 이상 우선) 선택
  useEffect(() => {
    setError("");
    setSeriesList([]);
    setSelSeries("");
    listSeries(studyUid).then((list) => {
      setSeriesList(list);
      const good = list.find((s) => s.count >= 10) ?? list[0];
      if (!good) { setError("영상 시리즈가 없습니다"); setStatus(""); return; }
      setSelSeries(good.uid);
    }).catch((e) => { setError(e instanceof Error ? e.message : String(e)); setStatus(""); });
  }, [studyUid]);

  // 볼륨 구성 (시리즈 변경 시 재구성)
  useEffect(() => {
    if (!selSeries) return;
    let disposed = false;

    (async () => {
      try {
        setError("");
        await ensureInit();
        setStatus("시리즈 메타데이터 로딩…");
        const imageIds = await buildImageIds(studyUid, selSeries);
        if (disposed) return;
        if (imageIds.length < 3) {
          throw new Error(`볼륨 구성에 슬라이스가 부족합니다 (${imageIds.length}장) — 다른 시리즈를 선택하세요`);
        }
        setStatus(`볼륨 로딩… (${imageIds.length} 슬라이스)`);

        const engine = new RenderingEngine(RENDERING_ENGINE_ID);
        engineRef.current = engine;
        engine.setViewports(
          [...MPR_VIEWPORTS.map((v) => ({
            viewportId: v.id,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: containerRefs.current[v.id]!,
            defaultOptions: { orientation: v.orientation, background: [0.04, 0.04, 0.055] as Types.Point3 },
          })),
          {
            viewportId: MIP_ID,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: containerRefs.current[MIP_ID]!,
            defaultOptions: { orientation: Enums.OrientationAxis[mipOrient], background: [0.04, 0.04, 0.055] as Types.Point3 },
          }],
        );

        // ── MPR 그룹: Crosshairs(좌) + Zoom(우) + Pan(중) + 휠 스크롤 ──
        for (const id of [TG_MPR, TG_MIP]) {
          if (ToolGroupManager.getToolGroup(id)) ToolGroupManager.destroyToolGroup(id);
        }
        const mpr = ToolGroupManager.createToolGroup(TG_MPR)!;
        mpr.addTool(WindowLevelTool.toolName);
        mpr.addTool(ZoomTool.toolName);
        mpr.addTool(PanTool.toolName);
        mpr.addTool(StackScrollTool.toolName);
        mpr.addTool(CrosshairsTool.toolName, {
          getReferenceLineColor: (id: string) => REF_COLORS[id] ?? "#94a3b8",
          getReferenceLineControllable: () => true,
          getReferenceLineDraggableRotatable: () => true,
          getReferenceLineSlabThicknessControlsOn: () => true,   // 참조선 점선 핸들 — 드래그로 슬랩 폭 조정
        });
        mpr.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Secondary }],
        });
        mpr.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Auxiliary }],
        });
        mpr.setToolActive(StackScrollTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }],
        });
        for (const v of MPR_VIEWPORTS) mpr.addViewport(v.id, RENDERING_ENGINE_ID);

        // ── MIP 그룹: W/L(좌) + Zoom(우) + Pan(중) + 휠 스크롤 ──
        const mip = ToolGroupManager.createToolGroup(TG_MIP)!;
        mip.addTool(WindowLevelTool.toolName);
        mip.addTool(ZoomTool.toolName);
        mip.addTool(PanTool.toolName);
        mip.addTool(StackScrollTool.toolName);
        mip.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
        });
        mip.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Secondary }],
        });
        mip.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Auxiliary }],
        });
        mip.setToolActive(StackScrollTool.toolName, {
          bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }],
        });
        mip.addViewport(MIP_ID, RENDERING_ENGINE_ID);

        // 시리즈별 고유 볼륨 ID — 시리즈 전환 시 캐시 충돌 방지
        const volumeId = `cornerstoneStreamingImageVolume:sv-${selSeries.slice(-24)}`;
        volumeIdRef.current = volumeId;
        const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
        await (volume as { load: () => Promise<unknown> | unknown }).load?.();
        await setVolumesForViewports(
          engine,
          [{ volumeId }],
          [...MPR_VIEWPORTS.map((v) => v.id), MIP_ID],
        );
        applySlab(slabMm, blend);
        applyToolMode(toolMode);   // 기본 Crosshair — 십자선 연동
        engine.render();
        requestAnimationFrame(() => {
          engine.resize(true, true);
          engine.render();
        });
        // 초기 레이아웃 타이밍에 캔버스가 기본 300×150 백킹으로 남는 경우 재-resize (최대 5회)
        {
          let tries = 0;
          const fix = () => {
            const c = gridRef.current?.querySelector("canvas");
            if (c && (c.width === 300 && c.height === 150) && tries++ < 5) {
              engineRef.current?.resize(true, true);
              engineRef.current?.render();
              window.setTimeout(fix, 300);
            }
          };
          window.setTimeout(fix, 300);
        }
        if (gridRef.current && !resizeObserverRef.current) {
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
        for (const id of [TG_MPR, TG_MIP]) {
          if (ToolGroupManager.getToolGroup(id)) ToolGroupManager.destroyToolGroup(id);
        }
        engineRef.current?.destroy();
      } catch {
        /* 정리 중 오류 무시 */
      }
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyUid, selSeries]);

  useEffect(() => () => { resizeObserverRef.current?.disconnect(); }, []);

  // 참조선 점선(슬랩 폭) 드래그 감지 — MPR 뷰포트의 slabThickness 가 2mm 를 넘으면 3D(VR) 페인 자동 추가
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const check = () => {
      const engine = engineRef.current;
      if (!engine || vrOn) return;
      for (const v of MPR_VIEWPORTS) {
        try {
          const vp = engine.getViewport(v.id) as Types.IVolumeViewport | undefined;
          const t = vp?.getProperties?.()?.slabThickness;
          if (t && t > 2) { setVrOn(true); return; }
        } catch { /* 미준비 */ }
      }
    };
    const up = () => window.setTimeout(check, 50);
    el.addEventListener("pointerup", up);
    return () => el.removeEventListener("pointerup", up);
  }, [vrOn]);

  // 3D 볼륨 렌더링(VR) 페인 — vrOn 시 동적 enable, 모달리티별 프리셋(CT=Bone, 그 외 MR 기본)
  useEffect(() => {
    const engine = engineRef.current;
    if (!vrOn || !engine || !volumeIdRef.current) return;
    const elVr = containerRefs.current["vp-vr"];
    if (!elVr) return;
    let dead = false;
    (async () => {
      try {
        engine.enableElement({
          viewportId: "vp-vr",
          type: Enums.ViewportType.VOLUME_3D,
          element: elVr,
          defaultOptions: { background: [0.04, 0.04, 0.055] as Types.Point3 },
        });
        await setVolumesForViewports(engine, [{ volumeId: volumeIdRef.current }], ["vp-vr"]);
        if (dead) return;
        const vp = engine.getViewport("vp-vr") as Types.IVolumeViewport;
        const mod = seriesList.find((x) => x.uid === selSeries)?.modality ?? "";
        try { (vp as unknown as { setProperties: (p: { preset: string }) => void })
          .setProperties({ preset: mod === "CT" ? "CT-Bone" : "MR-Default" }); } catch { /* 프리셋 미지원 */ }
        vp.render();
        engine.resize(true, true);
        engine.render();
      } catch { /* VR 미지원 환경 — 페인만 비움 */ }
    })();
    return () => {
      dead = true;
      try { engine.disableElement("vp-vr"); } catch { /* 무시 */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrOn, selSeries]);

  const VIEWPORTS = [...MPR_VIEWPORTS.map((v) => ({ ...v, mip: false })),
                     { id: MIP_ID, label: `MIP (${mipOrient})`, mip: true },
                     ...(vrOn ? [{ id: "vp-vr", label: "3D (Volume Rendering)", mip: true }] : [])];

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
        background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", flexWrap: "wrap",
      }}>
        <img src="/saintview-viewer.svg" alt="" width={20} height={20} />
        <b>Saintview 3D</b>
        {/* 시리즈 선택 — 자동 선택이 부적합한 검사(보정/스카웃) 대비 */}
        <select value={selSeries} onChange={(e) => setSelSeries(e.target.value)}
                title="볼륨을 구성할 시리즈" style={{ fontSize: 12, maxWidth: 260 }}>
          {seriesList.map((s) => (
            <option key={s.uid} value={s.uid}>
              {s.modality} · {s.count}장 · {s.desc || "(무제)"}
            </option>
          ))}
        </select>
        {/* 도구 모드 — Crosshair(십자선 연동) / W/L */}
        <span style={{ display: "flex", gap: 2 }}>
          <button onClick={() => { setToolMode("crosshair"); applyToolMode("crosshair"); }}
                  title="십자선 — 한 평면의 라인을 끌면 다른 평면 중심이 그 위치로 이동(비교)"
                  style={{ fontSize: 11.5, padding: "2px 10px",
                           background: toolMode === "crosshair" ? "var(--accent)" : undefined,
                           color: toolMode === "crosshair" ? "#fff" : undefined }}>✛ Crosshair</button>
          <button onClick={() => { setToolMode("wl"); applyToolMode("wl"); }}
                  title="W/L — 좌드래그로 밝기/대조 조절"
                  style={{ fontSize: 11.5, padding: "2px 10px",
                           background: toolMode === "wl" ? "var(--accent)" : undefined,
                           color: toolMode === "wl" ? "#fff" : undefined }}>◐ W/L</button>
        </span>
        {status && <span style={{ color: "var(--stat-draft)", fontSize: 12 }}>{status}</span>}
        {error && <span style={{ color: "var(--stat-emergency)", fontSize: 12 }}>⚠ {error}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setVrOn((v) => !v)}
                title="3D 볼륨 렌더링 페인 추가/제거 — MPR 참조선의 점선 핸들로 슬랩 폭을 조정해도 자동 추가됩니다"
                style={{ fontSize: 11.5, padding: "2px 10px",
                         background: vrOn ? "var(--accent)" : undefined, color: vrOn ? "#fff" : undefined }}>🧊 3D 렌더링</button>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMipSetOpen((o) => !o)}
                  title="MIP Settings — 강도 투영 모드(MIP/MinIP/AvIP/끄기)·슬랩 두께"
                  style={{ fontSize: 11.5, padding: "2px 10px",
                           background: mipSetOpen ? "var(--bg-elevated)" : undefined }}>
            ⚙ MIP 설정 <span style={{ color: "var(--ai)" }}>
              {blend === "off" ? "끄기" : blend.toUpperCase()}{blend !== "off" ? ` | ${slabMm}mm` : ""}</span>
          </button>
          {mipSetOpen && (
            <div style={{ position: "absolute", top: "110%", right: 0, zIndex: 400, width: 280,
                          background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
                          boxShadow: "0 10px 30px rgba(0,0,0,0.55)", padding: 12, fontSize: 12 }}>
              <b style={{ fontSize: 13 }}>MIP Settings</b>
              <div style={{ color: "var(--text-secondary)", fontSize: 11, marginBottom: 8 }}>강도 투영 설정</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 10.5, letterSpacing: 1, margin: "6px 0 4px" }}>BLEND MODE</div>
              {([["mip", "MIP", "최대 강도 투영 - 혈관, 석회화 강조"],
                 ["minip", "MinIP", "최소 강도 투영 - 기도, 폐 강조"],
                 ["avip", "AvIP", "평균 강도 투영 - 노이즈 감소"],
                 ["off", "끄기", "일반 렌더링"]] as const).map(([k, label, desc]) => (
                <div key={k} onClick={() => { setBlend(k); applySlab(slabMm, k); }}
                     style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "7px 10px", borderRadius: 6, cursor: "pointer", marginBottom: 2,
                              background: blend === k ? "var(--bg-elevated)" : "transparent" }}>
                  <span>
                    <div style={{ fontWeight: 700 }}>{label}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{desc}</div>
                  </span>
                  {blend === k && <span style={{ color: "var(--accent)", fontWeight: 800 }}>✓</span>}
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                            margin: "10px 0 2px" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: 10.5, letterSpacing: 1 }}>SLAB THICKNESS</span>
                <b style={{ color: "var(--ai)" }}>{slabMm}MM</b>
              </div>
              <input type="range" min={1} max={100} step={1} value={slabMm} disabled={blend === "off"}
                     style={{ width: "100%" }}
                     onChange={(e) => { const v = Number(e.target.value); setSlabMm(v); applySlab(v, blend); }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-secondary)" }}>
                <span>1mm</span><span>100mm</span>
              </div>
              <div style={{ display: "flex", gap: 4, margin: "8px 0" }}>
                {[5, 10, 20, 30, 50].map((v) => (
                  <button key={v} disabled={blend === "off"}
                          onClick={() => { setSlabMm(v); applySlab(v, blend); }}
                          style={{ flex: 1, fontSize: 11, padding: "3px 0",
                                   border: slabMm === v ? "1px solid var(--accent)" : undefined,
                                   color: slabMm === v ? "var(--accent)" : undefined }}>{v}mm</button>
                ))}
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                커스텀:
                <input type="number" min={1} max={200} value={slabMm} disabled={blend === "off"}
                       style={{ width: 64 }}
                       onChange={(e) => {
                         const v = Math.min(200, Math.max(1, Number(e.target.value) || 1));
                         setSlabMm(v); applySlab(v, blend);
                       }} /> mm
              </label>
              <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11.5, marginTop: 8 }}>
                MIP 방향
                <select value={mipOrient} style={{ fontSize: 12 }}
                        onChange={(e) => {
                          const o = e.target.value as "AXIAL" | "SAGITTAL" | "CORONAL";
                          setMipOrient(o);
                          applyMipOrient(o);
                        }}>
                  <option value="AXIAL">Axial</option>
                  <option value="SAGITTAL">Sagittal</option>
                  <option value="CORONAL">Coronal</option>
                </select>
              </label>
              <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--border)",
                            color: "var(--accent)", fontWeight: 700, fontSize: 11.5 }}>
                {blend === "off" ? "일반 렌더링" : `${blend === "mip" ? "MIP" : blend === "minip" ? "MinIP" : "AvIP"} | ${slabMm}mm`}
              </div>
            </div>
          )}
        </div>
        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          좌={toolMode === "crosshair" ? "십자선" : "W/L"} · 우=Zoom · 휠=스크롤 · 중=Pan
        </span>
        <button onClick={onClose}>닫기</button>
      </div>

      {/* 2×2 뷰포트 그리드 */}
      <div ref={gridRef} style={{
        flex: 1, display: "grid", gridTemplateColumns: vrOn ? "1fr 1fr 1fr" : "1fr 1fr", gridTemplateRows: "1fr 1fr",
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
              color: v.mip ? "var(--ai)" : (REF_COLORS[v.id] ?? "var(--text-secondary)"),
              pointerEvents: "none", textShadow: "0 0 4px #000",
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
