// 설정 — INFINITT Setting options 패턴(좌측 트리 + 우측 페이지, 화면분석 §5)
import { useEffect, useState } from "react";
import { api, type AiQuality, type OrthancStatus } from "../api";
import { COLUMN_DEFS, DEFAULT_COLUMNS, DEFAULT_FIND_FIELDS, FIND_FIELDS } from "./Worklist";
import {
  FolderEditModal,
  FolderTreeEditor,
  folderSummary,
  loadTabs,
  loadTree,
  newId,
  saveTabs,
  saveTree,
  type TreeNode,
  type WorklistTab,
} from "./WorklistTree";

/** 05 Mode Profile — 백엔드 mode.profiles JSON 항목 (07 A.7 v1) */
interface ModeProfile {
  label?: string;
  worklist?: Record<string, unknown>;
  viewer?: Record<string, unknown>;
}

const TREE: { key: string; label: string; admin?: boolean }[] = [
  { key: "env", label: "환경 (Environment)" },
  { key: "network", label: "네트워크 (DICOM)" },
  { key: "worklist", label: "워크리스트" },
  { key: "report", label: "리포트" },
  { key: "viewer", label: "뷰어" },
  { key: "pdf", label: "판독서 PDF", admin: true },
  { key: "ai", label: "AI 정책", admin: true },
];

