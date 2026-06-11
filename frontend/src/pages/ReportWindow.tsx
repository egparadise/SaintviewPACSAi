// 전용 판독 창 — 뷰어 [Reading] 버튼으로 열리는 별도 페이지 (?report=1&study=ID)
// 레이아웃: [판독|판독 기록|단축키|템플릿] 탭 · Font · CVR · ◀▶ · 초기화/저장/승인 · Reading/Conclusion
import { useEffect, useRef, useState } from "react";
import { api, ensureToken, type PhraseRow, type Report, type StudyDetail } from "../api";

type Tab = "read" | "hist" | "std" | "tpl";

export function ReportWindow() {
  const params = new URLSearchParams(window.location.search);
  const initId = Number(params.get("study") || 0);

  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [navList, setNavList] = useState<number[]>([]);
  const [navIdx, setNavIdx] = useState(0);
  const [tab, setTab] = useState<Tab>("read");
  const [fontPx, setFontPx] = useState(12);
  const [reading, setReading] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [touched, setTouched] = useState(false);
  const [histView, setHistView] = useState<Report | null>(null);
  const [phrases, setPhrases] = useState<PhraseRow[]>([]);
  const [rdOpts, setRdOpts] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState("");
  const report = reports[0] ?? null;
  const finalized = report?.status === "finalized";
  const sig = (report?.diff_metrics as { signature?: { name: string; license_no: string; signed_at: string } })?.signature;

  const initText = (r: Report | null) => {
    setHistView(null);
    setTouched(false);
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

  const loadStudy = async (id: number) => {
    const d = await api.study(id);
    setDetail(d);
    document.title = `Reading — ${d.modality} ${d.patient_name} ${d.study_date}`;
    const r = await api.reports(id);
    setReports(r.items);
    initText(r.items[0] ?? null);
  };

  useEffect(() => {
    if (!initId) return;
    void ensureToken().then(async (ok) => {
      if (!ok) { setMsg("인증 토큰을 받지 못했습니다 — 뷰어/워크리스트에서 다시 열어주세요"); return; }
      try {
        await loadStudy(initId);
        const d = await api.study(initId);
        setNavList([initId, ...d.related_exams.map((e) => e.id)]);
        api.phrases().then((r) => setPhrases(r.items)).catch(() => {});
        api.getSetting("report.prefs").then((r) => setRdOpts(r.value as Record<string, unknown>)).catch(() => {});
      } catch (e) { setMsg(e instanceof Error ? e.message : "검사 로드 실패"); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initId]);

  const nav = async (dir: 1 | -1) => {
    const next = navIdx + dir;
    if (next < 0 || next >= navList.length) return;
    setNavIdx(next);
    await loadStudy(navList[next]);
  };

  const buildSr = (): Report["sr_json"] | null => {
    if (!report) return null;
    const sr = structuredClone(report.sr_json);
    if (touched) {
      sr.findings = reading.trim()
        ? [{ organ: "판독", observation: reading.trim(),
             severity: /\[CRITICAL\]/i.test(reading) ? "critical" : "normal", measurements: [] }]
        : [];
    }
    if (!sr.impression.length) sr.impression = [{ rank: 1, statement: "", confidence: "low", codes: [] }];
    sr.impression[0].statement = conclusion;
    return sr;
  };

  const save = async () => {
    const sr = buildSr();
    if (!report || !sr || !detail) return;
    try {
      await api.updateReport(report.id, sr);
      const r = await api.reports(detail.id);
      setReports(r.items);
      setTouched(false);
      if (rdOpts.save_alert) alert("리포트가 저장되었습니다"); else setMsg("저장됨");
    } catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); }
  };

  const approve = async () => {
    const sr = buildSr();
    if (!report || !sr || !detail) return;
    if (!window.confirm("판독을 확정(승인·서명)합니다. 확정 후 수정할 수 없습니다.")) return;
    try {
      if (!finalized) {
        await api.updateReport(report.id, sr);
        await api.finalizeReport(report.id);
      }
      const r = await api.reports(detail.id);
      setReports(r.items);
      initText(r.items[0] ?? null);
      setMsg("확정(서명) 완료");
      if (rdOpts.open_next_after_save && navIdx < navList.length - 1) void nav(1);  // 저장 후 다음 레포트 열기
    } catch (e) { alert(e instanceof Error ? e.message : "승인 실패"); }
  };

  const insertPhrase = (p: PhraseRow) => {
    const join = (cur: string, add: string) => !add ? cur : (cur ? `${cur}\n${add}` : add);
    if (p.reading_text) { setReading((r) => join(r, p.reading_text)); setTouched(true); }
    if (p.text) setConclusion((c) => join(c, p.text));
  };
  const applyTemplate = (p: PhraseRow) => {
    if (!window.confirm(`템플릿 '${p.name}'으로 판독/결론을 교체할까요?`)) return;
    setReading(p.reading_text);
    setConclusion(p.text);
    setTouched(true);
  };

  // 시스템 단축키(Setting>판독) + Alt+상용구
  const keysRef = useRef({ rdOpts, phrases });
  keysRef.current = { rdOpts, phrases };
  const saveRef = useRef(save); saveRef.current = save;
  const approveRef = useRef(approve); approveRef.current = approve;
  const insertRef2 = useRef(insertPhrase); insertRef2.current = insertPhrase;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { rdOpts: o, phrases: ph } = keysRef.current;
      const combo = [e.ctrlKey && "Ctrl", e.shiftKey && "Shift", e.altKey && "Alt",
                     e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join("+");
      if (combo === (o.key_save ?? "Ctrl+S")) { e.preventDefault(); void saveRef.current(); return; }
      if (combo === (o.key_approve ?? "Ctrl+Shift+A")) { e.preventDefault(); void approveRef.current(); return; }
      if (e.altKey && !e.ctrlKey && e.key.length === 1) {
        const hit = ph.find((p) => p.kind === "phrase" && p.shortcut === e.key.toUpperCase());
        if (hit) { e.preventDefault(); insertRef2.current(hit); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!detail) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", color: msg ? "var(--stat-emergency)" : "var(--text-secondary)" }}>
        {msg || "판독 창 로딩…"}
      </div>
    );
  }

  const taStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg-canvas)", color: "var(--text-primary)",
    border: "1px solid var(--border)", borderRadius: 3, padding: 7,
    fontFamily: "inherit", fontSize: fontPx, resize: "none",
  };
  const phraseList = phrases.filter((p) => p.kind === (tab === "std" ? "phrase" : "template"));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-canvas)" }}>
      {/* 탭 */}
      <div style={{ display: "flex", background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
        {([["read", "판독"], ["hist", "판독 기록"], ["std", "단축키"], ["tpl", "템플릿"]] as const).map(([k, label]) => (
          <div key={k} onClick={() => setTab(k)}
               style={{ flex: 1, textAlign: "center", padding: "8px 0", fontSize: 13, cursor: "pointer",
                        fontWeight: tab === k ? 700 : 400,
                        borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent",
                        color: tab === k ? "var(--text-primary)" : "var(--text-secondary)" }}>
            {label}
          </div>
        ))}
      </div>
      {/* 상단 바 */}
      <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "5px 8px",
                    borderBottom: "1px solid var(--border)", fontSize: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-secondary)" }}>Font</span>
        <button style={{ padding: "0 7px" }} onClick={() => setFontPx((f) => Math.max(10, f - 1))}>−</button>
        <span>{fontPx}px</span>
        <button style={{ padding: "0 7px" }} onClick={() => setFontPx((f) => Math.min(24, f + 1))}>＋</button>
        <label title="CVR Notice — critical 소견 경고" style={{ display: "flex", gap: 3, alignItems: "center" }}>
          <input type="checkbox" checked={!!rdOpts.cvr_notice}
                 onChange={(e) => setRdOpts((p) => ({ ...p, cvr_notice: e.target.checked }))} />
          CVR
        </label>
        <span style={{ flex: 1 }} />
        <button title="이전 검사 판독" style={{ padding: "1px 9px" }} disabled={navIdx <= 0}
                onClick={() => void nav(-1)}>◀</button>
        <button title="다음 검사 판독" style={{ padding: "1px 9px" }} disabled={navIdx >= navList.length - 1}
                onClick={() => void nav(1)}>▶</button>
        <button title="서버 저장본으로 되돌리기" style={{ padding: "2px 9px" }} onClick={() => initText(report)}>초기화</button>
        <button className="primary" title={`저장 (${String(rdOpts.key_save ?? "Ctrl+S")})`} style={{ padding: "2px 11px" }}
                disabled={!report || finalized} onClick={() => void save()}>저장</button>
        <button title={`승인 — 확정·서명 (${String(rdOpts.key_approve ?? "Ctrl+Shift+A")})`}
                style={{ padding: "2px 11px", background: "var(--stat-final)", color: "#fff", border: "none", borderRadius: 4 }}
                disabled={!report || finalized} onClick={() => void approve()}>승인</button>
      </div>
      {!!rdOpts.cvr_notice && report && /critical/i.test(JSON.stringify(report.sr_json.findings)) && (
        <div style={{ background: "var(--stat-emergency)", color: "#fff", fontSize: 12, padding: "4px 10px", fontWeight: 700 }}>
          ⚠ CVR Notice — CRITICAL 소견 포함 검사
        </div>
      )}

      {tab === "read" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 6, padding: 10, overflow: "auto" }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            ID: <b style={{ color: "var(--text-primary)" }}>{detail.patient_key}</b> ·
            Reporter: {report?.created_by === "ai" ? `AI(${report.ai_model})` : report?.created_by ?? "-"} ·
            Report Day: {detail.study_date}
            {msg && <span style={{ color: "var(--stat-final)", marginLeft: 8 }}>{msg}</span>}
          </div>
          {detail.clinical_info && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Study/Req Comment: {detail.clinical_info}</div>
          )}
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)" }}>Reading</div>
          <textarea value={reading} placeholder="판독 소견을 입력하세요" disabled={finalized}
                    onChange={(e) => { setReading(e.target.value); setTouched(true); }}
                    style={{ ...taStyle, flex: 1.4, minHeight: 140 }} />
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)" }}>Conclusion</div>
          <textarea value={conclusion} placeholder="결론을 입력하세요" disabled={finalized}
                    onChange={(e) => setConclusion(e.target.value)}
                    style={{ ...taStyle, flex: 1, minHeight: 100 }} />
          {sig && (
            <div style={{ fontSize: 12, color: "var(--stat-final)" }}>
              ✍ {sig.name}{sig.license_no && ` (면허 제${sig.license_no}호)`} · {sig.signed_at?.slice(0, 16).replace("T", " ")}
            </div>
          )}
        </div>
      )}

      {tab === "hist" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {reports.map((r) => (
            <div key={r.id} onClick={() => setHistView(histView?.id === r.id ? null : r)}
                 style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #24282d",
                          background: histView?.id === r.id ? "var(--accent-subtle)" : undefined }}>
              v{r.version} · {r.status} · {r.created_by === "ai" ? "AI" : r.created_by}
              {r.finalized_at && ` · ${r.finalized_at.slice(0, 10)}`}
            </div>
          ))}
          {reports.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: "var(--text-secondary)" }}>이전 판독 기록이 없습니다</div>
          )}
          {histView && (
            <div style={{ padding: 10, fontSize: fontPx, whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>
              {histView.narrative_text || "(내용 없음)"}
            </div>
          )}
        </div>
      )}

      {(tab === "std" || tab === "tpl") && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {phraseList.map((p) => (
            <div key={p.id} onClick={() => tab === "std" ? insertPhrase(p) : applyTemplate(p)}
                 title={`${p.reading_text ? `[판독] ${p.reading_text}\n` : ""}${p.text ? `[결론] ${p.text}` : ""}`}
                 style={{ padding: "7px 10px", fontSize: 12.5, cursor: "pointer", borderBottom: "1px solid #24282d" }}
                 onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
                 onMouseLeave={(ev) => (ev.currentTarget.style.background = "")}>
              {p.category && <span style={{ color: "var(--text-secondary)" }}>[{p.category}] </span>}
              {p.name}
              {p.shortcut && <span style={{ color: "var(--accent)", float: "right" }}>Alt+{p.shortcut}</span>}
            </div>
          ))}
          {phraseList.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: "var(--text-secondary)" }}>
              등록된 {tab === "std" ? "단축키가" : "템플릿이"} 없습니다 — 설정 &gt; 판독(Reading)에서 등록
            </div>
          )}
        </div>
      )}
    </div>
  );
}
