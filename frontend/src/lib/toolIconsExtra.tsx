// TY 팔레트 확장 아이콘 — In Viewer 이식 기능(rot180/필터 3종/확대경/Refresh/Combine/Print/Calibrate)
// 기존 lib/toolIcons.tsx 의 ICONS 맵은 비공개라 그대로 두고, 여기서 확장 id 를 정의한 뒤
// ToolIconEx 가 확장 id 우선 → 없으면 기존 ToolIcon 으로 위임한다 (3D/flat 렌더 규칙 동일).
import { useId, type CSSProperties, type ReactNode } from "react";
import { ToolIcon } from "./toolIcons";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const EXTRA: Record<string, ReactNode> = {
  // 180도 회전 — 반원 화살표 2개(위/아래)
  rot180: (<g {...P}><path d="M5 11a7 7 0 0 1 13.2-3" /><polyline points="18.5,3 18.2,8 13.5,7.2" /><path d="M19 13a7 7 0 0 1-13.2 3" /><polyline points="5.5,21 5.8,16 10.5,16.8" /></g>),
  // Sharpen — 뾰족한 산봉우리(선명화)
  sharpen: (<g {...P}><path d="M3 19L9 5l3.5 7L15 8l6 11z" /><line x1="3" y1="19" x2="21" y2="19" /></g>),
  // Average(블러) — 부드러운 물결
  average: (<g {...P}><path d="M3 9c3-4.5 6-4.5 9 0s6 4.5 9 0" /><path d="M3 16c3-4.5 6-4.5 9 0s6 4.5 9 0" opacity="0.55" /></g>),
  // Pseudo Color — 반이 채워진 원(컬러맵)
  pseudo: (<g {...P}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" opacity="0.45" /><line x1="12" y1="4" x2="12" y2="20" /></g>),
  // Magnification — 렌즈 + 점선 초점
  mag: (<g {...P}><circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" /><circle cx="10.5" cy="10.5" r="2.6" strokeDasharray="1.6 1.6" /></g>),
  // Refresh Exam — 순환 화살표
  rfsh: (<g {...P}><path d="M4.5 12a7.5 7.5 0 0 1 13-5.2" /><polyline points="17.8,2.5 17.5,7 13,6.5" /><path d="M19.5 12a7.5 7.5 0 0 1-13 5.2" /><polyline points="6.2,21.5 6.5,17 11,17.5" /></g>),
  // Combine Series — 두 층을 하나로(아래 화살표)
  comb: (<g {...P}><rect x="4" y="3" width="16" height="4.5" rx="1" /><rect x="4" y="9.5" width="16" height="4.5" rx="1" /><line x1="12" y1="14" x2="12" y2="20.5" /><polyline points="9,18 12,21 15,18" /></g>),
  // Print — 프린터
  print: (<g {...P}><path d="M7 8V3h10v5" /><rect x="4" y="8" width="16" height="8" rx="1.2" /><rect x="7" y="13" width="10" height="8" /></g>),
  // Calibrate — 눈금 자
  calib: (<g {...P}><rect x="2.5" y="9" width="19" height="6.5" rx="1" /><line x1="6" y1="9" x2="6" y2="12" /><line x1="9.5" y1="9" x2="9.5" y2="13" /><line x1="13" y1="9" x2="13" y2="12" /><line x1="16.5" y1="9" x2="16.5" y2="13" /><line x1="20" y1="9" x2="20" y2="12" /></g>),
};

const LAYER_LIGHT: CSSProperties = { color: "#fff" };
const LAYER_DARK: CSSProperties = { color: "#000" };

/** 확장 아이콘 우선 렌더 — 없으면 기존 ToolIcon 위임. 3D 레이어(섀도/베벨/그라디언트)는 toolIcons.tsx 와 동일 규칙 */
export function ToolIconEx({ id, size = 17, flat = false }: { id: string; size?: number; flat?: boolean }) {
  const rawId = useId();
  const icon = EXTRA[id];
  if (!icon) return <ToolIcon id={id} size={size} flat={flat} />;
  if (flat) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block", overflow: "visible" }}>
        {icon}
      </svg>
    );
  }
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const shadowId = `t3dx-sh-${uid}`;
  const glossId = `t3dx-gl-${uid}`;
  const maskId = `t3dx-mk-${uid}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block", overflow: "visible" }}>
      <defs>
        <filter id={shadowId} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1" stdDeviation="0.9" floodColor="#000" floodOpacity="0.5" />
        </filter>
        <linearGradient id={glossId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
          <g style={LAYER_LIGHT}>{icon}</g>
        </mask>
      </defs>
      <g filter={`url(#${shadowId})`}>
        <g transform="translate(0 0.6)" opacity={0.45} style={LAYER_DARK}>{icon}</g>
        <g transform="translate(0 -0.6)" opacity={0.55} style={LAYER_LIGHT}>{icon}</g>
        {icon}
        <rect x="-2" y="-2" width="28" height="28" fill={`url(#${glossId})`} mask={`url(#${maskId})`} />
      </g>
    </svg>
  );
}
