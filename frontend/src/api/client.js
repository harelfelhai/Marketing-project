/**
 * client.js — shared API utilities: mock delay, mode flag, error normalizer.
 *
 * MOCK_MODE controls whether api/*.js functions hit mock state or real HTTP.
 * Flip to false (or read from import.meta.env.VITE_MOCK_MODE) to go live.
 *
 * // HOOK FOR REAL API: set MOCK_MODE = false and ensure vite.config.js proxy
 * // is pointing to the correct backend URL.
 */

export const MOCK_MODE = true;

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
