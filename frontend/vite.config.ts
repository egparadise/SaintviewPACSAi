import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteCommonjs } from '@originjs/vite-plugin-commonjs'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))

// 자체서명 HTTPS — 원격(Tailscale) PC 의 '보안 컨텍스트' 확보용(모니터 감지 등 브라우저 API).
// VITE_HTTPS=1 일 때만 certs/dev.{key,crt} 를 읽어 HTTPS 로 서빙(없으면 경고 후 http 폴백).
// 인증서 생성(서버 PC): frontend 에서
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/dev.key -out certs/dev.crt -days 3650 \
//     -subj "/CN=saintview-dev" \
//     -addext "subjectAltName=IP:<tailscaleIP>,IP:127.0.0.1,DNS:localhost,DNS:<host>.ts.net"
// 클라이언트는 최초 1회 '안전하지 않음' 경고를 넘기면 secure context 로 동작(내부 tail넷 전용).
function httpsOption() {
  if (process.env.VITE_HTTPS !== '1') return undefined
  const key = resolve(rootDir, 'certs/dev.key')
  const cert = resolve(rootDir, 'certs/dev.crt')
  if (!existsSync(key) || !existsSync(cert)) {
    console.warn('[vite] VITE_HTTPS=1 이지만 certs/dev.key|crt 를 찾지 못함 — HTTP 로 폴백합니다.')
    return undefined
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
    https: httpsOption(),    // VITE_HTTPS=1 → 자체서명 HTTPS(원격 secure context), 그 외 http
    proxy: {
      '/api': 'http://localhost:8000',        // 백엔드 FastAPI
      '/dicom-web': 'http://localhost:3000',  // Orthanc DICOMweb (OHIF nginx 경유)
      '/orthanc': {                            // 썸네일 프리뷰 — Orthanc 네이티브 /instances/.../preview
        target: 'http://localhost:8042',
        rewrite: (p) => p.replace(/^\/orthanc/, ''),
      },
    },
  },
})
