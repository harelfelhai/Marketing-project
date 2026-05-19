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
import { Loader2, Upload } from 'lucide-react';

import DynamicField from './DynamicField';
import { getLeadFormSchema }  from '../../api/schemaApi';
import { ingestCircleMember } from '../../api/ingestionApi';
import { useMockData }        from '../../contexts/MockDataContext';
import { useUI }              from '../../contexts/UIContext';
import {
  INGEST_MODAL_LOADING, INGEST_MODAL_SCHEMA_ERROR,
  INGEST_MODAL_BTN_CANCEL, INGEST_MODAL_BTN_SUBMIT, INGEST_MODAL_BTN_SUBMITTING,
  INGEST_MODAL_REQUIRED_NOTE,
  INGEST_TOAST_SCHEMA_ERROR, INGEST_TOAST_SUCCESS, INGEST_TOAST_ERROR,
  INGEST_FIELD_REQUIRED, INGEST_FIELD_JSON_ERR,
} from '../../config/strings.he';

export default function SingleIngestionPanel({ active }) {
  const mockDb = useMockData();
  const { closeIngestionModal, pushToast } = useUI();

  const [schema,        setSchema]        = useState(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [values,        setValues]        = useState({});
  const [fieldErrors,   setFieldErrors]   = useState({});
  const [submitting,    setSubmitting]    = useState(false);

  // Fetch the schema once per activation of this tab. Re-fetches if the
  // operator switches away and back (cheap; mock-mode has a 200ms delay).
  useEffect(() => {
    if (!active) return;
    setLoadingSchema(true);
    setValues({});
    setFieldErrors({});
    getLeadFormSchema()
      .then((s) => {
        setSchema(s);
        const defaults = {};
        s.fields.forEach((f) => { defaults[f.name] = ''; });
        setValues(defaults);
      })
      .catch(() => pushToast({ variant: 'error', message: INGEST_TOAST_SCHEMA_ERROR }))
      .finally(() => setLoadingSchema(false));
  }, [active, pushToast]);

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
      await ingestCircleMember(payload, mockDb);
      pushToast({ variant: 'success', message: INGEST_TOAST_SUCCESS });
      closeIngestionModal();
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
