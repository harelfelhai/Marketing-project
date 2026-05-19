/**
 * MockAuthContext.jsx — Phase AUTH real-mode + mock-mode auth context.
 *
 * Despite the file name (kept for minimal-churn migration), this is
 * NOW the real Phase AUTH context. The "Mock" prefix predates Phase G
 * and stays only to avoid touching every component that imports
 * `useAuth` from this path.
 *
 * THREE AUTH STATES (drives route gating + personalization)
 * ---------------------------------------------------------
 *   loading           — initial hydrate from cookie in progress
 *   unauthenticated   — no choice made yet (redirect to /login)
 *   guest             — operator clicked "Continue as Guest"
 *   authenticated     — logged in via username + password
 *
 * BACKWARD COMPATIBILITY
 * ----------------------
 * Existing components read `operatorId` and `operatorRole` from
 * useAuth(). Those fields are still exposed:
 *   - operatorId   → user.username (or 'guest' for guest mode)
 *   - operatorRole → user.role (or 'guest' for guest mode)
 * So no callsites need updating.
 *
 * PERSISTENCE
 * -----------
 * - Authenticated:  driven by the marketing_session HttpOnly cookie.
 *                    AuthContext hits GET /auth/me on mount to
 *                    re-hydrate after a reload.
 * - Guest:          driven by localStorage.guestMode flag.
 *                    Survives reloads until the operator logs in.
 * - Personalization: a separate localStorage flag (off-by-default
 *                     for admins, on-by-default for regulars).
 *                     Toggled via the global header chip.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import {
  getMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  patchMe as apiPatchMe,
} from '../api/authApi';
import { useMockData } from './MockDataContext';


const AuthContext = createContext(null);


// ---------------------------------------------------------------------------
// LocalStorage keys (kept here as single source of truth)
// ---------------------------------------------------------------------------

const LS_GUEST_KEY            = 'auth:guestMode:v1';
const LS_PERSONALIZATION_KEY  = 'auth:personalizationActive:v1';


function _readGuestFlag() {
  try { return localStorage.getItem(LS_GUEST_KEY) === 'true'; }
  catch { return false; }
}

function _writeGuestFlag(value) {
  try {
    if (value) localStorage.setItem(LS_GUEST_KEY, 'true');
    else       localStorage.removeItem(LS_GUEST_KEY);
  } catch { /* localStorage disabled — accept transient state */ }
}


function _readPersonalizationFlag(defaultValue) {
  try {
    const v = localStorage.getItem(LS_PERSONALIZATION_KEY);
    if (v === 'true')  return true;
    if (v === 'false') return false;
    return defaultValue;
  } catch { return defaultValue; }
}


function _writePersonalizationFlag(value) {
  try { localStorage.setItem(LS_PERSONALIZATION_KEY, String(!!value)); }
  catch { /* noop */ }
}


// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------


/**
 * @param {object} props
 * @param {object} [props.initialState] - { status, user }. When provided,
 *   skips the on-mount hydrate. Used by tests; production never passes it.
 */
