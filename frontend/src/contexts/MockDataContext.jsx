/**
 * MockDataContext — in-memory database, mutators, and API hydration.
 *
 * MOCK_MODE = true  → boots from static seed (buildInitialDb), no network traffic.
 * MOCK_MODE = false → hydrates phones + actionLogs from the real API on mount;
 *                     clients come from clientRegistry, entities are synthesized
 *                     from the phone JOIN data returned by the backend.
 *
 * The mutator API is identical in both modes. Phase C replaces mock mutator calls
 * with real HTTP inside api/*.js — this context is never modified for that swap.
 *
 * // HOOK FOR ENTERPRISE AUTH — operatorId for attributed mutations is supplied
 * // by MockAuthContext, not read here. This context stays attribution-agnostic.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { buildInitialDb, deriveClientMetrics } from '../mock/mockData';
import { MOCK_MODE } from '../api/client';
import { listPhones, getPhoneDetail }     from '../api/phonesApi';
import { listActionLogs }                  from '../api/actionsApi';
import { listTasks, getTaskDetail }        from '../api/tasksApi';
import { CLIENT_REGISTRY } from '../config/clientRegistry';

const MockDataContext = createContext(null);

// Minimal empty db used as the real-mode boot state while the API hydrates.
const EMPTY_DB = {
  clients:    [],
  entities:   [],
  phones:     [],
  actionLogs: [],
  tasks:      [],
  engines:    {
    retry:        { executing: false, lastRunAt: null, lastProcessedCount: 0 },
    verification: { executing: false, lastRunAt: null, lastProcessedCount: 0 },
  },
};

export function MockDataProvider({ children }) {
  const [db, setDb]           = useState(MOCK_MODE ? buildInitialDb : () => EMPTY_DB);
  const [loading, setLoading] = useState(!MOCK_MODE);

  // ---------------------------------------------------------------------------
  // Real-API boot hydration — fires once on mount when MOCK_MODE = false.
  // Fetches phones + action logs + tasks, synthesizes entities, seeds clients
  // from clientRegistry. Components stay unchanged — they read context as before.
  //
  // Phase DX amendment to Phase D exit gate §6.2.3: the original "exactly two
  // parallel requests" rule generalises to "exactly N parallel requests where
  // N = independent top-level cache slices." With the tasks slice introduced,
  // N is now 3.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (MOCK_MODE) return;

    setLoading(true);
    Promise.all([
      listPhones({ pageSize: 200 }),
      listActionLogs({ pageSize: 500 }),
      listTasks({ pageSize: 500 }),
    ])
      .then(([phonesData, logsData, tasksData]) => {
        // Synthesize entities from the phone JOIN data.
        // Each phone carries entity_id, entity_type, and client_id from the backend.
        const entityMap = new Map();
        phonesData.forEach((p) => {
          if (!entityMap.has(p.entity_id)) {
            entityMap.set(p.entity_id, {
              id:          p.entity_id,
              entity_type: p.entity_type,
              client_id:   p.client_id,
            });
          }
        });

        setDb((prev) => ({
          ...prev,
          phones:     phonesData,
          actionLogs: logsData,
          tasks:      tasksData,
          entities:   Array.from(entityMap.values()),
          clients:    CLIENT_REGISTRY,
        }));
      })
      .finally(() => setLoading(false));
  }, []);

  // Expose raw state slices
  const { clients, entities, phones, actionLogs, tasks, engines } = db;

  // ---------------------------------------------------------------------------
  // refetchPhones — re-hydrates phones + entities from the server.
  // No-op in mock mode. Called by API mutation functions after successful HTTP
  // mutations to enforce the server-as-single-source-of-truth contract.
  // ---------------------------------------------------------------------------
  const refetchPhones = useCallback(async () => {
    if (MOCK_MODE) return;
    const phonesData = await listPhones({ pageSize: 200 });
    const entityMap  = new Map();
    phonesData.forEach((p) => {
      if (!entityMap.has(p.entity_id)) {
        entityMap.set(p.entity_id, {
          id:          p.entity_id,
          entity_type: p.entity_type,
          client_id:   p.client_id,
        });
      }
    });
    setDb((prev) => ({
      ...prev,
      phones:   phonesData,
      entities: Array.from(entityMap.values()),
    }));
  }, []);

  // ---------------------------------------------------------------------------
  // refetchActionLogs — re-hydrates action logs from the server.
  // No-op in mock mode.
  // ---------------------------------------------------------------------------
  const refetchActionLogs = useCallback(async () => {
    if (MOCK_MODE) return;
    const logsData = await listActionLogs({ pageSize: 500 });
    setDb((prev) => ({ ...prev, actionLogs: logsData }));
  }, []);

  // ---------------------------------------------------------------------------
  // Phase D — targeted SWR-style merges (real-API mode only).
  //
  // These helpers swap the wholesale refetch pattern for narrow updates keyed
  // by id. The single-item mutation paths (verdict, patch, retry, trigger)
  // call into refetchPhoneById / refetchLogsForPhone instead of dragging the
  // full list down on every change. Ingest and runWorker keep the full
  // refetch because their blast radius is wider than one id.
  //
  // mergePhoneById   — replace by id, append if new; rebuild the synthetic
  //                    entity entry from the merged phone so derived selectors
  //                    (getClientForPhone, deriveClientMetrics) stay coherent.
  // mergeLogsByPhoneId — drop existing logs for phoneId, splice in fresh batch.
  //                    Used after triggerManualAction / retryNow to keep the
  //                    drawer timeline and failed-actions table in sync.
  // ---------------------------------------------------------------------------

  const mergePhoneById = useCallback((flatPhone) => {
    if (!flatPhone || flatPhone.id == null) return;
    setDb((prev) => {
      const exists = prev.phones.some((p) => p.id === flatPhone.id);
      const phones = exists
        ? prev.phones.map((p) => (p.id === flatPhone.id ? flatPhone : p))
        : [...prev.phones, flatPhone];

      // Keep the synthetic entities list consistent with the JOIN data
      // that now lives on the merged phone row.
      const entityMap = new Map(prev.entities.map((e) => [e.id, e]));
      if (flatPhone.entity_id != null) {
        entityMap.set(flatPhone.entity_id, {
          id:          flatPhone.entity_id,
          entity_type: flatPhone.entity_type,
          client_id:   flatPhone.client_id,
        });
      }
      return { ...prev, phones, entities: Array.from(entityMap.values()) };
    });
  }, []);

  const mergeLogsByPhoneId = useCallback((phoneId, freshLogs) => {
    if (phoneId == null) return;
    setDb((prev) => {
      const others = prev.actionLogs.filter((l) => l.phone_id !== phoneId);
      return { ...prev, actionLogs: [...others, ...freshLogs] };
    });
  }, []);

  // spliceActionLog — replace-by-id or append a SINGLE ActionLog that the
  // server has already delivered to us inside another response body.
  //
  // Today's only caller is patchPhone, which can receive a
  // PhoneUpdateResponse.triggered_action when ActionDataTriggerService
  // fires a re-dispatch as a side-effect of the PATCH. The log is server-
  // authoritative (just delivered inline rather than via a follow-up GET),
  // so splicing it into the cache is consistent with §7.5 — not optimistic.
  const spliceActionLog = useCallback((log) => {
    if (!log || log.id == null) return;
    setDb((prev) => {
      const exists = prev.actionLogs.some((l) => l.id === log.id);
      const next = exists
        ? prev.actionLogs.map((l) => (l.id === log.id ? log : l))
        : [...prev.actionLogs, log];
      return { ...prev, actionLogs: next };
    });
  }, []);

  // refetchPhoneById — narrow refetch for single-phone mutations.
  // Uses GET /phones/{id}; flattens the detail-shape response (entity nested,
  // action_timeline included) back into the list-shape PhoneSummary stored
  // in db.phones, so consumers continue to see the same shape they do after
  // the wholesale refetchPhones() boot path.
  const refetchPhoneById = useCallback(async (id) => {
    if (MOCK_MODE || id == null) return;
    const detail = await getPhoneDetail(id);
    const { entity, action_timeline, ...rest } = detail;
    const flat = {
      ...rest,
      entity_type: entity?.entity_type,
      client_id:   entity?.client_id,
      client_name: entity?.client_name,
    };
    mergePhoneById(flat);
  }, [mergePhoneById]);

  // refetchLogsForPhone — narrow refetch for log-touching mutations.
  // Uses GET /actions/logs?phone_id=... (filter-as-view per §3.3) rather
  // than a dedicated endpoint, so no backend changes are required.
  const refetchLogsForPhone = useCallback(async (phoneId) => {
    if (MOCK_MODE || phoneId == null) return;
    const fresh = await listActionLogs({ phone_id: phoneId });
    mergeLogsByPhoneId(phoneId, fresh);
  }, [mergeLogsByPhoneId]);

  // ---------------------------------------------------------------------------
  // Phase DX — Pipeline tasks cache slice.
  //
  // mergeTaskById   — replace-by-id or append a single task. Same merge
  //                   primitive as mergePhoneById / spliceActionLog.
  // refetchTasks    — wholesale; used by openTask (new server-assigned id).
  // refetchTaskById — narrow refetch keyed by id; used by resolveTask.
  // ---------------------------------------------------------------------------

  const mergeTaskById = useCallback((task) => {
    if (!task || task.id == null) return;
    setDb((prev) => {
      const exists = prev.tasks.some((t) => t.id === task.id);
      const next = exists
        ? prev.tasks.map((t) => (t.id === task.id ? task : t))
        : [...prev.tasks, task];
      return { ...prev, tasks: next };
    });
  }, []);

  const refetchTasks = useCallback(async () => {
    if (MOCK_MODE) return;
    const fresh = await listTasks({ pageSize: 500 });
    setDb((prev) => ({ ...prev, tasks: fresh }));
  }, []);

  const refetchTaskById = useCallback(async (id) => {
    if (MOCK_MODE || id == null) return;
    const fresh = await getTaskDetail(id);
    mergeTaskById(fresh);
  }, [mergeTaskById]);

  // -------------------------------------------------------------------------
  // applyIngest
  // -------------------------------------------------------------------------
  const applyIngest = useCallback((payload) => {
    setDb((prev) => {
      const nextEntityId = Math.max(...prev.entities.map((e) => e.id), 0) + 1;
      const nextPhoneId  = Math.max(...prev.phones.map((p) => p.id), 0) + 1;
      const now = new Date().toISOString();

      const newEntity = {
        id:          nextEntityId,
        entity_type: payload.entity_type || 'target',
        client_id:   payload.client_id || null,
        extra_data:  payload.entity_extra || {},
      };

      const newPhone = {
        id:                  nextPhoneId,
        entity_id:           nextEntityId,
        phone_number:        payload.phone_number,
        classification_type: payload.classification_type || null,
        ingestion_source:    payload.ingestion_source,
        ingestion_reason:    payload.ingestion_reason || null,
        ingested_at:         now,
        verification_status: 'pending',
        verification_source: null,
        verification_reason: null,
        verified_at:         null,
        created_at:          now,
        updated_at:          now,
        extra_data:          {},
      };

      return {
        ...prev,
        entities:   [...prev.entities, newEntity],
        phones:     [...prev.phones, newPhone],
      };
    });
  }, []);

  // -------------------------------------------------------------------------
  // applyPatchPhone
  // -------------------------------------------------------------------------
  const applyPatchPhone = useCallback((phoneId, partial) => {
    setDb((prev) => ({
      ...prev,
      phones: prev.phones.map((p) =>
        p.id === phoneId
          ? { ...p, ...partial, updated_at: new Date().toISOString() }
          : p
      ),
    }));
  }, []);

  // -------------------------------------------------------------------------
  // applyVerdict
  // -------------------------------------------------------------------------
  const applyVerdict = useCallback((phoneId, status, reason, operatorId) => {
    setDb((prev) => ({
      ...prev,
      phones: prev.phones.map((p) =>
        p.id === phoneId
          ? {
              ...p,
              verification_status: status,
              verification_source: 'manual',
              verification_reason: reason || null,
              verified_at:         new Date().toISOString(),
              updated_at:          new Date().toISOString(),
              extra_data:          { ...p.extra_data, last_verdict_by: operatorId },
            }
          : p
      ),
    }));
  }, []);

  // -------------------------------------------------------------------------
  // applyRetryNow
  // -------------------------------------------------------------------------
  const applyRetryNow = useCallback((logId, operatorId) => {
    setDb((prev) => {
      const original = prev.actionLogs.find((l) => l.id === logId);
      if (!original) return prev;

      const nextId = Math.max(...prev.actionLogs.map((l) => l.id), 0) + 1;
      const now    = new Date().toISOString();

      const retryLog = {
        id:           nextId,
        phone_id:     original.phone_id,
        action_type:  original.action_type,
        status:       'sent',
        requested_at: now,
        executed_at:  now,
        retry_count:  0,
        retry_after:  null,
        extra_data:   { operator_id: operatorId, manual_retry_of: logId },
      };

      const updatedLogs = prev.actionLogs.map((l) =>
        l.id === logId ? { ...l, status: 'superseded', updated_at: now } : l
      );

      return { ...prev, actionLogs: [...updatedLogs, retryLog] };
    });
  }, []);

  // -------------------------------------------------------------------------
  // applyTriggerAction
  // -------------------------------------------------------------------------
  const applyTriggerAction = useCallback((newLog) => {
    setDb((prev) => ({ ...prev, actionLogs: [...prev.actionLogs, newLog] }));
  }, []);

  // -------------------------------------------------------------------------
  // applyWorkerRun
  // -------------------------------------------------------------------------
  const applyWorkerRun = useCallback((engineName, processedCount) => {
    setDb((prev) => ({
      ...prev,
      engines: {
        ...prev.engines,
        [engineName]: {
          ...prev.engines[engineName],
          lastRunAt:          new Date().toISOString(),
          lastProcessedCount: processedCount,
          executing:          false,
        },
      },
    }));
  }, []);

  // -------------------------------------------------------------------------
  // setEngineExecuting
  // -------------------------------------------------------------------------
  const setEngineExecuting = useCallback((engineName, executing) => {
    setDb((prev) => ({
      ...prev,
      engines: {
        ...prev.engines,
        [engineName]: { ...prev.engines[engineName], executing },
      },
    }));
  }, []);

  // -------------------------------------------------------------------------
  // applyOpenTask  (mock-mode only; the real path uses refetchTasks)
  //
  // Synthesises a new pending task from the openTask payload. JOIN fields
  // (phone_number, entity_id, entity_type, client_id) are filled by looking
  // up the related phone/entity in the current cache so the mock shape
  // matches the real-API JOIN exactly.
  // -------------------------------------------------------------------------
  const applyOpenTask = useCallback((payload) => {
    setDb((prev) => {
      const nextId = Math.max(...prev.tasks.map((t) => t.id), 0) + 1;
      const now    = new Date().toISOString();
      const phone  = prev.phones.find((p) => p.id === payload.phone_id);
      const entity = phone ? prev.entities.find((e) => e.id === phone.entity_id) : null;

      const newTask = {
        id:                   nextId,
        phone_id:             payload.phone_id,
        source_action_log_id: payload.source_action_log_id ?? null,
        task_type:            payload.task_type,
        status:               'pending',
        requested_by:         payload.requested_by,
        resolved_by:          null,
        created_at:           now,
        updated_at:           now,
        resolved_at:          null,
        extra_data:           payload.extra_data ?? null,
        // JOIN-shape echo so consumers see identical structure to real mode.
        phone_number:         phone?.phone_number ?? null,
        entity_id:            phone?.entity_id    ?? null,
        entity_type:          entity?.entity_type ?? null,
        client_id:            entity?.client_id   ?? null,
      };
      return { ...prev, tasks: [...prev.tasks, newTask] };
    });
  }, []);

  // -------------------------------------------------------------------------
  // applyResolveTask  (mock-mode only; real path uses refetchTaskById)
  //
  // Writes the terminal state and merges resolution_outcome / resolved_by /
  // resolution_note into extra_data — same shape the backend service produces.
  // -------------------------------------------------------------------------
  const applyResolveTask = useCallback((taskId, body) => {
    setDb((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const now = new Date().toISOString();
        const merged = {
          ...(t.extra_data || {}),
          resolution_outcome: body.outcome,
          resolved_by:        body.operator_id,
        };
        if (body.resolution_note != null) {
          merged.resolution_note = body.resolution_note;
        }
        return {
          ...t,
          status:      body.outcome,
          resolved_by: body.operator_id,
          resolved_at: now,
          updated_at:  now,
          extra_data:  merged,
        };
      }),
    }));
  }, []);

  // -------------------------------------------------------------------------
  // Derived helpers
  // -------------------------------------------------------------------------
  const getClientMetrics = useCallback(
    (clientId) => deriveClientMetrics(clientId, phones, actionLogs, entities),
    [phones, actionLogs, entities]
  );

  const getEntityById = useCallback(
    (entityId) => entities.find((e) => e.id === entityId) || null,
    [entities]
  );

  const getPhoneById = useCallback(
    (phoneId) => phones.find((p) => p.id === phoneId) || null,
    [phones]
  );

  const getLogsForPhone = useCallback(
    (phoneId) => actionLogs.filter((l) => l.phone_id === phoneId),
    [actionLogs]
  );

  const getClientForPhone = useCallback(
    (phoneId) => {
      const phone  = phones.find((p) => p.id === phoneId);
      if (!phone) return null;
      const entity = entities.find((e) => e.id === phone.entity_id);
      if (!entity) return null;
      return clients.find((c) => c.id === entity.client_id) || null;
    },
    [phones, entities, clients]
  );

  const value = {
    // State slices
    clients,
    entities,
    phones,
    actionLogs,
    tasks,
    engines,
    loading,
    // Invalidation / refetch (real-API mode — no-op in mock mode)
    refetchPhones,
    refetchActionLogs,
    refetchTasks,
    // Phase D / DX — narrowed refetches (real-API mode only; no-op in mock mode).
    // Consumers should prefer these over the wholesale refetches when the
    // mutation scope is a single id.
    refetchPhoneById,
    refetchLogsForPhone,
    refetchTaskById,
    spliceActionLog,
    // Mutators (mock mode — apply*; real-API mode — used only for engine UI state)
    applyIngest,
    applyPatchPhone,
    applyVerdict,
    applyRetryNow,
    applyTriggerAction,
    applyWorkerRun,
    applyOpenTask,
    applyResolveTask,
    setEngineExecuting,
    // Derived helpers
    getClientMetrics,
    getEntityById,
    getPhoneById,
    getLogsForPhone,
    getClientForPhone,
  };

  return (
    <MockDataContext.Provider value={value}>
      {children}
    </MockDataContext.Provider>
  );
}

export function useMockData() {
  const ctx = useContext(MockDataContext);
  if (!ctx) throw new Error('useMockData must be used within MockDataProvider');
  return ctx;
}
