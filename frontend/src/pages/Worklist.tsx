// 워크리스트 워크스페이스 — 디자인 명세 §3 (5구역 중 MVP: 필터바+메인그리드+우측 패널)
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  downloadReportPdf,
  openViewer,
  type BatchCandidate,
  type InstanceThumb,
  type KeyImage,
  type Report,
  type SrJson,
  type StudyDetail,
  type StudyRow,
} from "../api";

/** F-18: 모달리티별 행잉 매핑 (viewer.prefs.hanging) — 모듈 레벨 캐시 */
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
              onDoubleClick={() => {
                onSelect(row);
                openViewer(row.study_uid, hpFor(row.modality)); // View&Draft (§3.1) + F-18 행잉
              }}
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
        <button onClick={() => downloadReportPdf(current.id)} disabled={busy}>PDF</button>
        {finalized && (
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await api.sendSr(current.id);
                alert("DICOM SR 전송 완료 — 뷰어에서 SR 시리즈 확인 가능");
              } finally { setBusy(false); }
            }}
            disabled={busy}
            title="확정 판독을 DICOM SR로 검사에 저장"
          >
            SR 전송
          </button>
        )}
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

/* ── F-16: 키이미지 선택 (KOS) ────────────────────── */
function KeyImagePicker({ studyId }: { studyId: number }) {
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
      else next.set(it.sop_uid, {
        sop_uid: it.sop_uid, orthanc_id: it.orthanc_id, instance_number: it.instance_number,
      });
      return next;
    });
  };

  const save = async (sendKos: boolean) => {
    setBusy(true);
    setMsg("");
    try {
      await api.setKeyImages(studyId, [...selected.values()]);
      if (sendKos && selected.size > 0) {
        await api.sendKos(studyId);
        setMsg("KOS 전송 완료");
      } else {
        setMsg("저장됨");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "실패");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, overflowX: "auto", padding: "4px 0" }}>
        {items.slice(0, 24).map((it) => {
          const on = selected.has(it.sop_uid);
          return (
            <img
              key={it.sop_uid}
              src={it.preview_url}
              alt={`#${it.instance_number}`}
              title={`Instance ${it.instance_number}${on ? " — 키이미지" : ""}`}
              onClick={() => toggle(it)}
              style={{
                width: 64, height: 64, objectFit: "cover", cursor: "pointer",
                borderRadius: 3, flexShrink: 0,
                border: on ? "2px solid var(--anno-keyimage)" : "1px solid var(--border)",
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          {selected.size}장 선택{msg && ` · ${msg}`}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => save(false)} disabled={busy}>저장</button>
        <button onClick={() => save(true)} disabled={busy || selected.size === 0}
                title="키이미지를 DICOM KOS로 검사에 저장 (F-16)">
          KOS 전송
        </button>
      </div>
    </div>
  );
}

/* ── F-22: AI 초안 일괄 검토 모달 (디자인 §3.3) ────── */
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

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.batchFinalize([...checked]);
      setResult(`${r.finalized}/${r.total}건 확정 완료`);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "grid", placeItems: "center", zIndex: 100,
    }}>
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
        width: 720, maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
          <b>AI 초안 일괄 검토</b>
          <span style={{ color: "var(--text-secondary)", fontSize: 12, marginLeft: 8 }}>
            critical 소견 초안은 자동 제외 — 개별 검토 필요
          </span>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          <table className="grid-table">
            <thead>
              <tr><th></th><th>환자</th><th>검사일</th><th>MOD</th><th>검사명</th><th>AI 임프레션</th><th>신뢰도</th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.report_id} onClick={() => toggle(c.report_id)}>
                  <td><input type="checkbox" checked={checked.has(c.report_id)} readOnly /></td>
                  <td>{c.patient_name} ({c.patient_key})</td>
                  <td>{c.study_date}</td>
                  <td>{c.modality}</td>
                  <td title={c.study_desc}>{c.study_desc}</td>
                  <td style={{ color: "var(--ai)", maxWidth: 240 }} title={c.impression}>{c.impression}</td>
                  <td>{c.confidence}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-secondary)", padding: 20 }}>
                  일괄 검토 대상 초안이 없습니다
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
          {result && <span style={{ color: "var(--stat-final)" }}>{result}</span>}
          <div style={{ flex: 1 }} />
          <button
            className="primary"
            disabled={busy || checked.size === 0}
            onClick={confirm}
          >
            선택 {checked.size}건 일괄 확정
          </button>
        </div>
      </div>
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
  const [batchOpen, setBatchOpen] = useState(false);
  const [refreshSec, setRefreshSec] = useState(10);

  // 사용자 환경설정 로드 (worklist.prefs + viewer.prefs) — 화면분석 §5.4
  useEffect(() => {
    loadHangingPrefs();
    api.getSetting("worklist.prefs").then((r) => {
      const v = r.value as { auto_refresh_sec?: number; default_status?: string };
      if (v.auto_refresh_sec !== undefined) setRefreshSec(v.auto_refresh_sec);
      if (v.default_status) setParams((p) => ({ ...p, status: v.default_status! }));
    }).catch(() => {});
  }, []);

  const search = useCallback((p: Record<string, string>) => {
    setParams(p);
  }, []);

  useEffect(() => {
    api.worklist(params).then((r) => {
      setItems(r.items);
      setTotal(r.total);
    }).catch(() => {});
  }, [params, refreshKey]);

  // 자동 갱신 (화면분석 §5.4 Status Check — 주기는 사용자 설정, 0=끔)
  useEffect(() => {
    if (!refreshSec) return;
    const t = setInterval(() => setRefreshKey((k) => k + 1), refreshSec * 1000);
    return () => clearInterval(t);
  }, [refreshSec]);

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
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <div style={{ flex: 1 }}><FilterBar onSearch={search} /></div>
        <div style={{
          display: "flex", alignItems: "center", padding: "0 8px",
          background: "var(--bg-panel)", borderBottom: "1px solid var(--border)",
        }}>
          <button onClick={() => setBatchOpen(true)}>일괄 검토 (F-22)</button>
        </div>
      </div>
      {batchOpen && (
        <BatchReviewModal
          onClose={() => setBatchOpen(false)}
          onDone={() => setRefreshKey((k) => k + 1)}
        />
      )}
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
            <div style={{
              padding: "8px 10px", borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{selected.patient_name}</b>{" "}
                <span style={{ color: "var(--text-secondary)" }}>
                  {selected.patient_key} · {selected.modality} · {selected.study_date}
                </span>
              </div>
              <button className="primary" onClick={() => openViewer(selected.study_uid, hpFor(selected.modality))}>
                뷰어 열기
              </button>
            </div>
            <div style={{ padding: "4px 10px" }}>
              <PanelTitle>Related Exams (F-14)</PanelTitle>
              <RelatedExams detail={selected} />
            </div>
            <div style={{ padding: "4px 10px", borderTop: "1px solid var(--border)" }}>
              <PanelTitle>Key Images (F-16)</PanelTitle>
              <KeyImagePicker studyId={selected.id} />
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
