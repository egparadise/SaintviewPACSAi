// 홈 — PACS 소개 및 가입 진입 (Inviz 스타일 라이트 랜딩)
// 앱은 다크 테마지만 랜딩은 자체 라이트 테마(.lp-*)로 독립 구성한다.
import { useEffect, useState } from "react";
import { api } from "../api";
import invizLogo from "../assets/inviz-logo.png";

const INVIZ_URL = "https://www.inviz.co.kr/";

const FEATURES: { icon: string; title: string; desc: string }[] = [
  { icon: "🏥", title: "멀티 병원(테넌시)", desc: "병원별 가입·계정·데이터 격리. 설정으로 자기 병원 검사만 조회." },
  { icon: "🩻", title: "DICOM 수신·뷰어", desc: "Modality(SCU/SCP) 등록 수신, 자체 2D 뷰어·OHIF·내장 MPR." },
  { icon: "🤖", title: "AI 판독 보조", desc: "구조화 Structured Report 초안 — 최종 판독은 의료인이 검토·확정." },
  { icon: "💾", title: "저장·백업·압축", desc: "저장공간 감독, 기간 백업, JPEG2000/JPEG-LS 압축, 보존 정책." },
  { icon: "📡", title: "MPPS·MWL·GSPS", desc: "수행단계 수신으로 오더 자동 갱신, 워크리스트, 타사 PR 불러오기." },
  { icon: "🛡️", title: "역할 권한", desc: "관리자·의사·영상의학과·방사선사·기타 — 권한 매트릭스." },
];

// 랜딩 전용 스타일 1회 주입(라이트 테마·키프레임 — 인라인 불가한 것)
const LP_CSS = `
.lp{min-height:100%;overflow:auto;background:
   radial-gradient(1100px 560px at 82% -8%, #ece6ff 0%, rgba(236,230,255,0) 58%),
   radial-gradient(820px 460px at -5% -5%, #f1ecff 0%, rgba(241,236,255,0) 55%),
   linear-gradient(180deg,#fdfcff 0%,#f6f3fd 100%);
   color:#181529;font-family:var(--font,system-ui,sans-serif);}
.lp-nav{display:flex;align-items:center;justify-content:space-between;padding:18px 44px;gap:16px;flex-wrap:wrap;}
.lp-logo{display:inline-flex;align-items:center;text-decoration:none;}
.lp-logo img{height:34px;width:auto;display:block;transition:opacity .15s;}
.lp-logo:hover img{opacity:.8;}
.lp-navbtns{display:flex;gap:10px;flex-wrap:wrap;}
.lp-btn{padding:10px 20px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid #e4dff2;background:#fff;color:#332a4d;transition:all .15s;white-space:nowrap;}
.lp-btn:hover{border-color:#c7bdf0;box-shadow:0 4px 12px rgba(124,58,237,.10);}
.lp-btn.primary{background:linear-gradient(135deg,#7c3aed,#9333ea);border:none;color:#fff;box-shadow:0 8px 18px rgba(124,58,237,.32);}
.lp-btn.primary:hover{filter:brightness(1.06);box-shadow:0 10px 22px rgba(124,58,237,.40);}
.lp-btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;}
.lp-hero{display:grid;grid-template-columns:1.05fr .95fr;gap:20px;align-items:center;max-width:1320px;margin:14px auto 0;padding:20px 48px 10px;}
@media(max-width:920px){.lp-hero{grid-template-columns:1fr;}.lp-hero-art{order:-1;}}
.lp-badge{display:inline-flex;align-items:center;gap:8px;background:#ece4fe;color:#6d28d9;font-size:13.5px;font-weight:700;padding:8px 16px;border-radius:999px;}
.lp-title{font-size:clamp(42px,5.6vw,74px);font-weight:900;line-height:1.03;letter-spacing:-2.5px;margin:24px 0 0;color:#12101f;}
.lp-title .grad{background:linear-gradient(110deg,#7c3aed 10%,#9333ea 55%,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent;}
.lp-sub{margin-top:22px;font-size:17px;line-height:1.7;color:#5c5672;max-width:520px;}
.lp-hero-art{position:relative;display:flex;align-items:center;justify-content:center;min-height:360px;}
.lp-dot{animation:lpFloat 5s ease-in-out infinite;transform-origin:center;}
@keyframes lpFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-13px)}}
/* 회전 캐러셀 — 전체 폭 무한 마퀴(좌↔우 끝까지 스윕). 2배 트랙 → -50% 에서 seamless 루프 */
.lp-carousel{max-width:1320px;margin:34px auto 0;padding:6px 20px;display:flex;align-items:center;gap:10px;}
.lp-marq{overflow:hidden;flex:1;padding:10px 0;
   -webkit-mask:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent);
           mask:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent);}
.lp-track{display:flex;gap:20px;width:max-content;animation:lpScroll 34s linear infinite;}
.lp-marq:hover .lp-track{animation-play-state:paused;}
@keyframes lpScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.lp-card{flex:0 0 250px;background:#fff;border:1px solid #efeafa;border-radius:16px;padding:20px;
   box-shadow:0 12px 32px rgba(80,50,160,.08);}
.lp-card-ic{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-size:23px;
   background:linear-gradient(135deg,#efe8ff,#e4d8ff);margin-bottom:14px;}
.lp-card-t{font-weight:800;font-size:15.5px;color:#201a36;}
.lp-card-d{margin-top:8px;font-size:12.8px;line-height:1.6;color:#6a6482;}
.lp-arrow{flex:0 0 auto;width:44px;height:44px;border-radius:50%;border:1px solid #e6e0f5;background:#fff;color:#7c3aed;
   font-size:22px;cursor:pointer;display:grid;place-items:center;transition:all .15s;box-shadow:0 5px 14px rgba(80,50,160,.12);}
.lp-arrow:hover{background:#7c3aed;color:#fff;border-color:#7c3aed;}
.lp-arrow.on{background:#7c3aed;color:#fff;border-color:#7c3aed;}
.lp-foot{text-align:center;padding:44px 20px 60px;}
.lp-foot-t{font-size:25px;font-weight:800;color:#231d3a;}
.lp-foot-t .grad{background:linear-gradient(110deg,#7c3aed,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent;}
.lp-foot-s{margin-top:8px;font-size:14px;color:#6a6482;}
`;
function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("lp-css")) return;
  const s = document.createElement("style");
  s.id = "lp-css"; s.textContent = LP_CSS;
  document.head.appendChild(s);
}

