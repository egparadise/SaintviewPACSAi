// 워크리스트 워크스페이스 — 디자인 명세 §3 5구역 레이아웃 충실 구현
// [A]툴바 [B]필터 [C-좌]날짜트리|[C]메인그리드 [D]과거검사|비교세트 [E]상용구|리포트|오더 + 컨텍스트메뉴
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  downloadReportPdf,
  openViewer,
  openViewerCompare,
  type BatchCandidate,
  type InstanceThumb,
  type KeyImage,
  type NlQueryResult,
  type OrderRow,
  type Report,
  type SrJson,
  type StudyDetail,
  type StudyRow,
} from "../api";

import {
  DEFAULT_TAB,
  FolderTreeEditor,
  filtersToFolder,
  folderSummary,
  folderToFilters,
  loadTabs,
  loadTree,
  mergedFilter,
  newId,
  saveTabs,
  saveTree,
  type TreeNode,
  type WorklistTab,
} from "./WorklistTree";

const Viewer3D = lazy(() => import("./Viewer3D").then((m) => ({ default: m.Viewer3D })));
const Viewer2D = lazy(() => import("./Viewer2D").then((m) => ({ default: m.Viewer2D })));

/* ── F-18 행잉 매핑 ─────────────────────────────── */
let hangingMap: Record<string, string> = {};
export function loadHangingPrefs() {
  api.getSetting("viewer.prefs").then((r) => {
    hangingMap = ((r.value as { hanging?: Record<string, string> }).hanging) ?? {};
  }).catch(() => {});
}
function hpFor(modality: string): string | undefined {
  return hangingMap[modality] ?? hangingMap.default;
}

const STATUS_LABEL: Record<string, string> = {
  received: "도착", draft_ready: "AI초안", reading: "판독중", finalized: "확정",
  suspended: "보류", draft: "초안", in_review: "검토중",
};
function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/* ── 컬럼 정의 (F-8: 설정에서 구성 가능) ──────────── */
export const COLUMN_DEFS: Record<string, { label: string; render: (r: StudyRow) => React.ReactNode; width?: number }> = {
  status: { label: "상태", render: (r) => <StatusBadge status={r.status} /> },
  ai: {
    label: "AI",
    render: (r) =>
      r.critical ? <span className="badge critical">CRITICAL</span>
        : r.report_status === "draft" ? <span className="badge ai">초안</span> : null,
  },
  patient_key: { label: "ID", render: (r) => r.patient_key },
  patient_name: { label: "이름", render: (r) => r.patient_name },
  sex: { label: "성별", render: (r) => r.sex },
  birth_date: { label: "생년월일", render: (r) => r.birth_date },
  study_date: { label: "검사일", render: (r) => r.study_date },
  modality: { label: "MOD", render: (r) => r.modality },
  body_part: { label: "부위", render: (r) => r.body_part },
  study_desc: { label: "검사명", render: (r) => <span title={r.study_desc}>{r.study_desc}</span> },
  accession_no: { label: "Accession", render: (r) => r.accession_no },
  impression: {
    label: "임프레션 (AI 미리보기)",
    render: (r) => (
      <span style={{ color: "var(--ai)" }} title={r.impression_preview}>{r.impression_preview}</span>
    ),
  },
  series_count: { label: "Srs", render: (r) => r.series_count },
  instance_count: { label: "Img", render: (r) => r.instance_count },
  priority: {
    label: "우선순위",
    render: (r) => (r.emergency ? <span style={{ color: "var(--stat-emergency)" }}>Emergency</span> : "Normal"),
  },
};
export const DEFAULT_COLUMNS = [
  "status", "ai", "patient_key", "patient_name", "sex", "study_date",
  "modality", "body_part", "study_desc", "impression", "series_count", "instance_count", "priority",
];

/* ── [A] 액션 툴바 ─────────────────────────────── */
function ActionToolbar({
  selected, onAction, searchText, setSearchText, onSearch, onNlSearch,
}: {
  selected: StudyDetail | null;
  onAction: (a: string) => void;
  searchText: string;
  setSearchText: (s: string) => void;
  onSearch: () => void;
  onNlSearch: (text: string) => void;
}) {
  const need = !selected;
  const [nlText, setNlText] = useState("");
  const Btn = ({ a, label, primary, title }: { a: string; label: string; primary?: boolean; title?: string }) => (
    <button className={primary ? "primary" : ""} disabled={need && a !== "batch" && a !== "refresh"}
            title={title} onClick={() => onAction(a)}>
      {label}
    </button>
  );
  return (
    <div style={{
      display: "flex", gap: 5, padding: "6px 8px", alignItems: "center",
      background: "var(--bg-panel)", borderBottom: "1px solid var(--border)",
    }}>
      <Btn a="viewdraft" label="View&Draft" primary title="뷰어 + 초안 패널 동시 오픈 (더블클릭과 동일)" />
      <Btn a="viewer" label="뷰어" title="OHIF 뷰어 열기" />
      <Btn a="3d" label="3D" title="내장 Cornerstone3D MPR/MIP" />
      <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 3px" }} />
      <Btn a="pdf" label="PDF" title="판독서 PDF" />
      <Btn a="emergency" label="⚠ Emergency" title="응급 우선순위 토글 (F-15)" />
      <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 3px" }} />
      <Btn a="batch" label="일괄 검토" title="AI 초안 일괄 검토 (F-22)" />
      <Btn a="refresh" label="새로고침" />
      <div style={{ flex: 1 }} />
      {/* 07 A.2 SearchShortcut: 검색 바로가기 저장/적용 */}
      <select title="검색 바로가기" defaultValue="" onChange={(e) => {
        const sc = JSON.parse(localStorage.getItem("sv_shortcuts") ?? "[]")
          .find((s: { label: string }) => s.label === e.target.value);
        if (sc) window.dispatchEvent(new CustomEvent("sv-apply-shortcut", { detail: sc }));
        e.target.value = "";
      }}>
        <option value="">바로가기…</option>
        {JSON.parse(localStorage.getItem("sv_shortcuts") ?? "[]").map((s: { label: string }) => (
          <option key={s.label} value={s.label}>{s.label}</option>
        ))}
      </select>
      <button title="현재 검색조건을 바로가기로 저장" onClick={() => {
        window.dispatchEvent(new CustomEvent("sv-save-shortcut"));
      }}>★저장</button>
      {/* S1 자연어 검색 (nl_to_query) — AI 기능이므로 보라 포인트 */}
      <input
        placeholder="AI 검색 — 예: 지난주 흉부 CT 미판독" value={nlText}
        onChange={(e) => setNlText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && nlText.trim()) { onNlSearch(nlText); } }}
        title="자연어로 검색 조건을 입력하면 AI가 필터로 변환합니다 (적용 전 미리보기)"
        style={{ width: 200, background: "var(--bg-canvas)", borderColor: "var(--ai)" }}
      />
      <input
        placeholder="SEARCH — 환자 ID/이름 (=정확 / 접두% / !제외)" value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSearch()}
        style={{ width: 280, background: "var(--bg-canvas)" }}
      />
      <button className="primary" onClick={onSearch}>SEARCH</button>
    </div>
  );
}

/* ── [B] 필드별 검색 필터 바 (Zetta: ID/NAME/SEX/MODALITY/DATE/DESC 개별 콤보) ── */
export const FIND_FIELDS: Record<string, string> = {
  pid: "환자 ID", pname: "환자 이름", sex: "성별", modality: "Modality",
  date: "검사일", desc: "검사명(Description)", body_part: "부위",
  status: "상태", finding: "소견 검색(F-2)", emergency: "Emergency",
};
export const DEFAULT_FIND_FIELDS = ["pid", "pname", "sex", "modality", "date", "desc", "status", "finding", "emergency"];

