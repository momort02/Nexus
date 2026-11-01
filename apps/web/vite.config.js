import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
      '/socket.io': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        home: resolve(webRoot, 'index.html'),
        dashboard: resolve(webRoot, 'dashboard/index.html'),
        terms: resolve(webRoot, 'terms.html'),
        privacy: resolve(webRoot, 'privacy.html'),
      },
    },
  },
});
