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

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Save, ArrowLeft, Database, AlertCircle,
  Columns3, ChevronUp, ChevronDown, RotateCcw,
  Link2, CheckCircle2, Eye, EyeOff,
} from 'lucide-react';

import { useMockData } from '../contexts/MockDataContext';
import { useUI }       from '../contexts/UIContext';
import {
  getSystemSettings, updateSystemSettings, updateDisplayFields, updateMongoUrl,
} from '../api/systemApi';
import { normalizeError } from '../api/client';
import { DISPLAY_SURFACES, defaultFieldKeys } from '../config/displayFields';
import {
  SYSSET_TITLE, SYSSET_SUB, SYSSET_LOADING,
  SYSSET_DB_TITLE, SYSSET_DB_DESC, SYSSET_APPLIES_ON_RESTART,
  SYSSET_BACKEND_UNAVAILABLE, SYSSET_BACKEND_LABELS,
  SYSSET_BTN_SAVE, SYSSET_BTN_SAVING, SYSSET_BTN_BACK,
  SYSSET_TOAST_SAVED, SYSSET_TOAST_ERROR,
  SYSSET_FIELDS_TITLE, SYSSET_FIELDS_DESC, SYSSET_FIELDS_MOVE_UP,
  SYSSET_FIELDS_MOVE_DOWN, SYSSET_FIELDS_TOAST_SAVED, SYSSET_FIELDS_TOAST_ERROR,
  SYSSET_FIELDS_RESET,
  SYSSET_MONGO_TITLE, SYSSET_MONGO_DESC, SYSSET_MONGO_URL_LABEL,
  SYSSET_MONGO_URL_PLACEHOLDER, SYSSET_MONGO_CONFIGURED_BADGE,
  SYSSET_MONGO_NOT_CONFIGURED, SYSSET_MONGO_BTN_TEST, SYSSET_MONGO_BTN_TESTING,
  SYSSET_MONGO_TOAST_OK, SYSSET_MONGO_TOAST_ERROR, SYSSET_MONGO_UPDATE_PROMPT,
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

      {/* MongoDB connection URL section */}
      <MongoUrlEditor
        initialConfigured={settings.mongo_configured ?? false}
        mockDb={mockDb}
        pushToast={pushToast}
        onSaved={(updated) => setSettings((prev) => ({ ...prev, ...updated }))}
      />

      {/* Display-fields section — one editor per configurable surface. */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 mt-6">
        <div className="flex items-center gap-2 mb-1">
          <Columns3 className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">{SYSSET_FIELDS_TITLE}</h2>
        </div>
        <p className="text-[13px] text-slate-500 mb-4">{SYSSET_FIELDS_DESC}</p>

        <div className="space-y-6">
          {Object.values(DISPLAY_SURFACES).map((surface) => (
            <DisplayFieldsEditor
              key={surface.id}
              surface={surface}
              initialSelection={settings.display_fields?.[surface.id]}
              mockDb={mockDb}
              pushToast={pushToast}
            />
          ))}
        </div>
      </section>
    </div>
  );
}


/**
 * MongoUrlEditor — write-only MongoDB connection URL input.
 *
 * The URL is submitted to the backend, which connection-tests it before
 * storing. The frontend never reads the URL back — only the boolean
 * `mongo_configured` flag is returned (Secrets-Free Mandate).
 *
 * Props:
 *   initialConfigured  bool   Whether a URL is already stored server-side.
 *   mockDb             object MockDataContext instance.
 *   pushToast          fn     UIContext.pushToast.
 *   onSaved            fn     Called with the updated settings after success.
 */
