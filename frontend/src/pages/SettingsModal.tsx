// 설정 — INFINITT Setting options 패턴(좌측 트리 + 우측 페이지, 화면분석 §5)
import { useEffect, useRef, useState } from "react";
import { VIEWER_BASE, api, type AiQuality, type OrthancStatus, type PhraseRow } from "../api";
import { COLUMN_DEFS, DEFAULT_COLUMNS, DEFAULT_FIND_FIELDS, FIND_FIELDS, PhraseEditModal } from "./Worklist";
import { GridPicker } from "../lib/GridPicker";
import { CLIENT_VIEWERS, DEFAULT_CLIENT_VIEWER, DEFAULT_WL_PRESETS, TOOLBAR_DEFS, type HpRule, type WlPreset } from "../lib/viewerConfig";
import { IN_LAYOUTS, IN_PALETTE } from "../lib/infiConfig";
import { ToolIcon } from "../lib/toolIcons";
import { HospitalsPanel, ModalityPanel, OverviewPanel, ServerPanel, StoragePanel, UsersPanel } from "./admin/ServerAdmin";
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

// 설정 스코프(단계별 분리): system(병원선택 화면) · hospital(자원관리 화면) · viewer(PACS Viewer)
export type SettingsScope = "system" | "hospital" | "viewer";
const TREE: { key: string; label: string; admin?: boolean; scope: SettingsScope }[] = [
  // 시스템 — 서버 운영(시스템 관리자)
  { key: "server", label: "서버 (Server)", admin: true, scope: "system" },
  { key: "overview", label: "운영 현황 (감독)", admin: true, scope: "system" },
  { key: "hospitals", label: "병원 관리", admin: true, scope: "system" },
  { key: "users", label: "사용자 관리", admin: true, scope: "system" },
  { key: "storage", label: "저장·백업 (Storage)", admin: true, scope: "system" },
  { key: "servernet", label: "서버 네트워크", admin: true, scope: "system" },
  // 관리자에게는 사용자 설정 창에서도 노출 — Local Server 공유 루트(디렉토리) 설정 접근성
  { key: "servernet", label: "서버 네트워크 (공유 루트)", admin: true, scope: "viewer" },
  // 병원 — 병원별 배치 구성
  { key: "modality", label: "장비·수신 (Modality)", admin: true, scope: "hospital" },
  { key: "network", label: "네트워크 (DICOM)", scope: "hospital" },
  { key: "pdf", label: "판독서 PDF", admin: true, scope: "hospital" },
  { key: "ai", label: "AI 정책", admin: true, scope: "hospital" },
  // 뷰어 — 사용자/판독 환경
  { key: "env", label: "환경 (Environment)", scope: "viewer" },
  { key: "worklist", label: "워크리스트", scope: "viewer" },
  { key: "report", label: "리포트", scope: "viewer" },
  { key: "reading", label: "판독 (Reading)", scope: "viewer" },
  { key: "viewer", label: "뷰어", scope: "viewer" },
  { key: "monitor", label: "모니터 (Display)", scope: "viewer" },
  { key: "policy", label: "정책 (Policy)", scope: "viewer" },
  { key: "hp", label: "행잉 (HP)", scope: "viewer" },
];
const SCOPE_TITLE: Record<SettingsScope, string> = {
  system: "시스템 설정", hospital: "병원 설정", viewer: "뷰어 설정",
};

/** SCP/SCU 장비 노드 (dicom.nodes — AE Title/IP/Port, 추가·삭제·확장 가능) */
interface DicomNode { name: string; role: "scu" | "scp" | "both"; ae_title: string; ip: string; port: number }

