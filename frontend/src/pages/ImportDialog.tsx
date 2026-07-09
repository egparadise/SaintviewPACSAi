// Import DICOM Files — USB/CD 등에서 .dcm 파일을 골라 Orthanc(자체 저장소)+로컬 DB 에 등록.
// 원본 PiViewSTAR 'Import DICOM Files' 다이얼로그 대응 (폴더 선택·확장자 필터·결과표).
import { useRef, useState } from "react";
import { api } from "../api";

type Row = { filename: string; size: number; status: string };

export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [source, setSource] = useState("");
  const [dcmOnly, setDcmOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState("Total 0 files processed, 0 DICOM files imported");

  // .dcm 만(확장자 없는 DICOM 도 흔하므로 옵션) 필터
  const filterDcm = (all: File[]) =>
    dcmOnly ? all.filter((f) => /\.dcm$/i.test(f.name)) : all;

  const onFiles = (list: FileList | null, dir: boolean) => {
    if (!list) return;
    const all = Array.from(list);
    const files = filterDcm(all);
    setPicked(files);
    // 첫 파일 경로로 소스 표시(디렉토리 선택 시 webkitRelativePath 존재)
    const rel = (all[0] as File & { webkitRelativePath?: string })?.webkitRelativePath;
    setSource(dir && rel ? rel.split("/")[0] + "/ …" : `${all.length}개 선택 (${files.length} DICOM)`);
    setRows([]);
    setSummary(`${files.length} DICOM files ready (${all.length} selected)`);
  };

  const start = async () => {
    if (!picked.length) { alert(".dcm 파일 또는 폴더를 먼저 선택하세요"); return; }
    setBusy(true);
    setSummary("업로드 중…");
    try {
      const r = await api.importDicom(picked);
      setRows(r.results);
      setSummary(`Total ${r.processed} files processed, ${r.uploaded} DICOM files imported` +
                 ` — 검사 ${r.registered}건 로컬 DB 등록`);
      if (r.registered) onDone();
    } catch (e) {
      setSummary(e instanceof Error ? `실패: ${e.message}` : "Import 실패");
    } finally { setBusy(false); }
  };

  const B: React.CSSProperties = { padding: "4px 14px", minWidth: 74 };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid",
                  placeItems: "center", zIndex: 300 }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
                    width: "min(680px, 96vw)", maxHeight: "92vh", overflow: "auto",
                    padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <b style={{ fontSize: 13 }}>📥 Import DICOM Files</b>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>✕</button>
        </div>

        {/* Import Parameters */}
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12 }}>
          <legend style={{ fontSize: 12, color: "var(--text-secondary)", padding: "0 6px" }}>Import Parameters</legend>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <span style={{ width: 96, fontSize: 12.5, color: "var(--text-secondary)" }}>Search Directory</span>
            <input readOnly value={source} placeholder="USB/CD 폴더 또는 파일을 선택하세요"
                   style={{ flex: 1, fontSize: 12 }} />
            <button title="폴더 선택 (USB·CD 전체)" onClick={() => dirRef.current?.click()}>📁 폴더</button>
            <button title="파일 선택 (.dcm 여러 개)" onClick={() => fileRef.current?.click()}>… 파일</button>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={dcmOnly}
                   onChange={(e) => setDcmOnly(e.target.checked)} />
            Extension *.dcm Files Only (해제 시 확장자 없는 DICOM 도 포함)
          </label>
          {/* 숨은 파일 입력 — 폴더(webkitdirectory)·다중 파일 */}
          <input ref={dirRef} type="file" multiple hidden
                 // @ts-expect-error webkitdirectory 는 표준 타입에 없음
                 webkitdirectory="" directory=""
                 onChange={(e) => onFiles(e.target.files, true)} />
          <input ref={fileRef} type="file" multiple accept=".dcm,application/dicom" hidden
                 onChange={(e) => onFiles(e.target.files, false)} />
        </fieldset>

        {/* Import Result */}
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 8, minHeight: 180 }}>
          <legend style={{ fontSize: 12, color: "var(--text-secondary)", padding: "0 6px" }}>Import Result</legend>
          <div style={{ maxHeight: 240, overflow: "auto" }}>
            <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-secondary)", textAlign: "left" }}>
                  <th style={{ padding: "2px 6px" }}>Filename</th>
                  <th style={{ padding: "2px 6px", width: 80 }}>Size</th>
                  <th style={{ padding: "2px 6px", width: 90 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: 10, color: "var(--text-secondary)" }}>
                    {busy ? "처리 중…" : "선택 후 Start 를 누르세요"}</td></tr>
                )}
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "2px 6px", wordBreak: "break-all" }}>{r.filename}</td>
                    <td style={{ padding: "2px 6px" }}>{(r.size / 1024).toFixed(0)} KB</td>
                    <td style={{ padding: "2px 6px",
                                 color: r.status.startsWith("실패") ? "var(--stat-emergency)"
                                      : r.status === "중복" ? "#eab308" : "#4ade80" }}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 6, textAlign: "center", fontSize: 12, color: "var(--text-secondary)" }}>
            {summary}
          </div>
        </fieldset>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="primary" style={B} disabled={busy || !picked.length} onClick={start}>Start</button>
          <button style={B} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
