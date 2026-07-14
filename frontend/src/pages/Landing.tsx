// 홈 — PACS 소개 및 가입 진입 (Inviz 스타일 라이트 랜딩)
// 앱은 다크 테마지만 랜딩은 자체 라이트 테마(.lp-*)로 독립 구성한다.
import { useEffect, useState } from "react";
import { api } from "../api";

const INVIZ_URL = "https://www.inviz.co.kr/";

const FEATURES: { icon: string; title: string; desc: string }[] = [
  { icon: "🏥", title: "멀티 병원(테넌시)", desc: "병원별 가입·계정·데이터 격리. 설정으로 자기 병원 검사만 조회." },
  { icon: "🩻", title: "DICOM 수신·뷰어", desc: "Modality(SCU/SCP) 등록 수신, 자체 2D 뷰어·OHIF·내장 MPR." },
  { icon: "🤖", title: "AI 판독 보조", desc: "구조화 Structured Report 초안 — 최종 판독은 의료인이 검토·확정." },
  { icon: "💾", title: "저장·백업·압축", desc: "저장공간 감독, 기간 백업, JPEG2000/JPEG-LS 압축, 보존 정책." },
  { icon: "📡", title: "MPPS·MWL·GSPS", desc: "수행단계 수신으로 오더 자동 갱신, 워크리스트, 타사 PR 불러오기." },
  { icon: "🛡️", title: "역할 권한", desc: "관리자·의사·영상의학과·방사선사·기타 — 권한 매트릭스." },
];

// 랜딩 전용 스타일 1회 주입(라이트 테마·키프레임·호버 — 인라인으로 불가한 것)
const LP_CSS = `
.lp{min-height:100%;overflow:auto;background:
   radial-gradient(1200px 600px at 80% -10%, #efe9ff 0%, rgba(239,233,255,0) 60%),
   radial-gradient(900px 500px at 0% 0%, #f3f0ff 0%, rgba(243,240,255,0) 55%),
   linear-gradient(180deg,#ffffff 0%,#f7f5fd 100%);
   color:#181529;font-family:var(--font,system-ui,sans-serif);}
.lp-nav{display:flex;align-items:center;justify-content:space-between;padding:18px 40px;gap:16px;flex-wrap:wrap;}
.lp-logo{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#2a2340;font-weight:800;font-size:24px;letter-spacing:-.5px;}
.lp-logo:hover{opacity:.82;}
.lp-navbtns{display:flex;gap:10px;flex-wrap:wrap;}
.lp-btn{padding:9px 18px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;border:1px solid #e2ddf0;background:#fff;color:#2a2340;transition:all .15s;white-space:nowrap;}
.lp-btn:hover{border-color:#c7bdf0;box-shadow:0 3px 10px rgba(124,58,237,.10);}
.lp-btn.primary{background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;color:#fff;box-shadow:0 6px 16px rgba(124,58,237,.30);}
.lp-btn.primary:hover{filter:brightness(1.06);box-shadow:0 8px 20px rgba(124,58,237,.38);}
.lp-btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;}
.lp-hero{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center;max-width:1240px;margin:20px auto 0;padding:24px 40px 8px;}
@media(max-width:900px){.lp-hero{grid-template-columns:1fr;}.lp-hero-art{order:-1;}}
.lp-badge{display:inline-flex;align-items:center;gap:7px;background:#efe8fe;color:#6d28d9;font-size:13px;font-weight:600;padding:7px 15px;border-radius:999px;}
.lp-title{font-size:clamp(40px,6vw,72px);font-weight:900;line-height:1.02;letter-spacing:-2px;margin:22px 0 0;color:#141024;}
.lp-title .grad{background:linear-gradient(120deg,#7c3aed,#a855f7 60%,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent;}
.lp-sub{margin-top:22px;font-size:16.5px;line-height:1.65;color:#5b5570;max-width:520px;}
.lp-hero-art{position:relative;display:flex;align-items:center;justify-content:center;min-height:340px;}
.lp-blob{position:absolute;border-radius:50%;filter:blur(2px);}
.lp-dot{position:absolute;border-radius:50%;animation:lpFloat 5s ease-in-out infinite;}
@keyframes lpFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
.lp-sec-title{text-align:center;margin:44px 0 2px;}
.lp-carousel{max-width:1180px;margin:8px auto 0;padding:8px 20px 8px;display:flex;align-items:center;gap:8px;}
.lp-viewport{overflow:hidden;flex:1;}
.lp-track{display:flex;gap:18px;will-change:transform;}
.lp-card{flex:0 0 250px;background:#fff;border:1px solid #efeafa;border-radius:16px;padding:20px 20px 22px;
   box-shadow:0 10px 30px rgba(80,50,160,.07);}
.lp-card-ic{width:44px;height:44px;border-radius:11px;display:grid;place-items:center;font-size:22px;
   background:linear-gradient(135deg,#f0e9ff,#e7ddff);margin-bottom:13px;}
.lp-card-t{font-weight:800;font-size:15px;color:#211b38;}
.lp-card-d{margin-top:8px;font-size:12.8px;line-height:1.6;color:#6a6482;}
.lp-arrow{flex:0 0 auto;width:42px;height:42px;border-radius:50%;border:1px solid #e6e0f5;background:#fff;color:#7c3aed;
   font-size:20px;cursor:pointer;display:grid;place-items:center;transition:all .15s;box-shadow:0 4px 12px rgba(80,50,160,.10);}
.lp-arrow:hover{background:#7c3aed;color:#fff;border-color:#7c3aed;}
.lp-foot{text-align:center;padding:40px 20px 56px;}
.lp-foot-t{font-size:24px;font-weight:800;}
.lp-foot-t .grad{background:linear-gradient(120deg,#7c3aed,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent;}
.lp-foot-s{margin-top:8px;font-size:13.5px;color:#6a6482;}
`;
function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("lp-css")) return;
  const s = document.createElement("style");
  s.id = "lp-css";
  s.textContent = LP_CSS;
  document.head.appendChild(s);
}

