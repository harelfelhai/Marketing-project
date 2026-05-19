import { mockDelay, MOCK_MODE, apiClient } from './client';

/**
 * getDashboardMetrics — aggregated pipeline counts.
 *
 * MOCK_MODE = false → GET /dashboard/metrics (flat response, no adapter needed).
 * MOCK_MODE = true  → derived from mockDb state (same field names as backend).
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function getDashboardMetrics(mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.get('/dashboard/metrics');
    return data;
  }

  await mockDelay(300);

  const { phones, actionLogs } = mockDb;
  const now = new Date();

  const phones_by_verification_status = phones.reduce((acc, p) => {
    acc[p.verification_status] = (acc[p.verification_status] || 0) + 1;
    return acc;
  }, {});

  const actions_by_status = actionLogs.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  const retryQueue     = actionLogs.filter((l) => l.status === 'scheduled_retry');
  const overdue_retries = retryQueue.filter(
    (l) => l.retry_after && new Date(l.retry_after) < now
  ).length;

  return {
    total_phones:                  phones.length,
    phones_by_verification_status,
    total_actions:                 actionLogs.length,
    actions_by_status,
    retry_queue_depth:             retryQueue.length,
    overdue_retries,
  };
}
