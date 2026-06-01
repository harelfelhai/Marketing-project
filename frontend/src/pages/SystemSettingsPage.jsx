/**
 * SystemSettingsPage — admin-only infrastructure controls (System Settings tab).
 *
 * Deliberately separate from the normal operator workflow tabs: this surface
 * is for a technical administrator to flip built-in infrastructure choices
 * that historically required editing many files. The first control is the
 * storage-backend selector (the database engine the app reads/writes through).
 *
 * Backed by GET/PUT /api/v1/system/settings on the real API and the
 * applyGetSystemSettings / applyUpdateSystemSettings mutators in mock mode.
 * The whole page is gated behind RequireRole="admin" at the route level.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Save, ArrowLeft, Database, AlertCircle } from 'lucide-react';

import { useMockData } from '../contexts/MockDataContext';
import { useUI }       from '../contexts/UIContext';
import { getSystemSettings, updateSystemSettings } from '../api/systemApi';
import { normalizeError } from '../api/client';
import {
  SYSSET_TITLE, SYSSET_SUB, SYSSET_LOADING,
  SYSSET_DB_TITLE, SYSSET_DB_DESC, SYSSET_APPLIES_ON_RESTART,
  SYSSET_BACKEND_UNAVAILABLE, SYSSET_BACKEND_LABELS,
  SYSSET_BTN_SAVE, SYSSET_BTN_SAVING, SYSSET_BTN_BACK,
  SYSSET_TOAST_SAVED, SYSSET_TOAST_ERROR,
} from '../config/strings.he';


export default function SystemSettingsPage() {
  const navigate     = useNavigate();
  const mockDb       = useMockData();
  const { pushToast } = useUI();

  const [settings, setSettings]   = useState(null);   // server view
  const [selected, setSelected]   = useState(null);   // pending choice
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getSystemSettings(mockDb);
        if (!alive) return;
        setSettings(data);
        setSelected(data.storage_backend);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = settings && selected !== settings.storage_backend;

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const updated = await updateSystemSettings({ storage_backend: selected }, mockDb);
      setSettings(updated);
      setSelected(updated.storage_backend);
      pushToast({ variant: 'success', message: SYSSET_TOAST_SAVED });
    } catch (err) {
      const { message } = normalizeError(err);
      pushToast({ variant: 'error', message: SYSSET_TOAST_ERROR(message) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>{SYSSET_LOADING}</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid="system-settings-page">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{SYSSET_TITLE}</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-prose">{SYSSET_SUB}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{SYSSET_BTN_BACK}</span>
        </button>
      </div>

      {/* Database backend section */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">{SYSSET_DB_TITLE}</h2>
        </div>
        <p className="text-[13px] text-slate-500 mb-4">{SYSSET_DB_DESC}</p>

        <div className="space-y-2" role="radiogroup" aria-label={SYSSET_DB_TITLE}>
          {settings.backends.map((b) => {
            const label    = SYSSET_BACKEND_LABELS[b.id] || b.id;
            const disabled = !b.available;
            const checked  = selected === b.id;
            return (
              <label
                key={b.id}
                data-testid={`backend-option-${b.id}`}
                className={[
                  'flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors',
                  disabled
                    ? 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-70'
                    : 'border-slate-200 hover:border-slate-300 cursor-pointer',
                  checked && !disabled ? 'border-slate-900 ring-1 ring-slate-900' : '',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="storage_backend"
                  value={b.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => setSelected(b.id)}
                  className="accent-slate-900"
                />
                <span className="text-sm text-slate-800">{label}</span>
                {disabled && (
                  <span className="ms-auto inline-flex items-center gap-1 text-[11px] text-amber-600">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {SYSSET_BACKEND_UNAVAILABLE}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {settings.applies_on_restart && (
          <p className="mt-4 text-[12px] text-slate-400">{SYSSET_APPLIES_ON_RESTART}</p>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            data-testid="system-settings-save"
            className={[
              'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
              !dirty || saving
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-slate-900 text-white hover:bg-slate-800',
            ].join(' ')}
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" />{SYSSET_BTN_SAVING}</>
              : <><Save className="w-4 h-4" />{SYSSET_BTN_SAVE}</>}
          </button>
        </div>
      </section>
    </div>
  );
}
