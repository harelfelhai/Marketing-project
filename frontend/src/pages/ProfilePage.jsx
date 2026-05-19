/**
 * ProfilePage — UAT round-3: operator profile editor.
 *
 * Lets an authenticated user edit:
 *   - display_name (free text, optional)
 *   - managed_client_ids (the personalization seed). Empty list is
 *     allowed — the operator can opt out of personalization entirely.
 *
 * Sits at /profile. Backed by PATCH /auth/me on the real API and
 * patchMe() on MockAuthContext. Reuses the ClientMultiPicker primitive
 * so the chip + search UX matches registration.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Save, ArrowLeft } from 'lucide-react';

import { useAuth } from '../contexts/MockAuthContext';
import { useUI }   from '../contexts/UIContext';
import ClientMultiPicker from '../components/primitives/ClientMultiPicker';
import {
  PROFILE_TITLE, PROFILE_SUB,
  PROFILE_FIELD_DISPLAY_NAME, PROFILE_FIELD_MANAGED_CLIENTS,
  PROFILE_HINT_EMPTY_CLIENTS,
  PROFILE_BTN_SAVE, PROFILE_BTN_SAVING, PROFILE_BTN_BACK,
  PROFILE_TOAST_SAVED, PROFILE_TOAST_ERROR,
} from '../config/strings.he';


export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, patchMe, status } = useAuth();
  const { pushToast } = useUI();

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [clientIds, setClientIds]     = useState(
    () => new Set(user?.managed_client_ids || []),
  );
  const [submitting, setSubmitting]   = useState(false);

  // Keep local state in sync if the auth context refreshes (login event,
  // backend mutation, etc.).
  useEffect(() => {
    setDisplayName(user?.display_name || '');
    setClientIds(new Set(user?.managed_client_ids || []));
  }, [user]);

  // Guests / unauthenticated → bounce back to landing.
  if (status !== 'authenticated' || !user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </main>
    );
  }

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await patchMe({
        display_name:       displayName.trim() || null,
        managed_client_ids: Array.from(clientIds),
      });
      pushToast({ variant: 'success', message: PROFILE_TOAST_SAVED });
    } catch (err) {
      pushToast({
        variant: 'error',
        message: PROFILE_TOAST_ERROR(err?.message || 'error'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-5 max-w-2xl" dir="rtl">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{PROFILE_TITLE}</h1>
          <p className="text-sm text-slate-500 mt-1">{PROFILE_SUB}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {PROFILE_BTN_BACK}
        </button>
      </header>

      <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">
            {PROFILE_FIELD_DISPLAY_NAME}
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-testid="profile-display-name"
            className="mt-1 block w-full h-9 px-2 rounded-md border border-slate-300 text-sm"
          />
        </label>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            {PROFILE_FIELD_MANAGED_CLIENTS}
          </label>
          <ClientMultiPicker
            selected={clientIds}
            onChange={setClientIds}
            disabled={submitting}
            data-testid="profile-client-picker"
          />
          <p className="text-[11px] text-slate-400 mt-1">{PROFILE_HINT_EMPTY_CLIENTS}</p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            data-testid="profile-save"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {PROFILE_BTN_SAVING}</>
              : <><Save className="w-4 h-4" /> {PROFILE_BTN_SAVE}</>
            }
          </button>
        </div>
      </div>
    </section>
  );
}