function MongoUrlEditor({ initialConfigured, mockDb, pushToast, onSaved }) {
  const [configured, setConfigured] = useState(initialConfigured);
  const [url, setUrl]               = useState('');
  const [showUrl, setShowUrl]       = useState(false);
  const [saving, setSaving]         = useState(false);
  // Show the input either when not yet configured or after the admin
  // explicitly clicks "update".
  const [editing, setEditing]       = useState(!initialConfigured);

  async function handleSave() {
    if (!url.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await updateMongoUrl(url.trim(), mockDb);
      setConfigured(true);
      setUrl('');
      setEditing(false);
      onSaved(updated);
      pushToast({ variant: 'success', message: SYSSET_MONGO_TOAST_OK });
    } catch (err) {
      const { message } = normalizeError(err);
      pushToast({ variant: 'error', message: SYSSET_MONGO_TOAST_ERROR(message) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 mt-6"
      data-testid="mongo-url-editor"
    >
      <div className="flex items-center gap-2 mb-1">
        <Link2 className="w-4 h-4 text-slate-700" />
        <h2 className="text-sm font-semibold text-slate-900">{SYSSET_MONGO_TITLE}</h2>
        {configured && (
          <span className="ms-auto inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {SYSSET_MONGO_CONFIGURED_BADGE}
          </span>
        )}
        {!configured && (
          <span className="ms-auto text-[11px] text-slate-400">
            {SYSSET_MONGO_NOT_CONFIGURED}
          </span>
        )}
      </div>
      <p className="text-[13px] text-slate-500 mb-4">{SYSSET_MONGO_DESC}</p>

      {configured && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[13px] text-slate-500 underline hover:text-slate-900"
        >
          {SYSSET_MONGO_UPDATE_PROMPT}
        </button>
      )}

      {editing && (
        <div className="space-y-3">
          <div>
            <label className="block text-[13px] text-slate-700 mb-1">
              {SYSSET_MONGO_URL_LABEL}
            </label>
            <div className="relative">
              <input
                type={showUrl ? 'text' : 'password'}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={SYSSET_MONGO_URL_PLACEHOLDER}
                data-testid="mongo-url-input"
                autoComplete="off"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 pe-10 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowUrl((v) => !v)}
                className="absolute inset-y-0 end-0 flex items-center px-3 text-slate-400 hover:text-slate-700"
                aria-label={showUrl ? 'הסתר' : 'הצג'}
              >
                {showUrl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            {configured && (
              <button
                type="button"
                onClick={() => { setEditing(false); setUrl(''); }}
                className="text-[13px] text-slate-500 hover:text-slate-900"
              >
                {SYSSET_BTN_BACK}
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!url.trim() || saving}
              data-testid="mongo-url-save"
              className={[
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
                !url.trim() || saving
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-slate-900 text-white hover:bg-slate-800',
              ].join(' ')}
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" />{SYSSET_MONGO_BTN_TESTING}</>
                : <><Link2 className="w-4 h-4" />{SYSSET_MONGO_BTN_TEST}</>}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}


/**
 * DisplayFieldsEditor — toggle + reorder the columns shown by one surface.
 * Pure config (catalog keys + labels); the selection persists via
 * updateDisplayFields and takes effect on the surface immediately.
 */
function DisplayFieldsEditor({ surface, initialSelection, mockDb, pushToast }) {
  const catalogKeys = surface.columns.map((c) => c.key);
  const labelOf = useMemo(
    () => Object.fromEntries(surface.columns.map((c) => [c.key, c.label])),
    [surface],
  );

  const _initial = () => {
    const known = Array.isArray(initialSelection)
      ? initialSelection.filter((k) => catalogKeys.includes(k))
      : null;
    if (known && known.length) {
      const rest = catalogKeys.filter((k) => !known.includes(k));
      return { order: [...known, ...rest], visible: new Set(known) };
    }
    return {
      order: [...catalogKeys],
      visible: new Set(surface.columns.filter((c) => c.default).map((c) => c.key)),
    };
  };

  const [{ order, visible }, setState] = useState(_initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggle = (key) => {
    setState((s) => {
      const v = new Set(s.visible);
      v.has(key) ? v.delete(key) : v.add(key);
      return { ...s, visible: v };
    });
    setDirty(true);
  };

  const move = (idx, delta) => {
    setState((s) => {
      const next = [...s.order];
      const j = idx + delta;
      if (j < 0 || j >= next.length) return s;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...s, order: next };
    });
    setDirty(true);
  };

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const fields = order.filter((k) => visible.has(k));
      await updateDisplayFields(surface.id, fields, mockDb);
      pushToast({ variant: 'success', message: SYSSET_FIELDS_TOAST_SAVED });
      setDirty(false);
    } catch (err) {
      const { message } = normalizeError(err);
      pushToast({ variant: 'error', message: SYSSET_FIELDS_TOAST_ERROR(message) });
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    const defaults = defaultFieldKeys(surface.id);
    setState({ order: [...catalogKeys], visible: new Set(defaults) });
    setDirty(true);
  }

  return (
    <div data-testid={`display-fields-${surface.id}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-slate-700">{surface.label}</h3>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700"
        >
          <RotateCcw className="w-3 h-3" />{SYSSET_FIELDS_RESET}
        </button>
      </div>

      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md">
        {order.map((key, idx) => (
          <li key={key} className="flex items-center gap-3 px-3 py-2"
              data-testid={`field-row-${surface.id}-${key}`}>
            <input
              type="checkbox"
              checked={visible.has(key)}
              onChange={() => toggle(key)}
              data-testid={`field-toggle-${surface.id}-${key}`}
              className="accent-slate-900"
            />
            <span className="text-sm text-slate-800 flex-1">{labelOf[key]}</span>
            <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                    aria-label={SYSSET_FIELDS_MOVE_UP}
                    className="text-slate-400 hover:text-slate-800 disabled:opacity-30">
              <ChevronUp className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => move(idx, 1)} disabled={idx === order.length - 1}
                    aria-label={SYSSET_FIELDS_MOVE_DOWN}
                    className="text-slate-400 hover:text-slate-800 disabled:opacity-30">
              <ChevronDown className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          data-testid={`display-fields-save-${surface.id}`}
          className={[
            'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
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
    </div>
  );
}
