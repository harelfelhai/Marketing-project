/**
 * filterFields.js — catalog of configurable filter fields per surface.
 *
 * Mirrors the architecture of displayFields.js: one entry here per possible
 * filter control; admin toggles fields on/off via System Settings; filter
 * bars read the active selection via resolveActiveFilters().
 *
 * Keys are stable identifiers persisted in system_settings.filter_fields —
 * never rename a key without a migration. Labels live here only (Secrets-Free
 * Mandate: the backend stores only the opaque key list, never labels).
 *
 * // HOOK FOR ENTERPRISE LABELS — relabel filters here for the internal env.
 */

import {
  SURFACE_LABEL_PHONES, SURFACE_LABEL_OPERATIONS,
  FILTER_LABEL_SEARCH, FILTER_LABEL_CLIENT,
  FILTER_LABEL_VERIF_STATUS, FILTER_LABEL_SOURCE, FILTER_LABEL_PHONE_TYPE,
  FILTER_LABEL_ENTITY_NAME, FILTER_LABEL_RELATION_TYPE,
  FILTER_LABEL_TASK_STATUS, FILTER_LABEL_TASK_TYPE, FILTER_LABEL_HIDE_RESOLVED,
} from './strings.he';


/**
 * @typedef {Object} FilterField
 * @property {string}  key       Stable field key (persisted; never translated).
 * @property {string}  label     Human label shown in the System Settings picker.
 * @property {boolean} default   Whether visible by default.
 * @property {string}  type      'text' | 'select' | 'clients' | 'toggle'
 */

/** @type {Record<string, {id:string, label:string, filters: FilterField[]}>} */
export const FILTER_SURFACES = {
  phones: {
    id: 'phones',
    label: SURFACE_LABEL_PHONES,
    filters: [
      { key: 'search',             label: FILTER_LABEL_SEARCH,        default: true,  type: 'text'    },
      { key: 'rootEntityId',           label: FILTER_LABEL_CLIENT,        default: true,  type: 'clients' },
      { key: 'verificationStatus', label: FILTER_LABEL_VERIF_STATUS,  default: true,  type: 'select'  },
      { key: 'ingestionSource',    label: FILTER_LABEL_SOURCE,        default: true,  type: 'select'  },
      { key: 'phoneType',          label: FILTER_LABEL_PHONE_TYPE,    default: true,  type: 'select'  },
      { key: 'entityName',         label: FILTER_LABEL_ENTITY_NAME,   default: false, type: 'text'    },
      { key: 'relationType',       label: FILTER_LABEL_RELATION_TYPE, default: false, type: 'select'  },
    ],
  },
  operations: {
    id: 'operations',
    label: SURFACE_LABEL_OPERATIONS,
    filters: [
      { key: 'search',       label: FILTER_LABEL_SEARCH,        default: true,  type: 'text'    },
      { key: 'status',       label: FILTER_LABEL_TASK_STATUS,   default: true,  type: 'select'  },
      { key: 'taskType',     label: FILTER_LABEL_TASK_TYPE,     default: true,  type: 'select'  },
      { key: 'rootEntityId',     label: FILTER_LABEL_CLIENT,        default: false, type: 'clients' },
      { key: 'hideResolved', label: FILTER_LABEL_HIDE_RESOLVED, default: true,  type: 'toggle'  },
    ],
  },
};


/** Returns the default ordered key list for a surface. */
export function defaultFilterKeys(surfaceId) {
  const surface = FILTER_SURFACES[surfaceId];
  if (!surface) return [];
  return surface.filters.filter((f) => f.default).map((f) => f.key);
}


/**
 * Resolve the ordered, active filters for a surface given the persisted
 * per-surface selection (from system settings).
 *
 * - A saved selection wins: filters appear in the saved order, filtered to
 *   keys the current catalog still knows.
 * - No saved selection → catalog defaults (identical to pre-feature behaviour).
 *
 * @param {string} surfaceId
 * @param {Record<string,string[]>|null|undefined} filterFields  settings.filter_fields
 * @returns {FilterField[]}
 */
export function resolveActiveFilters(surfaceId, filterFields) {
  const surface = FILTER_SURFACES[surfaceId];
  if (!surface) return [];
  const byKey = new Map(surface.filters.map((f) => [f.key, f]));

  const selected = filterFields && filterFields[surfaceId];
  if (Array.isArray(selected)) {
    const filters = selected.map((k) => byKey.get(k)).filter(Boolean);
    if (filters.length) return filters;
  }
  return surface.filters.filter((f) => f.default);
}
