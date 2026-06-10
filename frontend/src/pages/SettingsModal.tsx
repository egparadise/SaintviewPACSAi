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

  useEffect(() => {
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
    if (isAdmin) {
      await api.putSetting("pdf.template", { hospital, department, footer }, "global");
      await api.putSetting("ai.policy", { auto_generate: autoGenerate, vision }, "global");
    }
    setSaved("저장되었습니다");
    setTimeout(onClose, 600);
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
        ) : (
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
            사용자 환경 설정(기본 필터·뷰어)은 다음 버전에서 제공됩니다.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saved && <span style={{ color: "var(--stat-final)", fontSize: 12 }}>{saved}</span>}
          <div style={{ flex: 1 }} />
          {isAdmin && <button className="primary" onClick={save}>저장</button>}
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
