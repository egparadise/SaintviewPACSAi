import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary, isChunkLoadError, reloadOnceForChunk } from './components/ErrorBoundary'

// 새 버전 배포로 옛 청크가 사라지면 vite 가 이 이벤트를 쏜다 — 조용히 1회 재적재해 백지 화면을 막는다
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  console.warn('[Saintview] 새 버전이 배포되어 화면을 다시 불러옵니다.')
  reloadOnceForChunk()
})

// 잡히지 않은 비동기 오류도 콘솔·세션에 남긴다 — 백지 화면의 원인 추적용
window.addEventListener('unhandledrejection', (e) => {
  if (isChunkLoadError(e.reason) && reloadOnceForChunk()) return
  console.error('[Saintview] 처리되지 않은 Promise 거부:', e.reason)
  try {
    sessionStorage.setItem('sv_last_rejection', JSON.stringify({
      msg: String((e.reason as Error)?.message ?? e.reason),
      stack: String((e.reason as Error)?.stack ?? '').slice(0, 4000),
      at: new Date().toISOString(), url: location.href,
    }))
  } catch { /* 무시 */ }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="Saintview PACS AI">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