export function SettingsModal({ role, onClose, scope = "viewer" }: {
  role: string; onClose: () => void; scope?: SettingsScope;
}) {
  const isAdmin = role === "admin";
  // 현재 스코프에서 보이는 탭만 (단계별 분리)
  const visibleTabs = TREE.filter((t) => t.scope === scope && (!t.admin || isAdmin));
  const [page, setPage] = useState<string>(visibleTabs[0]?.key ?? "");
  const [saved, setSaved] = useState("");

  // ── 상태 (페이지별) ──
  const [refreshSec, setRefreshSec] = useState(10);
  const [defaultStatus, setDefaultStatus] = useState("");
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [findFields, setFindFields] = useState<string[]>(DEFAULT_FIND_FIELDS);
  const [dblAction, setDblAction] = useState<"viewer2d" | "ohif">("viewer2d");
  const [hangingCT, setHangingCT] = useState("default");
  const [hangingMR, setHangingMR] = useState("default");
  // 선택 뷰어 — Client Viewer 레지스트리(TY Viewer=현행 Viewer2D, Infi Viewer=개발 중)
  const [clientViewer, setClientViewer] = useState(DEFAULT_CLIENT_VIEWER);
  // In Viewer 표시 — 멀티선택 색, 오버레이 글자 크기/표시 (계정 로밍, 뷰어 T+스크롤/T+Del 연동)
  const [infSelColor, setInfSelColor] = useState("#d946ef");
  const [infOvlFont, setInfOvlFont] = useState(9.5);
  const [infOvlVisible, setInfOvlVisible] = useState(true);
  // In Viewer 툴바 사용자화(표시/숨김) + Modality 기본 레이아웃(행잉과 별도)
  const [infTb, setInfTb] = useState<Record<string, boolean>>({});
  const [defLay, setDefLay] = useState<Record<string, { s: string; i: string }>>({});
  // Viewer2D 레이아웃 — Toolbar/Thumbnail 위치 (left/top/right — UBPACS p.14)
  const [paletteSide, setPaletteSide] = useState<"left" | "top" | "right">("left");
  const [thumbSide, setThumbSide] = useState<"left" | "bottom" | "right">("left");
  const [thumbSize, setThumbSize] = useState(128);
  const [thumbMode, setThumbMode] = useState<"series" | "all">("series");
  const [h2dCT, setH2dCT] = useState("1x1");
  const [h2dMR, setH2dMR] = useState("1x2");
  const [reportDock, setReportDock] = useState(true);
  const [hospital, setHospital] = useState("");
  const [department, setDepartment] = useState("");
  const [footer, setFooter] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [vision, setVision] = useState(false);
  // STT 엔진 (음성판독 — 브라우저/Whisper 오픈소스/상용 API)
  const [sttEngine, setSttEngine] = useState("browser");
  const [sttModel, setSttModel] = useState("");
  // 리포트 구성 (Report Composition)
  const [rptAiPanel, setRptAiPanel] = useState(true);
  const [rptAutoApply, setRptAutoApply] = useState(true);
  // 판독(Reading) 페이지 — 기본/단축키/템플릿 3탭 + 레포트 옵션(report.prefs)
  const [rdTab, setRdTab] = useState<"basic" | "shortcut" | "template">("basic");
  const [rdOpts, setRdOpts] = useState<Record<string, unknown>>({
    always_report_window: false,
    open_next_after_save: false, save_alert: false, auto_insert_prior: false,
    cvr_notice: false, sidebar_tab: "history", panel_tab: "shortcut",
    insert_pos: "end", key_save: "Ctrl+S", key_approve: "Ctrl+Shift+A",
  });
  // 뷰어 닫기 동작 (닫기 다이얼로그 "기본으로" 체크와 동일 설정)
  const [closeMode, setCloseMode] = useState<"ask" | "save_current" | "save_all" | "discard">("ask");
  // 모니터 설정 — 하드웨어 모니터 감지 후 뷰어 표시 모니터 선택(다중=스팬)
  const [monitors, setMonitors] = useState<{ label: string; w: number; h: number; primary: boolean }[]>([]);
  const [monitorSel, setMonitorSel] = useState<number[]>([]);   // 뷰어 (다중=스팬)
  const [wlMon, setWlMon] = useState<number | null>(null);      // 워크리스트 창
  const [rptMon, setRptMon] = useState<number | null>(null);    // 판독(Reading) 창
  const [monitorMsg, setMonitorMsg] = useState("");
  // 정책 — ◀(왼쪽) 버튼이 시간상 어느 방향으로 갈지 (워크리스트는 최신이 위)
  const [polNavLeft, setPolNavLeft] = useState<"past" | "recent">("past");
  const [quality, setQuality] = useState<AiQuality | null>(null);
  const [orthanc, setOrthanc] = useState<OrthancStatus | null>(null);
  // 05 Mode Profile — 백엔드 mode.profiles JSON (S7 applyMode)
  const [modeProfiles, setModeProfiles] = useState<Record<string, ModeProfile>>({});
  const [modeSel, setModeSel] = useState("");   // 현재 적용된 모드(viewer.prefs.mode_key) — 콤보에 표시
  const [modeJson, setModeJson] = useState("");
  // UBPACS-Z Worklist 구성요소 표시/숨김 (Study List 제외 추가·삭제)
  const [wlPanels, setWlPanels] = useState<Record<string, boolean>>({
    orders: true, prior: true, compare: true, thumb: true, std: true, comment: true, report: true,
  });
  // 행잉 프로토콜(HP) 규칙 + 툴바 구성 + W/L 프리셋 (계정 로밍)
  const [hpRules, setHpRules] = useState<HpRule[]>([]);
  const [hpModal, setHpModal] = useState<HpRule | "new" | null>(null);
  const [tbConfig, setTbConfig] = useState<Record<string, boolean>>({});
  const [wlPresets, setWlPresets] = useState<WlPreset[]>(DEFAULT_WL_PRESETS);
  // 판독(Reading) — 내 서명 정보(확정 시 리포트에 기록)
  const [profName, setProfName] = useState("");
  const [profLicense, setProfLicense] = useState("");
  // DICOM 노드 (SCP/SCU) — 전역/관리자
  const [nodes, setNodes] = useState<DicomNode[]>([]);
  const [nodeMsg, setNodeMsg] = useState("");
  // 서버 네트워크 — 로컬 공유 디렉토리 + 웹서버(IP/Port/Name/AET) + 연결 테스트
  const [snDir, setSnDir] = useState("");
  const [snWeb, setSnWeb] = useState({ ip: "", port: "", name: "", ae_title: "" });
  const [snMsg, setSnMsg] = useState("");
  // 상용구 관리 (DB 테이블)
  const [phrases, setPhrases] = useState<PhraseRow[]>([]);
  const [phraseModal, setPhraseModal] = useState<PhraseRow | "new" | null>(null);
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
      const nl = (v as { nav_left?: "past" | "recent" }).nav_left;
      if (nl) setPolNavLeft(nl);
    }).catch(() => {});
    api.getSetting("viewer.prefs").then((r) => {
      const v = r.value as {
        hanging?: Record<string, string>; hanging2d?: Record<string, string>;
        paletteSide?: "left" | "top" | "right"; thumbSide?: "left" | "bottom" | "right";
        thumbSize?: number; thumbMode?: "series" | "all"; reportDock?: boolean;
      };
      const h = v.hanging ?? {};
      setHangingCT(h.CT ?? "default");
      setHangingMR(h.MR ?? "default");
      const cv = (v as { client_viewer?: string }).client_viewer;
      if (cv && CLIENT_VIEWERS.some((x) => x.id === cv)) setClientViewer(cv);
      const mk = (v as { mode_key?: string }).mode_key;
      if (mk) setModeSel(mk);
      const iv = v as { infi_sel_color?: string; infi_overlay_font?: number; infi_overlay_visible?: boolean;
                        infi_toolbar?: Record<string, boolean>;
                        infi_default_layout?: Record<string, { s?: { r: number; c: number } | null;
                                                               i?: { r: number; c: number } | null }> };
      if (iv.infi_sel_color) setInfSelColor(iv.infi_sel_color);
      if (iv.infi_overlay_font) setInfOvlFont(iv.infi_overlay_font);
      if (iv.infi_overlay_visible !== undefined) setInfOvlVisible(iv.infi_overlay_visible);
      if (iv.infi_toolbar) setInfTb(iv.infi_toolbar);
      if (iv.infi_default_layout) {
        const toStr = (l?: { r: number; c: number } | null) => (l ? `${l.r} x ${l.c}` : "");
        setDefLay(Object.fromEntries(Object.entries(iv.infi_default_layout)
          .map(([k, cfg]) => [k, { s: toStr(cfg.s), i: toStr(cfg.i) }])));
      }
      if (v.paletteSide) setPaletteSide(v.paletteSide);
      if (v.thumbSide) setThumbSide(v.thumbSide);
      if (v.thumbSize) setThumbSize(v.thumbSize);
      if (v.thumbMode) setThumbMode(v.thumbMode);
      if (v.hanging2d?.CT) setH2dCT(v.hanging2d.CT);
      if (v.hanging2d?.MR) setH2dMR(v.hanging2d.MR);
      if (v.reportDock !== undefined) setReportDock(v.reportDock);
      const tb = (v as { toolbar?: Record<string, boolean> }).toolbar;
      if (tb) setTbConfig(tb);
      const wp = (v as { wl_presets?: WlPreset[] }).wl_presets;
      if (wp?.length) setWlPresets(wp);
      const cm = (v as { close_mode?: "ask" | "save_current" | "save_all" | "discard" }).close_mode;
      if (cm) setCloseMode(cm);
      const mon = (v as { monitor?: { screens?: number[]; worklist?: number | null; report?: number | null } }).monitor;
      if (mon?.screens) setMonitorSel(mon.screens);
      if (mon?.worklist !== undefined) setWlMon(mon.worklist);
      if (mon?.report !== undefined) setRptMon(mon.report);
    }).catch(() => {});
    api.getSetting("viewer.hp").then((r) => {
      setHpRules(((r.value as { rules?: HpRule[] }).rules) ?? []);
    }).catch(() => {});
    api.getSetting("report.prefs").then((r) => {
      const v = r.value as { ai_panel?: boolean; auto_apply?: boolean } & Record<string, unknown>;
      if (v.ai_panel !== undefined) setRptAiPanel(v.ai_panel);
      if (v.auto_apply !== undefined) setRptAutoApply(v.auto_apply);
      setRdOpts((prev) => ({ ...prev, ...v }));
    }).catch(() => {});
    api.getSetting("mode.profiles").then((r) => {
      const v = r.value as { profiles?: Record<string, ModeProfile> };
      setModeProfiles(v.profiles ?? {});
      setModeJson(JSON.stringify(r.value, null, 2));
    }).catch(() => {});
    loadTabs().then(setWlTabs).catch(() => {});
    loadTree().then(setWlTree).catch(() => {});
    api.profile().then((p) => { setProfName(p.display_name); setProfLicense(p.license_no); }).catch(() => {});
    api.phrases().then((r) => setPhrases(r.items)).catch(() => {});
    api.getSetting("dicom.nodes").then((r) => {
      setNodes(((r.value as { items?: DicomNode[] }).items) ?? []);
    }).catch(() => {});
    api.getSetting("server.network").then((r) => {
      const v = r.value as { local_share_dir?: string; web?: { ip?: string; port?: number | string; name?: string; ae_title?: string } };
      setSnDir(v.local_share_dir ?? "");
      setSnWeb({
        ip: v.web?.ip ?? "", port: String(v.web?.port ?? ""),
        name: v.web?.name ?? "", ae_title: v.web?.ae_title ?? "",
      });
    }).catch(() => {});
    if (isAdmin) {
      api.getSetting("pdf.template").then((r) => {
        const v = r.value as Record<string, string>;
        setHospital(v.hospital ?? ""); setDepartment(v.department ?? ""); setFooter(v.footer ?? "");
      });
      api.getSetting("ai.policy").then((r) => {
        const v = r.value as Record<string, boolean | string>;
        setAutoGenerate((v.auto_generate as boolean) ?? true);
        setVision((v.vision as boolean) ?? false);
        setSttEngine((v.stt_engine as string) ?? "browser");
        setSttModel((v.stt_model as string) ?? "");
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
        find_fields: findFields, dbl_action: dblAction, panels: wlPanels, nav_left: polNavLeft }, "user");
    const curV = (await api.getSetting("viewer.prefs").catch(() => ({ value: {} }))).value;
    await api.putSetting("viewer.prefs", {
      ...curV,
      hanging: { CT: hangingCT, MR: hangingMR },
      hanging2d: { CT: h2dCT, MR: h2dMR },
      client_viewer: clientViewer,
      infi_sel_color: infSelColor, infi_overlay_font: infOvlFont, infi_overlay_visible: infOvlVisible,
      infi_toolbar: infTb,
      infi_default_layout: Object.fromEntries(Object.entries(defLay)
        .map(([k, v]) => {
          const parse = (s: string) => {
            const m = s.match(/(\d+)\s*x\s*(\d+)/);
            return m ? { r: Number(m[1]), c: Number(m[2]) } : null;
          };
          return [k, { s: parse(v.s), i: parse(v.i) }];
        })
        .filter(([, cfg]) => (cfg as { s: unknown; i: unknown }).s || (cfg as { s: unknown; i: unknown }).i)),
      paletteSide, thumbSide, thumbSize, thumbMode, reportDock,
      toolbar: tbConfig, wl_presets: wlPresets, close_mode: closeMode,
      monitor: { screens: monitorSel, worklist: wlMon, report: rptMon },
    }, "user");
    await api.putSetting("report.prefs",
      { ...rdOpts, ai_panel: rptAiPanel, auto_apply: rptAutoApply }, "user");
    if (isAdmin) {
      // 서버 네트워크(공유 루트 등)도 OK(저장)로 함께 저장 — '서버 설정 저장' 버튼을 몰라도 반영
      if (snDir.trim() || snWeb.ip || snWeb.port || snWeb.name || snWeb.ae_title) {
        const curN = (await api.getSetting("server.network").catch(() => ({ value: {} }))).value;
        await api.putSetting("server.network", {
          ...curN,
          local_share_dir: snDir,
          web: { ...snWeb, port: Number(snWeb.port) || snWeb.port },
        }, "global");
      }
      await api.putSetting("pdf.template", { hospital, department, footer }, "global");
      await api.putSetting("ai.policy", {
        auto_generate: autoGenerate, vision, stt_engine: sttEngine, stt_model: sttModel,
      }, "global");
    }
    setSaved("저장됨 — 왼쪽 ⟳ Refresh를 누르면 즉시 적용·확인됩니다");
    setTimeout(() => setSaved(""), 2500);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      {/* 설정 창 왼쪽 Refresh — 저장 후 전체 새로고침으로 적용값을 즉시 확인 */}
      <button title="모든 설정을 저장하고 화면을 새로고침 — 적용된 값을 바로 확인합니다"
              onClick={async () => { await save(); window.location.reload(); }}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                padding: "14px 10px", fontSize: 12, borderRadius: 8, cursor: "pointer",
                background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)",
              }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>⟳</span>
        <span>Refresh</span>
        <span style={{ fontSize: 10.5, opacity: 0.85 }}>저장+적용</span>
      </button>
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
        width: "min(860px, 96vw)", height: "min(580px, 92vh)", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", background: "var(--bg-elevated)" }}>
          <b>{SCOPE_TITLE[scope]}</b>
          <span style={{ marginLeft: 8, fontSize: 11.5, color: "var(--text-secondary)" }}>
            {scope === "system" ? "서버 운영" : scope === "hospital" ? "병원별 배치 구성" : "사용자·판독 환경"}
          </span>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* 좌측 트리 (INFINITT 패턴) */}
          <div style={{ width: 190, borderRight: "1px solid var(--border)", padding: 8, background: "var(--bg-canvas)", flexShrink: 0 }}>
            {visibleTabs.map((t) => (
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
            {visibleTabs.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                이 설정에 접근할 권한이 없습니다.
              </div>
            )}
            {page === "env" && (
              <>
                <Group title="제품 모드 프로파일 (05 Mode Profile — 서버 JSON)">
                  <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                    <select id="sv-mode" value={modeSel} onChange={(e) => setModeSel(e.target.value)}>
                      <option value="" disabled>모드 선택…</option>
                      {Object.entries(modeProfiles).map(([k, p]) => (
                        <option key={k} value={k}>{p.label ?? k}{k === modeSel ? " ✓ (현재 적용)" : ""}</option>
                      ))}
                    </select>
                    <button onClick={async () => {
                      const m = modeSel;
                      const prof = modeProfiles[m];
                      if (!prof) return;
                      const cur = (await api.getSetting("worklist.prefs")).value;
                      const wl = { ...cur, ...(prof.worklist ?? {}) } as Record<string, unknown>;
                      await api.putSetting("worklist.prefs", wl, "user");
                      const curv = (await api.getSetting("viewer.prefs")).value;
                      // mode_key 영속 — 다음에 설정을 열면 현재 적용 모드가 콤보에 표시된다
                      const vw = { ...curv, ...(prof.viewer ?? {}), mode_key: m } as Record<string, unknown>;
                      await api.putSetting("viewer.prefs", vw, "user");
                      // 설정 창 상태를 프로파일 값으로 즉시 동기화 — 이후 OK(저장)가 옛 값으로 덮어쓰지 않도록
                      const wlc = wl.columns as string[] | undefined;
                      if (wlc?.length) setColumns(wlc.filter((c) => COLUMN_DEFS[c]));
                      const wlf = wl.find_fields as string[] | undefined;
                      if (wlf?.length) setFindFields(wlf.filter((c) => FIND_FIELDS[c]));
                      if (wl.dbl_action) setDblAction(wl.dbl_action as "viewer2d" | "ohif");
                      if (vw.paletteSide) setPaletteSide(vw.paletteSide as "left" | "top" | "right");
                      if (vw.thumbSide) setThumbSide(vw.thumbSide as "left" | "bottom" | "right");
                      if (vw.thumbSize) setThumbSize(vw.thumbSize as number);
                      if (vw.thumbMode) setThumbMode(vw.thumbMode as "series" | "all");
                      const cvw = vw.client_viewer as string | undefined;
                      if (cvw && CLIENT_VIEWERS.some((x) => x.id === cvw)) setClientViewer(cvw);
                      setSaved(`'${prof.label ?? m}' 모드 적용 — 왼쪽 ⟳ Refresh로 즉시 확인`);
                    }}>적용</button>
                    {isAdmin && (
                      <button title="현재 워크리스트·뷰어 레이아웃(컬럼·검색필드·팔레트/썸네일 배치·선택 뷰어)을 선택한 프로파일에 저장 (전역)"
                              onClick={async () => {
                        const m = modeSel;
                        const prof = modeProfiles[m];
                        if (!prof) { alert("저장할 프로파일을 먼저 선택하세요"); return; }
                        if (!confirm(`현재 화면 구성을 '${prof.label ?? m}' 프로파일에 저장할까요? (전역 — 모든 사용자에게 적용)`)) return;
                        const wl = (await api.getSetting("worklist.prefs")).value as Record<string, unknown>;
                        const vw = (await api.getSetting("viewer.prefs")).value as Record<string, unknown>;
                        const pick = (src: Record<string, unknown>, keys: string[]) =>
                          Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
                        const next = {
                          ...modeProfiles,
                          [m]: {
                            ...prof,
                            worklist: { ...(prof.worklist ?? {}), ...pick(wl, ["columns", "find_fields", "dbl_action"]) },
                            viewer: { ...(prof.viewer ?? {}), ...pick(vw, ["client_viewer", "paletteSide", "thumbSide", "thumbMode", "thumbSize", "reportDock"]) },
                          },
                        };
                        await api.putSetting("mode.profiles", { profiles: next }, "global");
                        setModeProfiles(next);
                        setModeJson(JSON.stringify({ profiles: next }, null, 2));
                        setSaved(`현재 화면 구성을 '${prof.label ?? m}' 프로파일에 저장했습니다 (전역)`);
                      }}>현재 화면을 프로파일에 저장</button>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    Core 기능은 동일, 화면 구성(컬럼·검색필드·팔레트/썸네일 배치·더블클릭·선택 뷰어)만 제품별 프로파일로 전환 — 타 PACS 사용 경험 그대로 이전.
                    프로파일 정의는 서버 전역 설정(mode.profiles)에서 로드. <b>TY</b>=현행 자체 뷰어 레이아웃 · <b>infi</b>=신규 뷰어(개발 중) 레이아웃 저장소.
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

            {page === "server" && isAdmin && <ServerPanel />}
            {page === "overview" && isAdmin && <OverviewPanel />}
            {page === "hospitals" && isAdmin && <HospitalsPanel />}
            {page === "users" && isAdmin && <UsersPanel />}
            {page === "modality" && isAdmin && <ModalityPanel />}
            {page === "storage" && isAdmin && <StoragePanel />}

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
                <Group title="SCP/SCU 장비 노드 (AE Title · IP · Port)" right={
                  isAdmin && (
                    <span style={{ display: "flex", gap: 4 }}>
                      <button style={{ padding: "1px 8px", fontSize: 11 }}
                              onClick={() => setNodes((p) => [...p, { name: `NODE${p.length + 1}`, role: "scu", ae_title: "", ip: "", port: 104 }])}>
                        ＋ 추가
                      </button>
                      <button style={{ padding: "1px 8px", fontSize: 11 }} onClick={async () => {
                        try {
                          await api.putSetting("dicom.nodes", { items: nodes }, "global");
                          setNodeMsg("저장됨");
                        } catch (e) { setNodeMsg(e instanceof Error ? e.message : "저장 실패"); }
                      }}>저장</button>
                      <button style={{ padding: "1px 8px", fontSize: 11 }}
                              title="저장된 노드를 Orthanc DicomModalities로 등록 — C-STORE/C-FIND 대상"
                              onClick={async () => {
                                try {
                                  const r = await api.applyDicomNodes();
                                  setNodeMsg(`Orthanc 반영 ${r.applied}건${r.errors.length ? ` · 오류: ${r.errors.join(", ")}` : ""}`);
                                } catch (e) { setNodeMsg(e instanceof Error ? e.message : "반영 실패"); }
                              }}>Orthanc 반영</button>
                    </span>
                  )
                }>
                  <table className="grid-table">
                    <thead><tr><th>이름</th><th style={{ width: 80 }}>역할</th><th>AE Title</th><th>IP</th><th style={{ width: 70 }}>Port</th><th style={{ width: 30 }}></th></tr></thead>
                    <tbody>
                      {nodes.map((n, i) => (
                        <tr key={i}>
                          {isAdmin ? (
                            <>
                              <td><input value={n.name} style={{ width: "95%" }}
                                         onChange={(e) => setNodes((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></td>
                              <td>
                                <select value={n.role}
                                        onChange={(e) => setNodes((p) => p.map((x, j) => j === i ? { ...x, role: e.target.value as DicomNode["role"] } : x))}>
                                  <option value="scu">SCU</option><option value="scp">SCP</option><option value="both">양방향</option>
                                </select>
                              </td>
                              <td><input value={n.ae_title} style={{ width: "95%" }}
                                         onChange={(e) => setNodes((p) => p.map((x, j) => j === i ? { ...x, ae_title: e.target.value.toUpperCase() } : x))} /></td>
                              <td><input value={n.ip} style={{ width: "95%" }}
                                         onChange={(e) => setNodes((p) => p.map((x, j) => j === i ? { ...x, ip: e.target.value } : x))} /></td>
                              <td><input value={n.port} type="number" style={{ width: 60 }}
                                         onChange={(e) => setNodes((p) => p.map((x, j) => j === i ? { ...x, port: Number(e.target.value) } : x))} /></td>
                              <td><button style={{ padding: "0 6px", fontSize: 11 }}
                                          onClick={() => setNodes((p) => p.filter((_, j) => j !== i))}>✕</button></td>
                            </>
                          ) : (
                            <>
                              <td>{n.name}</td><td>{n.role.toUpperCase()}</td><td>{n.ae_title}</td>
                              <td>{n.ip}</td><td>{n.port}</td><td></td>
                            </>
                          )}
                        </tr>
                      ))}
                      {nodes.length === 0 && (
                        <tr><td colSpan={6} style={{ color: "var(--text-secondary)" }}>
                          등록된 장비 없음 {isAdmin && "— ＋추가로 등록 후 저장 → Orthanc 반영"}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", gap: 8 }}>
                    SCU=우리가 전송(C-STORE 대상), SCP=수신 노드. MWL 응답은 Orthanc(SAINTVIEW:4242)가 담당.
                    {nodeMsg && <b style={{ color: "var(--stat-final)" }}>{nodeMsg}</b>}
                  </div>
                </Group>
              </>
            )}

            {page === "servernet" && (
              <>
                <Group title="로컬 서버 — 폴더 공유">
                  <Row label="공유 디렉토리">
                    <input value={snDir} onChange={(e) => setSnDir(e.target.value)} disabled={!isAdmin}
                           placeholder="C:\PACS\share" style={{ width: 320 }} />
                  </Row>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    워크리스트 우측 [Local Server] 버튼에서 이 폴더의 파일 목록·다운로드가 제공됩니다 (서버 PC 기준 경로).
                  </div>
                </Group>
                <Group title="웹 서버">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <Row label="IP 주소">
                      <input value={snWeb.ip} disabled={!isAdmin} placeholder="192.168.0.10"
                             onChange={(e) => setSnWeb((p) => ({ ...p, ip: e.target.value }))} style={{ flex: 1, minWidth: 0 }} />
                    </Row>
                    <Row label="Port">
                      <input value={snWeb.port} disabled={!isAdmin} placeholder="8000"
                             onChange={(e) => setSnWeb((p) => ({ ...p, port: e.target.value }))} style={{ width: 90 }} />
                    </Row>
                    <Row label="Name">
                      <input value={snWeb.name} disabled={!isAdmin} placeholder="Saintview Main"
                             onChange={(e) => setSnWeb((p) => ({ ...p, name: e.target.value }))} style={{ flex: 1, minWidth: 0 }} />
                    </Row>
                    <Row label="AE Title">
                      <input value={snWeb.ae_title} disabled={!isAdmin} placeholder="SAINTVIEW"
                             onChange={(e) => setSnWeb((p) => ({ ...p, ae_title: e.target.value.toUpperCase() }))} style={{ flex: 1, minWidth: 0 }} />
                    </Row>
                  </div>
                  {isAdmin && (
                    <div>
                      <button className="primary" onClick={async () => {
                        try {
                          await api.putSetting("server.network", {
                            local_share_dir: snDir,
                            web: { ...snWeb, port: Number(snWeb.port) || snWeb.port },
                          }, "global");
                          setSnMsg("서버 네트워크 설정 저장됨 (전역)");
                        } catch (e) { setSnMsg(e instanceof Error ? e.message : "저장 실패"); }
                      }}>서버 설정 저장</button>
                    </div>
                  )}
                </Group>
                <Group title="연결 테스트 (Ping · DICOM Echo · DB)">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={async () => {
                      if (!snWeb.ip) { setSnMsg("IP를 먼저 입력하세요"); return; }
                      setSnMsg("Ping 테스트 중…");
                      try {
                        const r = await api.netPing(snWeb.ip, Number(snWeb.port) || undefined);
                        setSnMsg(`Ping: ${r.icmp ? `OK (${r.icmp_ms}ms)` : "실패"}${r.tcp !== null ? ` · TCP ${snWeb.port}: ${r.tcp ? "OK" : "실패"}` : ""}`);
                      } catch (e) { setSnMsg(e instanceof Error ? e.message : "Ping 실패"); }
                    }}>Ping 테스트</button>
                    <button onClick={async () => {
                      if (!snWeb.ip || !snWeb.port) { setSnMsg("IP/Port를 먼저 입력하세요"); return; }
                      setSnMsg("DICOM C-ECHO 테스트 중…");
                      try {
                        const r = await api.netEcho(snWeb.ip, Number(snWeb.port), snWeb.ae_title);
                        setSnMsg(`DICOM Echo: ${r.ok ? "✅ " : "❌ "}${r.detail}`);
                      } catch (e) { setSnMsg(e instanceof Error ? e.message : "Echo 실패"); }
                    }}>DICOM Echo Test</button>
                    <button onClick={async () => {
                      setSnMsg("DB 연동 테스트 중…");
                      try {
                        const r = await api.netDb();
                        setSnMsg(r.ok
                          ? `DB: ✅ ${r.dialect} (${r.latency_ms}ms) — ${r.target}`
                          : `DB: ❌ ${r.detail}`);
                      } catch (e) { setSnMsg(e instanceof Error ? e.message : "DB 테스트 실패"); }
                    }}>DB 연동 Test</button>
                  </div>
                  {snMsg && <div style={{ fontSize: 12.5, color: snMsg.includes("❌") || snMsg.includes("실패") ? "var(--stat-emergency)" : "var(--stat-final)" }}>{snMsg}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    테스트는 관리자 권한으로 백엔드 서버에서 수행됩니다 (Echo=AE Title 검증 포함, DB=현재 연결 엔진 SELECT 1).
                  </div>
                </Group>
              </>
            )}

            {page === "reading" && (
              <>
                {/* 서브탭 — 기본 설정 / 단축키 설정 / 템플릿 설정 (레퍼런스 Report 설정) */}
                <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)" }}>
                  {([["basic", "기본 설정"], ["shortcut", "단축키 설정"], ["template", "템플릿 설정"]] as const).map(([k, label]) => (
                    <div key={k} onClick={() => setRdTab(k)}
                         style={{ padding: "6px 16px", fontSize: 12.5, cursor: "pointer",
                                  fontWeight: rdTab === k ? 700 : 400,
                                  background: rdTab === k ? "var(--bg-elevated)" : undefined,
                                  borderBottom: rdTab === k ? "2px solid var(--accent)" : "2px solid transparent" }}>
                      {label}
                    </div>
                  ))}
                </div>

                {rdTab === "basic" && (
                  <>
                    <Group title="판독의 등록 — 확정 서명에 기록">
                      <Row label="이름(표시명)">
                        <input value={profName} onChange={(e) => setProfName(e.target.value)}
                               placeholder="홍길동" style={{ width: 220 }} />
                      </Row>
                      <Row label="면허번호">
                        <input value={profLicense} onChange={(e) => setProfLicense(e.target.value)}
                               placeholder="12345" style={{ width: 220 }} />
                      </Row>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button className="primary" onClick={async () => {
                          await api.putProfile(profName, profLicense);
                          setSaved("판독의 정보 저장됨 — 이후 확정(서명)부터 적용");
                        }}>판독의 정보 저장</button>
                      </div>
                    </Group>
                    <Group title="레포트 옵션">
                      {([
                        ["always_report_window", "판독 창 항상 별도로 열기 — 워크리스트 옆 웹창(검사 선택 연동)"],
                        ["open_next_after_save", "저장(확정) 후 다음 레포트 열기"],
                        ["save_alert", "레포트 저장 알림 사용"],
                        ["auto_insert_prior", "이전 검사 비교 정보 자동 삽입"],
                        ["cvr_notice", "CVR Notice — critical 소견 경고 기본 표시"],
                      ] as const).map(([k, label]) => (
                        <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                          <input type="checkbox" checked={!!rdOpts[k]}
                                 onChange={(e) => setRdOpts((p) => ({ ...p, [k]: e.target.checked }))} />
                          {label}
                        </label>
                      ))}
                      <Row label="사이드바 기본 탭">
                        <select value={String(rdOpts.sidebar_tab ?? "history")}
                                onChange={(e) => setRdOpts((p) => ({ ...p, sidebar_tab: e.target.value }))}>
                          <option value="history">판독 이력</option>
                          <option value="read">판독</option>
                        </select>
                      </Row>
                      <Row label="단축키 패널 기본 탭">
                        <select value={String(rdOpts.panel_tab ?? "shortcut")}
                                onChange={(e) => setRdOpts((p) => ({ ...p, panel_tab: e.target.value }))}>
                          <option value="shortcut">단축키</option>
                          <option value="template">템플릿</option>
                        </select>
                      </Row>
                      <Row label="텍스트 삽입 위치">
                        <select value={String(rdOpts.insert_pos ?? "end")}
                                onChange={(e) => setRdOpts((p) => ({ ...p, insert_pos: e.target.value }))}>
                          <option value="end">맨 끝에 삽입</option>
                          <option value="cursor">커서 위치에 삽입</option>
                        </select>
                      </Row>
                    </Group>
                    <Group title="시스템 단축키" right={
                      <button style={{ padding: "1px 8px", fontSize: 11 }}
                              onClick={() => setRdOpts((p) => ({ ...p, key_save: "Ctrl+S", key_approve: "Ctrl+Shift+A" }))}>
                        기본값으로 초기화
                      </button>
                    }>
                      <Row label="리포트 저장">
                        <KeyCaptureInput value={String(rdOpts.key_save ?? "Ctrl+S")}
                                         onChange={(v) => setRdOpts((p) => ({ ...p, key_save: v }))} />
                      </Row>
                      <Row label="리포트 승인">
                        <KeyCaptureInput value={String(rdOpts.key_approve ?? "Ctrl+Shift+A")}
                                         onChange={(v) => setRdOpts((p) => ({ ...p, key_approve: v }))} />
                      </Row>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                        옵션·단축키는 OK(저장) 시 계정에 저장(로밍) — 뷰어 판독 창에 즉시 적용됩니다.
                      </div>
                    </Group>
                  </>
                )}

                {rdTab === "shortcut" && (
                  <ReadingItemEditor kind="phrase" items={phrases}
                                     reload={() => api.phrases().then((r) => setPhrases(r.items))} />
                )}
                {rdTab === "template" && (
                  <ReadingItemEditor kind="template" items={phrases}
                                     reload={() => api.phrases().then((r) => setPhrases(r.items))} />
                )}
              </>
            )}

            {page === "worklist" && (
              <>
                <Group title="그리드 컬럼 구성 — Filter Setting (USE/NO USE, UBPACS형)">
                  <FilterSettingList
                    all={Object.keys(COLUMN_DEFS)}
                    selected={columns}
                    labelOf={(k) => COLUMN_DEFS[k].label}
                    onChange={setColumns}
                  />
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    USE/NO USE 클릭으로 토글, ▲▼로 표시 순서 변경 — OK(저장) 시 적용.
                  </div>
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
                <Group title="상용구 관리 (DB — Modality×부위 분류 + Alt+단축키)" right={
                  <button style={{ padding: "1px 8px", fontSize: 11 }} onClick={() => setPhraseModal("new")}>＋ 추가</button>
                }>
                  <table className="grid-table">
                    <thead><tr><th style={{ width: 90 }}>분류</th><th>NAME</th><th style={{ width: 56 }}>단축키</th><th style={{ width: 76 }}></th></tr></thead>
                    <tbody>
                      {phrases.map((p) => (
                        <tr key={p.id}>
                          <td>{p.category}</td>
                          <td title={p.text}>{p.name}</td>
                          <td style={{ color: "var(--accent)" }}>{p.shortcut && `Alt+${p.shortcut}`}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button style={{ padding: "0 6px", fontSize: 11 }} onClick={() => setPhraseModal(p)}>✏</button>
                            <button style={{ padding: "0 6px", fontSize: 11 }} onClick={async () => {
                              if (!window.confirm(`상용구 '${p.name}'을 삭제할까요?`)) return;
                              await api.deletePhrase(p.id);
                              api.phrases().then((r) => setPhrases(r.items));
                            }}>✕</button>
                          </td>
                        </tr>
                      ))}
                      {phrases.length === 0 && (
                        <tr><td colSpan={4} style={{ color: "var(--text-secondary)" }}>등록된 상용구 없음 — ＋추가</td></tr>
                      )}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    워크리스트 상용구(Std) 패널과 동일 DB — 리포트에서 Alt+단축키로 즉시 삽입.
                  </div>
                </Group>
                {phraseModal !== null && (
                  <PhraseEditModal
                    init={phraseModal === "new" ? null : phraseModal}
                    onSave={async (body) => {
                      if (phraseModal === "new") await api.createPhrase(body);
                      else await api.updatePhrase(phraseModal.id, body);
                      api.phrases().then((r) => setPhrases(r.items));
                    }}
                    onClose={() => setPhraseModal(null)}
                  />
                )}
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
                            <button style={{ padding: "0 6px", fontSize: 11 }} title="이름·검색 조건 수정"
                                    onClick={() => setTabModal({ index: i })}>수정</button>
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
                    등록된 상용구: <b>{phrases.length}건</b> (DB 테이블)
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    등록·수정·삭제는 <b>워크리스트 탭의 상용구 관리</b> 또는 워크리스트 하단 상용구(Std) 패널에서.
                    더블클릭 또는 Alt+단축키로 Conclusion에 삽입됩니다.
                  </div>
                </Group>
                <Group title="리포트 구성 (Report Composition — UBPACS p.22)">
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                    <input type="checkbox" checked={rptAiPanel} onChange={(e) => setRptAiPanel(e.target.checked)} />
                    AI Structured Report 패널 표시 (해제 시 Report 단독 — AI는 ↗ 별도 창으로만)
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                    <input type="checkbox" checked={rptAutoApply} onChange={(e) => setRptAutoApply(e.target.checked)} />
                    AI 초안을 Report에 자동 적용 (해제 시 빈 양식에서 시작 — [적용 ▶]로만 가져옴)
                  </label>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    리포트 패널: ◀▶ 이전/다음 환자 이동 · 이력 콤보(과거 버전 보기) · ↗ AI 별도 창(모니터) — 계정 로밍.
                  </div>
                </Group>
                <Group title="출력 형식">
                  <div style={{ fontSize: 12.5 }}>PDF · DICOM SR(확정 후 전송) · FHIR DiagnosticReport</div>
                </Group>
              </>
            )}

            {page === "viewer" && (
              <Group title="선택 뷰어 (Client Viewer)">
                <Row label="사용할 뷰어">
                  <select value={clientViewer} onChange={(e) => setClientViewer(e.target.value)}>
                    {CLIENT_VIEWERS.map((v) => (
                      <option key={v.id} value={v.id} disabled={!v.available}>
                        {v.label}{v.available ? "" : " (개발 중)"}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", marginLeft: 8 }}>
                    {CLIENT_VIEWERS.find((v) => v.id === clientViewer)?.desc}
                  </span>
                </Row>
              </Group>
            )}
            {page === "viewer" && (
              <Group title="In Viewer 표시 (계정별 저장)">
                <Row label="멀티선택 색">
                  <input type="color" value={infSelColor}
                         onChange={(e) => setInfSelColor(e.target.value)}
                         title="Crosslink 멀티 선택 페인 테두리 색" />
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", marginLeft: 8 }}>
                    Shift/Ctrl/A 로 선택된 페인 테두리 (기본 자주색)
                  </span>
                </Row>
                <Row label="오버레이 글자">
                  <input type="range" min={6} max={24} step={0.5} value={infOvlFont}
                         onChange={(e) => setInfOvlFont(Number(e.target.value))} /> {infOvlFont}px
                  <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, marginLeft: 12 }}>
                    <input type="checkbox" checked={infOvlVisible}
                           onChange={(e) => setInfOvlVisible(e.target.checked)} />
                    표시
                  </label>
                </Row>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  단축키(뷰어): <b>T + 마우스 스크롤</b> = 글자 크기 조절 · <b>T + Del</b> = 숨김/표시 토글 — 변경 즉시 계정에 저장됩니다.
                </div>
              </Group>
            )}
            {page === "viewer" && (
              <Group title="Modality 기본 레이아웃 (In Viewer — 행잉과 별도)">
                {["CT", "MR", "CR", "DX", "US", "XA", "*"].map((m) => (
                  <Row key={m} label={m === "*" ? "기타(전체)" : m}>
                    <span style={{ fontSize: 12 }}>Series</span>
                    <select value={defLay[m]?.s ?? ""} style={{ fontSize: 12 }}
                            onChange={(e) => setDefLay((p) => ({ ...p, [m]: { s: e.target.value, i: p[m]?.i ?? "" } }))}>
                      <option value="">자동</option>
                      {IN_LAYOUTS.map((l) => <option key={`${l.r}x${l.c}`}>{`${l.r} x ${l.c}`}</option>)}
                    </select>
                    <span style={{ fontSize: 12, marginLeft: 8 }}>Image</span>
                    <select value={defLay[m]?.i ?? ""} style={{ fontSize: 12 }}
                            onChange={(e) => setDefLay((p) => ({ ...p, [m]: { s: p[m]?.s ?? "", i: e.target.value } }))}>
                      <option value="">자동</option>
                      {IN_LAYOUTS.map((l) => <option key={`${l.r}x${l.c}`}>{`${l.r} x ${l.c}`}</option>)}
                    </select>
                  </Row>
                ))}
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  검사를 열 때 해당 Modality 의 Series(페인)/Image(타일) 분할이 자동 적용됩니다.
                  '자동' = 기존 규칙(CT/MR 다층 3x3). 행잉 프로토콜(F-18)과는 별개 설정입니다.
                </div>
              </Group>
            )}
            {page === "viewer" && (
              <Group title="툴바 사용자화 (In Viewer — 표시할 툴 선택)">
                <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)",
                              borderRadius: 4, padding: 6 }}>
                  {IN_PALETTE.map((t) => (
                    <label key={t.id}
                           style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12,
                                    padding: "2px 4px", opacity: t.impl ? 1 : 0.55 }}>
                      <input type="checkbox" checked={infTb[t.id] !== false}
                             onChange={(e) => setInfTb((p) => ({ ...p, [t.id]: e.target.checked }))} />
                      <span style={{ width: 22, textAlign: "center", flexShrink: 0 }}>{t.icon}</span>
                      <span style={{ color: "var(--text-secondary)" }}>{t.label}</span>
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  체크 해제한 툴은 뷰어 팔레트에서 숨겨집니다. 흐린 항목은 개발 예정 툴입니다.
                </div>
              </Group>
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
                    <select value={paletteSide} onChange={(e) => setPaletteSide(e.target.value as "left" | "top" | "right")}>
                      <option value="left">세로 (좌측)</option><option value="top">가로 (상단)</option>
                      <option value="right">세로 (우측)</option>
                    </select>
                  </Row>
                  <Row label="썸네일 위치">
                    <select value={thumbSide} onChange={(e) => setThumbSide(e.target.value as "left" | "bottom" | "right")}>
                      <option value="left">세로 (좌측)</option><option value="bottom">가로 (하단)</option>
                      <option value="right">세로 (우측)</option>
                    </select>
                  </Row>
                  <Row label="썸네일 크기">
                    <input type="range" min={56} max={260} step={4} value={thumbSize}
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
                  <Row label="닫기 동작">
                    <select value={closeMode}
                            onChange={(e) => setCloseMode(e.target.value as typeof closeMode)}>
                      <option value="ask">항상 묻기 (닫기 다이얼로그)</option>
                      <option value="save_current">현재 화면 저장하고 닫기</option>
                      <option value="save_all">전체 변경사항 저장하고 닫기 (주석+GSPS)</option>
                      <option value="discard">저장하지 않고 닫기</option>
                    </select>
                  </Row>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    닫기 다이얼로그에서 "기본으로" 체크 시 이 설정이 자동 변경됩니다. Exam 탭은 ✕/전체닫기 전까지 유지.
                  </div>
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
                <Group title="Tools bar 구성 (UBPACS p.18~21 — 계정 로밍)">
                  {TOOLBAR_DEFS.map((sec) => (
                    <div key={sec.section}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 3 }}>
                        {sec.section}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 3 }}>
                        {sec.items.map((t) => (
                          <label key={t.id} title={t.desc}
                                 style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                            <input type="checkbox" checked={tbConfig[t.id] !== false}
                                   onChange={(e) => setTbConfig((p) => ({ ...p, [t.id]: e.target.checked }))} />
                            <ToolIcon id={t.id === "3d" ? "mpr" : t.id} size={14} />
                            {t.label} <span style={{ color: "var(--text-secondary)", fontSize: 10.5 }}>{t.desc.split(" — ")[0].split(" (")[0]}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    체크 해제 시 뷰어 툴바에서 해당 버튼이 숨겨집니다 — 로그인 계정별 저장(로밍).
                  </div>
                </Group>
                <Group title="W/L 프리셋 (Presetting — 2D 섹션 버튼)" right={
                  <button style={{ padding: "1px 8px", fontSize: 11 }}
                          onClick={() => setWlPresets((p) => [...p, { key: `p${Date.now() % 1e5}`, label: "새 프리셋", q: "40,400" }])}>
                    ＋ 추가
                  </button>
                }>
                  <table className="grid-table">
                    <thead><tr><th>이름</th><th style={{ width: 90 }}>Center</th><th style={{ width: 90 }}>Width</th><th style={{ width: 32 }}></th></tr></thead>
                    <tbody>
                      {wlPresets.map((p, i) => {
                        const [c, w] = p.q ? p.q.split(",") : ["", ""];
                        const setQ = (nc: string, nw: string) =>
                          setWlPresets((arr) => arr.map((x, j) => j === i ? { ...x, q: nc === "" && nw === "" ? "" : `${nc},${nw}` } : x));
                        return (
                          <tr key={p.key}>
                            <td><input value={p.label} style={{ width: "95%" }}
                                       onChange={(e) => setWlPresets((arr) => arr.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /></td>
                            <td><input value={c} placeholder="(기본)" style={{ width: 70 }}
                                       onChange={(e) => setQ(e.target.value, w)} /></td>
                            <td><input value={w} style={{ width: 70 }}
                                       onChange={(e) => setQ(c, e.target.value)} /></td>
                            <td><button style={{ padding: "0 6px", fontSize: 11 }}
                                        onClick={() => setWlPresets((arr) => arr.filter((_, j) => j !== i))}>✕</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    뷰어 2D 섹션에 프리셋 버튼으로 표시 — All 토글 시 전체 페인 적용. OK(저장) 시 반영.
                  </div>
                </Group>
              </>
            )}

            {page === "monitor" && (
              <>
                <Group title="모니터 감지 · 뷰어 배치" right={
                  <span style={{ display: "flex", gap: 4 }}>
                  <button style={{ padding: "1px 10px", fontSize: 11.5 }}
                          title="각 모니터 중앙에 번호(1,2,3…)를 3초간 표시 — 어떤 모니터가 어떤 모델인지 확인"
                          onClick={async () => {
                            const w = window as unknown as {
                              getScreenDetails?: () => Promise<{
                                screens: { label?: string; availLeft: number; availTop: number; availWidth: number; availHeight: number }[];
                              }>;
                            };
                            if (!w.getScreenDetails) {
                              setMonitorMsg("이 브라우저는 모니터 확인을 지원하지 않습니다 — Chrome/Edge 권장");
                              return;
                            }
                            try {
                              const det = await w.getScreenDetails();
                              const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                              let blocked = 0;
                              det.screens.forEach((s, i) => {
                                const W = 320, H = 230;
                                const left = Math.round(s.availLeft + (s.availWidth - W) / 2);
                                const top = Math.round(s.availTop + (s.availHeight - H) / 2);
                                const pop = window.open("", `sv_ident_${i}`,
                                  `left=${left},top=${top},width=${W},height=${H},popup=1`);
                                if (!pop) { blocked++; return; }
                                pop.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>모니터 ${i + 1}</title>
<style>body{margin:0;background:#1769e0;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;overflow:hidden}
.n{font-size:120px;font-weight:800;line-height:1}.l{font-size:13px;opacity:.9;text-align:center;padding:0 12px;margin-top:6px}</style></head>
<body><div style="text-align:center"><div class="n">${i + 1}</div>
<div class="l">${esc(s.label || `모니터 ${i + 1}`)}<br>${s.availWidth}×${s.availHeight}</div></div></body></html>`);
                                pop.document.close();
                                setTimeout(() => { try { pop.close(); } catch { /* 무시 */ } }, 3000);
                              });
                              setMonitorMsg(blocked
                                ? `일부 창이 팝업 차단됨(${blocked}) — 주소창에서 팝업 허용 후 다시 시도`
                                : "각 모니터 중앙에 번호를 3초간 표시했습니다 — 목록의 번호와 대조하세요");
                            } catch { setMonitorMsg("모니터 권한이 거부되었습니다"); }
                          }}>
                    🔢 모니터 확인
                  </button>
                  <button className="primary" style={{ padding: "1px 10px", fontSize: 11.5 }} onClick={async () => {
                    const w = window as unknown as {
                      getScreenDetails?: () => Promise<{
                        screens: { label?: string; availWidth: number; availHeight: number; isPrimary?: boolean }[];
                      }>;
                    };
                    if (!w.getScreenDetails) {
                      setMonitorMsg("이 브라우저는 모니터 감지(Window Management API)를 지원하지 않습니다 — Chrome/Edge 권장");
                      return;
                    }
                    try {
                      const det = await w.getScreenDetails();
                      setMonitors(det.screens.map((s, i) => ({
                        label: s.label || `모니터 ${i + 1}`, w: s.availWidth, h: s.availHeight,
                        primary: !!s.isPrimary,
                      })));
                      setMonitorMsg(`${det.screens.length}대 감지됨 — 🔢 모니터 확인으로 번호를 대조하고 창별로 지정하세요`);
                    } catch { setMonitorMsg("모니터 권한이 거부되었습니다 — 주소창 권한 아이콘에서 허용 후 다시 시도"); }
                  }}>① 모니터 감지</button>
                  </span>
                }>
                  {monitorMsg && <div style={{ fontSize: 12, color: "var(--stat-final)" }}>{monitorMsg}</div>}
                  {monitors.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                      아직 감지된 모니터가 없습니다 — 우측 상단 <b>① 모니터 감지</b>를 누르세요
                      (최초 1회 브라우저 권한 허용 필요).
                      {(monitorSel.length > 0 || wlMon != null || rptMon != null) && (
                        <div style={{ marginTop: 4 }}>
                          현재 저장된 배치 —
                          뷰어: <b style={{ color: "var(--text-primary)" }}>{monitorSel.length ? monitorSel.map((i) => i + 1).join(", ") : "기본"}</b> ·
                          워크리스트: <b style={{ color: "var(--text-primary)" }}>{wlMon != null ? wlMon + 1 : "기본"}</b> ·
                          판독: <b style={{ color: "var(--text-primary)" }}>{rptMon != null ? rptMon + 1 : "기본"}</b>
                        </div>
                      )}
                    </div>
                  ) : (
                    <table className="grid-table">
                      <thead>
                        <tr>
                          <th>② 모니터</th>
                          <th style={{ width: 96 }} title="다중 선택=스팬">뷰어 ☑</th>
                          <th style={{ width: 96 }} title="다시 클릭=해제">워크리스트 ◉</th>
                          <th style={{ width: 96 }} title="다시 클릭=해제">판독 ◉</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monitors.map((m, i) => (
                          <tr key={i}>
                            <td>
                              <b style={{ color: "var(--accent)", marginRight: 4 }}>{i + 1}</b>
                              🖵 {m.label} ({m.w}×{m.h}){m.primary && " · 주 모니터"}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <input type="checkbox" checked={monitorSel.includes(i)}
                                     onChange={(e) => setMonitorSel((p) =>
                                       e.target.checked ? [...p, i].sort() : p.filter((x) => x !== i))} />
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <input type="radio" name="wlmon" checked={wlMon === i}
                                     onClick={() => setWlMon((p) => (p === i ? null : i))}
                                     onChange={() => {}} />
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <input type="radio" name="rptmon" checked={rptMon === i}
                                     onClick={() => setRptMon((p) => (p === i ? null : i))}
                                     onChange={() => {}} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button disabled={wlMon == null}
                            title="워크리스트를 선택한 모니터의 새 창으로 열기 (기존 탭은 닫아도 됨)"
                            onClick={async () => {
                              const { screenFeatures } = await import("../lib/screens");
                              const features = await screenFeatures(wlMon != null ? [wlMon] : null);
                              window.open(`${window.location.origin}${window.location.pathname}`, "sv_worklist", features)?.focus();
                            }}>
                      워크리스트를 해당 모니터로 열기
                    </button>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      (브라우저 보안상 현재 창은 이동 불가 — 새 창으로 엽니다)
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                    <b>사용 방법:</b> ① 모니터 감지 → 🔢 모니터 확인(각 화면에 번호 표시·목록 번호와 대조)
                    → ② 창별 모니터 지정 → ③ 하단 <b>OK(저장)</b> → ④ 다음 오픈부터 적용.<br />
                    · <b>뷰어 ☑</b>: 1대=해당 모니터 / 2대 이상=스팬+Series Layout 영상 분할 / 0대=기본 크기<br />
                    · <b>워크리스트 ◉</b>: 위 버튼으로 해당 모니터에 새 창 오픈 (라디오 재클릭=해제)<br />
                    · <b>판독 ◉</b>: 뷰어의 [Reading] 버튼이 해당 모니터에 판독 창을 띄움
                  </div>
                </Group>
                <Group title="뷰어 창 정보 (별도 포트)">
                  <div style={{ fontSize: 12.5 }}>
                    현재 뷰어 창 출처: <code>{VIEWER_BASE || "워크리스트와 동일 (같은 포트)"}</code>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                    뷰어를 별도 포트로 분리하려면 <code>frontend/.env</code>에
                    <code> VITE_VIEWER_BASE=http://localhost:5174</code> 추가 후
                    <code> npm run dev:viewer</code>를 함께 실행하세요 (재기동 필요).
                  </div>
                </Group>
              </>
            )}

            {page === "policy" && (
              <Group title="탐색 방향 정책 — ◀▶ 환자 이동 (뷰어·판독 창·워크리스트 공통)">
                <Row label="◀ (왼쪽) 버튼">
                  <select value={polNavLeft} onChange={(e) => setPolNavLeft(e.target.value as "past" | "recent")}>
                    <option value="past">시간상 과거로 (워크리스트 아래 행 방향)</option>
                    <option value="recent">시간상 최신으로 (워크리스트 위 행 방향)</option>
                  </select>
                </Row>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  워크리스트는 최신 검사가 위에 정렬됩니다. ◀▶는 열려 있는 환자(현재 보고 있는 검사)를
                  기준으로 <b>시간대별 한 단계씩</b> 이동하며, ▶(오른쪽)는 항상 ◀의 반대 방향입니다.<br />
                  · <b>과거로(기본)</b>: ◀=한 단계 과거(아래 행) / ▶=한 단계 최신(위 행)<br />
                  · <b>최신으로</b>: ◀=한 단계 최신(위 행) / ▶=한 단계 과거(아래 행)<br />
                  이동 대상 환자가 이미 Exam 탭으로 열려 있으면 그 탭으로 전환되고, 아니면 열면서 이동합니다.
                  Worklist·Image Viewer·Reading Viewer는 열린 환자를 서로 따라갑니다(연동). OK(저장) 시 적용.
                </div>
              </Group>
            )}

            {page === "hp" && (
              <Group title="행잉 프로토콜 (HP) — 장비×부위×Projection → Series/Image Layout" right={
                <button style={{ padding: "1px 8px", fontSize: 11 }} onClick={() => setHpModal("new")}>＋ 규칙 추가</button>
              }>
                <table className="grid-table">
                  <thead><tr><th>이름</th><th>장비</th><th>부위</th><th>Projection</th><th>Series</th><th>Image</th><th>W/L</th><th style={{ width: 60 }}></th></tr></thead>
                  <tbody>
                    {hpRules.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td><td>{r.modality || "*"}</td><td>{r.body_part || "*"}</td>
                        <td>{r.projection || "*"}</td>
                        <td>{r.s.r}×{r.s.c}</td><td>{r.i.r}×{r.i.c}</td><td>{r.wl || "-"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button style={{ padding: "0 6px", fontSize: 11 }} onClick={() => setHpModal(r)}>✏</button>
                          <button style={{ padding: "0 6px", fontSize: 11 }} onClick={async () => {
                            if (!window.confirm(`HP 규칙 '${r.name}'을 삭제할까요?`)) return;
                            const next = hpRules.filter((x) => x.id !== r.id);
                            setHpRules(next);
                            await api.putSetting("viewer.hp", { rules: next }, "user");
                            setSaved("HP 규칙 저장됨");
                          }}>✕</button>
                        </td>
                      </tr>
                    ))}
                    {hpRules.length === 0 && (
                      <tr><td colSpan={8} style={{ color: "var(--text-secondary)" }}>
                        규칙 없음 — 예: CR/CHEST/PA → Series 1×1·Image 1×1, MR/SHOULDER → Series 2×2
                      </td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  뷰어가 열릴 때 위에서부터 첫 일치 규칙이 자동 적용되고, 타이틀바 HP 메뉴에서 수동 전환할 수 있습니다.
                  조건이 빈 항목(*)은 무관 매칭 — 계정별 저장(로밍).
                </div>
                {hpModal !== null && (
                  <HpEditModal
                    init={hpModal === "new" ? null : hpModal}
                    onSave={async (rule) => {
                      const next = hpModal === "new"
                        ? [...hpRules, rule]
                        : hpRules.map((x) => (x.id === rule.id ? rule : x));
                      setHpRules(next);
                      await api.putSetting("viewer.hp", { rules: next }, "user");
                      setSaved("HP 규칙 저장됨");
                      setHpModal(null);
                    }}
                    onClose={() => setHpModal(null)}
                  />
                )}
              </Group>
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
                <Group title="음성 판독 STT 엔진 (Whisper 오픈소스 / 상용 API)">
                  <Row label="엔진">
                    <select value={sttEngine} onChange={(e) => setSttEngine(e.target.value)}>
                      <option value="browser">브라우저 내장 (Web Speech — 기본)</option>
                      <option value="whisper_local">Whisper 로컬 (오픈소스 — 온프레미스, PHI 안전)</option>
                      <option value="openai_api">OpenAI API (상용 — whisper-1)</option>
                    </select>
                  </Row>
                  <Row label="모델">
                    <input value={sttModel} onChange={(e) => setSttModel(e.target.value)}
                           placeholder={sttEngine === "openai_api" ? "whisper-1" : "base / small / medium…"}
                           style={{ width: 220 }} />
                  </Row>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    Whisper 로컬: <code>pip install faster-whisper</code> 필요(미설치 시 안내 응답).
                    <b style={{ color: "var(--stat-emergency)" }}> OpenAI API는 음성이 외부로 전송됩니다</b> —
                    API 키는 서버 환경변수 <code>OPENAI_API_KEY</code>로만 설정(코드/설정 저장 금지).
                  </div>
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
    </div>
  );
}

/* ── 키 캡처 입력 (시스템 단축키 — [입력] 후 키 조합을 누르면 기록) ── */
function KeyCaptureInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [cap, setCap] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input ref={ref} value={value} readOnly placeholder="키를 입력하세요"
             style={{ width: 140, background: cap ? "var(--accent-subtle)" : undefined }}
             onKeyDown={(e) => {
               if (!cap) return;
               e.preventDefault();
               if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
               const combo = [e.ctrlKey && "Ctrl", e.shiftKey && "Shift", e.altKey && "Alt",
                              e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join("+");
               onChange(combo);
               setCap(false);
             }} />
      <button className={cap ? "primary" : ""} style={{ padding: "1px 9px", fontSize: 11 }}
              onClick={() => { setCap((c) => !c); ref.current?.focus(); }}>
        {cap ? "입력 중…" : "입력"}
      </button>
      <button style={{ padding: "1px 9px", fontSize: 11 }} onClick={() => onChange("")}>지우기</button>
    </span>
  );
}

/* ── 판독 단축키/템플릿 편집기 (레퍼런스: 목록 | 추가 폼 — 모달리티·코드·이름·판독·결론) ── */
function ReadingItemEditor({ kind, items, reload }: {
  kind: "phrase" | "template";
  items: PhraseRow[];
  reload: () => void;
}) {
  const list = items.filter((p) => p.kind === kind);
  const label = kind === "phrase" ? "단축키" : "템플릿";
  const [sel, setSel] = useState<PhraseRow | null>(null);
  const empty = { name: "", modality: "", shortcut: "", reading_text: "", text: "" };
  const [f, setF] = useState(empty);
  const [cap, setCap] = useState(false);
  useEffect(() => {
    setF(sel ? { name: sel.name, modality: sel.modality, shortcut: sel.shortcut,
                 reading_text: sel.reading_text, text: sel.text } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const save = async () => {
    try {
      const body = { ...f, kind, body_part: sel?.body_part ?? "" };
      if (sel) await api.updatePhrase(sel.id, body);
      else await api.createPhrase(body);
      setSel(null);
      setF(empty);
      reload();
    } catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); }
  };

  return (
    <div style={{ display: "flex", gap: 14, minHeight: 320 }}>
      {/* 좌: 목록 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: 12.5 }}>{label} 목록</b>
          <button className="primary" style={{ padding: "2px 10px", fontSize: 11.5 }}
                  onClick={() => { setSel(null); setF(empty); }}>＋ {label} 추가</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
          {list.map((p) => (
            <div key={p.id} onClick={() => setSel(p)}
                 style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #24282d",
                          display: "flex", gap: 6, alignItems: "center",
                          background: sel?.id === p.id ? "var(--accent-subtle)" : undefined }}>
              <span style={{ color: "var(--text-secondary)" }}>[{p.modality || "공통"}]</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
              {p.shortcut && <span style={{ color: "var(--accent)" }}>Alt+{p.shortcut}</span>}
              <button style={{ padding: "0 6px", fontSize: 11 }} onClick={async (e) => {
                e.stopPropagation();
                if (!window.confirm(`'${p.name}'을 삭제할까요?`)) return;
                await api.deletePhrase(p.id);
                if (sel?.id === p.id) setSel(null);
                reload();
              }}>✕</button>
            </div>
          ))}
          {list.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: "var(--text-secondary)", textAlign: "center" }}>
              등록된 {label}가 없습니다.
            </div>
          )}
        </div>
      </div>
      {/* 우: 추가/수정 폼 (레퍼런스 폼 구성) */}
      <div style={{ flex: 1.1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
        <b style={{ fontSize: 12.5 }}>{sel ? `${label} 수정 — ${sel.name}` : `새 ${label} 추가`}</b>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>모달리티</div>
        <select value={f.modality} onChange={(e) => setF((p) => ({ ...p, modality: e.target.value }))}>
          <option value="">공통 (모든 장비)</option>
          {["CR", "DX", "CT", "MR", "US", "MG", "XA", "NM"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {kind === "phrase" && (
          <>
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>단축키 코드 (Alt+키)</div>
            <div style={{ display: "flex", gap: 4 }}>
              <input value={f.shortcut} readOnly placeholder="단축키를 입력하세요"
                     style={{ flex: 1, background: cap ? "var(--accent-subtle)" : undefined }}
                     onKeyDown={(e) => {
                       if (!cap) return;
                       e.preventDefault();
                       if (/^[a-zA-Z0-9]$/.test(e.key)) { setF((p) => ({ ...p, shortcut: e.key.toUpperCase() })); setCap(false); }
                     }} />
              <button className={cap ? "primary" : ""} style={{ padding: "2px 10px", fontSize: 11.5 }}
                      onClick={(e) => { setCap((c) => !c); (e.currentTarget.previousElementSibling as HTMLInputElement)?.focus(); }}>
                입력
              </button>
            </div>
          </>
        )}
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{label} 이름</div>
        <input value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>판독 (Reading)</div>
        <textarea value={f.reading_text} rows={5}
                  onChange={(e) => setF((p) => ({ ...p, reading_text: e.target.value }))}
                  style={{ background: "var(--bg-canvas)", color: "var(--text-primary)", border: "1px solid var(--border)",
                           borderRadius: 3, padding: 6, fontFamily: "inherit", fontSize: 12, resize: "vertical" }} />
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>결론 (Conclusion)</div>
        <textarea value={f.text} rows={4}
                  onChange={(e) => setF((p) => ({ ...p, text: e.target.value }))}
                  style={{ background: "var(--bg-canvas)", color: "var(--text-primary)", border: "1px solid var(--border)",
                           borderRadius: 3, padding: 6, fontFamily: "inherit", fontSize: 12, resize: "vertical" }} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="primary" style={{ padding: "4px 18px" }}
                  disabled={!f.name.trim() || !(f.text.trim() || f.reading_text.trim())}
                  onClick={() => void save()}>저장</button>
        </div>
      </div>
    </div>
  );
}

/* ── HP 규칙 편집 모달 ── */
function HpEditModal({ init, onSave, onClose }: {
  init: HpRule | null;
  onSave: (rule: HpRule) => Promise<void>;
  onClose: () => void;
}) {
  const [f, setF] = useState<HpRule>(init ?? {
    id: `hp${Date.now().toString(36)}`, name: "", modality: "", body_part: "",
    projection: "", s: { r: 1, c: 1 }, i: { r: 1, c: 1 }, wl: "",
  });
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
      <span style={{ width: 86, color: "var(--text-secondary)", flexShrink: 0 }}>{label}</span>
      {children}
    </label>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 400 }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
                    width: 440, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 13 }}>{init ? `HP 규칙 수정 — ${init.name}` : "새 HP 규칙"}</b>
        <Row label="이름 *">
          <input autoFocus value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
                 placeholder="예: 흉부 CR 정면" style={{ flex: 1 }} />
        </Row>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Row label="장비(MOD)">
            <select value={f.modality} onChange={(e) => setF((p) => ({ ...p, modality: e.target.value }))} style={{ flex: 1 }}>
              <option value="">* 모든 장비</option>
              {["CR", "DX", "CT", "MR", "US", "MG", "XA", "NM"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Row>
          <Row label="부위">
            <input value={f.body_part} onChange={(e) => setF((p) => ({ ...p, body_part: e.target.value.toUpperCase() }))}
                   placeholder="CHEST (빈칸=무관)" style={{ flex: 1, minWidth: 0 }} />
          </Row>
          <Row label="Projection">
            <select value={f.projection} onChange={(e) => setF((p) => ({ ...p, projection: e.target.value }))} style={{ flex: 1 }}>
              <option value="">* 무관</option>
              {["PA", "AP", "LAT", "OBL", "AXIAL"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Row>
          <Row label="W/L">
            <input value={f.wl ?? ""} onChange={(e) => setF((p) => ({ ...p, wl: e.target.value }))}
                   placeholder="center,width (빈칸=기본)" style={{ flex: 1, minWidth: 0 }} />
          </Row>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>레이아웃:</span>
          <GridPicker label="Series" max={3} value={f.s} onPick={(v) => setF((p) => ({ ...p, s: v }))} />
          <GridPicker label="Image" max={3} value={f.i} onPick={(v) => setF((p) => ({ ...p, i: v }))} />
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button className="primary" disabled={!f.name.trim()}
                  onClick={() => void onSave({ ...f, name: f.name.trim() })}>저장</button>
          <button onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}

/* ── Filter Setting 리스트 (UBPACS형 — ITEM | USE/NO USE 토글 + ▲▼ 순서) ── */
function FilterSettingList({ all, selected, labelOf, onChange }: {
  all: string[];
  selected: string[];
  labelOf: (k: string) => string;
  onChange: (next: string[]) => void;
}) {
  const rows = [...selected, ...all.filter((k) => !selected.includes(k))];
  const move = (k: string, dir: -1 | 1) => {
    const i = selected.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div style={{ maxHeight: 250, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
      <table className="grid-table">
        <thead><tr><th>ITEM</th><th style={{ width: 78 }}>사용</th><th style={{ width: 64 }}>순서</th></tr></thead>
        <tbody>
          {rows.map((k) => {
            const used = selected.includes(k);
            const i = selected.indexOf(k);
            return (
              <tr key={k}>
                <td style={{ color: used ? "var(--text-primary)" : "var(--text-secondary)" }}>{labelOf(k)}</td>
                <td>
                  <span onClick={() => onChange(used ? selected.filter((x) => x !== k) : [...selected, k])}
                        title="클릭=토글"
                        style={{
                          cursor: "pointer", fontWeight: 700, fontSize: 10.5, padding: "1px 7px",
                          border: "1px solid var(--border)", borderRadius: 3,
                          color: used ? "var(--stat-final)" : "var(--text-secondary)",
                          background: used ? "rgba(80,200,120,0.12)" : undefined,
                        }}>
                    {used ? "USE" : "NO USE"}
                  </span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {used && (
                    <>
                      <button style={{ padding: "0 5px", fontSize: 10.5 }} disabled={i === 0}
                              onClick={() => move(k, -1)}>▲</button>
                      <button style={{ padding: "0 5px", fontSize: 10.5 }} disabled={i === selected.length - 1}
                              onClick={() => move(k, 1)}>▼</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
