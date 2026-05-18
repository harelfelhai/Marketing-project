import { mockDelay, MOCK_MODE, apiClient } from './client';
import { unwrapPage }                        from './adapters/paginationAdapter';
import { enrichPhone, enrichPhoneDetail }    from './adapters/phoneAdapter';

/**
 * listPhones — returns phone records matching the given filters.
 *
 * MOCK_MODE = false → GET /phones with query params; items enriched via phoneAdapter.
 *                     `search` filter is applied client-side (no backend full-text).
 * MOCK_MODE = true  → filters and returns from in-memory mockDb.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function listPhones(filters = {}, mockDb) {
  if (!MOCK_MODE) {
    const params = { page_size: filters.pageSize || 200 };
    if (filters.clientId)           params.client_id           = filters.clientId;
    if (filters.verificationStatus) params.verification_status = filters.verificationStatus;
    if (filters.ingestionSource)    params.ingestion_source    = filters.ingestionSource;
    if (filters.classificationType) params.classification_type = filters.classificationType;

    const { data } = await apiClient.get('/phones', { params });
    const { items } = unwrapPage(data);
    let enriched = items.map(enrichPhone);

    // Server has no full-text search param — apply on the full returned page.
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      enriched = enriched.filter((p) =>
        p.phone_number.includes(q) ||
        String(p.entity_id).includes(q) ||
        (p.client_name || '').toLowerCase().includes(q)
      );
    }
    return enriched;
  }

  // --- mock path ---
  await mockDelay(300);
  let results = mockDb.phones.map((phone) => {
    const entity = mockDb.entities.find((e) => e.id === phone.entity_id) || {};
    const client = mockDb.clients.find((c) => c.id === entity.client_id) || {};
    return { ...phone, entity_type: entity.entity_type, client_id: entity.client_id, client_name: client.name };
  });

  if (filters.clientId)           results = results.filter((p) => p.client_id === filters.clientId);
  if (filters.verificationStatus) results = results.filter((p) => p.verification_status === filters.verificationStatus);
  if (filters.ingestionSource)    results = results.filter((p) => p.ingestion_source    === filters.ingestionSource);
  if (filters.classificationType) results = results.filter((p) => p.classification_type === filters.classificationType);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter((p) =>
      p.phone_number.includes(q) ||
      String(p.entity_id).includes(q) ||
      (p.client_name || '').toLowerCase().includes(q)
    );
  }
  return results;
}

/**
 * getPhoneDetail — full detail for a single phone including timeline.
 *
 * MOCK_MODE = false → GET /phones/{id}; enriched via phoneAdapter.
 * MOCK_MODE = true  → reads from mockDb.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function getPhoneDetail(id, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.get(`/phones/${id}`);
    return enrichPhoneDetail(data);
  }

  await mockDelay(250);
  const phone  = mockDb.phones.find((p) => p.id === id);
  if (!phone) throw new Error(`Phone ${id} not found`);
  const entity = mockDb.entities.find((e) => e.id === phone.entity_id) || {};
  const client = mockDb.clients.find((c) => c.id === entity.client_id) || {};
  const logs   = mockDb.actionLogs.filter((l) => l.phone_id === id);
  return {
    ...phone,
    entity:          { ...entity, client_name: client.name },
    action_timeline: logs.sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at)),
  };
}

/**
 * patchPhone — partial update of phone metadata / fields.
 *
 * MOCK_MODE = false → PATCH /phones/{id}; triggers refetchPhoneById (Phase D
 *                     narrowed refetch — single GET /phones/{id}).
 *                     If the backend's ActionDataTriggerService also fired
 *                     a re-dispatch (PhoneUpdateResponse.triggered_action),
 *                     that ActionLog is spliced into the logs cache inline
 *                     from the response body — NO extra HTTP call. This
 *                     respects §4.3 (no log-side refetch for patchPhone)
 *                     while still keeping the operator's drawer timeline
 *                     accurate when a fix-then-redispatch happens.
 * MOCK_MODE = true  → applies patch to in-memory mock state.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function patchPhone(id, body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.patch(`/phones/${id}`, body);
    await mockDb.refetchPhoneById(id);
    if (data?.triggered_action) {
      mockDb.spliceActionLog(data.triggered_action);
    }
    return data;
  }

  await mockDelay(350);
  mockDb.applyPatchPhone(id, body);
  return mockDb.phones.find((p) => p.id === id);
}
