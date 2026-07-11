// Exam Control — 관리자용 검사 QC 화면 (레인 F, 계약 /api/examctl — 백엔드는 레인 B 병렬 구현)
// 목업 배치: 좌열 = 검사 그리드 → 선택 검사 Series 목록 → 선택 Series Image 목록
//           우열 = 선택 환자 카드 / 옮겨 갈 환자(대상 검사) 카드 / Series 썸네일 / Image 프리뷰
// 상단 버튼 5종: [Series del][Image del][Recovery][Unassign][Assign]
// 동작 모델: 삭제=소프트 삭제(휴지통→Recovery 복구) / Unassign=미배정(UNASSIGNED) 버킷 검사로 분리
//           / Assign=대상 검사로 이동(재귀속). 재배정은 앱 DB 계층 — Orthanc 원본·DICOM 태그 불변.
// 소스 어댑터(레인 F): source="server"(기본, /api/examctl) | "local"(/api/local/examctl — 워크리스트
//           Local Server 모드의 로컬 PACS local.db). 프리뷰는 server=preview_url, local=localRendered(iid) blob.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api, localRendered,
  type ExamCtlImage, type ExamCtlSeries, type ExamCtlTrashItem, type ExamCtlUids, type StudyRow,
} from "../../api";

// HospitalAdmin 과 동일한 다크 테마 카드/입력 스타일 (해당 상수는 미export — 로컬 유지)
const card: React.CSSProperties = {
  background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 12,
};
const inp: React.CSSProperties = {
  background: "var(--bg-canvas)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: 12.5, minWidth: 0,
};
const secTitle: React.CSSProperties = { fontWeight: 700, fontSize: 12.5, marginBottom: 6 };
const delRow: React.CSSProperties = { opacity: 0.45, textDecoration: "line-through" };

/** examctl 계약 미구현(레인 B 병렬) → '⚠ 준비 중' 우아 처리 (local 소스는 /api/local/examctl 안내) */
function prepMsg(e: unknown, local = false): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("404") || m.includes("Not Found"))
    return `⚠ 준비 중 — 백엔드(${local ? "/api/local/examctl" : "/api/examctl"}) 구현 대기`;
  if (m.includes("403") || m.includes("권한")) return "⚠ 권한 없음 — 관리자 권한(study.delete/match/unmatch)이 필요합니다";
  return "⚠ " + m;
}

// ── 소스 어댑터 (레인 F) — server/local 을 동형 계약으로 통일해 화면 로직은 무변경 소비 ──
/** 통일 이미지 노드 — server: preview_url 사용 / local: iid(→localRendered blob) 사용 */
type UImage = ExamCtlImage & { iid?: number };
type USeries = Omit<ExamCtlSeries, "instances"> & { instances: UImage[] };

interface ExamDataSource {
  studies: (q?: string) => Promise<{ items: StudyRow[] }>;
  tree: (studyId: number) => Promise<{ series: USeries[] }>;
  del: (body: ExamCtlUids) => Promise<{ deleted_series: number; deleted_images: number }>;
  restore: (body: ExamCtlUids) => Promise<{ ok?: boolean; restored_series?: number; restored_images?: number }>;
  trash: () => Promise<{ items: ExamCtlTrashItem[] }>;
  unassign: (body: ExamCtlUids) => Promise<{ moved: number; bucket_study_id: number }>;
  assign: (body: ExamCtlUids & { target_study_id: number }) => Promise<{ moved: number }>;
}

