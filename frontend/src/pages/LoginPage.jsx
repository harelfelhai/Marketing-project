/**
 * LoginPage — Phase AUTH landing page.
 *
 * Three discrete paths:
 *   1. Log in        — username + password → cookie-backed session
 *   2. Register      — navigates to /register
 *   3. Guest         — flips AuthContext.status → 'guest' and routes
 *                       back to the previous location (or /)
 *
 * Auto-redirect: if the operator is ALREADY authenticated (e.g.
 * cookie still valid after a reload, or status==='guest'), this
 * page navigates straight into the app without showing the form.
 * Same idea as a typical /login route — we don't show login UI to
 * someone who's already in.
 *
 * STATE
 * -----
 * Local form state only. No global slice — auth-flow state never
 * needs to survive a route change since the operator's already
 * routed away on either success path.
 *
 * UX VOICE
 * --------
 * Soft + minimal. This is the first surface every operator sees;
 * we want to look inviting, not gate-keeping. The "guest" path
 * gets equal visual weight to login per the spec's intent of a
 * lightweight guardrail rather than a fortress.
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, LogIn, UserPlus, User as UserIcon } from 'lucide-react';

import { useAuth } from '../contexts/MockAuthContext';
import { useUI }   from '../contexts/UIContext';
import {
  AUTH_LANDING_TITLE, AUTH_LANDING_SUBTITLE,
  AUTH_FIELD_USERNAME, AUTH_FIELD_PASSWORD,
  AUTH_BTN_LOGIN, AUTH_BTN_LOGGING_IN,
  AUTH_DIVIDER_OR,
  AUTH_REGISTER_PROMPT, AUTH_BTN_GOTO_REGISTER,
  AUTH_GUEST_PROMPT, AUTH_BTN_CONTINUE_GUEST,
  AUTH_ERR_REQUIRED,
  AUTH_TOAST_LOGIN_SUCCESS, AUTH_TOAST_LOGIN_ERROR,
} from '../config/strings.he';


export default function LoginPage() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { status, login, continueAsGuest, user } = useAuth();
  const { pushToast } = useUI();

  // Form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors,   setErrors]   = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Where to land after a successful auth choice. Set by the route
  // gate (App.jsx) when it redirects an unauthed operator here, via
  // location.state.from. Falls back to '/' for direct visits.
  const next = location.state?.from || '/';

  // If the operator is already past the gate, don't show the form.
  useEffect(() => {
    if (status === 'authenticated' || status === 'guest') {
      navigate(next, { replace: true });
    }
  }, [status, next, navigate]);

  const handleLogin = async () => {
    const errs = {};
    if (!username.trim()) errs.username = AUTH_ERR_REQUIRED(AUTH_FIELD_USERNAME);
    if (!password)        errs.password = AUTH_ERR_REQUIRED(AUTH_FIELD_PASSWORD);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const u = await login(username.trim(), password);
      pushToast({
        variant: 'success',
        message: AUTH_TOAST_LOGIN_SUCCESS(u.display_name || u.username),
      });
      navigate(next, { replace: true });
    } catch (err) {
      // 401 lands here. Don't reveal "user unknown" vs "wrong
      // password" — operator-friendly courtesy.
      pushToast({ variant: 'error', message: AUTH_TOAST_LOGIN_ERROR });
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuest = () => {
    continueAsGuest();
    navigate(next, { replace: true });
  };

  const handleGotoRegister = () => navigate('/register');

  return (
    <main
      className="min-h-screen flex items-center justify-center bg-slate-50 p-6"
      dir="rtl"
    >
      <section
        data-testid="auth-login-card"
        className="w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-5"
      >
        <header className="text-center space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">
            {AUTH_LANDING_TITLE}
          </h1>
          <p className="text-sm text-slate-500">{AUTH_LANDING_SUBTITLE}</p>
        </header>

        {/* Login form */}
        <div className="space-y-3">
          <label htmlFor="auth-username" className="block">
            <span className="text-xs font-medium text-slate-700">
              {AUTH_FIELD_USERNAME}
            </span>
            <input
              id="auth-username"
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setErrors((er) => ({ ...er, username: '' })); }}
              className={[
                'mt-1 block w-full h-9 px-2 rounded-md border text-sm',
                errors.username ? 'border-rose-400' : 'border-slate-300',
              ].join(' ')}
              autoComplete="username"
              disabled={submitting}
            />
            {errors.username && (
              <span className="text-xs text-rose-600 mt-1 block">{errors.username}</span>
            )}
          </label>

          <label htmlFor="auth-password" className="block">
            <span className="text-xs font-medium text-slate-700">
              {AUTH_FIELD_PASSWORD}
            </span>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((er) => ({ ...er, password: '' })); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
              className={[
                'mt-1 block w-full h-9 px-2 rounded-md border text-sm',
                errors.password ? 'border-rose-400' : 'border-slate-300',
              ].join(' ')}
              autoComplete="current-password"
              disabled={submitting}
            />
            {errors.password && (
              <span className="text-xs text-rose-600 mt-1 block">{errors.password}</span>
            )}
          </label>

          <button
            type="button"
            onClick={handleLogin}
            disabled={submitting}
            data-testid="auth-login-submit"
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {AUTH_BTN_LOGGING_IN}</>
              : <><LogIn className="w-4 h-4" /> {AUTH_BTN_LOGIN}</>
            }
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="flex-1 h-px bg-slate-200" />
          <span>{AUTH_DIVIDER_OR}</span>
          <span className="flex-1 h-px bg-slate-200" />
        </div>

        {/* Secondary paths */}
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">{AUTH_REGISTER_PROMPT}</span>
            <button
              type="button"
              onClick={handleGotoRegister}
              data-testid="auth-goto-register"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-sm text-slate-700"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {AUTH_BTN_GOTO_REGISTER}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">{AUTH_GUEST_PROMPT}</span>
            <button
              type="button"
              onClick={handleGuest}
              data-testid="auth-continue-guest"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-sm text-slate-700"
            >
              <UserIcon className="w-3.5 h-3.5" />
              {AUTH_BTN_CONTINUE_GUEST}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
