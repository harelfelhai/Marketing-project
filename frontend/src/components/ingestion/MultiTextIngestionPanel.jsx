/**
 * MultiTextIngestionPanel — Phase E1-C Tab 2 (paste-a-list).
 *
 * The operator pastes a free-form list of phone numbers separated by any
 * mix of commas / semicolons / whitespace. A shared "envelope" of context
 * fields (client, entity_type, source, optional target_entity_id, optional
 * reason) applies to every number in the batch — the backend creates ONE
 * new Entity for the whole submission and attaches all surviving phones to it.
 *
 * Flow:
 *   1. Form state (textarea + 5 envelope fields).
 *   2. Live token count under the textarea (mirrors the backend's
 *      tokenize regex so the operator sees the same count the server will).
 *   3. On submit → bulkIngestText() → BulkIngestSummary.
 *   4. On result → render BulkResultPanel inline; the form is hidden and
 *      replaced with a "New Batch" button so the operator can reset state
 *      without dismissing the modal.
 *
 * Resilience contract: per-row failures arrive in the summary, NOT as
 * thrown errors. Only request-shape errors (e.g. bad target_entity_id)
 * throw — those land in a toast.
 */

import { useMemo, useState } from 'react';
import { Loader2, Upload, RefreshCw } from 'lucide-react';

import { bulkIngestText } from '../../api/ingestionApi';
import { useMockData }    from '../../contexts/MockDataContext';
import { useUI }          from '../../contexts/UIContext';
import { CLIENT_REGISTRY } from '../../config/clientRegistry';
import BulkResultPanel    from './BulkResultPanel';
import {
  BULK_TEXT_INTRO,
  BULK_TEXT_FIELD_NUMBERS, BULK_TEXT_FIELD_NUMBERS_HELP, BULK_TEXT_FIELD_NUMBERS_PLACE,
  BULK_TEXT_FIELD_CLIENT, BULK_TEXT_FIELD_ENTITY_TYPE, BULK_TEXT_FIELD_SOURCE,
  BULK_TEXT_FIELD_REASON, BULK_TEXT_FIELD_REASON_PLACE,
  BULK_TEXT_FIELD_TARGET, BULK_TEXT_FIELD_TARGET_HELP, BULK_TEXT_FIELD_TARGET_PLACE,
  BULK_TEXT_TOKEN_COUNT,
  BULK_TEXT_BTN_SUBMIT, BULK_TEXT_BTN_SUBMITTING, BULK_TEXT_BTN_NEW_BATCH,
  BULK_TEXT_ERR_EMPTY_BODY, BULK_TEXT_ERR_MISSING_CLIENT,
  BULK_TEXT_ERR_MISSING_ENTITY_TYPE, BULK_TEXT_ERR_MISSING_SOURCE,
  BULK_TEXT_ERR_BAD_TARGET,
  BULK_TEXT_TOAST_PARTIAL, BULK_TEXT_TOAST_ALL_OK, BULK_TEXT_TOAST_NONE_OK,
  BULK_TEXT_TOAST_ERROR,
  INGEST_MODAL_BTN_CANCEL, DYNAMIC_SELECT_DEFAULT,
} from '../../config/strings.he';

// Mirrors the backend's tokenize regex (services/bulk_ingestion.py: _TOKEN_SPLIT_RE).
// Kept identical so the live counter matches what the server will see.
const TOKEN_SPLIT_RE = /[,\s;]+/;

// Entity types — the backend accepts any string here; this list mirrors the
// values seeded into the system so the dropdown is operator-friendly. The
// value is the contract; the label is display-only.
const ENTITY_TYPE_OPTIONS = [
  { value: 'family',          label: 'משפחה' },
  { value: 'friend',          label: 'חברים' },
  { value: 'colleague',       label: 'עמיתים' },
  { value: 'social_envelope', label: 'מעטפת חברתית' },
  { value: 'target',          label: 'יעד ראשי' },
];

// Ingestion source — fixed enum on the backend side (string column).
const INGESTION_SOURCE_OPTIONS = [
  { value: 'manual',        label: 'ידני' },
  { value: 'automated',     label: 'אוטומטי' },
  { value: 'import',        label: 'ייבוא' },
  { value: 'partner_feed',  label: 'פיד שותף' },
];

