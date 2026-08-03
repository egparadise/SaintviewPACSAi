// 판독 화면 상단 환자 정보 띠 — "지금 판독하는 검사가 누구의 것인지"를 한 줄로 고정 표시.
//
// 왜 필요한가: 판독 창·판독 도크는 ◀▶ 로 환자를 옮겨 다니고 Exam 탭으로도 바뀐다.
// 상단에 환자가 안 보이면 **다른 환자의 판독문을 쓰는 사고**가 난다(임상 위험).
// 그래서 이름·성별/나이·ID·검사일시·모달리티/부위/검사명을 항상 같은 자리에 둔다.
import { t as tr } from "../lib/i18n";

/** 이 띠가 필요로 하는 최소 정보 — StudyDetail/StudyRow 를 그대로 넘기면 된다 */
export interface PatientBarStudy {
  patient_name?: string;
  patient_key?: string;
  sex?: string;
  birth_date?: string;
  study_date?: string;
  study_time?: string;
  modality?: string;
  body_part?: string;
  study_desc?: string;
}

/** YYYYMMDD → 검사일 기준 만 나이. 형식이 아니면 빈 문자열(추정하지 않는다) */
function ageAt(birth?: string, studyDate?: string): string {
  if (!/^\d{8}$/.test(birth ?? "")) return "";
  const b = birth as string;
  const base = /^\d{8}$/.test(studyDate ?? "")
    ? (studyDate as string)
    : (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; })();
  let a = Number(base.slice(0, 4)) - Number(b.slice(0, 4));
  if (base.slice(4, 8) < b.slice(4, 8)) a -= 1;      // 생일 전이면 한 살 빼기
  return a >= 0 && a < 150 ? `${String(a).padStart(3, "0")}Y` : "";
}

/** YYYYMMDD + HHMMSS → "2026-08-01 08:13:50" (시각이 없으면 날짜만) */
function whenText(date?: string, time?: string): string {
  if (!/^\d{8}$/.test(date ?? "")) return date ?? "";
  const d = date as string;
  const ymd = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const t = (time ?? "").replace(/\D/g, "");
  if (t.length < 4) return ymd;
  const hms = `${t.slice(0, 2)}:${t.slice(2, 4)}${t.length >= 6 ? `:${t.slice(4, 6)}` : ""}`;
  return `${ymd} ${hms}`;
}

export function PatientBar({ study, compact = false }: {
  study: PatientBarStudy | null | undefined;
  /** 판독 도크처럼 폭이 좁은 곳 — 글자를 줄이고 줄바꿈을 허용한다 */
  compact?: boolean;
}) {
  if (!study) {
    return (
      <div style={{ padding: compact ? "4px 8px" : "6px 12px", fontSize: 12,
                    color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
        {tr("검사를 선택하세요")}
      </div>
    );
  }
  const age = ageAt(study.birth_date, study.study_date);
  // "F/077Y" — 성별과 나이. 둘 중 하나만 있으면 있는 것만 표시한다
  const sexAge = [study.sex, age].filter(Boolean).join("/");
  const when = whenText(study.study_date, study.study_time);
  // "CR / CHEST / [검진]흉부방사선 촬영" — 빈 항목은 구분자까지 함께 빠진다
  const exam = [study.modality, study.body_part, study.study_desc].filter(Boolean).join(" / ");

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: compact ? 6 : 10,
      flexWrap: compact ? "wrap" : "nowrap",
      padding: compact ? "4px 8px" : "6px 12px",
      borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)",
      fontSize: compact ? 11.5 : 13, minWidth: 0,
    }}>
      <b style={{ fontSize: compact ? 12.5 : 15, whiteSpace: "nowrap" }}>
        {study.patient_name || tr("(이름 없음)")}
        {sexAge && <span style={{ marginLeft: 4 }}>({sexAge})</span>}
      </b>
      {study.patient_key && (
        <span style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          ID: <b style={{ color: "var(--text-primary)" }}>{study.patient_key}</b>
        </span>
      )}
      {when && <span style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{when}</span>}
      {exam && (
        <b title={exam} style={{
          minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: compact ? "normal" : "nowrap",
        }}>
          {exam}
        </b>
      )}
    </div>
  );
}
