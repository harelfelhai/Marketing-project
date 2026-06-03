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
  Link2, CheckCircle2, Eye, EyeOff, Search, ListChecks, X, Plus,
} from 'lucide-react';

import { useMockData } from '../contexts/MockDataContext';
import { useUI }       from '../contexts/UIContext';
import {
  getSystemSettings, updateSystemSettings, updateDisplayFields,
  updateDisplayLabels, updateFilterFields, updateCustomFilters,
  updateIngestionFields, updateMongoUrl, updateApiConfig, updateVocabulary,
} from '../api/systemApi';
import { normalizeError } from '../api/client';
import { DISPLAY_SURFACES, defaultFieldKeys } from '../config/displayFields';
import { FILTER_SURFACES, defaultFilterKeys } from '../config/filterFields';
import {
  SYSSET_TITLE, SYSSET_SUB, SYSSET_LOADING,
  SYSSET_DB_TITLE, SYSSET_DB_DESC, SYSSET_APPLIES_ON_RESTART,
  SYSSET_BACKEND_UNAVAILABLE, SYSSET_BACKEND_LABELS,
  SYSSET_BTN_SAVE, SYSSET_BTN_SAVING, SYSSET_BTN_BACK,
  SYSSET_TOAST_SAVED, SYSSET_TOAST_ERROR,
  SYSSET_FIELDS_TITLE, SYSSET_FIELDS_DESC, SYSSET_FIELDS_MOVE_UP,
  SYSSET_FIELDS_MOVE_DOWN, SYSSET_FIELDS_TOAST_SAVED, SYSSET_FIELDS_TOAST_ERROR,
  SYSSET_FIELDS_RESET, SYSSET_FIELDS_LABEL_PLACEHOLDER,
  SYSSET_MONGO_TITLE, SYSSET_MONGO_DESC, SYSSET_MONGO_URL_LABEL,
  SYSSET_MONGO_URL_PLACEHOLDER, SYSSET_MONGO_CONFIGURED_BADGE,
  SYSSET_MONGO_NOT_CONFIGURED, SYSSET_MONGO_BTN_TEST, SYSSET_MONGO_BTN_TESTING,
  SYSSET_MONGO_TOAST_OK, SYSSET_MONGO_TOAST_ERROR, SYSSET_MONGO_UPDATE_PROMPT,
  SYSSET_API_TITLE, SYSSET_API_DESC, SYSSET_API_BASE_URL_LABEL,
  SYSSET_API_BASE_URL_PLACEHOLDER, SYSSET_API_AUTH_HEADER_LABEL,
  SYSSET_API_AUTH_HEADER_PH, SYSSET_API_TOKEN_LABEL, SYSSET_API_TOKEN_PLACEHOLDER,
  SYSSET_API_TOKEN_KEEP_HINT, SYSSET_API_TABLES_HEADING, SYSSET_API_TABLE_PATH_PH,
  SYSSET_API_TABLE_ROWSPATH_PH, SYSSET_API_CONFIGURED_BADGE,
  SYSSET_API_NOT_CONFIGURED, SYSSET_API_BTN_TEST, SYSSET_API_BTN_TESTING,
  SYSSET_API_TOAST_OK, SYSSET_API_TOAST_ERROR,
  SYSSET_API_REQUIRED, SYSSET_API_TABLE_LABELS, SYSSET_API_TABLE_ORDER,
  API_TABLE_COLUMNS, SYSSET_API_GLOBAL_HEADING, SYSSET_API_BASIC_USER_PH,
  SYSSET_API_BASIC_PASS_PH, SYSSET_API_PASS_KEEP_HINT, SYSSET_API_GLOBAL_HEADERS,
  SYSSET_API_GLOBAL_QUERY, SYSSET_API_TIMEOUT_PH, SYSSET_API_ITEM_PATH_PH,
  SYSSET_API_COLUMNS_HEADING, SYSSET_API_THEIR_NAME_PH, SYSSET_API_EXTRA_MAP_ADD,
  SYSSET_API_EXTRA_MAP_HEADING,
  SYSSET_API_ADV_HEADING, SYSSET_API_METHODS_HEADING, SYSSET_API_PATHS_HEADING,
  SYSSET_API_BODYWRAP_PH, SYSSET_API_QUERY_HEADING, SYSSET_API_HEADERS_HEADING,
  SYSSET_API_PAGINATION_HEADING, SYSSET_API_PAGINATION_STYLE, SYSSET_API_PAGINATION_STYLES,
  SYSSET_API_KV_KEY_PH, SYSSET_API_KV_VAL_PH, SYSSET_API_KV_ADD, SYSSET_API_OPS,
  SYSSET_API_PREVIEW_HEADING, SYSSET_API_PREVIEW_HEADERS, SYSSET_API_PREVIEW_BODY,
  SYSSET_FILTER_FIELDS_TITLE, SYSSET_FILTER_FIELDS_DESC,
  SYSSET_FILTER_FIELDS_TOAST_SAVED, SYSSET_FILTER_FIELDS_TOAST_ERROR,
  SYSSET_CUSTOM_FILTERS_HEADING, SYSSET_CUSTOM_FILTERS_HINT,
  SYSSET_CUSTOM_ADD_BTN, SYSSET_CUSTOM_LABEL_PH, SYSSET_CUSTOM_FIELD_PH,
  SYSSET_CUSTOM_OPTIONS_PH, SYSSET_CUSTOM_WIDGET_TEXT, SYSSET_CUSTOM_WIDGET_SELECT,
  SYSSET_CUSTOM_REMOVE_ARIA, SYSSET_CUSTOM_EMPTY, SYSSET_CUSTOM_FIELD_REQUIRED,
  SYSSET_INGEST_FIELDS_TITLE, SYSSET_INGEST_FIELDS_DESC,
  SYSSET_INGEST_SURFACE_ENTITY, SYSSET_INGEST_SURFACE_PHONE,
  SYSSET_INGEST_ADD_BTN, SYSSET_INGEST_KEY_PH, SYSSET_INGEST_KEY_REQUIRED,
  SYSSET_INGEST_TOAST_SAVED, SYSSET_INGEST_TOAST_ERROR,
  SYSSET_VOCAB_TITLE, SYSSET_VOCAB_DESC, SYSSET_VOCAB_NAMES, SYSSET_VOCAB_ORDER,
  SYSSET_VOCAB_ADD_ITEM, SYSSET_VOCAB_PLACEHOLDER, SYSSET_VOCAB_REMOVE_ARIA,
  SYSSET_VOCAB_BTN_SAVE, SYSSET_VOCAB_BTN_SAVING,
  SYSSET_VOCAB_TOAST_SAVED, SYSSET_VOCAB_TOAST_ERROR,
  SYSSET_VOCAB_EMPTY, SYSSET_VOCAB_DUP, SYSSET_VOCAB_MOVE_UP, SYSSET_VOCAB_MOVE_DOWN,
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

      {/* MongoDB connection URL — only while MongoDB is the chosen backend. */}
      {selected === 'mongo' && (
        <MongoUrlEditor
          initialConfigured={settings.mongo_configured ?? false}
          mockDb={mockDb}
          pushToast={pushToast}
          onSaved={(updated) => setSettings((prev) => ({ ...prev, ...updated }))}
        />
      )}

      {/* External API backend — only while the API backend is chosen. */}
      {selected === 'api' && (
        <ApiBackendEditor
          initialConfig={settings.api_config ?? null}
          initialConfigured={settings.api_configured ?? false}
          mockDb={mockDb}
          pushToast={pushToast}
          onSaved={(updated) => setSettings((prev) => ({ ...prev, ...updated }))}
        />
      )}

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
              initialLabels={settings.display_labels?.[surface.id]}
              mockDb={mockDb}
              pushToast={pushToast}
            />
          ))}
        </div>
      </section>

      {/* Filter-fields section — one editor per filterable surface. */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 mt-6">
        <div className="flex items-center gap-2 mb-1">
          <Search className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">{SYSSET_FILTER_FIELDS_TITLE}</h2>
        </div>
        <p className="text-[13px] text-slate-500 mb-4">{SYSSET_FILTER_FIELDS_DESC}</p>

        <div className="space-y-6">
          {Object.values(FILTER_SURFACES).map((surface) => (
            <FilterFieldsEditor
              key={surface.id}
              surface={surface}
              initialSelection={settings.filter_fields?.[surface.id]}
              initialCustom={settings.custom_filters?.[surface.id]}
              mockDb={mockDb}
              pushToast={pushToast}
            />
          ))}
        </div>
      </section>

      {/* Dynamic ingestion-fields section — extra inputs on the add forms. */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 mt-6">
        <div className="flex items-center gap-2 mb-1">
          <Plus className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">{SYSSET_INGEST_FIELDS_TITLE}</h2>
        </div>
        <p className="text-[13px] text-slate-500 mb-4">{SYSSET_INGEST_FIELDS_DESC}</p>

        <div className="space-y-6">
          {[
            { id: 'entity', label: SYSSET_INGEST_SURFACE_ENTITY },
            { id: 'phone',  label: SYSSET_INGEST_SURFACE_PHONE },
          ].map((surface) => (
            <IngestionFieldsEditor
              key={surface.id}
              surface={surface}
              initialFields={settings.ingestion_fields?.[surface.id]}
              mockDb={mockDb}
              pushToast={pushToast}
            />
          ))}
        </div>
      </section>

      {/* Vocabulary section — operator-managed closed lists. */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 mt-6">
        <div className="flex items-center gap-2 mb-1">
          <ListChecks className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">{SYSSET_VOCAB_TITLE}</h2>
        </div>
        <p className="text-[13px] text-slate-500 mb-4">{SYSSET_VOCAB_DESC}</p>

        <div className="space-y-6">
          {SYSSET_VOCAB_ORDER.map((name) => (
            <VocabularyEditor
              key={name}
              name={name}
              initialItems={settings.vocabularies?.[name] || []}
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
 * VocabularyEditor — add / remove / reorder one operator-managed closed list.
 * Persists via updateVocabulary (PUT /system/settings/vocabulary/{name}) and
 * mirrors into MockDataContext so the controlled dropdowns update live.
 */
function VocabularyEditor({ name, initialItems, mockDb, pushToast }) {
  const [items, setItems]   = useState(() => [...initialItems]);
  const [draft, setDraft]   = useState('');
  const [dirty, setDirty]   = useState(false);
  const [saving, setSaving] = useState(false);

  const label = SYSSET_VOCAB_NAMES[name] || name;

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) {
      pushToast({ variant: 'error', message: SYSSET_VOCAB_DUP });
      return;
    }
    setItems((xs) => [...xs, v]);
    setDraft('');
    setDirty(true);
  };

  const remove = (v) => {
    setItems((xs) => xs.filter((x) => x !== v));
    setDirty(true);
  };

  const move = (idx, delta) => {
    setItems((xs) => {
      const next = [...xs];
      const j = idx + delta;
      if (j < 0 || j >= next.length) return xs;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setDirty(true);
  };

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await updateVocabulary(name, items, mockDb);
      // Mirror into the live context so dropdowns refresh without reload.
      mockDb.applyUpdateVocabulary?.(name, items);
      pushToast({ variant: 'success', message: SYSSET_VOCAB_TOAST_SAVED(label) });
      setDirty(false);
    } catch (err) {
      const { message } = normalizeError(err);
      pushToast({ variant: 'error', message: SYSSET_VOCAB_TOAST_ERROR(message) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid={`vocab-${name}`}>
      <h3 className="text-[13px] font-semibold text-slate-700 mb-2">{label}</h3>

      {items.length === 0 ? (
        <p className="text-xs text-slate-400 mb-2">{SYSSET_VOCAB_EMPTY}</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md mb-2">
          {items.map((v, idx) => (
            <li key={v} className="flex items-center gap-2 px-3 py-2"
                data-testid={`vocab-${name}-item-${v}`}>
              <span className="font-mono text-sm text-slate-800 flex-1 truncate" title={v}>{v}</span>
              <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                      aria-label={SYSSET_VOCAB_MOVE_UP}
                      className="text-slate-400 hover:text-slate-800 disabled:opacity-30">
                <ChevronUp className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1}
                      aria-label={SYSSET_VOCAB_MOVE_DOWN}
                      className="text-slate-400 hover:text-slate-800 disabled:opacity-30">
                <ChevronDown className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => remove(v)}
                      aria-label={SYSSET_VOCAB_REMOVE_ARIA(v)}
                      className="text-slate-400 hover:text-rose-600">
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={SYSSET_VOCAB_PLACEHOLDER}
          data-testid={`vocab-${name}-input`}
          className="flex-1 min-w-0 text-sm rounded-md border border-slate-200 px-2 py-1.5
                     focus:border-slate-400 outline-none"
        />
        <button type="button" onClick={add}
                data-testid={`vocab-${name}-add`}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5
                           text-sm text-slate-700 hover:bg-slate-50">
          <Plus className="w-4 h-4" />{SYSSET_VOCAB_ADD_ITEM}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          data-testid={`vocab-${name}-save`}
          className={[
            'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
            !dirty || saving
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-slate-900 text-white hover:bg-slate-800',
          ].join(' ')}
        >
          {saving
            ? <><Loader2 className="w-4 h-4 animate-spin" />{SYSSET_VOCAB_BTN_SAVING}</>
            : <><Save className="w-4 h-4" />{SYSSET_VOCAB_BTN_SAVE}</>}
        </button>
      </div>
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


/** KvEditor — edit a list of {k,v} pairs (headers / query params). */
function KvEditor({ rows, onChange, testid }) {
  const add = () => onChange([...rows, { k: '', v: '' }]);
  const set = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));
  return (
    <div data-testid={testid}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <input
            type="text" value={r.k} dir="ltr"
            onChange={(e) => set(i, { k: e.target.value })}
            placeholder={SYSSET_API_KV_KEY_PH}
            className="h-7 px-2 text-sm rounded-md border border-slate-300 font-mono min-w-[110px] grow"
          />
          <span className="text-slate-400">:</span>
          <input
            type="text" value={r.v} dir="ltr"
            onChange={(e) => set(i, { v: e.target.value })}
            placeholder={SYSSET_API_KV_VAL_PH}
            className="h-7 px-2 text-sm rounded-md border border-slate-300 font-mono min-w-[110px] grow"
          />
          <button type="button" onClick={() => remove(i)} aria-label={SYSSET_CUSTOM_REMOVE_ARIA}
                  className="text-slate-400 hover:text-rose-600 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800">
        <Plus className="w-3 h-3" />{SYSSET_API_KV_ADD}
      </button>
    </div>
  );
}

const _objToKv = (obj) => Object.entries(obj || {}).map(([k, v]) => ({ k, v: String(v) }));
const _kvToObj = (rows) => {
  const out = {};
  for (const { k, v } of rows) { const kk = (k || '').trim(); if (kk) out[kk] = v; }
  return out;
};

// --- Live request preview helpers (mirror backend repositories/api_repository) ---
const _DEFAULT_METHODS = { list: 'GET', get: 'GET', create: 'POST', update: 'PUT', delete: 'DELETE' };

const _paginationFirstParams = (p) => {
  if (!p || !p.style || p.style === 'none') return {};
  const n = (v, d) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : d; };
  if (p.style === 'page') return { [p.page_param || 'page']: n(p.start_page, 1), [p.size_param || 'per_page']: n(p.size, 100) };
  if (p.style === 'offset') return { [p.offset_param || 'offset']: n(p.start_offset, 0), [p.limit_param || 'limit']: n(p.size, 100) };
  return {};  // cursor: the first request carries no cursor
};

const _sampleValue = (col) => {
  if (['deleted_at', 'created_at', 'updated_at', 'last_seen_at', 'attempted_at', 'delivered_at'].includes(col)) return '2026-01-01T00:00:00+00:00';
  if (col === 'extra_data') return {};
  if (col === 'recipients') return [];
  if (col === 'score' || col === 'retry_count') return 0;
  if (col === 'active') return true;
  return '…';
};

/**
 * RequestPreview — render exactly what each operation's HTTP request becomes,
 * given the live (advanced) config for one table. Recomputes on every keystroke
 * so the admin can match it against their API docs.
 */
function RequestPreview({ tableKey, t, globals }) {
  const base = ((globals.baseUrl || '').trim() || '{base_url}').replace(/\/+$/, '');
  const path = ((t.path || '').trim() || tableKey).replace(/^\/+|\/+$/g, '');

  const opUrl = (op) => {
    const tmpl = (t.paths[op] || '').trim();
    if (tmpl) return `${base}/${tmpl.replace(/^\/+/, '')}`;
    if (op === 'list' || op === 'create') return `${base}/${path}`;
    return `${base}/${path}/{id}`;
  };
  const method = (op) => ((t.methods[op] || '').trim() || _DEFAULT_METHODS[op]).toUpperCase();
  const queryString = (op) => {
    const q = {};
    for (const { k, v } of globals.globalQuery) if ((k || '').trim()) q[k.trim()] = v;
    for (const { k, v } of t.query) if ((k || '').trim()) q[k.trim()] = v;
    if (op === 'list') Object.assign(q, _paginationFirstParams(t.pagination));
    const s = Object.entries(q).map(([k, v]) => `${k}=${v}`).join('&');
    return s ? `?${s}` : '';
  };

  const headerLines = [];
  if ((globals.authHeader || '').trim()) {
    headerLines.push(`${globals.authHeader.trim()}: ${globals.token || globals.hasToken ? '••••••' : '<token>'}`);
  }
  if ((globals.basicUser || '').trim()) {
    headerLines.push(`Authorization: Basic <base64(${globals.basicUser.trim()}:••••)>`);
  }
  for (const { k, v } of globals.globalHeaders) if ((k || '').trim()) headerLines.push(`${k.trim()}: ${v}`);
  for (const { k, v } of t.headers) if ((k || '').trim()) headerLines.push(`${k.trim()}: ${v}`);

  const cols = API_TABLE_COLUMNS[tableKey] || [];
  const body = {};
  for (const col of cols) { const name = (t.map[col] || '').trim() || col; body[name] = _sampleValue(col); }
  for (const { our, their } of t.extraMap) { const o = (our || '').trim(); if (o) body[(their || '').trim() || o] = '…'; }
  const wrapped = (t.body_wrapper || '').trim() ? { [t.body_wrapper.trim()]: body } : body;

  return (
    <div className="mt-2 rounded-md bg-slate-900 text-slate-100 p-2 text-[11px] leading-relaxed overflow-x-auto"
         dir="ltr" data-testid={`api-preview-${tableKey}`}>
      <div className="text-slate-400 mb-1" dir="rtl">{SYSSET_API_PREVIEW_HEADING}</div>
      {SYSSET_API_OPS.map((op) => (
        <div key={op}>
          <span className="text-slate-500 inline-block w-14">{op}</span>
          <span className="text-sky-400 inline-block w-16">{method(op)}</span>
          <span className="text-slate-200">{opUrl(op)}{queryString(op)}</span>
        </div>
      ))}
      {headerLines.length > 0 && (
        <div className="mt-1">
          <span className="text-slate-400" dir="rtl">{SYSSET_API_PREVIEW_HEADERS}:</span>
          {headerLines.map((h, i) => <div key={i} className="text-emerald-300">{h}</div>)}
        </div>
      )}
      <div className="mt-1">
        <span className="text-slate-400" dir="rtl">{SYSSET_API_PREVIEW_BODY}:</span>
        <pre className="text-amber-200 whitespace-pre-wrap m-0">{JSON.stringify(wrapped, null, 2)}</pre>
      </div>
    </div>
  );
}

/**
 * ApiBackendEditor — configure the HTTP/REST ("api") storage backend.
 *
 * A fully generic, code-free editor: a base URL + auth (bearer/header/basic) +
 * global headers/query params, plus per-table descriptors covering everything a
 * REST API may differ on — endpoint path, list/item response envelopes, a
 * per-column field map (each of OUR columns is listed so the admin knows what to
 * fill), per-operation HTTP method + path overrides, pagination (page/offset/
 * cursor), per-table headers/query params, and a request-body wrapper.
 *
 * Secrets (auth token + basic password) are write-only: the backend returns only
 * has_token / has_password; leaving those fields blank preserves the stored value.
 */
function ApiBackendEditor({ initialConfig, initialConfigured, mockDb, pushToast, onSaved }) {
  const _initTables = () => {
    const cfgTables = (initialConfig && initialConfig.tables) || {};
    const out = {};
    for (const key of SYSSET_API_TABLE_ORDER) {
      const desc = cfgTables[key] || {};
      const cols = API_TABLE_COLUMNS[key] || [];
      const fm = desc.field_map || {};
      const map = {};
      for (const col of cols) map[col] = typeof fm[col] === 'string' ? fm[col] : '';
      const extraMap = Object.entries(fm)
        .filter(([our]) => !cols.includes(our))
        .map(([our, their]) => ({ our, their }));
      const ops = {};
      const paths = {};
      for (const op of SYSSET_API_OPS) {
        ops[op] = (desc.methods || {})[op] || '';
        paths[op] = (desc.path_templates || {})[op] || '';
      }
      out[key] = {
        path: typeof desc.path === 'string' ? desc.path : key,
        rows_path: typeof desc.rows_path === 'string' ? desc.rows_path : '',
        item_path: typeof desc.item_path === 'string' ? desc.item_path : '',
        body_wrapper: typeof desc.body_wrapper === 'string' ? desc.body_wrapper : '',
        map,
        extraMap,
        methods: ops,
        paths,
        query: _objToKv(desc.query_params),
        headers: _objToKv(desc.headers),
        pagination: { style: 'none', ...(desc.pagination || {}) },
      };
    }
    return out;
  };

  const [configured, setConfigured] = useState(initialConfigured);
  const [baseUrl, setBaseUrl]       = useState(initialConfig?.base_url || '');
  const [authHeader, setAuthHeader] = useState(initialConfig?.auth?.header || 'Authorization');
  const [token, setToken]           = useState('');
  const [showToken, setShowToken]   = useState(false);
  const [hasToken, setHasToken]     = useState(Boolean(initialConfig?.auth?.has_token));
  const [basicUser, setBasicUser]   = useState(initialConfig?.auth?.username || '');
  const [password, setPassword]     = useState('');
  const [hasPassword, setHasPassword] = useState(Boolean(initialConfig?.auth?.has_password));
  const [timeout, setTimeoutS]      = useState(initialConfig?.timeout_s ? String(initialConfig.timeout_s) : '');
  const [globalHeaders, setGlobalHeaders] = useState(() => _objToKv(initialConfig?.headers));
  const [globalQuery, setGlobalQuery]     = useState(() => _objToKv(initialConfig?.query_params));
  const [tables, setTables]         = useState(_initTables);
  const [saving, setSaving]         = useState(false);

  const setTable  = (key, patch) => setTables((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  const setCol    = (key, col, v) => setTables((p) => ({ ...p, [key]: { ...p[key], map: { ...p[key].map, [col]: v } } }));
  const setMethod = (key, op, v) => setTables((p) => ({ ...p, [key]: { ...p[key], methods: { ...p[key].methods, [op]: v } } }));
  const setPathT  = (key, op, v) => setTables((p) => ({ ...p, [key]: { ...p[key], paths: { ...p[key].paths, [op]: v } } }));
  const setPag    = (key, patch) => setTables((p) => ({ ...p, [key]: { ...p[key], pagination: { ...p[key].pagination, ...patch } } }));
  const addExtra    = (key) => setTable(key, { extraMap: [...tables[key].extraMap, { our: '', their: '' }] });
  const updateExtra = (key, i, patch) => setTable(key, { extraMap: tables[key].extraMap.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const removeExtra = (key, i) => setTable(key, { extraMap: tables[key].extraMap.filter((_, idx) => idx !== i) });

  function buildPagination(p) {
    if (!p || !p.style || p.style === 'none') return null;
    const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
    const out = { style: p.style };
    if (p.style === 'page') {
      if (p.page_param) out.page_param = p.page_param;
      if (p.size_param) out.size_param = p.size_param;
      out.size = num(p.size, 100);
      if (p.start_page) out.start_page = num(p.start_page, 1);
      if (p.total_path) out.total_path = p.total_path;
    } else if (p.style === 'offset') {
      if (p.offset_param) out.offset_param = p.offset_param;
      if (p.limit_param) out.limit_param = p.limit_param;
      out.size = num(p.size, 100);
    } else if (p.style === 'cursor') {
      if (p.cursor_param) out.cursor_param = p.cursor_param;
      if (p.next_path) out.next_path = p.next_path;
    }
    return out;
  }

  async function handleSave() {
    if (saving) return;
    if (!baseUrl.trim()) {
      pushToast({ variant: 'error', message: SYSSET_API_REQUIRED });
      return;
    }
    const builtTables = {};
    for (const key of SYSSET_API_TABLE_ORDER) {
      const t = tables[key];
      const field_map = {};
      // Per-column mappings: only when the remote name differs from ours.
      for (const [col, their] of Object.entries(t.map)) {
        const th = (their || '').trim();
        if (th && th !== col) field_map[col] = th;
      }
      // Extra mappings (keys beyond the known columns).
      for (const { our, their } of t.extraMap) {
        const o = (our || '').trim();
        const th = (their || '').trim();
        if (o && th) field_map[o] = th;
      }
      const methods = {};
      const path_templates = {};
      for (const op of SYSSET_API_OPS) {
        if ((t.methods[op] || '').trim()) methods[op] = t.methods[op].trim();
        if ((t.paths[op] || '').trim()) path_templates[op] = t.paths[op].trim();
      }
      const entry = { path: t.path.trim(), rows_path: t.rows_path.trim(), field_map };
      if (t.item_path.trim()) entry.item_path = t.item_path.trim();
      if (t.body_wrapper.trim()) entry.body_wrapper = t.body_wrapper.trim();
      if (Object.keys(methods).length) entry.methods = methods;
      if (Object.keys(path_templates).length) entry.path_templates = path_templates;
      const qp = _kvToObj(t.query); if (Object.keys(qp).length) entry.query_params = qp;
      const hd = _kvToObj(t.headers); if (Object.keys(hd).length) entry.headers = hd;
      const pag = buildPagination(t.pagination); if (pag) entry.pagination = pag;
      builtTables[key] = entry;
    }

    const config = { base_url: baseUrl.trim(), tables: builtTables };
    const auth = {};
    if (authHeader.trim()) auth.header = authHeader.trim();
    if (token.trim()) auth.token = token.trim();
    if (basicUser.trim()) auth.username = basicUser.trim();
    if (password.trim()) auth.password = password.trim();
    if (Object.keys(auth).length) config.auth = auth;
    const gh = _kvToObj(globalHeaders); if (Object.keys(gh).length) config.headers = gh;
    const gq = _kvToObj(globalQuery); if (Object.keys(gq).length) config.query_params = gq;
    if (timeout.trim() && Number(timeout) > 0) config.timeout_s = Number(timeout);

    setSaving(true);
    try {
      const updated = await updateApiConfig(config, mockDb);
      setConfigured(true);
      if (token.trim()) setHasToken(true);
      if (password.trim()) setHasPassword(true);
      setToken(''); setPassword('');
      onSaved(updated);
      pushToast({ variant: 'success', message: SYSSET_API_TOAST_OK });
    } catch (err) {
      const { message } = normalizeError(err);
      pushToast({ variant: 'error', message: SYSSET_API_TOAST_ERROR(message) });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'h-8 px-2 text-sm rounded-md border border-slate-300 font-mono min-w-[120px] grow';

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 mt-6"
      data-testid="api-backend-editor"
    >
      <div className="flex items-center gap-2 mb-1">
        <Link2 className="w-4 h-4 text-slate-700" />
        <h2 className="text-sm font-semibold text-slate-900">{SYSSET_API_TITLE}</h2>
        {configured ? (
          <span className="ms-auto inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {SYSSET_API_CONFIGURED_BADGE}
          </span>
        ) : (
          <span className="ms-auto text-[11px] text-slate-400">{SYSSET_API_NOT_CONFIGURED}</span>
        )}
      </div>
      <p className="text-[13px] text-slate-500 mb-4">{SYSSET_API_DESC}</p>

      {/* Connection */}
      <div className="space-y-3">
        <div>
          <label className="block text-[13px] text-slate-700 mb-1">{SYSSET_API_BASE_URL_LABEL}</label>
          <input
            type="text" value={baseUrl} dir="ltr"
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={SYSSET_API_BASE_URL_PLACEHOLDER}
            data-testid="api-base-url-input"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="grow min-w-[160px]">
            <label className="block text-[13px] text-slate-700 mb-1">{SYSSET_API_AUTH_HEADER_LABEL}</label>
            <input
              type="text" value={authHeader} dir="ltr"
              onChange={(e) => setAuthHeader(e.target.value)}
              placeholder={SYSSET_API_AUTH_HEADER_PH}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
          <div className="grow min-w-[200px]">
            <label className="block text-[13px] text-slate-700 mb-1">{SYSSET_API_TOKEN_LABEL}</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'} value={token} dir="ltr"
                onChange={(e) => setToken(e.target.value)}
                placeholder={hasToken ? '••••••••' : SYSSET_API_TOKEN_PLACEHOLDER}
                autoComplete="off"
                data-testid="api-token-input"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono pe-10 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              <button
                type="button" tabIndex={-1}
                onClick={() => setShowToken((v) => !v)}
                className="absolute inset-y-0 end-0 flex items-center px-3 text-slate-400 hover:text-slate-700"
                aria-label={showToken ? 'הסתר' : 'הצג'}
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {hasToken && <p className="mt-1 text-[11px] text-slate-400">{SYSSET_API_TOKEN_KEEP_HINT}</p>}
          </div>
        </div>
      </div>

      {/* Global advanced connection settings */}
      <details className="mt-3">
        <summary className="text-[12px] text-slate-600 cursor-pointer select-none">{SYSSET_API_GLOBAL_HEADING}</summary>
        <div className="mt-2 space-y-3 ps-1">
          <div className="flex flex-wrap gap-3">
            <input
              type="text" value={basicUser} dir="ltr"
              onChange={(e) => setBasicUser(e.target.value)}
              placeholder={SYSSET_API_BASIC_USER_PH}
              className="h-8 px-2 text-sm rounded-md border border-slate-300 font-mono grow min-w-[140px]"
            />
            <div className="grow min-w-[160px]">
              <input
                type="password" value={password} dir="ltr"
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasPassword ? '••••••••' : SYSSET_API_BASIC_PASS_PH}
                autoComplete="off"
                className="w-full h-8 px-2 text-sm rounded-md border border-slate-300 font-mono"
              />
              {hasPassword && <p className="mt-1 text-[11px] text-slate-400">{SYSSET_API_PASS_KEEP_HINT}</p>}
            </div>
            <input
              type="number" value={timeout} dir="ltr" min="1"
              onChange={(e) => setTimeoutS(e.target.value)}
              placeholder={SYSSET_API_TIMEOUT_PH}
              className="h-8 px-2 text-sm rounded-md border border-slate-300 font-mono w-[180px]"
            />
          </div>
          <div>
            <span className="text-[11px] text-slate-500">{SYSSET_API_GLOBAL_HEADERS}</span>
            <KvEditor rows={globalHeaders} onChange={setGlobalHeaders} testid="api-global-headers" />
          </div>
          <div>
            <span className="text-[11px] text-slate-500">{SYSSET_API_GLOBAL_QUERY}</span>
            <KvEditor rows={globalQuery} onChange={setGlobalQuery} testid="api-global-query" />
          </div>
        </div>
      </details>

      {/* Per-table descriptors */}
      <h3 className="text-[13px] font-semibold text-slate-700 mt-5 mb-2">{SYSSET_API_TABLES_HEADING}</h3>
      <div className="space-y-3">
        {SYSSET_API_TABLE_ORDER.map((key) => {
          const t = tables[key];
          const cols = API_TABLE_COLUMNS[key] || [];
          return (
            <div key={key} className="rounded-md border border-slate-200 p-3"
                 data-testid={`api-table-${key}`}>
              <div className="text-[12px] font-medium text-slate-700 mb-2">
                {SYSSET_API_TABLE_LABELS[key] || key}
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                <input
                  type="text" value={t.path} dir="ltr"
                  onChange={(e) => setTable(key, { path: e.target.value })}
                  placeholder={SYSSET_API_TABLE_PATH_PH}
                  data-testid={`api-table-path-${key}`}
                  className={inputCls}
                />
                <input
                  type="text" value={t.rows_path} dir="ltr"
                  onChange={(e) => setTable(key, { rows_path: e.target.value })}
                  placeholder={SYSSET_API_TABLE_ROWSPATH_PH}
                  className={inputCls}
                />
                <input
                  type="text" value={t.item_path} dir="ltr"
                  onChange={(e) => setTable(key, { item_path: e.target.value })}
                  placeholder={SYSSET_API_ITEM_PATH_PH}
                  className={inputCls}
                />
              </div>

              {/* Our columns → their names (this is the field map) */}
              <p className="text-[11px] text-slate-500 mb-1">{SYSSET_API_COLUMNS_HEADING}</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-2">
                {cols.map((col) => (
                  <li key={col} className="flex items-center gap-2">
                    <code className="text-[12px] text-slate-700 min-w-[120px] truncate" title={col}>{col}</code>
                    <span className="text-slate-400">→</span>
                    <input
                      type="text" value={t.map[col]} dir="ltr"
                      onChange={(e) => setCol(key, col, e.target.value)}
                      placeholder={SYSSET_API_THEIR_NAME_PH}
                      data-testid={`api-map-${key}-${col}`}
                      className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono grow min-w-[80px]"
                    />
                  </li>
                ))}
              </ul>

              {/* Advanced per-table knobs */}
              <details>
                <summary className="text-[12px] text-slate-600 cursor-pointer select-none">{SYSSET_API_ADV_HEADING}</summary>
                <div className="mt-2 space-y-3 ps-1">
                  {/* Method overrides */}
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">{SYSSET_API_METHODS_HEADING}</p>
                    <div className="flex flex-wrap gap-2">
                      {SYSSET_API_OPS.map((op) => (
                        <input
                          key={op} type="text" value={t.methods[op]} dir="ltr"
                          onChange={(e) => setMethod(key, op, e.target.value)}
                          placeholder={op}
                          className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[96px]"
                        />
                      ))}
                    </div>
                  </div>
                  {/* Path template overrides */}
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">{SYSSET_API_PATHS_HEADING}</p>
                    <div className="space-y-1">
                      {SYSSET_API_OPS.map((op) => (
                        <div key={op} className="flex items-center gap-2">
                          <code className="text-[11px] text-slate-500 w-[52px]">{op}</code>
                          <input
                            type="text" value={t.paths[op]} dir="ltr"
                            onChange={(e) => setPathT(key, op, e.target.value)}
                            placeholder={`${t.path}${op === 'get' || op === 'update' || op === 'delete' ? '/{id}' : ''}`}
                            className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono grow"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Pagination */}
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">{SYSSET_API_PAGINATION_HEADING}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={t.pagination.style}
                        onChange={(e) => setPag(key, { style: e.target.value })}
                        data-testid={`api-pagination-style-${key}`}
                        className="h-7 px-2 text-sm rounded-md border border-slate-300 bg-white"
                      >
                        {Object.entries(SYSSET_API_PAGINATION_STYLES).map(([v, label]) => (
                          <option key={v} value={v}>{SYSSET_API_PAGINATION_STYLE}: {label}</option>
                        ))}
                      </select>
                      {t.pagination.style === 'page' && (
                        <>
                          <input type="text" dir="ltr" value={t.pagination.page_param || ''} onChange={(e) => setPag(key, { page_param: e.target.value })} placeholder="page" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[100px]" />
                          <input type="text" dir="ltr" value={t.pagination.size_param || ''} onChange={(e) => setPag(key, { size_param: e.target.value })} placeholder="per_page" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[100px]" />
                          <input type="number" dir="ltr" value={t.pagination.size || ''} onChange={(e) => setPag(key, { size: e.target.value })} placeholder="size" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[80px]" />
                        </>
                      )}
                      {t.pagination.style === 'offset' && (
                        <>
                          <input type="text" dir="ltr" value={t.pagination.offset_param || ''} onChange={(e) => setPag(key, { offset_param: e.target.value })} placeholder="offset" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[100px]" />
                          <input type="text" dir="ltr" value={t.pagination.limit_param || ''} onChange={(e) => setPag(key, { limit_param: e.target.value })} placeholder="limit" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[100px]" />
                          <input type="number" dir="ltr" value={t.pagination.size || ''} onChange={(e) => setPag(key, { size: e.target.value })} placeholder="size" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[80px]" />
                        </>
                      )}
                      {t.pagination.style === 'cursor' && (
                        <>
                          <input type="text" dir="ltr" value={t.pagination.cursor_param || ''} onChange={(e) => setPag(key, { cursor_param: e.target.value })} placeholder="cursor" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[110px]" />
                          <input type="text" dir="ltr" value={t.pagination.next_path || ''} onChange={(e) => setPag(key, { next_path: e.target.value })} placeholder="paging.next" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-[140px]" />
                        </>
                      )}
                    </div>
                  </div>
                  {/* Body wrapper */}
                  <input
                    type="text" value={t.body_wrapper} dir="ltr"
                    onChange={(e) => setTable(key, { body_wrapper: e.target.value })}
                    placeholder={SYSSET_API_BODYWRAP_PH}
                    className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono w-full"
                  />
                  {/* Per-table query params + headers */}
                  <div>
                    <span className="text-[11px] text-slate-500">{SYSSET_API_QUERY_HEADING}</span>
                    <KvEditor rows={t.query} onChange={(rows) => setTable(key, { query: rows })} testid={`api-table-query-${key}`} />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">{SYSSET_API_HEADERS_HEADING}</span>
                    <KvEditor rows={t.headers} onChange={(rows) => setTable(key, { headers: rows })} testid={`api-table-headers-${key}`} />
                  </div>
                  {/* Extra field mappings (keys beyond the known columns) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-slate-500">{SYSSET_API_EXTRA_MAP_HEADING}</span>
                      <button type="button" onClick={() => addExtra(key)}
                              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800">
                        <Plus className="w-3 h-3" />{SYSSET_API_EXTRA_MAP_ADD}
                      </button>
                    </div>
                    {t.extraMap.map((r, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1">
                        <input type="text" value={r.our} dir="ltr" onChange={(e) => updateExtra(key, idx, { our: e.target.value })} placeholder="our_field" className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono grow min-w-[100px]" />
                        <span className="text-slate-400">→</span>
                        <input type="text" value={r.their} dir="ltr" onChange={(e) => updateExtra(key, idx, { their: e.target.value })} placeholder={SYSSET_API_THEIR_NAME_PH} className="h-7 px-2 text-sm rounded-md border border-slate-200 font-mono grow min-w-[100px]" />
                        <button type="button" onClick={() => removeExtra(key, idx)} aria-label={SYSSET_CUSTOM_REMOVE_ARIA} className="text-slate-400 hover:text-rose-600 p-1">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </details>

              <RequestPreview
                tableKey={key}
                t={t}
                globals={{ baseUrl, authHeader, token, hasToken, basicUser, hasPassword, globalHeaders, globalQuery }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!baseUrl.trim() || saving}
          data-testid="api-config-save"
          className={[
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
            !baseUrl.trim() || saving
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-slate-900 text-white hover:bg-slate-800',
          ].join(' ')}
        >
          {saving
            ? <><Loader2 className="w-4 h-4 animate-spin" />{SYSSET_API_BTN_TESTING}</>
            : <><Link2 className="w-4 h-4" />{SYSSET_API_BTN_TEST}</>}
        </button>
      </div>
    </section>
  );
}


/**
 * DisplayFieldsEditor — toggle + reorder the columns shown by one surface.
 * Pure config (catalog keys + labels); the selection persists via
 * updateDisplayFields and takes effect on the surface immediately.
 */
function DisplayFieldsEditor({ surface, initialSelection, initialLabels, mockDb, pushToast }) {
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

  // Custom labels: key -> override string. Seeded from persisted overrides,
  // filtered to keys the catalog still knows. Empty string = use the default.
  const _initialLabels = () => {
    const out = {};
    if (initialLabels && typeof initialLabels === 'object') {
      for (const k of catalogKeys) {
        if (typeof initialLabels[k] === 'string') out[k] = initialLabels[k];
      }
    }
    return out;
  };

  const [{ order, visible }, setState] = useState(_initial);
  const [labels, setLabels] = useState(_initialLabels);
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

  const rename = (key, value) => {
    setLabels((m) => ({ ...m, [key]: value }));
    setDirty(true);
  };

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const fields = order.filter((k) => visible.has(k));
      // Persist visibility/order and label overrides. Only non-blank,
      // non-default overrides are sent; the rest fall back to catalog labels.
      const cleanLabels = {};
      for (const [k, v] of Object.entries(labels)) {
        const t = (v || '').trim();
        if (t && t !== labelOf[k]) cleanLabels[k] = t;
      }
      await updateDisplayFields(surface.id, fields, mockDb);
      await updateDisplayLabels(surface.id, cleanLabels, mockDb);
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
    setLabels({});
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
            <input
              type="text"
              value={labels[key] ?? ''}
              onChange={(e) => rename(key, e.target.value)}
              placeholder={SYSSET_FIELDS_LABEL_PLACEHOLDER(labelOf[key])}
              title={labelOf[key]}
              data-testid={`field-label-${surface.id}-${key}`}
              className="flex-1 min-w-0 text-sm text-slate-800 bg-transparent border border-transparent
                         hover:border-slate-200 focus:border-slate-400 focus:bg-white
                         rounded px-2 py-1 outline-none placeholder:text-slate-300"
            />
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


/** Normalize the persisted custom-filter list into editable rows. */
function _initialCustomRows(initialCustom) {
  if (!Array.isArray(initialCustom)) return [];
  return initialCustom
    .filter((d) => d && typeof d.key === 'string' && typeof d.field === 'string')
    .map((d) => ({
      key: d.key,
      label: typeof d.label === 'string' ? d.label : d.key,
      field: d.field,
      widget: d.widget === 'select' ? 'select' : 'text',
      options: Array.isArray(d.options)
        ? d.options.map((o) => o.value).filter(Boolean).join(', ')
        : '',
    }));
}

/**
 * FilterFieldsEditor — manage, in ONE place per surface, both the built-in
 * catalog toggles AND the admin-defined custom filters (including extra_data
 * key filters). Custom filters render in the same filter bar as the built-in
 * ones, so the editor keeps them together too — no separate UI region.
 */
function FilterFieldsEditor({ surface, initialSelection, initialCustom, mockDb, pushToast }) {
  const catalogKeys = surface.filters.map((f) => f.key);
  const labelOf = useMemo(
    () => Object.fromEntries(surface.filters.map((f) => [f.key, f.label])),
    [surface],
  );

  const _initial = () => {
    const known = Array.isArray(initialSelection)
      ? initialSelection.filter((k) => catalogKeys.includes(k))
      : null;
    if (known && known.length) return new Set(known);
    return new Set(surface.filters.filter((f) => f.default).map((f) => f.key));
  };

  const [visible, setVisible]       = useState(_initial);
  const [customRows, setCustomRows] = useState(() => _initialCustomRows(initialCustom));
  const [dirty, setDirty]           = useState(false);
  const [saving, setSaving]         = useState(false);

  const toggle = (key) => {
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setDirty(true);
  };

  const addCustom = () => {
    setCustomRows((prev) => [...prev, { key: '', label: '', field: '', widget: 'text', options: '' }]);
    setDirty(true);
  };
  const updateCustom = (idx, patch) => {
    setCustomRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const removeCustom = (idx) => {
    setCustomRows((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  async function save() {
    if (saving) return;
    // Build + validate custom descriptors. Each needs a label and a field;
    // the stable key is derived from the field path.
    const descriptors = [];
    for (const r of customRows) {
      const label = r.label.trim();
      const field = r.field.trim();
      if (!label || !field) {
        pushToast({ variant: 'error', message: SYSSET_CUSTOM_FIELD_REQUIRED });
        return;
      }
      const desc = { key: r.key || field, label, field, widget: r.widget };
      if (r.widget === 'select') {
        desc.options = r.options
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((v) => ({ value: v, label: v }));
      }
      descriptors.push(desc);
    }

    setSaving(true);
    try {
      const fields = catalogKeys.filter((k) => visible.has(k));
      if (catalogKeys.length) await updateFilterFields(surface.id, fields, mockDb);
      await updateCustomFilters(surface.id, descriptors, mockDb);
      pushToast({ variant: 'success', message: SYSSET_FILTER_FIELDS_TOAST_SAVED });
      setDirty(false);
    } catch (err) {
      const { message } = normalizeError(err);
      pushToast({ variant: 'error', message: SYSSET_FILTER_FIELDS_TOAST_ERROR(message) });
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setVisible(new Set(defaultFilterKeys(surface.id)));
    setDirty(true);
  }

  return (
    <div data-testid={`filter-fields-${surface.id}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-slate-700">{surface.label}</h3>
        {catalogKeys.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700"
          >
            <RotateCcw className="w-3 h-3" />{SYSSET_FIELDS_RESET}
          </button>
        )}
      </div>

      {catalogKeys.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md">
          {catalogKeys.map((key) => (
            <li key={key} className="flex items-center gap-3 px-3 py-2"
                data-testid={`filter-row-${surface.id}-${key}`}>
              <input
                type="checkbox"
                checked={visible.has(key)}
                onChange={() => toggle(key)}
                data-testid={`filter-toggle-${surface.id}-${key}`}
                className="accent-slate-900"
              />
              <span className="text-sm text-slate-800 flex-1">{labelOf[key]}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Custom filters — same surface, same card. */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] font-medium text-slate-600">{SYSSET_CUSTOM_FILTERS_HEADING}</span>
          <button
            type="button"
            onClick={addCustom}
            data-testid={`custom-filter-add-${surface.id}`}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
          >
            <Plus className="w-3 h-3" />{SYSSET_CUSTOM_ADD_BTN}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mb-2">{SYSSET_CUSTOM_FILTERS_HINT}</p>

        {customRows.length === 0 ? (
          <p className="text-[12px] text-slate-400 italic">{SYSSET_CUSTOM_EMPTY}</p>
        ) : (
          <ul className="space-y-2">
            {customRows.map((r, idx) => (
              <li key={idx} className="flex flex-wrap items-center gap-2"
                  data-testid={`custom-filter-row-${surface.id}-${idx}`}>
                <input
                  type="text"
                  value={r.label}
                  onChange={(e) => updateCustom(idx, { label: e.target.value })}
                  placeholder={SYSSET_CUSTOM_LABEL_PH}
                  className="h-8 px-2 text-sm rounded-md border border-slate-300 min-w-[120px] grow"
                />
                <input
                  type="text"
                  value={r.field}
                  onChange={(e) => updateCustom(idx, { field: e.target.value })}
                  placeholder={SYSSET_CUSTOM_FIELD_PH}
                  dir="ltr"
                  className="h-8 px-2 text-sm rounded-md border border-slate-300 min-w-[160px] grow"
                />
                <select
                  value={r.widget}
                  onChange={(e) => updateCustom(idx, { widget: e.target.value })}
                  className="h-8 px-2 text-sm rounded-md border border-slate-300 bg-white"
                >
                  <option value="text">{SYSSET_CUSTOM_WIDGET_TEXT}</option>
                  <option value="select">{SYSSET_CUSTOM_WIDGET_SELECT}</option>
                </select>
                {r.widget === 'select' && (
                  <input
                    type="text"
                    value={r.options}
                    onChange={(e) => updateCustom(idx, { options: e.target.value })}
                    placeholder={SYSSET_CUSTOM_OPTIONS_PH}
                    className="h-8 px-2 text-sm rounded-md border border-slate-300 min-w-[160px] grow"
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeCustom(idx)}
                  aria-label={SYSSET_CUSTOM_REMOVE_ARIA}
                  className="text-slate-400 hover:text-rose-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          data-testid={`filter-fields-save-${surface.id}`}
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


/**
 * IngestionFieldsEditor — manage the admin-defined dynamic input fields for one
 * ingestion surface ('entity' add-person / 'phone' add-number). Each field's
 * key is the extra_data key its captured value is stored under.
 */
function IngestionFieldsEditor({ surface, initialFields, mockDb, pushToast }) {
  const _rows = () => (Array.isArray(initialFields) ? initialFields : [])
    .filter((d) => d && typeof d.key === 'string')
    .map((d) => ({
      key: d.key,
      label: typeof d.label === 'string' ? d.label : '',
      widget: d.widget === 'select' ? 'select' : 'text',
      options: Array.isArray(d.options)
        ? d.options.map((o) => o.value).filter(Boolean).join(', ')
        : '',
    }));

  const [rows, setRows]     = useState(_rows);
  const [dirty, setDirty]   = useState(false);
  const [saving, setSaving] = useState(false);

  const addRow    = () => { setRows((p) => [...p, { key: '', label: '', widget: 'text', options: '' }]); setDirty(true); };
  const updateRow = (i, patch) => { setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); setDirty(true); };
  const removeRow = (i) => { setRows((p) => p.filter((_, idx) => idx !== i)); setDirty(true); };

  async function save() {
    if (saving) return;
    const fields = [];
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) { pushToast({ variant: 'error', message: SYSSET_INGEST_KEY_REQUIRED }); return; }
      const desc = { key, label: r.label.trim() || key, widget: r.widget };
      if (r.widget === 'select') {
        desc.options = r.options.split(',').map((s) => s.trim()).filter(Boolean)
          .map((v) => ({ value: v, label: v }));
      }
      fields.push(desc);
    }
    setSaving(true);
    try {
      await updateIngestionFields(surface.id, fields, mockDb);
      pushToast({ variant: 'success', message: SYSSET_INGEST_TOAST_SAVED });
      setDirty(false);
    } catch (err) {
      const { message } = normalizeError(err);
      pushToast({ variant: 'error', message: SYSSET_INGEST_TOAST_ERROR(message) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid={`ingestion-fields-${surface.id}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-slate-700">{surface.label}</h3>
        <button
          type="button"
          onClick={addRow}
          data-testid={`ingestion-field-add-${surface.id}`}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
        >
          <Plus className="w-3 h-3" />{SYSSET_INGEST_ADD_BTN}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic">{SYSSET_CUSTOM_EMPTY}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2"
                data-testid={`ingestion-field-row-${surface.id}-${i}`}>
              <input
                type="text" value={r.key} dir="ltr"
                onChange={(e) => updateRow(i, { key: e.target.value })}
                placeholder={SYSSET_INGEST_KEY_PH}
                className="h-8 px-2 text-sm rounded-md border border-slate-300 min-w-[180px] grow"
              />
              <input
                type="text" value={r.label}
                onChange={(e) => updateRow(i, { label: e.target.value })}
                placeholder={SYSSET_CUSTOM_LABEL_PH}
                className="h-8 px-2 text-sm rounded-md border border-slate-300 min-w-[120px] grow"
              />
              <select
                value={r.widget}
                onChange={(e) => updateRow(i, { widget: e.target.value })}
                className="h-8 px-2 text-sm rounded-md border border-slate-300 bg-white"
              >
                <option value="text">{SYSSET_CUSTOM_WIDGET_TEXT}</option>
                <option value="select">{SYSSET_CUSTOM_WIDGET_SELECT}</option>
              </select>
              {r.widget === 'select' && (
                <input
                  type="text" value={r.options}
                  onChange={(e) => updateRow(i, { options: e.target.value })}
                  placeholder={SYSSET_CUSTOM_OPTIONS_PH}
                  className="h-8 px-2 text-sm rounded-md border border-slate-300 min-w-[160px] grow"
                />
              )}
              <button
                type="button" onClick={() => removeRow(i)}
                aria-label={SYSSET_CUSTOM_REMOVE_ARIA}
                className="text-slate-400 hover:text-rose-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          data-testid={`ingestion-fields-save-${surface.id}`}
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
