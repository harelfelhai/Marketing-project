/**
 * customFilters.js — admin-defined ("custom") filter helpers.
 *
 * Beyond the built-in filter catalog (filterFields.js), admins can define
 * extra filters per surface from System Settings — including filters on
 * opaque extra_data keys. These descriptors persist server-side in
 * system_settings.custom_filters and are interpreted only here on the client
 * (Secrets-Free Mandate: labels/options never round-trip through a column).
 *
 * One descriptor shape, used by the filter bars (rendering), the tables /
 * pages (client-side matching, both modes), and the API layer (the backend
 * `filters` query param):
 *
 *   { key, label, field, widget, options? }
 *     key     — stable id; also the value key in UIContext.customFilterValues
 *     label   — Hebrew label shown in the filter bar + settings (admin-entered)
 *     field   — backend filter path: a column ("phone_type") or a dotted
 *               extra_data key ("extra_data.region")
 *     widget  — 'text' (→ contains) | 'select' (→ eq)
 *     options — [{ value, label }] for select widgets (admin-entered)
 *
 * The client-side matcher (rowMatchesCustom) mirrors the backend predicate in
 * services/generic_filters.py so mock-mode and real-mode agree.
 */

const EXTRA_PREFIX = 'extra_data.';

/**
 * Normalize the persisted descriptors for one surface into a safe, ordered
 * list. Drops entries missing key/field; defaults widget to 'text'.
 *
 * @param {string} surfaceId
 * @param {Record<string, object[]>|null|undefined} customFilters  settings.custom_filters
 * @returns {Array<{key,label,field,widget,options}>}
 */
export function resolveCustomFilters(surfaceId, customFilters) {
  const list = customFilters && customFilters[surfaceId];
  if (!Array.isArray(list)) return [];
  return list
    .filter((d) => d && typeof d.key === 'string' && typeof d.field === 'string')
    .map((d) => ({
      key: d.key,
      label: typeof d.label === 'string' && d.label.trim() ? d.label : d.key,
      field: d.field,
      widget: d.widget === 'select' ? 'select' : 'text',
      options: Array.isArray(d.options)
        ? d.options.filter((o) => o && typeof o.value === 'string')
        : [],
    }));
}

/** Read a descriptor's field off a record, descending into extra_data. */
function readField(record, field) {
  if (!record) return undefined;
  if (field.startsWith(EXTRA_PREFIX)) {
    const key = field.slice(EXTRA_PREFIX.length);
    return record.extra_data ? record.extra_data[key] : undefined;
  }
  return record[field];
}

/**
 * Build the backend `filters` param object ({ field: clause }) from active
 * descriptors + their current values. Blank values are skipped. Returns an
 * empty object when nothing is set (caller omits the param entirely).
 */
export function buildCustomFilterParam(descriptors, values) {
  const out = {};
  for (const d of descriptors || []) {
    const v = values?.[d.key];
    if (v == null || v === '') continue;
    out[d.field] = d.widget === 'select' ? v : { contains: v };
  }
  return out;
}

/**
 * Client-side predicate: does `record` satisfy every active custom filter?
 * Mirrors services/generic_filters.row_matches — select → equality (string-
 * coerced), text → case-insensitive substring. Blank values are ignored.
 */
export function rowMatchesCustom(record, descriptors, values) {
  for (const d of descriptors || []) {
    const v = values?.[d.key];
    if (v == null || v === '') continue;
    const actual = readField(record, d.field);
    if (d.widget === 'select') {
      if (String(actual) !== String(v)) return false;
    } else {
      if (actual == null) return false;
      if (!String(actual).toLowerCase().includes(String(v).toLowerCase())) return false;
    }
  }
  return true;
}
