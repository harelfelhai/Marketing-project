/**
 * MultiTextIngestionPanel — UAT round-3 rewrite.
 *
 * Same field shape as the single panel, plus a textarea for the
 * tokenized phone list. All numbers in one submission attach to ONE
 * shared entity (existing / new / envelope) — that's the "bulk"
 * semantic the operator expects.
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │ מספרי טלפון  [LTR textarea, free separators]         │
 *   │                                                      │
 *   │ קישור לישות:                                          │
 *   │   ◉ ישות קיימת   ◯ ישות חדשה   ◯ מעטפת כללית         │
 *   │                                                      │
 *   │ [mode-specific subform]                              │
 *   │                                                      │
 *   │ סיבת הצפה  [free text]                                │
 *   └─────────────────────────────────────────────────────┘
 *
 * Submit flow:
 *   1. Resolve entity_id once (existing pick / POST /entities for
 *      new / POST /entities/envelope for envelope).
 *   2. Loop tokens → POST /phones/quick per number, all with the
 *      same entity_id.
 *   3. Aggregate into a BulkIngestSummary-shaped object the existing
 *      BulkResultPanel knows how to render.
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import { Loader2, Upload, RefreshCw } from 'lucide-react';

import { createEntity, createEnvelopeEntity, quickAttachPhone } from '../../api/entityApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import { useAuth }     from '../../contexts/MockAuthContext';
import { CLIENT_REGISTRY, getClientById } from '../../config/clientRegistry';
import BulkResultPanel from './BulkResultPanel';
import {
  BULK_TEXT_INTRO,
  BULK_TEXT_FIELD_NUMBERS, BULK_TEXT_FIELD_NUMBERS_HELP, BULK_TEXT_FIELD_NUMBERS_PLACE,
  BULK_TEXT_FIELD_REASON, BULK_TEXT_FIELD_REASON_PLACE,
  BULK_TEXT_TOKEN_COUNT,
  BULK_TEXT_BTN_SUBMIT, BULK_TEXT_BTN_SUBMITTING, BULK_TEXT_BTN_NEW_BATCH,
  BULK_TEXT_ERR_EMPTY_BODY,
  BULK_TEXT_TOAST_PARTIAL, BULK_TEXT_TOAST_ALL_OK, BULK_TEXT_TOAST_NONE_OK,
  BULK_TEXT_TOAST_ERROR,
  INGEST_MODAL_BTN_CANCEL,
  INGEST_MODE_LABEL,
  INGEST_MODE_EXISTING, INGEST_MODE_NEW, INGEST_MODE_ENVELOPE,
  INGEST_PICK_ENTITY, INGEST_PICK_CLIENT, INGEST_PICK_TARGET,
  INGEST_NEW_FIRST, INGEST_NEW_LAST, INGEST_NEW_RELATION,
  INGEST_ERR_PHONE_DIGITS, INGEST_ERR_PICK_ENTITY,
  INGEST_ERR_PICK_CLIENT, INGEST_ERR_PICK_TARGET,
  INGEST_FIELD_REQUIRED,
  ENTITY_OPTION_FAMILY, ENTITY_OPTION_FRIEND,
  ENTITY_OPTION_COLLEAGUE, ENTITY_OPTION_SPOUSE,
} from '../../config/strings.he';


const RELATION_OPTIONS = [
  { value: 'family',    label: ENTITY_OPTION_FAMILY },
  { value: 'friend',    label: ENTITY_OPTION_FRIEND },
  { value: 'colleague', label: ENTITY_OPTION_COLLEAGUE },
  { value: 'spouse',    label: ENTITY_OPTION_SPOUSE },
];

// Mirrors the backend's tokenize regex (services/bulk_ingestion.py).
const TOKEN_SPLIT_RE = /[,\s;]+/;


const EMPTY_FORM = {
  phoneNumbersRaw:  '',
  reason:           '',
  mode:             'existing',
  existingEntityId: '',
  newFirstName:     '',
  newLastName:      '',
  newRelation:      'family',
  newTargetId:      '',
  envelopeClientId: '',
};


export default function MultiTextIngestionPanel() {
  const mockDb = useMockData();
  const { closeIngestionModal, pushToast } = useUI();
  const { personalizationActive, user } = useAuth();

  const [form, setForm]             = useState(EMPTY_FORM);
  const [errors, setErrors]         = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary]       = useState(null);

  // Live token count using the same regex the backend uses.
  const tokenCount = useMemo(() => {
    if (!form.phoneNumbersRaw) return 0;
    return form.phoneNumbersRaw.split(TOKEN_SPLIT_RE).filter(Boolean).length;
  }, [form.phoneNumbersRaw]);

  // Reset when the operator dismisses the result panel.
  useEffect(() => {
    if (!summary) return;
    // result mode renders separately; we just leave the form alone.
  }, [summary]);

  // ----- Entity pickers (same derivation as SingleIngestionPanel) -----
  const personalizationClientIds =
    personalizationActive && user?.managed_client_ids?.length
      ? new Set(user.managed_client_ids.map(String))
      : null;

  const visibleEntities = useMemo(() => {
    return mockDb.entities.filter((e) => {
      if (e.deleted_at) return false;
      if (personalizationClientIds
          && !personalizationClientIds.has(String(e.client_id))) {
        return false;
      }
      return true;
    });
  }, [mockDb.entities, personalizationClientIds]);

  const rootTargets = useMemo(
    () => visibleEntities.filter(
      (e) => e.entity_type === 'target' && e.target_entity_id == null,
    ),
    [visibleEntities],
  );

  const entitiesByClient = useMemo(() => {
    const groups = new Map();
    for (const e of visibleEntities) {
      if (e.client_id == null) continue;
      if (!groups.has(e.client_id)) groups.set(e.client_id, []);
      groups.get(e.client_id).push(e);
    }
    return Array.from(groups.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([cid, list]) => ({
        clientId:    cid,
        clientLabel: getClientById(cid)?.name || `Client ${cid}`,
        entities:    list,
      }));
  }, [visibleEntities]);

  const targetsByClient = useMemo(() => {
    const groups = new Map();
    for (const t of rootTargets) {
      if (t.client_id == null) continue;
      if (!groups.has(t.client_id)) groups.set(t.client_id, []);
      groups.get(t.client_id).push(t);
    }
    return Array.from(groups.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([cid, list]) => ({
        clientId:    cid,
        clientLabel: getClientById(cid)?.name || `Client ${cid}`,
        targets:    list,
      }));
  }, [rootTargets]);

  // UAT round-3 fix: envelope picker shows EVERY registered client,
  // not just those with existing entities. Envelopes don't need a
  // pre-existing root target — they can be minted for any client.
  // Personalization still narrows the list when the toggle is on.
  const clientOptions = useMemo(() => {
    const pool = CLIENT_REGISTRY.filter((c) => {
      if (!personalizationClientIds) return true;
      return personalizationClientIds.has(String(c.id));
    });
    return pool
      .map((c) => ({ value: String(c.id), label: c.name || `Client ${c.id}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [personalizationClientIds]);

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = () => {
    const next = {};
    if (!form.phoneNumbersRaw.trim()) next.phoneNumbersRaw = BULK_TEXT_ERR_EMPTY_BODY;

    if (form.mode === 'existing') {
      if (!form.existingEntityId) next.existingEntityId = INGEST_ERR_PICK_ENTITY;
    } else if (form.mode === 'new') {
      if (!form.newFirstName.trim()) next.newFirstName = INGEST_FIELD_REQUIRED(INGEST_NEW_FIRST);
      if (!form.newTargetId)         next.newTargetId  = INGEST_ERR_PICK_TARGET;
    } else if (form.mode === 'envelope') {
      if (!form.envelopeClientId) next.envelopeClientId = INGEST_ERR_PICK_CLIENT;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const resolveEntityId = useCallback(async () => {
    if (form.mode === 'existing') return form.existingEntityId;
    if (form.mode === 'new') {
      const created = await createEntity({
        first_name:        form.newFirstName.trim(),
        last_name:         form.newLastName.trim() || null,
        relation_type:     form.newRelation,
        target_entity_id:  form.newTargetId,
      }, mockDb);
      return created.id;
    }
    if (form.mode === 'envelope') {
      const env = await createEnvelopeEntity(form.envelopeClientId, mockDb);
      return env.id;
    }
    return null;
  }, [form, mockDb]);

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const entityId = await resolveEntityId();
      if (entityId == null) throw new Error('Failed to resolve entity_id');

      // Tokenise client-side. Each token is one ingestion attempt.
      // Per-row failures land in failed_rows; the operator sees the
      // exact reason via BulkResultPanel.
      const tokens = form.phoneNumbersRaw
        .split(TOKEN_SPLIT_RE)
        .filter(Boolean);

      const reason = form.reason.trim() || null;
      const phone_ids = [];
      const failed_rows = [];
      let success_count = 0;

      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        const cleaned = tok.replace(/[^\d+]/g, '');
        if (!cleaned || !/^\+?\d+$/.test(cleaned)) {
          failed_rows.push({ row: i + 1, input: tok, error: INGEST_ERR_PHONE_DIGITS });
          continue;
        }
        try {
          const ph = await quickAttachPhone({
            phone_number:     cleaned,
            entity_id:        entityId,
            ingestion_reason: reason,
          }, mockDb);
          phone_ids.push(ph.id);
          success_count += 1;
        } catch (err) {
          failed_rows.push({ row: i + 1, input: tok, error: err?.message || 'error' });
        }
      }

      const aggregated = {
        success_count,
        failed_count: failed_rows.length,
        phone_ids,
        entity_ids:   [entityId],
        failed_rows,
        bulk_submission_id: null,
      };
      setSummary(aggregated);

      if (aggregated.failed_count > 0 && aggregated.success_count > 0) {
        pushToast({
          variant: 'warn',
          message: BULK_TEXT_TOAST_PARTIAL(aggregated.success_count, aggregated.failed_count),
        });
      } else if (aggregated.success_count > 0) {
        pushToast({
          variant: 'success',
          message: BULK_TEXT_TOAST_ALL_OK(aggregated.success_count),
        });
      } else {
        pushToast({
          variant: 'error',
          message: BULK_TEXT_TOAST_NONE_OK(aggregated.failed_count),
        });
      }
    } catch (err) {
      pushToast({ variant: 'error', message: BULK_TEXT_TOAST_ERROR(err?.message || 'error') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewBatch = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setSummary(null);
  };

  // -----------------------------------------------------------------
  // Result mode
  // -----------------------------------------------------------------
  if (summary) {
    return (
      <div className="space-y-5">
        <BulkResultPanel summary={summary} />
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={closeIngestionModal}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {INGEST_MODAL_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={handleNewBatch}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {BULK_TEXT_BTN_NEW_BATCH}
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // Form mode
  // -----------------------------------------------------------------
  return (
    <div className="space-y-4" dir="rtl" data-testid="multi-ingest-panel">
      <p className="text-sm text-slate-500">{BULK_TEXT_INTRO}</p>

      {/* Phone-numbers textarea */}
      <div>
        <label htmlFor="bulk-numbers" className="block text-xs font-semibold text-slate-700 mb-1">
          {BULK_TEXT_FIELD_NUMBERS}
          <span className="text-rose-500 ms-0.5" aria-hidden="true">*</span>
        </label>
        <textarea
          id="bulk-numbers"
          dir="ltr"
          rows={6}
          value={form.phoneNumbersRaw}
          onChange={(e) => setField('phoneNumbersRaw', e.target.value)}
          placeholder={BULK_TEXT_FIELD_NUMBERS_PLACE}
          maxLength={10000}
          className={[
            'w-full px-3 py-2 text-sm font-mono rounded-md border resize-none focus:outline-none focus:ring-2 focus:ring-slate-300',
            errors.phoneNumbersRaw ? 'border-rose-400' : 'border-slate-300',
          ].join(' ')}
        />
        <div className="flex items-center justify-between mt-1">
          <p className="text-[11px] text-slate-400">{BULK_TEXT_FIELD_NUMBERS_HELP}</p>
          <span
            data-testid="bulk-token-count"
            className="text-[11px] text-slate-500 font-mono tabular-nums"
          >
            {BULK_TEXT_TOKEN_COUNT(tokenCount)}
          </span>
        </div>
        {errors.phoneNumbersRaw && (
          <p role="alert" className="mt-1 text-xs text-rose-600">{errors.phoneNumbersRaw}</p>
        )}
      </div>

      {/* Mode selector */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-slate-700">{INGEST_MODE_LABEL}</legend>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'existing', label: INGEST_MODE_EXISTING },
            { key: 'new',      label: INGEST_MODE_NEW },
            { key: 'envelope', label: INGEST_MODE_ENVELOPE },
          ].map(({ key, label }) => (
            <label
              key={key}
              data-testid={`bulk-mode-${key}`}
              className={[
                'inline-flex items-center gap-2 h-8 px-3 rounded-full border text-sm cursor-pointer transition-colors',
                form.mode === key
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              <input
                type="radio"
                className="sr-only"
                name="bulk-ingest-mode"
                value={key}
                checked={form.mode === key}
                onChange={() => setField('mode', key)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Mode-specific subform */}
      {form.mode === 'existing' && (
        <SelectField
          id="bulk-existing-entity"
          label={INGEST_PICK_ENTITY}
          required
          value={form.existingEntityId}
          onChange={(v) => setField('existingEntityId', v)}
          error={errors.existingEntityId}
          data-testid="bulk-existing-entity"
        >
          <option value="">בחר…</option>
          {entitiesByClient.map((group) => (
            <optgroup key={String(group.clientId)} label={group.clientLabel}>
              {group.entities.map((e) => {
                const name = [e.extra_data?.first_name, e.extra_data?.last_name]
                  .filter(Boolean).join(' ');
                const display = name || `#${e.id} (${e.entity_type})`;
                return (
                  <option key={e.id} value={e.id}>{display}</option>
                );
              })}
            </optgroup>
          ))}
        </SelectField>
      )}

      {form.mode === 'new' && (
        <div className="rounded-md border border-slate-200 p-3 space-y-3 bg-slate-50/40">
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="bulk-new-first"
              label={INGEST_NEW_FIRST}
              required
              value={form.newFirstName}
              onChange={(v) => setField('newFirstName', v)}
              error={errors.newFirstName}
            />
            <Field
              id="bulk-new-last"
              label={INGEST_NEW_LAST}
              value={form.newLastName}
              onChange={(v) => setField('newLastName', v)}
            />
          </div>
          <SelectField
            id="bulk-new-relation"
            label={INGEST_NEW_RELATION}
            required
            value={form.newRelation}
            onChange={(v) => setField('newRelation', v)}
          >
            {RELATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </SelectField>
          <SelectField
            id="bulk-new-target"
            label={INGEST_PICK_TARGET}
            required
            value={form.newTargetId}
            onChange={(v) => setField('newTargetId', v)}
            error={errors.newTargetId}
          >
            <option value="">בחר…</option>
            {targetsByClient.map((group) => (
              <optgroup key={String(group.clientId)} label={group.clientLabel}>
                {group.targets.map((t) => (
                  <option key={t.id} value={t.id}>{`#${t.id}`}</option>
                ))}
              </optgroup>
            ))}
          </SelectField>
        </div>
      )}

      {form.mode === 'envelope' && (
        <SelectField
          id="bulk-envelope-client"
          label={INGEST_PICK_CLIENT}
          required
          value={form.envelopeClientId}
          onChange={(v) => setField('envelopeClientId', v)}
          error={errors.envelopeClientId}
          data-testid="bulk-envelope-client"
        >
          <option value="">בחר…</option>
          {clientOptions.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </SelectField>
      )}

      {/* Ingestion reason */}
      <label htmlFor="bulk-reason" className="block">
        <span className="text-xs font-medium text-slate-700">{BULK_TEXT_FIELD_REASON}</span>
        <textarea
          id="bulk-reason"
          value={form.reason}
          onChange={(e) => setField('reason', e.target.value)}
          rows={2}
          placeholder={BULK_TEXT_FIELD_REASON_PLACE}
          className="mt-1 block w-full px-2 py-1.5 rounded-md border border-slate-300 text-sm resize-none"
        />
      </label>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={closeIngestionModal}
          disabled={submitting}
          className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
        >
          {INGEST_MODAL_BTN_CANCEL}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || tokenCount === 0}
          data-testid="bulk-submit"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {BULK_TEXT_BTN_SUBMITTING}</>
            : <><Upload className="w-4 h-4" /> {BULK_TEXT_BTN_SUBMIT}</>
          }
        </button>
      </div>
    </div>
  );
}


/* ===========================================================================
 * Local field primitives — same shape as SingleIngestionPanel's.
 * ========================================================================= */

function Field({ id, label, required, value, onChange, error, dir }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500 mx-0.5">*</span>}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={dir}
        className={[
          'mt-1 block w-full h-9 px-2 rounded-md border text-sm',
          error ? 'border-rose-400' : 'border-slate-300',
        ].join(' ')}
      />
      {error && <span className="text-xs text-rose-600 mt-1 block">{error}</span>}
    </label>
  );
}

function SelectField({ id, label, required, value, onChange, error, children, 'data-testid': testId }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500 mx-0.5">*</span>}
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className={[
          'mt-1 block w-full h-9 px-2 rounded-md border text-sm bg-white',
          error ? 'border-rose-400' : 'border-slate-300',
        ].join(' ')}
      >
        {children}
      </select>
      {error && <span className="text-xs text-rose-600 mt-1 block">{error}</span>}
    </label>
  );
}