function makeDataSource(source: "server" | "local", hid?: number): ExamDataSource {
  if (source === "local") {
    return {
      studies: (q) => api.localExamctlStudies(q),
      // 로컬 트리는 preview_url 이 없고 iid 만 있음 → 통일형으로 매핑(빈 preview_url)
      tree: (id) => api.localExamctlTree(id).then((r) => ({
        series: r.series.map((s) => ({ ...s, instances: s.instances.map((it) => ({ preview_url: "", ...it })) })),
      })),
      del: (b) => api.localExamctlDelete(b),
      restore: (b) => api.localExamctlRestore(b),
      trash: () => api.localExamctlTrash(),
      unassign: (b) => api.localExamctlUnassign(b),
      assign: (b) => api.localExamctlAssign(b),
    };
  }
  return {
    studies: (q) => api.examctlStudies(hid, q),
    tree: (id) => api.examctlTree(id),
    del: (b) => api.examctlDelete(b),
    restore: (b) => api.examctlRestore(b),
    trash: () => api.examctlTrash(hid),
    unassign: (b) => api.examctlUnassign(b),
    assign: (b) => api.examctlAssign(b),
  };
}

/** 소스별 이미지 — server: preview_url 직접 / local: localRendered(iid) blob→objectURL (교체·unmount 시 revoke) */
function SrcImg({ img, local, imgStyle, fallback }: {
  img: UImage | null | undefined; local: boolean;
  imgStyle: React.CSSProperties; fallback: React.ReactNode;
}) {
  const [url, setUrl] = useState("");
  const iid = img?.iid;
  const srvUrl = img?.preview_url || "";
  useEffect(() => {
    if (!local) { setUrl(srvUrl); return; }
    setUrl("");
    if (iid === undefined) return;
    let alive = true;
    let obj = "";
    localRendered(iid)
      .then((b) => {
        obj = URL.createObjectURL(b);
        if (alive) setUrl(obj);
        else { URL.revokeObjectURL(obj); obj = ""; }   // 언마운트 후 도착 → 즉시 해제
      })
      .catch(() => { /* 렌더 실패 → fallback 유지 */ });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [local, iid, srvUrl]);
  return url ? <img src={url} alt="" style={imgStyle} /> : <>{fallback}</>;
}

const sopTail = (uid: string) => (uid && uid.length > 14 ? "…" + uid.slice(-12) : uid || "—");
const numDate = (s: string | undefined) => Number((s ?? "").replace(/\D/g, "").slice(0, 8)) || 0;
function cutoffNum(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return Number(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
}
const PERIODS: { key: string; label: string; days: number | null }[] = [
  { key: "all", label: "기간 전체", days: null },
  { key: "today", label: "오늘", days: 0 },
  { key: "7d", label: "7일", days: 7 },
  { key: "30d", label: "30일", days: 30 },
];

/** 선택/대상 환자 정보 카드 — 이름/ID/성별/검사일/검사명 */
function PatientCard({ title, s, accent, empty }: {
  title: string; s: StudyRow | null; accent?: string; empty: string;
}) {
  return (
    <div style={{ ...card, borderColor: accent ?? "var(--border)" }}>
      <div style={{ ...secTitle, color: accent }}>{title}</div>
      {!s ? (
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{empty}</div>
      ) : (
        <table className="grid-table" style={{ fontSize: 12 }}>
          <tbody>
            <tr><th style={{ width: 62 }}>이름</th><td>{s.patient_name || "—"}</td></tr>
            <tr><th>ID</th><td>{s.patient_key || "—"}</td></tr>
            <tr><th>성별</th><td>{s.sex || "—"}</td></tr>
            <tr><th>검사일</th><td>{s.study_date || "—"}</td></tr>
            <tr><th>검사명</th><td>{s.study_desc || "—"} <span style={{ color: "var(--text-secondary)" }}>({s.modality})</span></td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ExamControl({ hid, source = "server" }: { hid?: number; source?: "server" | "local" }) {
  // 소스 어댑터 — server(기본)=/api/examctl, local=/api/local/examctl (Worklist Local Server 모드)
  const isLocal = source === "local";
  const ds = useMemo(() => makeDataSource(source, hid), [source, hid]);

  // ── 좌열: 검사 목록 + 검색/간단 필터 ──
  const [studies, setStudies] = useState<StudyRow[]>([]);
  const [listErr, setListErr] = useState("");
  const [q, setQ] = useState("");
  const [mod, setMod] = useState("");
  const [period, setPeriod] = useState("all");
  const [sel, setSel] = useState<StudyRow | null>(null);

  // ── 선택 검사 트리(Series→Image) + 선택 상태 ──
  const [tree, setTree] = useState<USeries[] | null>(null);   // null=로딩 중
  const [treeErr, setTreeErr] = useState("");
  const [selSeries, setSelSeries] = useState<Set<string>>(new Set());
  const [selImages, setSelImages] = useState<Set<string>>(new Set());
  const [curSeriesUid, setCurSeriesUid] = useState<string | null>(null);   // Image 목록/썸네일 포커스
  const [preview, setPreview] = useState<UImage | null>(null);

  // ── 우열: 대상 검사(옮겨 갈 환자) ──
  const [targetQ, setTargetQ] = useState("");
  const [targetList, setTargetList] = useState<StudyRow[]>([]);
  const [targetErr, setTargetErr] = useState("");
  const [target, setTarget] = useState<StudyRow | null>(null);

  // ── 휴지통(Recovery) 패널 ──
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<ExamCtlTrashItem[]>([]);
  const [trashErr, setTrashErr] = useState("");
  const [trashSel, setTrashSel] = useState<Set<number>>(new Set());   // trash 배열 인덱스

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);
  const say = useCallback((text: string, err = false) => {
    setToast({ text, err });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 5000);
  }, []);

  const loadStudies = useCallback((query?: string) => {
    ds.studies((query ?? q).trim() || undefined)
      .then((r) => { setStudies(r.items); setListErr(""); })
      .catch((e) => { setStudies([]); setListErr(prepMsg(e, isLocal)); });
  }, [ds, isLocal, q]);
  // 소스(server↔local)·병원 전환 시 선택 상태 전체 초기화 + 즉시 재조회 (모드 전환 즉시 데이터 소스 전환)
  useEffect(() => {
    setSel(null); setTree(null); setTreeErr("");
    setSelSeries(new Set()); setSelImages(new Set());
    setCurSeriesUid(null); setPreview(null);
    setTarget(null); setTargetList([]); setTargetErr("");
    setTrashOpen(false); setTrash([]); setTrashSel(new Set()); setTrashErr("");
    loadStudies("");
  }, [ds]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTree = useCallback((s: StudyRow | null) => {
    if (!s) { setTree(null); return; }
    setTree(null);
    setTreeErr("");
    ds.tree(s.id)
      .then((r) => setTree(r.series))
      .catch((e) => { setTree([]); setTreeErr(prepMsg(e, isLocal)); });
  }, [ds, isLocal]);

  const pickStudy = (s: StudyRow) => {
    setSel(s);
    setSelSeries(new Set());
    setSelImages(new Set());
    setCurSeriesUid(null);
    setPreview(null);
    if (target?.id === s.id) setTarget(null);   // 자기 자신은 대상이 될 수 없음
    loadTree(s);
  };

  const loadTrash = useCallback(() => {
    ds.trash()
      .then((r) => { setTrash(r.items); setTrashErr(""); setTrashSel(new Set()); })
      .catch((e) => { setTrash([]); setTrashErr(prepMsg(e, isLocal)); });
  }, [ds, isLocal]);

  // local 소스에선 '옮겨 갈 환자' 검색도 로컬 검사에서 수행 (어댑터 공유)
  const searchTarget = () => {
    ds.studies(targetQ.trim() || undefined)
      .then((r) => { setTargetList(r.items.filter((s) => s.id !== sel?.id).slice(0, 8)); setTargetErr(""); })
      .catch((e) => { setTargetList([]); setTargetErr(prepMsg(e, isLocal)); });
  };

  // 클라이언트측 간단 필터 (계약의 서버 파라미터는 hid/q 뿐 — Modality/기간은 목록에서 필터)
  const shown = useMemo(() => {
    const p = PERIODS.find((x) => x.key === period);
    const cut = p?.days === null || p === undefined ? 0 : cutoffNum(p.days);
    return studies.filter((s) =>
      (!mod || s.modality === mod) && (!cut || numDate(s.study_date) >= cut));
  }, [studies, mod, period]);
  const modOptions = useMemo(
    () => [...new Set(studies.map((s) => s.modality).filter(Boolean))].sort(), [studies]);

  const curSeries = (tree ?? []).find((s) => s.series_uid === curSeriesUid) ?? null;
  const anySel = selSeries.size + selImages.size > 0;
  const uidsBody = { series_uids: [...selSeries], sop_uids: [...selImages] };

  // 작업 후 공통 갱신 — 트리·목록·(열려 있으면)휴지통 재조회 + 선택 해제
  const refreshAfter = () => {
    setSelSeries(new Set());
    setSelImages(new Set());
    loadTree(sel);
    loadStudies();
    if (trashOpen) loadTrash();
  };

  const doDelete = async (kind: "series" | "image") => {
    const body = kind === "series" ? { series_uids: [...selSeries] } : { sop_uids: [...selImages] };
    const n = kind === "series" ? selSeries.size : selImages.size;
    if (!n) return;
    if (!confirm(`선택한 ${kind === "series" ? "Series" : "Image"} ${n}건을 삭제할까요?\n` +
      `소프트 삭제(휴지통)로 이동하며 [Recovery]에서 복구할 수 있습니다.`)) return;
    setBusy(true);
    try {
      const r = await ds.del(body);
      say(`삭제 완료 — Series ${r.deleted_series}건 · Image ${r.deleted_images}건 (휴지통 이동)`);
      refreshAfter();
    } catch (e) { say(prepMsg(e, isLocal), true); }
    finally { setBusy(false); }
  };

  const doUnassign = async () => {
    if (!anySel) return;
    if (!confirm(`선택 항목(Series ${selSeries.size}·Image ${selImages.size})을 현재 검사에서 분리해\n` +
      `병원별 미배정(UNASSIGNED) 버킷 검사로 이동할까요?`)) return;
    setBusy(true);
    try {
      const r = await ds.unassign(uidsBody);
      say(`Unassign 완료 — ${r.moved}건 → 미배정 버킷 검사 #${r.bucket_study_id}`);
      refreshAfter();
    } catch (e) { say(prepMsg(e, isLocal), true); }
    finally { setBusy(false); }
  };

  const doAssign = async () => {
    if (!anySel || !target) return;
    if (!confirm(`선택 항목(Series ${selSeries.size}·Image ${selImages.size})을 대상 검사로 이동(재귀속)할까요?\n` +
      `대상: ${target.patient_name || target.patient_key} · ${target.modality} · ${target.study_date}\n` +
      (isLocal ? `로컬 PACS(local.db) 귀속만 변경되며 원본 DICOM 파일·태그는 바뀌지 않습니다.`
               : `앱 DB 귀속만 변경되며 Orthanc 원본·DICOM 태그는 바뀌지 않습니다.`))) return;
    setBusy(true);
    try {
      const r = await ds.assign({ ...uidsBody, target_study_id: target.id });
      say(`Assign 완료 — ${r.moved}건을 검사 #${target.id}로 이동`);
      refreshAfter();
    } catch (e) { say(prepMsg(e, isLocal), true); }
    finally { setBusy(false); }
  };

  const doRestore = async () => {
    const picked = [...trashSel].map((i) => trash[i]).filter(Boolean);
    const series_uids = picked.filter((t) => t.kind === "series" && t.series_uid).map((t) => t.series_uid!);
    const sop_uids = picked.filter((t) => t.kind === "image" && t.sop_uid).map((t) => t.sop_uid!);
    if (!series_uids.length && !sop_uids.length) { say("⚠ 휴지통에서 복구할 항목을 선택하세요", true); return; }
    setBusy(true);
    try {
      const r = await ds.restore({ series_uids, sop_uids });
      say(`복구 완료 — Series ${r.restored_series ?? series_uids.length}건 · Image ${r.restored_images ?? sop_uids.length}건`);
      loadTrash();
      loadTree(sel);
      loadStudies();
    } catch (e) { say(prepMsg(e, isLocal), true); }
    finally { setBusy(false); }
  };

  const toggleSet = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  };

  const btn = (label: string, onClick: () => void, enabled: boolean, tip: string, danger = false): React.ReactNode => (
    <button onClick={onClick} disabled={!enabled || busy} title={tip}
            style={{ padding: "4px 12px", fontSize: 12, fontWeight: 700,
                     color: danger && enabled ? "var(--danger,#f87171)" : undefined }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", minHeight: 0, position: "relative" }}>
      {/* ── 상단: 제목 + 버튼 5종 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>
          🧰 Exam Control <span style={{ color: "var(--text-secondary)", fontWeight: 400, fontSize: 11.5 }}>— 관리자 검사 QC (삭제·복구·재배정)</span>
        </div>
        {/* 소스 배지 — LOCAL(앰버)/SERVER(기본): 지금 조작 중인 데이터가 어디인지 상시 표시 */}
        <span title={isLocal ? "데이터 소스: 로컬 PACS (local.db) — Worklist Local Server 모드" : "데이터 소스: 서버 DB"}
              style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, padding: "2px 9px", borderRadius: 999,
                       border: `1px solid ${isLocal ? "#f59e0b" : "var(--border)"}`,
                       background: isLocal ? "rgba(245,158,11,0.12)" : "transparent",
                       color: isLocal ? "#f59e0b" : "var(--text-secondary)" }}>
          {isLocal ? "LOCAL — 데이터: 로컬 PACS" : "SERVER"}
        </span>
        <div style={{ flex: 1 }} />
        {btn("Series del", () => void doDelete("series"), selSeries.size > 0, "선택 Series 소프트 삭제 (휴지통)", true)}
        {btn("Image del", () => void doDelete("image"), selImages.size > 0, "선택 Image 소프트 삭제 (휴지통)", true)}
        {btn(trashOpen ? "Recovery ▲" : "Recovery", () => { const o = !trashOpen; setTrashOpen(o); if (o) loadTrash(); }, true,
             "휴지통 패널 토글 — 삭제 항목 선택 복구")}
        {btn("Unassign", () => void doUnassign(), anySel, "선택 항목을 현재 검사에서 분리 → 미배정(UNASSIGNED) 버킷")}
        {btn("Assign", () => void doAssign(), anySel && !!target,
             target ? "선택 항목을 대상 검사로 이동(재귀속)" : "대상 검사를 먼저 선택하세요 (우측 '옮겨 갈 환자')")}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
        {isLocal
          ? <>재배정(Unassign/Assign)은 로컬 PACS(local.db) 귀속만 변경합니다 — 원본 DICOM 파일·태그는 불변이며,
              로컬 뷰어·목록은 local.db 트리를 따르므로 즉시 반영됩니다. 삭제는 소프트 삭제(휴지통)로 [Recovery]에서 복구 가능합니다.</>
          : <>재배정(Unassign/Assign)은 앱 DB 계층(Series/Instance→Study 귀속)만 변경합니다 — Orthanc 원본·DICOM 태그는 불변이며,
              뷰어·워크리스트는 앱 DB 트리를 따르므로 즉시 반영됩니다. 삭제는 소프트 삭제(휴지통)로 [Recovery]에서 복구 가능합니다.</>}
      </div>

      {/* ── 휴지통(Recovery) 패널 ── */}
      {trashOpen && (
        <div style={{ ...card, borderColor: "var(--ai,#a78bfa)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ ...secTitle, marginBottom: 0, color: "var(--ai,#a78bfa)" }}>🗑 휴지통 (소프트 삭제 항목)</div>
            <div style={{ flex: 1 }} />
            <button onClick={loadTrash} disabled={busy}>새로고침</button>
            <button className="primary" onClick={() => void doRestore()} disabled={busy || trashSel.size === 0}>
              선택 복구 ({trashSel.size})
            </button>
          </div>
          <div style={{ maxHeight: 180, overflow: "auto" }}>
            <table className="grid-table" style={{ fontSize: 12 }}>
              <thead><tr><th></th><th>단위</th><th>환자</th><th>검사</th><th>대상</th><th>삭제 시각</th></tr></thead>
              <tbody>
                {trash.map((t, i) => (
                  <tr key={i} onClick={() => setTrashSel((p) => toggleSet(p, i))} style={{ cursor: "pointer" }}>
                    <td><input type="checkbox" checked={trashSel.has(i)} readOnly /></td>
                    <td>{t.kind === "study" ? "검사" : t.kind === "series" ? "Series" : "Image"}</td>
                    <td>{t.patient_name || t.patient_key || "—"}</td>
                    <td>{[t.modality, t.study_date, t.study_desc].filter(Boolean).join(" · ") || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                      {t.kind === "image" ? `Img ${t.instance_number ?? "?"} ${sopTail(t.sop_uid ?? "")}`
                        : t.kind === "series" ? (t.series_desc || sopTail(t.series_uid ?? "")) : "검사 전체"}
                    </td>
                    <td>{t.deleted_at ? t.deleted_at.replace("T", " ").slice(0, 19) : "—"}</td>
                  </tr>
                ))}
                {trash.length === 0 && (
                  <tr><td colSpan={6} style={{ color: "var(--text-secondary)" }}>{trashErr || "휴지통이 비어 있습니다."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 본문: 좌(검사→Series→Image) | 우(환자 카드·대상·썸네일·프리뷰) ── */}
      <div style={{ display: "flex", gap: 10, flex: 1, minHeight: 0 }}>
        {/* ══ 좌열 ══ */}
        <div style={{ flex: 1.5, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* ① 검사 그리드 */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 6, flex: 1.2, minHeight: 120 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ ...secTitle, marginBottom: 0 }}>① 검사 (Exam)</div>
              <input style={{ ...inp, flex: 1, minWidth: 120 }} placeholder="환자 ID/이름 검색"
                     value={q} onChange={(e) => setQ(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") loadStudies(); }} />
              <select style={inp} value={mod} onChange={(e) => setMod(e.target.value)} title="Modality 필터">
                <option value="">Mod 전체</option>
                {modOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select style={inp} value={period} onChange={(e) => setPeriod(e.target.value)} title="기간 필터">
                {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <button onClick={() => loadStudies()}>🔍 검색</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
              <table className="grid-table" style={{ fontSize: 12 }}>
                <thead><tr><th>환자</th><th>ID</th><th>성별</th><th>검사일</th><th>Mod</th><th>검사명</th><th>S/I</th></tr></thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.id} onClick={() => pickStudy(s)}
                        style={{ cursor: "pointer",
                                 background: sel?.id === s.id ? "var(--accent-subtle)" : undefined,
                                 color: s.patient_key === "UNASSIGNED" ? "var(--ai,#a78bfa)" : undefined }}>
                      <td>{s.patient_name || "—"}</td><td>{s.patient_key}</td><td>{s.sex || "—"}</td>
                      <td>{s.study_date}</td><td>{s.modality}</td><td>{s.study_desc || "—"}</td>
                      <td>{s.series_count}/{s.instance_count}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr><td colSpan={7} style={{ color: "var(--text-secondary)" }}>{listErr || "검사가 없습니다."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ② 선택 검사의 Series 목록 */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 6, flex: 1, minHeight: 100 }}>
            <div style={{ ...secTitle, marginBottom: 0 }}>
              ② Series <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>
                {sel ? `— ${sel.patient_name || sel.patient_key} (선택 ${selSeries.size})` : "— 검사를 선택하세요"}</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
              <table className="grid-table" style={{ fontSize: 12 }}>
                <thead><tr><th></th><th>#</th><th>Mod</th><th>설명</th><th>Image</th><th>상태</th></tr></thead>
                <tbody>
                  {(tree ?? []).map((s) => (
                    <tr key={s.series_uid} onClick={() => { setCurSeriesUid(s.series_uid); setPreview(null); }}
                        style={{ cursor: "pointer",
                                 background: curSeriesUid === s.series_uid ? "var(--accent-subtle)" : undefined }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selSeries.has(s.series_uid)}
                               onChange={() => setSelSeries((p) => toggleSet(p, s.series_uid))} />
                      </td>
                      <td style={s.deleted ? delRow : undefined}>{s.series_number}</td>
                      <td style={s.deleted ? delRow : undefined}>{s.modality}</td>
                      <td style={s.deleted ? delRow : undefined}>{s.series_desc || "—"}</td>
                      <td style={s.deleted ? delRow : undefined}>{s.instances.length}</td>
                      <td>{s.deleted ? <span style={{ color: "var(--danger,#f87171)", fontSize: 11 }}>삭제됨</span> : "—"}</td>
                    </tr>
                  ))}
                  {sel && tree === null && <tr><td colSpan={6} style={{ color: "var(--text-secondary)" }}>불러오는 중…</td></tr>}
                  {sel && tree !== null && tree.length === 0 && (
                    <tr><td colSpan={6} style={{ color: "var(--text-secondary)" }}>{treeErr || "Series가 없습니다."}</td></tr>
                  )}
                  {!sel && <tr><td colSpan={6} style={{ color: "var(--text-secondary)" }}>위 검사 그리드에서 검사를 선택하세요.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ③ 선택 Series 의 Image 목록 */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 6, flex: 1, minHeight: 100 }}>
            <div style={{ ...secTitle, marginBottom: 0 }}>
              ③ Image <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>
                {curSeries ? `— S${curSeries.series_number} (선택 ${selImages.size})` : "— Series를 선택하세요"}</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
              <table className="grid-table" style={{ fontSize: 12 }}>
                <thead><tr><th></th><th>번호</th><th>크기</th><th>SOP</th><th>상태</th></tr></thead>
                <tbody>
                  {(curSeries?.instances ?? []).map((it) => (
                    <tr key={it.sop_uid} onClick={() => setPreview(it)}
                        style={{ cursor: "pointer",
                                 background: preview?.sop_uid === it.sop_uid ? "var(--accent-subtle)" : undefined }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selImages.has(it.sop_uid)}
                               onChange={() => setSelImages((p) => toggleSet(p, it.sop_uid))} />
                      </td>
                      <td style={it.deleted ? delRow : undefined}>{it.instance_number}</td>
                      <td style={it.deleted ? delRow : undefined}>{it.rows && it.cols ? `${it.cols}×${it.rows}` : "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 11, ...(it.deleted ? delRow : {}) }}>{sopTail(it.sop_uid)}</td>
                      <td>{it.deleted ? <span style={{ color: "var(--danger,#f87171)", fontSize: 11 }}>삭제됨</span> : "—"}</td>
                    </tr>
                  ))}
                  {!curSeries && <tr><td colSpan={5} style={{ color: "var(--text-secondary)" }}>Series 목록에서 행을 클릭하면 Image가 표시됩니다.</td></tr>}
                  {curSeries && curSeries.instances.length === 0 && (
                    <tr><td colSpan={5} style={{ color: "var(--text-secondary)" }}>Image가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ══ 우열 ══ */}
        <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
          {/* ① 선택한 환자 */}
          <PatientCard title="선택한 환자" s={sel} empty="좌측에서 검사를 선택하세요." />

          {/* ② 옮겨 갈 환자(대상 검사) */}
          <div style={{ ...card, borderColor: target ? "var(--ai,#a78bfa)" : "var(--border)" }}>
            <div style={{ ...secTitle, color: "var(--ai,#a78bfa)" }}>옮겨 갈 환자 (Assign 대상 검사)</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input style={{ ...inp, flex: 1 }} placeholder="대상 검사 검색 (자기 자신 제외)"
                     value={targetQ} onChange={(e) => setTargetQ(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") searchTarget(); }} />
              <button onClick={searchTarget}>검색</button>
            </div>
            {targetList.length > 0 && (
              <div style={{ maxHeight: 130, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4, marginBottom: 6 }}>
                <table className="grid-table" style={{ fontSize: 11.5 }}>
                  <tbody>
                    {targetList.map((s) => (
                      <tr key={s.id} onClick={() => { setTarget(s); setTargetList([]); }}
                          style={{ cursor: "pointer" }}
                          title={`검사 #${s.id} — 클릭하여 대상으로 선택`}>
                        <td>{s.patient_name || s.patient_key}</td><td>{s.modality}</td>
                        <td>{s.study_date}</td><td>{s.study_desc || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {targetErr && <div style={{ fontSize: 11.5, color: "var(--danger,#f87171)", marginBottom: 6 }}>{targetErr}</div>}
            {!target ? (
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>대상 미선택 — [Assign] 비활성</div>
            ) : (
              <>
                <PatientCard title="" s={target} empty="" />
                <button style={{ marginTop: 6, fontSize: 11.5 }} onClick={() => setTarget(null)}>대상 해제</button>
              </>
            )}
          </div>

          {/* ③ Series 썸네일 */}
          <div style={card}>
            <div style={secTitle}>Series 썸네일</div>
            {!tree || tree.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>표시할 Series가 없습니다.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {tree.map((s) => {
                  const first = s.instances.find((i) => !i.deleted && (i.preview_url || i.iid !== undefined)) ?? s.instances[0];
                  return (
                    <div key={s.series_uid} onClick={() => { setCurSeriesUid(s.series_uid); setPreview(null); }}
                         title={`S${s.series_number} ${s.series_desc || ""}${s.deleted ? " (삭제됨)" : ""}`}
                         style={{ cursor: "pointer", border: curSeriesUid === s.series_uid
                                    ? "2px solid var(--ai,#a78bfa)" : "1px solid var(--border)",
                                  borderRadius: 4, overflow: "hidden", background: "#000",
                                  opacity: s.deleted ? 0.4 : 1, position: "relative" }}>
                      <SrcImg img={first} local={isLocal}
                              imgStyle={{ width: "100%", height: 72, objectFit: "contain", display: "block" }}
                              fallback={<div style={{ height: 72, display: "grid", placeItems: "center", color: "var(--text-secondary)", fontSize: 11 }}>미리보기 없음</div>} />
                      <div style={{ position: "absolute", left: 2, bottom: 2, fontSize: 10, color: "#fff",
                                    background: "rgba(0,0,0,0.55)", borderRadius: 3, padding: "0 4px" }}>
                        S{s.series_number} · {s.instances.length}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ④ 선택 Image 프리뷰 (크게) */}
          <div style={{ ...card, flex: 1, minHeight: 180, display: "flex", flexDirection: "column" }}>
            <div style={secTitle}>Image 프리뷰 {preview && <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>— Img {preview.instance_number}</span>}</div>
            <div style={{ flex: 1, minHeight: 150, background: "#000", borderRadius: 4,
                          display: "grid", placeItems: "center", overflow: "hidden" }}>
              {preview
                ? <SrcImg img={preview} local={isLocal}
                          imgStyle={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                          fallback={<span style={{ color: "var(--text-secondary)", fontSize: 12 }}>미리보기 없음</span>} />
                : <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Image 목록에서 행을 클릭하세요</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── 토스트 ── */}
      {toast && (
        <div style={{ position: "absolute", right: 12, bottom: 12, zIndex: 50, maxWidth: 420,
                      background: "var(--bg-elevated)", borderRadius: 6, padding: "8px 14px", fontSize: 12.5,
                      border: `1px solid ${toast.err ? "var(--danger,#f87171)" : "var(--accent,#7dd3fc)"}`,
                      color: toast.err ? "var(--danger,#f87171)" : "var(--text-primary)",
                      boxShadow: "0 6px 20px rgba(0,0,0,0.45)" }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default ExamControl;
