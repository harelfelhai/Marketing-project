import { mockDelay, MOCK_MODE, apiClient } from './client';
import { unwrapPage } from './adapters/paginationAdapter';

/**
 * listActionLogs — paginated action audit log with optional filters.
 *
 * MOCK_MODE = false → GET /actions/logs with query params.
 * MOCK_MODE = true  → filters from mockDb.actionLogs.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function listActionLogs(filters = {}, mockDb) {
  if (!MOCK_MODE) {
    const params = { page_size: filters.pageSize || 500 };
    if (filters.status)   params.status   = filters.status;
    if (filters.phone_id) params.phone_id = filters.phone_id;

    const { data } = await apiClient.get('/actions/logs', { params });
    const { items } = unwrapPage(data);
    return items;
  }

  await mockDelay(250);
  let logs = [...(mockDb?.actionLogs || [])];
  if (filters.status)   logs = logs.filter((l) => l.status   === filters.status);
  if (filters.phone_id) logs = logs.filter((l) => l.phone_id === filters.phone_id);
  return logs.sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));
}

/**
 * triggerManualAction — dispatch a named action for a phone number.
 *
 * MOCK_MODE = false → POST /actions/trigger; triggers refetchLogsForPhone
 *                     (Phase D narrowed refetch — GET /actions/logs?phone_id=…
 *                     per the filter-as-view contract §3.3).
 * MOCK_MODE = true  → appends a new log to the in-memory mock state.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 * // HOOK FOR ENTERPRISE AUTH: operator_id sourced from useAuth() by the caller.
 */
export async function triggerManualAction(body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/actions/trigger', {
      phone_id:    body.phone_id,
      action_type: body.action_type,
      operator_id: body.operator_id,
    });
    await mockDb.refetchLogsForPhone(body.phone_id);
    return data;
  }

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
 * retryNow — force-retry a specific failed action log row immediately.
 *
 * MOCK_MODE = false → POST /actions/retry-now/{logId}; triggers
 *                     refetchLogsForPhone(response.phone_id) — Phase D
 *                     narrowed refetch. The response is ActionLogResponse,
 *                     which carries phone_id directly (no extra lookup).
 * MOCK_MODE = true  → marks original log superseded and appends a retry log.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 * // HOOK FOR ENTERPRISE AUTH: operator_id sourced from useAuth() by the caller.
 */
export async function retryNow(logId, operatorId, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post(`/actions/retry-now/${logId}`, {
      operator_id: operatorId || null,
    });
    await mockDb.refetchLogsForPhone(data.phone_id);
    return data;
  }

  await mockDelay(700);
  mockDb.applyRetryNow(logId, operatorId);
  return { log_id: logId, status: 'sent', message: 'Retry dispatched successfully' };
}
