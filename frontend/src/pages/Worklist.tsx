// 워크리스트 워크스페이스 — 디자인 명세 §3 (5구역 중 MVP: 필터바+메인그리드+우측 패널)
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type Report,
  type SrJson,
  type StudyDetail,
  type StudyRow,
} from "../api";

const STATUS_LABEL: Record<string, string> = {
  received: "도착",
  draft_ready: "AI초안",
  reading: "판독중",
  finalized: "확정",
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/* ── [B] 필터 바 (§3.1) ───────────────────────────── */
function FilterBar({ onSearch }: { onSearch: (p: Record<string, string>) => void }) {
  const [q, setQ] = useState("");
  const [modality, setModality] = useState("");
  const [status, setStatus] = useState("");
  const [finding, setFinding] = useState("");

  const fire = useCallback(() => {
    onSearch({ q, modality, status, finding });
  }, [q, modality, status, finding, onSearch]);

  return (
    <div
      style={{
        display: "flex", gap: 6, padding: 8, background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)", alignItems: "center",
      }}
    >
      <input
        placeholder="환자 ID / 이름" value={q} style={{ width: 160 }}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && fire()}
      />
      <select value={modality} onChange={(e) => setModality(e.target.value)}>
        <option value="">전체 Modality</option>
        {["CR", "CT", "MR", "US", "MG", "XA", "NM", "DX"].map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">전체 상태</option>
        <option value="received">도착</option>
        <option value="draft_ready">AI초안</option>
        <option value="reading">판독중</option>
        <option value="finalized">확정</option>
      </select>
      <input
        placeholder="소견/임프레션 검색 (F-2)" value={finding} style={{ flex: 1, maxWidth: 320 }}
        onChange={(e) => setFinding(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && fire()}
      />
      <button className="primary" onClick={fire}>SEARCH</button>
    </div>
  );
}

/* ── [C] 메인 검사 그리드 (§3.1) ───────────────────── */
function StudyGrid({
  items, selectedId, onSelect,
}: {
  items: StudyRow[];
  selectedId: number | null;
  onSelect: (row: StudyRow) => void;
}) {
  return (
    <div style={{ overflow: "auto", flex: 1 }}>
      <table className="grid-table">
        <thead>
          <tr>
            <th>상태</th><th>AI</th><th>ID</th><th>이름</th><th>성별</th>
            <th>검사일</th><th>MOD</th><th>부위</th><th>검사명</th>
            <th>임프레션 (AI 미리보기)</th><th>Srs</th><th>Img</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr
              key={row.id}
              className={[
                row.id === selectedId ? "selected" : "",
                row.emergency ? "emergency" : "",
              ].join(" ")}
              onClick={() => onSelect(row)}
            >
              <td><StatusBadge status={row.status} /></td>
              <td>
                {row.critical ? (
                  <span className="badge critical">CRITICAL</span>
                ) : row.report_status === "draft" ? (
                  <span className="badge ai">초안</span>
                ) : null}
              </td>
              <td>{row.patient_key}</td>
              <td>{row.patient_name}</td>
              <td>{row.sex}</td>
              <td>{row.study_date}</td>
              <td>{row.modality}</td>
              <td>{row.body_part}</td>
              <td title={row.study_desc}>{row.study_desc}</td>
              <td style={{ color: "var(--ai)", maxWidth: 280 }} title={row.impression_preview}>
                {row.impression_preview}
              </td>
              <td>{row.series_count}</td>
              <td>{row.instance_count}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={12} style={{ color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>
              검사가 없습니다
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── [E-중] 리포트 패널: AI 초안의 1급 표면 (§3.2) ──── */
function ReportPanel({
  detail, onChanged,
}: {
  detail: StudyDetail;
  onChanged: () => void;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [draft, setDraft] = useState<SrJson | null>(null);
  const [busy, setBusy] = useState(false);
  const current = reports[0] ?? null;

  useEffect(() => {
    api.reports(detail.id).then((r) => {
      setReports(r.items);
      setDraft(r.items[0]?.sr_json ?? null);
    });
  }, [detail.id]);

  const save = async () => {
    if (!current || !draft) return;
    setBusy(true);
    try {
      await api.updateReport(current.id, draft);
      onChanged();
    } finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!current || !draft) return;
    setBusy(true);
    try {
      if (current.status !== "finalized") await api.updateReport(current.id, draft);
      await api.finalizeReport(current.id);
      onChanged();
    } finally { setBusy(false); }
  };

  const regenerate = async () => {
    await api.analyze(detail.id);
    onChanged();
  };

  if (!current || !draft) {
    return (
      <div style={{ padding: 16, color: "var(--text-secondary)" }}>
        리포트 없음
        <div style={{ marginTop: 8 }}>
          <button onClick={regenerate}>AI 초안 생성</button>
        </div>
      </div>
    );
  }

  const finalized = current.status === "finalized";
  const setImpression = (i: number, statement: string) => {
    const next = structuredClone(draft);
    next.impression[i].statement = statement;
    setDraft(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusBadge status={current.status === "draft" ? "draft_ready" : current.status} />
        {current.created_by === "ai" && (
          <span className="badge ai">AI 생성 초안 — 반드시 검토 필요</span>
        )}
        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          v{current.version} {current.ai_model && `· ${current.ai_model}`}
        </span>
      </div>

      {/* Comparison (§3.2: 근거 표시) */}
      <section>
        <PanelTitle>Comparison</PanelTitle>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{draft.comparison.summary}</div>
      </section>

      {/* Reading = findings */}
      <section>
        <PanelTitle>Reading</PanelTitle>
        {draft.findings.map((f, i) => (
          <div key={i} style={{ fontSize: 12.5, marginBottom: 4 }}>
            <b>{f.organ}</b>: {f.observation}{" "}
            {f.severity === "critical" && <span className="badge critical">CRITICAL</span>}
          </div>
        ))}
      </section>

      {/* Conclusion = impression (편집 가능) */}
      <section>
        <PanelTitle>Conclusion</PanelTitle>
        {draft.impression.map((imp, i) => (
          <textarea
            key={i}
            value={imp.statement}
            disabled={finalized}
            onChange={(e) => setImpression(i, e.target.value)}
            style={{
              width: "100%", background: "var(--bg-panel)", color: "var(--text-primary)",
              border: "1px solid var(--border)", borderRadius: 4, padding: 6,
              fontFamily: "inherit", fontSize: 12.5, resize: "vertical", minHeight: 40,
            }}
          />
        ))}
      </section>

      {draft.recommendations.length > 0 && (
        <section>
          <PanelTitle>Recommend</PanelTitle>
          {draft.recommendations.map((r, i) => (
            <div key={i} style={{ fontSize: 12.5 }}>- {r.action} ({r.timeframe})</div>
          ))}
        </section>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
        <button onClick={regenerate} disabled={busy}>초안 재생성</button>
        <div style={{ flex: 1 }} />
        <button onClick={save} disabled={busy || finalized}>저장</button>
        <button className="primary" onClick={finalize} disabled={busy || finalized}>
          {finalized ? "확정됨" : "확정 (서명)"}
        </button>
      </div>
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: "var(--text-secondary)",
      textTransform: "uppercase", letterSpacing: 0.5, margin: "6px 0 4px",
      borderBottom: "1px solid var(--border)", paddingBottom: 2,
    }}>
      {children}
    </div>
  );
}

/* ── [D-좌] 과거검사 (F-14) ───────────────────────── */
function RelatedExams({ detail }: { detail: StudyDetail }) {
  return (
    <div style={{ overflow: "auto", maxHeight: 160 }}>
      <table className="grid-table">
        <thead>
          <tr><th>검사일</th><th>MOD</th><th>검사명</th><th>상태</th></tr>
        </thead>
        <tbody>
          {detail.related_exams.map((e) => (
            <tr key={e.id}>
              <td>{e.study_date}</td><td>{e.modality}</td>
              <td title={e.study_desc}>{e.study_desc}</td>
              <td><StatusBadge status={e.status} /></td>
            </tr>
          ))}
          {detail.related_exams.length === 0 && (
            <tr><td colSpan={4} style={{ color: "var(--text-secondary)" }}>과거 검사 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── 워크리스트 워크스페이스 루트 ─────────────────── */
export function Worklist() {
  const [params, setParams] = useState<Record<string, string>>({});
  const [items, setItems] = useState<StudyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<StudyDetail | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const search = useCallback((p: Record<string, string>) => {
    setParams(p);
  }, []);

  useEffect(() => {
    api.worklist(params).then((r) => {
      setItems(r.items);
      setTotal(r.total);
    }).catch(() => {});
  }, [params, refreshKey]);

  // 자동 갱신 (화면분석 §5.4 Status Check → 10초 폴링)
  useEffect(() => {
    const t = setInterval(() => setRefreshKey((k) => k + 1), 10000);
    return () => clearInterval(t);
  }, []);

  const onSelect = useCallback((row: StudyRow) => {
    api.study(row.id).then(setSelected);
  }, []);

  const onChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
    if (selected) api.study(selected.id).then(setSelected);
  }, [selected]);

  const emergencyCount = useMemo(() => items.filter((i) => i.emergency).length, [items]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <FilterBar onSearch={search} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* [C] 메인 그리드 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <StudyGrid items={items} selectedId={selected?.id ?? null} onSelect={onSelect} />
        </div>
        {/* 우측: [D] 과거검사 + [E-중] 리포트 패널 */}
        {selected && (
          <aside style={{
            width: 420, borderLeft: "1px solid var(--border)", background: "var(--bg-panel)",
            display: "flex", flexDirection: "column", minHeight: 0,
          }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
              <b>{selected.patient_name}</b>{" "}
              <span style={{ color: "var(--text-secondary)" }}>
                {selected.patient_key} · {selected.modality} · {selected.study_date}
              </span>
            </div>
            <div style={{ padding: "4px 10px" }}>
              <PanelTitle>Related Exams (F-14)</PanelTitle>
              <RelatedExams detail={selected} />
            </div>
            <div style={{ flex: 1, minHeight: 0, borderTop: "1px solid var(--border)" }}>
              <ReportPanel detail={selected} onChanged={onChanged} />
            </div>
          </aside>
        )}
      </div>
      {/* 상태바 (§2) */}
      <footer style={{
        display: "flex", gap: 16, padding: "4px 12px", background: "var(--bg-panel)",
        borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-secondary)",
      }}>
        <span>{total} results</span>
        {emergencyCount > 0 && (
          <span style={{ color: "var(--stat-emergency)" }}>⚠ Emergency {emergencyCount}건</span>
        )}
        <span style={{ marginLeft: "auto" }}>{new Date().toLocaleString("ko-KR")}</span>
      </footer>
    </div>
  );
}
