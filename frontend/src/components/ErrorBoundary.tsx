// 렌더 예외 안전망 — 이게 없으면 예외 하나로 React 가 트리 전체를 언마운트해 화면이 완전히 백지가 된다
// (새로고침해야만 복구되는 증상의 원인). 여기서 잡아 원인을 보여주고 그 자리에서 복구할 수 있게 한다.
//
// 두 번째 역할: **무엇이 왜 터졌는지 새로고침 뒤에도 남긴다.**
// 사용자는 백지 화면을 보면 새로고침으로 넘어가는데, 그 순간 콘솔도 함께 날아가 원인이 영영
// 안 남는다("자꾸 죽는데 새로고침하면 됩니다"). 그래서 localStorage 링버퍼에 적어 둔다 —
// sessionStorage 의 sv_last_error 는 탭을 닫으면 사라지고 **마지막 1건**만 남아서
// 연쇄 오류의 첫 원인을 못 찾는다.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { APP_RELEASE_DATE, VERSION_LABEL } from "../lib/version";
import { describeReason } from "../lib/crashReason";

interface Props { children: ReactNode; label?: string }
interface State { err: Error | null; stack: string }

const LOG_KEY = "sv_crash_log";
const LOG_MAX = 20;
/** 같은 오류로 볼 기준 — 짧은 시간에 같은 자리·같은 메시지면 한 줄로 접는다. */
const DEDUPE_MS = 10_000;

export interface CrashEntry {
  at: string;          // ISO 시각
  where: string;       // 경계 이름(어느 화면인지)
  message: string;
  stack: string;
  componentStack: string;
  url: string;
  build: string;
  /** 같은 오류가 짧은 시간에 되풀이된 횟수. 20건이 같은 원인이면 1행 + count 로 남는다. */
  count?: number;
}

export function readCrashLog(): CrashEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    return Array.isArray(v) ? (v as CrashEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearCrashLog(): void {
  try { localStorage.removeItem(LOG_KEY); } catch { /* 저장소 접근 불가 — 무시 */ }
}

export function recordCrash(e: Partial<CrashEntry> & { message: string }): void {
  try {
    const list = readCrashLog();
    const where = e.where || "unknown";
    const message = String(e.message).slice(0, 500);
    // ⚠ 폭주 접기 — 영상 로딩 실패는 타일마다 동시에 터져 같은 줄이 20개씩 쌓였고,
    //   그 20줄이 링버퍼(LOG_MAX)를 채워 **정작 원인이 된 첫 오류를 밀어냈다.**
    const head = list[0];
    if (head && head.where === where && head.message === message
        && Date.now() - Date.parse(head.at) < DEDUPE_MS) {
      head.count = (head.count ?? 1) + 1;
      head.at = new Date().toISOString();
      localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, LOG_MAX)));
      return;
    }
    list.unshift({
      at: new Date().toISOString(),
      where,
      message,
      stack: String(e.stack || "").slice(0, 2000),
      componentStack: String(e.componentStack || "").slice(0, 2000),
      url: location.href.slice(0, 300),
      // 배포 커밋까지 남긴다 — 사용자가 보낸 로그가 **어느 빌드**에서 났는지 알아야
      // "고쳤는데 증상이 계속된다"(실은 옛 빌드가 돌고 있었다)를 구분할 수 있다.
      build: `${VERSION_LABEL} (${APP_RELEASE_DATE})`,
      count: 1,
    });
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, LOG_MAX)));
  } catch { /* 용량 초과 등 — 기록 실패가 앱을 막지는 않는다 */ }
}

/** 경계 밖(비동기·이벤트 핸들러)에서 던진 것도 남긴다 — ErrorBoundary 는 그것들을 못 잡는다.
 *  main.tsx 에서 1회 호출. 청크 로드 실패는 조용한 1회 재적재로 처리하고 기록하지 않는다. */
