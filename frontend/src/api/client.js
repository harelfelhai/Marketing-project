/**
 * client.js — shared API utilities: mock delay, mode flag, error normalizer.
 *
 * MOCK_MODE drives whether api/*.js functions hit in-memory mock state or
 * real HTTP. It reads from the VITE_USE_REAL_API env var so the toggle
 * requires no code change — only a .env file update.
 *
 * .env.example ships with VITE_USE_REAL_API=false (mock mode default).
 * Set VITE_USE_REAL_API=true in .env.local to point at the live backend.
 *
 * // HOOK FOR REAL API: set VITE_USE_REAL_API=true in .env.local and ensure
 * // vite.config.js proxy is pointing to the correct backend URL.
 */

export const MOCK_MODE = import.meta.env.VITE_USE_REAL_API !== 'true';

/**
 * Simulate network latency in mock mode.
 * @param {number} ms - delay in milliseconds
 */
export function mockDelay(ms = 400) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize errors from both mock and real API paths into a consistent shape.
 * Components catch this and push a toast.
 */
export function normalizeError(err) {
  if (err?.response) {
    // Real axios error shape
    return {
      status:  err.response.status,
      message: err.response.data?.detail || err.response.statusText || 'Request failed',
    };
  }
  return {
    status:  0,
    message: err?.message || 'Unknown error',
  };
}
