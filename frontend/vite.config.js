import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // HOOK FOR REAL API: All /api requests are forwarded to the backend.
      // When switching from mock mode, set VITE_MOCK_MODE=false in .env
      // and the api/*.js functions will route here instead of mock state.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
