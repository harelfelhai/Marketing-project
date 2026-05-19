/**
 * RegisterPage — Phase AUTH self-serve registration.
 *
 * Form fields:
 *   - username (min 2 chars — operator-facing typo guard)
 *   - password (min 4 chars) + confirm-password (must match)
 *   - display_name (optional)
 *   - managed_client_ids — multi-checkbox over CLIENT_REGISTRY,
 *                          at least one required
 *
 * On success → AuthContext flips to 'authenticated', operator is
 * routed to '/'.
 *
 * Admin creation is INTENTIONALLY absent — the only path to an admin
 * account is the static `admins.json` server-side file. This page
 * always creates `role='regular'`.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, UserPlus } from 'lucide-react';

import { useAuth } from '../contexts/MockAuthContext';
import { useUI }   from '../contexts/UIContext';
import ClientMultiPicker from '../components/primitives/ClientMultiPicker';
import {
  AUTH_REGISTER_TITLE,
  AUTH_FIELD_USERNAME, AUTH_FIELD_PASSWORD, AUTH_FIELD_PASSWORD_CONFIRM,
  AUTH_FIELD_DISPLAY_NAME,
  AUTH_REGISTER_CLIENTS_LABEL,
  AUTH_BTN_REGISTER, AUTH_BTN_REGISTERING, AUTH_BTN_BACK_TO_LOGIN,
  AUTH_ERR_REQUIRED, AUTH_ERR_MIN_USERNAME, AUTH_ERR_MIN_PASSWORD,
  AUTH_ERR_PASSWORDS_MISMATCH, AUTH_ERR_NO_CLIENTS,
  AUTH_TOAST_REGISTER_SUCCESS, AUTH_TOAST_REGISTER_TAKEN,
  AUTH_TOAST_REGISTER_ERROR,
} from '../config/strings.he';


export default function RegisterPage() {
  const navigate = useNavigate();
  const { register, status } = useAuth();
  const { pushToast } = useUI();

  const [form, setForm] = useState({
    username: '',
    password: '',
    confirm:  '',
    displayName: '',
    clientIds: new Set(),
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Already-authenticated operators have no business on /register.
  useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true });
  }, [status, navigate]);

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const updateClientIds = (nextSet) => {
    setForm((f) => ({ ...f, clientIds: nextSet }));
    setErrors((e) => ({ ...e, clientIds: '' }));
  };

  const validate = () => {
    const errs = {};
    const u = form.username.trim();
    if (!u)              errs.username = AUTH_ERR_REQUIRED(AUTH_FIELD_USERNAME);
    else if (u.length < 2) errs.username = AUTH_ERR_MIN_USERNAME;

    if (!form.password)            errs.password = AUTH_ERR_REQUIRED(AUTH_FIELD_PASSWORD);
    else if (form.password.length < 4) errs.password = AUTH_ERR_MIN_PASSWORD;

    if (form.password && form.confirm !== form.password) {
      errs.confirm = AUTH_ERR_PASSWORDS_MISMATCH;
    }
    // UAT round-3: managed_client_ids is OPTIONAL on registration —
    // some operators start without any client assignments and pick them
    // up later from the profile editor. No min-size validation here.
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await register({
        username: form.username.trim(),
        password: form.password,
        managed_client_ids: Array.from(form.clientIds),
        display_name: form.displayName.trim() || null,
      });
      pushToast({ variant: 'success', message: AUTH_TOAST_REGISTER_SUCCESS });
      navigate('/', { replace: true });
    } catch (err) {
      // 409 (taken) vs 422 (validation) vs network — give the friendliest fit
      const msg = err?.message || '';
      const taken = msg.includes('taken') || msg.includes('already');
      pushToast({
        variant: 'error',
        message: taken ? AUTH_TOAST_REGISTER_TAKEN : AUTH_TOAST_REGISTER_ERROR(msg),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6" dir="rtl">
      <section
        data-testid="auth-register-card"
        className="w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4"
      >
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-slate-900">
            {AUTH_REGISTER_TITLE}
          </h1>
        </header>

        <Field
          id="reg-username"
          label={AUTH_FIELD_USERNAME}
          value={form.username}
          onChange={(v) => setField('username', v)}
          error={errors.username}
          autoComplete="username"
          disabled={submitting}
        />
        <Field
          id="reg-password"
          type="password"
          label={AUTH_FIELD_PASSWORD}
          value={form.password}
          onChange={(v) => setField('password', v)}
          error={errors.password}
          autoComplete="new-password"
          disabled={submitting}
        />
        <Field
          id="reg-confirm"
          type="password"
          label={AUTH_FIELD_PASSWORD_CONFIRM}
          value={form.confirm}
          onChange={(v) => setField('confirm', v)}
          error={errors.confirm}
          autoComplete="new-password"
          disabled={submitting}
        />
        <Field
          id="reg-display-name"
          label={AUTH_FIELD_DISPLAY_NAME}
          value={form.displayName}
          onChange={(v) => setField('displayName', v)}
          disabled={submitting}
        />

        {/* Client picker — searchable combobox + chips. Scales to
            hundreds of clients without a giant checkbox list. */}
        <div>
          <label htmlFor="reg-client-picker" className="block text-xs font-medium text-slate-700 mb-1">
            {AUTH_REGISTER_CLIENTS_LABEL}
          </label>
          <ClientMultiPicker
            inputId="reg-client-picker"
            selected={form.clientIds}
            onChange={updateClientIds}
            disabled={submitting}
            data-testid="reg-client-picker"
          />
          {errors.clientIds && (
            <span className="text-xs text-rose-600 mt-1 block">{errors.clientIds}</span>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => navigate('/login')}
            disabled={submitting}
            className="text-xs text-slate-500 hover:text-slate-900 underline"
          >
            {AUTH_BTN_BACK_TO_LOGIN}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="auth-register-submit"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {AUTH_BTN_REGISTERING}</>
              : <><UserPlus className="w-4 h-4" /> {AUTH_BTN_REGISTER}</>
            }
          </button>
        </div>
      </section>
    </main>
  );
}


function Field({ id, label, value, onChange, error, type = 'text', autoComplete, disabled }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        className={[
          'mt-1 block w-full h-9 px-2 rounded-md border text-sm',
          error ? 'border-rose-400' : 'border-slate-300',
        ].join(' ')}
      />
      {error && <span className="text-xs text-rose-600 mt-1 block">{error}</span>}
    </label>
  );
}
