/**
 * authApi.js — Phase AUTH client for the /api/v1/auth/* endpoints.
 *
 * Same shape as the other API modules in this codebase: every
 * function accepts `mockDb` as its last argument; real mode hits
 * the backend, mock mode delegates to MockDataContext mutators for
 * parity.
 *
 * All real-mode calls run with `withCredentials: true` so the
 * browser sends + accepts the `marketing_session` cookie. The
 * `apiClient` axios instance has `withCredentials` set globally
 * — verify in api/client.js if you change auth semantics.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */

import { mockDelay, MOCK_MODE, apiClient } from './client';


/**
 * register — POST /api/v1/auth/register
 *
 * Self-serve account creation. On success the backend sets the
 * marketing_session cookie via Set-Cookie; subsequent requests
 * automatically carry it.
 *
 * @param {object} body  - { username, password, managed_client_ids[], display_name? }
 * @param {object} mockDb
 * @returns {Promise<object>} UserResponse-shaped
 */
export async function register(body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/auth/register', body);
    return data;
  }
  await mockDelay(250);
  return mockDb.applyAuthRegister(body);
}


/**
 * login — POST /api/v1/auth/login
 *
 * @param {object} body  - { username, password }
 * @param {object} mockDb
 * @returns {Promise<object>} UserResponse-shaped
 */
export async function login(body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/auth/login', body);
    return data;
  }
  await mockDelay(250);
  return mockDb.applyAuthLogin(body);
}


/**
 * logout — POST /api/v1/auth/logout
 *
 * Idempotent. Returns nothing.
 */
export async function logout(mockDb) {
  if (!MOCK_MODE) {
    await apiClient.post('/auth/logout');
    return;
  }
  await mockDelay(150);
  mockDb.applyAuthLogout();
}


/**
 * getMe — GET /api/v1/auth/me
 *
 * Called by the AuthContext on mount to hydrate from an existing
 * session cookie. Rejects (axios throws) when no valid session is
 * present; callers treat that as "logged out" rather than an error.
 *
 * @param {object} mockDb
 * @returns {Promise<object>} UserResponse — throws when not authenticated
 */
export async function getMe(mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.get('/auth/me');
    return data;
  }
  await mockDelay(100);
  // The mock layer either returns the current "logged-in" mock user
  // or throws — same semantics as the real /me endpoint.
  return mockDb.getCurrentMockUser();
}


/**
 * patchMe — PATCH /api/v1/auth/me
 *
 * Partial update of the current user. Today's mutable fields:
 * managed_client_ids, display_name.
 */
export async function patchMe(body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.patch('/auth/me', body);
    return data;
  }
  await mockDelay(200);
  return mockDb.applyAuthPatchMe(body);
}
