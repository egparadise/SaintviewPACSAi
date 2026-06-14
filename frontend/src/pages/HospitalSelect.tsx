// 로그인 후 1단계 — 병원 목록(각 병원 나타남) → 선택 (전체 로직: 병원 선택 → 자원관리 → Client)
import { useEffect, useState } from "react";
import { api, setToken, type MyHospital } from "../api";

export function HospitalSelect({ userName, onSelect, onLogout, onSettings }: {
  userName: string; onSelect: (h: MyHospital) => void; onLogout: () => void; onSettings: () => void;
}) {
  const [items, setItems] = useState<MyHospital[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.myHospitals().then((r) => { setItems(r.items); setIsAdmin(r.is_admin); })
      .catch((e) => setErr(e instanceof Error ? e.message : "병원 목록 로드 실패"));
  }, []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", height: 48,
                       background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 700 }}>Saintview <span style={{ color: "var(--ai, #a78bfa)" }}>PACS AI</span></span>
        <span style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>· 병원 선택</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{userName}{isAdmin ? " [시스템 관리자]" : ""}</span>
        {isAdmin && <button onClick={onSettings}>시스템 설정</button>}
        <button onClick={() => { setToken(null); onLogout(); }}>로그아웃</button>
      </header>

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>병원 선택</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 18 }}>
            관리할 병원을 선택하세요. 선택 후 자원관리에서 Client를 선택하면 PACS Viewer로 진입합니다.
          </div>
          {err && <div style={{ color: "#f87171", fontSize: 13 }}>{err}</div>}
          {!items ? <div style={{ color: "var(--text-secondary)" }}>불러오는 중…</div>
            : items.length === 0 ? (
              <div style={{ color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                접근 가능한 병원이 없습니다.
                {isAdmin
                  ? <button className="primary" onClick={onSettings}>설정 ▸ 병원 관리에서 병원 등록</button>
                  : "관리자에게 문의하세요."}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                {items.map((h) => (
                  <button key={h.id} onClick={() => onSelect(h)}
                          style={{ textAlign: "left", background: "var(--bg-panel)", border: "1px solid var(--border)",
                                   borderRadius: 10, padding: 16, cursor: "pointer", display: "flex",
                                   flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 22 }}>🏥</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{h.name || h.code}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{h.code}{h.departments ? ` · ${h.departments}` : ""}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text-secondary)" }}>
                      <span>👁️ Client {h.clients}{h.license_clients ? `/${h.license_clients}` : ""}</span>
                      <span style={{ color: h.online_clients > 0 ? "#34d399" : undefined }}>● 접속 {h.online_clients}</span>
                      <span>🩻 검사 {h.studies}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--accent, #7dd3fc)", marginTop: 2 }}>선택 →</div>
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
