// In Viewer — INFINITT PiViewSTAR 스타일 Client 뷰어 (개발 중).
// 구성은 lib/infiConfig.ts(파일 수준 분석 근거)에 선언적으로 등록되어 있고, 이 화면이 그 구성을 소비한다.
// Viewer2D(TY Viewer)와 동일한 props 계약 — ViewerWindow 컴포넌트 맵에서 교체 가능.
import type { StudyDetail } from "../api";
import { IN_LAYOUTS, IN_MODALITY_TABS, IN_SHORTCUTS, IN_TOOLBAR, IN_WL_PRESETS_CT, IN_WL_PRESETS_MR, IN_WORKLIST_COLUMNS } from "../lib/infiConfig";

export function ViewerInfi({ detail, onClose }: {
  detail: StudyDetail;
  onClose: () => void;
  addDetail?: StudyDetail | null;
  stackDetail?: StudyDetail | null;
  keySops?: string[] | null;
  withOpen?: { mode: "add" | "stack"; ids: number[] } | null;
}) {
  const implCount = IN_TOOLBAR.flatMap((w) => w.items).filter((t) => t.impl).length;
  const totalCount = IN_TOOLBAR.flatMap((w) => w.items).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "var(--text-secondary)", padding: 16, gap: 10, overflow: "auto" }}>
      <div style={{ fontSize: 17, color: "var(--text-primary)" }}>
        In Viewer — INFINITT 스타일 (개발 중)
        <button style={{ float: "right" }} onClick={onClose}>닫기</button>
      </div>
      <div style={{ fontSize: 12.5 }}>
        {detail.modality} · {detail.patient_name} · {detail.study_date} │ 구성 등록 완료:
        툴 {implCount}/{totalCount} 재사용 가능 · 레이아웃 {IN_LAYOUTS.map((l) => `${l.r}x${l.c}`).join(" ")} ·
        모달리티 탭 {IN_MODALITY_TABS.length}종 · 컬럼 {IN_WORKLIST_COLUMNS.length}종 ·
        CT W/L {IN_WL_PRESETS_CT.length} · MR W/L {IN_WL_PRESETS_MR.length} · 단축키 {IN_SHORTCUTS.length}
      </div>
      {IN_TOOLBAR.map((ws) => (
        <div key={ws.workspace} style={{ fontSize: 12 }}>
          <b style={{ color: "var(--text-primary)" }}>{ws.workspace}</b>{" — "}
          {ws.items.map((t) => (
            <span key={t.id} title={t.desc}
                  style={{ marginRight: 8, opacity: t.impl ? 1 : 0.45 }}>
              {t.label}{t.impl ? "" : "*"}
            </span>
          ))}
        </div>
      ))}
      <div style={{ fontSize: 11.5, marginTop: "auto" }}>
        * 표시는 미구현 툴(개발 대상). 화면 구현 전까지 설정 &gt; 뷰어 &gt; 선택 뷰어에서 TY Viewer 를 사용하세요.
        근거 문서: docs/ANALYSIS_INFINITT_파일정밀분석.md
      </div>
    </div>
  );
}
