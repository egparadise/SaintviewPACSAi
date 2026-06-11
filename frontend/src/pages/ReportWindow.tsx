// 전용 판독 창 — 뷰어 [Reading] 버튼으로 열리는 별도 페이지 (?report=1&study=ID)
// 레이아웃: [판독|판독 기록|단축키|템플릿] 탭 · Font · CVR · ◀▶ · 초기화/저장/승인 · Reading/Conclusion
import { useEffect, useRef, useState } from "react";
import { api, ensureToken, type PhraseRow, type Report, type StudyDetail } from "../api";
import { onStudySync, postStudySync } from "../lib/sync";

type Tab = "read" | "hist" | "std" | "tpl";

export function ReportWindow() {
  const params = new URLSearchParams(window.location.search);
  const initId = Number(params.get("study") || 0);

  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [navList, setNavList] = useState<number[]>([]);
  const [navIdx, setNavIdx] = useState(0);
  const [tab, setTab] = useState<Tab>("read");  // (구버전 호환 — 중앙은 항상 판독)
  const [sideTab, setSideTab] = useState<"hist" | "sheet">("hist");      // 좌측: 판독 기록 | 기록지
  const [rightTab, setRightTab] = useState<"std" | "tpl">("std");        // 우측: 단축키 | 템플릿
  const [hosp, setHosp] = useState("");                                  // Hospital Comment (= study.memo)
  const [relatedView, setRelatedView] = useState<{ label: string; text: string } | null>(null);
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

  const [navLeft, setNavLeft] = useState<"past" | "recent">("past");  // Setting>정책
  const curIdRef = useRef(0);

  const navListRef = useRef<number[]>([]);
  const loadStudy = async (id: number, broadcast = true) => {
    const d = await api.study(id);
    curIdRef.current = id;
    const at = navListRef.current.indexOf(id);
    if (at >= 0) setNavIdx(at);
    setDetail(d);
    setHosp(d.memo ?? "");
    setRelatedView(null);
    document.title = `Reading — ${d.modality} ${d.patient_name} ${d.study_date}`;
    const r = await api.reports(id);
    setReports(r.items);
    initText(r.items[0] ?? null);
    if (broadcast) postStudySync(id, "report");  // Worklist·Viewer 연동
  };
  const loadStudyRef = useRef(loadStudy);
  loadStudyRef.current = loadStudy;

  // 다른 창(Viewer/Worklist)에서 환자가 바뀌면 같은 환자를 따라간다
  useEffect(() => {
    const off = onStudySync("report", (id) => {
      if (id !== curIdRef.current) void loadStudyRef.current(id, false);
    });
    return off;
  }, []);

  useEffect(() => {
    if (!initId) return;
    void ensureToken().then(async (ok) => {
      if (!ok) { setMsg("인증 토큰을 받지 못했습니다 — 뷰어/워크리스트에서 다시 열어주세요"); return; }
      try {
        await loadStudy(initId);
        // ◀▶ = 워크리스트 순서 환자 이동 (뷰어 화살표와 동일 동작)
        api.worklist({ limit: "500" }).then((r) => {
          const ids = r.items.map((it) => it.id);
          setNavList(ids);
          navListRef.current = ids;
          setNavIdx(Math.max(0, ids.indexOf(initId)));
        }).catch(() => { setNavList([initId]); navListRef.current = [initId]; });
        api.phrases().then((r) => setPhrases(r.items)).catch(() => {});
        api.getSetting("report.prefs").then((r) => {
          const v = r.value as Record<string, unknown>;
          setRdOpts(v);
          if (v.sidebar_tab === "sheet") setSideTab("sheet");
          if (v.panel_tab === "template") setRightTab("tpl");
        }).catch(() => {});
        api.getSetting("worklist.prefs").then((r) => {
          const nl = (r.value as { nav_left?: "past" | "recent" }).nav_left;
          if (nl) setNavLeft(nl);
        }).catch(() => {});
      } catch (e) { setMsg(e instanceof Error ? e.message : "검사 로드 실패"); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initId]);

  /** visual: -1=◀, 1=▶ — 시간대별 한 단계, 방향=Setting>정책(nav_left). 목록은 최신이 idx 0 */
  const navStep = (visual: 1 | -1) => {
    const leftStep = navLeft === "past" ? 1 : -1;
    return visual === -1 ? leftStep : -leftStep;
  };
  const navTargetIdx = (visual: 1 | -1) => {
    const next = navIdx + navStep(visual);
    return next >= 0 && next < navList.length ? next : -1;
  };
  const nav = async (visual: 1 | -1) => {
    const next = navTargetIdx(visual);
    if (next < 0) return;
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
      if (hosp !== (detail.memo ?? "")) await api.setMemo(detail.id, hosp);  // Hospital Comment
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
  void tab; void setTab; void histView;  // (구버전 탭 상태 — 레이아웃 개편으로 미사용)

  const taStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg-canvas)", color: "var(--text-primary)",
    border: "1px solid var(--border)", borderRadius: 4, padding: 8,
    fontFamily: "inherit", fontSize: fontPx, resize: "none",
  };
  const inStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg-canvas)", color: "var(--text-primary)",
    border: "1px solid var(--border)", borderRadius: 4, padding: "6px 8px", fontSize: fontPx,
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--text-primary)" };
  const sideTabStyle = (on: boolean): React.CSSProperties => ({
    flex: 1, textAlign: "center", padding: "9px 0", fontSize: 12.5, cursor: "pointer",
    fontWeight: on ? 700 : 400,
    borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent",
    color: on ? "var(--text-primary)" : "var(--text-secondary)",
    background: on ? undefined : "var(--bg-elevated)",
  });
  const phraseList = phrases.filter((p) => p.kind === (rightTab === "std" ? "phrase" : "template"));
  const relatedDone = detail.related_exams.filter((e) => e.status === "finalized");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-canvas)" }}>
      {/* 최상단: Font size 바 (레퍼런스) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 14px",
                    background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
        <span style={{ marginLeft: "auto", color: "var(--text-secondary)" }}>Font size</span>
        <button style={{ padding: "0 8px" }} onClick={() => setFontPx((f) => Math.max(10, f - 1))}>−</button>
        <input type="range" min={10} max={24} value={fontPx} onChange={(e) => setFontPx(Number(e.target.value))} />
        <b>{fontPx}px</b>
        <button style={{ padding: "0 8px" }} onClick={() => setFontPx((f) => Math.min(24, f + 1))}>＋</button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 좌측 사이드바: 판독 기록 | 기록지 */}
        <div style={{ width: 300, flexShrink: 0, borderRight: "1px solid var(--border)",
                      display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            <div style={sideTabStyle(sideTab === "hist")} onClick={() => setSideTab("hist")}>판독 기록</div>
            <div style={sideTabStyle(sideTab === "sheet")} onClick={() => setSideTab("sheet")}>기록지</div>
          </div>
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {sideTab === "hist" ? (
              reports.length === 0 && relatedDone.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                              padding: "60px 18px", textAlign: "center" }}>
                  <div style={{ fontSize: 34, opacity: 0.5 }}>🕘</div>
                  <b style={{ fontSize: 13.5 }}>이전 판독 기록이 없습니다</b>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                    이 환자의 이전 검사 기록이 없거나 판독이 완료되지 않았습니다.
                  </div>
                  <button className="primary" style={{ padding: "4px 14px", fontSize: 12 }}
                          onClick={() => window.open(
                            `${window.location.origin}${window.location.pathname}?viewer=2d&study=${detail.id}`,
                            "sv_viewer")}>
                    ▶ 이전 검사 영상 요청
                  </button>
                </div>
              ) : (
                <>
                  {reports.slice(1).map((r) => (
                    <div key={r.id}
                         onClick={() => setRelatedView({
                           label: `v${r.version} · ${r.created_by === "ai" ? "AI" : r.created_by}`,
                           text: r.narrative_text || "(내용 없음)",
                         })}
                         style={{ padding: "7px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #24282d" }}>
                      📄 현재 검사 v{r.version} · {r.status} · {r.created_by === "ai" ? "AI" : r.created_by}
                    </div>
                  ))}
                  {relatedDone.map((e) => (
                    <div key={e.id}
                         onClick={async () => {
                           try {
                             const rr = await api.reports(e.id);
                             const fin = rr.items.find((x) => x.status === "finalized") ?? rr.items[0];
                             setRelatedView({
                               label: `${e.study_date} ${e.modality} ${e.study_desc}`,
                               text: fin?.narrative_text || "(판독 없음)",
                             });
                           } catch { /* 무시 */ }
                         }}
                         style={{ padding: "7px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #24282d" }}
                         onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
                         onMouseLeave={(ev) => (ev.currentTarget.style.background = "")}>
                      🗂 {e.study_date} {e.modality} <span style={{ color: "var(--text-secondary)" }}>{e.study_desc}</span>
                    </div>
                  ))}
                  {relatedView && (
                    <div style={{ padding: 10, borderTop: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 4 }}>[{relatedView.label}] 읽기 전용</div>
                      <div style={{ fontSize: fontPx, whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>
                        {relatedView.text}
                      </div>
                    </div>
                  )}
                </>
              )
            ) : (
              <table className="grid-table" style={{ fontSize: 12 }}>
                <tbody>
                  <tr><th style={{ width: 90 }}>환자 ID</th><td>{detail.patient_key}</td></tr>
                  <tr><th>이름</th><td>{detail.patient_name}</td></tr>
                  <tr><th>성별/생년</th><td>{detail.sex} / {detail.birth_date}</td></tr>
                  <tr><th>검사명</th><td>{detail.study_desc}</td></tr>
                  <tr><th>Modality</th><td>{detail.modality}</td></tr>
                  <tr><th>부위</th><td>{detail.body_part}</td></tr>
                  <tr><th>검사일</th><td>{detail.study_date}</td></tr>
                  <tr><th>Accession</th><td>{detail.accession_no}</td></tr>
                  <tr><th>기관</th><td>{detail.institution || "-"}</td></tr>
                  <tr><th>의뢰의</th><td>{detail.referring_physician || "-"}</td></tr>
                  <tr><th>임상정보</th><td>{detail.clinical_info || "-"}</td></tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 중앙: 판독 본문 */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 12px",
                        borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
            <b>(/)</b>
            <span>ID: <b>{detail.patient_key}</b></span>
            <span style={{ color: "var(--text-secondary)" }}>{detail.modality}/{detail.study_date}</span>
            {msg && <span style={{ color: "var(--stat-final)" }}>{msg}</span>}
            <span style={{ flex: 1 }} />
            <label title="CVR Notice — critical 소견 경고" style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={!!rdOpts.cvr_notice}
                     onChange={(e) => setRdOpts((p) => ({ ...p, cvr_notice: e.target.checked }))} />
              CVR Notice
            </label>
            <button title={`◀ ${navLeft === "past" ? "한 단계 과거" : "한 단계 최신"} 검사 (뷰어 ◀와 동일 — 정책에서 변경)`}
                    style={{ padding: "1px 10px" }}
                    disabled={navTargetIdx(-1) < 0} onClick={() => void nav(-1)}>◀</button>
            <button title={`▶ ${navLeft === "past" ? "한 단계 최신" : "한 단계 과거"} 검사 (뷰어 ▶와 동일 — 정책에서 변경)`}
                    style={{ padding: "1px 10px" }}
                    disabled={navTargetIdx(1) < 0} onClick={() => void nav(1)}>▶</button>
            <button title="서버 저장본으로 되돌리기" style={{ padding: "2px 10px" }} onClick={() => initText(report)}>초기화</button>
            <button className="primary" title={`저장 (${String(rdOpts.key_save ?? "Ctrl+S")})`} style={{ padding: "2px 12px" }}
                    disabled={!report || finalized} onClick={() => void save()}>저장</button>
            <button title={`승인 — 확정·서명 (${String(rdOpts.key_approve ?? "Ctrl+Shift+A")})`}
                    style={{ padding: "2px 12px", background: "var(--stat-final)", color: "#fff", border: "none", borderRadius: 4 }}
                    disabled={!report || finalized} onClick={() => void approve()}>승인</button>
          </div>
          {!!rdOpts.cvr_notice && report && /critical/i.test(JSON.stringify(report.sr_json.findings)) && (
            <div style={{ background: "var(--stat-emergency)", color: "#fff", fontSize: 12, padding: "4px 12px", fontWeight: 700 }}>
              ⚠ CVR Notice — CRITICAL 소견 포함 검사
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "14px 18px",
                        display: "flex", flexDirection: "column", gap: 10, maxWidth: 1100 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12.5 }}>
              <span><b>ID:</b> <input readOnly value={detail.patient_key} style={{ ...inStyle, width: 150, display: "inline-block" }} /></span>
              <span><b>Reporter:</b> <input readOnly
                value={report?.created_by === "ai" ? `AI(${report.ai_model})` : report?.created_by ?? ""}
                style={{ ...inStyle, width: 190, display: "inline-block" }} /></span>
              <span><b>Report Day:</b> <input readOnly value={detail.study_date} style={{ ...inStyle, width: 120, display: "inline-block" }} /></span>
            </div>
            <div style={labelStyle}>Hospital Comment</div>
            <input value={hosp} disabled={finalized} placeholder="병원 코멘트 (저장 시 함께 기록)"
                   onChange={(e) => setHosp(e.target.value)} style={inStyle} />
            <div style={labelStyle}>Study/Req Comment</div>
            <input readOnly value={detail.clinical_info ?? ""} style={inStyle} />
            <div style={labelStyle}>Refer Comment</div>
            <input readOnly value={detail.referring_physician ?? ""} style={inStyle} />
            <div style={labelStyle}>Reading</div>
            <textarea value={reading} placeholder="판독 소견을 입력하세요" disabled={finalized}
                      onChange={(e) => { setReading(e.target.value); setTouched(true); }}
                      style={{ ...taStyle, minHeight: 140, flex: 1.2 }} />
            <div style={labelStyle}>Conclusion</div>
            <textarea value={conclusion} placeholder="결론을 입력하세요" disabled={finalized}
                      onChange={(e) => setConclusion(e.target.value)}
                      style={{ ...taStyle, minHeight: 110, flex: 1 }} />
            {sig && (
              <div style={{ fontSize: 12.5, color: "var(--stat-final)" }}>
                ✍ {sig.name}{sig.license_no && ` (면허 제${sig.license_no}호)`} · {sig.signed_at?.slice(0, 16).replace("T", " ")}
              </div>
            )}
          </div>
        </div>

        {/* 우측 사이드바: 단축키 | 템플릿 */}
        <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--border)",
                      display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            <div style={sideTabStyle(rightTab === "std")} onClick={() => setRightTab("std")}>단축키</div>
            <div style={sideTabStyle(rightTab === "tpl")} onClick={() => setRightTab("tpl")}>템플릿</div>
          </div>
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {phraseList.map((p) => (
              <div key={p.id} onClick={() => rightTab === "std" ? insertPhrase(p) : applyTemplate(p)}
                   title={`${p.reading_text ? `[판독] ${p.reading_text}\n` : ""}${p.text ? `[결론] ${p.text}` : ""}`}
                   style={{ padding: "8px 12px", fontSize: 12.5, cursor: "pointer", borderBottom: "1px solid #24282d" }}
                   onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
                   onMouseLeave={(ev) => (ev.currentTarget.style.background = "")}>
                {p.category && <span style={{ color: "var(--text-secondary)" }}>[{p.category}] </span>}
                {p.name}
                {p.shortcut && <span style={{ color: "var(--accent)", float: "right" }}>Alt+{p.shortcut}</span>}
              </div>
            ))}
            {phraseList.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: "var(--text-secondary)", textAlign: "center" }}>
                등록된 {rightTab === "std" ? "단축키가" : "템플릿이"} 없습니다.
                <br />설정 &gt; 판독(Reading)에서 등록
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
