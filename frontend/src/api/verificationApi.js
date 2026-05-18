import { mockDelay, MOCK_MODE, apiClient } from './client';

/**
 * submitVerdict — record a manual verification verdict for a phone number.
 *
 * MOCK_MODE = false → POST /verification/verdict; triggers refetchPhones
 *                     so the drawer and table both reflect authoritative state.
 * MOCK_MODE = true  → applies verdict to in-memory mock state.
 *
 * Backend VerificationVerdictRequest accepts {phone_id, status, reason, extra_metadata}.
 * There is no top-level operator_id field — attribution is routed into extra_metadata
 * so it is persisted in PhoneNumber.extra_data alongside the verdict.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 * // HOOK FOR ENTERPRISE AUTH: operator_id stamped into extra_metadata below.
 */
export async function submitVerdict(phoneId, status, reason, operatorId, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/verification/verdict', {
      phone_id:       phoneId,
      status,
      reason,
      extra_metadata: operatorId ? { operator_id: operatorId } : undefined,
    });
    await mockDb.refetchPhones();
    return data;
  }

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
