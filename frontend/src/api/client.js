/**
 * client.js — shared API utilities: MOCK_MODE flag, mock delay, axios instance,
 * typed ApiError, and a normalizeError helper for toast / component display.
 *
 * MOCK_MODE reads from VITE_USE_REAL_API env var — no code change needed to
 * switch between mock and real modes; only a .env.local update.
 *
 * // HOOK FOR REAL API: set VITE_USE_REAL_API=true in .env.local and ensure
 * // the backend is running on the VITE_API_BASE_URL target.
 */

import axios from 'axios';

export const MOCK_MODE = import.meta.env.VITE_USE_REAL_API !== 'true';

/** Simulate network latency in mock mode. No-op in real mode. */
export function mockDelay(ms = 400) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Typed error thrown by the response interceptor.
// Components catch ApiError and call normalizeError() to surface a toast.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor({ status, message, requestId }) {
    super(message);
    this.name      = 'ApiError';
    this.status    = status;
    this.requestId = requestId;
  }
}

// ---------------------------------------------------------------------------
// Axios instance — used when MOCK_MODE === false.
//
// baseURL: Vite proxy path (/api/v1) → same-origin in dev and in the nginx
// Docker configuration. Override with VITE_API_BASE_URL for non-standard setups.
// ---------------------------------------------------------------------------

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
  // Phase AUTH — required so the browser sends + accepts the
  // marketing_session cookie on every request. Same-origin only
  // (backend's CORS allow_credentials=True permits this).
  withCredentials: true,
  // Phase AUTH-C — emit repeated query params for arrays
  // (`?root_entity_ids=1&root_entity_ids=2`) instead of the axios default
  // bracket notation (`?root_entity_ids[]=1&...`). FastAPI's
  // `list[int] = Query(None)` parses repeated params natively but
  // ignores the bracket form. `indexes: null` flattens arrays.
  paramsSerializer: { indexes: null },
});

// Stamp every outgoing request with a correlation ID for end-to-end log tracing.
apiClient.interceptors.request.use((config) => {
  config.headers['X-Request-ID'] = crypto.randomUUID();
  return config;
});

// Normalize every HTTP error into ApiError so callers never inspect raw axios shapes.
//
// Blob-aware: when a caller uses `responseType: 'blob'` (export endpoints
// stream xlsx bytes that way) and the server returns a 4xx with a JSON
// body, axios delivers `err.response.data` as a Blob containing the JSON.
// Reading `.detail` off a Blob yields undefined, so without this branch
// every export failure would show the generic "Request failed". We
// read the blob as text, try to parse the FastAPI `{detail: "..."}`
// envelope, and surface the real message in the toast.
apiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status    = err.response?.status              ?? 0;
    const requestId = err.config?.headers?.['X-Request-ID'] ?? null;
    let message     = err.message ?? 'Request failed';

    const data = err.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        try {
          const parsed = JSON.parse(text);
          if (parsed?.detail) message = parsed.detail;
          else if (text)     message = text;
        } catch {
          if (text) message = text;
        }
      } catch {
        /* swallow — fall back to err.message */
      }
    } else if (data?.detail) {
      message = data.detail;
    }

    return Promise.reject(new ApiError({ status, message, requestId }));
  }
);

/**
 * Normalize any thrown error to { status, message } for toast display.
 * Handles ApiError instances and raw axios / unknown errors.
 */
export function normalizeError(err) {
  if (err instanceof ApiError) {
    return { status: err.status, message: err.message };
  }
  if (err?.response) {
    return {
      status:  err.response.status,
      message: err.response.data?.detail || err.response.statusText || 'Request failed',
    };
  }
  return { status: 0, message: err?.message || 'Unknown error' };
}