// Inviz 워드마크(회사 로고 근사) — 그라디언트 스월 마크 + 텍스트
function InvizLogo() {
  return (
    <svg width="30" height="30" viewBox="0 0 48 48" aria-hidden style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="ivz" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5a3c" /><stop offset=".5" stopColor="#a855f7" /><stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <path fill="url(#ivz)" d="M24 3c6 7 6 12 2 17-3 4-3 8 1 12 4-5 9-6 14-4-3 7-9 11-17 11S8 35 6 27c6 1 10-1 12-5 3-5 2-11-2-16 3 0 6 .7 8 2-.6-1.9-1.4-3.6-2-5Z" />
    </svg>
  );
}

// 히어로 시각물 — 스타일라이즈드 PACS 노트북(2×2 그리드) SVG
function HeroArt() {
  return (
    <svg viewBox="0 0 620 470" width="100%" style={{ maxWidth: 620, display: "block" }} aria-hidden>
      <defs>
        <radialGradient id="hglow" cx=".5" cy=".42" r=".62">
          <stop offset="0" stopColor="#c9b6ff" stopOpacity=".55" /><stop offset="1" stopColor="#c9b6ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hbase" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#efeafc" /><stop offset="1" stopColor="#d9d0f4" />
        </linearGradient>
        <linearGradient id="hacc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c3aed" /><stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <ellipse cx="310" cy="230" rx="300" ry="180" fill="url(#hglow)" />
      {/* 노트북 화면 */}
      <rect x="108" y="44" width="404" height="266" rx="16" fill="#0d1120" stroke="#2b2f48" strokeWidth="2" />
      <rect x="120" y="56" width="380" height="242" rx="9" fill="#0a0d18" />
      {/* 상단바 */}
      <rect x="120" y="56" width="380" height="22" rx="9" fill="#161d31" />
      <circle cx="134" cy="67" r="3" fill="#ff5f57" /><circle cx="145" cy="67" r="3" fill="#febc2e" /><circle cx="156" cy="67" r="3" fill="#28c840" />
      {/* 좌측 사이드바 */}
      <rect x="120" y="78" width="52" height="220" fill="#0f1526" />
      <rect x="130" y="90" width="32" height="6" rx="3" fill="#2a3350" /><rect x="130" y="104" width="24" height="6" rx="3" fill="#232b45" />
      <rect x="130" y="118" width="30" height="6" rx="3" fill="#232b45" /><rect x="130" y="132" width="20" height="6" rx="3" fill="#232b45" />
      {/* 2×2 영상 그리드 */}
      {[[176, 82], [340, 82], [176, 192], [340, 192]].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="156" height="102" rx="4" fill="#05070d" stroke="#1a2035" />
          {i === 0 ? (
            /* 흉부 X-ray — 갈비뼈 아치 + 척추 */
            <g stroke="#8fa0c8" strokeWidth="1.4" fill="none" opacity=".85">
              <line x1={x + 78} y1={y + 14} x2={x + 78} y2={y + 92} stroke="#6b7aa0" />
              {[20, 34, 48, 62].map((o, k) => (
                <g key={k}>
                  <path d={`M${x + 74} ${y + o} Q${x + 40} ${y + o + 6} ${x + 30} ${y + o + 26}`} />
                  <path d={`M${x + 82} ${y + o} Q${x + 116} ${y + o + 6} ${x + 126} ${y + o + 26}`} />
                </g>
              ))}
            </g>
          ) : (
            /* 뇌 MRI — 동심 타원 + 주름 */
            <g stroke="#93a3cc" strokeWidth="1.3" fill="none" opacity=".8">
              <ellipse cx={x + 78} cy={y + 51} rx="42" ry="34" />
              <ellipse cx={x + 78} cy={y + 51} rx="28" ry="22" opacity=".7" />
              <path d={`M${x + 56} ${y + 44} q10 -8 22 0 t22 0`} opacity=".6" />
              <path d={`M${x + 56} ${y + 58} q10 8 22 0 t22 0`} opacity=".6" />
              <circle cx={x + 78} cy={y + 51} r="3" fill="#a855f7" stroke="none" />
            </g>
          )}
        </g>
      ))}
      {/* 노트북 받침(데크) */}
      <path d="M64 310 H556 L590 344 H30 Z" fill="url(#hbase)" stroke="#cabfec" strokeWidth="1.5" />
      <rect x="30" y="342" width="560" height="9" rx="4" fill="#cdc3ee" />
      <rect x="272" y="312" width="76" height="7" rx="3" fill="#c3b7e6" />
      {/* 떠다니는 강조 점 */}
      <circle className="lp-dot" cx="556" cy="120" r="11" fill="#ff6a3d" style={{ animationDelay: "0s" }} />
      <circle className="lp-dot" cx="70" cy="250" r="9" fill="#8b5cf6" style={{ animationDelay: ".8s" }} />
      <circle className="lp-dot" cx="524" cy="290" r="7" fill="#ec4899" style={{ animationDelay: "1.6s" }} />
      <circle className="lp-dot" cx="96" cy="90" r="6" fill="#6366f1" style={{ animationDelay: "2.2s" }} />
    </svg>
  );
}

