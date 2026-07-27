/**
 * 영상 오버레이 필드 배치 — 모달리티별로 "어떤 DICOM/환자 정보를 상자의 어느 귀퉁이에 띄울지" 정의.
 *
 * 설정: 설정 ▸ 뷰어 공통 ▸ 영상 정보 표시(오버레이). 저장 위치는 `viewer.prefs.overlay_fields`.
 * 표시: 뷰어가 페인(시리즈 상자)과 타일(Image Layout 칸) 각각의 4귀퉁이를 이 정의대로 그린다.
 *
 * scope 의미
 *  · series — 페인(시리즈) 상자의 귀퉁이. 페인당 한 번 그린다.
 *  · image  — Image Layout 으로 나뉜 각 칸의 귀퉁이. 칸마다 그린다(이미지별로 달라지는 값).
 * 분할이 1×1 이면 두 상자는 같은 영역이므로, 그때는 series 만 그려 중복을 피한다.
 */

export type OvCorner = "tl" | "tr" | "bl" | "br" | "off";
export type OvScope = "series" | "image";
export interface OvPlace { c: OvCorner; s: OvScope }
/** 모달리티(또는 "*" = 공통) → 필드키 → 배치 */
export type OverlayCfg = Record<string, Record<string, OvPlace>>;

export const OV_CORNERS: { k: OvCorner; label: string; icon: string }[] = [
  { k: "tl", label: "좌상", icon: "◤" },
  { k: "tr", label: "우상", icon: "◥" },
  { k: "bl", label: "좌하", icon: "◣" },
  { k: "br", label: "우하", icon: "◢" },
  { k: "off", label: "숨김", icon: "✕" },
];

/** 오버레이에 올릴 수 있는 값 — 실제로 데이터가 있는 것만 노출한다(없는 태그는 넣지 않음) */
export interface OvFieldDef {
  key: string;
  label: string;
  /** 이미지마다 달라지는 값인가 — Image Layout 칸별로 그리는 게 자연스러운 것들 */
  perImage?: boolean;
  hint?: string;
}
export const OV_FIELDS: OvFieldDef[] = [
  // 환자
  { key: "patient_name", label: "환자명" },
  { key: "patient_key", label: "환자 ID" },
  { key: "sex", label: "성별" },
  { key: "birth_date", label: "생년월일" },
  // 검사
  { key: "study_desc", label: "검사명" },
  { key: "study_date", label: "검사일" },
  { key: "study_time", label: "검사시각" },
  { key: "modality", label: "모달리티" },
  { key: "body_part", label: "검사부위" },
  { key: "accession_no", label: "Accession No" },
  { key: "institution", label: "검사기관" },
  { key: "department", label: "부서" },
  { key: "referring_physician", label: "의뢰의" },
  // 시리즈
  { key: "series", label: "시리즈 (번호·설명)" },
  // 이미지
  { key: "image_no", label: "이미지 번호 (n/총)", perImage: true },
  { key: "slice_loc", label: "슬라이스 위치 (SL)", perImage: true, hint: "DICOM 위치를 슬라이스 법선에 투영한 값" },
  { key: "matrix", label: "매트릭스 (가로×세로)", perImage: true },
  { key: "pixel_spacing", label: "픽셀 간격 (mm)", perImage: true },
  // 표시 상태
  { key: "wl", label: "W/L (윈도우)" },
  { key: "zoom", label: "배율" },
  { key: "fx", label: "필터" },
];
export const OV_FIELD_LABEL: Record<string, string> = Object.fromEntries(OV_FIELDS.map((f) => [f.key, f.label]));

/** 기본 배치 — 지금까지 뷰어가 그리던 모습 그대로(설정을 만지지 않으면 화면이 바뀌지 않는다) */
export const DEFAULT_OVERLAY: Record<string, OvPlace> = {
  patient_name: { c: "tl", s: "series" },
  sex: { c: "tl", s: "series" },
  study_desc: { c: "tl", s: "series" },
  study_date: { c: "tl", s: "series" },
  series: { c: "tr", s: "series" },
  image_no: { c: "tr", s: "image" },
  slice_loc: { c: "tr", s: "image" },
  modality: { c: "bl", s: "series" },
  patient_key: { c: "bl", s: "series" },
  zoom: { c: "br", s: "series" },
  wl: { c: "br", s: "series" },
  fx: { c: "br", s: "series" },
  // 나머지는 기본 숨김
  birth_date: { c: "off", s: "series" },
  study_time: { c: "off", s: "series" },
  body_part: { c: "off", s: "series" },
  accession_no: { c: "off", s: "series" },
  institution: { c: "off", s: "series" },
  department: { c: "off", s: "series" },
  referring_physician: { c: "off", s: "series" },
  matrix: { c: "off", s: "image" },
  pixel_spacing: { c: "off", s: "image" },
};

/** 설정에서 다룰 모달리티 목록 — "*" 은 공통(모달리티별 설정이 없을 때 쓰인다) */
export const OV_MODALITIES = ["*", "CR", "DR", "MG", "US", "CT", "MR", "XA", "NM", "PT"];
export const ovModalityLabel = (m: string) => (m === "*" ? "공통" : m);

const isCorner = (v: unknown): v is OvCorner =>
  v === "tl" || v === "tr" || v === "bl" || v === "br" || v === "off";

