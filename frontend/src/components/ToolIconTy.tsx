// TY-2 이식 툴 아이콘 — 측정(poly/circle/centerline/수동CTR)·주석(box/spine/marking)·
// 픽셀(lens/profile/table2d)·셔터 3종. lib/toolIconsExtra 의 EXTRA 맵은 그대로 두고
// 여기서 신규 id 를 정의한 뒤 ToolIconTy 가 신규 id 우선 → 없으면 ToolIconEx 로 위임한다.
import { useId, type CSSProperties, type ReactNode } from "react";
import { ToolIconEx } from "../lib/toolIconsExtra";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const TY2: Record<string, ReactNode> = {
  // Polyline — 꺾은선 경로 + 정점 점
  poly: (<g {...P}><polyline points="3,19 8,8 13,14 20,4" /><circle cx="3" cy="19" r="1.5" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /><circle cx="13" cy="14" r="1.5" fill="currentColor" stroke="none" /><circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none" /></g>),
  // Circle 계측 — 원 + 중심점 + 반지름선
  circle: (<g {...P}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><line x1="12" y1="12" x2="18" y2="7" /></g>),
  // Center Line — 두 선의 중앙선(점선)
  centerline: (<g {...P}><line x1="4" y1="5" x2="20" y2="8" /><line x1="4" y1="19" x2="20" y2="16" /><line x1="4" y1="12" x2="20" y2="12" strokeDasharray="2.6 2" /></g>),
  // 수동 CTR — 심장 하트 + 흉곽 폭 측정선
  mctr: (<g {...P}><path d="M12 15s-4.2-2.7-4.2-5.6A2.4 2.4 0 0 1 12 8a2.4 2.4 0 0 1 4.2 1.4C16.2 12.3 12 15 12 15z" /><line x1="3" y1="19.5" x2="21" y2="19.5" /><polyline points="5.5,17.5 3,19.5 5.5,21.5" /><polyline points="18.5,17.5 21,19.5 18.5,21.5" /></g>),
  // Box 메모 — 사각 + 제목 줄
  box: (<g {...P}><rect x="4" y="7" width="16" height="12" rx="1" /><line x1="4" y1="4" x2="13" y2="4" /></g>),
  // Spine Label — 척추 연번 점 + 라벨 틱
  spine: (<g {...P}><circle cx="9" cy="5" r="1.6" fill="currentColor" stroke="none" /><circle cx="10.5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="9" cy="19" r="1.6" fill="currentColor" stroke="none" /><line x1="13" y1="5" x2="18" y2="5" /><line x1="14.5" y1="12" x2="19.5" y2="12" /><line x1="13" y1="19" x2="18" y2="19" /></g>),
  // Marking — 깃발
  marking: (<g {...P}><line x1="6" y1="3" x2="6" y2="21" /><path d="M6 4h12l-3 4 3 4H6" /></g>),
  // Lens — 조준 십자 + 값점
  lens: (<g {...P}><line x1="12" y1="3" x2="12" y2="9" /><line x1="12" y1="15" x2="12" y2="21" /><line x1="3" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="21" y2="12" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></g>),
  // Profile — 축 + 파형
  profile: (<g {...P}><line x1="4" y1="3.5" x2="4" y2="20" /><line x1="4" y1="20" x2="21" y2="20" /><path d="M5.5 16c2.5 0 2.5-8 5-8s2.5 5.5 5 5.5 2.2-3 4.5-3" /></g>),
  // 2D Table — 격자
  table2d: (<g {...P}><rect x="3.5" y="4.5" width="17" height="15" rx="1" /><line x1="3.5" y1="9.5" x2="20.5" y2="9.5" /><line x1="3.5" y1="14.5" x2="20.5" y2="14.5" /><line x1="9.2" y1="4.5" x2="9.2" y2="19.5" /><line x1="14.8" y1="4.5" x2="14.8" y2="19.5" /></g>),
  // 셔터 — 바깥 가림(해칭) + 안쪽 노출 영역
  shutRect: (<g {...P}><rect x="3" y="3" width="18" height="18" rx="1" /><rect x="8" y="8" width="8" height="8" /><line x1="3.5" y1="6.5" x2="6.5" y2="3.5" opacity="0.55" /><line x1="17.5" y1="20.5" x2="20.5" y2="17.5" opacity="0.55" /></g>),
  shutEl: (<g {...P}><rect x="3" y="3" width="18" height="18" rx="1" /><ellipse cx="12" cy="12" rx="5" ry="4" /><line x1="3.5" y1="6.5" x2="6.5" y2="3.5" opacity="0.55" /><line x1="17.5" y1="20.5" x2="20.5" y2="17.5" opacity="0.55" /></g>),
  shutPoly: (<g {...P}><rect x="3" y="3" width="18" height="18" rx="1" /><polygon points="12,7 16.5,10.5 15,16 9,16 7.5,10.5" /><line x1="3.5" y1="6.5" x2="6.5" y2="3.5" opacity="0.55" /><line x1="17.5" y1="20.5" x2="20.5" y2="17.5" opacity="0.55" /></g>),
};

const LAYER_LIGHT: CSSProperties = { color: "#fff" };
const LAYER_DARK: CSSProperties = { color: "#000" };

/** TY-2 신규 아이콘 우선 렌더 — 없으면 ToolIconEx(→ToolIcon) 위임. 3D/flat 규칙은 toolIcons.tsx 동일 */
export function ToolIconTy({ id, size = 17, flat = false }: { id: string; size?: number; flat?: boolean }) {
  const rawId = useId();
  const icon = TY2[id];
  if (!icon) return <ToolIconEx id={id} size={size} flat={flat} />;
  if (flat) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block", overflow: "visible" }}>
        {icon}
      </svg>
    );
  }
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const shadowId = `t3dy-sh-${uid}`;
  const glossId = `t3dy-gl-${uid}`;
  const maskId = `t3dy-mk-${uid}`;
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
