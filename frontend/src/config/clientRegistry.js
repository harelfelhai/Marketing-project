/**
 * clientRegistry.js — maps integer client_id values to UI display metadata.
 *
 * Two-level model: a "client" IS a root entity (target_entity_id IS NULL),
 * and client_id is the DERIVED value target_entity_id ?? id. The keys here are
 * therefore the ids of the root entities that head each client's envelope.
 * Human-readable client names live here — exclusively in the frontend config
 * layer — and (aside from the seed's extra_data names) never appear in the
 * backend schema or API contracts.
 *
 * // HOOK FOR ENTERPRISE LABELS — replace display names and SLA values with
 * // the real client names when this codebase moves to the internal environment.
 * // The integer keys must stay in sync with the root entity ids the backend emits.
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
    id:                1,                    // root entity heading client Alpha
    name:              'Client Alpha',      // HOOK FOR ENTERPRISE LABELS
    shortName:         'Alpha',
    slaHours:          6,
    slaTargetPct:      95,
    sla_threshold_pct: 95,
    color:             'text-sky-600',
  },
  {
    id:                9,                    // root entity heading client Beta
    name:              'Client Beta',       // HOOK FOR ENTERPRISE LABELS
    shortName:         'Beta',
    slaHours:          8,
    slaTargetPct:      90,
    sla_threshold_pct: 90,
    color:             'text-violet-600',
  },
  {
    id:                17,                   // root entity heading client Gamma
    name:              'Client Gamma',      // HOOK FOR ENTERPRISE LABELS
    shortName:         'Gamma',
    slaHours:          4,
    slaTargetPct:      98,
    sla_threshold_pct: 98,
    color:             'text-emerald-600',
  },
  {
    id:                24,                   // root entity heading client Delta
    name:              'Client Delta',      // HOOK FOR ENTERPRISE LABELS
    shortName:         'Delta',
    slaHours:          12,
    slaTargetPct:      85,
    sla_threshold_pct: 85,
    color:             'text-amber-600',
  },
  {
    id:                33,                   // root entity heading client Epsilon
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
