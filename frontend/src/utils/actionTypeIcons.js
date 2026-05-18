/**
 * actionTypeIcons — maps abstract action_type tokens to lucide icons.
 *
 * Tokens are generic ('outreach_a', 'outreach_b', ...) per the secrets-free
 * mandate. Real action types will swap into this map in production.
 * // HOOK FOR ENTERPRISE LABELS
 */

import { Mail, Phone, Send, MessageSquare, Zap } from 'lucide-react';

const ICONS = {
  outreach_a: Mail,
  outreach_b: Phone,
  outreach_c: Send,
  outreach_d: MessageSquare,
};

export function iconForActionType(actionType) {
  return ICONS[actionType] || Zap;
}

// // HOOK FOR ENTERPRISE LABELS — Hebrew display labels for action type tokens.
const LABELS_HE = {
  outreach_a: 'פנייה א',
  outreach_b: 'פנייה ב',
  outreach_c: 'פנייה ג',
  outreach_d: 'פנייה ד',
};

/** Stable, generic label for display purposes. */
export function labelForActionType(actionType) {
  if (!actionType) return 'פעולה לא ידועה';
  return LABELS_HE[actionType] || actionType;
}

/** Lists every action_type known to the seed; used by ManualActionModal. */
export const KNOWN_ACTION_TYPES = ['outreach_a', 'outreach_b', 'outreach_c', 'outreach_d'];
