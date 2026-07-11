// API 클라이언트 — 백엔드 FastAPI
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const OHIF_BASE = import.meta.env.VITE_OHIF_BASE ?? "http://localhost:3000";
/** 뷰어 창 베이스 — 별도 포트로 띄우려면 frontend/.env에 VITE_VIEWER_BASE=http://localhost:5176
 *  설정 후 `npm run dev:viewer`(5176)를 함께 실행. 빈값=같은 출처(포트) 사용.
 *  ⚠ 5173/5174/5175 는 포털 예약 포트(Landing/관리자/Client) — 뷰어 분리 포트로 쓰면 역할 가드와 충돌 */
export const VIEWER_BASE: string = import.meta.env.VITE_VIEWER_BASE ?? "";

/** View&Draft 동선: OHIF 뷰어를 해당 검사로 오픈 (디자인 §3.1 [A]).
 *  F-18: hangingProtocolId — 모달리티별 매핑(viewer.prefs.hanging)을 호출부에서 전달 */
export function openViewer(studyUid: string, hangingProtocolId?: string) {
  const hp = hangingProtocolId && hangingProtocolId !== "default"
    ? `&hangingProtocolId=${encodeURIComponent(hangingProtocolId)}`
    : "";
  window.open(
    `${OHIF_BASE}/viewer?StudyInstanceUIDs=${encodeURIComponent(studyUid)}${hp}`,
    "_blank",
  );
}

// 자동 로그인(UBPACS-Z §1): remember=localStorage, 아니면 sessionStorage
let token: string | null = localStorage.getItem("sv_token") ?? sessionStorage.getItem("sv_token");

// 새 창 뷰어(window.open) 토큰 인계 — sessionStorage는 탭 간 공유되지 않으므로
// opener의 전역에서 가져온다(동일 출처만 접근 가능).
declare global {
  interface Window { __svToken?: string | null }
}
if (!token && window.opener) {
  try {
    token = (window.opener as Window).__svToken ?? null;
    if (token) sessionStorage.setItem("sv_token", token);
  } catch { /* cross-origin opener — ensureToken()의 postMessage 핸드셰이크 사용 */ }
}
window.__svToken = token;

// 뷰어 창(타 포트=타 출처)의 토큰 요청에 응답 — 허용 출처만 (postMessage 핸드셰이크)
window.addEventListener("message", (e: MessageEvent) => {
  const allowed = e.origin === window.location.origin || (VIEWER_BASE && e.origin === new URL(VIEWER_BASE).origin);
  if (!allowed || !token) return;
  if ((e.data as { type?: string })?.type === "sv:req-token") {
    (e.source as Window | null)?.postMessage({ type: "sv:token", token }, e.origin);
  }
});

/** 새 창(타 출처 포함)에서 토큰 확보 — 직접 인계 실패 시 opener에 postMessage 요청 */
export function ensureToken(timeoutMs = 3000): Promise<boolean> {
  if (token) return Promise.resolve(true);
  if (!window.opener) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (ok: boolean) => { window.removeEventListener("message", onMsg); resolve(ok); };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; token?: string };
      if (d?.type === "sv:token" && d.token) {
        token = d.token;
        window.__svToken = token;
        try { sessionStorage.setItem("sv_token", token); } catch { /* 무시 */ }
        done(true);
      }
    };
    window.addEventListener("message", onMsg);
    try { (window.opener as Window).postMessage({ type: "sv:req-token" }, "*"); } catch { done(false); return; }
    setTimeout(() => done(!!token), timeoutMs);
  });
}

export function setToken(t: string | null, remember = false) {
  token = t;
  window.__svToken = t;
  sessionStorage.removeItem("sv_token");
  localStorage.removeItem("sv_token");
  if (t) (remember ? localStorage : sessionStorage).setItem("sv_token", t);
}

export function hasToken() {
  return !!token;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData(파일 업로드)는 브라우저가 multipart boundary 를 직접 설정 — Content-Type 강제 금지
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    setToken(null);
    window.location.reload();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** 레인 패널(HL7·인프라·보안) 공용 인증 fetch — 각 패널의 중복 로컬 헬퍼를 승격(동작 무변경).
 *  api 내부 req() 와 달리 401 자동 로그아웃·리로드를 하지 않는다(패널이 오류 메시지로 표시).
 *  오류 문구 형식은 패널마다 달랐으므로 fmtErr 로 기존 형식을 그대로 유지한다. */
export async function panelFetch<T>(
  path: string,
  init?: RequestInit,
  fmtErr: (status: number, statusText: string, detail?: string) => string
    = (s, st, d) => (d ? `${s} · ${d}` : `${s} ${st}`),
): Promise<T> {
  // 토큰: 메모리 우선(새 창 인계 커버), 없으면 저장소(sv_token) 조회 — 기존 패널 동작과 동일
  const t = token ?? localStorage.getItem("sv_token") ?? sessionStorage.getItem("sv_token");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail: string | undefined;
    try { detail = ((await res.json()) as { detail?: string }).detail; } catch { /* 본문 없음 */ }
    throw new Error(fmtErr(res.status, res.statusText, detail));
  }
  return res.json() as Promise<T>;
}

// ---- 타입 (백엔드 응답 1:1) ----
export interface StudyRow {
  id: number;
  study_uid: string;
  patient_key: string;
  patient_name: string;
  sex: string;
  birth_date: string;
  accession_no: string;
  study_date: string;
  study_time: string;
  modality: string;
  body_part: string;
  study_desc: string;
  status: string;
  emergency: boolean;
  has_key?: boolean;   // 키이미지 등록 검사 (F-16 — 워크리스트 🔑 표시)
  critical: boolean;
  series_count: number;
  instance_count: number;
  report_status: string | null;
  impression_preview: string;
  // DICOM 헤더 기반 확장 컬럼 (UBPACS-Z Filter Setting)
  institution: string;
  referring_physician: string;
  memo: string;
  finalized_at: string;
  department: string;
  source_aet: string;
  bookmark: boolean;
  order_name: string;
}

