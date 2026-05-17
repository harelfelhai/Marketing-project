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

/** Stable, generic label for display purposes. */
export function labelForActionType(actionType) {
  if (!actionType) return 'Unknown Action';
  // Convert "outreach_a" → "Outreach A"
  return actionType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Lists every action_type known to the seed; used by ManualActionModal. */
export const KNOWN_ACTION_TYPES = ['outreach_a', 'outreach_b', 'outreach_c', 'outreach_d'];
