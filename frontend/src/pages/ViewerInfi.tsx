// Infi Viewer — INFINITT PiViewSTAR 스타일 Client 뷰어 (개발 중 스캐폴드).
// Viewer2D(TY Viewer)와 동일한 props 계약을 지켜 ViewerWindow 컴포넌트 맵에서 교체 가능하다.
// 설정>뷰어>선택 뷰어에서 available=true 로 전환하면 사용자에게 노출된다(lib/viewerConfig.ts).
import type { StudyDetail } from "../api";

export function ViewerInfi({ detail, onClose }: {
  detail: StudyDetail;
  onClose: () => void;
  addDetail?: StudyDetail | null;
  stackDetail?: StudyDetail | null;
  keySops?: string[] | null;
  withOpen?: { mode: "add" | "stack"; ids: number[] } | null;
}) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", gap: 10, color: "var(--text-secondary)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, marginBottom: 6 }}>Infi Viewer — 개발 중</div>
        <div style={{ fontSize: 12.5 }}>
          {detail.modality} · {detail.patient_name} · {detail.study_date}
        </div>
        <div style={{ fontSize: 12, marginTop: 10 }}>
          설정 &gt; 뷰어 &gt; 선택 뷰어에서 TY Viewer 를 사용하세요.
        </div>
        <button style={{ marginTop: 12 }} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
