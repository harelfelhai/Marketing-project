/**
 * SingleIngestionPanel — the original single-row ingestion form, lifted out
 * of IngestionModal so the modal can host multiple ingestion modes side-by-
 * side via tabs.
 *
 * The body of this component is intentionally a near-verbatim port of the
 * pre-E1-C IngestionModal contents — same schema fetch, same DynamicField
 * rendering, same validate-then-submit flow. The only structural change is
 * that the submit/cancel buttons are now rendered INLINE inside the panel
 * (the modal owns the tab strip, not a global footer).
 *
 * Validation:
 *   - required fields must be non-empty after trim().
 *   - json_blob: empty → {} (not an error); non-empty invalid JSON → inline error.
 */

import { useState, useEffect, useCallback } from 'react';
import { Check, Loader2, Upload } from 'lucide-react';

import DynamicField from './DynamicField';
import { getLeadFormSchema }  from '../../api/schemaApi';
import { ingestCircleMember } from '../../api/ingestionApi';
import { useMockData }        from '../../contexts/MockDataContext';
import { useUI }              from '../../contexts/UIContext';
import NotificationOptInPanel from '../notifications/NotificationOptInPanel';
import {
  INGEST_MODAL_LOADING, INGEST_MODAL_SCHEMA_ERROR,
  INGEST_MODAL_BTN_CANCEL, INGEST_MODAL_BTN_SUBMIT, INGEST_MODAL_BTN_SUBMITTING,
  INGEST_MODAL_REQUIRED_NOTE,
  INGEST_TOAST_SCHEMA_ERROR, INGEST_TOAST_SUCCESS, INGEST_TOAST_ERROR,
  INGEST_FIELD_REQUIRED, INGEST_FIELD_JSON_ERR,
  ENTITY_SUCCESS_DISMISS,    // 'סיום' — reused for the success state
} from '../../config/strings.he';

export default function SingleIngestionPanel({ active }) {
  const mockDb = useMockData();
  const { closeIngestionModal, pushToast, phoneIngestionPreset } = useUI();

  const [schema,        setSchema]        = useState(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [values,        setValues]        = useState({});
  const [fieldErrors,   setFieldErrors]   = useState({});
  const [submitting,    setSubmitting]    = useState(false);
  // Phase NOTIF-C — SUCCESS state. After a successful ingest the
  // form swaps to a success card carrying the inline NotificationOptInPanel
  // for the freshly-ingested phone. Operator dismisses manually
  // (mirrors the entity-success UX).
  const [ingestedPhone, setIngestedPhone] = useState(null);

  // Fetch the schema once per activation of this tab. Re-fetches if the
  // operator switches away and back (cheap; mock-mode has a 200ms delay).
  //
  // Phase E2-C — when the modal opens via the friction-free handoff from
  // the entity-success panel, `phoneIngestionPreset` carries the new
  // person's context. We pre-fill any schema field whose name matches
  // a preset key (entity_type currently; future-proof for client_id /
  // target_entity_id when the backend supports them on the schema).
  useEffect(() => {
    if (!active) return;
    setLoadingSchema(true);
    setValues({});
    setFieldErrors({});
    // Phase NOTIF-C — re-opening the tab always returns to the form,
    // not a stale success card from a previous ingestion.
    setIngestedPhone(null);
    getLeadFormSchema()
      .then((s) => {
        setSchema(s);
        const defaults = {};
        s.fields.forEach((f) => { defaults[f.name] = ''; });
        // Apply preset overrides. Only fields the schema actually
        // declares get a preset value — the rest stay empty.
        if (phoneIngestionPreset) {
          if ('entity_type' in defaults && phoneIngestionPreset.entityType) {
            defaults.entity_type = phoneIngestionPreset.entityType;
          }
        }
        setValues(defaults);
      })
      .catch(() => pushToast({ variant: 'error', message: INGEST_TOAST_SCHEMA_ERROR }))
      .finally(() => setLoadingSchema(false));
  }, [active, pushToast, phoneIngestionPreset]);

  const handleChange = useCallback((name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setFieldErrors((e) => ({ ...e, [name]: '' }));
  }, []);

  const validate = () => {
    const errors = {};
    let ok = true;

    for (const field of (schema?.fields || [])) {
      const raw = (values[field.name] ?? '').trim();

      if (field.required && !raw) {
        errors[field.name] = INGEST_FIELD_REQUIRED(field.label);
        ok = false;
        continue;
      }

      if (field.type === 'json_blob' && raw) {
        try {
          JSON.parse(raw);
        } catch {
          errors[field.name] = INGEST_FIELD_JSON_ERR;
          ok = false;
        }
      }
    }

    setFieldErrors(errors);
    return ok;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const payload = {};
    for (const field of (schema?.fields || [])) {
      const raw = (values[field.name] ?? '').trim();
      if (field.type === 'json_blob') {
        payload[field.name] = raw ? JSON.parse(raw) : {};
      } else {
        payload[field.name] = raw;
      }
    }

    setSubmitting(true);
    try {
      const created = await ingestCircleMember(payload, mockDb);
      pushToast({ variant: 'success', message: INGEST_TOAST_SUCCESS });
      // Phase NOTIF-C — instead of closing immediately, swap to a
      // success card so the operator can opt-in to alerts for this
      // phone. `created.id` is the new PhoneNumber.id (real + mock
      // modes both return it in IngestionResponse shape).
      setIngestedPhone(created);
    } catch (err) {
      pushToast({ variant: 'error', message: INGEST_TOAST_ERROR(err.message) });
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingSchema) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">{INGEST_MODAL_LOADING}</span>
      </div>
    );
  }

  if (!schema) {
    return (
      <p className="text-sm text-rose-600 py-6 text-center">
        {INGEST_MODAL_SCHEMA_ERROR}
      </p>
    );
  }

  // Phase NOTIF-C — SUCCESS state. Mirrors the SingleEntityPanel
  // success card structure (green confirmation + inline opt-in +
  // dismiss button). The previous behavior closed the modal
  // immediately on success; we now let the operator opt-in to
  // alerts about the new phone first.
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

  return (
    <div className="space-y-4">
      {schema.form_description && (
        <p className="text-sm text-slate-500">{schema.form_description}</p>
      )}

      {schema.fields.map((field) => (
        <DynamicField
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={handleChange}
          error={fieldErrors[field.name] || ''}
        />
      ))}

      <p className="text-[11px] text-slate-400">
        {INGEST_MODAL_REQUIRED_NOTE.split('*')[0]}
        <span className="text-rose-500 font-bold" aria-hidden="true">*</span>
        {INGEST_MODAL_REQUIRED_NOTE.split('*')[1]}
      </p>

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