function FilterBar({ filters, setFilters, fields, onSearch }: {
  filters: Record<string, string>;
  setFilters: (f: Record<string, string>) => void;
  fields: string[];
  onSearch: () => void;
}) {
  const set = (k: string, v: string) => setFilters({ ...filters, [k]: v });
  const enter = (e: React.KeyboardEvent) => e.key === "Enter" && onSearch();
  const F = (key: string) => {
    switch (key) {
      case "pid":
        return <input key={key} placeholder="*Any 환자 ID" value={filters.pid ?? ""} style={{ width: 110 }}
                      onChange={(e) => set("pid", e.target.value)} onKeyDown={enter} />;
      case "pname":
        return <input key={key} placeholder="*Any 이름" value={filters.pname ?? ""} style={{ width: 110 }}
                      onChange={(e) => set("pname", e.target.value)} onKeyDown={enter} />;
      case "sex":
        return (
          <select key={key} value={filters.sex ?? ""} onChange={(e) => set("sex", e.target.value)}>
            <option value="">*Any 성별</option><option value="M">M</option>
            <option value="F">F</option><option value="O">O</option>
          </select>
        );
      case "modality":
        return (
          <select key={key} value={filters.modality ?? ""} onChange={(e) => set("modality", e.target.value)}>
            <option value="">*Any Modality</option>
            {["CR", "CT", "MR", "US", "MG", "XA", "NM", "DX", "ES", "RF", "OT"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        );
      case "date":
        return (
          <span key={key} style={{ display: "flex", gap: 3, alignItems: "center" }}>
            <input type="date" value={filters.date_from_iso ?? ""} title="검사일 From"
                   onChange={(e) => set("date_from_iso", e.target.value)} />
            <span style={{ color: "var(--text-secondary)" }}>~</span>
            <input type="date" value={filters.date_to_iso ?? ""} title="검사일 To"
                   onChange={(e) => set("date_to_iso", e.target.value)} />
          </span>
        );
      case "desc":
        return <input key={key} placeholder="*Any 검사명" value={filters.desc ?? ""} style={{ width: 140 }}
                      onChange={(e) => set("desc", e.target.value)} onKeyDown={enter} />;
      case "body_part":
        return <input key={key} placeholder="*Any 부위" value={filters.body_part ?? ""} style={{ width: 90 }}
                      onChange={(e) => set("body_part", e.target.value)} onKeyDown={enter} />;
      case "status":
        return (
          <select key={key} value={filters.status ?? ""} onChange={(e) => set("status", e.target.value)}>
            <option value="">*Any 상태</option><option value="unread">미판독(확정 전)</option>
            <option value="received">도착</option>
            <option value="draft_ready">AI초안</option><option value="reading">판독중</option>
            <option value="finalized">확정</option>
          </select>
        );
      case "finding":
        return <input key={key} placeholder="소견/임프레션 검색 (F-2)" value={filters.finding ?? ""}
                      style={{ width: 180 }} onChange={(e) => set("finding", e.target.value)} onKeyDown={enter} />;
      case "emergency":
        return (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={filters.emergency === "true"}
                   onChange={(e) => set("emergency", e.target.checked ? "true" : "")} />
            ⚠ Emergency
          </label>
        );
      default: return null;
    }
  };
  return (
    <div style={{
      display: "flex", gap: 6, padding: "5px 8px", background: "var(--bg-panel)",
      borderBottom: "1px solid var(--border)", alignItems: "center", flexWrap: "wrap",
    }}>
      {fields.map(F)}
    </div>
  );
}

/* ── [C-좌] 검색 레일: 기간 프리셋 + 검색 폴더 트리 (UBPACS-Z Search Filter) ── */
const DATE_PRESETS = [
  { key: "today", label: "Today", days: 0 },
  { key: "3d", label: "최근 3일", days: 3 },
  { key: "1w", label: "최근 1주", days: 7 },
  { key: "1m", label: "최근 1개월", days: 30 },
  { key: "all", label: "전체", days: -1 },
];
function SearchRail({ active, onPick, tree }: {
  active: string; onPick: (key: string, from: string) => void; tree: React.ReactNode;
}) {
  const pick = (p: { key: string; days: number }) => {
    if (p.days < 0) return onPick(p.key, "");
    const d = new Date();
    d.setDate(d.getDate() - p.days);
    onPick(p.key, d.toISOString().slice(0, 10).replaceAll("-", ""));
  };
  return (
    <div style={{
      width: 152, background: "var(--bg-panel)", borderRight: "1px solid var(--border)",
      padding: 6, display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, minHeight: 0,
    }}>
      <div style={{ fontSize: 10.5, color: "var(--text-secondary)", fontWeight: 700, padding: "2px 4px" }}>
        기간
      </div>
      {DATE_PRESETS.map((p) => (
        <div key={p.key} onClick={() => pick(p)}
             style={{
               padding: "3px 8px", borderRadius: 3, cursor: "pointer", fontSize: 12.5,
               background: active === p.key ? "var(--accent-subtle)" : undefined,
               color: active === p.key ? "var(--text-primary)" : "var(--text-secondary)",
             }}>
          {p.label}
        </div>
      ))}
      <div style={{
        fontSize: 10.5, color: "var(--text-secondary)", fontWeight: 700,
        padding: "6px 4px 2px", borderTop: "1px solid var(--border)", marginTop: 4,
      }}>
        검색 폴더
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{tree}</div>
    </div>
  );
}

/* ── 워크리스트 페이지 탭 바 (UBPACS-Z — 저장된 검색 정의를 페이지로, 최대 10) ── */
function WorklistTabsBar({ tabs, activeId, onPick, onAdd, onRemove }: {
  tabs: WorklistTab[]; activeId: string;
  onPick: (t: WorklistTab) => void; onAdd: () => void; onRemove: (id: string) => void;
}) {
  return (
    <div style={{
      display: "flex", gap: 2, padding: "4px 8px 0", alignItems: "flex-end",
      background: "var(--bg-canvas)", borderBottom: "1px solid var(--border)",
    }}>
      {tabs.map((t) => (
        <div key={t.id} onClick={() => onPick(t)} title={folderSummary(t.filter)}
             style={{
               display: "flex", alignItems: "center", gap: 6, padding: "4px 11px",
               borderRadius: "4px 4px 0 0", cursor: "pointer", fontSize: 11.5, fontWeight: 700,
               background: t.id === activeId ? "var(--accent)" : "var(--bg-elevated)",
               color: t.id === activeId ? "#fff" : "var(--text-secondary)",
               border: "1px solid var(--border)", borderBottom: "none", whiteSpace: "nowrap",
             }}>
          {t.label.toUpperCase()}
          {t.id !== "default" && (
            <span title="페이지 삭제" onClick={(e) => { e.stopPropagation(); onRemove(t.id); }}
                  style={{ fontSize: 10, opacity: 0.75 }}>✕</span>
          )}
        </div>
      ))}
      <button onClick={onAdd} title="현재 검색조건을 새 페이지로 등록 (최대 10 — UBPACS-Z)"
              style={{ padding: "1px 9px", fontSize: 13, marginLeft: 4, marginBottom: 3 }}>＋</button>
    </div>
  );
}

/* ── [C] 메인 검사 그리드 (컬럼 구성형) ───────────── */
function StudyGrid({
  items, columns, selectedId, onSelect, onOpen, onContext,
}: {
  items: StudyRow[];
  columns: string[];
  selectedId: number | null;
  onSelect: (row: StudyRow) => void;
  onOpen: (row: StudyRow) => void;
  onContext: (e: React.MouseEvent, row: StudyRow) => void;
}) {
  return (
    <div style={{ overflow: "auto", flex: 1, minWidth: 0 }}>
      <table className="grid-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            {columns.map((c) => <th key={c}>{COLUMN_DEFS[c]?.label ?? c}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={row.id}
                className={[row.id === selectedId ? "selected" : "", row.emergency ? "emergency" : ""].join(" ")}
                onClick={() => onSelect(row)}
                onDoubleClick={() => onOpen(row)}
                onContextMenu={(e) => { e.preventDefault(); onSelect(row); onContext(e, row); }}>
              <td style={{ color: "var(--text-secondary)" }}>{i + 1}</td>
              {columns.map((c) => <td key={c}>{COLUMN_DEFS[c]?.render(row)}</td>)}
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={columns.length + 1}
                    style={{ color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>
              검사가 없습니다
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── [D-좌] 과거검사 (선택 환자, F-14) ────────────── */
function PriorStudiesGrid({ detail, onAddCompare }: {
  detail: StudyDetail | null;
  onAddCompare: (e: { id: number; study_uid: string; study_date: string; modality: string; study_desc: string }) => void;
}) {
  return (
    <PanelBox title={`과거검사 ${detail ? `— ${detail.patient_name}` : ""} (더블클릭=비교세트 추가)`}>
      <table className="grid-table">
        <thead><tr><th>검사일</th><th>MOD</th><th>검사명</th><th>상태</th></tr></thead>
        <tbody>
          {(detail?.related_exams ?? []).map((e) => (
            <tr key={e.id} onDoubleClick={() => onAddCompare(e)}>
              <td>{e.study_date}</td><td>{e.modality}</td>
              <td title={e.study_desc}>{e.study_desc}</td>
              <td><StatusBadge status={e.status} /></td>
            </tr>
          ))}
          {(!detail || detail.related_exams.length === 0) && (
            <tr><td colSpan={4} style={{ color: "var(--text-secondary)" }}>
              {detail ? "과거 검사 없음" : "검사를 선택하세요"}
            </td></tr>
          )}
        </tbody>
      </table>
    </PanelBox>
  );
}

/* ── [D-우] 비교세트 (Complementary set) ─────────── */
interface CompareItem { id: number; study_uid: string; study_date: string; modality: string; study_desc: string }
function ComparisonSetGrid({ items, current, onRemove, onOpenCompare, onMerge }: {
  items: CompareItem[];
  current: StudyDetail | null;
  onRemove: (uid: string) => void;
  onOpenCompare: () => void;
  onMerge: () => void;
}) {
  return (
    <PanelBox title="비교세트 (Complementary set)" right={
      <span style={{ display: "flex", gap: 4 }}>
        <button disabled={!current || items.length === 0} onClick={onMerge}
                title="묶음판독(report_merge) — 비교세트 검사들을 현재 검사 판독 하나로 병합"
                style={{ padding: "2px 10px", fontSize: 11.5 }}>
          묶음판독
        </button>
        <button className="primary" disabled={!current || items.length === 0} onClick={onOpenCompare}
                style={{ padding: "2px 10px", fontSize: 11.5 }}>
          비교 열기 ({items.length + (current ? 1 : 0)})
        </button>
      </span>
    }>
      <table className="grid-table">
        <thead><tr><th>검사일</th><th>MOD</th><th>검사명</th><th></th></tr></thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.study_uid}>
              <td>{e.study_date}</td><td>{e.modality}</td>
              <td title={e.study_desc}>{e.study_desc}</td>
              <td><button style={{ padding: "0 7px", fontSize: 11 }} onClick={() => onRemove(e.study_uid)}>✕</button></td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={4} style={{ color: "var(--text-secondary)" }}>
              과거검사를 더블클릭해 추가 → 현재 검사와 함께 뷰어에서 비교
            </td></tr>
          )}
        </tbody>
      </table>
    </PanelBox>
  );
}

/* ── [E-좌] 상용구 패널 (F-18 — Modality×BodyPart 축, 화면분석 §5.6) ─────── */
interface Phrase { id: number; group: string; name: string; text: string; modality?: string; body_part?: string }
function PhrasePanel({ onInsert, current }: { onInsert: (text: string) => void; current: StudyDetail | null }) {
  const [items, setItems] = useState<Phrase[]>([]);
  const [sel, setSel] = useState<Phrase | null>(null);
  const [fitOnly, setFitOnly] = useState(true); // 현재 검사 맞춤(모달리티 일치 or 공통)
  const visible = items.filter((p) =>
    !fitOnly || !current || !p.modality || p.modality === current.modality);

  const load = useCallback(() => {
    api.getSetting("report.phrases").then((r) => {
      setItems(((r.value as { items?: Phrase[] }).items) ?? []);
    }).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const save = async (next: Phrase[]) => {
    await api.putSetting("report.phrases", { items: next }, "global");
    setItems(next);
  };
  const add = async () => {
    const modality = prompt("Modality (빈칸=공통)", current?.modality ?? "") ?? "";
    const body_part = prompt("부위 (빈칸=공통)", current?.body_part ?? "") ?? "";
    const name = prompt("상용구 이름") ?? "";
    const text = prompt("본문") ?? "";
    if (!name || !text) return;
    await save([...items, {
      id: Date.now(), group: [modality, body_part].filter(Boolean).join("-") || "공통",
      name, text, modality, body_part,
    }]);
  };
  const edit = async () => {
    if (!sel) return;
    const text = prompt("본문 수정", sel.text) ?? sel.text;
    await save(items.map((p) => (p.id === sel.id ? { ...p, text } : p)));
  };
  const del = async () => {
    if (!sel) return;
    await save(items.filter((p) => p.id !== sel.id));
    setSel(null);
  };

  return (
    <PanelBox title="상용구 (Std)" right={
      <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
        <label style={{ fontSize: 10, display: "flex", gap: 2, alignItems: "center", textTransform: "none" }}>
          <input type="checkbox" checked={fitOnly} onChange={(e) => setFitOnly(e.target.checked)} />맞춤
        </label>
        {phraseButtons()}
      </span>
    }>
      {phraseBody()}
    </PanelBox>
  );

  function phraseButtons() {
    return (
      <span style={{ display: "flex", gap: 3 }}>
        <MiniBtn onClick={() => sel && onInsert(sel.text)} disabled={!sel}>삽입</MiniBtn>
        <MiniBtn onClick={add}>New</MiniBtn>
        <MiniBtn onClick={edit} disabled={!sel}>Edit</MiniBtn>
        <MiniBtn onClick={del} disabled={!sel}>Del</MiniBtn>
      </span>
    );
  }

  function phraseBody() {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          <table className="grid-table">
            <thead><tr><th>분류</th><th>NAME</th></tr></thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className={sel?.id === p.id ? "selected" : ""}
                    onClick={() => setSel(p)} onDoubleClick={() => onInsert(p.text)}>
                  <td>{p.group}</td><td title={p.text}>{p.name}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={2} style={{ color: "var(--text-secondary)" }}>
                  {items.length ? "맞춤 해제 시 전체 표시" : "New로 상용구 등록"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {sel && (
          <div style={{
            borderTop: "1px solid var(--border)", padding: 6, fontSize: 11.5,
            color: "var(--text-secondary)", maxHeight: 70, overflow: "auto",
          }}>
            {sel.text}
          </div>
        )}
      </div>
    );
  }
}

/* ── 키이미지 스트립 (F-16) ───────────────────── */
function KeyImageStrip({ studyId }: { studyId: number }) {
  const [items, setItems] = useState<InstanceThumb[]>([]);
  const [selected, setSelected] = useState<Map<string, KeyImage>>(new Map());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.instances(studyId).then((r) => {
      setItems(r.items);
      setSelected(new Map(r.key_images.map((k) => [k.sop_uid, k])));
    }).catch(() => setItems([]));
  }, [studyId]);

  if (items.length === 0) return null;
  const toggle = (it: InstanceThumb) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(it.sop_uid)) next.delete(it.sop_uid);
      else next.set(it.sop_uid, { sop_uid: it.sop_uid, orthanc_id: it.orthanc_id, instance_number: it.instance_number });
      return next;
    });
  };
  const save = async (kos: boolean) => {
    setBusy(true);
    try {
      await api.setKeyImages(studyId, [...selected.values()]);
      if (kos && selected.size > 0) { await api.sendKos(studyId); setMsg("KOS 전송됨"); }
      else setMsg("저장됨");
    } catch (e) { setMsg(e instanceof Error ? e.message : "실패"); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "3px 0" }}>
      <span style={{ fontSize: 10.5, color: "var(--text-secondary)", width: 56, flexShrink: 0 }}>
        KEY IMG<br />({selected.size}장)
      </span>
      <div style={{ display: "flex", gap: 3, overflowX: "auto" }}>
        {items.slice(0, 16).map((it) => (
          <img key={it.sop_uid} src={it.preview_url} alt="" onClick={() => toggle(it)}
               style={{
                 width: 40, height: 40, objectFit: "cover", borderRadius: 2, cursor: "pointer", flexShrink: 0,
                 border: selected.has(it.sop_uid) ? "2px solid var(--anno-keyimage)" : "1px solid var(--border)",
               }} />
        ))}
      </div>
      <MiniBtn onClick={() => save(false)} disabled={busy}>저장</MiniBtn>
      <MiniBtn onClick={() => save(true)} disabled={busy || selected.size === 0}>KOS</MiniBtn>
      {msg && <span style={{ fontSize: 10.5, color: "var(--stat-final)" }}>{msg}</span>}
    </div>
  );
}