// 히어로 — 노트북 목업 위 다크 PACS 화면(흉부 X-ray + 뇌 MRI 2×2). 부드러운 그라디언트/글로우로 정돈.
function HeroArt() {
  const ribs = [0, 1, 2, 3, 4, 5];
  return (
    <svg viewBox="0 0 660 500" width="100%" style={{ maxWidth: 660, display: "block" }} aria-hidden>
      <defs>
        <radialGradient id="glow" cx=".52" cy=".4" r=".62">
          <stop offset="0" stopColor="#c9b6ff" stopOpacity=".5" /><stop offset="1" stopColor="#c9b6ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="deck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2eefc" /><stop offset="1" stopColor="#dcd3f4" />
        </linearGradient>
        <radialGradient id="lung" cx=".5" cy=".42" r=".7">
          <stop offset="0" stopColor="#3b4a6b" /><stop offset="1" stopColor="#0a1120" />
        </radialGradient>
        <radialGradient id="brain" cx=".5" cy=".45" r=".6">
          <stop offset="0" stopColor="#33405f" /><stop offset="1" stopColor="#0b1222" />
        </radialGradient>
        <filter id="soft"><feGaussianBlur stdDeviation=".5" /></filter>
      </defs>
      <ellipse cx="330" cy="240" rx="320" ry="190" fill="url(#glow)" />

      {/* 노트북 화면 본체 */}
      <rect x="118" y="40" width="424" height="282" rx="16" fill="#0c1020" stroke="#2a2f48" strokeWidth="2" />
      <rect x="130" y="52" width="400" height="258" rx="9" fill="#080b15" />
      {/* 상단바 */}
      <rect x="130" y="52" width="400" height="24" rx="9" fill="#151d31" />
      <circle cx="145" cy="64" r="3.4" fill="#ff5f57" /><circle cx="157" cy="64" r="3.4" fill="#febc2e" /><circle cx="169" cy="64" r="3.4" fill="#28c840" />
      <rect x="360" y="60" width="110" height="8" rx="4" fill="#26314e" />
      {/* 좌측 툴 사이드바 */}
      <rect x="130" y="76" width="46" height="234" fill="#0d1526" />
      {[92, 112, 132, 152, 172].map((y) => <rect key={y} x="142" y={y} width="22" height="10" rx="3" fill="#222c47" />)}

      {/* 좌측 대형 흉부 X-ray 패널 */}
      <g>
        <rect x="182" y="86" width="214" height="216" rx="6" fill="url(#lung)" stroke="#1b2440" />
        <g filter="url(#soft)">
          {/* 흉곽 갈비뼈(대칭 부드러운 아치) */}
          <g stroke="#aebbdd" strokeWidth="1.5" fill="none" opacity=".55" strokeLinecap="round">
            {ribs.map((k) => {
              const y = 118 + k * 22;
              return (
                <g key={k}>
                  <path d={`M287 ${y} Q236 ${y + 6} 214 ${y + 34}`} />
                  <path d={`M291 ${y} Q342 ${y + 6} 364 ${y + 34}`} />
                </g>
              );
            })}
          </g>
          {/* 쇄골 */}
          <g stroke="#c3cee9" strokeWidth="2" fill="none" opacity=".6" strokeLinecap="round">
            <path d="M289 112 Q258 104 226 116" /><path d="M289 112 Q320 104 352 116" />
          </g>
          {/* 척추 */}
          <g fill="#9fabcc" opacity=".5">
            {[0, 1, 2, 3, 4, 5, 6].map((k) => <rect key={k} x="284" y={116 + k * 22} width="10" height="14" rx="3" />)}
          </g>
          {/* 심장 음영 */}
          <ellipse cx="266" cy="238" rx="46" ry="40" fill="#8493b8" opacity=".22" />
          {/* 횡격막 */}
          <path d="M200 282 Q252 258 300 282" stroke="#9fabcc" strokeWidth="1.6" fill="none" opacity=".45" />
          <path d="M300 282 Q350 258 386 280" stroke="#9fabcc" strokeWidth="1.6" fill="none" opacity=".4" />
        </g>
      </g>

      {/* 우측 뇌 MRI 2×2 */}
      {[[406, 86], [472, 86], [406, 196], [472, 196]].map(([x, y], i) => (
        <g key={i} filter="url(#soft)">
          <rect x={x} y={y} width="58" height="104" rx="5" fill="#060a14" stroke="#182135" />
          <ellipse cx={x + 29} cy={y + 52} rx="23" ry="30" fill="url(#brain)" stroke="#8ea0cc" strokeWidth="1.2" opacity=".92" />
          <ellipse cx={x + 29} cy={y + 52} rx="14" ry="19" fill="none" stroke="#7c8db8" strokeWidth="1" opacity=".55" />
          <path d={`M${x + 18} ${y + 46} q11 -7 22 0`} stroke="#7c8db8" strokeWidth=".9" fill="none" opacity=".5" />
          <path d={`M${x + 18} ${y + 58} q11 7 22 0`} stroke="#7c8db8" strokeWidth=".9" fill="none" opacity=".5" />
          <circle cx={x + 29} cy={y + 52} r="2.4" fill={i % 2 ? "#a855f7" : "#38bdf8"} opacity=".8" />
        </g>
      ))}

      {/* 노트북 받침(플랫폼) */}
      <path d="M70 322 H590 L626 358 H34 Z" fill="url(#deck)" stroke="#cabfec" strokeWidth="1.5" />
      <rect x="34" y="356" width="592" height="10" rx="5" fill="#cdc3ee" />
      <rect x="292" y="324" width="76" height="7" rx="3" fill="#c2b6e6" />

      {/* 떠다니는 강조 점(image 1 무드) */}
      <circle className="lp-dot" cx="586" cy="120" r="12" fill="#ff6a3d" style={{ animationDelay: "0s" }} />
      <circle className="lp-dot" cx="76" cy="256" r="10" fill="#8b5cf6" style={{ animationDelay: ".7s" }} />
      <circle className="lp-dot" cx="556" cy="298" r="8" fill="#ec4899" style={{ animationDelay: "1.5s" }} />
      <circle className="lp-dot" cx="104" cy="92" r="6" fill="#6366f1" style={{ animationDelay: "2.1s" }} />
    </svg>
  );
}

