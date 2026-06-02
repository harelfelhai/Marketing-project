/**
 * SingleEntityPanel — Tab 1 of EntityIngestionModal (Phase E2-C).
 *
 * Form for adding ONE named individual associated with a root target.
 * On successful submission, swaps the form for the friction-free
 * success state that offers a CTA to immediately open the phone-
 * ingestion modal pre-filled with this person's context.
 *
 * State machine:
 *
 *   FORM  ── submit (validate ok) ──▶ SUBMITTING ──▶ SUCCESS
 *     ▲                                              │
 *     │                  cancel / dismiss            │
 *     └──────────────────────────────────────────────┘
 *
 * The target selector is the two-step pattern:
 *   1. Operator picks a client from clientRegistry.
 *   2. Operator picks a root target inside that client's partition.
 * The second dropdown is disabled until a client is chosen.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, UserPlus, Phone, Check } from 'lucide-react';

import { createEntity }         from '../../api/entityApi';
import { useMockData }          from '../../contexts/MockDataContext';
import { useUI }                from '../../contexts/UIContext';
import NotificationOptInPanel   from '../notifications/NotificationOptInPanel';
import {
  ENTITY_FIELD_FULL_NAME,
  ENTITY_FIELD_RELATION, ENTITY_FIELD_TARGET,
  ENTITY_PLACEHOLDER_PICK,
  ENTITY_TARGET_LIST_EMPTY,
  ENTITY_OPTION_FAMILY, ENTITY_OPTION_FRIEND,
  ENTITY_OPTION_COLLEAGUE, ENTITY_OPTION_SPOUSE,
  ENTITY_BTN_SUBMIT, ENTITY_BTN_SUBMITTING, ENTITY_BTN_CANCEL,
  ENTITY_FIELD_REQUIRED,
  ENTITY_SUCCESS_TITLE, ENTITY_SUCCESS_SUBLINE,
  ENTITY_SUCCESS_CTA, ENTITY_SUCCESS_DISMISS,
  ENTITY_TOAST_SUCCESS, ENTITY_TOAST_ERROR,
} from '../../config/strings.he';

// Token → Hebrew label map for relation types. The actual option list comes
// from the operator-managed `relation_types` vocabulary (single source of
// truth); unknown tokens fall back to the raw value. 'primary' is excluded
// here — this panel creates associated members, not roots.
const RELATION_LABELS = {
  family:    ENTITY_OPTION_FAMILY,
  friend:    ENTITY_OPTION_FRIEND,
  colleague: ENTITY_OPTION_COLLEAGUE,
  spouse:    ENTITY_OPTION_SPOUSE,
};

const EMPTY_FORM = {
  fullName: '',
  relation: 'family',
  targetId: '',
};

export default function SingleEntityPanel({ active }) {
  const mockDb = useMockData();
  const {
    closeEntityIngestionModal,
    openPhoneIngestionWithPreset,
    pushToast,
  } = useUI();

  // Relation options from the managed vocabulary (excluding the root-only
  // 'primary'); labels resolved via RELATION_LABELS with raw-token fallback.
  const relationOptions = (mockDb.vocabularies?.relation_types || [])
    .filter((v) => v !== 'primary')
    .map((v) => ({ value: v, label: RELATION_LABELS[v] || v }));

  const [form, setForm]               = useState(EMPTY_FORM);
  const [errors, setErrors]           = useState({});
  const [submitting, setSubmitting]   = useState(false);
  const [createdEntity, setCreatedEntity] = useState(null);  // SUCCESS state

  // Reset on activation (mirrors SingleIngestionPanel's reset-on-open).
  useEffect(() => {
    if (active) {
      setForm(EMPTY_FORM);
      setErrors({});
      setCreatedEntity(null);
    }
  }, [active]);

  const rootTargets = useMemo(
    () => mockDb.entities.filter(
      (e) => e.relation_type === 'primary' && e.target_entity_id == null,
    ),
    [mockDb.entities],
  );

  // Group root targets by client for the <optgroup> structure.
  const targetsByClient = useMemo(() => {
    const groups = new Map();
    for (const t of rootTargets) {
      const cid = t.root_entity_id;
      if (cid == null) continue;
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid).push(t);
    }
    // Stable order: by root_entity_id ascending so the dropdown is reproducible.
    return Array.from(groups.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([cid, targets]) => {
        const match = mockDb.clients.find((c) => String(c.id) === String(cid));
        return {
          rootEntityId:    cid,
          clientLabel: match?.name || `Client ${cid}`,
          targets,
        };
      });
  }, [rootTargets, mockDb.clients]);

  const handleChange = useCallback((field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: '' }));
  }, []);

  const validate = () => {
    const next = {};
    if (!form.fullName.trim()) next.fullName = ENTITY_FIELD_REQUIRED(ENTITY_FIELD_FULL_NAME);
    if (!form.relation)        next.relation = ENTITY_FIELD_REQUIRED(ENTITY_FIELD_RELATION);
    if (form.targetId === '')  next.targetId = ENTITY_FIELD_REQUIRED(ENTITY_FIELD_TARGET);
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const payload = {
      full_name:        form.fullName.trim() || null,
      relation_type:    form.relation,
      target_entity_id: form.targetId || null,
    };

    setSubmitting(true);
    try {
      const created = await createEntity(payload, mockDb);
      setCreatedEntity(created);
      pushToast({ variant: 'success', message: ENTITY_TOAST_SUCCESS });
    } catch (err) {
      pushToast({
        variant: 'error',
        message: ENTITY_TOAST_ERROR(err?.message || 'error'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Friction-free chain: close this modal, open the phone modal with
  // the new entity's context as a preset. The phone modal's
  // SingleIngestionPanel reads this on mount and pre-fills accordingly.
  const handleAddPhoneCta = () => {
    if (!createdEntity) return;
    openPhoneIngestionWithPreset({
      entityType:     createdEntity.relation_type,
      targetEntityId: createdEntity.target_entity_id,
      rootEntityId:       createdEntity.root_entity_id,
    });
  };

  // ===========================================================================
  // SUCCESS state — render after a successful submit. Shows the friction-free
  // CTA and a dismiss button. Operator can either chain into phone ingestion
  // or close out.
  // ===========================================================================
  if (createdEntity) {
    const fullName = createdEntity.full_name || '';
    return (
      <div className="space-y-4" data-testid="entity-success-panel">
        <div className="flex items-start gap-3 rounded-md bg-emerald-50 border border-emerald-200 p-4">
          <Check className="w-5 h-5 mt-0.5 text-emerald-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">
              {ENTITY_SUCCESS_TITLE}
            </p>
            <p className="text-sm text-emerald-800 mt-1">
              {ENTITY_SUCCESS_SUBLINE(fullName)}
            </p>
          </div>
        </div>

        {/* Phase NOTIF — inline opt-in for alerts about this person.
            Operator can subscribe to events on the newly-created
            entity without leaving the modal. Mock parity makes this
            functional end-to-end without a real backend. */}
        <NotificationOptInPanel
          contextKind="entity"
          contextId={createdEntity.id}
        />

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={closeEntityIngestionModal}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {ENTITY_SUCCESS_DISMISS}
          </button>
          <button
            type="button"
            onClick={handleAddPhoneCta}
            data-testid="entity-success-cta"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
          >
            <Phone className="w-4 h-4" />
            {ENTITY_SUCCESS_CTA}
          </button>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // FORM state.
  // ===========================================================================
  return (
    <div className="space-y-4">
      {/* Full name — single field (was first + last). */}
      <Field
        id="entity-full-name"
        label={ENTITY_FIELD_FULL_NAME}
        required
        value={form.fullName}
        onChange={(v) => handleChange('fullName', v)}
        error={errors.fullName}
      />

      {/* Relation dropdown */}
      <SelectField
        id="entity-relation"
        label={ENTITY_FIELD_RELATION}
        required
        value={form.relation}
        onChange={(v) => handleChange('relation', v)}
        error={errors.relation}
      >
        {relationOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </SelectField>

      {/* Single grouped target picker — clients are <optgroup> labels.
          UAT round-3: replaced the previous client→target two-step
          which was redundant (picking a target already implies the
          client). */}
      <SelectField
        id="entity-target"
        label={ENTITY_FIELD_TARGET}
        required
        value={form.targetId}
        onChange={(v) => handleChange('targetId', v)}
        error={errors.targetId}
      >
        <option value="">{ENTITY_PLACEHOLDER_PICK}</option>
        {targetsByClient.map((group) => (
          <optgroup key={String(group.rootEntityId)} label={group.clientLabel}>
            {group.targets.map((t) => (
              <option key={t.id} value={t.id}>{`#${t.id}`}</option>
            ))}
          </optgroup>
        ))}
      </SelectField>

      {targetsByClient.length === 0 && (
        <p className="text-xs text-amber-600">{ENTITY_TARGET_LIST_EMPTY}</p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={closeEntityIngestionModal}
          disabled={submitting}
          className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
        >
          {ENTITY_BTN_CANCEL}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {ENTITY_BTN_SUBMITTING}</>
            : <><UserPlus className="w-4 h-4" /> {ENTITY_BTN_SUBMIT}</>
          }
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small local field primitives. Kept inline rather than promoted to a shared
// component because they don't need the full DynamicField machinery — these
// are static-shape fields with no schema fetch.
// ---------------------------------------------------------------------------

function Field({ id, label, required, value, onChange, error }) {
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
        className={[
          'mt-1 block w-full h-9 px-2 rounded-md border text-sm',
          error ? 'border-rose-400' : 'border-slate-300',
        ].join(' ')}
      />
      {error && <span className="text-xs text-rose-600 mt-1 block">{error}</span>}
    </label>
  );
}

function SelectField({ id, label, required, value, onChange, error, children, disabled }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500 mx-0.5">*</span>}
      </span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={[
          'mt-1 block w-full h-9 px-2 rounded-md border text-sm bg-white',
          error ? 'border-rose-400' : 'border-slate-300',
          disabled ? 'opacity-60' : '',
        ].join(' ')}
      >
        {children}
      </select>
      {error && <span className="text-xs text-rose-600 mt-1 block">{error}</span>}
    </label>
  );
}