/* ── [E-중] 리포트 패널 (레퍼런스 메타테이블 + 3단) ── */
function ReportPanel({ detail, onChanged, insertRef }: {
  detail: StudyDetail | null;
  onChanged: () => void;
  insertRef: React.MutableRefObject<((t: string) => void) | null>;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [draft, setDraft] = useState<SrJson | null>(null);
  const [busy, setBusy] = useState(false);
  const current = reports[0] ?? null;

  // 음성 판독(STT, P3) — 브라우저 Web Speech API(ko-KR), 인식 결과를 Conclusion에 덧붙임
  const [stt, setStt] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const toggleStt = () => {
    if (stt) { recRef.current?.stop(); setStt(false); return; }
    const w = window as unknown as Record<string, unknown>;
    const SR = (w.webkitSpeechRecognition ?? w.SpeechRecognition) as
      (new () => {
        lang: string; continuous: boolean; interimResults: boolean;
        onresult: (ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onend: () => void; onerror: () => void; start: () => void; stop: () => void;
      }) | undefined;
    if (!SR) { alert("이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome 권장)"); return; }
    const rec = new SR();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const texts: string[] = [];
      for (let i = ev.resultIndex; i < ev.results.length; i++) texts.push(ev.results[i][0].transcript);
      const text = texts.join(" ").trim();
      if (!text) return;
      setDraft((d) => {
        if (!d) return d;
        const n = structuredClone(d);
        if (n.impression[0]) n.impression[0].statement += (n.impression[0].statement ? " " : "") + text;
        return n;
      });
    };
    rec.onend = () => setStt(false);
    rec.onerror = () => setStt(false);
    recRef.current = rec;
    rec.start();
    setStt(true);
  };
  useEffect(() => () => recRef.current?.stop(), []);

  useEffect(() => {
    if (!detail) { setReports([]); setDraft(null); return; }
    api.reports(detail.id).then((r) => {
      setReports(r.items);
      setDraft(r.items[0] ? structuredClone(r.items[0].sr_json) : null);
    });
  }, [detail]);

  // 상용구 삽입 훅 (E-좌 → E-중)
  useEffect(() => {
    insertRef.current = (text: string) => {
      setDraft((d) => {
        if (!d) return d;
        const next = structuredClone(d);
        if (next.impression[0]) next.impression[0].statement += (next.impression[0].statement ? "\n" : "") + text;
        return next;
      });
    };
  }, [insertRef]);

  if (!detail) {
    return <PanelBox title="REPORT"><Empty>검사를 선택하세요</Empty></PanelBox>;
  }

  const finalized = current?.status === "finalized";
  const age = detail.birth_date ? `${new Date().getFullYear() - parseInt(detail.birth_date.slice(0, 4), 10)}세` : "-";

  const save = async () => {
    if (!current || !draft) return;
    setBusy(true);
    try { await api.updateReport(current.id, draft); onChanged(); } finally { setBusy(false); }
  };
  const finalize = async () => {
    if (!current || !draft) return;
    setBusy(true);
    try {
      if (!finalized) await api.updateReport(current.id, draft);
      await api.finalizeReport(current.id);
      onChanged();
    } finally { setBusy(false); }
  };

  return (
    <PanelBox title="REPORT" right={
      current && (
        <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
          {current.created_by === "ai" && <span className="badge ai">AI 초안 — 검토 필수</span>}
          <StatusBadge status={current.status === "draft" ? "draft_ready" : current.status} />
        </span>
      )
    }>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, overflow: "auto", height: "100%", padding: "0 2px" }}>
        {/* 메타 테이블 — 레퍼런스 [E-중] 형식 */}
        <table className="grid-table" style={{ fontSize: 11.5 }}>
          <tbody>
            <tr>
              <th style={{ width: 64 }}>ID</th><td>{detail.patient_key}</td>
              <th style={{ width: 50 }}>NAME</th><td>{detail.patient_name}</td>
              <th style={{ width: 42 }}>AGE</th><td>{age}</td>
              <th style={{ width: 40 }}>SEX</th><td>{detail.sex}</td>
            </tr>
            <tr>
              <th>Acc No</th><td>{detail.accession_no}</td>
              <th>검사명</th><td colSpan={3} title={detail.study_desc}>{detail.study_desc}</td>
              <th>검사일</th><td>{detail.study_date}</td>
            </tr>
            <tr>
              <th>Reporter</th>
              <td colSpan={5}>
                Dictator: {current?.created_by === "ai" ? `AI(${current.ai_model})` : current?.created_by ?? "-"} ·
                Reader: {current?.reviewed_by || "-"} · Conf1: {finalized ? current?.reviewed_by : "-"} ·
                Conf2: {(current?.diff_metrics as { confirm2?: { by: string } })?.confirm2?.by ?? "-"}
              </td>
              <th>확정일</th>
              <td>{current?.finalized_at ? current.finalized_at.slice(0, 10) : "-"}</td>
            </tr>
          </tbody>
        </table>

        <KeyImageStrip studyId={detail.id} />

        {!current || !draft ? (
          <Empty>
            리포트 없음
            <div style={{ marginTop: 6 }}>
              <MiniBtn onClick={async () => { await api.analyze(detail.id); onChanged(); }}>AI 초안 생성</MiniBtn>
            </div>
          </Empty>
        ) : (
          <>
            <SectionTitle>READING</SectionTitle>
            <div style={{ fontSize: 12 }}>
              {draft.comparison.summary && (
                <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>[비교] {draft.comparison.summary}</div>
              )}
              {draft.findings.map((f, i) => (
                <div key={i}>
                  <b>{f.organ}</b>: {f.observation}{" "}
                  {f.severity === "critical" && <span className="badge critical">CRITICAL</span>}
                </div>
              ))}
            </div>
            <SectionTitle>CONCLUSION</SectionTitle>
            {draft.impression.map((imp, i) => (
              <textarea key={i} value={imp.statement} disabled={finalized}
                        onChange={(e) => setDraft((d) => {
                          const n = structuredClone(d!); n.impression[i].statement = e.target.value; return n;
                        })}
                        style={{
                          width: "100%", background: "var(--bg-canvas)", color: "var(--text-primary)",
                          border: "1px solid var(--border)", borderRadius: 3, padding: 5,
                          fontFamily: "inherit", fontSize: 12.5, resize: "vertical", minHeight: 44,
                        }} />
            ))}
            {draft.recommendations.length > 0 && (
              <>
                <SectionTitle>RECOMMEND</SectionTitle>
                {draft.recommendations.map((r, i) => (
                  <div key={i} style={{ fontSize: 12 }}>- {r.action} ({r.timeframe})</div>
                ))}
              </>
            )}
            <div style={{ display: "flex", gap: 5, marginTop: "auto", paddingTop: 4 }}>
              <MiniBtn onClick={async () => { await api.analyze(detail.id); onChanged(); }}>초안 재생성</MiniBtn>
              <MiniBtn onClick={() => downloadReportPdf(current.id)}>PDF</MiniBtn>
              {!finalized && (
                <MiniBtn onClick={toggleStt} title="음성 판독(STT) — 한국어 받아쓰기 → Conclusion"
                         style={stt ? { background: "var(--stat-emergency)", color: "#fff" } : undefined}>
                  {stt ? "🎤 녹음중" : "🎤 음성"}
                </MiniBtn>
              )}
              {!finalized && (
                <MiniBtn title="판독 보류(Suspend) — 토글" onClick={async () => {
                  await api.suspendReport(current.id); onChanged();
                }}>{current.status === "suspended" ? "보류 해제" : "보류"}</MiniBtn>
              )}
              {finalized && !(current.diff_metrics as { confirm2?: unknown })?.confirm2 && (
                <MiniBtn title="2차 승인(Conf2) — 1차와 다른 판독의 권장" onClick={async () => {
                  await api.confirm2Report(current.id); onChanged();
                }}>2차 승인</MiniBtn>
              )}
              {finalized && (
                <MiniBtn onClick={async () => { setBusy(true); try { await api.sendSr(current.id); alert("DICOM SR 전송 완료"); } finally { setBusy(false); } }}>
                  SR 전송
                </MiniBtn>
              )}
              <div style={{ flex: 1 }} />
              <MiniBtn onClick={save} disabled={busy || finalized}>저장</MiniBtn>
              <button className="primary" style={{ padding: "2px 12px", fontSize: 12 }}
                      onClick={finalize} disabled={busy || finalized}>
                {finalized ? "확정됨" : "확정 (서명)"}
              </button>
            </div>
          </>
        )}
      </div>
    </PanelBox>
  );
}

