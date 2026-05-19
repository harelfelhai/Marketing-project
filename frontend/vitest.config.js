/**
 * vitest.config.js — Test runner configuration (DX-T2).
 *
 * Kept separate from vite.config.js so the production build path stays
 * fully decoupled from test infrastructure. Vitest auto-loads this file
 * when present.
 *
 * Stack:
 *   - jsdom environment for component tests (React + DOM globals).
 *   - @testing-library/jest-dom matchers installed via setupFiles.
 *   - axios is treated as a normal ESM module — its real HTTP path is
 *     never exercised because every test runs with MOCK_MODE=true via
 *     the env var below (see vitest's `env` block).
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    css: false,
    env: {
      // Force MOCK_MODE=true for every unit test so the axios instance
      // is never touched. Tests that exercise real-mode paths set this
      // explicitly via vi.stubEnv in the test body.
      VITE_USE_REAL_API: 'false',
    },
    coverage: {
      reporter: ['text', 'html'],
      include: [
        'src/api/**/*.js',
        'src/utils/**/*.js',
        'src/components/**/*.{js,jsx}',
        'src/contexts/**/*.{js,jsx}',
      ],
    },
  },
});
