// Import DICOM Files — USB/CD 등에서 .dcm 파일을 골라 Orthanc(자체 저장소)+로컬 DB 에 등록.
// 원본 PiViewSTAR 'Import DICOM Files' 다이얼로그 대응 (폴더 선택·확장자 필터·결과표).
import { useRef, useState } from "react";
import { api } from "../api";

type Row = { filename: string; size: number; status: string };

export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const allRef = useRef<File[]>([]);   // 마지막 선택 전체 — 필터 토글 시 재스캔용
  const [picked, setPicked] = useState<File[]>([]);
  const [source, setSource] = useState("");
  const [dcmOnly, setDcmOnly] = useState(false);   // 기본: 전체 파일에서 DICOM 자동 감지
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);   // 업로드 완료 — Start→완료 표시
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState("Total 0 files processed, 0 DICOM files imported");

  // DICOM 판별 — 확장자 무관: 프리앰블 128바이트 뒤 'DICM' 시그니처(Part 10),
  // 시그니처 없는 구형 raw 파일은 그룹 0008 리틀엔디언 시작으로 감지 (PA000000/IM000000 류 CD 대응)
  const sniffDicom = async (f: File): Promise<boolean> => {
    if (/\.dcm$/i.test(f.name)) return true;
    if (/\.(jpe?g|png|bmp)$/i.test(f.name)) return true;   // 일반 이미지 — 서버가 DICOM SC 로 변환 등록
    if (f.name.toUpperCase() === "DICOMDIR") return false;   // 디렉토리 레코드는 제외
    if (f.size < 132) return false;
    try {
      const magic = new Uint8Array(await f.slice(128, 132).arrayBuffer());
      if (String.fromCharCode(...magic) === "DICM") return true;
      const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
      return head[0] === 0x08 && head[1] === 0x00;
    } catch { return false; }
  };

  const scan = async (all: File[], only = dcmOnly) => {
    setBusy(true);
    setDone(false);
    setRows([]);
    try {
      const files: File[] = [];
      if (only) {
        files.push(...all.filter((f) => /\.dcm$/i.test(f.name)));
      } else {
        let done = 0;
        for (const f of all) {
          if (await sniffDicom(f)) files.push(f);
          done += 1;
          if (done % 50 === 0) setSummary(`스캔 중… ${done}/${all.length}`);
        }
      }
      setPicked(files);
      setSummary(`${files.length} DICOM files ready (${all.length} scanned)`);
    } finally { setBusy(false); }
  };

  const onFiles = (list: FileList | null, dir: boolean) => {
    if (!list) return;
    const all = Array.from(list);
    allRef.current = all;
    const rel = (all[0] as File & { webkitRelativePath?: string })?.webkitRelativePath;
    setSource(dir && rel ? `${rel.split("/")[0]}/ … (${all.length}개 파일)` : `${all.length}개 선택`);
    void scan(all);
  };

  const start = async () => {
    if (!picked.length) { alert("DICOM 파일 또는 폴더를 먼저 선택하세요"); return; }
    setBusy(true);
    setRows([]);
    try {
      // 대용량 대응: 50개 배치로 나눠 업로드 — 진행률·결과 누적 표시
      const BATCH = 50;
      let processed = 0, uploaded = 0, registered = 0, savedDir = "";
      const acc: Row[] = [];
      for (let i = 0; i < picked.length; i += BATCH) {
        setSummary(`업로드 중… ${Math.min(i + BATCH, picked.length)}/${picked.length}`);
        const r = await api.importDicom(picked.slice(i, i + BATCH));
        processed += r.processed; uploaded += r.uploaded; registered += r.registered;
        savedDir = r.saved_dir ?? savedDir;
        acc.push(...r.results);
        setRows([...acc]);
      }
      setSummary(`Total ${processed} files processed, ${uploaded} DICOM files imported` +
                 ` — 검사 ${registered}건 Local DB 등록` +
                 (savedDir ? ` · 이미지 폴더: ${savedDir}` : ""));
      setDone(true);
      onDone();   // 워크리스트 즉시 갱신 — 환자·영상 표시
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
                   onChange={(e) => {
                     setDcmOnly(e.target.checked);
                     // 선택돼 있으면 즉시 재스캔 — 기본(해제)은 하위 모든 파일에서 DICM 시그니처 자동 감지
                     if (allRef.current.length) void scan(allRef.current, e.target.checked);
                   }} />
            Extension *.dcm Files Only (기본 해제 — 폴더 이하 <b>모든 파일</b>에서 DICOM 자동 감지)
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
          <button className="primary"
                  style={{ ...B, ...(done ? { background: "#16a34a", borderColor: "#16a34a" } : {}) }}
                  disabled={busy || done || !picked.length} onClick={start}>
            {busy ? "진행 중…" : done ? "완료 ✓" : "Start"}
          </button>
          <button style={B} onClick={() => { onDone(); onClose(); }}>Close</button>
        </div>
      </div>
    </div>
  );
}
