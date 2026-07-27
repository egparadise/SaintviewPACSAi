// 렌더 예외 안전망 — 이게 없으면 예외 하나로 React 가 트리 전체를 언마운트해 화면이 완전히 백지가 된다
// (새로고침해야만 복구되는 증상의 원인). 여기서 잡아 원인을 보여주고 그 자리에서 복구할 수 있게 한다.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; label?: string }
interface State { err: Error | null; stack: string }

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
    // 마지막 오류를 남겨 두면 사용자가 새로고침한 뒤에도 확인할 수 있다
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
