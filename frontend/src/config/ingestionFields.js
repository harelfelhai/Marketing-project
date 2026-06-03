/**
 * ingestionFields.js — admin-defined dynamic ingestion fields.
 *
 * Admins can attach extra input fields to the add-person ('entity') and
 * add-number ('phone') forms from System Settings. Each descriptor's `key`
 * is the extra_data key the captured value is stored under — so the structured
 * columns stay agnostic and the values live in the opaque extra_data bucket
 * (Secrets-Free Mandate). Descriptors persist in system_settings.ingestion_fields
 * and are interpreted only here on the client.
 *
 * Descriptor shape (mirrors customFilters): { key, label, widget, options? }
 *   widget: 'text' (free input) | 'select' (one of options)
 *   options: [{ value, label }] for select widgets (admin-entered)
 */

/**
 * Normalize the persisted descriptors for one surface into a safe list.
 * @param {'entity'|'phone'} surface
 * @param {Record<string, object[]>|null|undefined} ingestionFields  settings.ingestion_fields
 */
export function resolveIngestionFields(surface, ingestionFields) {
  const list = ingestionFields && ingestionFields[surface];
  if (!Array.isArray(list)) return [];
  return list
    .filter((d) => d && typeof d.key === 'string' && d.key.trim())
    .map((d) => ({
      key: d.key,
      label: typeof d.label === 'string' && d.label.trim() ? d.label : d.key,
      widget: d.widget === 'select' ? 'select' : 'text',
      options: Array.isArray(d.options)
        ? d.options.filter((o) => o && typeof o.value === 'string')
        : [],
    }));
}

/**
 * Build an extra_data object from descriptors + their current values, skipping
 * blanks. Returns undefined when nothing was filled (so callers can omit it).
 */
export function buildExtraData(descriptors, values) {
  const out = {};
  for (const d of descriptors || []) {
    const v = values?.[d.key];
    if (v == null || v === '') continue;
    out[d.key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
