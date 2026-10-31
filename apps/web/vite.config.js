import { defineConfig } from 'vite';

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
});
