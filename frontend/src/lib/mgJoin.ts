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
/** 뷰어 콤보 표기 — "2x2" → "2×2" (설정 화면은 뷰 구성을 덧붙인 MG_LAYOUT_DESC 를 쓴다) */
export const mgGridLabel = (k: string) => k.replace("x", "×");

export interface MgJoinPrefs {
  /** 뷰어를 열 때 2D-MG 체크 기본값 */
  on_default: boolean;
  /** MG 기본 분할 */
  layout: MgLayoutKey;
  /** 조직/배경 판정 임계값 — 프레임 네 모서리에서 잰 배경 밝기와의 차이(0~255) */
  thresh: number;
  /** 위 layout 을 **Series 분할**(뷰 하나당 페인 하나)로 적용할지. 기본 켜짐.
   *  ⚠ 해제하면 페인 하나 안의 **Image 분할**(타일)이 되는데, 타일 페인은 변환이 페인당
   *     하나뿐이라 **좌우 맞붙임(2D-MG)이 적용되지 않는다**(Viewer2D 의 적용기가 타일 페인을
   *     건너뛴다). 즉 해제 = 4뷰를 한 페인에 타일로 늘어놓기만 하는 표시 모드다. */
  series: boolean;
  /** 흉벽 판정 — auto=영상에서 조직 경계를 찾아 잘라냄(권장) / ratio=아래 고정 비율 */
  detect: "auto" | "ratio";
  /** 픽셀을 읽을 수 없을 때(타 출처 canvas 오염 등) 고정 비율로 **추정 크롭**을 할지.
   *  기본 꺼짐 — 근거 없이 맘모를 자르면 조직을 가릴 수 있어 원본 유지가 안전하다. */
  blind_ratio: boolean;
  /** detect=ratio 또는 blind_ratio 일 때 안쪽에서 잘라낼 폭 %(0~60) */
  ratio: number;
  /** 조직 주위로 남길 여백 %(0~10) — 조직이 가장자리에 딱 붙지 않게 */
  margin: number;
}
// 기본값은 lib/mgHang.DEFAULT_MG_CFG 와 같은 값을 쓴다(두 모듈이 어긋나지 않도록).
export const DEFAULT_MG_JOIN: MgJoinPrefs = {
  on_default: false, layout: "2x2", thresh: 12,
  series: true,   // 기본 = Series 분할(현행 동작). 해제하면 맞붙임이 걸리지 않는다
  detect: "auto", blind_ratio: false, ratio: 38, margin: 2,
};

export function normMgJoin(v: unknown): MgJoinPrefs {
  const o = (v ?? {}) as Partial<MgJoinPrefs>;
  const lay = MG_LAYOUTS.includes(o.layout as MgLayoutKey) ? (o.layout as MgLayoutKey) : DEFAULT_MG_JOIN.layout;
  const num = (x: unknown, d: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, typeof x === "number" && isFinite(x) ? x : d));
  return {
    on_default: !!o.on_default,
    layout: lay,
    thresh: num(o.thresh, DEFAULT_MG_JOIN.thresh, 0, 255),
    series: typeof o.series === "boolean" ? o.series : DEFAULT_MG_JOIN.series,
    detect: o.detect === "ratio" ? "ratio" : "auto",
    blind_ratio: typeof o.blind_ratio === "boolean" ? o.blind_ratio : DEFAULT_MG_JOIN.blind_ratio,
    ratio: num(o.ratio, DEFAULT_MG_JOIN.ratio, 0, 60),
    margin: num(o.margin, DEFAULT_MG_JOIN.margin, 0, 10),
  };
}

/** 설정 화면·뷰어 콤보에 쓰는 분할 라벨 — 무엇을 고르는지 알 수 있게 뷰 구성을 함께 적는다 */
export const MG_LAYOUT_DESC: Record<string, string> = {
  "1x2": "1 : 2 (좌·우 2뷰)",
  "2x2": "2 : 2 (CC/MLO 4뷰)",
  "2x3": "2 : 3 (4뷰 + 여분 2)",
};

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
