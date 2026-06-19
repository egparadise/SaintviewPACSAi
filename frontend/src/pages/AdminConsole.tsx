// 관리자 콘솔 — 로그인 후 메인 페이지(좌측 트리 메뉴 + 우측 내용)
// 구조도: 서버 Storage/Database · 등록 병원 → 병원별(정보/Client/Modality/Storage/Database)
import { useEffect, useState } from "react";
import {
  api, setToken, type ClientRow, type HospitalNetResult, type HospitalResources,
  type HospitalRow, type ServerStatusAll,
} from "../api";
import {
  HospitalsPanel, ModalityPanel, OverviewPanel, ServerPanel, StoragePanel, UsersPanel,
} from "./admin/ServerAdmin";

function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
const card: React.CSSProperties = { background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 };

// ── 서버 Database ──
function ServerDatabaseView() {
  const [st, setSt] = useState<ServerStatusAll | null>(null);
  useEffect(() => { api.serverStatusAll().then(setSt).catch(() => {}); }, []);
  const dbs = (st?.services ?? []).filter((s) => s.kind === "db" || s.kind === "appdb");
  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>🗄️ 서버 Database</div>
      <table className="grid-table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>구성</th><th>주소</th><th>상태</th></tr></thead>
        <tbody>{dbs.map((s) => (
          <tr key={s.name}><td>{s.name}</td><td><code>{s.url}</code></td>
            <td style={{ color: s.ok ? undefined : "var(--danger,#f87171)" }}>{s.ok ? "● " : "○ "}{s.detail}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── 병원 정보(편집) ──
function HospitalInfoView({ hid }: { hid: number }) {
  const [h, setH] = useState<HospitalRow | null>(null);
  const [msg, setMsg] = useState("");
  const [net, setNet] = useState<HospitalNetResult | null>(null);
  const load = () => api.hospitals().then((r) => setH(r.items.find((x) => x.id === hid) ?? null)).catch(() => {});
  useEffect(() => { load(); setNet(null); }, [hid]);
  const f = (k: keyof HospitalRow, v: unknown) => setH((p) => p ? { ...p, [k]: v } as HospitalRow : p);
  const save = async () => {
    if (!h) return;
    try { await api.updateHospital(hid, h); setMsg("저장됨"); } catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const test = async () => {
    if (!h) return;
    try { await api.updateHospital(hid, h); setNet(await api.hospitalNetTest(hid)); }
    catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const epLabel = (e: { tcp: boolean | null; echo: boolean | null; detail?: string }) =>
    e.tcp === null ? "미설정"
      : !e.tcp ? `🔴 TCP 실패 ${e.detail ? `(${e.detail})` : ""}`
        : e.echo === null ? "🟢 TCP 연결됨"
          : e.echo ? "🟢 C-ECHO 성공" : `🟠 TCP OK · C-ECHO 실패 ${e.detail ? `(${e.detail})` : ""}`;
  if (!h) return <div style={card}>불러오는 중…</div>;
  const row = (label: string, node: React.ReactNode) => (
    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
      <span style={{ width: 120, color: "var(--text-secondary)" }}>{label}</span>{node}</label>
  );
  const inp: React.CSSProperties = { flex: 1, background: "var(--bg-canvas)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: 12.5 };
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>🏥 병원 정보 — {h.code}</div>
      {row("병원 이름", <input style={inp} value={h.name} onChange={(e) => f("name", e.target.value)} />)}
      {row("주소", <input style={inp} value={h.address} onChange={(e) => f("address", e.target.value)} />)}
      {row("진료과", <input style={inp} value={h.departments} onChange={(e) => f("departments", e.target.value)} />)}
      {row("연락처", <input style={inp} value={h.phone} onChange={(e) => f("phone", e.target.value)} />)}
      {row("Fax", <input style={inp} value={h.fax} onChange={(e) => f("fax", e.target.value)} />)}
      {row("홈페이지", <input style={inp} value={h.homepage} onChange={(e) => f("homepage", e.target.value)} />)}
      {row("License(Client 수)", <input style={{ ...inp, flex: "none", width: 90 }} type="number" min={0} value={h.license_clients} onChange={(e) => f("license_clients", Number(e.target.value))} />)}
      {row("Modality 수", <input style={{ ...inp, flex: "none", width: 90 }} type="number" min={0} value={h.modality_limit} onChange={(e) => f("modality_limit", Number(e.target.value))} />)}
      {row("데이터 격리", <input type="checkbox" checked={!!h.enforce_isolation} onChange={(e) => f("enforce_isolation", e.target.checked)} />)}

      {/* 병원별 DICOM 네트워크 — 포트는 병원마다 달라야 함 */}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>📡 DICOM 네트워크 (병원별 — 포트 상이)</div>
        {row("서버 호스트/IP", <input style={inp} value={h.server_host} onChange={(e) => f("server_host", e.target.value)} placeholder="예: 10.0.0.5 또는 pacs.hospital.kr" />)}
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", margin: "6px 0 4px" }}>① Modality 수신(SCP) — 장비가 C-STORE로 영상 전송</div>
        {row("수신 AE Title", <input style={inp} value={h.scp_aet} onChange={(e) => f("scp_aet", e.target.value)} />)}
        {row("수신 Port", <input style={{ ...inp, flex: "none", width: 110 }} type="number" value={h.scp_port} onChange={(e) => f("scp_port", Number(e.target.value))} />)}
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", margin: "6px 0 4px" }}>② Client Viewer 조회(Q/R) — 뷰어가 영상 조회/수신</div>
        {row("조회 AE Title", <input style={inp} value={h.qr_aet} onChange={(e) => f("qr_aet", e.target.value)} />)}
        {row("조회 Port", <input style={{ ...inp, flex: "none", width: 110 }} type="number" value={h.qr_port} onChange={(e) => f("qr_port", Number(e.target.value))} />)}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button onClick={test}>저장 + 연결 테스트</button>
          {net && (
            <span style={{ fontSize: 12 }}>
              수신: {epLabel(net.scp)} &nbsp;|&nbsp; 조회: {epLabel(net.qr)}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
          포트는 병원마다 자동 배정(상이)됩니다. ⚠ 단일 Orthanc는 DICOM 포트가 하나라, 실제 병원별 포트 리스닝은
          병원별 Orthanc 인스턴스 또는 DICOM 라우터 배치가 필요합니다(여기서는 구성·연결 점검).
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>🩻 검사 배정</div>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 6 }}>
          수신 AET가 등록 장비와 매칭되지 않아 병원이 비어있는(미배정) 검사를 이 병원에 귀속합니다.
          (Client 뷰어는 로그인한 병원의 검사만 표시하므로, 미배정 검사는 배정해야 보입니다.)
        </div>
        <button onClick={async () => {
          try { const r = await api.claimStudies(hid); setMsg(`미배정 검사 ${r.assigned}건을 이 병원에 배정했습니다`); }
          catch (e) { setMsg("⚠ " + (e as Error).message); }
        }}>미배정 검사 이 병원에 배정</button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="primary" onClick={save}>저장</button>
        <span style={{ fontSize: 12, color: "var(--accent,#7dd3fc)" }}>{msg}</span>
      </div>
    </div>
  );
}

// ── 병원 Client 정보 및 Setting ──
function ClientManager({ hid }: { hid: number }) {
  const [items, setItems] = useState<ClientRow[]>([]);
  const [name, setName] = useState(""); const [loc, setLoc] = useState(""); const [msg, setMsg] = useState("");
  const load = () => api.clients(hid).then((r) => setItems(r.items)).catch((e) => setMsg("⚠ " + e.message));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [hid]);
  const add = async () => {
    try { await api.createClient(hid, { name: name.trim(), location: loc.trim() }); setName(""); setLoc(""); load(); }
    catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const inp: React.CSSProperties = { background: "var(--bg-canvas)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: 12.5 };
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>👁️ Client 정보 및 Setting</div>
        <div style={{ flex: 1 }} />
        <input style={inp} placeholder="좌석 이름" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={inp} placeholder="위치" value={loc} onChange={(e) => setLoc(e.target.value)} />
        <button onClick={add} disabled={!name.trim()}>＋ 추가</button>
      </div>
      <table className="grid-table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>이름</th><th>코드</th><th>위치</th><th>접속</th><th>마지막</th><th>사용</th><th></th></tr></thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} style={{ opacity: c.enabled ? 1 : 0.5 }}>
              <td>{c.name}</td><td>{c.code}</td><td>{c.location || "—"}</td>
              <td style={{ color: c.online ? "#34d399" : "var(--text-secondary)" }}>{c.online ? "● 접속중" : "○ 대기"}</td>
              <td>{c.last_seen ? c.last_seen.replace("T", " ").slice(0, 19) : "—"}</td>
              <td><input type="checkbox" checked={c.enabled} onChange={async (e) => { await api.updateClient(hid, c.id, { name: c.name, location: c.location, enabled: e.target.checked }); load(); }} /></td>
              <td><button onClick={async () => { if (confirm(`'${c.name}' 삭제?`)) { await api.deleteClient(hid, c.id); load(); } }}>삭제</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={7} style={{ color: "var(--text-secondary)" }}>등록된 Client(좌석)가 없습니다.</td></tr>}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
        Client 뷰어는 별도 로그인(병원 ID + 개별 ID + Password)으로 접속합니다. 위 목록은 좌석 등록·접속 상태 관리입니다.
      </div>
      <Msg text={msg} />
    </div>
  );
}

// ── 병원 Storage / Database ──
function HospitalResView({ hid, kind }: { hid: number; kind: "storage" | "db" }) {
  const [r, setR] = useState<HospitalResources | null>(null);
  const load = () => api.hospitalResources(hid).then(setR).catch(() => {});
  useEffect(() => { load(); }, [hid]);
  if (!r) return <div style={card}>불러오는 중…</div>;
  if (kind === "storage") return (
    <div style={{ ...card }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>🩻 병원 Storage</div>
      <table className="grid-table" style={{ fontSize: 12.5 }}><tbody>
        <tr><td>영상 용량(추정)</td><td>{fmtBytes(r.image.bytes_estimate)}</td></tr>
        <tr><td>검사 / 시리즈 / 인스턴스</td><td>{r.image.studies} / {r.image.series} / {r.image.instances}</td></tr>
        <tr><td>전체 저장소(Orthanc)</td><td>{fmtBytes(r.image.orthanc_total_bytes)}</td></tr>
      </tbody></table>
    </div>
  );
  return (
    <div style={{ ...card }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>🗄️ 병원 Database</div>
      <table className="grid-table" style={{ fontSize: 12.5 }}><tbody>
        <tr><td>검사(studies)</td><td>{r.db.studies}</td></tr>
        <tr><td>판독(reports)</td><td>{r.db.reports}</td></tr>
        <tr><td>주석(annotations)</td><td>{r.db.annotations}</td></tr>
        <tr><td>합계 행</td><td>{r.db.studies + r.db.reports + r.db.annotations}</td></tr>
      </tbody></table>
    </div>
  );
}

function Msg({ text }: { text: string }) {
  if (!text) return null;
  return <div style={{ fontSize: 12, color: text.startsWith("⚠") ? "var(--danger,#f87171)" : "var(--accent,#7dd3fc)" }}>{text}</div>;
}

// ════════════════════════════ 콘솔 본체 ════════════════════════════
type Node = string; // server-status|server-storage|server-db|hospitals|users|overview | h:{hid}:{sub}

export function AdminConsole({ userName, isSystemAdmin, onLogout }: {
  userName: string; isSystemAdmin: boolean; onLogout: () => void;
}) {
  const [hosps, setHosps] = useState<HospitalRow[]>([]);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [sel, setSel] = useState<Node>(isSystemAdmin ? "server-status" : "hospitals");
  const loadHosps = () => api.hospitals().then((r) => setHosps(r.items)).catch(() => {});
  useEffect(() => { loadHosps(); }, []);

  const HOSP_SUB: { key: string; label: string }[] = [
    { key: "info", label: "병원 정보" },
    { key: "client", label: "Client 정보 및 Setting" },
    { key: "modality", label: "Modality 정보 및 Setting" },
    { key: "storage", label: "Storage" },
    { key: "db", label: "Database" },
  ];

  const itemStyle = (active: boolean, indent = 0): React.CSSProperties => ({
    padding: "6px 10px", paddingLeft: 10 + indent * 14, borderRadius: 4, cursor: "pointer",
    fontSize: 12.5, marginBottom: 1, background: active ? "var(--accent-subtle)" : undefined,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  });
  const Head = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", margin: "10px 0 4px 6px", textTransform: "uppercase" }}>{children}</div>
  );

  // 우측 내용
  let content: React.ReactNode = null;
  if (sel === "server-status") content = <ServerPanel />;
  else if (sel === "server-storage") content = <StoragePanel />;
  else if (sel === "server-db") content = <ServerDatabaseView />;
  else if (sel === "hospitals") content = <HospitalsPanel />;
  else if (sel === "users") content = <UsersPanel />;
  else if (sel === "overview") content = <OverviewPanel />;
  else if (sel.startsWith("h:")) {
    const [, hidStr, sub] = sel.split(":");
    const hid = Number(hidStr);
    if (sub === "info") content = <HospitalInfoView hid={hid} />;
    else if (sub === "client") content = <ClientManager hid={hid} />;
    else if (sub === "modality") content = <ModalityPanel hospitalId={hid} />;
    else if (sub === "storage") content = <HospitalResView hid={hid} kind="storage" />;
    else if (sub === "db") content = <HospitalResView hid={hid} kind="db" />;
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: 48,
                       background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 700 }}>Saintview <span style={{ color: "var(--ai,#a78bfa)" }}>PACS AI</span></span>
        <span style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>· 관리자 콘솔</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{userName}{isSystemAdmin ? " [시스템 관리자]" : " [병원 관리자]"}</span>
        <button onClick={() => { setToken(null); onLogout(); }}>로그아웃</button>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 좌측 트리 메뉴 */}
        <div style={{ width: 240, borderRight: "1px solid var(--border)", padding: 8, background: "var(--bg-canvas)", overflow: "auto", flexShrink: 0 }}>
          {isSystemAdmin && <>
            <Head>서버</Head>
            <div style={itemStyle(sel === "server-status")} onClick={() => setSel("server-status")}>🖥️ 서버 상태</div>
            <div style={itemStyle(sel === "server-storage")} onClick={() => setSel("server-storage")}>💾 서버 Storage</div>
            <div style={itemStyle(sel === "server-db")} onClick={() => setSel("server-db")}>🗄️ 서버 Database</div>
            <div style={itemStyle(sel === "overview")} onClick={() => setSel("overview")}>📊 운영 현황(감독)</div>
            <div style={itemStyle(sel === "users")} onClick={() => setSel("users")}>👤 사용자 관리</div>
          </>}

          <Head>등록 병원</Head>
          <div style={itemStyle(sel === "hospitals")} onClick={() => { setSel("hospitals"); loadHosps(); }}>＋ 병원 등록·관리</div>
          {hosps.map((h) => (
            <div key={h.id}>
              <div style={itemStyle(false, 0)} onClick={() => setOpen((p) => ({ ...p, [h.id]: !p[h.id] }))}>
                {open[h.id] ? "▾" : "▸"} 🏥 {h.name || h.code}
              </div>
              {open[h.id] && HOSP_SUB.map((s) => (
                <div key={s.key} style={itemStyle(sel === `h:${h.id}:${s.key}`, 1)} onClick={() => setSel(`h:${h.id}:${s.key}`)}>
                  {s.label}
                </div>
              ))}
            </div>
          ))}
          {hosps.length === 0 && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", padding: "4px 10px" }}>등록된 병원이 없습니다.</div>}
        </div>

        {/* 우측 내용 */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          <div style={{ maxWidth: 900 }}>{content}</div>
        </div>
      </div>
    </div>
  );
}
