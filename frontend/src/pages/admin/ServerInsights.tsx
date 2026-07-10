// 서버 인사이트 패널(레인 F) — ⑥DB 구조 ⑦가입 환경 설정 ⑧관리자 계정 ⑨시스템 로그 ⑩사용량 통계 ⑪AI 등록
// 백엔드 계약(/api/insights/*, settings 키)은 레인 B가 병렬 구현 — 미구현 응답은 '⚠ 준비 중' 우아 처리.
import { useEffect, useState } from "react";
import {
  api, downloadLogsCsv, type AiProvider, type DbSchemaResp, type LogItem,
  type SignupFieldDef, type SignupFieldsCfg, type StatsResp,
} from "../../api";
import { UsersPanel } from "./ServerAdmin";
import { pendMsg } from "./ServerMaintenance";

// ── 공통 소형 UI (기존 관리 콘솔 다크 테마·표 스타일 유지) ──
const card: React.CSSProperties = { background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 };
const inp: React.CSSProperties = {
  background: "var(--bg-canvas)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: 12.5, minWidth: 0,
};
function Msg({ text }: { text: string }) {
  if (!text) return null;
  return <div style={{ fontSize: 12, color: text.startsWith("⚠") ? "var(--danger,#f87171)" : "var(--accent,#7dd3fc)" }}>{text}</div>;
}

