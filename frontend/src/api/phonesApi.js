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
    if (filters.phoneType)           params.phone_type           = filters.phoneType;
    // Phase AUTH-C — multi-value personalization filter. Frontend
    // builds this from the operator's managed_client_ids when
    // personalizationActive is true.
    if (filters.clientIds?.length)  params.client_ids          = filters.clientIds;
    // UAT round-3 — surface soft-deleted rows for the data-admin tab.
    if (filters.includeDeleted)     params.include_deleted     = true;
    // Phase DY — sort_by toggles between 'priority' (default, the
    // prioritised review queue) and 'ingested_at' (legacy chronological
    // ordering). Backend default is already 'priority' so omitting the
    // param produces the same result; we pass it through explicitly only
    // when the caller asks for the legacy ordering.
    if (filters.sortBy)             params.sort_by             = filters.sortBy;

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
  // UAT round-3: hide soft-deleted phones unless the caller explicitly
  // asks for them (data-admin tab).
  const phonePool = filters.includeDeleted
    ? mockDb.phones
    : mockDb.phones.filter((p) => !p.deleted_at);
  let results = phonePool.map((phone) => {
    const entity = mockDb.entities.find((e) => e.id === phone.entity_id) || {};
    const client = mockDb.clients.find((c) => c.id === entity.client_id) || {};
    // Phase DY — customer_tier is a flat JOIN convenience field on the
    // response. Mock mode mirrors the backend's server-side traversal by
    // reading it directly from the owning entity's extra_data (every
    // seeded entity is a root target in the mock graph, so there's no
    // multi-hop traversal needed here).
    return {
      ...phone,
      relation_type: entity.relation_type,
      client_id:     entity.client_id,
      client_name:   client.name,
    };
  });

  if (filters.clientId)           results = results.filter((p) => p.client_id === filters.clientId);
  if (filters.clientIds?.length) {
    const allowed = new Set(filters.clientIds.map(String));
    results = results.filter((p) => allowed.has(String(p.client_id)));
  }
  if (filters.verificationStatus) results = results.filter((p) => p.verification_status === filters.verificationStatus);
  if (filters.ingestionSource)    results = results.filter((p) => p.ingestion_source    === filters.ingestionSource);
  if (filters.phoneType)           results = results.filter((p) => p.phone_type          === filters.phoneType);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter((p) =>
      p.phone_number.includes(q) ||
      String(p.entity_id).includes(q) ||
      (p.client_name || '').toLowerCase().includes(q)
    );
  }

  results.sort((a, b) => {
    const aHas = a.score != null;
    const bHas = b.score != null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.score !== b.score) return b.score - a.score;
    return String(b.id).localeCompare(String(a.id));
  });
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
  return {
    ...phone,
    entity: { ...entity, client_name: client.name },
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
    return data;
  }

  await mockDelay(350);
  mockDb.applyPatchPhone(id, body);
  return mockDb.phones.find((p) => p.id === id);
}


/* ===========================================================================
 * UAT round-3 — admin patch / soft-delete / restore for phones
 * =========================================================================== */


export async function adminPatchPhone(id, body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.patch(`/phones/${id}/admin`, body);
    await mockDb.refetchPhoneById?.(id);
    return data;
  }
  await mockDelay(250);
  return mockDb.applyAdminPatchPhone(id, body);
}


export async function softDeletePhone(id, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.delete(`/phones/${id}`);
    await mockDb.refetchPhones?.();
    return data;
  }
  await mockDelay(250);
  return mockDb.applySoftDeletePhone(id);
}


export async function restorePhone(id, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post(`/phones/${id}/restore`);
    await mockDb.refetchPhones?.();
    return data;
  }
  await mockDelay(250);
  return mockDb.applyRestorePhone(id);
}
