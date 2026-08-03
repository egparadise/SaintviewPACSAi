import { execSync } from 'node:child_process'
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
  define: {
    // 배포 커밋 — "지금 서버에 어느 버전이 돌고 있나" 를 화면에서 확인하기 위해.
    // ⚠ 실제 사고: 수정을 배포했는데 증상이 계속돼 원인을 찾았더니 **옛 빌드**가 돌고 있었다.
    //   화면에 커밋이 없으면 사용자에게는 그걸 알 방법이 없다.
    // (버전 번호 자체는 lib/version.ts 가 단일 소스다 — 여기서는 해시만 보탠다)
    __BUILD_SHA__: JSON.stringify((() => {
      try {
        return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim()
      } catch { return '' }
    })()),
  },
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
      // 백엔드 FastAPI (⚠ localhost 는 Windows 에서 ::1 먼저 시도해 연결당 ~200ms 를 잃는다 — 실측 214ms→7ms)
      // ⚠ ws:true 필수 — 다학제 협진이 WS /api/collab/ws 를 쓴다. 없으면 업그레이드가 프록시를
      //   통과하지 못해 협진만 조용히 연결 실패한다(REST 는 멀쩡해서 원인이 잘 안 보인다).
      '/api': { target: 'http://127.0.0.1:8000', ws: true },
      '/dicom-web': 'http://127.0.0.1:3000',  // Orthanc DICOMweb (OHIF nginx 경유)
      '/orthanc': {                            // 썸네일 프리뷰 — Orthanc 네이티브 /instances/.../preview
        target: 'http://127.0.0.1:8042',
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
