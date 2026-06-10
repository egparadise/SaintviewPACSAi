// Saintview PACS AI — 프레임 (디자인 명세 §2)
import { useState } from "react";
import "./theme.css";
import { hasToken, setToken, api } from "./api";
import { Worklist } from "./pages/Worklist";
import { SettingsModal } from "./pages/SettingsModal";

function Login({ onLogin }: { onLogin: (user: string, role: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(localStorage.getItem("sv_remember") === "1");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.login(username, password);
      setToken(r.token, remember);
      localStorage.setItem("sv_remember", remember ? "1" : "0");
      onLogin(r.username, r.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    }
  };

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
      <form
        onSubmit={submit}
        style={{
          background: "var(--bg-panel)", padding: 32, borderRadius: 8,
          border: "1px solid var(--border)", width: 320,
          display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          Saintview <span style={{ color: "var(--ai)" }}>PACS AI</span>
        </div>
        <input placeholder="아이디" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input
          placeholder="비밀번호" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          자동 로그인 (이 PC에 유지)
        </label>
        {error && <div style={{ color: "var(--stat-emergency)", fontSize: 12 }}>{error}</div>}
        <button className="primary" type="submit">로그인</button>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(
    hasToken()
      ? {
          name: localStorage.getItem("sv_user") ?? sessionStorage.getItem("sv_user") ?? "",
          role: localStorage.getItem("sv_role") ?? sessionStorage.getItem("sv_role") ?? "",
        }
      : null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!user) {
    return (
      <Login
        onLogin={(name, role) => {
          localStorage.setItem("sv_user", name);
          localStorage.setItem("sv_role", role);
          setUser({ name, role });
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 글로벌 헤더: 워크스페이스 탭 (§2) */}
      <header
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
          background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 40,
        }}
      >
        <span style={{ fontWeight: 700 }}>
          Saintview <span style={{ color: "var(--ai)" }}>AI</span>
        </span>
        <div
          style={{
            background: "var(--accent)", padding: "4px 16px", borderRadius: "4px 4px 0 0",
            fontWeight: 600, alignSelf: "flex-end", fontSize: 12.5,
          }}
        >
          WORKLIST 1
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          {user.name} [{user.role}]
        </span>
        <button onClick={() => setSettingsOpen(true)}>설정</button>
        <button onClick={() => { setToken(null); setUser(null); }}>로그아웃</button>
      </header>

      {settingsOpen && <SettingsModal role={user.role} onClose={() => setSettingsOpen(false)} />}

      <main style={{ flex: 1, minHeight: 0 }}>
        <Worklist />
      </main>
    </div>
  );
}
