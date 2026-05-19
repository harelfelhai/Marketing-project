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
    'entity_type',
    'client_id',
    'verification_status',
    'priority_score',
    'ingested_at',
  ],
  columns: [
    // Identity + structural
    { key: 'id',                       label: 'מזהה',                     format: 'number'   },
    { key: 'phone_number',             label: 'מספר טלפון',                format: 'text'     },
    { key: 'entity_id',                label: 'מזהה ישות',                 format: 'number'   },
    // Entity JOIN
    { key: 'entity_type',              label: 'סוג ישות',                  format: 'text'     },
    { key: 'client_id',                label: 'מזהה לקוח',                 format: 'number'   },
    // Phase 1 ingestion block
    { key: 'ingestion_source',         label: 'מקור הקליטה',               format: 'text'     },
    { key: 'ingestion_reason',         label: 'סיבת הקליטה',               format: 'text'     },
    { key: 'ingested_at',              label: 'נקלט בתאריך',               format: 'datetime' },
    // Phase 3 verification block
    { key: 'verification_status',      label: 'סטטוס אימות',               format: 'text'     },
    { key: 'verification_source',      label: 'מקור האימות',               format: 'text'     },
    { key: 'verification_reason',      label: 'סיבת האימות',               format: 'text'     },
    { key: 'verified_at',              label: 'אומת בתאריך',               format: 'datetime' },
    // Phase DY scoring block
    { key: 'confidence_score',         label: 'ציון אמינות',               format: 'number2'  },
    { key: 'priority_score',           label: 'ציון עדיפות',               format: 'number2'  },
    { key: 'confidence_updated_at',    label: 'עדכון אמינות',              format: 'datetime' },
    { key: 'priority_updated_at',      label: 'עדכון עדיפות',              format: 'datetime' },
    { key: 'customer_tier',            label: 'דרגת לקוח',                 format: 'number'   },
    // Other mutable fields
    { key: 'classification_type',      label: 'סיווג',                    format: 'text'     },
    { key: 'created_at',               label: 'תאריך יצירה',              format: 'datetime' },
    { key: 'updated_at',               label: 'עודכן לאחרונה',             format: 'datetime' },
    // Allowlisted extra_data (Phase E2 names + DX audit fields).
    // UAT round-3 — `extra_data.first_name` / `_last_name` resolve from
    // the IMMEDIATE owning entity (the person being called). The
    // root-target's name (head of the circle / "client head") sits on
    // separate flat fields below so an export can carry BOTH.
    { key: 'extra_data.first_name',    label: 'שם פרטי (ישות)',            format: 'text'     },
    { key: 'extra_data.last_name',     label: 'שם משפחה (ישות)',           format: 'text'     },
    { key: 'root_first_name',          label: 'שם פרטי (לקוח-שורש)',       format: 'text'     },
    { key: 'root_last_name',           label: 'שם משפחה (לקוח-שורש)',      format: 'text'     },
    { key: 'extra_data.customer_tier', label: 'דרגת לקוח (גולמי)',         format: 'number'   },
    { key: 'extra_data.bulk_submission_id', label: 'מזהה אצווה',           format: 'text'     },
    { key: 'extra_data.envelope_id',   label: 'מזהה מעטפת',               format: 'text'     },
    { key: 'extra_data.row_token',     label: 'מקור שורה',                format: 'text'     },
  ],
};


// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASKS_EXPORT_CATALOG = {
  defaults: [
    'task_type',
    'phone_number',
    'client_id',
    'status',
    'requested_by',
    'updated_at',
  ],
  columns: [
    // Task identity + structural
    { key: 'id',                       label: 'מזהה משימה',                format: 'number'   },
    { key: 'task_type',                label: 'סוג משימה',                 format: 'text'     },
    { key: 'status',                   label: 'סטטוס',                     format: 'text'     },
    { key: 'source_action_log_id',     label: 'מזהה לוג פעולה',             format: 'number'   },
    // Phone + Entity JOIN
    { key: 'phone_id',                 label: 'מזהה טלפון',                format: 'number'   },
    { key: 'phone_number',             label: 'מספר טלפון',                format: 'text'     },
    { key: 'entity_id',                label: 'מזהה ישות',                 format: 'number'   },
    { key: 'entity_type',              label: 'סוג ישות',                  format: 'text'     },
    { key: 'client_id',                label: 'מזהה לקוח',                 format: 'number'   },
    // Attribution
    { key: 'requested_by',             label: 'נפתח על-ידי',               format: 'text'     },
    { key: 'resolved_by',              label: 'טופל על-ידי',               format: 'text'     },
    // Timestamps
    { key: 'created_at',               label: 'נפתח בתאריך',               format: 'datetime' },
    { key: 'updated_at',               label: 'עודכן',                    format: 'datetime' },
    { key: 'resolved_at',              label: 'טופל בתאריך',               format: 'datetime' },
    // Allowlisted extra_data
    { key: 'extra_data.failure_category',     label: 'קטגוריית כשל',       format: 'text'     },
    { key: 'extra_data.suggested_remediation', label: 'הצעת טיפול',         format: 'text'     },
    { key: 'extra_data.requested_action_type', label: 'סוג פעולה מבוקש',   format: 'text'     },
    { key: 'extra_data.operator_note',         label: 'הערת מפעיל',         format: 'text'     },
    { key: 'extra_data.resolution_note',       label: 'הערת סיום',          format: 'text'     },
    { key: 'extra_data.resolution_outcome',    label: 'תוצאת הסיום',        format: 'text'     },
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
