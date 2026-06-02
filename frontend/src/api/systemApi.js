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


// ---------------------------------------------------------------------------
// System Settings tab (admin-only infrastructure controls)
// ---------------------------------------------------------------------------

/**
 * getSystemSettings — read the active storage backend + the catalog of
 * known backends (each flagged `available`).
 *
 * MOCK_MODE = false → GET /system/settings.
 * MOCK_MODE = true  → MockDataContext.applyGetSystemSettings().
 *
 * @param {object} mockDb  MockDataContext instance for parity in mock mode.
 * @returns {Promise<object>} { storage_backend, backends:[{id,available}], applies_on_restart }
 */
export async function getSystemSettings(mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.get('/system/settings');
    return data;
  }
  await mockDelay(200);
  return mockDb.applyGetSystemSettings();
}

/**
 * updateSystemSettings — persist a new storage backend selection. Rejects
 * (throws) for unknown / not-yet-available backends, mirroring the
 * backend's 422 contract.
 *
 * @param {object} payload  { storage_backend: 'sql' | 'mongo' }
 * @param {object} mockDb   MockDataContext instance.
 * @returns {Promise<object>} The updated settings object.
 */
export async function updateSystemSettings(payload, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.put('/system/settings', payload);
    return data;
  }
  await mockDelay(300);
  return mockDb.applyUpdateSystemSettings(payload);
}

/**
 * updateDisplayFields — set the ordered visible-field selection for one
 * surface (e.g. 'entities'). Returns the full updated settings object.
 *
 * @param {string}   surface  Surface id.
 * @param {string[]} fields   Ordered visible field keys.
 * @param {object}   mockDb   MockDataContext instance.
 */
export async function updateDisplayFields(surface, fields, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.put('/system/settings/display-fields',
                                         { surface, fields });
    return data;
  }
  await mockDelay(200);
  return mockDb.applyUpdateDisplayFields(surface, fields);
}

/**
 * updateMongoUrl — validate and persist a MongoDB connection URL server-side.
 *
 * The URL is WRITE-ONLY from the frontend's perspective. The response only
 * carries the boolean `mongo_configured` flag (never the URL itself).
 *
 * MOCK_MODE = false → PUT /system/settings/mongo-url
 * MOCK_MODE = true  → MockDataContext.applyUpdateMongoUrl() — always succeeds
 *                     (simulates a 600 ms connection probe).
 *
 * @param {string} url    MongoDB connection string.
 * @param {object} mockDb MockDataContext instance.
 * @returns {Promise<object>} The full updated settings object.
 */
export async function updateMongoUrl(url, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.put('/system/settings/mongo-url', { url });
    return data;
  }
  await mockDelay(600);
  return mockDb.applyUpdateMongoUrl(url);
}
