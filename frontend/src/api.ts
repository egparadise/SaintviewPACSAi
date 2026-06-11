// API 클라이언트 — 백엔드 FastAPI
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const OHIF_BASE = import.meta.env.VITE_OHIF_BASE ?? "http://localhost:3000";
/** 뷰어 창 베이스 — 별도 포트로 띄우려면 frontend/.env에 VITE_VIEWER_BASE=http://localhost:5174
 *  설정 후 `npm run dev:viewer`(5174)를 함께 실행. 빈값=같은 출처(포트) 사용 */
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
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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
    req<{ token: string; username: string; role: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  worklist: (params: Record<string, string>) =>
    req<{ items: StudyRow[]; total: number }>(
      `/api/worklist?${new URLSearchParams(params)}`,
    ),
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
  applyDicomNodes: () =>
    req<{ ok: boolean; applied: number; errors: string[] }>("/api/admin/dicom-nodes/apply", {
      method: "POST",
    }),
};

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
  source?: "user" | "ai";
  confidence?: number | null;
  verified?: boolean;
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

/** 상용구 — DB 테이블(phrases), Modality×BodyPart 축 + Alt+단축키 */
export interface PhraseRow {
  id: number;
  name: string;
  text: string;
  modality: string;
  body_part: string;
  category: string;
  shortcut: string;
  created_by: string;
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
