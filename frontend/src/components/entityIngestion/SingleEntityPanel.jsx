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
  ENTITY_FIELD_FIRST_NAME, ENTITY_FIELD_LAST_NAME,
  ENTITY_FIELD_RELATION, ENTITY_FIELD_TARGET, ENTITY_FIELD_STRONG_ID,
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

// Operator-creatable subset of Entity.entity_type. Kept in sync with the
// backend's `interfaces/relation_types.py::AssociatedRelationType` — if
// the backend's vocabulary changes, this list must update too.
const RELATION_OPTIONS = [
  { value: 'family',    label: ENTITY_OPTION_FAMILY },
  { value: 'friend',    label: ENTITY_OPTION_FRIEND },
  { value: 'colleague', label: ENTITY_OPTION_COLLEAGUE },
  { value: 'spouse',    label: ENTITY_OPTION_SPOUSE },
];

const EMPTY_FORM = {
  firstName:        '',
  lastName:         '',
  relation:         'family',     // sensible default — most common pick
  targetId:         '',
  strongIdentifier: '',
};

export default function SingleEntityPanel({ active }) {
  const mockDb = useMockData();
  const {
    closeEntityIngestionModal,
    openPhoneIngestionWithPreset,
    pushToast,
  } = useUI();

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

  // All root targets — the entities the operator can attach a new
  // person to. Defined as entity_type='target' AND target_entity_id is
  // null. UAT round-3: the previous two-dropdown UX (client → target)
  // was redundant because picking a target IMPLIES the client. We now
  // render a single grouped picker (`<optgroup>` per client) — the
  // operator sees every target with its owning client as the group
  // header, and picks one in one click.
  const rootTargets = useMemo(
    () => mockDb.entities.filter(
      (e) => e.entity_type === 'target' && e.target_entity_id == null,
    ),
    [mockDb.entities],
  );

  // Group root targets by client for the <optgroup> structure.
  const targetsByClient = useMemo(() => {
    const groups = new Map();
    for (const t of rootTargets) {
      const cid = t.client_id;
      if (cid == null) continue;
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid).push(t);
    }
    // Stable order: by client_id ascending so the dropdown is reproducible.
    return Array.from(groups.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([cid, targets]) => {
        const match = mockDb.clients.find((c) => String(c.id) === String(cid));
        return {
          clientId:    cid,
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
    if (!form.firstName.trim()) next.firstName = ENTITY_FIELD_REQUIRED(ENTITY_FIELD_FIRST_NAME);
    if (!form.relation)         next.relation  = ENTITY_FIELD_REQUIRED(ENTITY_FIELD_RELATION);
    if (form.targetId === '')   next.targetId  = ENTITY_FIELD_REQUIRED(ENTITY_FIELD_TARGET);
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    // UAT round-3: strong_identifier moved to a first-class column on
    // Entity. Send as a top-level payload field; empty values get
    // dropped server-side.
    const sid = form.strongIdentifier.trim();
    const payload = {
      first_name:        form.firstName.trim(),
      last_name:         form.lastName.trim() || null,
      relation_type:     form.relation,
      target_entity_id:  Number(form.targetId),
      ...(sid ? { strong_identifier: sid } : {}),
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
      clientId:       createdEntity.client_id,
    });
  };

  // ===========================================================================
  // SUCCESS state — render after a successful submit. Shows the friction-free
  // CTA and a dismiss button. Operator can either chain into phone ingestion
  // or close out.
  // ===========================================================================
  if (createdEntity) {
    const fullName = [createdEntity.first_name, createdEntity.last_name]
      .filter(Boolean)
      .join(' ');
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
      {/* Name row — first + last side by side */}
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="entity-first-name"
          label={ENTITY_FIELD_FIRST_NAME}
          required
          value={form.firstName}
          onChange={(v) => handleChange('firstName', v)}
          error={errors.firstName}
        />
        <Field
          id="entity-last-name"
          label={ENTITY_FIELD_LAST_NAME}
          value={form.lastName}
          onChange={(v) => handleChange('lastName', v)}
        />
      </div>

      {/* Relation dropdown */}
      <SelectField
        id="entity-relation"
        label={ENTITY_FIELD_RELATION}
        required
        value={form.relation}
        onChange={(v) => handleChange('relation', v)}
        error={errors.relation}
      >
        {RELATION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </SelectField>

      {/* Optional "strong identifier" — non-DB external id. Stored
          inside extra_data on the backend; an empty value is dropped. */}
      <Field
        id="entity-strong-id"
        label={ENTITY_FIELD_STRONG_ID}
        value={form.strongIdentifier}
        onChange={(v) => handleChange('strongIdentifier', v)}
      />

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
          <optgroup key={String(group.clientId)} label={group.clientLabel}>
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
