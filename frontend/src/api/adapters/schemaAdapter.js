/**
 * schemaAdapter — normalizes LeadFormSchemaResponse from the backend so that
 * every select field's `options` is always [{value, label}], regardless of
 * whether the source sent plain strings (legacy mock) or objects (backend).
 *
 * DynamicField.jsx consumes only the normalized shape — it never inspects
 * the raw response. This adapter is the single swap point where the eventual
 * enterprise label set will be applied.
 *
 * // HOOK FOR ENTERPRISE LABELS — per-deployment option labels are injected
 * // here by replacing or extending the label map before returning.
 */

/**
 * Coerce one options list to always [{value, label}].
 * @param {(string|{value:string,label:string})[]} options
 * @returns {{value:string, label:string}[]}
 */
function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return {
      value: String(opt.value ?? opt),
      label: String(opt.label ?? opt.value ?? opt),
    };
  });
}

/**
 * Normalize a raw LeadFormSchemaResponse so all select options are objects.
 *
 * @param {object} raw - Raw response from GET /api/v1/schema/lead-form.
 * @returns {object}   - Same shape with options normalized throughout.
 */
export function normalizeFormSchema(raw) {
  if (!raw || !Array.isArray(raw.fields)) return raw;
  return {
    ...raw,
    fields: raw.fields.map((field) => ({
      ...field,
      options: field.options != null ? normalizeOptions(field.options) : null,
    })),
  };
}
