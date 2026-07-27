/**
 * 2D-MG — 맘모(MG) 좌우 맞붙임 표시.
 *
 * 맘모 영상은 흉벽 쪽에만 조직이 있고 반대편은 공기(검은 배경)라, 좌·우 유방을 나란히 걸면
 * 화면 가운데에 넓은 빈 공간이 생긴다. 이 모듈은 렌더된 프레임에서 조직 영역의 가로 범위를
 * 찾아, 각 페인의 조직을 안쪽(가운데) 경계에 붙이는 pan/zoom 값을 계산한다.
 *
 * 설계 원칙
 *  - 뷰어의 기존 `zoom/tx/ty` 만 사용한다. 별도 변환 계층을 두지 않으므로 주석·ROI·Scout·돋보기 등
 *    화면↔이미지 좌표 변환을 쓰는 모든 기능이 자동으로 맞는다.
 *  - 확대 배율은 맞붙임 대상 페인 전체가 **동일**하다(좌우 유방 크기 비교가 판독의 핵심 — 페인마다
 *    다른 배율은 임상적으로 위험). 배율은 각 페인 후보값의 최소값으로 정한다.
 *  - 감지 실패 시 아무것도 하지 않는다(원본 표시 유지). 추정 크롭 금지.
 *
 * ※ 무거운 의존성 금지 — 2D 뷰어 번들에 딸려 들어간다(51차: 정적 import 하나가 3MB 를 끌고 온 사례).
 */

export type MgLayoutKey = "1x2" | "2x2" | "2x3";
/** 2D-MG 모드에서 제공하는 분할 프리셋 (1:2 / 2:2 / 2:3) */
export const MG_LAYOUTS: MgLayoutKey[] = ["1x2", "2x2", "2x3"];
export const mgLayoutLabel = (k: string) => k.replace("x", ":");

export interface MgJoinPrefs {
  /** 뷰어를 열 때 2D-MG 체크 기본값 */
  on_default: boolean;
  /** MG 기본 분할 (Series 분할) */
  layout: MgLayoutKey;
  /** 조직/배경 판정 임계값 (0~255, 클수록 보수적) */
  thresh: number;
}
export const DEFAULT_MG_JOIN: MgJoinPrefs = { on_default: false, layout: "2x2", thresh: 12 };

export function normMgJoin(v: unknown): MgJoinPrefs {
  const o = (v ?? {}) as Partial<MgJoinPrefs>;
  const lay = MG_LAYOUTS.includes(o.layout as MgLayoutKey) ? (o.layout as MgLayoutKey) : DEFAULT_MG_JOIN.layout;
  const th = typeof o.thresh === "number" && isFinite(o.thresh) ? Math.max(0, Math.min(255, o.thresh)) : DEFAULT_MG_JOIN.thresh;
  return { on_default: !!o.on_default, layout: lay, thresh: th };
}

/** 조직 영역의 가로 범위 (0~1 정규화, 이미지 좌표) */
export interface MgBBox { x0: number; x1: number }

const MG_SAMPLE = 256;      // 판정용 다운샘플 한 변 최대 픽셀
const MG_MAX_ZOOM = 4;      // 폭주 방지
const MG_PAD = 0.006;       // 조직 경계 여유(가장자리 잘림 방지) — 이미지 폭 대비 비율
const MG_CACHE_MAX = 64;

const bboxCache = new Map<string, MgBBox | null>();
const bboxInflight = new Map<string, Promise<MgBBox | null>>();

/** 네 모서리 8×8 패치의 중앙값 = 배경(공기) 밝기. MONOCHROME1(반전) 영상도 그대로 대응된다. */
function cornerBg(d: Uint8ClampedArray, w: number, h: number): number {
  const vals: number[] = [];
  const n = Math.min(8, w, h);
  const corners: [number, number][] = [[0, 0], [w - n, 0], [0, h - n], [w - n, h - n]];
  for (const [ox, oy] of corners) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) vals.push(d[((oy + y) * w + (ox + x)) * 4]);
    }
  }
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)] ?? 0;
}

/**
 * 렌더된 프레임에서 조직의 가로 범위를 찾는다.
 * 조직이 가장 두꺼운 열에서 좌·우로 연속 확장하므로, 공기 영역에 떠 있는 번인 마커(R/L 표식 등)는
 * 사이의 빈 열에서 확장이 끊겨 제외된다.
 * @returns 정규화 bbox. 감지 실패·유의미한 여백이 없을 때 null(= 원본 표시 유지).
 */
export function tissueBBox(url: string, thresh: number): Promise<MgBBox | null> {
  const key = `${url}|${thresh}`;
  if (bboxCache.has(key)) return Promise.resolve(bboxCache.get(key) ?? null);
  const cur = bboxInflight.get(key);
  if (cur) return cur;
  const p = computeBBox(url, thresh)
    .then((r) => {                       // 판정 완료(조직 없음 포함) — 결정적 결과라 캐시
      if (bboxCache.size >= MG_CACHE_MAX) bboxCache.clear();
      bboxCache.set(key, r);
      return r;
    })
    .catch(() => null)                   // 이미지 로드 실패 — 일시 오류가 영구 고착되지 않도록 캐시하지 않는다
    .finally(() => { bboxInflight.delete(key); });
  bboxInflight.set(key, p);
  return p;
}

