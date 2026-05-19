/**
 * chatChannelRegistry.js — frontend-only mapping of opaque chat tokens
 * to display labels (Phase NOTIF).
 *
 * The backend stores only the opaque `id` strings — Slack channel ids,
 * webhook URLs, Teams emails. The display labels and the "what kind
 * of channel is this" annotation live HERE so the open-source
 * codebase never knows what real chat workspace a deployment uses.
 *
 * // HOOK FOR ENTERPRISE LABELS — replace these entries with the real
 * // chat channels when this codebase moves to the internal
 * // environment. The opaque `id` values must stay in sync with what
 * // the configured NotificationChannel module recognises.
 *
 * Convention:
 *   - `id`     : the opaque token the backend persists on
 *                NotificationSubscription.recipients
 *   - `label`  : the Hebrew display string operators see in the
 *                recipient picker
 *   - `kind`   : optional annotation ('slack' | 'teams' | 'webhook' |
 *                'email') so the picker can render a small icon /
 *                badge alongside the label. Purely cosmetic.
 */

/**
 * @typedef {Object} ChatChannel
 * @property {string} id
 * @property {string} label
 * @property {'slack'|'teams'|'webhook'|'email'} kind
 */

/** @type {ChatChannel[]} */
export const CHAT_CHANNELS = [
  // Generic / placeholder entries the open repo ships with. Real
  // deployments overwrite them in this file.
  { id: 'ops-alerts',          label: 'התראות מבצעיות',         kind: 'slack'   },
  { id: 'manager-channel',     label: 'ערוץ ניהול',             kind: 'slack'   },
  { id: 'oncall-webhook',      label: 'Webhook — תורנות',       kind: 'webhook' },
  { id: 'qa-team-channel',     label: 'ערוץ צוות QA',           kind: 'teams'   },
];


/**
 * Fast lookup by id. Returns undefined for unknown tokens.
 * @param {string} id
 * @returns {ChatChannel|undefined}
 */
export function getChannelById(id) {
  return CHAT_CHANNELS.find((c) => c.id === id);
}


/**
 * Display label for an opaque chat-channel id, with a clear fallback
 * for unknown tokens. Same convention as `getClientName` so callers
 * never have to defend against undefined.
 *
 * @param {string} id
 * @returns {string}
 */
export function getChannelLabel(id) {
  if (id == null || id === '') return '—';
  const found = getChannelById(id);
  return found?.label ?? `Channel ${id}`;
}
