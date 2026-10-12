import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.QP_API_TARGET ?? 'http://127.0.0.1:8080';

/** Served by the realtime server under /admin (same origin as the API, so the session cookie just works). */
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { port: 5174, proxy: { '/v1': { target: API_TARGET, changeOrigin: false } } },
  build: { target: 'es2022', sourcemap: true, assetsInlineLimit: 0 },
});
