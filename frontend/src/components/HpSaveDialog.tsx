// 행잉 프로토콜 '직접설정' 저장 — 지금 뷰어 화면 구성을 프로토콜로 등록한다.
//
// 흐름: 뷰어 HP 메뉴에서 [직접설정] 체크 → 화면을 원하는 대로 구성 → [현재 화면을 프로토콜로 저장]
//       → 이 창에서 이름·매칭 조건(장비/부위/부위를 찾을 필드)·옵션을 정하고 저장.
// 저장 위치는 설정 ▸ 행잉(HP) 과 동일한 `viewer.hp`(계정별) — 설정 창에서 곧바로 이어서 보인다.
import { useState } from "react";
import { api } from "../api";
import {
  HP_BP_SOURCES, HP_BP_SOURCE_DEFAULT, HP_MODALITIES, HP_SLOT_SOURCES,
  buildHpRule, type HpCapture, type HpRule,
} from "../lib/viewerConfig";

export function HpSaveDialog({ capture, study, onClose, onSaved }: {
  capture: HpCapture;
  study: { modality: string; body_part?: string; study_desc?: string };
  onClose: () => void;
  onSaved: (rules: HpRule[], saved: HpRule) => void;
}) {
  const [name, setName] = useState("");
  const [modality, setModality] = useState((study.modality || "").toUpperCase());
  const [bodyPart, setBodyPart] = useState((study.body_part || "").toUpperCase());
  const [projection, setProjection] = useState("");
  const [desc, setDesc] = useState("");
  const [sources, setSources] = useState<string[]>([...HP_BP_SOURCE_DEFAULT]);
  const [priority, setPriority] = useState(false);
  // 행잉의 기본은 '적용되지 않음' — 검사를 열 때는 뷰어 공통 Layout 이 기본이다
  const [onOpen, setOnOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const n = Math.max(1, capture.s.r * capture.s.c);
  const slotLabel = (k: string) => HP_SLOT_SOURCES.find((o) => o.k === k)?.label ?? k;

  const save = async () => {
    if (!name.trim()) { setErr("프로토콜명을 입력하세요"); return; }
    setErr(""); setBusy(true);
    try {
      // 규칙 목록 전체를 받아 뒤에 덧붙인다 — 설정 창과 같은 페이로드 형식({ rules })
      const cur = await api.getSetting("viewer.hp").catch(() => ({ value: {} as Record<string, unknown> }));
      const rules = ((cur.value as { rules?: HpRule[] }).rules) ?? [];
      const rule = buildHpRule(
        { name, modality, body_part: bodyPart, projection, description: desc,
          bp_sources: sources, priority, use_on_exam_open: onOpen },
        capture,
      );
      const next = [...rules, rule];
      await api.putSetting("viewer.hp", { rules: next }, "user");
      onSaved(next, rule);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const L = ({ t, children }: { t: string; children: React.ReactNode }) => (
    <label style={{ fontSize: 12.5, display: "block" }}>
      <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>{t}</div>
      {children}
    </label>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid",
                  placeItems: "center", zIndex: 5000 }}
         onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10,
                    width: 560, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto", padding: 18,
                    display: "flex", flexDirection: "column", gap: 11 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800 }}>현재 화면을 행잉 프로토콜로 저장</div>

        {/* 지금 화면에서 읽어낸 구성 — 무엇이 저장되는지 먼저 보여준다 */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px",
                      background: "var(--bg-canvas)", fontSize: 11.5, lineHeight: 1.8 }}>
          <b style={{ fontSize: 12 }}>저장되는 화면 구성</b>
          <div>· 분할 — Series {capture.s.r}×{capture.s.c} · Image {capture.i.r}×{capture.i.c}</div>
          <div>· W/L — {capture.wl ? capture.wl : "서버 기본"}</div>
          <div>· 연동 — {["crosslink", "auto_sync", "sync_other", "scout", "all_lines"]
            .filter((k) => capture.xlink?.[k]).join(", ") || "없음"}</div>
          <div>· 칸별 영상 — {Array.from({ length: n }, (_, k) => slotLabel(capture.sources?.[k] ?? "current"))
            .map((v, k) => `${k + 1}:${v}`).join(" · ")}</div>
        </div>

        <L t="프로토콜명 *">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                 placeholder="예: CHEST 비교 2분할" style={{ width: "100%" }} />
        </L>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <L t="장비">
              <input list="sv-hpsave-mods" value={modality}
                     onChange={(e) => setModality(e.target.value.toUpperCase().trim())}
                     placeholder="빈칸=모든 장비" style={{ width: "100%" }} />
              <datalist id="sv-hpsave-mods">{HP_MODALITIES.map((m) => <option key={m} value={m} />)}</datalist>
            </L>
          </div>
          <div style={{ flex: 1 }}>
            <L t="부위">
              <input value={bodyPart} onChange={(e) => setBodyPart(e.target.value.toUpperCase())}
                     placeholder="예: CHEST (빈칸=무관)" style={{ width: "100%" }} />
            </L>
          </div>
          <div style={{ width: 120 }}>
            <L t="Projection">
              <input value={projection} onChange={(e) => setProjection(e.target.value.toUpperCase())}
                     placeholder="PA/AP…" style={{ width: "100%" }} />
            </L>
          </div>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px",
                      background: "var(--bg-canvas)" }}>
          <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 5 }}>
            부위를 찾을 DICOM 필드
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
            {HP_BP_SOURCES.map((f) => (
              <label key={f.key} title={`(${f.tag})`}
                     style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, cursor: "pointer" }}>
                <input type="checkbox" checked={sources.includes(f.key)}
                       onChange={(e) => setSources((s) => e.target.checked
                         ? [...s, f.key] : s.filter((k) => k !== f.key))} />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <L t="설명">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
                    placeholder="이 프로토콜을 언제 쓰는지" style={{ width: "100%", resize: "vertical" }} />
        </L>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}
                 title="켜면 검사를 열 때 자동 적용합니다. 꺼두면(기본) 뷰어 공통 Layout 이 적용되고, 이 규칙은 HP 메뉴에서 직접 고를 때만 걸립니다.">
            <input type="checkbox" checked={onOpen} onChange={(e) => setOnOpen(e.target.checked)} />
            Exam 열 때 HP 사용
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}
                 title="다른 규칙보다 먼저 감지해 적용합니다(기본 꺼짐)">
            <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
            가장 우선 적용
          </label>
        </div>

        {err && <div style={{ fontSize: 12, color: "var(--stat-emergency)" }}>{err}</div>}
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          저장하면 설정 ▸ 행잉(HP) 목록 아래에 이어서 나타나며, 뷰어 HP 메뉴에서도 바로 고를 수 있습니다.
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy}>취소</button>
          <button className="primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
