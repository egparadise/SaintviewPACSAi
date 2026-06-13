// 서버 관리(Admin) 1단계 — 가입자 병원 · 계정/역할 · 등록 장비(SCU/SCP)·수신 제어
import { useEffect, useState } from "react";
import {
  api,
  type AccountRow,
  type BackupJobRow,
  type BackupPolicy,
  type HospitalRow,
  type ModalityRow,
  type RoleCatalog,
  type ScpStatus,
  type StorageOverview,
} from "../../api";

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// ── 공통 소형 UI ──
function Group({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, margin: 0 }}>
      <legend style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", padding: "0 6px", display: "flex", gap: 8, alignItems: "center" }}>
        {title}{right}
      </legend>
      {children}
    </fieldset>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
      <span style={{ width: 96, color: "var(--text-secondary)", flexShrink: 0 }}>{label}</span>
      {children}
    </label>
  );
}
const inp: React.CSSProperties = {
  flex: 1, background: "var(--bg-canvas)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 4, padding: "4px 6px", fontSize: 12.5, minWidth: 0,
};
function Msg({ text }: { text: string }) {
  if (!text) return null;
  const err = text.startsWith("⚠");
  return <div style={{ fontSize: 12, color: err ? "var(--danger, #f87171)" : "var(--accent, #7dd3fc)" }}>{text}</div>;
}