/* ── [E-우] 오더/예약 (RIS — P2): MWL 내보내기 + MPPS 상태 매핑 ─────── */
const ORDER_STATUS: Record<string, string> = {
  scheduled: "예약", in_progress: "진행중", completed: "완료", cancelled: "취소",
};
function OrdersPanel({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<OrderRow[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    api.orders().then((r) => setItems(r.items)).catch(() => {});
  }, []);
  useEffect(load, [load, refreshKey]);

  const add = async () => {
    const patient_key = prompt("환자 ID");
    if (!patient_key) return;
    const patient_name = prompt("환자 이름") ?? "";
    const modality = (prompt("Modality (CR/CT/MR/US…)", "CR") ?? "CR").toUpperCase();
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const scheduled_date = prompt("예약일 (YYYYMMDD)", today) ?? "";
    const procedure_desc = prompt("오더명 (예: Chest PA)") ?? "";
    try {
      await api.createOrder({ patient_key, patient_name, modality, scheduled_date, procedure_desc });
      load();
    } catch (e) { alert(e instanceof Error ? e.message : "오더 등록 실패"); }
  };
  const setSt = async (id: number, status: string) => {
    try { await api.setOrderStatus(id, status); load(); }
    catch (e) { alert(e instanceof Error ? e.message : "상태 변경 실패"); }
  };
  const exportMwl = async () => {
    try {
      const r = await api.exportMwl();
      setMsg(`MWL ${r.count}건 내보냄 → 장비 C-FIND 응답`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "MWL 실패"); }
  };

  return (
    <PanelBox title="오더/예약 (RIS·MWL)" right={
      <span style={{ display: "flex", gap: 3 }}>
        <MiniBtn onClick={add}>New</MiniBtn>
        <MiniBtn onClick={exportMwl} title="scheduled 오더를 MWL(.wl)로 내보내기 — Orthanc worklists">MWL</MiniBtn>
      </span>
    }>
      <table className="grid-table">
        <thead><tr><th>환자</th><th>오더명</th><th>MOD</th><th>예약일</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td title={o.accession_no}>{o.patient_name || o.patient_key}</td>
              <td title={o.procedure_desc}>{o.procedure_desc}</td>
              <td>{o.modality}</td>
              <td>{o.scheduled_date}</td>
              <td>{ORDER_STATUS[o.status] ?? o.status}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {o.status === "scheduled" && (
                  <MiniBtn title="검사 시작 (MPPS IN PROGRESS)" onClick={() => setSt(o.id, "in_progress")}>시작</MiniBtn>
                )}
                {o.status === "in_progress" && (
                  <MiniBtn title="검사 완료 (MPPS COMPLETED)" onClick={() => setSt(o.id, "completed")}>완료</MiniBtn>
                )}
                {(o.status === "scheduled" || o.status === "in_progress") && (
                  <MiniBtn title="취소 (MPPS DISCONTINUED)" onClick={() => setSt(o.id, "cancelled")}>✕</MiniBtn>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={6} style={{ color: "var(--text-secondary)" }}>오더 없음 — New로 등록, MWL로 장비 전달</td></tr>
          )}
        </tbody>
      </table>
      {msg && <div style={{ padding: "3px 8px", fontSize: 10.5, color: "var(--stat-final)" }}>{msg}</div>}
    </PanelBox>
  );
}

