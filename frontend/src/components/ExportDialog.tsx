// 검사 DICOM 내보내기 — CD 굽기 / USB·폴더 저장 / 파일(ZIP) 저장
//
// ⚠ 브라우저는 CD 를 직접 구울 수 없다(굽기 장치 API 자체가 없음).
//    그래서 'CD 굽기' 는 서버가 **ISO 이미지**를 만들어 주고,
//    실제 굽기는 Windows 탐색기의 "디스크 이미지 굽기" 로 사용자가 마무리한다.
// USB·폴더 저장은 File System Access API(showDirectoryPicker) 로 사용자가 고른 폴더에
//    DICOM/<환자ID>/<검사일_모달리티_UID꼬리>/S<시리즈>/<일련번호>.dcm 구조로 쓴다.
//
// ⚠ 왜 ZIP 을 받아 브라우저에서 풀지 않는가 (예전 구현이 그랬다)
//    ① 서버가 ZIP 을 **메모리에서 통째로** 만들어야 했고, 그 과정에서 버퍼를 되감는 바람에
//       중앙 디렉터리 오프셋이 어긋나 **4MB 를 넘는 반출이 전부 깨져 있었다**
//       (BadZipFile: Bad magic number — 실제 DICOM 반출은 사실상 전부 여기 해당).
//    ② 브라우저도 ZIP 전체 + 압축 해제본을 동시에 들고 있어야 해 큰 검사에서 탭이 죽었다.
//    ③ 진행률을 보여 줄 수 없었다(다 받을 때까지 아무 표시가 없다).
//    지금은 manifest 로 목록을 받아 **한 장씩** 받아 쓴다 — 메모리는 한 장 크기로 고정되고,
//    한 장이 실패해도 나머지는 계속 간다.
import { useEffect, useState } from "react";
import { api } from "../api";

export interface ExportTarget { id: number; label: string }

type Mode = "folder" | "file" | "cd";

interface ManifestFile { path: string; sop_uid: string; series_uid: string }
interface ManifestStudy {
  id: number; patient_key: string; patient_name: string; study_date: string;
  modality: string; study_desc: string; count: number; files: ManifestFile[];
}

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
  const [mode, setMode] = useState<Mode>(canPickDir ? "folder" : "file");   // 미지원 브라우저는 파일 저장으로
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [man, setMan] = useState<{ studies: ManifestStudy[]; total_files: number } | null>(null);
  const ids = targets.map((t) => t.id).join(",");

  // 목록(=영상 장수)을 먼저 받아 둔다 — 진행률 분모이자, 반출 전에 규모를 보여 주는 정보다.
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    api.exportManifest(ids)
      .then((m) => { if (alive) setMan(m); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "목록 조회 실패"); });
    return () => { alive = false; };
  }, [ids]);

  const run = async () => {
    setErr(""); setDone("");
    try {
      if (mode === "cd" || mode === "file") {
        // 서버가 스트리밍으로 만들어 내려 준다 — 브라우저 메모리에 통째로 올리지 않는다.
        // 내려받기는 Authorization 헤더를 못 붙이므로 URL 에 토큰을 실어 이동한다.
        setBusy(mode === "cd"
          ? "CD 굽기용 ISO 이미지를 만드는 중… (내려받기가 시작되면 완료입니다)"
          : "ZIP 을 만드는 중… (내려받기가 시작되면 완료입니다)");
        window.location.href = api.exportPackageUrl(ids, mode === "cd" ? "iso" : "zip");
        setDone(mode === "cd"
          ? "내려받은 ISO 를 탐색기에서 우클릭 → [디스크 이미지 굽기] 로 CD/DVD 에 구우세요."
          : "내려받은 ZIP 의 압축을 풀면 DICOM 폴더 구조 그대로 사용할 수 있습니다.");
        setBusy("");
        return;
      }
      // 폴더/USB — ⚠ 폴더 선택창은 **네트워크 대기 전에** 띄워야 한다.
      //   await 뒤에 부르면 사용자 제스처가 만료돼 브라우저가 SecurityError 로 거부한다.
      if (!canPickDir) throw new Error("이 브라우저는 폴더 선택을 지원하지 않습니다 — '파일로 저장(ZIP)'을 이용하세요");
      const pick = (window as unknown as { showDirectoryPicker: (o?: object) => Promise<DirHandle> }).showDirectoryPicker;
      const root = await pick({ mode: "readwrite", startIn: "desktop" });
      const m = man ?? await api.exportManifest(ids);
      setMan(m);
      const total = m.total_files;
      let n = 0, ok = 0, fail = 0;
      setBusy(`저장 중… 0/${total}`);
      for (const st of m.studies) {
        for (const f of st.files) {
          try {
            const parts = f.path.split("/").filter(Boolean);
            let dir = root;
            for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true });
            const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
            const w = await fh.createWritable();
            await w.write(await api.exportFile(st.id, f.sop_uid));
            await w.close();
            ok++;
          } catch {
            fail++;   // 한 장 실패가 나머지를 막지 않는다 — 끝나고 건수로 알린다
          }
          n++;
          if (n % 10 === 0 || n === total) setBusy(`저장 중… ${n}/${total}`);
        }
      }
      setDone(fail
        ? `선택한 폴더에 ${ok}장을 저장했습니다 — ${fail}장은 실패했습니다.`
        : `선택한 폴더에 ${ok}장을 저장했습니다.`);
      if (fail) onStatus?.(`내보내기 — ${fail}장 실패(${ok}장 저장)`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // 사용자가 폴더 선택을 취소 — 이름으로 판정(메시지 문구에 의존하지 않는다)
      if ((e as { name?: string })?.name === "AbortError" || /abort/i.test(m)) { setBusy(""); return; }
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
          {man && <> · 영상 <b style={{ color: "var(--text-primary)" }}>{man.total_files}장</b></>}
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
                 ? "저장할 폴더(USB 드라이브 등)를 고르면 환자·검사별 폴더로 갈라 DICOM 을 그대로 씁니다. 한 장씩 기록하므로 진행률이 보이고, 큰 검사도 메모리를 먹지 않습니다."
                 : "이 브라우저는 폴더 선택을 지원하지 않습니다(Chrome·Edge + HTTPS 필요). 아래 '파일로 저장'을 이용하세요."} />
          <Opt v="file" title="파일로 저장 (ZIP)"
               desc="ZIP 한 개로 내려받습니다. 저장 위치는 브라우저 다운로드 창에서 고릅니다." />
          <Opt v="cd" title="CD/DVD 굽기 (ISO 이미지)"
               desc="굽기용 ISO 이미지를 만들어 내려받습니다. 탐색기에서 ISO 우클릭 → [디스크 이미지 굽기] 로 구우세요. (웹 브라우저는 CD 를 직접 구울 수 없습니다)" />
        </div>

        {busy && <div style={{ fontSize: 12, color: "var(--accent)" }}>⏳ {busy}</div>}
        {err && <div style={{ fontSize: 12, color: "var(--stat-emergency)" }}>{err}</div>}
        {done && <div style={{ fontSize: 12, color: "var(--stat-final, #4ade80)", lineHeight: 1.7 }}>✔ {done}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
          <button onClick={onClose} disabled={!!busy}>닫기</button>
          <button className="primary" onClick={() => void run()}
                  disabled={!!busy || !targets.length || man?.total_files === 0}>
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
}
