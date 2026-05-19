/**
 * clientRegistry.js — maps integer client_id values to UI display metadata.
 *
 * The backend stores only opaque integers (1, 2, 3 …) in Entity.client_id.
 * Human-readable client names live here — exclusively in the frontend config
 * layer — and never appear anywhere in the backend schema or API contracts.
 *
 * // HOOK FOR ENTERPRISE LABELS — replace display names and SLA values with
 * // the real client names when this codebase moves to the internal environment.
 * // The integer keys must stay in sync with the backend's client_id values.
 */

/**
 * @typedef {Object} ClientConfig
 * @property {number} id           - Opaque integer stored by the backend.
 * @property {string} name         - Human-readable display name (generic label).
 * @property {string} shortName    - Abbreviated label for compact UI slots.
 * @property {number} slaHours     - SLA threshold in hours for this client.
 * @property {number} slaTargetPct - Target SLA compliance percentage (0–100).
 * @property {string} color        - Tailwind CSS text-color class for accent use.
 */

/** @type {ClientConfig[]} */
export const CLIENT_REGISTRY = [
  {
    id:                1,
    name:              'Client Alpha',      // HOOK FOR ENTERPRISE LABELS
    shortName:         'Alpha',
    slaHours:          6,
    slaTargetPct:      95,
    sla_threshold_pct: 95,
    color:             'text-sky-600',
  },
  {
    id:                2,
    name:              'Client Beta',       // HOOK FOR ENTERPRISE LABELS
    shortName:         'Beta',
    slaHours:          8,
    slaTargetPct:      90,
    sla_threshold_pct: 90,
    color:             'text-violet-600',
  },
  {
    id:                3,
    name:              'Client Gamma',      // HOOK FOR ENTERPRISE LABELS
    shortName:         'Gamma',
    slaHours:          4,
    slaTargetPct:      98,
    sla_threshold_pct: 98,
    color:             'text-emerald-600',
  },
  {
    id:                4,
    name:              'Client Delta',      // HOOK FOR ENTERPRISE LABELS
    shortName:         'Delta',
    slaHours:          12,
    slaTargetPct:      85,
    sla_threshold_pct: 85,
    color:             'text-amber-600',
  },
  {
    id:                5,
    name:              'Client Epsilon',    // HOOK FOR ENTERPRISE LABELS
    shortName:         'Epsilon',
    slaHours:          6,
    slaTargetPct:      92,
    sla_threshold_pct: 92,
    color:             'text-rose-600',
  },
];

/**
 * Fast lookup by integer client_id. Returns undefined for unknown ids.
 * @param {number|null|undefined} id
 * @returns {ClientConfig|undefined}
 */
export function getClientById(id) {
  return CLIENT_REGISTRY.find((c) => c.id === id);
}

/**
 * Display name for a client_id, with fallback for unassigned/unknown ids.
 * @param {number|null|undefined} id
 * @returns {string}
 */
export function getClientName(id) {
  if (id == null) return 'Unassigned';
  return getClientById(id)?.name ?? `Client ${id}`;
}

/**
 * Short name for compact UI slots (badge, filter chip, etc.).
 * @param {number|null|undefined} id
 * @returns {string}
 */
export function getClientShortName(id) {
  if (id == null) return '—';
  return getClientById(id)?.shortName ?? String(id);
}
