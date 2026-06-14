// 홈 — PACS 소개 및 가입 진입 (가입 흐름도: Home → 가입/로그인)
import { useEffect, useState } from "react";
import { api, type ServerStatus } from "../api";

const FEATURES = [
  ["🏥 멀티 병원(테넌시)", "병원별 가입·계정·데이터 귀속. 격리 설정으로 자기 병원 검사만 조회."],
  ["🩻 DICOM 수신·뷰어", "Modality(SCU/SCP) 등록 수신, 자체 2D 뷰어·OHIF·내장 MPR."],
  ["🤖 AI 판독 보조", "구조화 Structured Report 초안 — 최종 판독은 의료인이 검토·확정."],
  ["💾 저장·백업·압축", "저장공간 감독, 기간 백업, JPEG2000/JPEG-LS 압축, 보존 정책."],
  ["📡 MPPS·MWL·GSPS", "수행단계 수신으로 오더 자동 갱신, 워크리스트, 타사 PR 불러오기."],
  ["🔐 역할 권한", "관리자·의사·영상의학과·방사선사·기타 — 권한 매트릭스."],
];

function StatusPill({ ok, label, sub }: { ok: boolean; label: string; sub?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5,
                   background: "var(--bg-canvas)", border: "1px solid var(--border)",
                   borderRadius: 20, padding: "5px 12px" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%",
                     background: ok ? "#34d399" : "#f87171",
                     boxShadow: ok ? "0 0 6px #34d399" : "none" }} />
      <b>{label}</b>{ok ? " 정상" : " 중단"}{sub && <span style={{ color: "var(--text-secondary)" }}>· {sub}</span>}
    </span>
  );
}

export function Landing({ onSignup, onAdminLogin, onClientLogin }: {
  onSignup: () => void; onAdminLogin: () => void; onClientLogin: () => void;
}) {
  const [canSignup, setCanSignup] = useState(true);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusErr, setStatusErr] = useState(false);
  const loadStatus = () => api.status().then((s) => { setStatus(s); setStatusErr(false); })
    .catch(() => { setStatus(null); setStatusErr(true); });
  useEffect(() => {
    api.signupEnabled().then((r) => setCanSignup(r.enabled)).catch(() => {});
    loadStatus();
    const t = setInterval(loadStatus, 10000);  // 10초마다 서버 상태 갱신
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ height: "100%", overflow: "auto", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 880, width: "100%", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5 }}>
            Saintview <span style={{ color: "var(--ai, #a78bfa)" }}>PACS AI</span>
          </div>
          <div style={{ color: "var(--text-secondary)", marginTop: 8, fontSize: 14 }}>
            웹 기반 PACS + AI 판독 보조 플랫폼 — DICOM 수신·보관·조회와 Structured Report 초안 생성
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
            <button className="primary" style={{ padding: "10px 24px", fontSize: 14 }}
                    onClick={onSignup} disabled={!canSignup}
                    title={canSignup ? "" : "현재 온라인 가입이 비활성화되어 있습니다"}>
              병원 가입
            </button>
            <button style={{ padding: "10px 24px", fontSize: 14 }} onClick={onClientLogin}>Client 뷰어 접속</button>
            <button style={{ padding: "10px 24px", fontSize: 14 }} onClick={onAdminLogin}>관리자 로그인</button>
          </div>
          {!canSignup && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
              현재 온라인 가입이 비활성화되어 있습니다 — 관리자에게 문의하세요.
            </div>
          )}
          {/* 라이브 서버 상태 — 초기 페이지가 실 서버(API·DICOM)와 연동 구동 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {status ? (
              <>
                <StatusPill ok={status.api} label="API 서버" />
                <StatusPill ok={status.orthanc} label="DICOM 서버(Orthanc)" sub={status.orthanc_url} />
                <StatusPill ok={status.mpps} label="MPPS 수신" />
                <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12, color: "var(--text-secondary)",
                               border: "1px solid var(--border)", borderRadius: 20, padding: "5px 12px" }}>
                  AI {status.ai_mode} · v{status.version}
                </span>
              </>
            ) : statusErr ? (
              <StatusPill ok={false} label="API 서버" sub="연결 안 됨" />
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>서버 상태 확인 중…</span>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {FEATURES.map(([title, desc]) => (
            <div key={title} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)",
                                      borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 5, lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-secondary)" }}>
          가입 → 로그인 → 병원별 페이지(워크리스트). 가입 시 병원 정보·라이선스(Client 수)·연결 Modality 수·결재 정보를 등록합니다.
        </div>
      </div>
    </div>
  );
}
