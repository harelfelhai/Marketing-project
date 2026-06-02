/**
 * displayFields.js — the catalog of configurable display fields per surface.
 *
 * Single source of truth for "which fields CAN a surface show" + their
 * human labels + the default selection. The System Settings tab reads this
 * catalog to render per-surface toggles; each surface reads it (via
 * `resolveVisibleColumns`) to decide which columns to render.
 *
 * Adding a new configurable column = ONE entry here (+ one render case in the
 * owning surface). Changing what's shown needs NO code change — an admin
 * toggles it in System Settings and the choice persists via
 * `/system/settings/display-fields`.
 *
 * Labels live here (frontend config) per the Secrets-Free Mandate — the
 * backend stores only the opaque selected field KEYS, never the labels.
 *
 * // HOOK FOR ENTERPRISE LABELS — relabel columns here for the internal env.
 */

import {
  ENTITIES_COL_ID, ENTITIES_COL_NAME, ENTITIES_COL_RELATION,
  ENTITIES_COL_CLIENT, ENTITIES_COL_PHONES, ENTITIES_COL_CREATED,
  ENTITIES_COL_IDENTIFIER_1, ENTITIES_COL_IDENTIFIER_2,
  ENTITIES_COL_ROOT_NAME, ENTITIES_COL_ROOT_ROLE, ENTITIES_COL_ROOT_IDENTIFIER,
  TABLE_HEADER_ASSOCIATION, TABLE_HEADER_VERIFICATION,
  TABLE_HEADER_UPDATED, TABLE_HEADER_ROOT_NAME, TABLE_HEADER_ROOT_ROLE,
  TABLE_HEADER_ENTITY_NAME, TABLE_HEADER_RELATION,
  CLIENT_CARD_SECTION_METRICS, CLIENT_CARD_SECTION_VERDICTS,
  CLIENT_CARD_SECTION_SLA, CLIENT_CARD_SECTION_TASKS,
  CLIENT_CARD_SECTION_ROLE, CLIENT_CARD_SECTION_IDENTIFIER,
  CLIENT_CARD_SECTION_PHONE_COUNT,
  SURFACE_LABEL_ENTITIES, SURFACE_LABEL_PHONES, SURFACE_LABEL_CLIENTS,
} from './strings.he';


/**
 * @typedef {Object} DisplayColumn
 * @property {string}  key      Stable field key (persisted; never translated).
 * @property {string}  label    Human label shown in headers + the picker.
 * @property {boolean} default  Whether it is visible by default.
 */

/** @type {Record<string, {id:string, label:string, columns: DisplayColumn[]}>} */
export const DISPLAY_SURFACES = {
  entities: {
    id: 'entities',
    label: SURFACE_LABEL_ENTITIES,
    columns: [
      { key: 'root_name',       label: ENTITIES_COL_ROOT_NAME,       default: true  },
      { key: 'root_role',       label: ENTITIES_COL_ROOT_ROLE,       default: true  },
      { key: 'root_identifier', label: ENTITIES_COL_ROOT_IDENTIFIER, default: true  },
      { key: 'name',            label: ENTITIES_COL_NAME,            default: true  },
      { key: 'relation',        label: ENTITIES_COL_RELATION,        default: true  },
      { key: 'identifier_1',    label: ENTITIES_COL_IDENTIFIER_1,    default: true  },
      { key: 'identifier_2',    label: ENTITIES_COL_IDENTIFIER_2,    default: true  },
      { key: 'id',              label: ENTITIES_COL_ID,              default: false },
      { key: 'client',          label: ENTITIES_COL_CLIENT,          default: false },
      { key: 'phones',          label: ENTITIES_COL_PHONES,          default: false },
      { key: 'created',         label: ENTITIES_COL_CREATED,         default: false },
    ],
  },
  // Phone table — first column (phone_number + phone_type + score) is always
  // shown and NOT toggleable. The configurable columns are listed below.
  phones: {
    id: 'phones',
    label: SURFACE_LABEL_PHONES,
    columns: [
      { key: 'root_name',    label: TABLE_HEADER_ROOT_NAME,    default: true  },
      { key: 'root_role',    label: TABLE_HEADER_ROOT_ROLE,    default: true  },
      { key: 'entity_name',  label: TABLE_HEADER_ENTITY_NAME,  default: true  },
      { key: 'relation',     label: TABLE_HEADER_RELATION,     default: true  },
      { key: 'verification', label: TABLE_HEADER_VERIFICATION, default: true  },
      { key: 'association',  label: TABLE_HEADER_ASSOCIATION,  default: false },
      { key: 'updated',      label: TABLE_HEADER_UPDATED,      default: false },
    ],
  },
  // Client Hub card — header (name + alert dot + chevron) is always shown.
  // These sections appear beneath it.
  clients: {
    id: 'clients',
    label: SURFACE_LABEL_CLIENTS,
    columns: [
      { key: 'role',        label: CLIENT_CARD_SECTION_ROLE,        default: true },
      { key: 'identifier',  label: CLIENT_CARD_SECTION_IDENTIFIER,  default: true },
      { key: 'phone_count', label: CLIENT_CARD_SECTION_PHONE_COUNT, default: true },
      { key: 'metrics',     label: CLIENT_CARD_SECTION_METRICS,     default: true },
      { key: 'verdicts',    label: CLIENT_CARD_SECTION_VERDICTS,    default: true },
      { key: 'sla',         label: CLIENT_CARD_SECTION_SLA,         default: true },
      { key: 'tasks',       label: CLIENT_CARD_SECTION_TASKS,       default: true },
    ],
  },
};


/** The default ordered key list for a surface. */
export function defaultFieldKeys(surfaceId) {
  const surface = DISPLAY_SURFACES[surfaceId];
  if (!surface) return [];
  return surface.columns.filter((c) => c.default).map((c) => c.key);
}


/**
 * Resolve the ordered, visible columns for a surface given the persisted
 * per-surface selection (from system settings).
 *
 * - A saved selection wins: columns appear in the saved order, filtered to
 *   keys the current catalog still knows (graceful catalog drift).
 * - No saved selection (or it filtered down to nothing) → the catalog
 *   defaults, so behaviour is identical to before any configuration.
 *
 * @param {string} surfaceId
 * @param {Record<string,string[]>|null|undefined} displayFields  settings.display_fields
 * @returns {DisplayColumn[]}
 */
export function resolveVisibleColumns(surfaceId, displayFields) {
  const surface = DISPLAY_SURFACES[surfaceId];
  if (!surface) return [];
  const byKey = new Map(surface.columns.map((c) => [c.key, c]));

  const selected = displayFields && displayFields[surfaceId];
  if (Array.isArray(selected)) {
    const cols = selected.map((k) => byKey.get(k)).filter(Boolean);
    if (cols.length) return cols;
  }
  return surface.columns.filter((c) => c.default);
}
