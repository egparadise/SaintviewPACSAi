// 검사 DICOM 내보내기 — CD 굽기 / USB·폴더 저장 / 파일(ZIP) 저장
//
// ⚠ 브라우저는 CD 를 직접 구울 수 없다(굽기 장치 API 자체가 없음).
//    그래서 'CD 굽기' 는 서버가 DICOMDIR 를 담은 **ISO 이미지**를 만들어 주고,
//    실제 굽기는 Windows 탐색기의 "디스크 이미지 굽기" 로 사용자가 마무리한다.
// USB·폴더 저장은 File System Access API(showDirectoryPicker) 로 사용자가 고른 폴더에
//    DICOMDIR 구조 그대로 풀어 쓴다 — 다른 PACS 에서도 바로 읽힌다.
import { useState } from "react";
import { api } from "../api";

export interface ExportTarget { id: number; label: string }

type Mode = "folder" | "file" | "cd";

/** 이 브라우저가 폴더 선택(File System Access)을 지원하는가 — Chrome/Edge + HTTPS */
const canPickDir = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

interface DirHandle {
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(d: BufferSource): Promise<void>; close(): Promise<void> }>;
  }>;
}

export function ExportDialog({ targets, onClose, onStatus }: {
  targets: ExportTarget[];
  onClose: () => void;
  onStatus?: (msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("folder");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const run = async () => {
    setErr(""); setDone("");
    const ids = targets.map((t) => t.id);
    try {
      if (mode === "cd") {
        setBusy("CD 굽기용 ISO 이미지를 만드는 중… (검사가 많으면 몇 분 걸립니다)");
        const blob = await api.exportStudies(ids, "iso");
        save(blob, `saintview_${new Date().toISOString().slice(0, 10)}.iso`);
        setDone("ISO 파일을 내려받았습니다. 탐색기에서 그 파일을 우클릭 → [디스크 이미지 굽기] 로 CD/DVD 에 구우세요.");
        return;
      }
      setBusy("DICOM 미디어(DICOMDIR)를 만드는 중…");
      const blob = await api.exportStudies(ids, "zip");
      if (mode === "file") {
        save(blob, `saintview_${new Date().toISOString().slice(0, 10)}.zip`);
        setDone("ZIP 파일을 내려받았습니다. 압축을 풀면 DICOMDIR 구조 그대로 사용할 수 있습니다.");
        return;
      }
      // 폴더/USB — 사용자가 고른 폴더에 DICOMDIR 구조 그대로 풀어 쓴다
      setBusy("저장할 폴더(USB 드라이브 등)를 선택하세요…");
      const pick = (window as unknown as { showDirectoryPicker: (o?: object) => Promise<DirHandle> }).showDirectoryPicker;
      const root = await pick({ mode: "readwrite", startIn: "desktop" });
      setBusy("압축을 푸는 중…");
      const { unzipSync } = await import("fflate");
      const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      const names = Object.keys(files).filter((n) => !n.endsWith("/"));
      let n = 0;
      for (const name of names) {
        const parts = name.replace(/\\/g, "/").split("/").filter(Boolean);
        let dir = root;
        for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true });
        const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await fh.createWritable();
        await w.write(files[name]);
        await w.close();
        n++;
        if (n % 20 === 0 || n === names.length) setBusy(`저장 중… ${n}/${names.length}`);
      }
      setDone(`선택한 폴더에 ${n}개 파일을 저장했습니다(DICOMDIR 포함).`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/abort/i.test(m)) { setBusy(""); return; }   // 사용자가 폴더 선택을 취소
      setErr(m);
      onStatus?.(`내보내기 실패 — ${m}`);
    } finally {
      setBusy("");
    }
  };

  const Opt = ({ v, title, desc, disabled }: { v: Mode; title: string; desc: string; disabled?: boolean }) => (
    <label style={{
      display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 11px", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer",
      border: `1px solid ${mode === v ? "var(--accent)" : "var(--border)"}`,
      background: mode === v ? "var(--accent-subtle)" : "transparent", opacity: disabled ? 0.5 : 1,
    }}>
      <input type="radio" name="sv-export" checked={mode === v} disabled={disabled}
             onChange={() => setMode(v)} style={{ marginTop: 3 }} />
      <span>
        <b style={{ fontSize: 13 }}>{title}</b>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.6, marginTop: 2 }}>{desc}</div>
      </span>
    </label>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 4000 }}
         onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10,
                    width: 520, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto", padding: 20,
                    display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>영상 내보내기 (DICOM)</div>

        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          선택한 검사 <b style={{ color: "var(--text-primary)" }}>{targets.length}건</b>의 DICOM 영상을 내보냅니다.
          {targets.length > 1 && " (Shift/Ctrl 다중선택)"}
        </div>
        <div style={{ maxHeight: 108, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6,
                      padding: "6px 9px", fontSize: 11.5, lineHeight: 1.75 }}>
          {targets.map((t) => <div key={t.id}>· {t.label}</div>)}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <Opt v="folder" disabled={!canPickDir}
               title="USB·폴더에 저장"
               desc={canPickDir
                 ? "저장할 폴더(USB 드라이브 등)를 고르면 DICOMDIR 구조 그대로 풀어서 씁니다. 다른 PACS 에서도 바로 읽힙니다."
                 : "이 브라우저는 폴더 선택을 지원하지 않습니다(Chrome·Edge + HTTPS 필요). 아래 '파일로 저장'을 이용하세요."} />
          <Opt v="file" title="파일로 저장 (ZIP)"
               desc="DICOMDIR 를 포함한 ZIP 한 개로 내려받습니다. 저장 위치는 브라우저 다운로드 창에서 고릅니다." />
          <Opt v="cd" title="CD/DVD 굽기 (ISO 이미지)"
               desc="굽기용 ISO 이미지를 만들어 내려받습니다. 탐색기에서 ISO 우클릭 → [디스크 이미지 굽기] 로 구우세요. (웹 브라우저는 CD 를 직접 구울 수 없습니다)" />
        </div>

        {busy && <div style={{ fontSize: 12, color: "var(--accent)" }}>⏳ {busy}</div>}
        {err && <div style={{ fontSize: 12, color: "var(--stat-emergency)" }}>{err}</div>}
        {done && <div style={{ fontSize: 12, color: "var(--stat-final, #4ade80)", lineHeight: 1.7 }}>✔ {done}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
          <button onClick={onClose} disabled={!!busy}>닫기</button>
          <button className="primary" onClick={() => void run()} disabled={!!busy || !targets.length}>
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
}
