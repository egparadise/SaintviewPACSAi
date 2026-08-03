// 영상 오버레이 배치 편집기 — 모달리티별로 어떤 정보를 상자의 어느 귀퉁이에 띄울지 고른다.
// 미리보기 그림이 핵심: 바깥 상자 = 시리즈(페인), 안쪽 점선 상자 = Image Layout 칸.
// 귀퉁이를 누르면 그림이 즉시 바뀌어 "이 값이 어디에 나오는지" 눈으로 확인된다.
import { useState } from "react";
import {
  OV_CORNERS, OV_FIELDS, OV_FIELD_LABEL, OV_MODALITIES, fieldsAt, overlayFor, ovModalityLabel,
  type OvCorner, type OvPlace, type OvScope, type OverlayCfg,
} from "../lib/overlayFields";
import { t as tr } from "../lib/i18n";

const CORNER_POS: Record<Exclude<OvCorner, "off">, React.CSSProperties> = {
  tl: { top: 6, left: 8, textAlign: "left" },
  tr: { top: 6, right: 8, textAlign: "right" },
  bl: { bottom: 6, left: 8, textAlign: "left" },
  br: { bottom: 6, right: 8, textAlign: "right" },
};

export function OverlayLayoutEditor({ cfg, onChange }: {
  cfg: OverlayCfg;
  onChange: (next: OverlayCfg) => void;
}) {
  const [mod, setMod] = useState("*");
  // 표시는 '실제 적용될 값'(기본 → 공통 → 장비별)이고, 저장은 이 탭에서 건드린 것만 남긴다.
  const place = overlayFor(cfg, mod === "*" ? "" : mod);
  const own = cfg[mod] ?? {};

  const set = (key: string, patch: Partial<OvPlace>) => {
    const cur: OvPlace = place[key] ?? { c: "off", s: "series" };
    onChange({ ...cfg, [mod]: { ...own, [key]: { ...cur, ...patch } } });
  };

  /** 미리보기 상자의 한 귀퉁이 — 그 자리에 배치된 필드 라벨을 그대로 보여준다 */
  const Corner = ({ c, scope }: { c: Exclude<OvCorner, "off">; scope: OvScope }) => {
    const keys = fieldsAt(place, c, scope);
    return (
      <div style={{ position: "absolute", ...CORNER_POS[c], maxWidth: "46%", pointerEvents: "none",
                    fontSize: 9.5, lineHeight: 1.5, color: scope === "image" ? "#7dd3fc" : "var(--text-primary)",
                    textShadow: "0 0 4px #000" }}>
        {keys.length
          ? keys.map((k) => <div key={k} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{OV_FIELD_LABEL[k]}</div>)
          : <span style={{ opacity: 0.28 }}>—</span>}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* 모달리티 선택 — 공통 + 장비별 */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", marginRight: 2 }}>{tr("모달리티")}</span>
        {OV_MODALITIES.map((m) => (
          <button key={m} onClick={() => setMod(m)}
                  title={m === "*" ? "모달리티별 설정이 없을 때 쓰이는 공통 배치" : `${m} 검사에만 적용`}
                  style={{ padding: "2px 9px", fontSize: 11.5,
                           ...(mod === m ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : {}) }}>
            {ovModalityLabel(m)}
          </button>
        ))}
      </div>

      {/* 미리보기 — 바깥=시리즈 상자, 안쪽 점선=Image Layout 칸 */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 340, height: 200, background: "#0b0f16",
                      border: "1px solid var(--border)", borderRadius: 6, flexShrink: 0 }}>
          <Corner c="tl" scope="series" /><Corner c="tr" scope="series" />
          <Corner c="bl" scope="series" /><Corner c="br" scope="series" />
          <div style={{ position: "absolute", inset: "34% 26%", border: "1px dashed #38bdf8",
                        borderRadius: 3, background: "rgba(56,189,248,0.05)" }}>
            <Corner c="tl" scope="image" /><Corner c="tr" scope="image" />
            <Corner c="bl" scope="image" /><Corner c="br" scope="image" />
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.8, maxWidth: 300 }}>{tr("· 바깥 상자 =")}<b style={{ color: "var(--text-primary)" }}>{tr("시리즈(페인)")}</b>{tr("— 페인당 한 번 표시")}<br />{tr("· 안쪽 점선 =")}<b style={{ color: "#7dd3fc" }}>{tr("이미지 칸")}</b>{tr("— Image Layout 으로 나눈 칸마다 표시")}<br />{tr("· 분할이 1×1 이면 두 상자가 같은 영역이라")}<b>{tr("시리즈")}</b>{tr("것만 그립니다(중복 방지).")}<br />
          · <b>{tr("공통")}</b>{tr("은 모달리티별 설정이 없을 때 쓰입니다. 장비 탭에서 바꾸면 그 모달리티만 달라집니다.")}</div>
      </div>

      {/* 필드별 배치 */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 0,
                      background: "var(--bg-elevated)", fontSize: 11.5, fontWeight: 700,
                      padding: "5px 9px", borderBottom: "1px solid var(--border)" }}>
          <span>{tr("정보")}</span><span style={{ padding: "0 8px" }}>{tr("위치")}</span><span>{tr("범위")}</span>
        </div>
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {OV_FIELDS.map((f) => {
            const p: OvPlace = place[f.key] ?? { c: "off", s: "series" };
            return (
              <div key={f.key} title={f.hint}
                   style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center",
                            gap: 0, padding: "3px 9px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ opacity: p.c === "off" ? 0.5 : 1 }}>{f.label}</span>
                <span style={{ display: "flex", gap: 2, padding: "0 8px" }}>
                  {OV_CORNERS.map((c) => (
                    <button key={c.k} title={c.label} onClick={() => set(f.key, { c: c.k })}
                            style={{ width: 26, padding: "1px 0", fontSize: 11,
                                     ...(p.c === c.k ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : {}) }}>
                      {c.icon}
                    </button>
                  ))}
                </span>
                <select value={p.s} onChange={(e) => set(f.key, { s: e.target.value as OvScope })}
                        disabled={p.c === "off"} style={{ fontSize: 11.5, width: 78 }}>
                  <option value="series">{tr("시리즈")}</option>
                  <option value="image">{tr("이미지")}</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{tr("뷰어의 INFO 버튼(오버레이 토글)이 꺼져 있으면 아무것도 표시되지 않습니다. 이미 열려 있는 뷰어에는 다음에 검사를 열 때 반영됩니다.")}</div>
    </div>
  );
}