export function SettingsModal({ role, onClose }: { role: string; onClose: () => void }) {
  const isAdmin = role === "admin";
  const [page, setPage] = useState<string>("env");
  const [saved, setSaved] = useState("");

  // ── 상태 (페이지별) ──
  const [refreshSec, setRefreshSec] = useState(10);
  const [defaultStatus, setDefaultStatus] = useState("");
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [findFields, setFindFields] = useState<string[]>(DEFAULT_FIND_FIELDS);
  const [dblAction, setDblAction] = useState<"viewer2d" | "ohif">("viewer2d");
  const [hangingCT, setHangingCT] = useState("default");
  const [hangingMR, setHangingMR] = useState("default");
  // Viewer2D 레이아웃(요청 2·4·5)
  const [paletteSide, setPaletteSide] = useState<"left" | "top">("left");
  const [thumbSide, setThumbSide] = useState<"left" | "bottom">("left");
  const [thumbSize, setThumbSize] = useState(84);
  const [thumbMode, setThumbMode] = useState<"series" | "all">("series");
  const [h2dCT, setH2dCT] = useState("1x1");
  const [h2dMR, setH2dMR] = useState("1x2");
  const [reportDock, setReportDock] = useState(true);
  const [hospital, setHospital] = useState("");
  const [department, setDepartment] = useState("");
  const [footer, setFooter] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [vision, setVision] = useState(false);
  const [quality, setQuality] = useState<AiQuality | null>(null);
  const [orthanc, setOrthanc] = useState<OrthancStatus | null>(null);
  const [phraseCount, setPhraseCount] = useState(0);
  // 05 Mode Profile — 백엔드 mode.profiles JSON (S7 applyMode)
  const [modeProfiles, setModeProfiles] = useState<Record<string, ModeProfile>>({});
  const [modeJson, setModeJson] = useState("");
  // UBPACS-Z Worklist 구성요소 표시/숨김 (Study List 제외 추가·삭제)
  const [wlPanels, setWlPanels] = useState<Record<string, boolean>>({
    orders: true, prior: true, compare: true, thumb: true, std: true, comment: true, report: true,
  });
  // UBPACS-Z: 워크리스트 페이지 탭 + 검색 폴더 트리 (워크리스트 화면과 동일 데이터)
  const [wlTabs, setWlTabs] = useState<WorklistTab[]>([]);
  const [wlTree, setWlTree] = useState<TreeNode[]>([]);
  const [selTreeId, setSelTreeId] = useState<string | null>(null);
  const [tabModal, setTabModal] = useState<{ index: number } | "add" | null>(null);

  useEffect(() => {
    api.getSetting("worklist.prefs").then((r) => {
      const v = r.value as {
        auto_refresh_sec?: number; default_status?: string; columns?: string[];
        find_fields?: string[]; dbl_action?: "viewer2d" | "ohif";
      };
      if (v.auto_refresh_sec !== undefined) setRefreshSec(v.auto_refresh_sec);
      setDefaultStatus(v.default_status ?? "");
      if (v.columns?.length) setColumns(v.columns.filter((c) => COLUMN_DEFS[c]));
      if (v.find_fields?.length) setFindFields(v.find_fields.filter((c) => FIND_FIELDS[c]));
      if (v.dbl_action) setDblAction(v.dbl_action);
      const pn = (v as { panels?: Record<string, boolean> }).panels;
      if (pn) setWlPanels((prev) => ({ ...prev, ...pn }));
    }).catch(() => {});
    api.getSetting("viewer.prefs").then((r) => {
      const v = r.value as {
        hanging?: Record<string, string>; hanging2d?: Record<string, string>;
        paletteSide?: "left" | "top"; thumbSide?: "left" | "bottom";
        thumbSize?: number; thumbMode?: "series" | "all"; reportDock?: boolean;
      };
      const h = v.hanging ?? {};
      setHangingCT(h.CT ?? "default");
      setHangingMR(h.MR ?? "default");
      if (v.paletteSide) setPaletteSide(v.paletteSide);
      if (v.thumbSide) setThumbSide(v.thumbSide);
      if (v.thumbSize) setThumbSize(v.thumbSize);
      if (v.thumbMode) setThumbMode(v.thumbMode);
      if (v.hanging2d?.CT) setH2dCT(v.hanging2d.CT);
      if (v.hanging2d?.MR) setH2dMR(v.hanging2d.MR);
      if (v.reportDock !== undefined) setReportDock(v.reportDock);
    }).catch(() => {});
    api.getSetting("report.phrases").then((r) => {
      setPhraseCount(((r.value as { items?: unknown[] }).items ?? []).length);
    }).catch(() => {});
    api.getSetting("mode.profiles").then((r) => {
      const v = r.value as { profiles?: Record<string, ModeProfile> };
      setModeProfiles(v.profiles ?? {});
      setModeJson(JSON.stringify(r.value, null, 2));
    }).catch(() => {});
    loadTabs().then(setWlTabs).catch(() => {});
    loadTree().then(setWlTree).catch(() => {});
    if (isAdmin) {
      api.getSetting("pdf.template").then((r) => {
        const v = r.value as Record<string, string>;
        setHospital(v.hospital ?? ""); setDepartment(v.department ?? ""); setFooter(v.footer ?? "");
      });
      api.getSetting("ai.policy").then((r) => {
        const v = r.value as Record<string, boolean>;
        setAutoGenerate(v.auto_generate ?? true); setVision(v.vision ?? false);
      });
      api.aiQuality().then(setQuality).catch(() => {});
    }
  }, [isAdmin]);

  const testOrthanc = () => {
    setOrthanc(null);
    api.orthancStatus().then(setOrthanc).catch(() => setOrthanc({ alive: false, url: "?" }));
  };
  useEffect(() => { if (page === "network") testOrthanc(); }, [page]);

  const save = async () => {
    // 병합 저장 — 드래그 panel_order 등 다른 키를 덮어쓰지 않도록 현재 서버 값과 합친다
    const cur = (await api.getSetting("worklist.prefs").catch(() => ({ value: {} }))).value;
    await api.putSetting("worklist.prefs",
      { ...cur, auto_refresh_sec: refreshSec, default_status: defaultStatus, columns,
        find_fields: findFields, dbl_action: dblAction, panels: wlPanels }, "user");
    await api.putSetting("viewer.prefs", {
      hanging: { CT: hangingCT, MR: hangingMR },
      hanging2d: { CT: h2dCT, MR: h2dMR },
      paletteSide, thumbSide, thumbSize, thumbMode, reportDock,
    }, "user");
    if (isAdmin) {
      await api.putSetting("pdf.template", { hospital, department, footer }, "global");
      await api.putSetting("ai.policy", { auto_generate: autoGenerate, vision }, "global");
    }
    setSaved("저장됨 — 워크리스트 새로고침 시 적용");
    setTimeout(() => setSaved(""), 2500);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 100 }}>
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
        width: 860, height: 580, display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", background: "var(--bg-elevated)" }}>
          <b>Setting options</b>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* 좌측 트리 (INFINITT 패턴) */}
          <div style={{ width: 190, borderRight: "1px solid var(--border)", padding: 8, background: "var(--bg-canvas)", flexShrink: 0 }}>
            {TREE.filter((t) => !t.admin || isAdmin).map((t) => (
              <div key={t.key} onClick={() => setPage(t.key)}
                   style={{
                     padding: "6px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12.5, marginBottom: 2,
                     background: page === t.key ? "var(--accent-subtle)" : undefined,
                     color: page === t.key ? "var(--text-primary)" : "var(--text-secondary)",
                   }}>
                📁 {t.label}
              </div>
            ))}
          </div>
          {/* 우측 페이지 */}
          <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {page === "env" && (
              <>
                <Group title="제품 모드 프로파일 (05 Mode Profile — 서버 JSON)">
                  <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                    <select id="sv-mode" defaultValue="">
                      <option value="" disabled>모드 선택…</option>
                      {Object.entries(modeProfiles).map(([k, p]) => (
                        <option key={k} value={k}>{p.label ?? k}</option>
                      ))}
                    </select>
                    <button onClick={async () => {
                      const m = (document.getElementById("sv-mode") as HTMLSelectElement).value;
                      const prof = modeProfiles[m];
                      if (!prof) return;
                      const cur = (await api.getSetting("worklist.prefs")).value;
                      await api.putSetting("worklist.prefs", { ...cur, ...(prof.worklist ?? {}) }, "user");
                      const curv = (await api.getSetting("viewer.prefs")).value;
                      await api.putSetting("viewer.prefs", { ...curv, ...(prof.viewer ?? {}) }, "user");
                      setSaved(`'${prof.label ?? m}' 모드 적용 — 새로고침 시 반영`);
                    }}>적용</button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    Core 기능은 동일, 화면 구성(컬럼·검색필드·팔레트/썸네일 배치·더블클릭)만 제품별 프로파일로 전환 — 타 PACS 사용 경험 그대로 이전.
                    프로파일 정의는 서버 전역 설정(mode.profiles)에서 로드.
                  </div>
                  {isAdmin && (
                    <details>
                      <summary style={{ fontSize: 11.5, cursor: "pointer", color: "var(--text-secondary)" }}>
                        프로파일 JSON 편집 (관리자 — 전역 적용)
                      </summary>
                      <textarea value={modeJson} onChange={(e) => setModeJson(e.target.value)}
                                spellCheck={false}
                                style={{
                                  width: "100%", height: 160, marginTop: 6, fontSize: 11,
                                  fontFamily: "Consolas, monospace", background: "var(--bg-canvas)",
                                  color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4,
                                }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button onClick={async () => {
                          try {
                            const parsed = JSON.parse(modeJson);
                            if (!parsed.profiles) throw new Error("최상위에 profiles 객체가 필요합니다");
                            await api.putSetting("mode.profiles", parsed, "global");
                            setModeProfiles(parsed.profiles);
                            setSaved("모드 프로파일 JSON 저장됨 (전역)");
                          } catch (e) {
                            alert(e instanceof Error ? `JSON 오류: ${e.message}` : "저장 실패");
                          }
                        }}>JSON 저장</button>
                      </div>
                    </details>
                  )}
                </Group>
                <Group title="워크리스트 동작">
                  <Row label="자동 갱신">
                    <select value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))}>
                      <option value={0}>끔</option><option value={5}>5초</option>
                      <option value={10}>10초</option><option value={30}>30초</option>
                    </select>
                  </Row>
                  <Row label="기본 상태 필터">
                    <select value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value)}>
                      <option value="">전체</option><option value="unread">미판독(확정 전)</option>
                      <option value="draft_ready">AI초안</option>
                      <option value="reading">판독중</option><option value="received">도착</option>
                    </select>
                  </Row>
                  <Row label="단축키">
                    <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                      워크리스트: Enter=View&Draft · B=일괄검토 · E=Emergency │
                      뷰어: ←→ 이미지 · I 반전 · R 회전 · F Fit · L Link · 1/2/4 분할 · Space Cine · Esc 닫기
                    </span>
                  </Row>
                  <Row label="더블클릭 동작">
                    <select value={dblAction} onChange={(e) => setDblAction(e.target.value as "viewer2d" | "ohif")}>
                      <option value="viewer2d">자체 뷰어 (View&Draft)</option>
                      <option value="ohif">OHIF 뷰어</option>
                    </select>
                  </Row>
                </Group>
              </>
            )}

            {page === "network" && (
              <>
                <Group title="로컬 구성">
                  <Row label="API 서버"><code style={{ fontSize: 12 }}>http://localhost:8000</code></Row>
                  <Row label="OHIF 뷰어"><code style={{ fontSize: 12 }}>http://localhost:3000</code></Row>
                </Group>
                <Group title="DICOM 서버 (Orthanc)" right={<button onClick={testOrthanc}>연결 테스트</button>}>
                  {orthanc === null ? (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>확인 중…</div>
                  ) : orthanc.alive ? (
                    <table className="grid-table">
                      <tbody>
                        <tr><th style={{ width: 110 }}>상태</th><td style={{ color: "var(--stat-final)" }}>● 연결됨</td></tr>
                        <tr><th>AE Title</th><td>{orthanc.aet}</td></tr>
                        <tr><th>DICOM 포트</th><td>{orthanc.dicom_port} (C-STORE 수신)</td></tr>
                        <tr><th>버전</th><td>Orthanc {orthanc.version}</td></tr>
                        <tr><th>저장 검사</th><td>{orthanc.studies_count}건</td></tr>
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ color: "var(--stat-emergency)", fontSize: 12.5 }}>
                      ● 연결 실패 — {orthanc.url} {orthanc.error ?? ""}
                    </div>
                  )}
                </Group>
              </>
            )}

            {page === "worklist" && (
              <>
                <Group title="그리드 컬럼 구성 (Header Columns — F-8)">
                  <DualList
                    all={Object.keys(COLUMN_DEFS)}
                    selected={columns}
                    labelOf={(k) => COLUMN_DEFS[k].label}
                    onChange={setColumns}
                  />
                </Group>
                <Group title="검색 필드 구성 (Find criteria)">
                  <DualList
                    all={Object.keys(FIND_FIELDS)}
                    selected={findFields}
                    labelOf={(k) => FIND_FIELDS[k]}
                    onChange={setFindFields}
                  />
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    컬럼·검색필드 구성은 서버 저장(로밍) — 어느 PC에서 로그인해도 동일 적용.
                  </div>
                </Group>
                <Group title="워크리스트 구성요소 (UBPACS-Z p.8 — Study List 제외 추가/삭제)">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                    {([
                      ["orders", "오더/예약 (Order)"],
                      ["prior", "과거검사 (Related Study List-1)"],
                      ["compare", "비교세트 (Related Study List-2)"],
                      ["thumb", "썸네일 (Thumbnail Window)"],
                      ["std", "상용구 (Reference Window)"],
                      ["comment", "Comment / MEMO"],
                      ["report", "리포트 (Report Window)"],
                    ] as const).map(([k, label]) => (
                      <label key={k} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12.5 }}>
                        <input type="checkbox" checked={!!wlPanels[k]}
                               onChange={(e) => setWlPanels((p) => ({ ...p, [k]: e.target.checked }))} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    체크 해제 시 워크리스트에서 해당 창이 숨겨집니다. 배치 순서는 워크리스트에서 그립(⋮) 드래그로 변경.
                  </div>
                </Group>
                <Group title="워크리스트 페이지 탭 (UBPACS-Z — 최대 10)">
                  <table className="grid-table">
                    <thead><tr><th style={{ width: 130 }}>이름</th><th>검색 조건</th><th style={{ width: 118 }}></th></tr></thead>
                    <tbody>
                      {wlTabs.map((t, i) => (
                        <tr key={t.id}>
                          <td>{t.label}</td>
                          <td style={{ color: "var(--text-secondary)" }}>{folderSummary(t.filter)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button style={{ padding: "0 6px", fontSize: 11 }} title="조건 수정"
                                    onClick={() => setTabModal({ index: i })}>✏</button>
                            <button style={{ padding: "0 6px", fontSize: 11 }} disabled={i === 0} title="위로"
                                    onClick={() => {
                                      const next = [...wlTabs];
                                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                                      setWlTabs(next);
                                      saveTabs(next).then(() => setSaved("페이지 탭 저장됨")).catch(() => {});
                                    }}>▲</button>
                            <button style={{ padding: "0 6px", fontSize: 11 }} disabled={i === wlTabs.length - 1} title="아래로"
                                    onClick={() => {
                                      const next = [...wlTabs];
                                      [next[i], next[i + 1]] = [next[i + 1], next[i]];
                                      setWlTabs(next);
                                      saveTabs(next).then(() => setSaved("페이지 탭 저장됨")).catch(() => {});
                                    }}>▼</button>
                            <button style={{ padding: "0 6px", fontSize: 11 }} disabled={t.id === "default"} title="삭제"
                                    onClick={() => {
                                      if (!window.confirm(`'${t.label}' 페이지를 삭제할까요?`)) return;
                                      const next = wlTabs.filter((x) => x.id !== t.id);
                                      setWlTabs(next);
                                      saveTabs(next).then(() => setSaved("페이지 탭 저장됨")).catch(() => {});
                                    }}>✕</button>
                          </td>
                        </tr>
                      ))}
                      {wlTabs.length === 0 && (
                        <tr><td colSpan={3} style={{ color: "var(--text-secondary)" }}>페이지 없음</td></tr>
                      )}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => setTabModal("add")} disabled={wlTabs.length >= 10}>＋ 페이지 추가</button>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      워크리스트 상단 탭과 동일 데이터 — 탭 ＋ 버튼은 현재 검색조건을 스냅샷으로 등록.
                    </span>
                  </div>
                </Group>
                <Group title="검색 폴더 트리 (탐색기형 — 예: 응급실 › DR › Chest)">
                  <div style={{
                    height: 190, display: "flex", flexDirection: "column", padding: 4,
                    border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-canvas)",
                  }}>
                    <FolderTreeEditor nodes={wlTree} selectedId={selTreeId}
                                      onSelect={(n) => setSelTreeId(n.id)}
                                      onChange={(next) => {
                                        setWlTree(next);
                                        saveTree(next).then(() => setSaved("검색 폴더 저장됨")).catch(() => {});
                                      }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    각 폴더는 자기 조건만 가지며, 워크리스트에서 폴더 클릭 시 <b>상위 경로 조건이 누적 병합</b>되어 검색됩니다.
                    변경은 즉시 서버 저장(로밍).
                  </div>
                </Group>
                {tabModal !== null && (
                  <FolderEditModal
                    title={tabModal === "add" ? "새 워크리스트 페이지"
                         : `페이지 수정 — ${wlTabs[tabModal.index]?.label ?? ""}`}
                    init={tabModal === "add" ? undefined
                        : { label: wlTabs[tabModal.index].label, filter: wlTabs[tabModal.index].filter }}
                    onSave={(label, filter) => {
                      let next: WorklistTab[];
                      if (tabModal === "add") {
                        if (wlTabs.length >= 10) { alert("워크리스트 페이지는 최대 10개입니다"); return; }
                        next = [...wlTabs, { id: newId(), label, filter }];
                      } else {
                        next = wlTabs.map((t, i) => (i === tabModal.index ? { ...t, label, filter } : t));
                      }
                      setWlTabs(next);
                      saveTabs(next).then(() => setSaved("페이지 탭 저장됨")).catch(() => {});
                      setTabModal(null);
                    }}
                    onClose={() => setTabModal(null)}
                  />
                )}
              </>
            )}

            {page === "report" && (
              <>
                <Group title="상용구 (Predefined Readings)">
                  <div style={{ fontSize: 12.5 }}>
                    등록된 상용구: <b>{phraseCount}건</b>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    상용구 등록·수정·삭제는 워크리스트 하단 <b>상용구(Std) 패널</b>에서 합니다.
                    더블클릭하면 현재 리포트 Conclusion에 삽입됩니다.
                  </div>
                </Group>
                <Group title="출력 형식">
                  <div style={{ fontSize: 12.5 }}>PDF · DICOM SR(확정 후 전송) · FHIR DiagnosticReport</div>
                </Group>
              </>
            )}

            {page === "viewer" && (
              <Group title="행잉 프로토콜 (F-18)">
                {([["CT", hangingCT, setHangingCT], ["MR", hangingMR, setHangingMR]] as const).map(([m, v, set]) => (
                  <Row key={m} label={`${m} 기본 행잉`}>
                    <select value={v} onChange={(e) => set(e.target.value)}>
                      <option value="default">기본 (스택)</option>
                      <option value="mpr">MPR</option>
                    </select>
                  </Row>
                ))}
              </Group>
            )}
            {page === "viewer" && (
              <>
                <Group title="자체 2D 뷰어 레이아웃 (요청: 방향·크기 전환)">
                  <Row label="툴 팔레트 위치">
                    <select value={paletteSide} onChange={(e) => setPaletteSide(e.target.value as "left" | "top")}>
                      <option value="left">세로 (좌측)</option><option value="top">가로 (상단)</option>
                    </select>
                  </Row>
                  <Row label="썸네일 위치">
                    <select value={thumbSide} onChange={(e) => setThumbSide(e.target.value as "left" | "bottom")}>
                      <option value="left">세로 (좌측)</option><option value="bottom">가로 (하단)</option>
                    </select>
                  </Row>
                  <Row label="썸네일 크기">
                    <input type="range" min={56} max={140} step={4} value={thumbSize}
                           onChange={(e) => setThumbSize(Number(e.target.value))} /> {thumbSize}px
                  </Row>
                  <Row label="썸네일 모드">
                    <select value={thumbMode} onChange={(e) => setThumbMode(e.target.value as "series" | "all")}>
                      <option value="series">시리즈 (선택 시 개별 전개)</option>
                      <option value="all">전체 이미지 나열</option>
                    </select>
                  </Row>
                  <Row label="판독창 도크">
                    <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                      <input type="checkbox" checked={reportDock} onChange={(e) => setReportDock(e.target.checked)} />
                      뷰어 우측에 리포트·과거검사 표시
                    </label>
                  </Row>
                </Group>
                <Group title="2D 행잉 (모달리티 → 분할)">
                  {([["CT", h2dCT, setH2dCT], ["MR", h2dMR, setH2dMR]] as const).map(([m, v, set]) => (
                    <Row key={m} label={m}>
                      <select value={v} onChange={(e) => set(e.target.value)}>
                        <option value="1x1">1 X 1</option><option value="1x2">1 X 2</option><option value="2x2">2 X 2</option>
                      </select>
                    </Row>
                  ))}
                </Group>
              </>
            )}

            {page === "pdf" && isAdmin && (
              <Group title="판독서 템플릿 (기관)">
                <Row label="병원명"><input value={hospital} onChange={(e) => setHospital(e.target.value)} style={{ width: 280 }} /></Row>
                <Row label="부서"><input value={department} onChange={(e) => setDepartment(e.target.value)} style={{ width: 280 }} /></Row>
                <Row label="푸터"><input value={footer} onChange={(e) => setFooter(e.target.value)} style={{ width: 280 }} /></Row>
              </Group>
            )}

            {page === "ai" && isAdmin && (
              <>
                <Group title="AI 정책">
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                    <input type="checkbox" checked={autoGenerate} onChange={(e) => setAutoGenerate(e.target.checked)} />
                    검사 도착 시 초안 자동 생성
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                    <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
                    키이미지 vision 분석 (F-11) — <span style={{ color: "var(--ai)" }}>[영상 참고 관찰]로만 표기</span>
                  </label>
                </Group>
                {quality && quality.with_ai_draft > 0 && (
                  <Group title="AI 품질 지표 (F-20)">
                    <table className="grid-table">
                      <tbody>
                        <tr><th style={{ width: 140 }}>AI 초안 기반 확정</th><td>{quality.with_ai_draft} / {quality.finalized_total}건</td></tr>
                        <tr><th>무수정 수용률</th><td>{((quality.acceptance_rate ?? 0) * 100).toFixed(1)}%</td></tr>
                        <tr><th>평균 수정률</th><td>{((quality.avg_modified_ratio ?? 0) * 100).toFixed(1)}%</td></tr>
                        <tr><th>critical 변경</th>
                          <td style={{ color: (quality.critical_dropped || quality.critical_added) ? "var(--stat-emergency)" : undefined }}>
                            탈락 {quality.critical_dropped ?? 0} / 추가 {quality.critical_added ?? 0}
                          </td></tr>
                      </tbody>
                    </table>
                  </Group>
                )}
              </>
            )}
          </div>
        </div>
        <div style={{ padding: "9px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", background: "var(--bg-elevated)" }}>
          {saved && <span style={{ color: "var(--stat-final)", fontSize: 12 }}>{saved}</span>}
          <div style={{ flex: 1 }} />
          <button className="primary" onClick={save}>OK (저장)</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── 듀얼 리스트 (화면분석 §5.10 패턴: Available ↔ Selected + Up/Down) ── */
function DualList({ all, selected, labelOf, onChange }: {
  all: string[];
  selected: string[];
  labelOf: (k: string) => string;
  onChange: (next: string[]) => void;
}) {
  const [pickAvail, setPickAvail] = useState<string | null>(null);
  const [pickSel, setPickSel] = useState<string | null>(null);
  const available = all.filter((k) => !selected.includes(k));

  const move = (dir: 1 | -1) => {
    if (!pickSel) return;
    const i = selected.indexOf(pickSel);
    const j = i + dir;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const ListBox = ({ title, items, pick, setPick }: {
    title: string; items: string[]; pick: string | null; setPick: (k: string) => void;
  }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>{title}</div>
      <div style={{ height: 200, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-canvas)" }}>
        {items.map((k) => (
          <div key={k} onClick={() => setPick(k)}
               style={{
                 padding: "4px 10px", fontSize: 12.5, cursor: "pointer",
                 background: pick === k ? "var(--accent-subtle)" : undefined,
               }}>
            {labelOf(k)}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <ListBox title="Available Columns" items={available} pick={pickAvail} setPick={setPickAvail} />
      <div style={{ display: "flex", flexDirection: "column", gap: 5, justifyContent: "center" }}>
        <button disabled={!pickAvail}
                onClick={() => { if (pickAvail) { onChange([...selected, pickAvail]); setPickAvail(null); } }}>→</button>
        <button disabled={!pickSel}
                onClick={() => { if (pickSel) { onChange(selected.filter((k) => k !== pickSel)); setPickSel(null); } }}>←</button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ListBox title="Selected Columns (순서 = 표시 순서)" items={selected} pick={pickSel} setPick={setPickSel} />
        <div style={{ display: "flex", gap: 5, marginTop: 5, justifyContent: "flex-end" }}>
          <button disabled={!pickSel} onClick={() => move(-1)}>Up</button>
          <button disabled={!pickSel} onClick={() => move(1)}>Down</button>
        </div>
      </div>
    </div>
  );
}

function Group({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, margin: 0 }}>
      <legend style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", padding: "0 6px", display: "flex", gap: 8 }}>
        {title}{right}
      </legend>
      {children}
    </fieldset>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
      <span style={{ width: 110, color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </label>
  );
}
