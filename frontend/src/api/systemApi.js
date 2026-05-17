import { mockDelay } from './client';

/**
 * runWorker — trigger a named worker engine pass.
 *
 * Simulates a 1.5s processing cycle and returns a WorkerRunResponse.
 * Engine executing state is managed in MockDataContext so the spinner
 * persists across tab switches (UI robustness mandate).
 *
 * @param {string} engineName  - 'retry' | 'verification'
 * @param {object} mockDb      - MockDataContext value
 *
 * // HOOK FOR REAL API:
 * //   return axios.post(`/api/v1/system/workers/run?worker_name=${engineName}`)
 * //              .then(r => r.data)
 */
export async function runWorker(engineName, mockDb) {
  mockDb.setEngineExecuting(engineName, true);
  await mockDelay(1500);

  // Simulate a plausible processed count based on pending work.
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
