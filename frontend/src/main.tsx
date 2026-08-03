import { StrictMode } from 'react'
import { applyDocumentLocale } from "./lib/i18n";
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary, installGlobalCrashLog, isChunkLoadError, reloadOnceForChunk } from './components/ErrorBoundary'
import { describeReason } from './lib/crashReason'

// 새 버전 배포로 옛 청크가 사라지면 vite 가 이 이벤트를 쏜다 — 조용히 1회 재적재해 백지 화면을 막는다
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  console.warn('[Saintview] 새 버전이 배포되어 화면을 다시 불러옵니다.')
  reloadOnceForChunk()
})

// 경계 밖(비동기·이벤트 핸들러) 오류를 새로고침해도 남는 기록으로 — 설정 > 정보에서 확인
installGlobalCrashLog()

// 잡히지 않은 비동기 오류도 콘솔·세션에 남긴다 — 백지 화면의 원인 추적용
window.addEventListener('unhandledrejection', (e) => {
  if (isChunkLoadError(e.reason) && reloadOnceForChunk()) return
  console.error('[Saintview] 처리되지 않은 Promise 거부:', e.reason)
  try {
    // ⚠ String(reason) 은 XMLHttpRequest 를 `[object XMLHttpRequest]` 로 뭉개 status·URL 을
    //   통째로 버린다(영상 로더는 Error 가 아니라 XHR 을 reject 한다) — describeReason 이 그것을 편다
    const d = describeReason(e.reason)
    sessionStorage.setItem('sv_last_rejection', JSON.stringify({
      msg: d.message,
      stack: d.stack.slice(0, 4000),
      at: new Date().toISOString(), url: location.href,
    }))
  } catch { /* 무시 */ }
})

applyDocumentLocale();   // <html lang/dir> — 아랍어는 RTL
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="Saintview PACS AI">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
