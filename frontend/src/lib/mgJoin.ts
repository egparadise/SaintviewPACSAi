/**
 * 2D-MG — 맘모(MG) 좌우 맞붙임: **이 뷰어(본체)의 통합 계약**.
 *
 * ⚠ 알고리즘은 여기 없다. 조직 경계 탐지·배율·정렬 수학은 전부 `lib/mgHang.ts` 하나에 있고
 *    Viewer Suite(분리 배포판)와 **같은 파일을 공유**한다. 예전에는 두 저장소가 각자 구현을
 *    갖고 있어서, 한쪽에서 고친 임상 판단(좌우 동일 배율·반전 영상 배경 판정·추정 크롭 금지)이
 *    다른 쪽에 반영되지 않았다. 알고리즘이 갈리면 같은 검사가 두 제품에서 다르게 보인다.
 *
 * 이 파일이 갖는 것은 **본체 UI 계약**뿐이다:
 *   · 설정 저장 형태(MgJoinPrefs — viewer.prefs.mg_join)
 *   · 뷰어 effect 가 쓰기 편한 형태의 얇은 어댑터
 * 통합 방식도 저장소마다 다르다 — 본체는 계산 결과를 **페인 상태(zoom/tx/ty)에 써 넣고**,
 * 스위트는 렌더 시점에 합성한다. 둘 다 같은 수학을 쓰되 적용 지점만 다르다.
 *
 * ※ 무거운 의존성 금지 — 2D 뷰어 번들에 딸려 들어간다(51차: 정적 import 하나가 3MB 를 끌고 온 사례).
 */
import {
  MG_LAYOUTS as MG_LAYOUT_KEYS,
  MG_MAX_ZOOM,
  mgInnerSide,
  mgProbeUrl,
  mgSameXf as _mgSameXf,
  mgTxFor,
  mgZoomOf,
} from "./mgHang";

export type MgLayoutKey = "1x2" | "2x2" | "2x3";
/** 2D-MG 모드에서 제공하는 분할 프리셋 (1:2 / 2:2 / 2:3) */
export const MG_LAYOUTS: MgLayoutKey[] = [...MG_LAYOUT_KEYS] as MgLayoutKey[];
export const mgLayoutLabel = (k: string) => k.replace("x", ":");

export interface MgJoinPrefs {
  /** 뷰어를 열 때 2D-MG 체크 기본값 */
  on_default: boolean;
  /** MG 기본 분할 (Series 분할) */
  layout: MgLayoutKey;
  /** 조직/배경 판정 임계값 — 프레임 네 모서리에서 잰 배경 밝기와의 차이(0~255) */
  thresh: number;
}
export const DEFAULT_MG_JOIN: MgJoinPrefs = { on_default: false, layout: "2x2", thresh: 12 };

export function normMgJoin(v: unknown): MgJoinPrefs {
  const o = (v ?? {}) as Partial<MgJoinPrefs>;
  const lay = MG_LAYOUTS.includes(o.layout as MgLayoutKey) ? (o.layout as MgLayoutKey) : DEFAULT_MG_JOIN.layout;
  const th = typeof o.thresh === "number" && isFinite(o.thresh)
    ? Math.max(0, Math.min(255, o.thresh)) : DEFAULT_MG_JOIN.thresh;
  return { on_default: !!o.on_default, layout: lay, thresh: th };
}

/** 조직 영역의 가로 범위 (0~1 정규화, 이미지 좌표) */
export interface MgBBox { x0: number; x1: number }

/**
 * 렌더된 프레임에서 조직의 가로 범위를 찾는다(→ `mgHang.mgProbeUrl`).
 * @returns 정규화 bbox. 감지 실패·유의미한 여백 없음이면 null(= 원본 표시 유지, 추정 크롭 금지).
 */
export async function tissueBBox(url: string, thresh: number): Promise<MgBBox | null> {
  const pr = await mgProbeUrl(url, thresh);
  return pr.kind === "box" ? { x0: pr.box.x0, x1: pr.box.x1 } : null;
}

/** 페인의 조직을 어느 쪽 경계에 붙일지. 짝이 없으면 null(손대지 않는다). */
export const mgSide = mgInnerSide;

interface MgGeom { paneW: number; paneH: number; cols: number; rows: number; bbox: MgBBox }

/**
 * 이 페인 하나만 놓고 봤을 때의 확대 후보 배율.
 * 세로는 **원본 프레임 전체가 들어가도록** 유지한다(조직 잘림 방지) — y 범위 0~1 로 계산.
 * 실제 적용 배율은 호출측에서 대상 페인들의 최소값을 취해 **동일 배율**로 맞춘다
 * (좌우 유방 크기 비교가 판독의 핵심 — 페인마다 다른 배율은 없는 비대칭을 만든다).
 */
export function mgZoom(g: MgGeom): number | null {
  const z = mgZoomOf(
    { w: g.paneW, h: g.paneH }, { w: g.cols, h: g.rows },
    { x0: g.bbox.x0, y0: 0, x1: g.bbox.x1, y1: 1, wall: "L" }, { margin: 0 },
  );
  if (z === null) return null;
  return z <= 1 ? 1 : Math.min(z, MG_MAX_ZOOM);
}

/** 조직의 안쪽 경계를 페인의 안쪽 변에 붙이는 tx */
export function mgTx(g: MgGeom & { side: "left" | "right"; flipH: boolean; zoom: number }): number {
  return mgTxFor(g);
}

/** 이미 적용된 값과 사실상 같은지 — 불필요한 setState(리렌더 루프) 방지 */
export const mgSameXf = _mgSameXf;