// ════════════════════════════ ⑥ DB 구조 (read-only introspection + DB 도구 열기) ════════════════════════════
export function DbSchemaPanel() {
  const [schema, setSchema] = useState<DbSchemaResp | null>(null);
  const [selTable, setSelTable] = useState<string | null>(null);
  const [toolPath, setToolPath] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => {
    api.insightsDbSchema().then((r) => { setSchema(r); setMsg(""); }).catch((e) => setMsg(pendMsg(e)));
    api.getSetting("server.dbtool").then((r) => setToolPath(String((r.value as { path?: string }).path ?? ""))).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const saveTool = async () => {
    try { await api.putSetting("server.dbtool", { path: toolPath }, "global"); setMsg("DB 도구 경로 저장됨"); }
    catch (e) { setMsg(pendMsg(e)); }
  };
  const openTool = async () => {
    try { const r = await api.insightsDbToolOpen(); setMsg(r.ok ? `DB 도구 실행됨 (서버측)${r.detail ? ` — ${r.detail}` : ""}` : `⚠ ${r.detail ?? "실행 실패"}`); }
    catch (e) { setMsg(pendMsg(e)); }
  };

  const sel = schema?.tables.find((t) => t.name === selTable) ?? null;
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>🗄️ DB 구조 (읽기 전용)</div>
        <div style={{ flex: 1 }} />
        <button onClick={load}>새로고침</button>
      </div>

      {!schema ? <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{msg || "확인 중…"}</div> : (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {/* 테이블 트리 */}
          <div style={{ width: 220, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 4, maxHeight: 380, overflow: "auto" }}>
            {schema.tables.map((t) => (
              <div key={t.name} onClick={() => setSelTable(t.name)}
                   style={{ padding: "5px 10px", cursor: "pointer", fontSize: 12.5, display: "flex", justifyContent: "space-between",
                            background: selTable === t.name ? "var(--accent-subtle)" : undefined }}>
                <span>▦ {t.name}</span>
                <span style={{ color: "var(--text-secondary)", fontSize: 11.5 }}>{t.rows.toLocaleString()}행</span>
              </div>
            ))}
            {schema.tables.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "var(--text-secondary)" }}>테이블이 없습니다.</div>}
          </div>
          {/* 컬럼 상세 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {sel ? (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{sel.name} — {sel.rows.toLocaleString()}행 · 컬럼 {sel.columns.length}개</div>
                <table className="grid-table" style={{ fontSize: 12 }}>
                  <thead><tr><th>컬럼</th><th>타입</th></tr></thead>
                  <tbody>{sel.columns.map((c) => <tr key={c.name}><td>{c.name}</td><td><code style={{ fontSize: 11.5 }}>{c.type}</code></td></tr>)}</tbody>
                </table>
              </>
            ) : <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>좌측에서 테이블을 선택하면 컬럼·행수를 표시합니다.</div>}
          </div>
        </div>
      )}

      {/* DB 도구 열기 — server.dbtool(path) */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>DB 도구 경로(서버측)</span>
        <input style={{ ...inp, flex: 1, minWidth: 220 }} value={toolPath} onChange={(e) => setToolPath(e.target.value)}
               placeholder="예: C:\\Program Files\\DB Browser for SQLite\\DB Browser for SQLite.exe" />
        <button onClick={saveTool}>경로 저장</button>
        <button className="primary" onClick={openTool}>DB 도구 열기</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
        구조 조회는 읽기 전용(introspection)입니다. [DB 도구 열기]는 서버 컴퓨터에서 설정된 외부 프로그램을 실행합니다(원격 브라우저에는 표시되지 않음).
      </div>
      <Msg text={msg} />
    </div>
  );
}

// ════════════════════════════ ⑦ 가입 환경 설정 (병원/Client/Modality 입력 항목) ════════════════════════════
type SignupKind = "hospital" | "client" | "modality";
const SIGNUP_KINDS: { kind: SignupKind; title: string }[] = [
  { kind: "hospital", title: "병원 (가입 화면)" },
  { kind: "client", title: "Client (계정 발급)" },
  { kind: "modality", title: "Modality (장비 등록)" },
];
// 기본 필드 정의 — 잠금(locked) 필드는 표시 해제 불가
export const DEFAULT_SIGNUP_FIELDS: Record<SignupKind, SignupFieldDef[]> = {
  hospital: [
    { key: "name", label: "병원 이름", enabled: true, required: true },
    { key: "address", label: "주소", enabled: true, required: false },
    { key: "departments", label: "진료과", enabled: true, required: false },
    { key: "phone", label: "연락처", enabled: true, required: false },
    { key: "fax", label: "Fax", enabled: true, required: false },
    { key: "homepage", label: "홈페이지", enabled: true, required: false },
    { key: "license_clients", label: "License(Client 수)", enabled: true, required: false },
    { key: "modality_limit", label: "Modality 수", enabled: true, required: false },
  ],
  client: [
    { key: "name", label: "계정(좌석) 이름", enabled: true, required: true },
    { key: "location", label: "위치", enabled: true, required: false },
    { key: "role", label: "등급", enabled: true, required: false },
  ],
  modality: [
    { key: "name", label: "장비 이름", enabled: true, required: true },
    { key: "ae_title", label: "AE Title", enabled: true, required: true },
    { key: "host", label: "IP/호스트", enabled: true, required: false },
    { key: "port", label: "Port", enabled: true, required: false },
    { key: "modality_type", label: "종류(CT/MR…)", enabled: true, required: false },
    { key: "manufacturer", label: "제조사", enabled: true, required: false },
  ],
};
const LOCKED_FIELD_KEYS = new Set(["name", "ae_title"]); // 기본 필드 잠금

function SignupFieldsSection({ kind, title }: { kind: SignupKind; title: string }) {
  const [fields, setFields] = useState<SignupFieldDef[]>(DEFAULT_SIGNUP_FIELDS[kind]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api.getSetting(`signup.fields.${kind}`)
      .then((r) => {
        const v = r.value as unknown as SignupFieldsCfg;
        if (v && Array.isArray(v.fields) && v.fields.length > 0) setFields(v.fields);
      })
      .catch(() => {}); // 미설정=기본값 그대로
  }, [kind]);

  const edit = (i: number, patch: Partial<SignupFieldDef>) => {
    setFields((p) => p.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    setDirty(true);
  };
  const save = async () => {
    try {
      await api.putSetting(`signup.fields.${kind}`, { fields } as unknown as Record<string, unknown>, "global");
      setDirty(false); setMsg("저장됨");
    } catch (e) { setMsg(pendMsg(e)); }
  };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5 }}>{title}</div>
        <div style={{ flex: 1 }} />
        <button className="primary" onClick={save} disabled={!dirty}>저장</button>
      </div>
      <table className="grid-table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>입력 항목</th><th style={{ textAlign: "center" }}>표시</th><th style={{ textAlign: "center" }}>필수</th></tr></thead>
        <tbody>
          {fields.map((f, i) => {
            const locked = LOCKED_FIELD_KEYS.has(f.key);
            return (
              <tr key={f.key}>
                <td>{f.label} {locked && <span title="기본 필드 — 표시 해제 불가" style={{ fontSize: 11 }}>🔒</span>}</td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={f.enabled} disabled={locked}
                         onChange={(e) => edit(i, { enabled: e.target.checked, ...(e.target.checked ? {} : { required: false }) })} />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={f.required} disabled={locked || !f.enabled}
                         onChange={(e) => edit(i, { required: e.target.checked })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Msg text={msg} />
    </div>
  );
}

export function SignupFieldsPanel() {
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>📝 가입 환경 설정 — 입력 항목 (병원 / Client / Modality)</div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
        각 등록 화면에 표시할 입력 항목과 필수 여부를 설정합니다. 🔒 기본 필드는 표시 해제할 수 없습니다.
        미설정 시 화면은 기존 기본 폼을 그대로 사용합니다.
      </div>
      {SIGNUP_KINDS.map((s) => <SignupFieldsSection key={s.kind} kind={s.kind} title={s.title} />)}
    </div>
  );
}

// ════════════════════════════ ⑧ 관리자 계정 (빠른 등록 + 기존 사용자 관리) ════════════════════════════
export function AdminAccountsPanel() {
  const [f, setF] = useState({ username: "", password: "", display_name: "", email: "" });
  const [msg, setMsg] = useState("");
  const [refresh, setRefresh] = useState(0); // UsersPanel 재마운트용
  const create = async () => {
    if (!f.username.trim()) { setMsg("⚠ 아이디를 입력하세요"); return; }
    if (f.password.length < 8) { setMsg("⚠ 비밀번호는 8자 이상이어야 합니다"); return; }
    try {
      await api.createAccount({
        username: f.username.trim(), password: f.password, role: "admin", hospital_id: null,
        display_name: f.display_name, email: f.email, enabled: true,
      });
      setMsg(`관리자 계정 '${f.username.trim()}' 등록됨`);
      setF({ username: "", password: "", display_name: "", email: "" });
      setRefresh((n) => n + 1);
    } catch (e) { setMsg(pendMsg(e)); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>🛡️ 관리자 계정 등록 (전역 admin)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...inp, width: 130 }} placeholder="아이디*" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          <input style={{ ...inp, width: 150 }} type="password" placeholder="비밀번호* (8자+)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <input style={{ ...inp, width: 120 }} placeholder="표시 이름" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          <input style={{ ...inp, width: 170 }} placeholder="이메일" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <button className="primary" onClick={create}>＋ 관리자 등록</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          역할 admin · 소속 전역(공용)으로 즉시 생성합니다. 병원 소속 관리자·역할 변경 등 세부 편집은 아래 [계정/역할 관리]에서.
        </div>
        <Msg text={msg} />
      </div>
      <UsersPanel key={refresh} />
    </div>
  );
}

// ════════════════════════════ ⑨ 시스템 로그 (event/network/dicom · 기간 · 검색 · CSV) ════════════════════════════
const LOG_TYPES: { key: string; label: string }[] = [
  { key: "event", label: "이벤트" },
  { key: "network", label: "네트워크" },
  { key: "dicom", label: "DICOM" },
];
/** 로그 상세(객체) → 표시 문자열 — 백엔드 detail 은 dict(JSON) (객체를 JSX 에 직접 넣으면 React 오류) */
function fmtLogDetail(detail: Record<string, unknown> | null | undefined): string {
  if (!detail || typeof detail !== "object") return String(detail ?? "");
  const s = Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}
export function LogsPanel({ hid }: { hid?: number }) {
  const [type, setType] = useState("event");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const params = (): Record<string, string> => ({
    type,
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(hid ? { hid: String(hid) } : {}),
    limit: "300",
  });
  const load = async () => {
    setBusy(true);
    try { const r = await api.insightsLogs(params()); setItems(r.items); setMsg(""); }
    catch (e) { setItems([]); setMsg(pendMsg(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [type, hid]); // eslint-disable-line react-hooks/exhaustive-deps

  const csv = async () => {
    // CSV 는 화면 표시 한도(300)와 달리 백엔드 최대치(2000)로 받는다 — "전체는 CSV" 안내와 일치
    try { await downloadLogsCsv({ ...params(), limit: "2000" }); }
    catch (e) { setMsg(pendMsg(e)); }
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>📜 시스템 로그{hid ? " (이 병원)" : ""}</div>
        {/* type 탭 */}
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
          {LOG_TYPES.map((t) => (
            <div key={t.key} onClick={() => setType(t.key)}
                 style={{ padding: "4px 12px", fontSize: 12, cursor: "pointer",
                          background: type === t.key ? "var(--accent-subtle)" : undefined,
                          color: type === t.key ? "var(--text-primary)" : "var(--text-secondary)" }}>
              {t.label}
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <input style={{ ...inp, width: 130 }} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="시작일" />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>~</span>
        <input style={{ ...inp, width: 130 }} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="종료일" />
        <input style={{ ...inp, width: 150 }} placeholder="검색어" value={q} onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && load()} />
        <button onClick={load} disabled={busy}>{busy ? "조회 중…" : "조회"}</button>
        <button onClick={csv} title="현재 필터 조건 그대로 CSV 다운로드">CSV 다운로드</button>
      </div>
      <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
        <table className="grid-table" style={{ fontSize: 12 }}>
          <thead><tr><th>시각</th><th>종류</th><th>사용자</th>{!hid && <th>병원</th>}<th>동작</th><th>상세</th></tr></thead>
          <tbody>
            {items.map((l, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>{l.ts?.replace("T", " ").slice(0, 19)}</td>
                <td>{l.type}</td><td>{l.actor || "—"}</td>
                {!hid && <td>{l.hospital_id ?? "—"}</td>}
                <td>{l.action}</td>
                <td style={{ color: "var(--text-secondary)" }}>{fmtLogDetail(l.detail)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={hid ? 5 : 6} style={{ color: "var(--text-secondary)" }}>{busy ? "조회 중…" : "로그가 없습니다."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
        이벤트(로그인·설정·파괴 작업 감사) / 네트워크(접속·Echo) / DICOM(수신·전송) — 최대 300건 표시, 전체는 [CSV 다운로드].
      </div>
      <Msg text={msg} />
    </div>
  );
}

// ════════════════════════════ ⑩ 사용량 통계 (병원/장비/진료과/판독 · 기간 · 간이 막대) ════════════════════════════
const STAT_GROUPS: { key: string; label: string }[] = [
  { key: "hospital", label: "병원별" },
  { key: "modality", label: "장비(Modality)별" },
  { key: "department", label: "진료과별" },
  { key: "report_status", label: "판독·미판독" },
];
export function StatsPanel({ hid }: { hid?: number }) {
  const [group, setGroup] = useState(hid ? "modality" : "hospital");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<StatsResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setBusy(true);
    try {
      const r = await api.insightsStats({
        group,
        ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(dateTo ? { date_to: dateTo } : {}),
        ...(hid ? { hid: String(hid) } : {}),
      });
      setData(r); setMsg("");
    } catch (e) { setData(null); setMsg(pendMsg(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [group, hid]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows ?? [];
  const maxStudies = Math.max(1, ...rows.map((r) => r.studies));
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>📊 사용량 통계{hid ? " (이 병원)" : ""}</div>
        <select style={inp} value={group} onChange={(e) => setGroup(e.target.value)}>
          {STAT_GROUPS.filter((g) => !(hid && g.key === "hospital")).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <input style={{ ...inp, width: 130 }} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="시작일" />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>~</span>
        <input style={{ ...inp, width: 130 }} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="종료일" />
        <button onClick={load} disabled={busy}>{busy ? "조회 중…" : "조회"}</button>
      </div>
      <table className="grid-table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>구분</th><th>검사</th><th>판독</th><th>미판독</th><th style={{ width: "38%" }}>검사 수(비율)</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label || r.key}</td>
              <td>{r.studies.toLocaleString()}</td>
              <td>{r.reports.toLocaleString()}</td>
              <td style={{ color: r.unreported > 0 ? "#fbbf24" : undefined }}>{r.unreported.toLocaleString()}</td>
              <td>
                <div title={`${r.studies.toLocaleString()}건`}
                     style={{ height: 10, borderRadius: 5, background: "var(--bg-canvas)", border: "1px solid var(--border)", overflow: "hidden" }}>
                  <div style={{ width: `${(r.studies / maxStudies) * 100}%`, height: "100%", background: "var(--accent,#7dd3fc)", transition: "width .3s" }} />
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--text-secondary)" }}>{busy ? "조회 중…" : "데이터가 없습니다."}</td></tr>}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
        기간 미지정=전체. 막대는 목록 내 최대 검사 수 기준 상대 비율입니다.
      </div>
      <Msg text={msg} />
    </div>
  );
}

// ════════════════════════════ ⑪ AI 등록 항목 (오픈소스 + 상업 API — RAG 자리만들기) ════════════════════════════
const EMPTY_PROVIDER: AiProvider = { name: "", kind: "oss", endpoint: "", model: "", api_key_ref: "", enabled: true, note: "" };
export function AiProvidersPanel() {
  const [items, setItems] = useState<AiProvider[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api.getSetting("ai.providers")
      .then((r) => {
        const v = r.value as { items?: AiProvider[] };
        if (Array.isArray(v.items)) setItems(v.items);
      })
      .catch(() => {}); // 미설정=빈 목록
  }, []);

  const edit = (i: number, patch: Partial<AiProvider>) => {
    setItems((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const add = () => { setItems((p) => [...p, { ...EMPTY_PROVIDER }]); setDirty(true); };
  const del = (i: number) => {
    if (!confirm(`AI 항목 '${items[i].name || i + 1}' 삭제?`)) return;
    setItems((p) => p.filter((_, j) => j !== i));
    setDirty(true);
  };
  const save = async () => {
    try {
      await api.putSetting("ai.providers", { items } as unknown as Record<string, unknown>, "global");
      setDirty(false); setMsg("저장됨");
    } catch (e) { setMsg(pendMsg(e)); }
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>🤖 AI 등록 항목 (오픈소스 · 상업 API)</div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                       background: "var(--accent-subtle)", color: "var(--ai,#a78bfa)", border: "1px solid var(--border)" }}>
          RAG 분석 연동 — 개발 예정
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={add}>＋ 추가</button>
        <button className="primary" onClick={save} disabled={!dirty}>저장</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="grid-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>이름</th><th>종류</th><th>Endpoint</th><th>모델</th><th>키 참조</th><th>사용</th><th>비고</th><th></th></tr></thead>
          <tbody>
            {items.map((p, i) => (
              <tr key={i}>
                <td><input style={{ ...inp, width: 110 }} value={p.name} onChange={(e) => edit(i, { name: e.target.value })} /></td>
                <td>
                  <select style={{ ...inp, padding: "3px 6px" }} value={p.kind} onChange={(e) => edit(i, { kind: e.target.value as "oss" | "api" })}>
                    <option value="oss">오픈소스</option>
                    <option value="api">상업 API</option>
                  </select>
                </td>
                <td><input style={{ ...inp, width: 170 }} value={p.endpoint} onChange={(e) => edit(i, { endpoint: e.target.value })} placeholder="http://…" /></td>
                <td><input style={{ ...inp, width: 120 }} value={p.model} onChange={(e) => edit(i, { model: e.target.value })} /></td>
                <td><input style={{ ...inp, width: 110 }} value={p.api_key_ref} onChange={(e) => edit(i, { api_key_ref: e.target.value })}
                           placeholder="키 이름(참조)" title="API 키 원문이 아니라 서버 보안 저장소의 참조 이름을 입력" /></td>
                <td style={{ textAlign: "center" }}><input type="checkbox" checked={p.enabled} onChange={(e) => edit(i, { enabled: e.target.checked })} /></td>
                <td><input style={{ ...inp, width: 120 }} value={p.note} onChange={(e) => edit(i, { note: e.target.value })} /></td>
                <td><button onClick={() => del(i)}>삭제</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={8} style={{ color: "var(--text-secondary)" }}>등록된 AI 항목이 없습니다 — [＋ 추가] 후 저장하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
        ⚠ API 키 원문은 저장하지 않습니다 — [키 참조]에는 서버 보안 저장소의 키 이름만 입력하세요.
        등록 항목은 RAG 판독초안 분석 연동(개발 예정) 시 선택지로 사용됩니다.
      </div>
      <Msg text={msg} />
    </div>
  );
}