/* ── 컨텍스트 메뉴 (디자인 §3.3) ─────────────────── */
function ContextMenu({ x, y, row, onAction, onClose }: {
  x: number; y: number; row: StudyRow;
  onAction: (a: string) => void; onClose: () => void;
}) {
  useEffect(() => {
    const h = () => onClose();
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [onClose]);
  const Item = ({ a, label, danger }: { a: string; label: string; danger?: boolean }) => (
    <div onClick={() => { onAction(a); onClose(); }}
         style={{ padding: "5px 14px", cursor: "pointer", fontSize: 12.5, color: danger ? "var(--stat-emergency)" : undefined }}
         onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
         onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
      {label}
    </div>
  );
  const Sep = () => <div style={{ height: 1, background: "var(--border)", margin: "3px 0" }} />;
  return (
    <div style={{
      position: "fixed", left: x, top: y, zIndex: 300, minWidth: 180,
      background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 5,
      boxShadow: "0 6px 20px rgba(0,0,0,0.5)", padding: "4px 0",
    }}>
      <Item a="viewdraft" label="View&Draft (자체 뷰어)" />
      <Item a="viewer" label="OHIF 뷰어 (보조)" />
      <Item a="3d" label="3D 뷰어 (MPR/MIP)" />
      <Item a="compare" label="비교세트에 추가" />
      <Sep />
      <Item a="pdf" label="PDF 내보내기" />
      <Item a="copyreport" label="과거 판독 복사 (Copy Report)" />
      <Item a="regen" label="AI 초안 재생성" />
      <Sep />
      <Item a="emergency" label={row.emergency ? "Emergency 해제" : "⚠ Emergency 지정"} danger={!row.emergency} />
    </div>
  );
}

/* ── 패널 드래그 래퍼 — 좌측 그립을 끌어 같은 행 안에서 자리 교환 ── */
function DraggablePanel({ zone, k, onDrop, style, children }: {
  zone: "d" | "e"; k: string;
  onDrop: (zone: "d" | "e", src: string, dst: string) => void;
  style?: React.CSSProperties; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", minWidth: 0, minHeight: 0, ...style }}
         onDragOver={(e) => e.preventDefault()}
         onDrop={(e) => {
           const src = e.dataTransfer.getData(`text/sv-panel-${zone}`);
           if (src) onDrop(zone, src, k);
         }}>
      <div draggable title="패널 이동 — 드래그해서 자리 교환"
           onDragStart={(e) => e.dataTransfer.setData(`text/sv-panel-${zone}`, k)}
           style={{ width: 10, flexShrink: 0, cursor: "grab", display: "flex", alignItems: "center",
                    justifyContent: "center", color: "var(--text-secondary)", fontSize: 9,
                    background: "var(--bg-elevated)", borderRadius: "4px 0 0 4px",
                    border: "1px solid var(--border)", borderRight: "none" }}>
        ⋮
      </div>
      <div style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0 }}>{children}</div>
    </div>
  );
}

