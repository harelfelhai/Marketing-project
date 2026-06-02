/**
 * phoneAdapter — enriches backend PhoneSummary and PhoneDetailsResponse objects
 * with `client_name` resolved from the frontend clientRegistry.
 *
 * The backend stores only the opaque integer root_entity_id. Human-readable display
 * names live exclusively in clientRegistry — they never appear in the backend
 * schema or API contracts. This adapter is the single crossing point.
 *
 * // HOOK FOR ENTERPRISE LABELS — client display names are swapped here by
 * // updating clientRegistry.js, not by changing backend schema.
 */

import { getClientName } from '../../config/clientRegistry';

/**
 * Enrich a PhoneSummary with client_name from the registry.
 * @param {object} phone - Raw PhoneSummary from the backend.
 * @returns {object}
 */
export function enrichPhone(phone) {
  return { ...phone, client_name: getClientName(phone.root_entity_id) };
}

/**
 * Enrich a PhoneDetailsResponse: adds client_name to the nested entity block.
 * @param {object} detail - Raw PhoneDetailsResponse from the backend.
 * @returns {object}
 */
export function enrichPhoneDetail(detail) {
  if (!detail) return detail;
  return {
    ...detail,
    entity: detail.entity
      ? { ...detail.entity, client_name: getClientName(detail.entity.root_entity_id) }
      : detail.entity,
  };
}
