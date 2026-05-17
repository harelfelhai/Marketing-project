import { mockDelay } from './client';

/**
 * getDashboardMetrics — aggregate counts matching the backend DashboardMetricsResponse.
 *
 * Derived entirely from MockDataContext state — no extra network call needed.
 *
 * @param {object} mockDb  - MockDataContext value
 *
 * // HOOK FOR REAL API:
 * //   return axios.get('/api/v1/dashboard/metrics').then(r => r.data)
 */
export async function getDashboardMetrics(mockDb) {
  await mockDelay(300);

  const { phones, actionLogs } = mockDb;
  const now = new Date();

  const phonesByStatus = phones.reduce((acc, p) => {
    acc[p.verification_status] = (acc[p.verification_status] || 0) + 1;
    return acc;
  }, {});

  const actionsByStatus = actionLogs.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  const retryQueue = actionLogs.filter((l) => l.status === 'scheduled_retry');
  const overdueRetries = retryQueue.filter(
    (l) => l.retry_after && new Date(l.retry_after) < now
  ).length;

  return {
    total_phones:                 phones.length,
    phones_by_verification_status: phonesByStatus,
    total_actions:                actionLogs.length,
    actions_by_status:            actionsByStatus,
    retry_queue_depth:            retryQueue.length,
    overdue_retries:              overdueRetries,
  };
}
