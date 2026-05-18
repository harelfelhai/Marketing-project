/**
 * IngestionModal — dynamic ingestion form driven entirely by the schema
 * returned from getLeadFormSchema(). No field names are hardcoded here.
 *
 * Validation rules:
 *   - required fields must be non-empty after trim().
 *   - json_blob fields: empty string → maps to {} (not an error).
 *     If non-empty but invalid JSON → a precise inline error is shown
 *     under that specific field only (NOT a generic toast).
 *
 * On success: ingestCircleMember(payload, mockDb) → toast + close.
 *
 * The modal is rendered at App root level, reads isIngestionModalOpen from
 * UIContext, and is therefore always available regardless of route.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Upload } from 'lucide-react';

import Modal         from '../primitives/Modal';
import DynamicField  from './DynamicField';
import { getLeadFormSchema }    from '../../api/schemaApi';
import { ingestCircleMember }   from '../../api/ingestionApi';
import { useMockData }          from '../../contexts/MockDataContext';
import { useUI }                from '../../contexts/UIContext';

export default function IngestionModal() {
  const mockDb = useMockData();
  const { isIngestionModalOpen, closeIngestionModal, pushToast } = useUI();

  const [schema,     setSchema]     = useState(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [values,     setValues]     = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Fetch schema whenever the modal opens.
  useEffect(() => {
    if (!isIngestionModalOpen) return;
    setLoadingSchema(true);
    setValues({});
    setFieldErrors({});
    getLeadFormSchema()
      .then((s) => {
        setSchema(s);
        // Seed default values — prevents uncontrolled→controlled flip.
        const defaults = {};
        s.fields.forEach((f) => { defaults[f.name] = ''; });
        setValues(defaults);
      })
      .catch(() => pushToast({ variant: 'error', message: 'Failed to load form schema.' }))
      .finally(() => setLoadingSchema(false));
  }, [isIngestionModalOpen, pushToast]);

  const handleChange = useCallback((name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    // Clear the field error as soon as the operator starts editing.
    setFieldErrors((e) => ({ ...e, [name]: '' }));
  }, []);

  const validate = () => {
    const errors = {};
    let ok = true;

    for (const field of (schema?.fields || [])) {
      const raw = (values[field.name] ?? '').trim();

      // Required check.
      if (field.required && !raw) {
        errors[field.name] = `${field.label} is required.`;
        ok = false;
        continue;
      }

      // json_blob: empty → fine ({} will be used); non-empty must parse.
      if (field.type === 'json_blob' && raw) {
        try {
          JSON.parse(raw);
        } catch {
          errors[field.name] =
            `Invalid JSON syntax — check for missing quotes, commas, or brackets.`;
          ok = false;
        }
      }
    }

    setFieldErrors(errors);
    return ok;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    // Build the final payload: coerce json_blob fields, trim strings.
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
      pushToast({ variant: 'success', message: 'Phone number ingested and queued for processing.' });
      closeIngestionModal();
    } catch (err) {
      pushToast({ variant: 'error', message: `Ingestion failed: ${err.message}` });
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={closeIngestionModal}
        disabled={submitting}
        className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || loadingSchema || !schema}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
      >
        {submitting
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Ingesting…</>
          : <><Upload className="w-4 h-4" /> Submit</>
        }
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isIngestionModalOpen}
      onClose={closeIngestionModal}
      title={schema?.form_title || 'New Number Ingestion'}
      size="lg"
      footer={footer}
    >
      {loadingSchema ? (
        <div className="flex items-center justify-center py-10 gap-2 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading form schema…</span>
        </div>
      ) : !schema ? (
        <p className="text-sm text-rose-600 py-6 text-center">
          Form schema could not be loaded. Please close and try again.
        </p>
      ) : (
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
            Fields marked <span className="text-rose-500 font-bold">*</span> are required.
          </p>
        </div>
      )}
    </Modal>
  );
}