export function Landing({ onSignup, onAdminLogin, onClientLogin }: {
  onSignup: () => void; onAdminLogin: () => void; onClientLogin: () => void;
}) {
  ensureCss();
  const [canSignup, setCanSignup] = useState(true);
  const [dir, setDir] = useState<"normal" | "reverse">("normal");   // 화살표: 회전 방향(좌/우)
  useEffect(() => {
    api.signupEnabled().then((r) => setCanSignup(r.enabled)).catch(() => {});
  }, []);
  const loop = [...FEATURES, ...FEATURES];   // 2배 트랙 → seamless 무한 순환

  return (
    <div className="lp">
      <nav className="lp-nav">
        <a className="lp-logo" href={INVIZ_URL} target="_blank" rel="noopener noreferrer" title="Inviz 홈페이지로 이동">
          <img src={invizLogo} alt="Inviz" />
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
        <div className="lp-hero-art"><HeroArt /></div>
      </section>

      {/* 기능 카드 — 전체 폭 자동 회전 마퀴(좌↔우 끝까지). 화살표로 방향 전환, hover 시 정지 */}
      <div className="lp-carousel">
        <button className={`lp-arrow${dir === "reverse" ? " on" : ""}`} onClick={() => setDir("reverse")} aria-label="왼쪽으로">‹</button>
        <div className="lp-marq">
          <div className="lp-track" style={{ animationDirection: dir }}>
            {loop.map((f, i) => (
              <div className="lp-card" key={i}>
                <div className="lp-card-ic">{f.icon}</div>
                <div className="lp-card-t">{f.title}</div>
                <div className="lp-card-d">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <button className={`lp-arrow${dir === "normal" ? " on" : ""}`} onClick={() => setDir("normal")} aria-label="오른쪽으로">›</button>
      </div>

      <footer className="lp-foot">
        <div className="lp-foot-t">Smarter Workflow, <span className="grad">Better Care</span></div>
        <div className="lp-foot-s">Saintview PACS AI는 의료진의 더 나은 진단과 효율적인 워크플로우를 지원합니다.</div>
      </footer>
    </div>
  );
}