/** 저장값 정규화 — 모르는 키·값은 버리고 빠진 필드는 기본값으로 채운다 */
export function normOverlayCfg(v: unknown): OverlayCfg {
  const src = (v ?? {}) as Record<string, unknown>;
  const out: OverlayCfg = {};
  for (const m of OV_MODALITIES) {
    const raw = (src[m] ?? {}) as Record<string, unknown>;
    const one: Record<string, OvPlace> = {};
    for (const f of OV_FIELDS) {
      const d = DEFAULT_OVERLAY[f.key] ?? { c: "off" as OvCorner, s: "series" as OvScope };
      const r = raw[f.key] as { c?: unknown; s?: unknown } | undefined;
      one[f.key] = {
        c: isCorner(r?.c) ? r.c : d.c,
        s: r?.s === "image" || r?.s === "series" ? r.s : d.s,
      };
    }
    out[m] = one;
  }
  return out;
}

/** 이 모달리티에 적용할 배치 — 모달리티별 설정이 공통과 다르면 그것을, 없으면 공통을 쓴다 */
export function overlayFor(cfg: OverlayCfg | undefined, modality: string): Record<string, OvPlace> {
  const c = cfg ?? {};
  return c[(modality || "").toUpperCase()] ?? c["*"] ?? DEFAULT_OVERLAY;
}

/** 한 귀퉁이에 들어갈 필드들 — OV_FIELDS 순서를 유지해 배치가 뒤섞이지 않게 한다 */
export function fieldsAt(place: Record<string, OvPlace>, corner: OvCorner, scope: OvScope): string[] {
  return OV_FIELDS
    .filter((f) => place[f.key]?.c === corner && place[f.key]?.s === scope)
    .map((f) => f.key);
}

/** 오버레이 값 계산에 필요한 최소 정보 — 뷰어 타입에 의존하지 않도록 느슨하게 받는다 */
export interface OvValueCtx {
  meta: Record<string, unknown>;                 // 검사(StudyDetail/메타)
  series: { series_number?: number; series_desc?: string; modality?: string };
  inst?: { rows?: number; cols?: number; pixel_spacing?: number[]; position?: number[]; orientation?: number[] } | null;
  index: number;                                 // 0-based
  total: number;
  tiles?: number;                                // Image Layout 칸 수(시리즈 범위에서 범위 표기용)
  zoom: number;
  wl: string;
  fx: string;
}

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** 슬라이스 위치 — DICOM 위치를 슬라이스 법선에 투영(코너 Z 가 아니라). 기하 없으면 빈 문자열 */
function sliceLoc(inst: OvValueCtx["inst"]): string {
  const p = inst?.position, o = inst?.orientation;
  if (!p || p.length !== 3 || !o || o.length !== 6) return "";
  const n = [o[1] * o[5] - o[2] * o[4], o[2] * o[3] - o[0] * o[5], o[0] * o[4] - o[1] * o[3]];
  const nn = Math.hypot(n[0], n[1], n[2]) || 1;
  const v = (p[0] * n[0] + p[1] * n[1] + p[2] * n[2]) / nn;
  return `SL: ${(Math.abs(v) < 0.05 ? 0 : v).toFixed(1)}`;
}

/** 필드 하나의 표시 문자열 — 값이 없으면 빈 문자열(줄을 그리지 않는다) */
export function ovFieldValue(key: string, c: OvValueCtx): string {
  const m = c.meta;
  switch (key) {
    case "patient_name": return s(m.patient_name) + (s(m.sex) ? ` (${s(m.sex)})` : "");
    case "patient_key": return s(m.patient_key);
    case "sex": return s(m.sex);
    case "birth_date": return s(m.birth_date);
    case "study_desc": return s(m.study_desc);
    case "study_date": return s(m.study_date);
    case "study_time": return s(m.study_time);
    case "modality": return s(m.modality);
    case "body_part": return s(m.body_part);
    case "accession_no": return s(m.accession_no) && `Acc: ${s(m.accession_no)}`;
    case "institution": return s(m.institution);
    case "department": return s(m.department);
    case "referring_physician": return s(m.referring_physician);
    case "series": {
      const n = c.series.series_number;
      return `${n !== undefined ? `S${n} ` : ""}${c.series.series_desc || c.series.modality || ""}`.trim();
    }
    case "image_no": {
      const from = c.index + 1;
      const to = c.tiles && c.tiles > 1 ? Math.min(c.index + c.tiles, c.total) : 0;
      return `Img: ${from}${to && to !== from ? `~${to}` : ""}/${c.total}`;
    }
    case "slice_loc": return sliceLoc(c.inst);
    case "matrix": return c.inst?.cols && c.inst?.rows ? `${c.inst.cols}×${c.inst.rows}` : "";
    case "pixel_spacing": {
      const ps = c.inst?.pixel_spacing;
      return ps && ps.length >= 2 ? `${ps[0].toFixed(3)}×${ps[1].toFixed(3)}mm` : "";
    }
    case "wl": return c.wl ? `W/L: ${c.wl}` : "";
    case "zoom": return `Z: ${(c.zoom * 100).toFixed(0)}%`;
    case "fx": return c.fx || "";
    default: return "";
  }
}
