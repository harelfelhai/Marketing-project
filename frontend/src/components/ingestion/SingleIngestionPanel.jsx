/**
 * SingleIngestionPanel — UAT round-3 rewrite.
 *
 * The form now collects only what the operator actually needs:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │ מספר טלפון  [LTR input, digits accepted]            │
 *   │                                                      │
 *   │ קישור לישות:                                          │
 *   │   ◉ ישות קיימת   ◯ ישות חדשה   ◯ מעטפת כללית         │
 *   │                                                      │
 *   │ [mode-specific subform expands here]                 │
 *   │                                                      │
 *   │ סיבת הצפה  [textarea, free text]                      │
 *   └─────────────────────────────────────────────────────┘
 *
 * Submit flow per mode:
 *   - existing: POST /phones/quick { phone, entity_id, reason }
 *   - new:      POST /entities (mint named entity) → POST /phones/quick
 *   - envelope: POST /entities/envelope (mint nameless entity) →
 *               POST /phones/quick
 *
 * On success → swap to a confirmation card carrying the inline
 * NotificationOptInPanel (same UX pattern as before).
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Check, Loader2, Upload } from 'lucide-react';

import { createEntity, createEnvelopeEntity, quickAttachPhone } from '../../api/entityApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import { useAuth }     from '../../contexts/MockAuthContext';
import NotificationOptInPanel from '../notifications/NotificationOptInPanel';
import { CLIENT_REGISTRY, getClientById } from '../../config/clientRegistry';
import {
  INGEST_MODAL_BTN_CANCEL, INGEST_MODAL_BTN_SUBMIT, INGEST_MODAL_BTN_SUBMITTING,
  INGEST_TOAST_SUCCESS, INGEST_TOAST_ERROR,
  INGEST_FIELD_REQUIRED,
  ENTITY_SUCCESS_DISMISS,
  ENTITY_OPTION_FAMILY, ENTITY_OPTION_FRIEND,
  ENTITY_OPTION_COLLEAGUE, ENTITY_OPTION_SPOUSE,
  INGEST_FIELD_PHONE, INGEST_FIELD_REASON,
  INGEST_MODE_LABEL,
  INGEST_MODE_EXISTING, INGEST_MODE_NEW, INGEST_MODE_ENVELOPE,
  INGEST_PICK_ENTITY, INGEST_PICK_CLIENT, INGEST_PICK_TARGET,
  INGEST_NEW_FIRST, INGEST_NEW_LAST, INGEST_NEW_RELATION,
  INGEST_ERR_PHONE_DIGITS, INGEST_ERR_PICK_ENTITY,
  INGEST_ERR_PICK_CLIENT, INGEST_ERR_PICK_TARGET,
} from '../../config/strings.he';


const RELATION_OPTIONS = [
  { value: 'family',    label: ENTITY_OPTION_FAMILY },
  { value: 'friend',    label: ENTITY_OPTION_FRIEND },
  { value: 'colleague', label: ENTITY_OPTION_COLLEAGUE },
  { value: 'spouse',    label: ENTITY_OPTION_SPOUSE },
];


const EMPTY_FORM = {
  phoneNumber:     '',
  reason:          '',
  mode:            'existing',         // 'existing' | 'new' | 'envelope'
  // existing-mode picker
  existingEntityId: '',
  // new-mode subform
  newFirstName:    '',
  newLastName:     '',
  newRelation:     'family',
  newTargetId:     '',
  // envelope-mode subform
  envelopeClientId: '',
};


export default function SingleIngestionPanel({ active }) {
  const mockDb = useMockData();
  const { closeIngestionModal, pushToast, phoneIngestionPreset } = useUI();
  const { personalizationActive, user } = useAuth();

  const [form, setForm]               = useState(EMPTY_FORM);
  const [errors, setErrors]           = useState({});
  const [submitting, setSubmitting]   = useState(false);
  const [ingestedPhone, setIngestedPhone] = useState(null);

  // Reset on tab activation (mirrors the previous SingleIngestionPanel
  // contract). Preset values from the friction-free entity→phone chain
  // are still honored — when present, we land in "existing" mode with
  // that target entity preselected.
  useEffect(() => {
    if (!active) return;
    setIngestedPhone(null);
    setErrors({});
    setForm(() => {
      const next = { ...EMPTY_FORM };
      if (phoneIngestionPreset?.targetEntityId) {
        next.mode = 'existing';
        next.existingEntityId = String(phoneIngestionPreset.targetEntityId);
      }
      return next;
    });
  }, [active, phoneIngestionPreset]);

  // ----- Derived target lists -----
  const personalizationClientIds =
    personalizationActive && user?.managed_client_ids?.length
      ? new Set(user.managed_client_ids.map(String))
      : null;

  // Visible entities for the "existing" picker AND the "new" target
  // picker. Filtered by personalization (when the toggle is on) and
  // excludes soft-deleted rows.
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

  // Root targets (entity_type='target', no parent) — these are the
  // valid candidates for the "new entity's" target_entity_id.
  const rootTargets = useMemo(
    () => visibleEntities.filter(
      (e) => e.relation_type === 'primary' && e.target_entity_id == null,
    ),
    [visibleEntities],
  );

  // Group entities by client for the grouped <optgroup> picker.
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
        clientId:   cid,
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
        clientId:   cid,
        clientLabel: getClientById(cid)?.name || `Client ${cid}`,
        targets:    list,
      }));
  }, [rootTargets]);

  // UAT round-3 fix: envelope picker shows EVERY registered client
  // from CLIENT_REGISTRY — not just those with existing entities.
  // Envelopes don't need a pre-existing root target. Personalization
  // still narrows the list when the toggle is on.
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
    // Phone — digits only (with optional +). The backend's bulk regex
    // is the authoritative gate but we surface the same check here
    // so the operator gets immediate feedback.
    const cleaned = form.phoneNumber.replace(/[^\d+]/g, '');
    if (!cleaned || !/^\+?\d+$/.test(cleaned)) {
      next.phoneNumber = INGEST_ERR_PHONE_DIGITS;
    }

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
      const parts = [form.newFirstName.trim(), form.newLastName.trim()].filter(Boolean);
      const created = await createEntity({
        full_name:        parts.join(' ') || null,
        relation_type:    form.newRelation,
        target_entity_id: form.newTargetId,
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

      const cleaned = form.phoneNumber.replace(/[^\d+]/g, '');
      const created = await quickAttachPhone({
        phone_number:     cleaned,
        entity_id:        entityId,
      }, mockDb);

      pushToast({ variant: 'success', message: INGEST_TOAST_SUCCESS });
      setIngestedPhone(created);
    } catch (err) {
      pushToast({ variant: 'error', message: INGEST_TOAST_ERROR(err?.message || 'error') });
    } finally {
      setSubmitting(false);
    }
  };

  // -----------------------------------------------------------------
  // SUCCESS state
  // -----------------------------------------------------------------
  if (ingestedPhone) {
    return (
      <div className="space-y-4" data-testid="phone-ingest-success-panel">
        <div className="flex items-start gap-3 rounded-md bg-emerald-50 border border-emerald-200 p-4">
          <Check className="w-5 h-5 mt-0.5 text-emerald-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">
              {INGEST_TOAST_SUCCESS}
            </p>
          </div>
        </div>

        <NotificationOptInPanel
          contextKind="phone"
          contextId={ingestedPhone.id}
        />

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={closeIngestionModal}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
            data-testid="phone-ingest-success-dismiss"
          >
            {ENTITY_SUCCESS_DISMISS}
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // FORM state
  // -----------------------------------------------------------------
  return (
    <div className="space-y-4" data-testid="single-ingest-panel" dir="rtl">
      {/* Phone number */}
      <Field
        id="phone-number"
        label={INGEST_FIELD_PHONE}
        required
        value={form.phoneNumber}
        onChange={(v) => setField('phoneNumber', v)}
        error={errors.phoneNumber}
        dir="ltr"
      />

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
              data-testid={`ingest-mode-${key}`}
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
                name="ingest-mode"
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
          id="existing-entity"
          label={INGEST_PICK_ENTITY}
          required
          value={form.existingEntityId}
          onChange={(v) => setField('existingEntityId', v)}
          error={errors.existingEntityId}
          data-testid="ingest-existing-entity"
        >
          <option value="">בחר…</option>
          {entitiesByClient.map((group) => (
            <optgroup key={String(group.clientId)} label={group.clientLabel}>
              {group.entities.map((e) => {
                const display = e.full_name || `#${e.id} (${e.relation_type})`;
                return (
                  <option key={e.id} value={e.id}>{display}</option>
                );
              })}
            </optgroup>
          ))}
        </SelectField>
      )}

      {form.mode === 'new' && (
        <div className="rounded-md border border-slate-200 p-3 space-y-3 bg-slate-50/40" data-testid="ingest-new-form">
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="new-first-name"
              label={INGEST_NEW_FIRST}
              required
              value={form.newFirstName}
              onChange={(v) => setField('newFirstName', v)}
              error={errors.newFirstName}
            />
            <Field
              id="new-last-name"
              label={INGEST_NEW_LAST}
              value={form.newLastName}
              onChange={(v) => setField('newLastName', v)}
            />
          </div>
          <SelectField
            id="new-relation"
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
            id="new-target"
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
          id="envelope-client"
          label={INGEST_PICK_CLIENT}
          required
          value={form.envelopeClientId}
          onChange={(v) => setField('envelopeClientId', v)}
          error={errors.envelopeClientId}
          data-testid="ingest-envelope-client"
        >
          <option value="">בחר…</option>
          {clientOptions.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </SelectField>
      )}

      {/* Ingestion reason */}
      <label htmlFor="ingest-reason" className="block">
        <span className="text-xs font-medium text-slate-700">{INGEST_FIELD_REASON}</span>
        <textarea
          id="ingest-reason"
          value={form.reason}
          onChange={(e) => setField('reason', e.target.value)}
          rows={2}
          className="mt-1 block w-full px-2 py-1.5 rounded-md border border-slate-300 text-sm resize-none"
        />
      </label>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 pt-2">
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
          disabled={submitting}
          data-testid="single-ingest-submit"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {INGEST_MODAL_BTN_SUBMITTING}</>
            : <><Upload className="w-4 h-4" /> {INGEST_MODAL_BTN_SUBMIT}</>
          }
        </button>
      </div>
    </div>
  );
}


/* ===========================================================================
 * Local field primitives — inline copies kept small + dependency-free.
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
