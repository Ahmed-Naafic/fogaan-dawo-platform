import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // One .env at the repo root serves both apps; only VITE_* values reach the browser.
  const env = loadEnv(mode, repoRoot, '');
  return {
    envDir: repoRoot,
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // Lets the web app call /api/* in development without CORS setup; `ws` also proxies the
        // consultation signaling WebSocket (/api/v1/consultations/signal).
        '/api': { target: env.API_PROXY_TARGET || `http://localhost:${env.PORT || 4000}`, ws: true },
      },
    },
  };
});
