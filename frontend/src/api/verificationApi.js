import { mockDelay } from './client';

/**
 * submitVerdict — record a manual verification verdict for a phone.
 *
 * @param {number} phoneId    - target phone ID
 * @param {string} status     - 'verified_good' | 'verified_bad'
 * @param {string} reason     - operator-supplied reason text
 * @param {string} operatorId - from useAuth()
 * @param {object} mockDb     - MockDataContext value
 *
 * // HOOK FOR REAL API:
 * //   return axios.post('/api/v1/verification/verdict', {
 * //     phone_id: phoneId, status, reason, operator_id: operatorId
 * //   }).then(r => r.data)
 */
export async function submitVerdict(phoneId, status, reason, operatorId, mockDb) {
  await mockDelay(450);
  mockDb.applyVerdict(phoneId, status, reason, operatorId);
  return {
    phone_id:            phoneId,
    verification_status: status,
    verification_source: 'manual',
    verification_reason: reason || null,
    verified_at:         new Date().toISOString(),
  };
}
