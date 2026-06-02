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

  const { phones } = mockDb;

  const phones_by_verification_status = phones.reduce((acc, p) => {
    acc[p.verification_status] = (acc[p.verification_status] || 0) + 1;
    return acc;
  }, {});

  return {
    total_phones:                  phones.length,
    phones_by_verification_status,
  };
}