export function installGlobalCrashLog(): void {
  window.addEventListener("error", (ev) => {
    recordCrash({ where: "window.error", message: ev.message || "(no message)",
                  stack: ev.error?.stack || `${ev.filename}:${ev.lineno}:${ev.colno}` });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    if (isChunkLoadError(ev.reason)) return;   // main.tsx 의 청크 복구 경로가 맡는다
    // ⚠ String(reason) 을 쓰면 안 된다 — 영상 로더는 Error 가 아니라 XMLHttpRequest 를
    //   그대로 reject 하므로 로그에 `[object XMLHttpRequest]` 만 20줄 남는다(실제로 그랬다).
    const d = describeReason(ev.reason);
    recordCrash({ where: "unhandledrejection", message: d.message, stack: d.stack });
  });
}

/** 배포 교체로 옛 청크가 사라져 lazy import 가 실패한 경우인가 —
 *  빌드마다 청크 파일명(해시)이 바뀌므로, 열어 둔 탭이 그 다음 동적 import 에서 404 를 맞는다.
 *  새로고침하면 새 index.html 이 새 청크를 가리켜 정상 동작한다(= "죽었다 새로고침하면 됨"의 정체). */
export function isChunkLoadError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e ?? "");
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|error loading dynamically imported/i.test(m);
}

/** 무한 새로고침 방지 — 10초 안에 두 번은 다시 로드하지 않는다 */
export function reloadOnceForChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem("sv_chunk_reload") ?? 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem("sv_chunk_reload", String(Date.now()));
  } catch { /* 저장 불가여도 1회는 시도 */ }
  location.reload();
  return true;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null, stack: "" };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // 새 버전 배포로 옛 청크가 사라진 경우 — 사용자에게 스택을 보여줄 게 아니라 조용히 1회 재적재
    if (isChunkLoadError(err) && reloadOnceForChunk()) return;
    this.setState({ stack: info.componentStack ?? "" });
    // 콘솔에 남겨 원인 추적이 가능하게 (F12 > Console)
    console.error(`[Saintview] ${this.props.label ?? "화면"} 렌더 오류:`, err, info.componentStack);
    // ★ 새로고침해도 남는 기록(설정 > 정보에서 확인·복사) — 백지 화면의 원인 추적 본체
    recordCrash({ where: this.props.label ?? "화면", message: err.message,
                  stack: err.stack, componentStack: info.componentStack ?? "" });
    // 마지막 오류는 기존대로 세션에도 남긴다(옛 도구·스크립트 호환)
    try {
      sessionStorage.setItem("sv_last_error", JSON.stringify({
        label: this.props.label ?? "", msg: String(err?.message ?? err),
        stack: String(err?.stack ?? "").slice(0, 4000),
        component: (info.componentStack ?? "").slice(0, 4000),
        at: new Date().toISOString(), url: location.href,
      }));
    } catch { /* 저장 실패는 무시 */ }
  }

  render() {
    const { err, stack } = this.state;
    if (!err) return this.props.children;
    return (
      <div style={{ position: "fixed", inset: 0, overflow: "auto", padding: 24, zIndex: 99999,
                    background: "var(--bg-canvas, #0b1220)", color: "var(--text-primary, #e2e8f0)",
                    fontSize: 13, lineHeight: 1.7 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>화면을 그리는 중 오류가 발생했습니다</h2>
        <div style={{ color: "var(--text-secondary, #94a3b8)", marginBottom: 14 }}>
          {this.props.label ? `${this.props.label} — ` : ""}아래 [다시 시도]를 누르면 이 화면만 다시 그립니다.
          계속 반복되면 [새로고침]을 눌러 주세요. 아래 내용을 그대로 개발자에게 전달하면 원인을 바로 찾을 수 있습니다.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => this.setState({ err: null, stack: "" })}>다시 시도</button>
          <button onClick={() => location.reload()}>새로고침</button>
          <button onClick={() => {
            const t = `${err.message}\n\n${err.stack ?? ""}\n\n${stack}`;
            void navigator.clipboard?.writeText(t).catch(() => {});
          }}>오류 내용 복사</button>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "rgba(0,0,0,.35)",
                      border: "1px solid var(--border, #334155)", borderRadius: 6, padding: 12, margin: 0 }}>
          {err.message}
          {"\n\n"}{err.stack}
          {stack ? `\n\n--- 컴포넌트 경로 ---${stack}` : ""}
        </pre>
      </div>
    );
  }
}
