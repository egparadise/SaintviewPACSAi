// 주석/계측 기하 유틸 (07 A.4) — 좌표 변환·계측값·Reference line
import type { Anno, InstanceNode } from "../api";

export interface PaneTransform {
  zoom: number; tx: number; ty: number; rot: number; flipH: boolean; flipV: boolean;
}

/** 화면(client) 좌표 → 이미지 정규화 좌표(0~1).
 *  CSS transform = translate→scale→rotate(원점=중앙) 의 역변환 후 contain 보정. */
export function screenToImage(
  clientX: number, clientY: number, paneRect: DOMRect, t: PaneTransform, imgAspect: number,
): [number, number] | null {
  const W = paneRect.width, H = paneRect.height;
  if (W <= 0 || H <= 0) return null;
  const cx = W / 2, cy = H / 2;
  // M = T·S·R (origin=중앙) → p_img = R⁻¹·S⁻¹·(p_screen − C − t) + C
  let x = clientX - paneRect.left - cx - t.tx;
  let y = clientY - paneRect.top - cy - t.ty;
  const sx = t.zoom * (t.flipH ? -1 : 1), sy = t.zoom * (t.flipV ? -1 : 1);
  x /= sx; y /= sy;
  const th = (-t.rot * Math.PI) / 180;
  const rx = x * Math.cos(th) - y * Math.sin(th);
  const ry = x * Math.sin(th) + y * Math.cos(th);
  x = rx + cx; y = ry + cy;
  // objectFit: contain 콘텐츠 사각형
  const paneAspect = W / H;
  let dw = W, dh = H, ox = 0, oy = 0;
  if (imgAspect > paneAspect) { dh = W / imgAspect; oy = (H - dh) / 2; }
  else { dw = H * imgAspect; ox = (W - dw) / 2; }
  const nx = (x - ox) / dw, ny = (y - oy) / dh;
  if (nx < -0.02 || nx > 1.02 || ny < -0.02 || ny > 1.02) return null;
  return [Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny))];
}

/** contain 콘텐츠 사각형(px) — SVG 오버레이 배치용 */
export function contentRect(w: number, h: number, imgAspect: number) {
  const paneAspect = w / h;
  if (imgAspect > paneAspect) {
    const dh = w / imgAspect;
    return { left: 0, top: (h - dh) / 2, width: w, height: dh };
  }
  const dw = h * imgAspect;
  return { left: (w - dw) / 2, top: 0, width: dw, height: h };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 계측값 계산 — PixelSpacing 있으면 mm/mm², 없으면 px/px² 폴백 */
export function measureAnno(
  kind: string, pts: number[][], inst: InstanceNode | undefined,
): { value: number; unit: string } | null {
  const cols = inst?.cols || 0, rows = inst?.rows || 0;
  const ps = inst?.pixel_spacing?.length === 2 ? inst.pixel_spacing : null;
  const hasMm = !!ps && cols > 0 && rows > 0;
  // 정규화 → 물리(mm) 또는 픽셀 거리
  const dx = (a: number[], b: number[]) => (b[0] - a[0]) * (cols || 1000) * (hasMm ? ps![1] : 1);
  const dy = (a: number[], b: number[]) => (b[1] - a[1]) * (rows || 1000) * (hasMm ? ps![0] : 1);
  const lin = hasMm ? "mm" : "px";

  if ((kind === "length" || kind === "arrow") && pts.length >= 2) {
    return { value: round1(Math.hypot(dx(pts[0], pts[1]), dy(pts[0], pts[1]))), unit: lin };
  }
  if (kind === "angle" && pts.length >= 3) {
    const v1 = [dx(pts[1], pts[0]), dy(pts[1], pts[0])];
    const v2 = [dx(pts[1], pts[2]), dy(pts[1], pts[2])];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) /
      (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1);
    return { value: round1(Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI), unit: "deg" };
  }
  if ((kind === "rect" || kind === "ellipse") && pts.length >= 2) {
    const w = Math.abs(dx(pts[0], pts[1])), h = Math.abs(dy(pts[0], pts[1]));
    const area = kind === "ellipse" ? Math.PI / 4 * w * h : w * h;
    return { value: round1(area), unit: hasMm ? "mm2" : "px2" };
  }
  return null;
}

/* ── Reference line (scout) ── */
const cross = (a: number[], b: number[]) =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** src 인스턴스의 영상 평면을 dst 이미지 위에 투영한 선분(정규화 좌표 2점).
 *  기하 태그 누락·평행 평면이면 null. */
export function refLineOn(src: InstanceNode, dst: InstanceNode): [number, number][] | null {
  if (src.orientation?.length !== 6 || src.position?.length !== 3) return null;
  if (dst.orientation?.length !== 6 || dst.position?.length !== 3) return null;
  if (!dst.cols || !dst.rows) return null;
  const n = cross(src.orientation.slice(0, 3), src.orientation.slice(3, 6)); // src 법선
  const rD = dst.orientation.slice(0, 3), cD = dst.orientation.slice(3, 6);
  const psD = dst.pixel_spacing?.length === 2 ? dst.pixel_spacing : [1, 1];
  // dst 픽셀 (i=col, j=row): P = oD + rD·i·ps[1] + cD·j·ps[0] — 평면식 n·(P−oS)=0
  const a = dot(n, rD) * psD[1];
  const b = dot(n, cD) * psD[0];
  const d = dot(n, [dst.position[0] - src.position[0], dst.position[1] - src.position[1],
                    dst.position[2] - src.position[2]]);
  if (Math.abs(a) < 1e-6 && Math.abs(b) < 1e-6) return null; // 평행 평면
  const cols = dst.cols, rows = dst.rows;
  const pts: [number, number][] = [];
  const push = (i: number, j: number) => {
    const nx = i / cols, ny = j / rows;
    if (nx < -0.001 || nx > 1.001 || ny < -0.001 || ny > 1.001) return;
    if (!pts.some((p) => Math.abs(p[0] - nx) < 1e-4 && Math.abs(p[1] - ny) < 1e-4)) pts.push([nx, ny]);
  };
  if (Math.abs(b) > 1e-9) for (const i of [0, cols]) push(i, -(a * i + d) / b);
  if (Math.abs(a) > 1e-9) for (const j of [0, rows]) push(-(b * j + d) / a, j);
  return pts.length >= 2 ? [pts[0], pts[1]] : null;
}

/** 주석 표시 라벨 */
export function annoLabel(a: Anno): string {
  const v = a.value != null ? `${a.value}${a.unit === "mm2" ? "mm²" : a.unit === "px2" ? "px²" : a.unit ?? ""}` : "";
  const base = a.kind === "text" ? (a.text ?? "") : v || (a.text ?? "");
  return a.source === "ai" ? `AI ${base}`.trim() : base;
}
