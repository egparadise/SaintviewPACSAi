import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteCommonjs } from '@originjs/vite-plugin-commonjs'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))

// 자체서명 HTTPS 전용 — 모니터 감지(getScreenDetails) 등 secure context 필수 API가
// 원격 PC(다른 좌석·Tailscale) 접속에서도 동작해야 하므로 http 폴백 없이 HTTPS 로 고정한다.
// (http 로 조용히 내려가면 원격 다중 모니터 인식이 소리 없이 죽는다 — 기동 거부가 낫다)
// 인증서 생성: start_saintview.bat 이 없으면 자동 생성. 수동 생성은 frontend 에서
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/dev.key -out certs/dev.crt -days 3650 \
//     -subj "/CN=saintview-dev" \
//     -addext "subjectAltName=IP:<tailscaleIP>,IP:127.0.0.1,DNS:localhost,DNS:<host>.ts.net"
// 클라이언트는 최초 1회 '안전하지 않음' 경고를 넘기면 secure context 로 동작(내부 tail넷 전용).
function httpsOption() {
  const key = resolve(rootDir, 'certs/dev.key')
  const cert = resolve(rootDir, 'certs/dev.crt')
  if (!existsSync(key) || !existsSync(cert)) {
    throw new Error(
      '[vite] HTTPS 전용 — certs/dev.key|crt 가 없어 기동할 수 없습니다. ' +
      'start_saintview.bat 실행(자동 생성) 또는 vite.config.ts 상단의 openssl 명령으로 생성하세요.',
    )
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

// https://vite.dev/config/
// Cornerstone3D 공식 Vite 가이드: codec(CJS/WASM) ESM 변환 + 워커 설정
export default defineConfig({
  plugins: [viteCommonjs(), react()],
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser'],
  },
  worker: {
    format: 'es',
  },
  // Tailscale 등 원격 PC 접속 — 모든 인터페이스 바인딩 + 같은 출처 프록시(API/DICOMweb).
  // 프론트는 상대경로(/api, /dicom-web)를 호출하고 Vite 가 서버 안에서 백엔드/Orthanc 로 프록시 → CORS·추가 포트 노출 불필요.
  server: {
    host: '0.0.0.0',
    allowedHosts: true,      // Vite Host 헤더 체크 우회(Tailscale IP·MagicDNS 호스트 허용)
    https: httpsOption(),    // 항상 자체서명 HTTPS(원격 secure context 보장) — http 폴백 없음
    proxy: {
      '/api': 'http://localhost:8000',        // 백엔드 FastAPI
      '/dicom-web': 'http://localhost:3000',  // Orthanc DICOMweb (OHIF nginx 경유)
      '/orthanc': {                            // 썸네일 프리뷰 — Orthanc 네이티브 /instances/.../preview
        target: 'http://localhost:8042',
        rewrite: (p) => p.replace(/^\/orthanc/, ''),
        // preview 캐시 1시간 — 200 응답에만(오류 캐시 고정 방지), immutable 금지(동일 SOP 재전송 대비)
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            if (proxyRes.statusCode === 200 && /\/instances\/[^/]+\/preview/.test(req.url ?? '')) {
              proxyRes.headers['cache-control'] = 'private, max-age=3600'
            }
          })
        },
      },
    },
  },
})
