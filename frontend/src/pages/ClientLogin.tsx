// Saintview PACS AI Client 뷰어 로그인 — 병원 ID + 개별 ID + Password (3필드)
import { useState } from "react";
import { api, setToken, type LoginResp } from "../api";

const inp: React.CSSProperties = {
  width: "100%", background: "var(--bg-canvas)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 4, padding: "8px 10px", fontSize: 13.5, boxSizing: "border-box",
};

export function ClientLogin({ onLogin, onBack }: {
  onLogin: (r: LoginResp) => void; onBack?: () => void;
}) {
  const [hospitalId, setHospitalId] = useState("SAMPLE01");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(localStorage.getItem("sv_remember") === "1");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const r = await api.clientLogin(hospitalId.trim(), username.trim(), password);
      setToken(r.token, remember);
      localStorage.setItem("sv_remember", remember ? "1" : "0");
      onLogin(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    }
  };

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
      <form onSubmit={submit} style={{ background: "var(--bg-panel)", padding: 32, borderRadius: 10,
                                       border: "1px solid var(--border)", width: 340, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>
          Saintview <span style={{ color: "var(--ai,#a78bfa)" }}>PACS AI</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: -6 }}>Client 뷰어 로그인</div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>병원 ID
          <input style={inp} placeholder="병원 코드(예: HOSP001)" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} autoFocus />
        </label>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>개별 ID
          <input style={inp} placeholder="아이디" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Password
          <input style={inp} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          자동 로그인 (이 PC에 유지)
        </label>
        {error && <div style={{ color: "var(--stat-emergency,#f87171)", fontSize: 12 }}>{error}</div>}
        <button className="primary" type="submit">PACS Viewer 로그인</button>
        {onBack && (
          <button type="button" onClick={onBack}
                  style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer" }}>
            ← 홈으로
          </button>
        )}
      </form>
    </div>
  );
}