export function AuthProvider({ children, initialState }) {
  const mockDb = useMockData();

  const [status, setStatus] = useState(initialState ? initialState.status : 'loading');
  const [user,   setUser]   = useState(initialState ? initialState.user   : null);
  const [personalizationActive, setPersonalizationActive] = useState(false);

  // On mount: try to hydrate from an existing session cookie. If
  // /auth/me succeeds → authenticated. If it 401s and we have the
  // guest flag in localStorage → guest. Otherwise → unauthenticated
  // (the route gate will redirect to /login).
  // Phase AUTH-B — when a test pre-seeds initialState with a user,
  // mirror that user into the mock DB so the mock-mode mutators
  // (resolveTask, bulkResolve, openTask, etc.) can attribute writes
  // to current_user.username without the caller passing it explicitly.
  useEffect(() => {
    if (initialState && initialState.user && mockDb._syncTestUser) {
      mockDb._syncTestUser(initialState.user);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialState) return;  // test pre-seed; no hydrate
    let cancelled = false;
    getMe(mockDb).then((u) => {
      if (cancelled) return;
      setUser(u);
      setStatus('authenticated');
      // Personalization default: ON for regular users, OFF for admins
      // (admins typically want the full view; regulars want
      // their context). Operator-toggled value in localStorage wins.
      const defaultForRole = u.role !== 'admin';
      setPersonalizationActive(_readPersonalizationFlag(defaultForRole));
    }).catch(() => {
      if (cancelled) return;
      const isGuest = _readGuestFlag();
      setStatus(isGuest ? 'guest' : 'unauthenticated');
    });
    return () => { cancelled = true; };
    // mockDb is stable per provider; eslint-react-hooks would flag it
    // but adding it to the dep array causes spurious re-runs across
    // unrelated MockDataContext mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------

  const login = useCallback(async (username, password) => {
    const u = await apiLogin({ username, password }, mockDb);
    setUser(u);
    setStatus('authenticated');
    _writeGuestFlag(false);
    setPersonalizationActive(_readPersonalizationFlag(u.role !== 'admin'));
    return u;
  }, [mockDb]);

  const register = useCallback(async (body) => {
    const u = await apiRegister(body, mockDb);
    setUser(u);
    setStatus('authenticated');
    _writeGuestFlag(false);
    setPersonalizationActive(_readPersonalizationFlag(true));  // regulars default ON
    return u;
  }, [mockDb]);

  const logout = useCallback(async () => {
    await apiLogout(mockDb);
    setUser(null);
    setStatus('unauthenticated');
    _writeGuestFlag(false);
  }, [mockDb]);

  const continueAsGuest = useCallback(() => {
    setUser(null);
    setStatus('guest');
    _writeGuestFlag(true);
  }, []);

  // Exit guest mode without logging anyone in. Clears the localStorage
  // flag and flips status back to 'unauthenticated' so the route gate
  // redirects to /login. Symmetric counterpart to continueAsGuest.
  const exitGuest = useCallback(() => {
    setUser(null);
    setStatus('unauthenticated');
    _writeGuestFlag(false);
  }, []);

  const togglePersonalization = useCallback(() => {
    setPersonalizationActive((prev) => {
      const next = !prev;
      _writePersonalizationFlag(next);
      return next;
    });
  }, []);

  const patchMe = useCallback(async (body) => {
    const u = await apiPatchMe(body, mockDb);
    setUser(u);
    return u;
  }, [mockDb]);

  // -----------------------------------------------------------------
  // Backward-compat fields for existing useAuth() consumers
  // -----------------------------------------------------------------

  const operatorId =
    status === 'authenticated' ? user.username
    : status === 'guest'       ? 'guest'
    :                            'anonymous';
  const operatorRole =
    status === 'authenticated' ? user.role
    : status === 'guest'       ? 'guest'
    :                            'anonymous';

  const value = {
    // Phase AUTH state
    status,
    user,
    login,
    logout,
    register,
    continueAsGuest,
    exitGuest,
    patchMe,
    personalizationActive,
    togglePersonalization,
    // Backward-compat (existing components keep working unchanged)
    operatorId,
    operatorRole,
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}


// Re-export under the legacy name so main.jsx + renderApp + others
// don't need import changes during the migration.
export const MockAuthProvider = AuthProvider;


export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // During transition some callers might import useAuth from a
    // component that mounts outside the provider — return a safe
    // anonymous shape rather than crash.
    return {
      status: 'unauthenticated',
      user: null,
      operatorId: 'anonymous',
      operatorRole: 'anonymous',
      personalizationActive: false,
      togglePersonalization: () => {},
      login: async () => {},
      logout: async () => {},
      register: async () => {},
      continueAsGuest: () => {},
      exitGuest:       () => {},
      patchMe: async () => {},
    };
  }
  return ctx;
}
