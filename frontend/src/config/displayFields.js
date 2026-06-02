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
  ENTITIES_COL_STRONG_ID,
  SURFACE_LABEL_ENTITIES,
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
      { key: 'id',                label: ENTITIES_COL_ID,        default: true },
      { key: 'name',              label: ENTITIES_COL_NAME,      default: true },
      { key: 'strong_identifier', label: ENTITIES_COL_STRONG_ID, default: true },
      { key: 'relation',          label: ENTITIES_COL_RELATION,  default: true },
      { key: 'client',            label: ENTITIES_COL_CLIENT,    default: true },
      { key: 'phones',            label: ENTITIES_COL_PHONES,    default: true },
      { key: 'created',           label: ENTITIES_COL_CREATED,   default: true },
    ],
  },
  // Future surfaces (phone table, client card) plug in here the same way.
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
