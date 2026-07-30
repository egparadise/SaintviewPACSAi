/**
 * 영상 전송 형식·경로 상수 — **Cornerstone(3D) 과 완전히 분리된 경량 모듈**.
 *
 * ⚠ 왜 별도 파일인가: 2D 뷰어(Viewer2D·ViewerInfi)는 이 안의 상수·헬퍼 세 개
 *   (DICOMWEB_ROOT / renderedParams / setImageFormat)만 필요한데, 이것들이
 *   `lib/cornerstone.ts` 에 있으면 그 파일의 정적 import 때문에
 *   **Cornerstone3D + vtk.js(3MB 이상)가 2D 뷰어 청크에 그대로 딸려온다.**
 *   2D 경로는 그 코드를 한 줄도 실행하지 않는데 다운로드·파싱 비용을 전부 낸다.
 *
 * ⚠ 이 파일은 `lib/cornerstone.ts` 를 import 하면 안 된다(역방향만 허용).
 * ⚠ `lib/cornerstone.ts` 에서 이 모듈을 **re-export 하지 말 것** — 번들러가 두 모듈을
 *   한 청크로 합쳐 분리 효과가 사라진다. 소비자는 이 파일에서 직접 import 한다.
 */

/** DICOMweb 루트 — 빈값/미설정이면 상대경로(vite·nginx 의 /dicom-web 프록시 경유) */
export const DICOMWEB_ROOT: string =
  import.meta.env.VITE_DICOMWEB_ROOT ?? "/dicom-web";

/** HTJ2K 전송구문 — Orthanc 미지원이라 백엔드 스트리밍 프록시(/api/htj2k)로 프레임을 받는다 */
const HTJ2K_UIDS = ["1.2.840.10008.1.2.4.201", "1.2.840.10008.1.2.4.202", "1.2.840.10008.1.2.4.203"];

// ── 병원별 클라이언트 영상 전송 형식(관리자 설정) — rendered 호출에 accept/quality 파라미터 부여 ──
// default=서버 기본(JPEG) / png=무손실 표시 / jpeg=품질 지정(저대역 원격 최적화)
let IMG_FMT: { format: string; quality: number; wado_ts?: string } =
  { format: "default", quality: 90, wado_ts: "" };

export function setImageFormat(f: { format?: string; quality?: number; wado_ts?: string }): void {
  IMG_FMT = { format: f.format ?? "default", quality: f.quality ?? 90, wado_ts: f.wado_ts ?? "" };
}

/** 원본 픽셀 전송(3D·정밀) 전송구문 — ""=원본 그대로 */
export function getWadoTs(): string { return IMG_FMT.wado_ts ?? ""; }

/** rendered URL 뒤에 붙일 형식 파라미터 — hasQuery: 이미 ?window= 등이 있는지 */
export function renderedParams(hasQuery: boolean): string {
  const sep = hasQuery ? "&" : "?";
  if (IMG_FMT.format === "png") return sep + "accept=image/png";
  if (IMG_FMT.format === "jpeg") return sep + "accept=image/jpeg&quality=" + IMG_FMT.quality;
  return "";
}

export function isHtj2kTs(): boolean { return HTJ2K_UIDS.includes(IMG_FMT.wado_ts ?? ""); }

/** 프레임 요청 베이스 — HTJ2K 설정 시 백엔드 프록시, 그 외 Orthanc DICOMweb */
export function framesBase(): string { return isHtj2kTs() ? "/api/htj2k" : DICOMWEB_ROOT; }

export function authHeader(): Record<string, string> {
  const t = localStorage.getItem("sv_token") ?? sessionStorage.getItem("sv_token");
  return t ? { Authorization: "Bearer " + t } : {};
}
