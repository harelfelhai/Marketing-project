import { mockDelay, MOCK_MODE, apiClient } from './client';

/**
 * submitVerdict — record a manual verification verdict for a phone number.
 *
 * Phase DY-4 — TWO-AXIS payload shape.
 *
 * The legacy single-status call site (4 positional args) is preserved:
 *     submitVerdict(phoneId, status, reason, operatorId, mockDb)
 *
 * The new call site accepts a single object with the full DY-4 contract:
 *     submitVerdict(phoneId, {
 *         phone_axis?:      'confirm' | 'refute',
 *         relation_axis?:   'confirm' | 'refute',
 *         identification?: { first_name?, last_name?, relation? },
 *         reason?:          string,
 *     }, operatorId, mockDb)
 *
 * Detection: if the SECOND argument is an object with NO `status` key
 * (and at least one of phone_axis / relation_axis / identification), it
 * is routed as DY-4. Otherwise (object with `status`, OR a plain string),
 * the legacy shape is sent.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 * // HOOK FOR ENTERPRISE AUTH: operator_id stamped into extra_metadata below.
 */
export async function submitVerdict(phoneId, second, reasonOrOperator, operatorOrMockDb, mockDbMaybe) {
  // Argument shape detection. The legacy signature has `second` as a
  // status string; the DY-4 signature has it as a payload object.
  const isObjectPayload = typeof second === 'object' && second !== null;

  // Normalise to a unified `payload` and resolve operatorId/mockDb across
  // both call shapes.
  let payload;
  let operatorId;
  let mockDb;

  if (isObjectPayload) {
    payload    = second;
    operatorId = reasonOrOperator;
    mockDb     = operatorOrMockDb;
  } else {
    // Legacy: (phoneId, status, reason, operatorId, mockDb)
    payload    = { status: second, reason: reasonOrOperator };
    operatorId = operatorOrMockDb;
    mockDb     = mockDbMaybe;
  }

  if (!MOCK_MODE) {
    const body = {
      phone_id:       phoneId,
      extra_metadata: operatorId ? { operator_id: operatorId } : undefined,
    };
    if (payload.status)         body.status         = payload.status;
    if (payload.reason)         body.reason         = payload.reason;
    if (payload.phone_axis)     body.phone_axis     = payload.phone_axis;
    if (payload.relation_axis)  body.relation_axis  = payload.relation_axis;
    if (payload.identification) body.identification = payload.identification;

    const { data } = await apiClient.post('/verification/verdict', body);
    await mockDb.refetchPhoneById(phoneId);
    return data;
  }

  await mockDelay(450);
  if (payload.status) {
    mockDb.applyVerdict(phoneId, payload.status, operatorId);
  } else {
    mockDb.applyTwoAxisVerdict?.(phoneId, payload, operatorId);
  }
  return {
    phone_id:            phoneId,
    verification_status: payload.status
      ?? (payload.relation_axis === 'confirm' ? 'verified'
        : payload.relation_axis === 'refute'  ? 'rejected'
        : undefined),
  };
}
