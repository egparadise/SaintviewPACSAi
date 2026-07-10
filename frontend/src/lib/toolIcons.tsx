// 뷰어 Tools 아이콘 세트 — UBPACS p.18~21 아이콘 표 대응(인라인 SVG, currentColor)
// 3D(입체) 렌더링: ① 아래쪽 드롭섀도 ② 상단광(top-light) 베벨 림 ③ 2톤(상단 밝음→하단 어두움)
// 그라디언트 오버레이 ④ 흰색 저투명 하이라이트 엣지. 실루엣(형태)은 기존 플랫 아이콘 그대로 유지.
import { useId, type CSSProperties, type ReactNode } from "react";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<string, ReactNode> = {
  // ── Common ──
  zoom: (<g {...P}><circle cx="10" cy="10" r="6" /><line x1="14.5" y1="14.5" x2="20" y2="20" /><line x1="7.5" y1="10" x2="12.5" y2="10" /><line x1="10" y1="7.5" x2="10" y2="12.5" /></g>),
  pan: (<g {...P}><line x1="12" y1="3" x2="12" y2="21" /><line x1="3" y1="12" x2="21" y2="12" /><polyline points="9,5.5 12,2.5 15,5.5" /><polyline points="9,18.5 12,21.5 15,18.5" /><polyline points="5.5,9 2.5,12 5.5,15" /><polyline points="18.5,9 21.5,12 18.5,15" /></g>),
  fit: (<g {...P}><polyline points="3,8 3,3 8,3" /><polyline points="16,3 21,3 21,8" /><polyline points="21,16 21,21 16,21" /><polyline points="8,21 3,21 3,16" /><rect x="8" y="8" width="8" height="8" /></g>),
  inv: (<g {...P}><circle cx="12" cy="12" r="8" /><path d="M12 4 a8 8 0 0 1 0 16 z" fill="currentColor" stroke="none" /></g>),
  rotL: (<g {...P}><path d="M5.5 7a8 8 0 1 1-1.4 6" /><polyline points="4,2.5 5.5,7 10,6" /></g>),
  rotR: (<g {...P}><path d="M18.5 7a8 8 0 1 0 1.4 6" /><polyline points="20,2.5 18.5,7 14,6" /></g>),
  flipH: (<g {...P}><line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2.5 2.5" /><path d="M9 8 4 12l5 4z" fill="currentColor" stroke="none" /><path d="M15 8l5 4-5 4z" /></g>),
  flipV: (<g {...P}><line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2.5 2.5" /><path d="M8 9 12 4l4 5z" fill="currentColor" stroke="none" /><path d="M8 15l4 5 4-5z" /></g>),
  cine: (<g {...P}><path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" /></g>),
  cap: (<g {...P}><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="12" cy="13.5" r="3.5" /><path d="M8 7l1.6-3h4.8L16 7" /></g>),
  reset: (<g {...P}><path d="M5 12a7.5 7.5 0 1 0 2-5" /><polyline points="6,2.5 6.8,7 11,6.2" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></g>),
  // ── Annotation ──
  length: (<g {...P}><line x1="4" y1="20" x2="20" y2="4" /><line x1="6" y1="14.5" x2="9.5" y2="18" /><line x1="10" y1="10.5" x2="13.5" y2="14" /><line x1="14" y1="6.5" x2="17.5" y2="10" /></g>),
  angle: (<g {...P}><line x1="4" y1="20" x2="20" y2="20" /><line x1="4" y1="20" x2="15" y2="5" /><path d="M10 20a7 7 0 0 0-1.6-4.4" /></g>),
  rect: (<g {...P}><rect x="4" y="6" width="16" height="12" /></g>),
  ellipse: (<g {...P}><ellipse cx="12" cy="12" rx="8.5" ry="5.5" /></g>),
  arrow: (<g {...P}><line x1="5" y1="19" x2="18" y2="6" /><polyline points="11,5 18.5,5.2 18.8,12.5" /></g>),
  text: (<g {...P}><line x1="5" y1="5" x2="19" y2="5" /><line x1="12" y1="5" x2="12" y2="19" /><line x1="9" y1="19" x2="15" y2="19" /></g>),
  ref: (<g {...P}><circle cx="12" cy="12" r="7" /><line x1="12" y1="1.5" x2="12" y2="8" /><line x1="12" y1="16" x2="12" y2="22.5" /><line x1="1.5" y1="12" x2="8" y2="12" /><line x1="16" y1="12" x2="22.5" y2="12" /></g>),
  ctr: (<g {...P}><path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20z" /><line x1="3" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="21" y2="12" /></g>),
  save: (<g {...P}><path d="M5 3h11l3 3v15H5z" /><rect x="8" y="3" width="7" height="5" /><rect x="7.5" y="13" width="9" height="8" /></g>),
  gsps: (<g {...P}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 17l9 5 9-5" /></g>),
  del: (<g {...P}><path d="M8 5h13v14H8l-5-7z" /><line x1="11.5" y1="9" x2="17.5" y2="15" /><line x1="17.5" y1="9" x2="11.5" y2="15" /></g>),
  clr: (<g {...P}><path d="M5 7h14l-1.2 14H6.2z" /><line x1="3" y1="7" x2="21" y2="7" /><path d="M9 7V4h6v3" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></g>),
  // ── 2D / ETC ──
  wl: (<g {...P}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 0 0 16c-2.5-2.5-2.5-13.5 0-16z" fill="currentColor" stroke="none" /></g>),
  all: (<g {...P}><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" /></g>),
  ohif: (<g {...P}><rect x="3" y="4" width="18" height="12" rx="1.5" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="16" x2="12" y2="20" /><polyline points="13,7 17,7 17,11" /><line x1="17" y1="7" x2="12.5" y2="11.5" /></g>),
  mpr: (<g {...P}><path d="M12 2.5l8 4.5v9l-8 4.5-8-4.5v-9z" /><path d="M4 7l8 4.5L20 7" /><line x1="12" y1="11.5" x2="12" y2="20.5" /></g>),
};

// currentColor 치환용 레이어 스타일 — 어두운 버튼 배경/파란(accent) 활성 배경 어디서든
// 본체(currentColor)는 그대로 두고 흰/검 저투명 사본으로만 명암을 얹는다(선명도 유지).
const LAYER_LIGHT: CSSProperties = { color: "#fff" };
const LAYER_DARK: CSSProperties = { color: "#000" };

export function ToolIcon({ id, size = 17 }: { id: string; size?: number }) {
  // SVG 인스턴스가 여러 개 렌더되므로 gradient/filter/mask id 충돌 방지 — 인스턴스별 고유 id
  const rawId = useId();
  const icon = ICONS[id];
  if (!icon) return null;
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const shadowId = `t3d-sh-${uid}`;
  const glossId = `t3d-gl-${uid}`;
  const maskId = `t3d-mk-${uid}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block", overflow: "visible" }}>
      <defs>
        {/* ① 아래쪽 부드러운 드롭섀도 */}
        <filter id={shadowId} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1" stdDeviation="0.9" floodColor="#000" floodOpacity="0.5" />
        </filter>
        {/* ③ 2톤 볼륨: 상단 밝음(흰 저투명) → 하단 어두움(검 저투명) */}
        <linearGradient id={glossId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
        {/* 아이콘 실루엣 마스크 — 그라디언트를 선/면 모양 안쪽에만 입힘(형태 불변) */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
          <g style={LAYER_LIGHT}>{icon}</g>
        </mask>
      </defs>
      <g filter={`url(#${shadowId})`}>
        {/* ② 베벨 아래면 — 어두운 림(0.6px 아래로) */}
        <g transform="translate(0 0.6)" opacity={0.45} style={LAYER_DARK}>{icon}</g>
        {/* ④ 상단광 하이라이트 엣지 — 흰색 저투명 림(0.6px 위로) */}
        <g transform="translate(0 -0.6)" opacity={0.55} style={LAYER_LIGHT}>{icon}</g>
        {/* 본체 — currentColor 유지(테마/활성색 자동 대응) */}
        {icon}
        {/* ③ 2톤 그라디언트 오버레이(마스크로 본체 위에만) */}
        <rect x="-2" y="-2" width="28" height="28" fill={`url(#${glossId})`} mask={`url(#${maskId})`} />
      </g>
    </svg>
  );
}

/** 아이콘 + 라벨 세로 스택 — 팔레트 버튼 내부 공용 */
export function ToolBtnInner({ id, label }: { id: string; label: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1 }}>
      <ToolIcon id={id} />
      <span style={{ fontSize: 10 }}>{label}</span>
    </span>
  );
}
