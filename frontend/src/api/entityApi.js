/**
 * entityApi.js — Phase E2 entity-centric ingestion client.
 *
 * Mirrors the architecture of `ingestionApi.js` (phone-centric):
 *   - Real mode (VITE_USE_REAL_API=true): posts to the backend.
 *   - Mock mode: delegates to MockDataContext mutators for parity.
 *
 * Phase E2-A — createEntity (single-entry). Bulk-text, bulk-upload, and
 * template download will be appended here in subsequent PRs (E2-D).
 */

import { mockDelay, MOCK_MODE, apiClient } from './client';

/**
 * createEntity — submit one named person for entity-centric ingestion.
 *
 * The backend stores `first_name` and `last_name` inside `Entity.extra_data`
 * per the Secrets-Free Mandate — never on schema-level columns. The
 * response echoes them back so the UI's success panel can render the
 * confirmation chip and seed the follow-on phone modal.
 *
 * @param {object} payload   Matches EntitySingleCreateIn:
 *   - first_name       (string, required)
 *   - last_name        (string|null)
 *   - relation_type    ('family' | 'friend' | 'colleague' | 'spouse')
 *   - target_entity_id (number, required)
 *   - extra_data       (object|null)
 * @param {object} mockDb    MockDataContext instance for parity in mock mode.
 * @returns {Promise<object>} EntitySingleCreateOut-shaped object:
 *   { id, client_id, relation_type, target_entity_id, first_name, last_name, created_at }
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function createEntity(payload, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/entities', payload);
    // Entities don't appear in the phones list, so no refetchPhones here.
    // If a refetchEntities path lands later, plug it in.
    return data;
  }

  await mockDelay(400);
  return mockDb.applyCreateEntity(payload);
}
