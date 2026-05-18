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
import { listPhones }     from '../api/phonesApi';
import { listActionLogs } from '../api/actionsApi';
import { CLIENT_REGISTRY } from '../config/clientRegistry';

const MockDataContext = createContext(null);

// Minimal empty db used as the real-mode boot state while the API hydrates.
const EMPTY_DB = {
  clients:    [],
  entities:   [],
  phones:     [],
  actionLogs: [],
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
  // Fetches phones + action logs, synthesizes entities, seeds clients from
  // clientRegistry. Components stay unchanged — they read context as before.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (MOCK_MODE) return;

    setLoading(true);
    Promise.all([
      listPhones({ pageSize: 200 }),
      listActionLogs({ pageSize: 500 }),
    ])
      .then(([phonesData, logsData]) => {
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
          entities:   Array.from(entityMap.values()),
          clients:    CLIENT_REGISTRY,
        }));
      })
      .finally(() => setLoading(false));
  }, []);

  // Expose raw state slices
  const { clients, entities, phones, actionLogs, engines } = db;

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
    engines,
    loading,
    // Invalidation / refetch (real-API mode — no-op in mock mode)
    refetchPhones,
    refetchActionLogs,
    // Mutators (mock mode — apply*; real-API mode — used only for engine UI state)
    applyIngest,
    applyPatchPhone,
    applyVerdict,
    applyRetryNow,
    applyTriggerAction,
    applyWorkerRun,
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