export function Landing({ onSignup, onAdminLogin, onClientLogin }: {
  onSignup: () => void; onAdminLogin: () => void; onClientLogin: () => void;
}) {
  ensureCss();
  const [canSignup, setCanSignup] = useState(true);
  useEffect(() => {
    api.signupEnabled().then((r) => setCanSignup(r.enabled)).catch(() => {});
  }, []);

  // ── 회전 캐러셀 — 3배 트랙(클론)으로 무한 순환, 양방향 화살표 ──
  const N = FEATURES.length;
  const STEP = 268;  // 카드 250 + gap 18
  const track = [...FEATURES, ...FEATURES, ...FEATURES];
  const [idx, setIdx] = useState(N);
  const [anim, setAnim] = useState(true);
  const [hover, setHover] = useState(false);
  const go = (d: number) => { setAnim(true); setIdx((i) => i + d); };

  useEffect(() => {
    if (hover) return;   // 마우스 올리면 자동 회전 일시정지
    const t = setInterval(() => { setAnim(true); setIdx((i) => i + 1); }, 3000);
    return () => clearInterval(t);
  }, [hover]);

  // 클론 경계 도달 → 트랜지션 종료 후 무애니로 홈 블록에 스냅(seamless 무한 순환).
  // setTimeout 기반(raf 아님) → 백그라운드/비활성 탭에서도 인덱스가 발산하지 않음.
  useEffect(() => {
    if (idx >= 2 * N || idx < N) {
      const t = setTimeout(() => { setAnim(false); setIdx((i) => (i >= 2 * N ? i - N : i + N)); }, 580);
      return () => clearTimeout(t);
    }
  }, [idx, N]);
  useEffect(() => {   // 스냅 직후 애니 재활성
    if (!anim) { const t = setTimeout(() => setAnim(true), 40); return () => clearTimeout(t); }
  }, [anim]);

  return (
    <div className="lp">
      <nav className="lp-nav">
        <a className="lp-logo" href={INVIZ_URL} target="_blank" rel="noopener noreferrer" title="Inviz 홈페이지로 이동">
          <InvizLogo /> Inviz
        </a>
        <div className="lp-navbtns">
          <button className="lp-btn primary" onClick={onSignup} disabled={!canSignup}
                  title={canSignup ? "" : "현재 온라인 가입이 비활성화되어 있습니다"}>병원 가입</button>
          <button className="lp-btn" onClick={onClientLogin}>Client 뷰어 접속</button>
          <button className="lp-btn" onClick={onAdminLogin}>관리자 로그인</button>
        </div>
      </nav>

      <section className="lp-hero">
        <div>
          <span className="lp-badge">✨ AI로 연결된 스마트 Web PACS Platform</span>
          <h1 className="lp-title">Saintview <span className="grad">PACS AI</span></h1>
          <p className="lp-sub">
            웹 기반 PACS + AI 판독 보조 플랫폼 —<br />
            DICOM 수신 · 보관 · 조회와 Structured Report 초안 생성을 하나로
          </p>
          {!canSignup && (
            <div style={{ fontSize: 12.5, color: "#a1435a", marginTop: 12 }}>
              현재 온라인 가입이 비활성화되어 있습니다 — 관리자에게 문의하세요.
            </div>
          )}
        </div>
        <div className="lp-hero-art">
          <HeroArt />
        </div>
      </section>

      <div className="lp-sec-title" />
      <div className="lp-carousel" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <button className="lp-arrow" onClick={() => go(-1)} aria-label="이전">‹</button>
        <div className="lp-viewport">
          <div className="lp-track"
               style={{ transform: `translateX(${-idx * STEP}px)`, transition: anim ? "transform .55s ease" : "none" }}>
            {track.map((f, i) => (
              <div className="lp-card" key={i}>
                <div className="lp-card-ic">{f.icon}</div>
                <div className="lp-card-t">{f.title}</div>
                <div className="lp-card-d">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <button className="lp-arrow" onClick={() => go(1)} aria-label="다음">›</button>
      </div>

      <footer className="lp-foot">
        <div className="lp-foot-t">Smarter Workflow, <span className="grad">Better Care</span></div>
        <div className="lp-foot-s">Saintview PACS AI는 의료진의 더 나은 진단과 효율적인 워크플로우를 지원합니다.</div>
      </footer>
    </div>
  );
}
