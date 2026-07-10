// 판독 도크 — Viewer2D 에서 추출한 공유 컴포넌트 (레퍼런스 Report Window 디자인)
// [Report|History|Shortcuts|Templates] 탭 · Font size · CVR Notice · ◀▶ · Reset/Save/Approve
// 동작은 Viewer2D 내장 시절과 완전 동일(이사만) — 리포트 로드/저장/승인/상용구/단축키 포함.
import { useEffect, useRef, useState } from "react";
import { api, type PhraseRow, type Report, type StudyDetail } from "../api";

export function ReportDock({ detail, width, onLoadPrior, onStatus }: {
  detail: StudyDetail;
  width: number;                            // 도크 폭 (viewer.prefs.dockW)
  onLoadPrior: (examId: number) => void;    // 과거검사 비교 로드 — 활성 페인에 표시
  onStatus: (msg: string) => void;          // 상단 상태 표시줄 메시지
}) {
  const [vreports, setVreports] = useState<Report[]>([]);
  const report = vreports[0] ?? null;
  const [dockTab, setDockTab] = useState<"read" | "hist" | "std" | "tpl">("read");
  const [fontPx, setFontPx] = useState(12);
  const [reading, setReading] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [readingTouched, setReadingTouched] = useState(false);
  const [histView, setHistView] = useState<Report | null>(null);
  const [dockPhrases, setDockPhrases] = useState<PhraseRow[]>([]);
  // Setting>판독(Reading) 옵션 — report.prefs
  const [rdOpts, setRdOpts] = useState<{
    cvr_notice?: boolean; save_alert?: boolean; panel_tab?: string; sidebar_tab?: string;
    insert_pos?: string; key_save?: string; key_approve?: string;
  }>({});

  const initDockText = (r: Report | null) => {
    setHistView(null);
    setReadingTouched(false);
    if (!r) { setReading(""); setConclusion(""); return; }
    const sr = r.sr_json;
    const lines: string[] = [];
    if (sr.comparison?.summary) lines.push(`[비교] ${sr.comparison.summary}`);
    for (const f of sr.findings ?? []) {
      lines.push(`${f.organ ? f.organ + ": " : ""}${f.observation}${f.severity === "critical" ? " [CRITICAL]" : ""}`);
    }
    setReading(lines.join("\n"));
    setConclusion((sr.impression ?? []).map((i) => i.statement).join("\n"));
  };

  /* 리포트/상용구/판독 설정 로드 — 검사 전환 시 재로드 */
  useEffect(() => {
    api.reports(detail.id).then((r) => {
      setVreports(r.items);
      initDockText(r.items[0] ?? null);
    }).catch(() => {});
    api.phrases().then((r) => setDockPhrases(r.items)).catch(() => {});
    api.getSetting("report.prefs").then((r) => {
      const v = r.value as typeof rdOpts;
      setRdOpts(v);
      if (v.panel_tab === "template") setDockTab("read");  // 기본은 판독 — panel_tab은 사이드탭 기본
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  const buildDockSr = (): Report["sr_json"] | null => {
    if (!report) return null;
    const sr = structuredClone(report.sr_json);
    if (readingTouched) {
      // 자유 판독문으로 대체 — critical 여부는 텍스트 내 [CRITICAL] 표기로 유지
      sr.findings = reading.trim()
        ? [{ organ: "판독", observation: reading.trim(),
             severity: /\[CRITICAL\]/i.test(reading) ? "critical" : "normal", measurements: [] }]
        : [];
    }
    if (!sr.impression.length) sr.impression = [{ rank: 1, statement: "", confidence: "low", codes: [] }];
    sr.impression[0].statement = conclusion;
    return sr;
  };

  const dockSave = async () => {
    const sr = buildDockSr();
    if (!report || !sr) return;
    try {
      await api.updateReport(report.id, sr);
      const r = await api.reports(detail.id);
      setVreports(r.items);
      setReadingTouched(false);
      if (rdOpts.save_alert) alert("리포트가 저장되었습니다");
      else onStatus("리포트 저장됨");
    } catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); }
  };

  const dockApprove = async () => {
    const sr = buildDockSr();
    if (!report || !sr) return;
    if (!window.confirm("판독을 확정(승인·서명)합니다. 확정 후 수정할 수 없습니다.")) return;
    try {
      if (report.status !== "finalized") {
        await api.updateReport(report.id, sr);
        await api.finalizeReport(report.id);
      }
      const r = await api.reports(detail.id);
      setVreports(r.items);
      initDockText(r.items[0] ?? null);
      onStatus("판독 확정(서명) 완료");
    } catch (e) { alert(e instanceof Error ? e.message : "승인 실패"); }
  };

  const dockInsert = (p: PhraseRow) => {
    const pos = rdOpts.insert_pos ?? "end";
    const join = (cur: string, add: string) => !add ? cur : (cur ? `${cur}\n${add}` : add);
    if (pos === "cursor") {
      // 커서 위치 삽입은 결론 textarea 기준 — 포커스가 없으면 맨 끝
      const el = document.getElementById("sv-dock-conclusion") as HTMLTextAreaElement | null;
      if (el && document.activeElement === el && p.text) {
        const s = el.selectionStart ?? el.value.length;
        setConclusion((c) => c.slice(0, s) + p.text + c.slice(s));
        if (p.reading_text) setReading((r) => join(r, p.reading_text));
        return;
      }
    }
    if (p.reading_text) setReading((r) => join(r, p.reading_text));
    if (p.text) setConclusion((c) => join(c, p.text));
    setReadingTouched(true);
  };

  const dockApplyTemplate = (p: PhraseRow) => {
    if (!window.confirm(`템플릿 '${p.name}'으로 판독/결론을 교체할까요?`)) return;
    setReading(p.reading_text);
    setConclusion(p.text);
    setReadingTouched(true);
  };

  // 시스템 단축키(Setting>판독: 리포트 저장/승인) + Alt+상용구
  const comboOf = (e: KeyboardEvent) =>
    [e.ctrlKey && "Ctrl", e.shiftKey && "Shift", e.altKey && "Alt",
     e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join("+");
  const dockKeysRef = useRef({ rdOpts, dockPhrases });
  dockKeysRef.current = { rdOpts, dockPhrases };
  const dockSaveRef = useRef(dockSave); dockSaveRef.current = dockSave;
  const dockApproveRef = useRef(dockApprove); dockApproveRef.current = dockApprove;
  const dockInsertRef = useRef(dockInsert); dockInsertRef.current = dockInsert;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { rdOpts: o, dockPhrases: ph } = dockKeysRef.current;
      const combo = comboOf(e);
      if (combo === (o.key_save ?? "Ctrl+S")) { e.preventDefault(); void dockSaveRef.current(); return; }
      if (combo === (o.key_approve ?? "Ctrl+Shift+A")) { e.preventDefault(); void dockApproveRef.current(); return; }
      if (e.altKey && !e.ctrlKey && e.key.length === 1) {
        const hit = ph.find((p) => p.kind === "phrase" && p.shortcut === e.key.toUpperCase());
        if (hit) { e.preventDefault(); dockInsertRef.current(hit); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalizedDock = report?.status === "finalized";
  // In Viewer 는 related_exams 를 옵셔널로 다룬다(런타임에 없을 수 있음) — 방어적 기본값
  const relExams = detail.related_exams ?? [];
  const dockSig = (report?.diff_metrics as { signature?: { name: string; license_no: string; signed_at: string } })?.signature;
  const taStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg-canvas)", color: "var(--text-primary)",
    border: "1px solid var(--border)", borderRadius: 3, padding: 6,
    fontFamily: "inherit", fontSize: fontPx, resize: "none",
  };

  return (
    <div style={{ width, borderLeft: "1px solid var(--border)", background: "var(--bg-panel)",
                  display: "flex", flexDirection: "column", flexShrink: 0, minHeight: 0 }}>
      {/* 탭 */}
      <div style={{ display: "flex", background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
        {([["read", "Report"], ["hist", "History"], ["std", "Shortcuts"], ["tpl", "Templates"]] as const).map(([k, label]) => (
          <div key={k} onClick={() => setDockTab(k)}
               style={{ flex: 1, textAlign: "center", padding: "5px 0", fontSize: 11.5, cursor: "pointer",
                        fontWeight: dockTab === k ? 700 : 400,
                        borderBottom: dockTab === k ? "2px solid var(--accent)" : "2px solid transparent",
                        color: dockTab === k ? "var(--text-primary)" : "var(--text-secondary)" }}>
            {label}
          </div>
        ))}
      </div>
      {/* 상단 바: Font size · CVR · ◀▶ · Reset/Save/Approve */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 6px",
                    borderBottom: "1px solid var(--border)", fontSize: 11, flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-secondary)" }}>Font</span>
        <button style={{ padding: "0 6px" }} onClick={() => setFontPx((f) => Math.max(10, f - 1))}>−</button>
        <span>{fontPx}px</span>
        <button style={{ padding: "0 6px" }} onClick={() => setFontPx((f) => Math.min(22, f + 1))}>＋</button>
        <label title="CVR Notice — critical 소견 경고 표시" style={{ display: "flex", gap: 3, alignItems: "center" }}>
          <input type="checkbox" checked={!!rdOpts.cvr_notice}
                 onChange={(e) => setRdOpts((p) => ({ ...p, cvr_notice: e.target.checked }))} />
          CVR
        </label>
        <span style={{ flex: 1 }} />
        <button title="이전 과거검사 비교" style={{ padding: "0 7px" }}
                disabled={!relExams.length}
                onClick={() => onLoadPrior(relExams[0].id)}>◀</button>
        <button title="다음 과거검사 비교" style={{ padding: "0 7px" }}
                disabled={relExams.length < 2}
                onClick={() => onLoadPrior(relExams[1].id)}>▶</button>
        <button title="서버 저장본으로 되돌리기" style={{ padding: "1px 7px" }}
                onClick={() => initDockText(report)}>Reset</button>
        <button className="primary" title={`저장 (${rdOpts.key_save ?? "Ctrl+S"})`} style={{ padding: "1px 9px" }}
                disabled={!report || finalizedDock} onClick={() => void dockSave()}>Save</button>
        <button title={`승인 — 확정·서명 (${rdOpts.key_approve ?? "Ctrl+Shift+A"})`}
                style={{ padding: "1px 9px", background: "var(--stat-final)", color: "#fff", border: "none", borderRadius: 4 }}
                disabled={!report || finalizedDock} onClick={() => void dockApprove()}>Approve</button>
      </div>
      {rdOpts.cvr_notice && report && /critical/i.test(JSON.stringify(report.sr_json.findings)) && (
        <div style={{ background: "var(--stat-emergency)", color: "#fff", fontSize: 11, padding: "3px 8px", fontWeight: 700 }}>
          ⚠ CVR Notice — study contains CRITICAL finding
        </div>
      )}

      {dockTab === "read" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 5, padding: 7, overflow: "auto" }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            ID: <b style={{ color: "var(--text-primary)" }}>{detail.patient_key}</b> ·
            Reporter: {report?.created_by === "ai" ? `AI(${report.ai_model})` : report?.created_by ?? "-"} ·
            Report Day: {detail.study_date}
          </div>
          {detail.clinical_info && (
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              Study/Req Comment: {detail.clinical_info}
            </div>
          )}
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)" }}>Reading</div>
          <textarea value={reading} placeholder="Enter reading findings" disabled={finalizedDock}
                    onChange={(e) => { setReading(e.target.value); setReadingTouched(true); }}
                    style={{ ...taStyle, flex: 1.4, minHeight: 90 }} />
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)" }}>Conclusion</div>
          <textarea id="sv-dock-conclusion" value={conclusion} placeholder="Enter conclusion" disabled={finalizedDock}
                    onChange={(e) => setConclusion(e.target.value)}
                    style={{ ...taStyle, flex: 1, minHeight: 70 }} />
          {dockSig && (
            <div style={{ fontSize: 11, color: "var(--stat-final)" }}>
              ✍ {dockSig.name}{dockSig.license_no && ` (License No. ${dockSig.license_no})`} · {dockSig.signed_at?.slice(0, 16).replace("T", " ")}
            </div>
          )}
        </div>
      )}

      {dockTab === "hist" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div style={{ padding: "4px 8px", fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)", background: "var(--bg-elevated)" }}>
            History (click=view)
          </div>
          {vreports.map((r) => (
            <div key={r.id} onClick={() => setHistView(histView?.id === r.id ? null : r)}
                 style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", borderBottom: "1px solid #24282d",
                          background: histView?.id === r.id ? "var(--accent-subtle)" : undefined }}>
              v{r.version} · {r.status} · {r.created_by === "ai" ? "AI" : r.created_by}
              {r.finalized_at && ` · ${r.finalized_at.slice(0, 10)}`}
            </div>
          ))}
          {vreports.length === 0 && <div style={{ padding: 8, fontSize: 11, color: "var(--text-secondary)" }}>No previous reports</div>}
          {histView && (
            <div style={{ padding: 8, fontSize: fontPx, whiteSpace: "pre-wrap", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
              {histView.narrative_text || "(empty)"}
            </div>
          )}
          <div style={{ padding: "4px 8px", fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)",
                        background: "var(--bg-elevated)", borderTop: "1px solid var(--border)" }}>
            Prior Studies (click=compare in active pane)
          </div>
          {relExams.map((e) => (
            <div key={e.id} onClick={() => onLoadPrior(e.id)}
                 style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", borderBottom: "1px solid #24282d" }}
                 onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
                 onMouseLeave={(ev) => (ev.currentTarget.style.background = "")}>
              {e.study_date} {e.modality} <span style={{ color: "var(--text-secondary)" }}>{e.study_desc}</span>
            </div>
          ))}
          {relExams.length === 0 && (
            <div style={{ padding: 8, fontSize: 11, color: "var(--text-secondary)" }}>No prior studies</div>
          )}
        </div>
      )}

      {(dockTab === "std" || dockTab === "tpl") && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {dockPhrases.filter((p) => p.kind === (dockTab === "std" ? "phrase" : "template")).map((p) => (
            <div key={p.id}
                 onClick={() => dockTab === "std" ? dockInsert(p) : dockApplyTemplate(p)}
                 title={`${p.reading_text ? `[판독] ${p.reading_text}\n` : ""}${p.text ? `[결론] ${p.text}` : ""}`}
                 style={{ padding: "5px 8px", fontSize: 11.5, cursor: "pointer", borderBottom: "1px solid #24282d" }}
                 onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
                 onMouseLeave={(ev) => (ev.currentTarget.style.background = "")}>
              {p.category && <span style={{ color: "var(--text-secondary)" }}>[{p.category}] </span>}
              {p.name}
              {p.shortcut && <span style={{ color: "var(--accent)", float: "right" }}>Alt+{p.shortcut}</span>}
            </div>
          ))}
          {dockPhrases.filter((p) => p.kind === (dockTab === "std" ? "phrase" : "template")).length === 0 && (
            <div style={{ padding: 10, fontSize: 11, color: "var(--text-secondary)" }}>
              No {dockTab === "std" ? "shortcuts" : "templates"} — register in Settings &gt; Reading
            </div>
          )}
        </div>
      )}
    </div>
  );
}