// ════════════════════════════ 병원 관리 ════════════════════════════
const EMPTY_HOSP: Partial<HospitalRow> = {
  code: "", name: "", ae_title: "", phone: "", contact: "", address: "",
  max_accounts: 0, enforce_isolation: false, enabled: true, note: "",
};
export function HospitalsPanel() {
  const [items, setItems] = useState<HospitalRow[]>([]);
  const [form, setForm] = useState<Partial<HospitalRow> | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const load = () => api.hospitals().then((r) => setItems(r.items)).catch((e) => setMsg("⚠ " + e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form) return;
    try {
      if (editId) await api.updateHospital(editId, form);
      else await api.createHospital(form);
      setForm(null); setEditId(null); setMsg("저장됨"); load();
    } catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const del = async (h: HospitalRow) => {
    if (!confirm(`병원 '${h.name || h.code}'을(를) 삭제할까요?`)) return;
    try { await api.deleteHospital(h.id); setMsg("삭제됨"); load(); }
    catch (e) { setMsg("⚠ " + (e as Error).message); }
  };

  return (
    <Group title="가입자 병원 (다기관)" right={<button onClick={() => { setForm({ ...EMPTY_HOSP }); setEditId(null); }}>＋ 추가</button>}>
      <table className="grid-table" style={{ fontSize: 12 }}>
        <thead><tr><th>코드</th><th>병원명</th><th>AET</th><th>계정</th><th>격리</th><th>사용</th><th></th></tr></thead>
        <tbody>
          {items.map((h) => (
            <tr key={h.id}>
              <td>{h.code}</td><td>{h.name}</td><td>{h.ae_title}</td>
              <td>{h.account_count ?? 0}{h.max_accounts ? `/${h.max_accounts}` : ""}</td>
              <td>{h.enforce_isolation ? "✅" : "—"}</td>
              <td>{h.enabled ? "✅" : "🚫"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => { setForm({ ...h }); setEditId(h.id); }}>수정</button>{" "}
                <button onClick={() => del(h)}>삭제</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={7} style={{ color: "var(--text-secondary)" }}>등록된 병원이 없습니다.</td></tr>}
        </tbody>
      </table>
      <Msg text={msg} />
      {form && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <b style={{ fontSize: 12 }}>{editId ? "병원 수정" : "병원 추가"}</b>
          <Field label="코드*"><input style={inp} value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="병원명"><input style={inp} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="대표 AET"><input style={inp} value={form.ae_title ?? ""} onChange={(e) => setForm({ ...form, ae_title: e.target.value })} /></Field>
          <Field label="전화"><input style={inp} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="담당자"><input style={inp} value={form.contact ?? ""} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
          <Field label="주소"><input style={inp} value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="계정 한도"><input style={{ ...inp, flex: "none", width: 80 }} type="number" min={0} value={form.max_accounts ?? 0} onChange={(e) => setForm({ ...form, max_accounts: Number(e.target.value) })} /><span style={{ fontSize: 11, color: "var(--text-secondary)" }}>0=무제한</span></Field>
          <Field label="데이터 격리"><input type="checkbox" checked={!!form.enforce_isolation} onChange={(e) => setForm({ ...form, enforce_isolation: e.target.checked })} /><span style={{ fontSize: 11, color: "var(--text-secondary)" }}>소속 계정은 자기 병원 검사만 조회</span></Field>
          <Field label="사용"><input type="checkbox" checked={form.enabled !== false} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /></Field>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={save}>{editId ? "수정 저장" : "추가"}</button>
            <button onClick={() => { setForm(null); setEditId(null); }}>취소</button>
          </div>
        </div>
      )}
    </Group>
  );
}

// ════════════════════════════ 계정/역할 ════════════════════════════
export function UsersPanel() {
  const [items, setItems] = useState<AccountRow[]>([]);
  const [hosps, setHosps] = useState<HospitalRow[]>([]);
  const [roles, setRoles] = useState<RoleCatalog | null>(null);
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const load = () => api.accounts().then((r) => setItems(r.items)).catch((e) => setMsg("⚠ " + e.message));
  useEffect(() => {
    load();
    api.hospitals().then((r) => setHosps(r.items)).catch(() => {});
    api.roleCatalog().then(setRoles).catch(() => {});
  }, []);

  const openNew = () => { setForm({ username: "", password: "", role: "radiologist", hospital_id: "", display_name: "", license_no: "", email: "", enabled: true }); setEditId(null); };
  const openEdit = (a: AccountRow) => { setForm({ role: a.role, hospital_id: a.hospital_id ?? "", display_name: a.display_name, license_no: a.license_no, email: a.email, enabled: a.enabled, password: "" }); setEditId(a.id); };

  const save = async () => {
    if (!form) return;
    const hid = form.hospital_id === "" || form.hospital_id == null ? null : Number(form.hospital_id);
    try {
      if (editId) {
        const body: Record<string, unknown> = { role: form.role, hospital_id: hid, display_name: form.display_name, license_no: form.license_no, email: form.email, enabled: form.enabled };
        if (form.password) body.password = form.password;
        await api.updateAccount(editId, body);
      } else {
        await api.createAccount({ username: String(form.username), password: String(form.password), role: String(form.role), hospital_id: hid, display_name: String(form.display_name ?? ""), license_no: String(form.license_no ?? ""), email: String(form.email ?? ""), enabled: form.enabled !== false });
      }
      setForm(null); setEditId(null); setMsg("저장됨"); load();
    } catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const del = async (a: AccountRow) => {
    if (!confirm(`계정 '${a.username}'을(를) 삭제할까요?`)) return;
    try { await api.deleteAccount(a.id); setMsg("삭제됨"); load(); }
    catch (e) { setMsg("⚠ " + (e as Error).message); }
  };

  return (
    <Group title="계정 / 역할 관리" right={<button onClick={openNew}>＋ 계정 추가</button>}>
      <table className="grid-table" style={{ fontSize: 12 }}>
        <thead><tr><th>아이디</th><th>이름</th><th>역할</th><th>병원</th><th>면허</th><th>사용</th><th></th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>{a.username}</td><td>{a.display_name}</td><td>{a.role_label}</td>
              <td>{a.hospital_name || "—"}</td><td>{a.license_no || "—"}</td>
              <td>{a.enabled ? "✅" : "🚫"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => openEdit(a)}>수정</button>{" "}
                <button onClick={() => del(a)}>삭제</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Msg text={msg} />
      {form && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <b style={{ fontSize: 12 }}>{editId ? `계정 수정` : "계정 추가"}</b>
          {!editId && <Field label="아이디*"><input style={inp} value={String(form.username ?? "")} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>}
          <Field label={editId ? "비밀번호" : "비밀번호*"}><input style={inp} type="password" placeholder={editId ? "변경 시에만 입력 (8자+)" : "8자 이상"} value={String(form.password ?? "")} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="역할">
            <select style={inp} value={String(form.role)} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {(roles?.roles ?? []).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="소속 병원">
            <select style={inp} value={String(form.hospital_id ?? "")} onChange={(e) => setForm({ ...form, hospital_id: e.target.value })}>
              <option value="">— 전역(공용) —</option>
              {hosps.map((h) => <option key={h.id} value={h.id}>{h.name || h.code}</option>)}
            </select>
          </Field>
          <Field label="표시 이름"><input style={inp} value={String(form.display_name ?? "")} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="면허번호"><input style={inp} value={String(form.license_no ?? "")} onChange={(e) => setForm({ ...form, license_no: e.target.value })} /></Field>
          <Field label="이메일"><input style={inp} value={String(form.email ?? "")} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="사용"><input type="checkbox" checked={form.enabled !== false} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /></Field>
          {form.role != null && roles && (
            <div style={{ fontSize: 11, color: "var(--text-secondary)", paddingLeft: 104 }}>
              권한: {(roles.roles.find((r) => r.key === form.role)?.perms ?? []).map((p) => roles.permissions.find((x) => x.key === p)?.label ?? p).join(" · ") || (form.role === "admin" ? "전체" : "—")}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={save}>{editId ? "수정 저장" : "추가"}</button>
            <button onClick={() => { setForm(null); setEditId(null); }}>취소</button>
          </div>
        </div>
      )}
    </Group>
  );
}

// ════════════════════════════ 등록 장비 + SCP 수신 ════════════════════════════
const MOD_TYPES = ["CT", "MR", "CR", "DX", "US", "MG", "PT", "NM", "XA", "RF", "OT"];
const EMPTY_MOD: Partial<ModalityRow> = {
  name: "", ae_title: "", host: "", port: 104, modality_type: "CT", role: "scu",
  manufacturer: "", hospital_id: null, allow_receive: true, enabled: true, note: "",
};
export function ModalityPanel() {
  const [items, setItems] = useState<ModalityRow[]>([]);
  const [hosps, setHosps] = useState<HospitalRow[]>([]);
  const [form, setForm] = useState<Partial<ModalityRow> | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [scp, setScp] = useState<ScpStatus | null>(null);
  const [msg, setMsg] = useState("");
  const load = () => api.modalities().then((r) => setItems(r.items)).catch((e) => setMsg("⚠ " + e.message));
  const loadScp = () => api.scpStatus().then(setScp).catch(() => {});
  useEffect(() => { load(); loadScp(); api.hospitals().then((r) => setHosps(r.items)).catch(() => {}); }, []);

  const save = async () => {
    if (!form) return;
    const body = { ...form, hospital_id: form.hospital_id ? Number(form.hospital_id) : null, port: Number(form.port) };
    try {
      if (editId) await api.updateModality(editId, body);
      else await api.createModality(body);
      setForm(null); setEditId(null); setMsg("저장됨"); load();
    } catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const del = async (m: ModalityRow) => {
    if (!confirm(`장비 '${m.name}'을(를) 삭제할까요?`)) return;
    try { await api.deleteModality(m.id); setMsg("삭제됨"); load(); }
    catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const apply = async () => {
    try { const r = await api.applyModalities(); setMsg(r.ok ? `Orthanc 반영: 등록 ${r.applied} · 제거 ${r.removed}${r.errors.length ? ` (오류 ${r.errors.length})` : ""}` : `⚠ ${r.detail ?? "반영 실패"}`); loadScp(); }
    catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const applyScp = async (next: { receive_enabled: boolean; registered_only: boolean; check_called_aet: boolean }) => {
    try { const r = await api.scpConfig(next); setMsg(r.note); loadScp(); }
    catch (e) { setMsg("⚠ " + (e as Error).message); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Group title="등록 장비 (SCU / SCP)" right={<>
        <button onClick={() => { setForm({ ...EMPTY_MOD }); setEditId(null); }}>＋ 추가</button>
        <button onClick={apply}>Orthanc 반영</button>
      </>}>
        <table className="grid-table" style={{ fontSize: 12 }}>
          <thead><tr><th>이름</th><th>종류</th><th>AET</th><th>IP</th><th>Port</th><th>역할</th><th>수신</th><th>병원</th><th></th></tr></thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} style={{ opacity: m.enabled ? 1 : 0.5 }}>
                <td>{m.name}</td><td>{m.modality_type}</td><td>{m.ae_title}</td><td>{m.host}</td><td>{m.port}</td>
                <td>{m.role.toUpperCase()}</td><td>{m.allow_receive ? "✅" : "🚫"}</td><td>{m.hospital_name || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => { setForm({ ...m }); setEditId(m.id); }}>수정</button>{" "}
                  <button onClick={() => del(m)}>삭제</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={9} style={{ color: "var(--text-secondary)" }}>등록된 장비가 없습니다.</td></tr>}
          </tbody>
        </table>
        <Msg text={msg} />
        {form && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <b style={{ fontSize: 12 }}>{editId ? "장비 수정" : "장비 추가"}</b>
            <Field label="이름*"><input style={inp} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="종류">
              <select style={inp} value={form.modality_type ?? "CT"} onChange={(e) => setForm({ ...form, modality_type: e.target.value })}>
                {MOD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="AE Title*"><input style={inp} value={form.ae_title ?? ""} onChange={(e) => setForm({ ...form, ae_title: e.target.value })} /></Field>
            <Field label="IP/호스트"><input style={inp} value={form.host ?? ""} onChange={(e) => setForm({ ...form, host: e.target.value })} /></Field>
            <Field label="Port*"><input style={{ ...inp, flex: "none", width: 90 }} type="number" value={form.port ?? 104} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></Field>
            <Field label="역할">
              <select style={inp} value={form.role ?? "scu"} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="scu">SCU (질의/전송)</option>
                <option value="scp">SCP (수신)</option>
                <option value="both">BOTH</option>
              </select>
            </Field>
            <Field label="제조사"><input style={inp} value={form.manufacturer ?? ""} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></Field>
            <Field label="소속 병원">
              <select style={inp} value={form.hospital_id ?? ""} onChange={(e) => setForm({ ...form, hospital_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— 전역 —</option>
                {hosps.map((h) => <option key={h.id} value={h.id}>{h.name || h.code}</option>)}
              </select>
            </Field>
            <Field label="수신 허용"><input type="checkbox" checked={form.allow_receive !== false} onChange={(e) => setForm({ ...form, allow_receive: e.target.checked })} /><span style={{ fontSize: 11, color: "var(--text-secondary)" }}>이 장비로부터 C-STORE 수신 허용</span></Field>
            <Field label="사용"><input type="checkbox" checked={form.enabled !== false} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /></Field>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={save}>{editId ? "수정 저장" : "추가"}</button>
              <button onClick={() => { setForm(null); setEditId(null); }}>취소</button>
            </div>
          </div>
        )}
      </Group>

      <Group title="SCP 수신 제어 (DICOM Receive)" right={<button onClick={loadScp}>새로고침</button>}>
        {scp ? (
          <>
            <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 3 }}>
              <div>Orthanc 수신: {scp.orthanc?.alive
                ? <b style={{ color: "var(--accent, #7dd3fc)" }}>가동 · AET {scp.orthanc.aet} · Port {scp.orthanc.dicom_port}</b>
                : <b style={{ color: "var(--danger, #f87171)" }}>연결 안 됨</b>}</div>
              <div style={{ color: "var(--text-secondary)" }}>등록 장비 {scp.modalities_total}대 · 수신 활성 {scp.modalities_active}대 · Orthanc 반영 {scp.orthanc?.registered_modalities?.length ?? 0}대</div>
            </div>
            <label style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "center" }}>
              <input type="checkbox" checked={scp.config.receive_enabled} onChange={(e) => applyScp({ ...scp.config, receive_enabled: e.target.checked })} />
              SCP 수신 포트 열기 (해제 시 DICOM 리스너 닫음)
            </label>
            <label style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "center" }}>
              <input type="checkbox" checked={scp.config.registered_only} onChange={(e) => applyScp({ ...scp.config, registered_only: e.target.checked })} />
              등록 장비만 통신 허용 (미등록 호스트/AET의 C-STORE 거부)
            </label>
            <label style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "center" }}>
              <input type="checkbox" checked={scp.config.check_called_aet} onChange={(e) => applyScp({ ...scp.config, check_called_aet: e.target.checked })} />
              Called AE Title 검증
            </label>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              장비 목록은 즉시 Orthanc에 반영됩니다. 수신 포트 개폐·등록장비 전용 정책은
              생성된 <code>deploy/orthanc-generated.json</code>을 컨테이너에 마운트 후 재기동해야 적용됩니다.
            </div>
          </>
        ) : <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>상태 확인 중…</div>}
      </Group>
    </div>
  );
}

// ════════════════════════════ 저장공간 / 백업 / 압축 ════════════════════════════
const STATUS_COLOR: Record<string, string> = {
  done: "var(--accent, #7dd3fc)", failed: "var(--danger, #f87171)",
  running: "#fbbf24", queued: "var(--text-secondary)",
};
export function StoragePanel() {
  const [ov, setOv] = useState<StorageOverview | null>(null);
  const [policy, setPolicy] = useState<BackupPolicy | null>(null);
  const [comps, setComps] = useState<{ key: string; label: string }[]>([]);
  const [jobs, setJobs] = useState<BackupJobRow[]>([]);
  const [runComp, setRunComp] = useState("");
  const [runFrom, setRunFrom] = useState("");
  const [runTo, setRunTo] = useState("");
  const [msg, setMsg] = useState("");
  const loadOv = () => api.storage().then(setOv).catch((e) => setMsg("⚠ " + e.message));
  const loadJobs = () => api.backupJobs().then((r) => setJobs(r.items)).catch(() => {});
  useEffect(() => {
    loadOv(); loadJobs();
    api.backupPolicy().then((p) => { setPolicy(p); setRunComp(p.compression); }).catch(() => {});
    api.backupCompressions().then((r) => setComps(r.items)).catch(() => {});
  }, []);

  const savePolicy = async () => {
    if (!policy) return;
    try { const p = await api.putBackupPolicy(policy); setPolicy(p); setMsg("백업 정책 저장됨"); loadOv(); }
    catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const run = async () => {
    try {
      const j = await api.runBackup({ compression: runComp, date_from: runFrom, date_to: runTo });
      setMsg(`백업 작업 #${j.id} 시작 (${j.status}) — 잠시 후 새로고침`);
      setTimeout(loadJobs, 1500);
    } catch (e) { setMsg("⚠ " + (e as Error).message); }
  };
  const purge = async () => {
    const rd = policy?.retention_days ?? 0;
    if (rd <= 0) { setMsg("⚠ 보존 기간(retention_days)을 1 이상으로 설정하세요"); return; }
    try {
      const prev = await api.purgePreview(rd);
      if (prev.count === 0) { setMsg("보존 기간 초과 검사가 없습니다"); return; }
      if (!confirm(`보존 기간 ${rd}일 초과 검사 ${prev.count}건을 영구 삭제합니다.\n(Orthanc + DB에서 제거 — 되돌릴 수 없습니다)\n먼저 백업했는지 확인하세요. 계속할까요?`)) return;
      const r = await api.purge(rd);
      setMsg(`삭제 완료: DB ${r.deleted}건 · Orthanc ${r.orthanc_removed}건`);
      loadOv();
    } catch (e) { setMsg("⚠ " + (e as Error).message); }
  };

  const o = ov?.orthanc;
  const d = ov?.disk;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Group title="저장공간 현황" right={<button onClick={loadOv}>새로고침</button>}>
        {ov ? (
          <table className="grid-table" style={{ fontSize: 12 }}>
            <tbody>
              <tr><td>DICOM 저장소(Orthanc)</td><td>{o?.alive
                ? `검사 ${o.studies ?? 0} · 시리즈 ${o.series ?? 0} · 인스턴스 ${o.instances ?? 0}`
                : <span style={{ color: "var(--danger, #f87171)" }}>연결 안 됨</span>}</td></tr>
              <tr><td>디스크 사용(압축/원본)</td><td>{o?.alive ? `${fmtBytes(o.disk_size)} / ${fmtBytes(o.uncompressed_size)}` : "—"}</td></tr>
              <tr><td>DB 검사 수</td><td>{ov.db.studies}</td></tr>
              <tr><td>백업 대상 디스크</td><td>{d?.error ? <span style={{ color: "var(--danger, #f87171)" }}>{d.error}</span>
                : `${d?.path} — 여유 ${fmtBytes(d?.free)} / 전체 ${fmtBytes(d?.total)}`}</td></tr>
              <tr><td>보존 정책 후보</td><td>{ov.retention.retention_days > 0
                ? `${ov.retention.candidate_studies}건 (${ov.retention.cutoff_date} 이전, ${ov.retention.retention_days}일)`
                : "미적용 (보존 기간 0)"}</td></tr>
            </tbody>
          </table>
        ) : <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>확인 중…</div>}
        <Msg text={msg} />
      </Group>

      <Group title="백업 정책 (스케줄·보존·압축)">
        {policy && (
          <>
            <Field label="자동 백업"><input type="checkbox" checked={policy.enabled} onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })} /><span style={{ fontSize: 11, color: "var(--text-secondary)" }}>매일 예정 시각에 스케줄 백업</span></Field>
            <Field label="예정 시각"><input style={{ ...inp, flex: "none", width: 90 }} type="time" value={policy.schedule_time} onChange={(e) => setPolicy({ ...policy, schedule_time: e.target.value })} /></Field>
            <Field label="보존 기간"><input style={{ ...inp, flex: "none", width: 80 }} type="number" min={0} value={policy.retention_days} onChange={(e) => setPolicy({ ...policy, retention_days: Number(e.target.value) })} /><span style={{ fontSize: 11, color: "var(--text-secondary)" }}>일 (0=무제한, 초과분은 수동 삭제 대상)</span></Field>
            <Field label="압축 포맷">
              <select style={inp} value={policy.compression} onChange={(e) => setPolicy({ ...policy, compression: e.target.value })}>
                {comps.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="백업 경로"><input style={inp} placeholder="비우면 backend/backup" value={policy.target_dir} onChange={(e) => setPolicy({ ...policy, target_dir: e.target.value })} /></Field>
            <div><button onClick={savePolicy}>정책 저장</button></div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              들어오는 DICOM은 원본 그대로 보관하고, 백업 시 선택한 포맷(JPEG/JPEG2000/무손실)으로 변환합니다.
              Orthanc에 압축 코덱 플러그인이 없으면 원본으로 폴백 저장하고 작업 기록에 표시합니다.
            </div>
          </>
        )}
      </Group>

      <Group title="수동 백업 실행" right={<button onClick={run}>백업 시작</button>}>
        <Field label="압축">
          <select style={inp} value={runComp} onChange={(e) => setRunComp(e.target.value)}>
            {comps.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="검사일 범위">
          <input style={{ ...inp, flex: "none", width: 110 }} placeholder="YYYYMMDD" value={runFrom} onChange={(e) => setRunFrom(e.target.value)} />
          <span>~</span>
          <input style={{ ...inp, flex: "none", width: 110 }} placeholder="YYYYMMDD" value={runTo} onChange={(e) => setRunTo(e.target.value)} />
          <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>비우면 전체</span>
        </Field>
      </Group>

      <Group title="백업 이력" right={<button onClick={loadJobs}>새로고침</button>}>
        <table className="grid-table" style={{ fontSize: 11.5 }}>
          <thead><tr><th>#</th><th>유형</th><th>상태</th><th>압축</th><th>검사</th><th>인스턴스</th><th>용량</th><th>완료</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} title={j.error}>
                <td>{j.id}</td><td>{j.kind === "scheduled" ? "스케줄" : "수동"}</td>
                <td style={{ color: STATUS_COLOR[j.status] }}>{j.status}{j.error ? " ⚠" : ""}</td>
                <td>{j.compression}</td><td>{j.study_count}</td><td>{j.instance_count}</td>
                <td>{fmtBytes(j.total_bytes)}</td>
                <td>{j.finished_at ? j.finished_at.replace("T", " ").slice(0, 19) : "—"}</td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={8} style={{ color: "var(--text-secondary)" }}>백업 이력이 없습니다.</td></tr>}
          </tbody>
        </table>
      </Group>

      <Group title="보존 정책 — 기간 초과 검사 삭제 (파괴적)">
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          백업 정책의 보존 기간({policy?.retention_days ?? 0}일)을 초과한 검사를 Orthanc·DB에서 영구 삭제합니다.
          미리보기 후 확인 절차를 거치며, 자동 삭제는 하지 않습니다.
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={async () => {
            const rd = policy?.retention_days ?? 0;
            if (rd <= 0) { setMsg("⚠ 보존 기간을 1 이상으로 설정하세요"); return; }
            try { const p = await api.purgePreview(rd); setMsg(`삭제 후보 ${p.count}건 (${rd}일 초과)`); }
            catch (e) { setMsg("⚠ " + (e as Error).message); }
          }}>미리보기</button>
          <button onClick={purge} style={{ color: "var(--danger, #f87171)" }}>초과분 삭제…</button>
        </div>
      </Group>
    </div>
  );
}
