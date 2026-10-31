import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/page-image': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ask': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/packs': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/benchmarks': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ingest': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
