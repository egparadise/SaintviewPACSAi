// 뷰어 전용 웹페이지 — 워크리스트에서 window.open으로 열리는 별도 창 (?viewer=2d&study=ID)
// Study Open 옵션(Add/Stack/Key/With Open)을 URL 파라미터로 전달받아 Viewer2D를 전체 화면으로 띄운다.
import { Suspense, lazy, useEffect, useState } from "react";
import { api, ensureToken, type StudyDetail } from "../api";

const Viewer2D = lazy(() => import("./Viewer2D").then((m) => ({ default: m.Viewer2D })));

export function ViewerWindow() {
  const params = new URLSearchParams(window.location.search);
  const studyId = Number(params.get("study") || 0);
  const addId = Number(params.get("add") || 0);
  const stackId = Number(params.get("stack") || 0);
  const keySops = (params.get("keysops") ?? "").split(",").filter(Boolean);
  const woMode = params.get("wo_mode");
  const woIds = (params.get("wo_ids") ?? "").split(",").map(Number).filter(Boolean);

  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [addDetail, setAddDetail] = useState<StudyDetail | null>(null);
  const [stackDetail, setStackDetail] = useState<StudyDetail | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!studyId) { setErr("study 파라미터가 없습니다"); return; }
    // 타 포트(타 출처) 뷰어: opener에서 토큰 핸드셰이크 후 로드
    void ensureToken().then((ok) => {
      if (!ok) { setErr("인증 토큰을 받지 못했습니다"); return; }
      api.study(studyId).then((d) => {
        setDetail(d);
        document.title = `Saintview Viewer — ${d.modality} ${d.patient_name} ${d.study_date}`;
      }).catch((e) => setErr(e instanceof Error ? e.message : "검사 로드 실패"));
      if (addId) api.study(addId).then(setAddDetail).catch(() => {});
      if (stackId) api.study(stackId).then(setStackDetail).catch(() => {});
    });
  }, [studyId, addId, stackId]);

  if (err) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--stat-emergency)" }}>
        {err} — 워크리스트 창에서 다시 열어주세요. <button onClick={() => window.close()}>닫기</button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-secondary)" }}>
        뷰어 로딩…
      </div>
    );
  }
  return (
    <Suspense fallback={
      <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-secondary)" }}>
        뷰어 로딩…
      </div>
    }>
      <Viewer2D detail={detail}
                addDetail={addDetail}
                stackDetail={stackDetail}
                keySops={keySops.length ? keySops : undefined}
                withOpen={woMode === "add" || woMode === "stack"
                  ? { mode: woMode, ids: woIds } : undefined}
                onClose={() => window.close()} />
    </Suspense>
  );
}
