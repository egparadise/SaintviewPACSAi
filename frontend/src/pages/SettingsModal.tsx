// 설정 모달 — 화면분석 §5.5 설정 IA: 사용자/관리자 2계층
import { useEffect, useState } from "react";
import { api, type AiQuality } from "../api";

export function SettingsModal({ role, onClose }: { role: string; onClose: () => void }) {
  const isAdmin = role === "admin";
  // 관리자: PDF 템플릿 + AI 정책
  const [hospital, setHospital] = useState("");
  const [department, setDepartment] = useState("");
  const [footer, setFooter] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [vision, setVision] = useState(false);
  const [quality, setQuality] = useState<AiQuality | null>(null);
  const [saved, setSaved] = useState("");
  // 사용자 환경설정 (화면분석 §5.4/§5.5)
  const [refreshSec, setRefreshSec] = useState(10);
  const [defaultStatus, setDefaultStatus] = useState("");
  const [hangingCT, setHangingCT] = useState("default");
  const [hangingMR, setHangingMR] = useState("default");

  useEffect(() => {
    api.getSetting("worklist.prefs").then((r) => {
      const v = r.value as { auto_refresh_sec?: number; default_status?: string };
      if (v.auto_refresh_sec !== undefined) setRefreshSec(v.auto_refresh_sec);
      setDefaultStatus(v.default_status ?? "");
    }).catch(() => {});
    api.getSetting("viewer.prefs").then((r) => {
      const h = (r.value as { hanging?: Record<string, string> }).hanging ?? {};
      setHangingCT(h.CT ?? "default");
      setHangingMR(h.MR ?? "default");
    }).catch(() => {});
    if (!isAdmin) return;
    api.getSetting("pdf.template").then((r) => {
      const v = r.value as Record<string, string>;
      setHospital(v.hospital ?? "");
      setDepartment(v.department ?? "");
      setFooter(v.footer ?? "");
    });
    api.getSetting("ai.policy").then((r) => {
      const v = r.value as Record<string, boolean>;
      setAutoGenerate(v.auto_generate ?? true);
      setVision(v.vision ?? false);
    });
    api.aiQuality().then(setQuality).catch(() => {});
  }, [isAdmin]);

  const save = async () => {
    await api.putSetting(
      "worklist.prefs",
      { auto_refresh_sec: refreshSec, default_status: defaultStatus },
      "user",
    );
    await api.putSetting(
      "viewer.prefs",
      { hanging: { CT: hangingCT, MR: hangingMR } },
      "user",
    );
    if (isAdmin) {
      await api.putSetting("pdf.template", { hospital, department, footer }, "global");
      await api.putSetting("ai.policy", { auto_generate: autoGenerate, vision }, "global");
    }
    setSaved("저장되었습니다 — 새로고침 시 적용");
    setTimeout(onClose, 800);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "grid", placeItems: "center", zIndex: 100,
    }}>
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
        width: 520, maxHeight: "85vh", overflow: "auto",
        display: "flex", flexDirection: "column", gap: 12, padding: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <b>설정</b>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>닫기</button>
        </div>

        <Section title="워크리스트 (사용자)">
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            자동 갱신
            <select value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))}>
              <option value={0}>끔</option>
              <option value={5}>5초</option>
              <option value={10}>10초</option>
              <option value={30}>30초</option>
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            기본 상태 필터
            <select value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value)}>
              <option value="">전체</option>
              <option value="draft_ready">AI초안</option>
              <option value="reading">판독중</option>
              <option value="received">도착</option>
            </select>
          </label>
        </Section>

        <Section title="뷰어 행잉 프로토콜 (F-18, 사용자)">
          {([["CT", hangingCT, setHangingCT], ["MR", hangingMR, setHangingMR]] as const).map(
            ([mod, val, set]) => (
              <label key={mod} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {mod}
                <select value={val} onChange={(e) => set(e.target.value)}>
                  <option value="default">기본 (스택)</option>
                  <option value="mpr">MPR</option>
                </select>
              </label>
            ),
          )}
        </Section>

        {isAdmin ? (
          <>
            <Section title="판독서 PDF 템플릿 (기관)">
              <label>병원명 <input value={hospital} onChange={(e) => setHospital(e.target.value)} style={{ width: "100%" }} /></label>
              <label>부서 <input value={department} onChange={(e) => setDepartment(e.target.value)} style={{ width: "100%" }} /></label>
              <label>푸터 <input value={footer} onChange={(e) => setFooter(e.target.value)} style={{ width: "100%" }} /></label>
            </Section>

            <Section title="AI 정책">
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={autoGenerate} onChange={(e) => setAutoGenerate(e.target.checked)} />
                검사 도착 시 초안 자동 생성
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
                키이미지 vision 분석 (F-11) — <span style={{ color: "var(--ai)" }}>영상 참고 관찰로만 표기</span>
              </label>
            </Section>

            {quality && quality.with_ai_draft > 0 && (
              <Section title="AI 품질 지표 (F-20)">
                <table className="grid-table">
                  <tbody>
                    <tr><td>AI 초안 기반 확정</td><td>{quality.with_ai_draft} / {quality.finalized_total}건</td></tr>
                    <tr><td>무수정 수용률</td><td>{((quality.acceptance_rate ?? 0) * 100).toFixed(1)}%</td></tr>
                    <tr><td>평균 수정률</td><td>{((quality.avg_modified_ratio ?? 0) * 100).toFixed(1)}%</td></tr>
                    <tr>
                      <td>critical 변경</td>
                      <td style={{ color: (quality.critical_dropped || quality.critical_added) ? "var(--stat-emergency)" : undefined }}>
                        탈락 {quality.critical_dropped ?? 0} / 추가 {quality.critical_added ?? 0}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            )}
          </>
        ) : null}

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saved && <span style={{ color: "var(--stat-final)", fontSize: 12 }}>{saved}</span>}
          <div style={{ flex: 1 }} />
          <button className="primary" onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: "var(--text-secondary)",
        textTransform: "uppercase", borderBottom: "1px solid var(--border)", paddingBottom: 2,
      }}>{title}</div>
      {children}
    </section>
  );
}
