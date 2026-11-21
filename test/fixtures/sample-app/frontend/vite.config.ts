/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// The API is reached through this dev server, so the UI and API share one origin and
// Sanctum's cookie auth works without CORS.
const api = process.env.API_ORIGIN ?? 'http://nginx:80';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['localhost', 'frontend'],
    proxy: {
      '/api': { target: api },
      '/sanctum': { target: api },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    coverage: { provider: 'v8', reporter: ['text-summary', 'lcov'], include: ['src/**'] },
  },
});
