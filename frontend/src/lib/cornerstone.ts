// Cornerstone3D 공용 초기화 + DICOMweb(wadors) 메타데이터 등록
import { init as csInit } from "@cornerstonejs/core";
import {
  PanTool,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
  LengthTool,
  AngleTool,
  RectangleROITool,
  EllipticalROITool,
  ArrowAnnotateTool,
  MagnifyTool,
  addTool,
  init as toolsInit,
} from "@cornerstonejs/tools";
import { init as dicomImageLoaderInit, wadors } from "@cornerstonejs/dicom-image-loader";

export const DICOMWEB_ROOT =
  import.meta.env.VITE_DICOMWEB_ROOT ?? "http://localhost:3000/dicom-web";

let initialized = false;
export async function ensureCornerstone() {
  if (initialized) return;
  await csInit();
  // vite dev에서 디코드 워커 무음 정지 이슈 → 메인스레드 디코드(소량 스택엔 충분)
  dicomImageLoaderInit({ maxWebWorkers: 0 });
  toolsInit();
  for (const T of [
    WindowLevelTool, PanTool, ZoomTool, StackScrollTool, MagnifyTool,
    LengthTool, AngleTool, RectangleROITool, EllipticalROITool, ArrowAnnotateTool,
  ]) {
    try { addTool(T); } catch { /* 중복 등록 무시 (HMR) */ }
  }
  initialized = true;
}

type DwJson = Record<string, { Value?: unknown[] }>;

/** 시리즈 메타데이터를 wadors 매니저에 등록하고 정렬된 imageId 목록 반환 */
export async function registerSeriesImageIds(studyUid: string, seriesUid: string): Promise<string[]> {
  const res = await fetch(`${DICOMWEB_ROOT}/studies/${studyUid}/series/${seriesUid}/metadata`);
  if (!res.ok) throw new Error("시리즈 메타데이터 조회 실패");
  const instances: DwJson[] = await res.json();
  const withIds = instances
    .map((meta) => {
      const sop = String(meta["00080018"]?.Value?.[0] ?? "");
      const num = Number(meta["00200013"]?.Value?.[0] ?? 0);
      const imageId =
        `wadors:${DICOMWEB_ROOT}/studies/${studyUid}/series/${seriesUid}/instances/${sop}/frames/1`;
      return { imageId, num, meta, sop };
    })
    .filter((x) => x.sop)
    .sort((a, b) => a.num - b.num);
  for (const { imageId, meta } of withIds) {
    wadors.metaDataManager.add(imageId, meta as never);
  }
  return withIds.map((x) => x.imageId);
}

/** 검사에서 영상 시리즈 중 인스턴스 최다 시리즈의 imageIds (볼륨용) */
export async function buildVolumeImageIds(studyUid: string): Promise<string[]> {
  const seriesRes = await fetch(`${DICOMWEB_ROOT}/studies/${studyUid}/series`);
  if (!seriesRes.ok) throw new Error("시리즈 조회 실패");
  const seriesList: DwJson[] = await seriesRes.json();
  const candidates = seriesList
    .map((s) => ({
      uid: String(s["0020000E"]?.Value?.[0] ?? ""),
      modality: String(s["00080060"]?.Value?.[0] ?? ""),
      count: Number(s["00201209"]?.Value?.[0] ?? 0),
    }))
    .filter((s) => s.uid && !["SR", "KO", "PR", "SEG"].includes(s.modality));
  if (candidates.length === 0) throw new Error("영상 시리즈가 없습니다");
  candidates.sort((a, b) => b.count - a.count);
  return registerSeriesImageIds(studyUid, candidates[0].uid);
}
