/**
 * exportCatalog.js — per-table catalog of exportable columns (Phase EXP).
 *
 * Each entry declares EVERY field the backend's
 * `ALLOWED_EXPORT_COLUMNS_*` allowlist accepts, together with:
 *   - key:    structural identifier sent on the wire
 *   - label:  Hebrew display string written into the .xlsx header row
 *             AND used as the checkbox label in the configurator modal
 *   - format: cell-type token ('text' | 'number' | 'number2' | 'datetime')
 *
 * The frontend catalog must stay in lockstep with the backend allowlist.
 * If the two drift, the backend wins — a request with an out-of-allowlist
 * key returns 422.
 *
 * Two stable arrays per table:
 *   - `defaults`  — keys the operator gets on first use (visible columns
 *                    of the live table view). Order is the default
 *                    column order in the export.
 *   - `columns`   — every field available, in the order shown in the
 *                    configurator modal.
 */

// ---------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------

export const PHONES_EXPORT_CATALOG = {
  defaults: [
    'phone_number',
    'phone_type',
    'entity_id',
    'verification_status',
    'score',
    'ingestion_source',
  ],
  columns: [
    { key: 'id',                  label: 'מזהה',          format: 'number'  },
    { key: 'phone_number',        label: 'מספר טלפון',     format: 'text'    },
    { key: 'phone_type',          label: 'סוג טלפון',      format: 'text'    },
    { key: 'entity_id',           label: 'מזהה ישות',      format: 'number'  },
    { key: 'ingestion_source',    label: 'מקור קליטה',     format: 'text'    },
    { key: 'verification_status', label: 'סטטוס אימות',    format: 'text'    },
    { key: 'score',               label: 'ציון',           format: 'number2' },
    { key: 'extra_data.bulk_submission_id', label: 'מזהה אצווה', format: 'text' },
    { key: 'extra_data.row_token',          label: 'מקור שורה',  format: 'text' },
  ],
};


// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASKS_EXPORT_CATALOG = {
  defaults: [
    'task_type',
    'phone_number',
    'entity_id',
    'status',
  ],
  columns: [
    { key: 'id',           label: 'מזהה משימה',  format: 'number' },
    { key: 'task_type',    label: 'סוג משימה',   format: 'text'   },
    { key: 'status',       label: 'סטטוס',       format: 'text'   },
    { key: 'phone_id',     label: 'מזהה טלפון',  format: 'number' },
    { key: 'phone_number', label: 'מספר טלפון',  format: 'text'   },
    { key: 'entity_id',    label: 'מזהה ישות',   format: 'number' },
    { key: 'extra_data.failure_category',      label: 'קטגוריית כשל',  format: 'text' },
    { key: 'extra_data.suggested_remediation', label: 'הצעת טיפול',    format: 'text' },
    { key: 'extra_data.operator_note',         label: 'הערת מפעיל',    format: 'text' },
    { key: 'extra_data.resolution_note',       label: 'הערת סיום',     format: 'text' },
  ],
};


// ---------------------------------------------------------------------------
// Registry — single lookup for tableId → catalog
// ---------------------------------------------------------------------------

export const EXPORT_CATALOG_BY_TABLE = {
  phones: PHONES_EXPORT_CATALOG,
  tasks:  TASKS_EXPORT_CATALOG,
};


/**
 * Build a column descriptor list ready for the TableExportRequest body.
 * Looks up the format + label for each key from the table's catalog;
 * unknown keys (operator's localStorage holds a stale entry that was
 * removed from the catalog) are silently filtered out.
 *
 * @param {string} tableId — 'phones' | 'tasks'
 * @param {string[]} selectedKeys — operator-chosen keys in display order
 * @returns {{ key, label, format }[]}
 */
export function buildExportColumns(tableId, selectedKeys) {
  const catalog = EXPORT_CATALOG_BY_TABLE[tableId];
  if (!catalog) return [];
  const byKey = new Map(catalog.columns.map((c) => [c.key, c]));
  return selectedKeys
    .map((k) => byKey.get(k))
    .filter(Boolean)
    .map((c) => ({ key: c.key, label: c.label, format: c.format || 'text' }));
}
