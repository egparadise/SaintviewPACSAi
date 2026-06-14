// Saintview PACS AI — 프레임 (디자인 명세 §2)
import { useState } from "react";
import "./theme.css";
import { hasToken, setToken, api } from "./api";
import { Worklist } from "./pages/Worklist";
import { SettingsModal, type SettingsScope } from "./pages/SettingsModal";
import { ViewerWindow } from "./pages/ViewerWindow";
import { ReportWindow } from "./pages/ReportWindow";
import { Landing } from "./pages/Landing";
import { Signup } from "./pages/Signup";
import { HospitalSelect } from "./pages/HospitalSelect";
import { HospitalConsole } from "./pages/HospitalConsole";
import { useEffect } from "react";
import type { MyHospital } from "./api";

// 뷰어/판독 새 창 모드 — 워크리스트 없이 전용 페이지
const _params = new URLSearchParams(window.location.search);
const IS_VIEWER_WINDOW = _params.get("viewer") === "2d";
const IS_REPORT_WINDOW = _params.get("report") === "1";
// 공개 딥링크: ?signup=1 가입, ?login=1 로그인 (미로그인 시 해당 화면으로 바로 진입)
const INITIAL_AUTH_VIEW: "landing" | "login" | "signup" =
  _params.get("signup") === "1" ? "signup" : _params.get("login") === "1" ? "login" : "landing";

function Login({ onLogin, onBack, initialUsername }: {
  onLogin: (user: string, role: string) => void; onBack?: () => void; initialUsername?: string;
}) {
  const [username, setUsername] = useState(initialUsername || "admin");
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

export default function App() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(
    hasToken()
      ? {
          name: localStorage.getItem("sv_user") ?? sessionStorage.getItem("sv_user") ?? "",
          role: localStorage.getItem("sv_role") ?? sessionStorage.getItem("sv_role") ?? "",
        }
      : null,
  );
  // 설정 스코프(단계별 분리): system(병원선택) · hospital(자원관리) · viewer(뷰어). null=닫힘
  const [settingsScope, setSettingsScope] = useState<SettingsScope | null>(null);
  // 미인증 화면 흐름: 홈(landing) → 가입(signup) / 로그인(login)
  const [authView, setAuthView] = useState<"landing" | "login" | "signup">(INITIAL_AUTH_VIEW);
  const [prefillUser, setPrefillUser] = useState("");
  // 인증 후 흐름: 병원 선택(hospitals) → 자원관리(console) → PACS Viewer(viewer)
  const [stage, setStage] = useState<"hospitals" | "console" | "viewer">("hospitals");
  const [hospital, setHospital] = useState<MyHospital | null>(null);
  const [activeClient, setActiveClient] = useState<{ id: number; name: string } | null>(null);

  // PACS Viewer 진입 중에는 Client online 유지(heartbeat)
  useEffect(() => {
    if (stage !== "viewer" || !hospital || !activeClient) return;
    const t = setInterval(() => { api.clientHeartbeat(hospital.id, activeClient.id).catch(() => {}); }, 120000);
    return () => clearInterval(t);
  }, [stage, hospital, activeClient]);

  const goHospitals = () => {
    localStorage.removeItem("sv_active_hospital");
    setHospital(null); setActiveClient(null); setStage("hospitals");
  };
  const logout = () => { setToken(null); localStorage.removeItem("sv_active_hospital"); setUser(null); goHospitals(); };

  if (!user) {
    const doLogin = (name: string, role: string) => {
      localStorage.setItem("sv_user", name);
      localStorage.setItem("sv_role", role);
      setUser({ name, role });
    };
    if (authView === "signup") {
      return (
        <Signup
          onCancel={() => setAuthView("landing")}
          onDone={(username) => { setPrefillUser(username); setAuthView("login"); }}
        />
      );
    }
    if (authView === "login") {
      return <Login onLogin={doLogin} onBack={() => setAuthView("landing")} initialUsername={prefillUser} />;
    }
    return <Landing onSignup={() => setAuthView("signup")} onLogin={() => setAuthView("login")} />;
  }

  // 뷰어/판독 새 창: 헤더 없이 전용 페이지만 (stage 무관)
  if (IS_VIEWER_WINDOW) {
    return <ViewerWindow />;
  }
  if (IS_REPORT_WINDOW) {
    return <ReportWindow />;
  }

  const settingsOverlay = settingsScope && (
    <SettingsModal role={user.role} scope={settingsScope} onClose={() => setSettingsScope(null)} />
  );

  // 1단계: 병원 선택 — 시스템 설정
  if (stage === "hospitals") {
    return (
      <>
        <HospitalSelect
          userName={user.name}
          onLogout={logout}
          onSettings={() => setSettingsScope("system")}
          onSelect={(h) => {
            localStorage.setItem("sv_active_hospital", String(h.id));
            setHospital(h); setStage("console");
          }}
        />
        {settingsOverlay}
      </>
    );
  }
  // 2단계: 병원별 자원관리 → Client 선택
  if (stage === "console" && hospital) {
    return (
      <>
        <HospitalConsole
          hospital={hospital}
          onBack={goHospitals}
          onLogout={logout}
          onSettings={() => setSettingsScope("hospital")}
          onEnterViewer={(id, name) => { setActiveClient({ id, name }); setStage("viewer"); }}
        />
        {settingsOverlay}
      </>
    );
  }
  // 3단계: PACS Viewer (선택 병원·Client 스코프)
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
          background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 40,
        }}
      >
        <span style={{ fontWeight: 700 }}>
          Saintview <span style={{ color: "var(--ai)" }}>AI</span>
        </span>
        {hospital && (
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
            🏥 {hospital.name}{activeClient ? ` · ${activeClient.name}` : ""}
          </span>
        )}
        <div
          style={{
            background: "var(--accent)", padding: "4px 16px", borderRadius: "4px 4px 0 0",
            fontWeight: 600, alignSelf: "flex-end", fontSize: 12.5,
          }}
        >
          WORKLIST 1
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setStage("console")}>← 자원관리</button>
        <button onClick={goHospitals}>병원 변경</button>
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          {user.name} [{user.role}]
        </span>
        <button onClick={() => setSettingsScope("viewer")}>설정</button>
        <button onClick={logout}>로그아웃</button>
      </header>

      {settingsOverlay}

      <main style={{ flex: 1, minHeight: 0 }}>
        <Worklist />
      </main>
    </div>
  );
}
