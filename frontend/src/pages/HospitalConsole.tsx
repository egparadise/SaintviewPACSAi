// 로그인 후 2단계 — 병원별 자원관리(영상 용량·DB 용량·클라이언트·접속 상태) + Client 선택 → PACS Viewer
import { useEffect, useState } from "react";
import { api, type HospitalResources, type MyHospital } from "../api";

function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
const big: React.CSSProperties = { fontSize: 24, fontWeight: 800 };

export function HospitalConsole({ hospital, onEnterViewer, onBack, onLogout, onSettings }: {
  hospital: MyHospital;
  onEnterViewer: (clientId: number, clientName: string) => void;
  onBack: () => void; onLogout: () => void; onSettings: () => void;
}) {
  const [res, setRes] = useState<HospitalResources | null>(null);
  const [err, setErr] = useState("");
  const [newName, setNewName] = useState("");
  const load = () => api.hospitalResources(hospital.id).then(setRes)
    .catch((e) => setErr(e instanceof Error ? e.message : "자원 로드 실패"));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [hospital.id]);

  const addClient = async () => {
    try { await api.createClient(hospital.id, { name: newName.trim() }); setNewName(""); load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Client 추가 실패"); }
  };
  const enter = async (cid: number, name: string) => {
    try {
      await api.enterClient(hospital.id, cid);   // 접속 기록(online)
      onEnterViewer(cid, name);                    // PACS Viewer 진입
    } catch (e) { alert(e instanceof Error ? e.message : "진입 실패"); }
  };

  const r = res;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: 48,
                       background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
        <button onClick={onBack}>← 병원 목록</button>
        <span style={{ fontWeight: 700 }}>🏥 {hospital.name}</span>
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>· 자원관리</span>
        <div style={{ flex: 1 }} />
        <button onClick={load}>새로고침</button>
        <button onClick={onSettings}>설정</button>
        <button onClick={onLogout}>로그아웃</button>
      </header>

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {err && <div style={{ color: "#f87171" }}>{err}</div>}

          {/* 자원 카드 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Card title="🩻 서버 영상 용량(추정)">
              <div style={big}>{fmtBytes(r?.image.bytes_estimate)}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                검사 {r?.image.studies ?? 0} · 시리즈 {r?.image.series ?? 0} · 인스턴스 {r?.image.instances ?? 0}
                <br />전체 저장소 {fmtBytes(r?.image.orthanc_total_bytes)}
              </div>
            </Card>
            <Card title="🗄️ DB 용량">
              <div style={big}>{(r?.db.studies ?? 0) + (r?.db.reports ?? 0) + (r?.db.annotations ?? 0)}<span style={{ fontSize: 13, fontWeight: 400 }}> 행</span></div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                검사 {r?.db.studies ?? 0} · 판독 {r?.db.reports ?? 0} · 주석 {r?.db.annotations ?? 0}
              </div>
            </Card>
            <Card title="👁️ 클라이언트 수">
              <div style={big}>{r?.clients.total ?? 0}<span style={{ fontSize: 13, fontWeight: 400 }}>{r?.clients.license ? ` / ${r.clients.license}석` : ""}</span></div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>라이선스 {r?.clients.license || "무제한"}</div>
            </Card>
            <Card title="● 접속 상태">
              <div style={{ ...big, color: (r?.clients.online ?? 0) > 0 ? "#34d399" : undefined }}>{r?.clients.online ?? 0}<span style={{ fontSize: 13, fontWeight: 400 }}> 접속중</span></div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>장비 {r?.modalities.count ?? 0}{r?.modalities.limit ? `/${r.modalities.limit}` : ""} · 계정 {r?.accounts ?? 0}</div>
            </Card>
          </div>

          {/* Client 선택 → PACS Viewer */}
          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>Client (PACS Viewer 좌석)</div>
              <div style={{ flex: 1 }} />
              <input placeholder="새 Client 이름(예: 판독실-1)" value={newName} onChange={(e) => setNewName(e.target.value)}
                     style={{ background: "var(--bg-canvas)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: 12.5 }} />
              <button onClick={addClient} disabled={!newName.trim()}>＋ 추가</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
              Client를 선택하면 해당 좌석으로 접속해 이 병원의 PACS Viewer로 들어갑니다.
            </div>
            <table className="grid-table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>이름</th><th>코드</th><th>위치</th><th>접속</th><th>마지막 접속</th><th></th></tr></thead>
              <tbody>
                {(r?.clients.items ?? []).map((c) => (
                  <tr key={c.id} style={{ opacity: c.enabled ? 1 : 0.5 }}>
                    <td>{c.name}</td><td>{c.code}</td><td>{c.location || "—"}</td>
                    <td><span style={{ color: c.online ? "#34d399" : "var(--text-secondary)" }}>{c.online ? "● 접속중" : "○ 대기"}</span></td>
                    <td>{c.last_seen ? `${c.last_seen.replace("T", " ").slice(0, 19)}${c.last_user ? ` (${c.last_user})` : ""}` : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="primary" disabled={!c.enabled} onClick={() => enter(c.id, c.name)}>PACS Viewer 진입 →</button>{" "}
                      <button onClick={async () => { if (confirm(`Client '${c.name}' 삭제?`)) { await api.deleteClient(hospital.id, c.id); load(); } }}>삭제</button>
                    </td>
                  </tr>
                ))}
                {(r?.clients.items.length ?? 0) === 0 && (
                  <tr><td colSpan={6} style={{ color: "var(--text-secondary)" }}>
                    등록된 Client가 없습니다. 위에서 추가한 뒤 [PACS Viewer 진입]을 누르세요.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
