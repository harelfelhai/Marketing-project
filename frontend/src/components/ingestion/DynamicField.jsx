/**
 * DynamicField — renders a single form field based on its schema `type`.
 *
 * type → input mapping:
 *   text     → <input type="text">
 *   tel      → <input type="tel">
 *   select   → <select> with schema-provided options
 *   textarea → <textarea>
 *   json_blob→ <textarea> (raw JSON; errors are shown inline, not as toast)
 *
 * The `error` prop is set externally by the parent's per-field validation
 * pass. For json_blob fields, the parent catches JSON.parse failures and
 * sets the error string here; a generic red message appears below the field.
 *
 * // HOOK FOR ENTERPRISE LABELS — field labels and placeholders come
 * // entirely from the schema response, not from this file.
 */

const baseInput =
  'w-full h-9 px-3 text-sm rounded-md border bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors';

const errorBorder  = 'border-rose-400';
const normalBorder = 'border-slate-300';

export default function DynamicField({ field, value, onChange, error }) {
  const bordClass = error ? errorBorder : normalBorder;
  const id        = `field-${field.name}`;

  const shared = {
    id,
    name:        field.name,
    value:       value ?? '',
    onChange:    (e) => onChange(field.name, e.target.value),
    placeholder: field.placeholder || '',
    'aria-describedby': error ? `${id}-err` : undefined,
    'aria-invalid':     !!error,
  };

  let inputEl;

  if (field.type === 'select') {
    inputEl = (
      <select {...shared} className={`${baseInput} ${bordClass} pr-8`}>
        <option value="">— select —</option>
        {(field.options || []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  } else if (field.type === 'textarea') {
    inputEl = (
      <textarea
        {...shared}
        rows={3}
        className={`w-full px-3 py-2 text-sm rounded-md border resize-none focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors ${bordClass}`}
      />
    );
  } else if (field.type === 'json_blob') {
    inputEl = (
      <textarea
        {...shared}
        rows={3}
        spellCheck={false}
        className={`w-full px-3 py-2 text-xs font-mono rounded-md border resize-none focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors ${bordClass}`}
      />
    );
  } else {
    // text | tel | number — default to text input
    inputEl = (
      <input
        {...shared}
        type={field.type === 'tel' ? 'tel' : 'text'}
        className={`${baseInput} ${bordClass}`}
      />
    );
  }

  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-slate-700"
      >
        {field.label}
        {field.required && <span className="text-rose-500 ml-0.5" aria-hidden="true">*</span>}
      </label>

      {inputEl}

      {/* Inline field-level error — used by json_blob validation */}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs text-rose-600 break-words">
          {error}
        </p>
      )}

      {!error && field.help_text && (
        <p className="text-[11px] text-slate-400">{field.help_text}</p>
      )}
    </div>
  );
}