/* ── 공통 소품 ─────────────────────────────────── */
function PanelBox({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, flex: 1,
      background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", padding: "3px 8px", flexShrink: 0,
        background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)",
        fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase",
      }}>
        {title}<div style={{ flex: 1 }} />{right}
      </div>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>{children}</div>
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: 0.5,
      borderBottom: "1px solid var(--border)", paddingBottom: 2, marginTop: 2,
    }}>{children}</div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 14, color: "var(--text-secondary)", fontSize: 12.5 }}>{children}</div>;
}
function MiniBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} style={{ padding: "2px 9px", fontSize: 11.5, ...props.style }} />;
}

/* ── F-22 일괄 검토 모달 ─────────────────────────── */
function BatchReviewModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState<BatchCandidate[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  useEffect(() => {
    api.batchReview().then((r) => {
      setItems(r.items);
      setChecked(new Set(r.items.map((i) => i.report_id)));
    });
  }, []);
  const toggle = (id: number) => setChecked((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const confirm = async () => {
    // 03b 가드레일: 대량 확정 = 파괴적 액션 — 대상·건수 명시 후 사용자 확인 강제
    if (!window.confirm(`AI 초안 ${checked.size}건을 일괄 확정(서명)합니다.\n확정 후에는 수정할 수 없습니다. 진행할까요?`)) return;
    setBusy(true);
    try { const r = await api.batchFinalize([...checked]); setResult(`${r.finalized}/${r.total}건 확정`); onDone(); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 100 }}>
      <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, width: 760, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
          <b>AI 초안 일괄 검토 (F-22)</b>
          <span style={{ color: "var(--text-secondary)", fontSize: 12, marginLeft: 8 }}>critical 초안은 자동 제외 — 개별 검토 필요</span>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          <table className="grid-table">
            <thead><tr><th></th><th>환자</th><th>검사일</th><th>MOD</th><th>검사명</th><th>AI 임프레션</th><th>신뢰도</th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.report_id} onClick={() => toggle(c.report_id)}>
                  <td><input type="checkbox" checked={checked.has(c.report_id)} readOnly /></td>
                  <td>{c.patient_name} ({c.patient_key})</td>
                  <td>{c.study_date}</td><td>{c.modality}</td>
                  <td title={c.study_desc}>{c.study_desc}</td>
                  <td style={{ color: "var(--ai)", maxWidth: 240 }} title={c.impression}>{c.impression}</td>
                  <td>{c.confidence}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-secondary)", padding: 20 }}>대상 초안 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
          {result && <span style={{ color: "var(--stat-final)" }}>{result}</span>}
          <div style={{ flex: 1 }} />
          <button className="primary" disabled={busy || checked.size === 0} onClick={confirm}>
            선택 {checked.size}건 일괄 확정
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════ 워크리스트 워크스페이스 루트 ════ */
export function Worklist() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [searchText, setSearchText] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [items, setItems] = useState<StudyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<StudyDetail | null>(null);
  const [compareSet, setCompareSet] = useState<CompareItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshSec, setRefreshSec] = useState(10);
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [findFields, setFindFields] = useState<string[]>(DEFAULT_FIND_FIELDS);
  const [dblAction, setDblAction] = useState<"viewer2d" | "ohif">("viewer2d");
  const [batchOpen, setBatchOpen] = useState(false);
  const [viewer3dUid, setViewer3dUid] = useState<string | null>(null);
  const [viewer2dDetail, setViewer2dDetail] = useState<StudyDetail | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: StudyRow } | null>(null);
  const [nlPreview, setNlPreview] = useState<NlQueryResult | null>(null);
  const [nlBusy, setNlBusy] = useState(false);
  // 패널 배치 사용자화(드래그) — D구역(과거검사/비교세트)·E구역(상용구/리포트/오더)
  const [panelOrder, setPanelOrder] = useState<{ d: string[]; e: string[] }>({
    d: ["prior", "compare"], e: ["std", "report", "orders"],
  });
  // UBPACS-Z: 워크리스트 페이지 탭(최대 10) + 검색 폴더 트리 (서버 로밍)
  const [tabs, setTabs] = useState<WorklistTab[]>([DEFAULT_TAB]);
  const [activeTabId, setActiveTabId] = useState(DEFAULT_TAB.id);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [selNodeId, setSelNodeId] = useState<string | null>(null);
  const insertRef = useRef<((t: string) => void) | null>(null);

  // 사용자 환경설정 로드 (화면분석 §5.4/§5.5)
  useEffect(() => {
    loadHangingPrefs();
    api.getSetting("worklist.prefs").then((r) => {
      const v = r.value as {
        auto_refresh_sec?: number; default_status?: string; columns?: string[];
        find_fields?: string[]; dbl_action?: "viewer2d" | "ohif";
      };
      if (v.auto_refresh_sec !== undefined) setRefreshSec(v.auto_refresh_sec);
      if (v.default_status) setFilters((f) => ({ ...f, status: v.default_status! }));
      if (v.columns?.length) setColumns(v.columns.filter((c) => COLUMN_DEFS[c]));
      if (v.find_fields?.length) setFindFields(v.find_fields.filter((c) => FIND_FIELDS[c]));
      if (v.dbl_action) setDblAction(v.dbl_action);
      const po = (v as { panel_order?: { d?: string[]; e?: string[] } }).panel_order;
      if (po?.d?.length === 2 && po?.e?.length === 3) setPanelOrder({ d: po.d, e: po.e });
    }).catch(() => {});
    loadTabs().then(setTabs).catch(() => {});
    loadTree().then(setTreeNodes).catch(() => {});
    // ETC 섹션의 3D 버튼(Viewer2D 내부) → 3D 뷰어 전환
    const h = (e: Event) => setViewer3dUid((e as CustomEvent).detail as string);
    window.addEventListener("sv-open-3d", h);
    // 07 A.2 SearchShortcut 저장/적용
    const onSave = () => {
      const label = prompt("바로가기 이름 (예: 오늘 CT 미판독)");
      if (!label) return;
      const list = JSON.parse(localStorage.getItem("sv_shortcuts") ?? "[]")
        .filter((s: { label: string }) => s.label !== label);
      list.push({ label, filters: filtersRef.current, searchText: searchRef.current });
      localStorage.setItem("sv_shortcuts", JSON.stringify(list));
      alert(`'${label}' 저장됨`);
    };
    const onApply = (e: Event) => {
      const sc = (e as CustomEvent).detail as { filters: Record<string, string>; searchText: string };
      setFilters(sc.filters ?? {});
      setSearchText(sc.searchText ?? "");
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener("sv-save-shortcut", onSave);
    window.addEventListener("sv-apply-shortcut", onApply);
    return () => {
      window.removeEventListener("sv-open-3d", h);
      window.removeEventListener("sv-save-shortcut", onSave);
      window.removeEventListener("sv-apply-shortcut", onApply);
    };
  }, []);
  const filtersRef = useRef(filters);
  const searchRef = useRef(searchText);
  useEffect(() => { filtersRef.current = filters; searchRef.current = searchText; }, [filters, searchText]);

  // 판독 단축키(UBPACS-Z §5): Enter=View&Draft, B=일괄검토, E=Emergency, F5=새로고침
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (viewer2dDetail || viewer3dUid || batchOpen) return; // 모달/뷰어 우선
      if (e.key === "Enter" && selected) { e.preventDefault(); void doAction("viewdraft"); }
      else if (e.key.toLowerCase() === "b") setBatchOpen(true);
      else if (e.key.toLowerCase() === "e" && selected) void doAction("emergency");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, viewer2dDetail, viewer3dUid, batchOpen]);

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { q: searchText };
    for (const k of ["pid", "pname", "sex", "desc", "modality", "status", "body_part", "finding", "emergency"]) {
      if (filters[k]) p[k] = filters[k];
    }
    if (filters.date_from_iso) p.date_from = filters.date_from_iso.replaceAll("-", "");
    if (filters.date_to_iso) p.date_to = filters.date_to_iso.replaceAll("-", "");
    if (filters.tree_from) p.date_from = filters.tree_from;
    return p;
  }, [filters, searchText]);

  useEffect(() => {
    api.worklist(queryParams).then((r) => { setItems(r.items); setTotal(r.total); }).catch(() => {});
  }, [queryParams, refreshKey]);

  useEffect(() => {
    if (!refreshSec) return;
    const t = setInterval(() => setRefreshKey((k) => k + 1), refreshSec * 1000);
    return () => clearInterval(t);
  }, [refreshSec]);

  const onSelect = useCallback((row: StudyRow) => { api.study(row.id).then(setSelected); }, []);
  const onChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
    if (selected) api.study(selected.id).then(setSelected);
  }, [selected]);

  const openStudy = useCallback((row: StudyRow | StudyDetail) => {
    openViewer(row.study_uid, hpFor(row.modality));
  }, []);

  const doAction = useCallback(async (a: string, row?: StudyRow) => {
    const target = row ?? selected;
    switch (a) {
      case "refresh": setRefreshKey((k) => k + 1); break;
      case "batch": setBatchOpen(true); break;
      case "viewdraft":
        // View&Draft = 자체 뷰어(기본) — 더블클릭 동작은 환경설정에서 변경 가능
        if (target) {
          const d = await api.study(target.id);
          setSelected(d);
          if (dblAction === "ohif") openStudy(d);
          else setViewer2dDetail(d);
        }
        break;
      case "viewer2d":
        if (target) { const d = await api.study(target.id); setSelected(d); setViewer2dDetail(d); }
        break;
      case "viewer": if (target) openStudy(target); break;
      case "3d": if (target) setViewer3dUid(target.study_uid); break;
      case "compare":
        if (target) setCompareSet((prev) =>
          prev.some((c) => c.study_uid === target.study_uid) ? prev
            : [...prev, { id: target.id, study_uid: target.study_uid, study_date: target.study_date, modality: target.modality, study_desc: target.study_desc }]);
        break;
      case "pdf": {
        if (!target) break;
        const reps = await api.reports(target.id);
        if (reps.items[0]) downloadReportPdf(reps.items[0].id);
        break;
      }
      case "regen": if (target) { await api.analyze(target.id); onChanged(); } break;
      case "copyreport": {
        // ③ report_copy(UBPACS-Z): 동일 환자 최근 확정 판독을 현재 초안 Conclusion에 복사
        if (!target) break;
        const d = await api.study(target.id);
        for (const rel of d.related_exams) {
          if (rel.status !== "finalized") continue;
          const prior = (await api.reports(rel.id)).items.find((r) => r.status === "finalized");
          const cur = (await api.reports(target.id)).items[0];
          if (prior && cur && cur.status !== "finalized") {
            const sr = structuredClone(cur.sr_json);
            const copied = prior.sr_json.impression.map((i) => i.statement).join("\n");
            sr.impression[0].statement =
              (sr.impression[0].statement ? sr.impression[0].statement + "\n" : "") +
              `[과거판독 복사 ${rel.study_date}]\n${copied}`;
            await api.updateReport(cur.id, sr);
            onChanged();
            alert(`과거 확정 판독(${rel.study_date})을 Conclusion에 복사했습니다.`);
          }
          break;
        }
        break;
      }
      case "emergency":
        if (target) { await api.setPriority(target.id, !target.emergency); onChanged(); }
        break;
    }
  }, [selected, onSelect, openStudy, onChanged]);

  const openCompare = useCallback(() => {
    if (!selected) return;
    openViewerCompare([selected.study_uid, ...compareSet.map((c) => c.study_uid)], hpFor(selected.modality));
  }, [selected, compareSet]);

  // 묶음판독(report_merge): 현재 검사 + 비교세트 → 판독 1건 병합 (03b: 건수 명시 confirm)
  const doMerge = useCallback(async () => {
    if (!selected || compareSet.length === 0) return;
    if (!window.confirm(
      `현재 검사 + 비교세트 ${compareSet.length}건을 하나의 판독으로 병합(묶음판독)합니다.\n` +
      `부속 검사 소견은 [MOD 검사일] 태그로 합쳐집니다. 진행할까요?`)) return;
    try {
      await api.mergeReports([selected.id, ...compareSet.map((c) => c.id)]);
      setCompareSet([]);
      onChanged();
      alert("묶음판독 초안이 생성되었습니다 — REPORT 패널에서 검토하세요.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "묶음판독 실패");
    }
  }, [selected, compareSet, onChanged]);

  // S1 자연어 검색: 변환 → 미리보기 배너 → 사용자 적용
  const onNlSearch = useCallback(async (text: string) => {
    setNlBusy(true);
    try { setNlPreview(await api.nlQuery(text)); }
    catch (e) { alert(e instanceof Error ? e.message : "자연어 검색 실패"); }
    finally { setNlBusy(false); }
  }, []);

  /* ── UBPACS-Z 페이지 탭 + 검색 폴더 ── */
  // 탭 전환: 저장된 검색 정의를 페이지처럼 적용
  const pickTab = useCallback((tab: WorklistTab) => {
    setActiveTabId(tab.id);
    setSelNodeId(null);
    setSearchText("");
    setDatePreset(tab.filter.date ?? "all");
    setFilters(folderToFilters(tab.filter));
    setRefreshKey((k) => k + 1);
  }, []);

  // 현재 검색조건 스냅샷 → 새 페이지 등록 (최대 10)
  const addTab = useCallback(async (treeFilter?: { label: string; filter: WorklistTab["filter"] }) => {
    if (tabs.length >= 10) { alert("워크리스트 페이지는 최대 10개입니다 (UBPACS-Z 규격)"); return; }
    const label = prompt("페이지 이름 — 현재 검색조건이 저장됩니다 (예: CR, 응급실)",
                         treeFilter?.label ?? `WORKLIST ${tabs.length + 1}`);
    if (!label) return;
    const tab: WorklistTab = {
      id: newId(), label,
      filter: treeFilter?.filter ?? filtersToFolder(filtersRef.current, datePreset),
    };
    const next = [...tabs, tab];
    setTabs(next);
    setActiveTabId(tab.id);
    try { await saveTabs(next); } catch (e) { alert(e instanceof Error ? e.message : "페이지 저장 실패"); }
  }, [tabs, datePreset]);

  const removeTab = useCallback(async (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (!t || !window.confirm(`'${t.label}' 페이지를 삭제할까요?`)) return;
    const next = tabs.filter((x) => x.id !== id);
    const fixed = next.length ? next : [DEFAULT_TAB];
    setTabs(fixed);
    if (activeTabId === id) pickTab(fixed[0]);
    try { await saveTabs(fixed); } catch {}
  }, [tabs, activeTabId, pickTab]);

  // 폴더 클릭: 루트→폴더 경로 조건 누적 병합 적용 (예: 응급실›DR›Chest)
  const applyFolder = useCallback((node: TreeNode) => {
    setSelNodeId(node.id);
    const merged = mergedFilter(treeNodes, node.id) ?? node.filter;
    setDatePreset(merged.date ?? "");
    setFilters(folderToFilters(merged));
    setRefreshKey((k) => k + 1);
  }, [treeNodes]);

  const onTreeChange = useCallback((next: TreeNode[]) => {
    setTreeNodes(next);
    saveTree(next).catch((e) => alert(e instanceof Error ? e.message : "검색 폴더 저장 실패"));
  }, []);

  // 패널 자리 교환 + 서버 저장(로밍)
  const onPanelDrop = useCallback((zone: "d" | "e", src: string, dst: string) => {
    if (src === dst) return;
    setPanelOrder((prev) => {
      const arr = [...prev[zone]];
      const i = arr.indexOf(src), j = arr.indexOf(dst);
      if (i < 0 || j < 0) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      const next = { ...prev, [zone]: arr };
      api.getSetting("worklist.prefs").then((r) =>
        api.putSetting("worklist.prefs", { ...r.value, panel_order: next }, "user")).catch(() => {});
      return next;
    });
  }, []);

  const applyNlPreview = useCallback(() => {
    if (!nlPreview) return;
    const f = nlPreview.filter;
    const next: Record<string, string> = {};
    if (f.patient_id) next.pid = f.patient_id;
    if (f.patient_name) next.pname = f.patient_name;
    if (f.sex) next.sex = f.sex;
    if (f.modality) next.modality = f.modality;
    if (f.body_part) next.body_part = f.body_part;
    if (f.study_desc) next.desc = f.study_desc;
    if (f.status) next.status = f.status;
    if (f.finding) next.finding = f.finding;
    if (f.emergency) next.emergency = "true";
    const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    if (f.date_from) next.date_from_iso = iso(f.date_from);
    if (f.date_to) next.date_to_iso = iso(f.date_to);
    setDatePreset("all");
    setFilters(next);
    setNlPreview(null);
    setRefreshKey((k) => k + 1);
  }, [nlPreview]);

  const emergencyCount = useMemo(() => items.filter((i) => i.emergency).length, [items]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* UBPACS-Z: 워크리스트 페이지 탭 — 저장된 검색 정의 전환 */}
      <WorklistTabsBar tabs={tabs} activeId={activeTabId}
                       onPick={pickTab} onAdd={() => void addTab()} onRemove={(id) => void removeTab(id)} />
      <ActionToolbar selected={selected} onAction={(a) => doAction(a)}
                     searchText={searchText} setSearchText={setSearchText}
                     onSearch={() => setRefreshKey((k) => k + 1)}
                     onNlSearch={onNlSearch} />
      <FilterBar filters={filters} setFilters={setFilters} fields={findFields}
                 onSearch={() => setRefreshKey((k) => k + 1)} />

      {/* S1 자연어 검색 미리보기 — 적용 전 사용자 확인(03b: AI 결과는 항상 라벨링) */}
      {(nlBusy || nlPreview) && (
        <div style={{
          display: "flex", gap: 8, alignItems: "center", padding: "5px 10px",
          background: "var(--bg-panel)", borderBottom: "1px solid var(--ai)", fontSize: 12.5,
        }}>
          <span className="badge ai">AI 검색</span>
          {nlBusy ? (
            <span style={{ color: "var(--text-secondary)" }}>변환 중…</span>
          ) : nlPreview && (
            <>
              <span>해석: <b>{nlPreview.explanation}</b></span>
              {nlPreview.source !== "live" && (
                <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                  ({nlPreview.source === "mock" ? "규칙 기반" : "AI 실패 — 규칙 기반 폴백"})
                </span>
              )}
              <button className="primary" style={{ padding: "1px 12px", fontSize: 12 }} onClick={applyNlPreview}>적용</button>
              <button style={{ padding: "1px 10px", fontSize: 12 }} onClick={() => setNlPreview(null)}>취소</button>
            </>
          )}
        </div>
      )}

      {/* 중단: 검색 레일(기간+폴더 트리) + 메인 그리드 */}
      <div style={{ display: "flex", flex: 2.2, minHeight: 0 }}>
        <SearchRail active={datePreset} onPick={(key, from) => {
          setDatePreset(key);
          setFilters((f) => ({ ...f, tree_from: from, date_from_iso: "", date_to_iso: "" }));
        }} tree={
          <FolderTreeEditor nodes={treeNodes} onChange={onTreeChange}
                            selectedId={selNodeId} onSelect={applyFolder} applyHint />
        } />
        <StudyGrid items={items} columns={columns} selectedId={selected?.id ?? null}
                   onSelect={onSelect} onOpen={(r) => doAction("viewdraft", r)}
                   onContext={(e, r) => setCtx({ x: e.clientX, y: e.clientY, row: r })} />
      </div>

      {/* 하단1: 과거검사 | 비교세트 (디자인 §3 [D]) — 드래그 재배치 */}
      <div style={{ display: "flex", gap: 3, height: 140, padding: "3px 3px 0", flexShrink: 0 }}>
        {panelOrder.d.map((k) => (
          <DraggablePanel key={k} zone="d" k={k} onDrop={onPanelDrop} style={{ flex: 1 }}>
            {k === "prior" ? (
              <PriorStudiesGrid detail={selected}
                                onAddCompare={(e) => setCompareSet((prev) =>
                                  prev.some((c) => c.study_uid === e.study_uid) ? prev : [...prev, e])} />
            ) : (
              <ComparisonSetGrid items={compareSet} current={selected}
                                 onRemove={(uid) => setCompareSet((p) => p.filter((c) => c.study_uid !== uid))}
                                 onOpenCompare={openCompare} onMerge={doMerge} />
            )}
          </DraggablePanel>
        ))}
      </div>

      {/* 하단2: 상용구 | 리포트 | 오더 (디자인 §3 [E]) — 드래그 재배치 */}
      <div style={{ display: "flex", gap: 3, flex: 1.8, minHeight: 200, padding: 3 }}>
        {panelOrder.e.map((k) => (
          <DraggablePanel key={k} zone="e" k={k} onDrop={onPanelDrop}
                          style={k === "std" ? { width: 240, flexShrink: 0 }
                               : k === "orders" ? { width: 270, flexShrink: 0 }
                               : { flex: 1.6 }}>
            {k === "std" ? <PhrasePanel onInsert={(t) => insertRef.current?.(t)} current={selected} />
              : k === "orders" ? <OrdersPanel refreshKey={refreshKey} />
              : <ReportPanel detail={selected} onChanged={onChanged} insertRef={insertRef} />}
          </DraggablePanel>
        ))}
      </div>

      {/* 상태바 (§2) */}
      <footer style={{
        display: "flex", gap: 16, padding: "3px 12px", background: "var(--bg-panel)",
        borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-secondary)", flexShrink: 0,
      }}>
        <span>[Q][H] Server: http://localhost:8000</span>
        <span>{total} results {selected ? "1 selected" : "0 selected"}</span>
        {emergencyCount > 0 && <span style={{ color: "var(--stat-emergency)" }}>⚠ Emergency {emergencyCount}건</span>}
        <span style={{ marginLeft: "auto" }}>{new Date().toLocaleString("ko-KR")}</span>
      </footer>

      {batchOpen && <BatchReviewModal onClose={() => setBatchOpen(false)} onDone={() => setRefreshKey((k) => k + 1)} />}
      {viewer2dDetail && (
        <Suspense fallback={
          <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200, display: "grid", placeItems: "center", color: "var(--text-secondary)" }}>
            뷰어 로딩…
          </div>
        }>
          <Viewer2D detail={viewer2dDetail} onClose={() => setViewer2dDetail(null)} />
        </Suspense>
      )}
      {viewer3dUid && (
        <Suspense fallback={
          <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200, display: "grid", placeItems: "center", color: "var(--text-secondary)" }}>
            3D 뷰어 로딩…
          </div>
        }>
          <Viewer3D studyUid={viewer3dUid} onClose={() => setViewer3dUid(null)} />
        </Suspense>
      )}
      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} row={ctx.row}
                     onAction={(a) => doAction(a, ctx.row)} onClose={() => setCtx(null)} />
      )}
    </div>
  );
}
