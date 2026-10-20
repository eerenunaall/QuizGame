import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vite';

const API_TARGET = process.env.QP_API_TARGET ?? 'http://127.0.0.1:8080';

/**
 * One ES-module bundle (Chromium 63+, Safari 12+: smart TVs from 2019, every current phone) with
 * core-js polyfills added only where a target lacks a feature. Browsers without ES modules never
 * load it: `index.html` shows them a plain "unsupported browser" notice from an external script.
 * A SystemJS fallback bundle is deliberately not built: it needs a `data:` module guard that a
 * strict Content-Security-Policy (no `data:`, no `unsafe-inline`) has to refuse.
 */
export default defineConfig({
  plugins: [
    react(),
    legacy({
      renderLegacyChunks: false,
      modernTargets: ['chrome >= 63', 'safari >= 12', 'ios >= 12', 'edge >= 79', 'firefox >= 67'],
      modernPolyfills: true,
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/v1': { target: API_TARGET, changeOrigin: false },
      '/ws': { target: API_TARGET.replace(/^http/u, 'ws'), ws: true, changeOrigin: false },
    },
  },
  preview: { port: 4173 },
  build: {
    target: 'es2019',
    sourcemap: true,
    assetsInlineLimit: 0, // strict CSP: no data: URLs
    chunkSizeWarningLimit: 400,
  },
});