// Tailwind-class constants matching DynamicField conventions.
const BASE_INPUT =
  'w-full h-9 px-3 text-sm rounded-md border bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors';
const NORMAL_BORDER = 'border-slate-300';
const ERROR_BORDER  = 'border-rose-400';

function FieldLabel({ htmlFor, required, children }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-700 mb-1">
      {children}
      {required && <span className="text-rose-500 ms-0.5" aria-hidden="true">*</span>}
    </label>
  );
}

function FieldError({ id, msg }) {
  if (!msg) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-rose-600 break-words">
      {msg}
    </p>
  );
}

function FieldHelp({ msg }) {
  if (!msg) return null;
  return <p className="mt-1 text-[11px] text-slate-400">{msg}</p>;
}

const INITIAL_FORM = {
  phone_numbers_raw: '',
  client_id:         '',
  entity_type:       '',
  ingestion_source:  '',
  target_entity_id:  '',
  ingestion_reason:  '',
};

export default function MultiTextIngestionPanel() {
  const mockDb = useMockData();
  const { closeIngestionModal, pushToast } = useUI();

  const [form, setForm]             = useState(INITIAL_FORM);
  const [errors, setErrors]         = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary]       = useState(null);

  // Live token count — same regex as the backend tokenizer.
  const tokenCount = useMemo(() => {
    if (!form.phone_numbers_raw) return 0;
    return form.phone_numbers_raw.split(TOKEN_SPLIT_RE).filter(Boolean).length;
  }, [form.phone_numbers_raw]);

  const handleChange = (name) => (e) => {
    setForm((f) => ({ ...f, [name]: e.target.value }));
    setErrors((errs) => ({ ...errs, [name]: '' }));
  };

  const validate = () => {
    const next = {};
    if (!form.phone_numbers_raw.trim()) next.phone_numbers_raw = BULK_TEXT_ERR_EMPTY_BODY;
    if (!form.client_id)        next.client_id        = BULK_TEXT_ERR_MISSING_CLIENT;
    if (!form.entity_type)      next.entity_type      = BULK_TEXT_ERR_MISSING_ENTITY_TYPE;
    if (!form.ingestion_source) next.ingestion_source = BULK_TEXT_ERR_MISSING_SOURCE;
    if (form.target_entity_id) {
      const n = Number(form.target_entity_id);
      if (!Number.isInteger(n) || n <= 0) {
        next.target_entity_id = BULK_TEXT_ERR_BAD_TARGET;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const buildPayload = () => ({
    phone_numbers_raw: form.phone_numbers_raw,
    client_id:         Number(form.client_id),
    entity_type:       form.entity_type,
    ingestion_source:  form.ingestion_source,
    target_entity_id:  form.target_entity_id ? Number(form.target_entity_id) : null,
    ingestion_reason:  form.ingestion_reason || null,
  });

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await bulkIngestText(buildPayload(), mockDb);
      setSummary(result);

      if (result.failed_count > 0 && result.success_count > 0) {
        pushToast({
          variant: 'warn',
          message: BULK_TEXT_TOAST_PARTIAL(result.success_count, result.failed_count),
        });
      } else if (result.success_count > 0) {
        pushToast({
          variant: 'success',
          message: BULK_TEXT_TOAST_ALL_OK(result.success_count),
        });
      } else {
        pushToast({
          variant: 'error',
          message: BULK_TEXT_TOAST_NONE_OK(result.failed_count),
        });
      }
    } catch (err) {
      pushToast({ variant: 'error', message: BULK_TEXT_TOAST_ERROR(err.message) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewBatch = () => {
    setForm(INITIAL_FORM);
    setErrors({});
    setSummary(null);
  };

  // -------------------------------------------------------------------------
  // Result mode — once a submission completes, hide the form and show only
  // the summary panel + a "New Batch" button. The operator can stay in the
  // modal and ingest another batch without dismissing.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Form mode.
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-4" dir="rtl">
      <p className="text-sm text-slate-500">{BULK_TEXT_INTRO}</p>

      {/* Textarea — the centerpiece of the panel. */}
      <div>
        <FieldLabel htmlFor="bulk-numbers" required>
          {BULK_TEXT_FIELD_NUMBERS}
        </FieldLabel>
        <textarea
          id="bulk-numbers"
          dir="ltr"   /* phone numbers are always LTR even in RTL form */
          rows={6}
          value={form.phone_numbers_raw}
          onChange={handleChange('phone_numbers_raw')}
          placeholder={BULK_TEXT_FIELD_NUMBERS_PLACE}
          maxLength={10000}
          aria-invalid={!!errors.phone_numbers_raw}
          aria-describedby={errors.phone_numbers_raw ? 'bulk-numbers-err' : 'bulk-numbers-help'}
          className={`w-full px-3 py-2 text-sm font-mono rounded-md border resize-none focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors ${errors.phone_numbers_raw ? ERROR_BORDER : NORMAL_BORDER}`}
        />
        <div className="flex items-center justify-between mt-1">
          <FieldHelp msg={BULK_TEXT_FIELD_NUMBERS_HELP} />
          <span
            data-testid="bulk-token-count"
            className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap ms-2"
          >
            {BULK_TEXT_TOKEN_COUNT(tokenCount)}
          </span>
        </div>
        <FieldError id="bulk-numbers-err" msg={errors.phone_numbers_raw} />
      </div>

      {/* Envelope context — applies to every phone in the batch. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="bulk-client" required>{BULK_TEXT_FIELD_CLIENT}</FieldLabel>
          <select
            id="bulk-client"
            value={form.client_id}
            onChange={handleChange('client_id')}
            aria-invalid={!!errors.client_id}
            className={`${BASE_INPUT} ${errors.client_id ? ERROR_BORDER : NORMAL_BORDER} pe-8`}
          >
            <option value="">{DYNAMIC_SELECT_DEFAULT}</option>
            {CLIENT_REGISTRY.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <FieldError msg={errors.client_id} />
        </div>

        <div>
          <FieldLabel htmlFor="bulk-entity-type" required>
            {BULK_TEXT_FIELD_ENTITY_TYPE}
          </FieldLabel>
          <select
            id="bulk-entity-type"
            value={form.entity_type}
            onChange={handleChange('entity_type')}
            aria-invalid={!!errors.entity_type}
            className={`${BASE_INPUT} ${errors.entity_type ? ERROR_BORDER : NORMAL_BORDER} pe-8`}
          >
            <option value="">{DYNAMIC_SELECT_DEFAULT}</option>
            {ENTITY_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <FieldError msg={errors.entity_type} />
        </div>

        <div>
          <FieldLabel htmlFor="bulk-source" required>{BULK_TEXT_FIELD_SOURCE}</FieldLabel>
          <select
            id="bulk-source"
            value={form.ingestion_source}
            onChange={handleChange('ingestion_source')}
            aria-invalid={!!errors.ingestion_source}
            className={`${BASE_INPUT} ${errors.ingestion_source ? ERROR_BORDER : NORMAL_BORDER} pe-8`}
          >
            <option value="">{DYNAMIC_SELECT_DEFAULT}</option>
            {INGESTION_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <FieldError msg={errors.ingestion_source} />
        </div>

        <div>
          <FieldLabel htmlFor="bulk-target">{BULK_TEXT_FIELD_TARGET}</FieldLabel>
          <input
            id="bulk-target"
            type="number"
            min={1}
            inputMode="numeric"
            value={form.target_entity_id}
            onChange={handleChange('target_entity_id')}
            placeholder={BULK_TEXT_FIELD_TARGET_PLACE}
            aria-invalid={!!errors.target_entity_id}
            className={`${BASE_INPUT} ${errors.target_entity_id ? ERROR_BORDER : NORMAL_BORDER}`}
          />
          <FieldHelp msg={BULK_TEXT_FIELD_TARGET_HELP} />
          <FieldError msg={errors.target_entity_id} />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="bulk-reason">{BULK_TEXT_FIELD_REASON}</FieldLabel>
        <input
          id="bulk-reason"
          type="text"
          value={form.ingestion_reason}
          onChange={handleChange('ingestion_reason')}
          placeholder={BULK_TEXT_FIELD_REASON_PLACE}
          className={`${BASE_INPUT} ${NORMAL_BORDER}`}
        />
      </div>

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