function computeBBox(url: string, thresh: number): Promise<MgBBox | null> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";   // /dicom-web 은 동일 출처 — 캔버스 오염 없음(lib/pixelTools 와 동일)
    img.onerror = () => reject(new Error("mg-bbox: image load failed"));   // 캐시 금지(위 catch)
    img.onload = () => {
      try {
        const W = img.naturalWidth, H = img.naturalHeight;
        if (!W || !H) return resolve(null);
        const k = Math.min(1, MG_SAMPLE / Math.max(W, H));
        const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const cx = cv.getContext("2d", { willReadFrequently: true });
        if (!cx) return resolve(null);
        cx.drawImage(img, 0, 0, w, h);
        const d = cx.getImageData(0, 0, w, h).data;
        const bg = cornerBg(d, w, h);
        // 열별 조직 픽셀 수
        const col = new Array<number>(w).fill(0);
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            if (Math.abs(d[(row + x) * 4] - bg) > thresh) col[x]++;
          }
        }
        let peak = 0;
        for (let x = 1; x < w; x++) if (col[x] > col[peak]) peak = x;
        const minCount = Math.max(2, Math.round(h * 0.005));   // 잡음 1~2px 은 조직으로 보지 않음
        if (col[peak] < minCount) return resolve(null);         // 조직 없음
        let a = peak, b = peak;
        while (a > 0 && col[a - 1] >= minCount) a--;
        while (b < w - 1 && col[b + 1] >= minCount) b++;
        const x0 = Math.max(0, a / w - MG_PAD);
        const x1 = Math.min(1, (b + 1) / w + MG_PAD);
        if (!(x1 > x0) || x1 - x0 > 0.97) return resolve(null); // 여백이 거의 없으면 맞붙일 것도 없음
        resolve({ x0, x1 });
      } catch { resolve(null); }
    };
    img.src = url;
  });
}

/** 페인의 조직을 어느 쪽 경계에 붙일지. 좌우 판정은 시리즈 설명의 laterality 우선, 없으면 그리드 열 위치. */
export function mgSide(lat: "R" | "L" | "", ci: number, cols: number): "left" | "right" | null {
  if (cols < 2) return null;
  let side: "left" | "right" | null = null;
  if (lat === "R") side = "right";        // 표준 배치상 우측 유방이 화면 왼쪽 열 → 오른쪽(가운데)으로 붙인다
  else if (lat === "L") side = "left";
  else if (ci < (cols - 1) / 2) side = "right";
  else if (ci > (cols - 1) / 2) side = "left";
  if (!side) return null;                 // 홀수 그리드의 정가운데 열 — 짝이 없으므로 원본 유지
  // 붙일 방향이 그리드의 바깥 변이면 마주 볼 짝이 없다 → 손대지 않는다(밖으로 밀어내는 사고 방지)
  if (side === "right" && ci === cols - 1) return null;
  if (side === "left" && ci === 0) return null;
  return side;
}

interface MgGeom { paneW: number; paneH: number; cols: number; rows: number; bbox: MgBBox }

const baseScale = (g: MgGeom) => Math.min(g.paneW / g.cols, g.paneH / g.rows);   // objectFit:contain 기본 배율

/**
 * 이 페인 하나만 놓고 봤을 때의 확대 후보 배율.
 * 조직 폭이 페인 폭을 채우되 세로는 원본 그대로(조직 잘림 방지). 실제 적용 배율은 호출측에서
 * 대상 페인들의 최소값을 취해 **동일 배율**로 맞춘다.
 */
export function mgZoom(g: MgGeom): number | null {
  const s0 = baseScale(g);
  const tw = (g.bbox.x1 - g.bbox.x0) * g.cols;
  if (!(s0 > 0) || !(tw > 0)) return null;
  const z = Math.min(g.paneW / tw, g.paneH / g.rows) / s0;
  if (!isFinite(z) || z <= 1) return 1;
  return Math.min(z, MG_MAX_ZOOM);
}

/**
 * 조직의 안쪽 경계를 페인의 안쪽 변에 붙이는 tx.
 * 화면 x = paneW/2 + (px − cols/2)·s·dir + tx  (뷰어의 translate→scale 합성과 동일)
 */
export function mgTx(g: MgGeom & { side: "left" | "right"; flipH: boolean; zoom: number }): number {
  const s = baseScale(g) * g.zoom;
  const wantRight = g.side === "right";
  // 좌우 반전 상태면 화면상 '안쪽'이 되는 bbox 모서리가 뒤집힌다
  const xIn = ((g.flipH ? !wantRight : wantRight) ? g.bbox.x1 : g.bbox.x0) * g.cols;
  const dir = g.flipH ? -1 : 1;
  const target = wantRight ? g.paneW : 0;
  return target - g.paneW / 2 - (xIn - g.cols / 2) * s * dir;
}

/** 이미 적용된 값과 사실상 같은지 — 불필요한 setState(리렌더 루프) 방지 */
export const mgSameXf = (
  a: { zoom: number; tx: number; ty: number },
  b: { zoom: number; tx: number; ty: number },
) => Math.abs(a.zoom - b.zoom) < 1e-4 && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5;
