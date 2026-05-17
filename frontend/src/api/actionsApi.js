import { mockDelay } from './client';

/**
 * triggerManualAction — dispatch an action for a phone number.
 *
 * @param {object} body    - { phone_id, action_type, operator_id }
 * @param {object} mockDb  - MockDataContext value
 *
 * // HOOK FOR REAL API:
 * //   return axios.post('/api/v1/actions/trigger', body).then(r => r.data)
 */
export async function triggerManualAction(body, mockDb) {
  await mockDelay(600);
  const phone = mockDb.phones.find((p) => p.id === body.phone_id);
  if (!phone) throw new Error(`Phone ${body.phone_id} not found`);

  const nextId = Math.max(...mockDb.actionLogs.map((l) => l.id), 0) + 1;
  const now    = new Date().toISOString();

  const newLog = {
    id:           nextId,
    phone_id:     body.phone_id,
    action_type:  body.action_type,
    status:       'sent',
    requested_at: now,
    executed_at:  now,
    retry_count:  0,
    retry_after:  null,
    extra_data:   { operator_id: body.operator_id, manual: true },
  };

  mockDb.applyTriggerAction(newLog);
  return newLog;
}

/**
 * retryNow — force a retry on a specific failed action log.
 *
 * // HOOK FOR REAL API:
 * //   return axios.post(`/api/v1/actions/retry-now/${logId}`, { operator_id }).then(r => r.data)
 */
export async function retryNow(logId, operatorId, mockDb) {
  await mockDelay(700);
  mockDb.applyRetryNow(logId, operatorId);
  return { log_id: logId, status: 'sent', message: 'Retry dispatched successfully' };
}

/**
 * listActionLogs — fetch the unified action audit log.
 *
 * @param {object} filters  - { status, phone_id }
 * @param {object} mockDb   - MockDataContext value
 *
 * // HOOK FOR REAL API:
 * //   return axios.get('/api/v1/actions/logs', { params: filters }).then(r => r.data)
 */
export async function listActionLogs(filters = {}, mockDb) {
  await mockDelay(250);
  let logs = [...mockDb.actionLogs];

  if (filters.status) {
    logs = logs.filter((l) => l.status === filters.status);
  }
  if (filters.phone_id) {
    logs = logs.filter((l) => l.phone_id === filters.phone_id);
  }

  return logs.sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));
}
