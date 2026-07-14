import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteCommonjs } from '@originjs/vite-plugin-commonjs'

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
