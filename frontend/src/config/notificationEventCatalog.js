/**
 * notificationEventCatalog.js — controlled vocabulary of trigger events,
 * scoped per target kind (Phase NOTIF).
 *
 * The backend stores `trigger_event_type` as a free-form indexed
 * string (the vocab will lock when business defines triggers). This
 * file is the frontend's source of truth for:
 *   - which event tokens to OFFER operators per context (phone /
 *     entity / task / global)
 *   - the Hebrew display label per token
 *   - which events are PRE-SELECTED in the OptInPanel by default
 *
 * Convention:
 *   `key`     - opaque token persisted on the backend
 *   `label`   - Hebrew display string shown in the OptInPanel
 *   `default` - if true, this checkbox is pre-checked when the
 *               operator opens the panel for the first time
 *
 * // HOOK FOR ENTERPRISE LABELS — replace labels per locale. The
 * // keys are the API contract; renaming them breaks subscriptions.
 */

/**
 * @typedef {Object} NotifEvent
 * @property {string} key
 * @property {string} label
 * @property {boolean} [default]
 */

/** @type {Record<string, NotifEvent[]>} */
export const NOTIFICATION_EVENT_CATALOG = {
  phone: [
    { key: 'phone.verification.changed', label: 'שינוי סטטוס אימות',  default: true  },
    { key: 'phone.action.failed',        label: 'כשל בפעולה',           default: true  },
    { key: 'phone.action.sent',          label: 'פעולה נשלחה בהצלחה',                 },
    { key: 'phone.classification.changed', label: 'שינוי סיווג',                       },
  ],
  entity: [
    { key: 'entity.phone.added',         label: 'מספר טלפון חדש נוסף לאדם', default: true },
    { key: 'entity.relation.changed',    label: 'שינוי בקרבה לישות הראשית',              },
  ],
  task: [
    { key: 'task.resolved',              label: 'המשימה טופלה', default: true },
    { key: 'task.rejected',              label: 'המשימה נדחתה',                },
    { key: 'task.escalated',             label: 'הסלמת משימה',                  },
  ],
  global: [
    { key: 'system.heartbeat',           label: 'דופק מערכת',                  },
    { key: 'system.engine.failed',       label: 'כשל במנוע אוטומציה',          },
  ],
};


/**
 * Return the catalog for a target kind, or [] when unknown. Defensive
 * against future target kinds the frontend hasn't been taught yet.
 *
 * @param {string} targetKind
 * @returns {NotifEvent[]}
 */
export function getEventCatalog(targetKind) {
  return NOTIFICATION_EVENT_CATALOG[targetKind] || [];
}


/**
 * Convenience: the default-checked event keys for a target kind.
 *
 * @param {string} targetKind
 * @returns {string[]}
 */
export function getDefaultEventKeys(targetKind) {
  return getEventCatalog(targetKind)
    .filter((e) => e.default)
    .map((e) => e.key);
}