export interface RelatedExam {
  id: number;
  study_uid: string;
  study_date: string;
  modality: string;
  study_desc: string;
  status: string;
}

export interface StudyDetail extends StudyRow {
  clinical_info: string;
  related_exams: RelatedExam[];
}

export interface Report {
  id: number;
  study_id: number;
  version: number;
  status: string;
  sr_json: SrJson;
  narrative_text: string;
  created_by: string;
  reviewed_by: string;
  finalized_at: string | null;
  ai_model: string;
  ai_sources: { prior_report_ids?: number[] };
  diff_metrics: Record<string, unknown>;
}

export interface SrJson {
  exam: { modality: string; body_part: string; technique: string };
  comparison: { prior_study_refs: string[]; summary: string };
  findings: { organ: string; observation: string; severity: string; measurements: unknown[] }[];
  impression: { rank: number; statement: string; confidence: string; codes: string[] }[];
  recommendations: { action: string; timeframe: string }[];
  ai_meta: { caveats: string[] };
}

// ---- 호출 ----
export const api = {
  login: (username: string, password: string) =>
    req<LoginResp>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  // Client 뷰어 로그인 — 병원 ID + 개별 ID + Password
  clientLogin: (hospital_id: string, username: string, password: string) =>
    req<LoginResp>("/api/auth/client-login", {
      method: "POST",
      body: JSON.stringify({ hospital_id, username, password }),
    }),
  // 공개 서버 상태 — 홈(초기) 페이지 연동
  status: () => req<ServerStatus>("/api/status"),
  // 가입(공개) — 병원 + 초기 관리자 계정 생성
  signupEnabled: () => req<{ enabled: boolean }>("/api/signup/enabled"),
  signup: (body: SignupRequest) =>
    req<{ ok: boolean; hospital_id: number; hospital_code: string; username: string; message: string }>(
      "/api/signup", { method: "POST", body: JSON.stringify(body) }),
  adminOverview: () => req<AdminOverview>("/api/admin/overview"),
  serverStatusAll: () => req<ServerStatusAll>("/api/admin/server-status"),
  worklist: (params: Record<string, string>) => {
    // 선택한 병원(병원선택→PACS Viewer 흐름)으로 스코프
    const hid = localStorage.getItem("sv_active_hospital");
    const p = { ...params, ...(hid ? { hospital_id: hid } : {}) };
    return req<{ items: StudyRow[]; total: number }>(`/api/worklist?${new URLSearchParams(p)}`);
  },
  // 병원 선택 → 자원관리 → Client 선택 흐름
  myHospitals: () => req<MyHospitals>("/api/my/hospitals"),
  hospitalResources: (hid: number) => req<HospitalResources>(`/api/hospitals/${hid}/resources`),
  clients: (hid: number) => req<{ items: ClientRow[] }>(`/api/hospitals/${hid}/clients`),
  createClient: (hid: number, body: { name: string; location?: string; enabled?: boolean; role?: string }) =>
    req<ClientRow>(`/api/hospitals/${hid}/clients`, { method: "POST", body: JSON.stringify(body) }),
  updateClient: (hid: number, cid: number, body: { name: string; location?: string; enabled?: boolean; role?: string }) =>
    req<ClientRow>(`/api/hospitals/${hid}/clients/${cid}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteClient: (hid: number, cid: number) =>
    req<{ ok: boolean }>(`/api/hospitals/${hid}/clients/${cid}`, { method: "DELETE" }),
  enterClient: (hid: number, cid: number) =>
    req<{ ok: boolean; hospital_id: number; client_id: number; client_name: string }>(
      `/api/hospitals/${hid}/clients/${cid}/enter`, { method: "POST" }),
  clientHeartbeat: (hid: number, cid: number) =>
    req<{ ok: boolean }>(`/api/hospitals/${hid}/clients/${cid}/heartbeat`, { method: "POST" }),
  study: (id: number) => req<StudyDetail>(`/api/studies/${id}`),
  reports: (studyId: number) => req<{ items: Report[] }>(`/api/studies/${studyId}/reports`),
  analyze: (studyId: number) =>
    req<{ job_id: number }>(`/api/studies/${studyId}/analyze`, { method: "POST" }),
  updateReport: (id: number, sr_json: SrJson) =>
    req<Report>(`/api/reports/${id}`, { method: "PUT", body: JSON.stringify({ sr_json }) }),
  finalizeReport: (id: number) =>
    req<Report>(`/api/reports/${id}/finalize`, { method: "POST" }),
  batchReview: () => req<{ items: BatchCandidate[] }>("/api/batch-review"),
  batchFinalize: (report_ids: number[]) =>
    req<{ finalized: number; total: number }>("/api/reports/batch-finalize", {
      method: "POST",
      body: JSON.stringify({ report_ids }),
    }),
  suspendReport: (id: number) =>
    req<Report>(`/api/reports/${id}/suspend`, { method: "POST" }),
  confirm2Report: (id: number) =>
    req<Report>(`/api/reports/${id}/confirm2`, { method: "POST" }),
  sendSr: (reportId: number) =>
    req<{ ok: boolean; sop_instance_uid: string }>(`/api/reports/${reportId}/send-sr`, {
      method: "POST",
    }),
  getSetting: (key: string) => req<{ key: string; value: Record<string, unknown> }>(`/api/settings/${key}`),
  putSetting: (key: string, value: Record<string, unknown>, scope: "user" | "global") =>
    req<{ ok: boolean }>(`/api/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value, scope }),
    }),
  aiQuality: () => req<AiQuality>("/api/admin/ai-quality"),
  instances: (studyId: number) =>
    req<{ items: InstanceThumb[]; key_images: KeyImage[] }>(`/api/studies/${studyId}/instances`),
  setKeyImages: (studyId: number, items: KeyImage[]) =>
    req<{ ok: boolean }>(`/api/studies/${studyId}/key-images`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  sendKos: (studyId: number) =>
    req<{ ok: boolean }>(`/api/studies/${studyId}/send-kos`, { method: "POST" }),
  setPriority: (studyId: number, emergency: boolean) =>
    req<{ ok: boolean }>(`/api/studies/${studyId}/priority`, {
      method: "PUT",
      body: JSON.stringify({ emergency }),
    }),
  orthancStatus: () => req<OrthancStatus>("/api/admin/orthanc-status"),
  importDicom: (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name);
    // 선택 병원 귀속 — 병원 스코프 워크리스트에서도 Import 검사가 보이도록
    const hid = localStorage.getItem("sv_active_hospital");
    return req<{ processed: number; uploaded: number; registered: number; saved_dir?: string;
                 results: { filename: string; size: number; status: string }[] }>(
      `/api/import-dicom${hid ? `?hospital_id=${hid}` : ""}`, { method: "POST", body: fd });
  },
  seriesTree: (studyId: number) =>
    req<{ study_uid: string; series: SeriesNode[] }>(`/api/studies/${studyId}/series-tree`),
  nlQuery: (text: string) =>
    req<NlQueryResult>("/api/worklist/nl-query", { method: "POST", body: JSON.stringify({ text }) }),
  mergeReports: (study_ids: number[]) =>
    req<Report>("/api/reports/merge", { method: "POST", body: JSON.stringify({ study_ids }) }),
  annotations: (studyId: number) =>
    req<{ items: Anno[] }>(`/api/studies/${studyId}/annotations`),
  saveAnnotations: (studyId: number, items: Anno[]) =>
    req<{ ok: boolean; count: number }>(`/api/studies/${studyId}/annotations`, {
      method: "PUT", body: JSON.stringify({ items }),
    }),
  ctr: (studyId: number) =>
    req<CtrResult>(`/api/studies/${studyId}/ctr`, { method: "POST" }),
  sendGsps: (studyId: number, body: {
    images: { sop_uid: string; series_uid: string; rows: number; cols: number }[];
    annotations: Anno[]; wc?: number | null; ww?: number | null; label?: string;
  }) =>
    req<{ ok: boolean; sop_instance_uid: string }>(`/api/studies/${studyId}/send-gsps`, {
      method: "POST", body: JSON.stringify(body),
    }),
  /** GSPS 불러오기 — 검사에 귀속된 PR(타사 포함) 주석·W/L 파싱 */
  loadGsps: (studyId: number) =>
    req<{ items: GspsItem[] }>(`/api/studies/${studyId}/gsps`),
  /** ROI HU 통계(드래그 W/L·HU ROI 통계) — points는 0~1 정규화 */
  roiStats: (studyId: number, body: { sop_uid: string; kind: string; points: number[][] }) =>
    req<RoiStats>(`/api/studies/${studyId}/roi-stats`, { method: "POST", body: JSON.stringify(body) }),
  orders: (params: Record<string, string> = {}) =>
    req<{ items: OrderRow[] }>(`/api/orders?${new URLSearchParams(params)}`),
  createOrder: (body: Partial<OrderRow>) =>
    req<OrderRow>("/api/orders", { method: "POST", body: JSON.stringify(body) }),
  setOrderStatus: (id: number, status: string) =>
    req<OrderRow>(`/api/orders/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  exportMwl: () =>
    req<{ ok: boolean; count: number; dir: string }>("/api/orders/export-mwl", { method: "POST" }),
  setBookmark: (studyId: number, bookmark: boolean) =>
    req<{ ok: boolean; bookmark: boolean }>(`/api/studies/${studyId}/bookmark`, {
      method: "PUT", body: JSON.stringify({ bookmark }),
    }),
  setMemo: (studyId: number, memo: string) =>
    req<{ ok: boolean }>(`/api/studies/${studyId}/memo`, {
      method: "PUT", body: JSON.stringify({ memo }),
    }),
  phrases: () => req<{ items: PhraseRow[] }>("/api/phrases"),
  createPhrase: (body: Partial<PhraseRow>) =>
    req<PhraseRow>("/api/phrases", { method: "POST", body: JSON.stringify(body) }),
  updatePhrase: (id: number, body: Partial<PhraseRow>) =>
    req<PhraseRow>(`/api/phrases/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deletePhrase: (id: number) =>
    req<{ ok: boolean }>(`/api/phrases/${id}`, { method: "DELETE" }),
  profile: () => req<Profile>("/api/auth/profile"),
  putProfile: (display_name: string, license_no: string) =>
    req<{ ok: boolean }>("/api/auth/profile", {
      method: "PUT", body: JSON.stringify({ display_name, license_no }),
    }),
  /** 공유 폴더 목록 — sub=상대 하위경로(생략=루트). 폴더 클릭 진입 지원 */
  shareList: (sub?: string) =>
    req<{ dir: string; sub: string; items: { name: string; is_dir: boolean; size: number; mtime: number }[] }>(
      `/api/share${sub ? `?sub=${encodeURIComponent(sub)}` : ""}`),
  /** 현재 공유 디렉토리 설정 조회 — 미설정이어도 404 아님(설정 화면 초기 표시용) */
  shareConfig: () =>
    req<{ dir: string; exists: boolean }>("/api/share/config"),
  /** 서버측 폴더 탐색(관리자 전용) — path 빈값=드라이브 목록+현재 공유 디렉토리 */
  shareFs: (path?: string) =>
    req<{ path: string; parent: string | null; dirs: { name: string; path: string }[];
          exists: boolean; share_dir?: string }>(
      `/api/share/fs?path=${encodeURIComponent(path ?? "")}`),
  netPing: (ip: string, port?: number) =>
    req<{ ok: boolean; icmp: boolean; icmp_ms: number; tcp: boolean | null }>("/api/admin/net-test/ping", {
      method: "POST", body: JSON.stringify({ ip, port }),
    }),
  netEcho: (ip: string, port: number, ae_title: string) =>
    req<{ ok: boolean; detail: string }>("/api/admin/net-test/echo", {
      method: "POST", body: JSON.stringify({ ip, port, ae_title }),
    }),
  netDb: () =>
    req<{ ok: boolean; latency_ms?: number; dialect?: string; target?: string; detail?: string }>(
      "/api/admin/net-test/db", { method: "POST" }),
  applyDicomNodes: () =>
    req<{ ok: boolean; applied: number; errors: string[] }>("/api/admin/dicom-nodes/apply", {
      method: "POST",
    }),

  // ── 서버 관리 1단계: 역할·병원·계정·장비·SCP ──
  roleCatalog: () => req<RoleCatalog>("/api/admin/roles"),
  hospitals: () => req<{ items: HospitalRow[] }>("/api/admin/hospitals"),
  createHospital: (body: Partial<HospitalRow>) =>
    req<HospitalRow>("/api/admin/hospitals", { method: "POST", body: JSON.stringify(body) }),
  updateHospital: (id: number, body: Partial<HospitalRow>) =>
    req<HospitalRow>(`/api/admin/hospitals/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteHospital: (id: number) =>
    req<{ ok: boolean }>(`/api/admin/hospitals/${id}`, { method: "DELETE" }),
  hospitalNetTest: (id: number) =>
    req<HospitalNetResult>(`/api/admin/hospitals/${id}/net-test`, { method: "POST" }),
  claimStudies: (id: number) =>
    req<{ ok: boolean; assigned: number }>(`/api/admin/hospitals/${id}/claim-studies`, { method: "POST" }),

  // ── 병원별 관리 (레인 F/B 공통 계약 — 백엔드는 레인 B가 병렬 구현) ──
  /** 병원별 DB·Storage 사용량 */
  hospitalUsage: (hid: number) => req<HospitalUsage>(`/api/hospitals/${hid}/usage`),
  /** 병원별 등급 권한 매트릭스 (GET=기본값 폴백 병합) */
  permMatrix: (hid: number) => req<PermMatrixResp>(`/api/hospitals/${hid}/perm-matrix`),
  /** 병원별 권한 매트릭스 저장 (관리자 — hospital 스코프 setting 'perm.matrix') */
  putPermMatrix: (hid: number, matrix: Record<string, string[]>) =>
    req<PermMatrixResp>(`/api/hospitals/${hid}/perm-matrix`, { method: "PUT", body: JSON.stringify({ matrix }) }),
  /** 병원별 SCP Modality 노드 목록 (setting 'modality.nodes') */
  hospitalModalities: (hid: number) => req<{ items: ModalityNode[] }>(`/api/hospitals/${hid}/modalities`),
  putHospitalModalities: (hid: number, items: ModalityNode[]) =>
    req<{ items: ModalityNode[] }>(`/api/hospitals/${hid}/modalities`, { method: "PUT", body: JSON.stringify({ items }) }),
  /** 병원별 Modality 연결 테스트 (ping/echo — admin net-test 재사용, 병원 접근 가드) */
  testHospitalModality: (hid: number, body: { ip: string; port: number; ae_title?: string; mode: "ping" | "echo" }) =>
    req<ModalityTestResult>(`/api/hospitals/${hid}/modalities/test`, { method: "POST", body: JSON.stringify(body) }),
  /** 병원 SCU/식별 정보 (병원명·ae_title=Hospital 컬럼, ip/port=setting 'hospital.scu') */
  hospitalScu: (hid: number) => req<HospitalScu>(`/api/hospitals/${hid}/scu`),
  putHospitalScu: (hid: number, body: HospitalScu) =>
    req<HospitalScu>(`/api/hospitals/${hid}/scu`, { method: "PUT", body: JSON.stringify(body) }),
  /** 내 유효 권한 (병원 매트릭스 반영 — 워크리스트/뷰어 게이트용) */
  permMe: () => req<PermMe>("/api/perm/me"),
  /** 검사 관리 작업 (삭제/이동/매칭/언매칭/복제 — 유효 권한 강제, 403 시 안내) */
  studyAdminAction: (id: number, body: { action: StudyAdminActionKind; target_hid?: number; order_id?: number | string }) =>
    req<{ ok: boolean; detail?: string }>(`/api/studies/${id}/admin-action`, { method: "POST", body: JSON.stringify(body) }),
  /** 특정 병원 스코프 워크리스트 (관리 콘솔 — localStorage 선택 병원과 무관) */
  hospitalWorklist: (hid: number, params: Record<string, string> = {}) =>
    req<{ items: StudyRow[]; total: number }>(
      `/api/worklist?${new URLSearchParams({ ...params, hospital_id: String(hid) })}`),
  accounts: () => req<{ items: AccountRow[] }>("/api/admin/accounts"),
  createAccount: (body: AccountCreateBody) =>
    req<AccountRow>("/api/admin/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (id: number, body: Partial<AccountCreateBody>) =>
    req<AccountRow>(`/api/admin/accounts/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAccount: (id: number) =>
    req<{ ok: boolean }>(`/api/admin/accounts/${id}`, { method: "DELETE" }),
  modalities: () => req<{ items: ModalityRow[] }>("/api/admin/modalities"),
  createModality: (body: Partial<ModalityRow>) =>
    req<ModalityRow>("/api/admin/modalities", { method: "POST", body: JSON.stringify(body) }),
  updateModality: (id: number, body: Partial<ModalityRow>) =>
    req<ModalityRow>(`/api/admin/modalities/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteModality: (id: number) =>
    req<{ ok: boolean }>(`/api/admin/modalities/${id}`, { method: "DELETE" }),
  applyModalities: () =>
    req<{ ok: boolean; applied: number; removed: number; errors: string[]; detail?: string }>(
      "/api/admin/modalities/apply", { method: "POST" }),
  scpStatus: () => req<ScpStatus>("/api/admin/scp-status"),
  scpConfig: (body: { receive_enabled: boolean; registered_only: boolean; check_called_aet: boolean }) =>
    req<{ ok: boolean; config: ScpConfig; generated_files: string[]; note: string }>(
      "/api/admin/scp-config", { method: "POST", body: JSON.stringify(body) }),

  // ── 서버 관리 2단계: 저장공간·백업·압축 ──
  storage: () => req<StorageOverview>("/api/admin/storage"),
  backupPolicy: () => req<BackupPolicy>("/api/admin/backup/policy"),
  putBackupPolicy: (body: BackupPolicy) =>
    req<BackupPolicy>("/api/admin/backup/policy", { method: "PUT", body: JSON.stringify(body) }),
  backupCompressions: () =>
    req<{ items: { key: string; label: string }[] }>("/api/admin/backup/compressions"),
  runBackup: (body: { compression?: string; target_dir?: string; date_from?: string; date_to?: string }) =>
    req<BackupJobRow>("/api/admin/backup/run", { method: "POST", body: JSON.stringify(body) }),
  backupJobs: () => req<{ items: BackupJobRow[] }>("/api/admin/backup/jobs"),
  purgePreview: (retention_days: number) =>
    req<{ count: number; items: { id: number; study_uid: string; study_date: string; modality: string; study_desc: string }[] }>(
      "/api/admin/storage/purge-preview", { method: "POST", body: JSON.stringify({ retention_days }) }),
  purge: (retention_days: number) =>
    req<{ ok: boolean; deleted: number; orthanc_removed: number }>(
      "/api/admin/storage/purge", { method: "POST", body: JSON.stringify({ retention_days, confirm: true }) }),

  // ── 서버 유지보수 (14개 요구 — 레인 F/B 공통 계약, 백엔드는 레인 B 병렬 구현) ──
  /** 저장 공간 현황 — DB/Image/Backup 크기·디스크 여유 */
  maintStorage: () => req<MaintStorage>("/api/maintenance/storage"),
  /** 백업 정책(확장) — 반복 5종·시:분:초·quota·미러·DB백업 */
  maintBackupPolicy: () => req<MaintBackupPolicy>("/api/maintenance/backup-policy"),
  putMaintBackupPolicy: (body: MaintBackupPolicy) =>
    req<MaintBackupPolicy>("/api/maintenance/backup-policy", { method: "PUT", body: JSON.stringify(body) }),
  /** 지금 백업 실행 — kind: dicom | db | both (응답 items = 생성된 작업들) */
  maintBackupRun: (kind: "dicom" | "db" | "both") =>
    req<{ ok: boolean; detail?: string; items?: MaintBackupItem[] }>("/api/maintenance/backup-run", { method: "POST", body: JSON.stringify({ kind }) }),
  /** 백업 이력 */
  maintBackups: () => req<{ items: MaintBackupItem[] }>("/api/maintenance/backups"),
  /** 복원 — dry=true 는 복원 요약만(미리보기) */
  maintRestore: (body: { backup_id: number | string; scope: "system" | "hospital"; hid?: number; dry?: boolean }) =>
    req<MaintRestoreResult>("/api/maintenance/restore", { method: "POST", body: JSON.stringify(body) }),
  /** 데이터 지우기(파괴적) — confirm 은 반드시 'WIPE' 문자열 */
  maintWipe: (body: { scope: "hospital" | "system"; hid?: number; confirm: string }) =>
    req<{ ok: boolean; detail?: string; deleted?: number; orthanc_removed?: number }>(
      "/api/maintenance/wipe", { method: "POST", body: JSON.stringify(body) }),
  /** 시스템 미러링 실행 */
  maintMirrorRun: () =>
    req<{ ok: boolean; detail?: string; copied?: number; skipped?: number; errors?: string[] }>(
      "/api/maintenance/mirror-run", { method: "POST" }),

  // ── 서버 포털 리스너 (서버 설정 IP:Port → 실제 응답하는 리다이렉트 리스너) ──
  /** 포털 리스너 현재 상태 */
  portalStatus: () => req<PortalStatus>("/api/maintenance/portal/status"),
  /** 지정 IP:Port 에 포털 리스너 (재)기동 — 바인드 실패는 예외(400) */
  portalApply: (ip: string, port: number) =>
    req<PortalStatus & { ok: boolean; warning?: string }>(
      "/api/maintenance/portal/apply", { method: "POST", body: JSON.stringify({ ip, port }) }),
  /** 포털 리스너 중지 */
  portalStop: () =>
    req<PortalStatus & { ok: boolean }>("/api/maintenance/portal/stop", { method: "POST" }),

  // ── 서버 인사이트 (DB 구조 · 시스템 로그 · 사용량 통계) ──
  /** DB 구조(read-only introspection) — 테이블/컬럼/행수 */
  insightsDbSchema: () => req<DbSchemaResp>("/api/insights/db-schema"),
  /** 외부 DB 도구 서버측 실행 — 설정키 server.dbtool(path) */
  insightsDbToolOpen: () => req<{ ok: boolean; detail?: string }>("/api/insights/db-tool-open", { method: "POST" }),
  /** 시스템 로그 — type=event|network|dicom, 날짜·검색·병원 필터 */
  insightsLogs: (params: Record<string, string>) =>
    req<{ items: LogItem[] }>(`/api/insights/logs?${new URLSearchParams(params)}`),
  /** 사용량 통계 — group=hospital|modality|department|report_status */
  insightsStats: (params: Record<string, string>) =>
    req<StatsResp>(`/api/insights/stats?${new URLSearchParams(params)}`),

  // ── 인프라 (시스템 구조도 — InfraPanel 로컬 fetch 와 동일 계약 /api/infra/hospitals) ──
  /** 병원별 Orthanc 컨테이너 현황 — state/ports/aet (미프로비저닝=entry null → 공유 Orthanc 폴백) */
  infraHospitals: () => req<InfraHospitalsRes>("/api/infra/hospitals"),
};

// ── 인프라 타입 (시스템 구조도·InfraPanel 공통 계약) ──
export interface InfraHospitalEntry {
  container: string; url: string; dicom_port: number; web_port: number; volume: string; aet: string;
}
export interface InfraHospitalRow {
  hid: number; code: string; name: string; provisioned: boolean;
  entry: InfraHospitalEntry | null; state: string; status: string;
}
export interface InfraHospitalsRes { docker_ok: boolean; items: InfraHospitalRow[]; db_note: string }

// ── 저장공간/백업 타입 ──
export interface BackupPolicy {
  enabled: boolean;
  schedule_time: string;   // HH:MM
  retention_days: number;  // 0=무제한
  compression: string;     // backup_service.TRANSFER_SYNTAX 키
  target_dir: string;
}
export interface BackupJobRow {
  id: number;
  kind: string;            // manual | scheduled
  status: string;          // queued | running | done | failed
  compression: string;
  target_dir: string;
  date_from: string;
  date_to: string;
  study_count: number;
  instance_count: number;
  total_bytes: number;
  error: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
}
export interface StorageOverview {
  policy: BackupPolicy;
  db: { studies: number };
  orthanc: {
    alive: boolean;
    studies?: number;
    series?: number;
    instances?: number;
    disk_size?: number;
    uncompressed_size?: number;
    error?: string;
  } | null;
  disk: { path: string; total?: number; used?: number; free?: number; error?: string };
  retention: { retention_days: number; candidate_studies: number; cutoff_date?: string };
}

export interface LoginResp {
  token: string; username: string; role: string;
  hospital_id: number | null; hospital_name?: string;
}

// ── 병원 선택 / 자원관리 / Client ──
export interface MyHospital {
  id: number; code: string; name: string; departments: string;
  license_clients: number; clients: number; online_clients: number;
  studies: number; modality_limit: number;
}
export interface MyHospitals {
  items: MyHospital[]; role: string; is_admin: boolean;
}
export interface ClientRow {
  id: number; hospital_id?: number; name: string; code: string; location: string;
  enabled: boolean; online: boolean; last_seen: string | null; last_user: string;
  /** 계정 등급 — doctor|radiologist|technologist|staff (레인 B 확장, 미구현 서버는 미포함) */
  role?: string; role_label?: string;
}

// ── 병원별 관리 계약 타입 (레인 F/B 공통) ──
export interface HospitalUsage {
  db: { studies: number; reports: number; annotations: number };
  storage: { disk_mb: number; instances: number; orthanc_ok: boolean };
}
export interface PermMatrixResp {
  roles: { key: string; label: string }[];
  permissions: { key: string; label: string }[];
  matrix: Record<string, string[]>;
}
export interface ModalityNode {
  name: string; ae_title: string; ip: string; port: number; kind: "scp" | "scu";
}
export interface ModalityTestResult {
  ok: boolean; detail?: string; icmp?: boolean; icmp_ms?: number; tcp?: boolean | null;
}
export interface HospitalScu { name: string; ae_title: string; ip: string; port: number }
export interface PermMe { role: string; hospital_id: number | null; perms: string[] }
export type StudyAdminActionKind = "delete" | "move" | "match" | "unmatch" | "copy";

/* ── 유효 권한 게이트 (레인 W) — GET /api/perm/me 1회 로드·캐시 ──
 * 서버가 관리·판독 API 에서 유효 권한을 403 으로 강제하므로,
 * 프론트 게이트(버튼 비활성+툴팁)는 어디까지나 UX(사전 안내) 목적이다.
 * 로드 실패 시 null = 전 기능 허용 폴백(권한 API 미구현 서버·기존 사용자 회귀 방지). */
export const PERM_DENIED_TIP = "권한 없음 — 관리자에게 문의";
let permMePromise: Promise<PermMe | null> | null = null;
export function loadPermMe(force = false): Promise<PermMe | null> {
  if (force || !permMePromise) permMePromise = api.permMe().catch(() => null);
  return permMePromise;
}
/** me=null(미로드·실패 폴백)=허용. 그 외에는 병원 매트릭스가 반영된 perms 로 판단 */
export function hasPerm(me: PermMe | null, key: string): boolean {
  return !me || me.perms.includes(key);
}
export interface HospitalResources {
  hospital: { id: number; code: string; name: string; departments: string; address: string; phone: string };
  image: { studies: number; series: number; instances: number; bytes_estimate: number | null; orthanc_total_bytes: number | null };
  db: { studies: number; reports: number; annotations: number };
  clients: { total: number; online: number; license: number; items: ClientRow[] };
  modalities: { count: number; limit: number };
  accounts: number;
}

// ── 공개 서버 상태 ──
export interface ServerStatus {
  api: boolean;
  orthanc: boolean;
  orthanc_url: string;
  ai_mode: string;
  mpps: boolean;
  version: string;
}

// ── 메인 서버 페이지(통합 상태) ──
export interface ServiceStatus {
  name: string;
  url: string;
  kind: string;       // api | orthanc | ohif | db | appdb | mpps
  ok: boolean;
  detail: string;
  manage?: string;    // 관리 UI 링크(있으면)
}
export interface ServerStatusAll {
  services: ServiceStatus[];
  healthy: number;
  total: number;
}

// ── 가입 / 관리자 감독 타입 ──
export interface SignupRequest {
  hospital: {
    name: string; address?: string; departments?: string; phone?: string; fax?: string;
    homepage?: string; license_clients?: number; modality_limit?: number;
  };
  registrant: {
    name: string; title?: string; sex?: string; birth6?: string; phone?: string;
    mobile?: string; email?: string; username: string; password: string; password_confirm: string;
  };
  billing: { method: string; card_last4?: string };
}
export interface OverviewHospital {
  id: number; code: string; name: string; enabled: boolean; departments: string; phone: string;
  accounts: number; active_accounts: number; license_clients: number;
  modalities: number; modality_limit: number; studies: number; billing_method: string;
}
export interface AdminOverview {
  hospitals: OverviewHospital[];
  totals: { hospitals: number; accounts: number; modalities: number; studies: number; audit_logs: number };
  server: { api: boolean; orthanc: boolean; mpps: { enabled: boolean; port: number }; ai_mode: string };
}

// ── 서버 관리 타입 ──
export interface RoleCatalog {
  roles: { key: string; label: string; perms: string[] }[];
  permissions: { key: string; label: string }[];
}
export interface HospitalRow {
  id: number;
  code: string;
  name: string;
  ae_title: string;
  address: string;
  phone: string;
  fax: string;
  homepage: string;
  departments: string;
  contact: string;
  max_accounts: number;
  license_clients: number;
  modality_limit: number;
  enforce_isolation: boolean;
  enabled: boolean;
  note: string;
  account_count?: number;
  // 병원별 DICOM 네트워크
  server_host: string;
  scp_aet: string;
  scp_port: number;
  qr_aet: string;
  qr_port: number;
}
export interface EndpointTest {
  host: string; port: number; aet: string;
  tcp: boolean | null; echo: boolean | null; detail?: string;
}
export interface HospitalNetResult { scp: EndpointTest; qr: EndpointTest }
export interface AccountRow {
  id: number;
  username: string;
  role: string;
  role_label: string;
  hospital_id: number | null;
  hospital_name: string;
  display_name: string;
  license_no: string;
  email: string;
  enabled: boolean;
  last_login: string | null;
}
export interface AccountCreateBody {
  username: string;
  password: string;
  role: string;
  hospital_id: number | null;
  display_name?: string;
  license_no?: string;
  email?: string;
  enabled?: boolean;
}
export interface ModalityRow {
  id: number;
  name: string;
  ae_title: string;
  host: string;
  port: number;
  modality_type: string;
  role: string;        // scu | scp | both
  manufacturer: string;
  hospital_id: number | null;
  hospital_name: string;
  allow_receive: boolean;
  enabled: boolean;
  note: string;
}
export interface ScpConfig {
  receive_enabled: boolean;
  registered_only: boolean;
  check_called_aet: boolean;
}
export interface ScpStatus {
  config: ScpConfig;
  modalities_total: number;
  modalities_active: number;
  mpps?: { enabled: boolean; port: number; aet: string };
  orthanc: {
    alive: boolean;
    aet?: string;
    dicom_port?: number;
    registered_modalities?: string[];
  } | null;
}

/** S1 자연어 검색 — 적용 전 미리보기(explanation) 필수 */
export interface NlQueryResult {
  filter: {
    patient_id: string; patient_name: string; sex: string; modality: string;
    body_part: string; study_desc: string; status: string;
    date_from: string; date_to: string; finding: string; emergency: boolean;
  };
  explanation: string;
  source: "mock" | "live" | "live_fallback";
}

export interface InstanceNode {
  orthanc_id: string;
  sop_uid: string;
  instance_number: number;
  preview_url: string;
  rows: number;
  cols: number;
  pixel_spacing: number[];   // [row, col] mm — 없으면 []
  position: number[];        // ImagePositionPatient [x,y,z]
  orientation: number[];     // ImageOrientationPatient 6개
}

export interface SeriesNode {
  series_uid: string;
  modality: string;
  series_desc: string;
  series_number: number;
  instances: InstanceNode[];
}

/** 주석/계측 (07 A.4) — 좌표는 이미지 정규화(0~1) */
export interface Anno {
  id?: number;
  series_uid: string;
  sop_uid: string;
  kind: string;              // length|angle|rect|ellipse|arrow|text|ctr
  points: number[][];
  value?: number | null;
  unit?: string;
  text?: string;
  source?: "user" | "ai" | "external";
  confidence?: number | null;
  verified?: boolean;
}

/** GSPS 불러오기 결과 1건(PR 객체) — annotations는 source="external" */
export interface GspsItem {
  sop_instance_uid: string;
  label: string;
  creator: string;
  wc: number | null;
  ww: number | null;
  annotations: Anno[];
}

/** ROI HU 통계 결과 */
export interface RoiStats {
  count?: number;
  mean?: number;
  min?: number;
  max?: number;
  std?: number;
  unit?: string;
  area_mm2?: number | null;
  wc?: number;
  ww?: number;
  error?: string;
}

export interface CtrResult {
  ctr: number | null;
  cardiac: { x1: number; x2: number; y: number } | null;
  thoracic: { x1: number; x2: number; y: number } | null;
  confidence: number;
  note: string;
  verified: boolean;
  verify_note: string;
  source: string;
}

export interface OrderRow {
  id: number;
  patient_key: string;
  patient_name: string;      // DICOM PN: Last^First
  birth_date?: string;
  sex?: string;
  accession_no: string;
  modality: string;
  scheduled_date: string;
  scheduled_time: string;
  procedure_desc: string;
  station_aet: string;
  status: string;            // scheduled|in_progress|completed|cancelled (MPPS 매핑)
  body_part: string;
  projection: string;        // PA/AP/LAT…
  dicom_study_id: string;    // DICOM StudyID (0020,0010)
}

/** 상용구/템플릿 — DB 테이블(phrases). kind=phrase(단축키)|template, text=결론, reading_text=판독 */
export interface PhraseRow {
  id: number;
  name: string;
  text: string;
  reading_text: string;
  modality: string;
  body_part: string;
  category: string;
  shortcut: string;
  kind: "phrase" | "template";
  created_by: string;
}

/** 서버 네트워크 설정 (Setting>서버 네트워크 — 전역) */
export interface ServerNetwork {
  local_share_dir?: string;
  web?: { ip?: string; port?: number | string; name?: string; ae_title?: string };
}

export interface Profile {
  username: string;
  role: string;
  display_name: string;
  license_no: string;
}

export interface OrthancStatus {
  alive: boolean;
  url: string;
  name?: string;
  aet?: string;
  dicom_port?: number;
  version?: string;
  studies_count?: number;
  error?: string;
}

/** 비교세트 열기: OHIF는 StudyInstanceUIDs 콤마 연결로 다중 검사 비교 지원 */
export function openViewerCompare(studyUids: string[], hangingProtocolId?: string) {
  const hp = hangingProtocolId && hangingProtocolId !== "default"
    ? `&hangingProtocolId=${encodeURIComponent(hangingProtocolId)}`
    : "";
  window.open(
    `${OHIF_BASE}/viewer?StudyInstanceUIDs=${studyUids.map(encodeURIComponent).join(",")}${hp}`,
    "_blank",
  );
}

export interface InstanceThumb {
  orthanc_id: string;
  sop_uid: string;
  instance_number: number;
  preview_url: string;
}
export interface KeyImage {
  sop_uid: string;
  orthanc_id: string;
  instance_number: number;
}

export interface AiQuality {
  finalized_total: number;
  with_ai_draft: number;
  accepted_unmodified?: number;
  acceptance_rate?: number;
  avg_modified_ratio?: number;
  critical_dropped?: number;
  critical_added?: number;
}

export interface BatchCandidate {
  report_id: number;
  study_id: number;
  patient_key: string;
  patient_name: string;
  modality: string;
  study_date: string;
  study_desc: string;
  impression: string;
  confidence: string;
}

/** 음성 판독 서버 STT (Whisper 로컬/OpenAI API) — FormData라 req() 미사용 */
export async function sttTranscribe(blob: Blob): Promise<{ text: string; engine: string }> {
  const fd = new FormData();
  fd.append("audio", blob, "dictation.webm");
  const res = await fetch(`${BASE}/api/stt`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── 서버 유지보수·인사이트 타입 (레인 F/B 공통 계약) ──
export interface MaintStorage {
  db: { size_mb: number; detail?: string };
  image: { size_mb: number; instances: number; disk_free_gb: number; disk_total_gb: number };
  backup: { path: string; size_mb: number; quota_gb: number };
}
export type MaintRepeat = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
export interface MaintBackupPolicy {
  enabled: boolean;
  at: string;                 // 'HH:MM:SS'
  repeat: MaintRepeat;
  weekday?: number;           // repeat=weekly (0=월 … 6=일)
  day?: number;               // repeat=monthly/quarterly/yearly — 일(day of month)
  retention_days: number;
  format: string;             // 압축 포맷(기존 backup_service 키 유지)
  path: string;
  quota_gb?: number;          // 백업 용량 상한(GB, 0=무제한)
  mirror_path?: string;       // 시스템 미러링 대상 경로
  db_backup: boolean;         // DB 백업 포함
}
export interface MaintBackupItem {
  id: number | string; kind: string; ts: string; size_mb: number; path: string; status: string;
}
export interface MaintRestoreResult {
  ok: boolean; dry?: boolean; executed?: boolean; kind?: string;
  summary?: string;           // 사람이 읽는 한 줄 요약(백엔드 계약)
  detail?: string;
  guidance?: string;          // DB 복원 시 수동 절차 안내(자동 실행 안 함 — 우아 강등)
  prepared_file?: string;     // DB 복원 준비 파일 경로
  files_found?: number; size_mb?: number; studies?: number; instances?: number;
  uploaded?: number; failed?: number; studies_registered?: number;
}
/** 서버 포털 리다이렉트 리스너 상태 (서버 설정 IP:Port 가 실제 응답하는지) */
export interface PortalStatus {
  running: boolean;
  host: string;
  port: number;
  target: string;       // 고정 리다이렉트 대상(빈값=요청 Host 기준 랜딩 포털 추정)
  since?: number | null; // 기동 시각(epoch)
  error?: string;        // 바인드 실패 등 원인
}
export interface DbSchemaResp {
  tables: { name: string; rows: number; columns: { name: string; type: string }[] }[];
}
export interface LogItem {
  ts: string; type: string; actor: string; hospital_id: number | null; action: string;
  detail: Record<string, unknown>;  // 백엔드는 객체(dict)로 반환 — 표시 시 문자열화 필요
}
export interface StatsRow { key: string; label: string; studies: number; reports: number; unreported: number }
export interface StatsResp { group: string; rows: StatsRow[] }
/** 가입 환경 설정 필드 정의 — settings 키 signup.fields.hospital|client|modality */
export interface SignupFieldDef { key: string; label: string; enabled: boolean; required: boolean }
export interface SignupFieldsCfg { fields: SignupFieldDef[] }
/** AI 등록 항목 — settings 키 ai.providers ({items:[…]}) */
export interface AiProvider {
  name: string; kind: "oss" | "api"; endpoint: string; model: string;
  api_key_ref: string; enabled: boolean; note: string;
}

/** 시스템 로그 CSV 다운로드 — 인증 헤더 필요라 fetch→blob 방식 */
export async function downloadLogsCsv(params: Record<string, string>) {
  const res = await fetch(`${BASE}/api/insights/logs.csv?${new URLSearchParams(params)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`CSV 다운로드 실패 (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `logs_${params.type ?? "all"}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 사용량 통계 Excel(.xlsx) 다운로드 — 인증 헤더 필요라 fetch→blob 방식 (downloadLogsCsv 패턴) */
export async function downloadStatsXlsx(params: Record<string, string>) {
  const res = await fetch(`${BASE}/api/insights/stats.xlsx?${new URLSearchParams(params)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Excel 다운로드 실패 (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stats_${params.group ?? "all"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 가입 필드 설정 로드(가입 화면용) — 실패/미설정=null(기존 폼 그대로).
 *  가입 화면은 무인증(공개)이므로 인증이 필요한 /api/settings 대신
 *  공개 엔드포인트 GET /api/signup/fields/{kind} 를 사용한다(빈 목록=미설정=null). */
export async function fetchSignupFields(kind: "hospital" | "client" | "modality"): Promise<SignupFieldsCfg | null> {
  try {
    const res = await fetch(`${BASE}/api/signup/fields/${kind}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { fields?: SignupFieldDef[] };
    return Array.isArray(body?.fields) && body.fields.length > 0 ? { fields: body.fields } : null;
  } catch {
    return null;
  }
}

/** PDF 다운로드 — 인증 헤더가 필요하므로 fetch→blob 방식 */
export async function downloadReportPdf(reportId: number) {
  const res = await fetch(`${BASE}/api/reports/${reportId}/export?format=pdf`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("sv_token") ?? sessionStorage.getItem("sv_token")}` },
  });
  if (!res.ok) throw new Error("PDF 생성 실패");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "report.pdf";
  a.click();
  URL.revokeObjectURL(url);
}
