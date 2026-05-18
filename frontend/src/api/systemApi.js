import { mockDelay, MOCK_MODE, apiClient } from './client';

/**
 * runWorker — trigger a named worker engine pass.
 *
 * MOCK_MODE = false → POST /system/workers/run?worker_name={name}.
 *                     Engine executing state is still managed locally (UI-only
 *                     concern; the server has no concept of per-client spinner).
 *                     On completion, both phones and action logs are refetched
 *                     because a worker pass may touch either table.
 * MOCK_MODE = true  → simulates a 1.5s processing cycle.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function runWorker(engineName, mockDb) {
  if (!MOCK_MODE) {
    mockDb.setEngineExecuting(engineName, true);
    try {
      const { data } = await apiClient.post('/system/workers/run', null, {
        params: { worker_name: engineName },
      });
      mockDb.applyWorkerRun(engineName, data.processed_count);
      await Promise.all([
        mockDb.refetchPhones(),
        mockDb.refetchActionLogs(),
      ]);
      return data;
    } catch (err) {
      mockDb.setEngineExecuting(engineName, false);
      throw err;
    }
  }

  // --- mock path ---
  mockDb.setEngineExecuting(engineName, true);
  await mockDelay(1500);

  const pendingCount = engineName === 'retry'
    ? mockDb.actionLogs.filter((l) => l.status === 'scheduled_retry').length
    : mockDb.phones.filter((p) => p.verification_status === 'pending').length;

  const processedCount = Math.min(pendingCount, Math.ceil(Math.random() * 5) + 1);
  const startedAt      = new Date(Date.now() - 1500).toISOString();
  const completedAt    = new Date().toISOString();

  mockDb.applyWorkerRun(engineName, processedCount);

  return {
    worker_name:     engineName,
    processed_count: processedCount,
    started_at:      startedAt,
    completed_at:    completedAt,
  };
}
