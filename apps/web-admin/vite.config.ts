import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Local dev: `vite` serves the SPA on 5174 and proxies /api to `wrangler dev` (8788). The Worker
// refuses a mutating request whose Origin is not its own, so the proxy rewrites Origin.
const WORKER = 'http://localhost:8788';

export default defineConfig({
  plugins: [react()],
  // Fonts and the theme bootstrap are the hotel app's static files: one copy, no second font set.
  publicDir: '../web-pms/public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    fs: { allow: ['../..'] },
    proxy: {
      '/api': {
        target: WORKER,
        // Host becomes the Worker's, so its request URL origin is WORKER; Origin is rewritten to match.
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', WORKER);
          });
        },
      },
    },
  },
});
