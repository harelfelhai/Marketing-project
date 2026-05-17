import { mockDelay } from './client';

/**
 * listPhones — fetch phone records with optional filter params.
 *
 * @param {object} filters  - { clientId, verificationStatus, ingestionSource,
 *                              classificationType, search }
 * @param {object} mockDb   - MockDataContext value
 *
 * // HOOK FOR REAL API:
 * //   return axios.get('/api/v1/phones', { params: filters }).then(r => r.data)
 */
export async function listPhones(filters = {}, mockDb) {
  await mockDelay(300);

  let results = mockDb.phones.map((phone) => {
    const entity = mockDb.entities.find((e) => e.id === phone.entity_id) || {};
    const client = mockDb.clients.find((c) => c.id === entity.client_id) || {};
    return { ...phone, entity_type: entity.entity_type, client_id: entity.client_id, client_name: client.name };
  });

  if (filters.clientId) {
    results = results.filter((p) => p.client_id === filters.clientId);
  }
  if (filters.verificationStatus) {
    results = results.filter((p) => p.verification_status === filters.verificationStatus);
  }
  if (filters.ingestionSource) {
    results = results.filter((p) => p.ingestion_source === filters.ingestionSource);
  }
  if (filters.classificationType) {
    results = results.filter((p) => p.classification_type === filters.classificationType);
  }
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
 * getPhoneDetail — fetch a single phone with entity info + action timeline.
 *
 * // HOOK FOR REAL API:
 * //   return axios.get(`/api/v1/phones/${id}`).then(r => r.data)
 */
export async function getPhoneDetail(id, mockDb) {
  await mockDelay(250);
  const phone  = mockDb.phones.find((p) => p.id === id);
  if (!phone) throw new Error(`Phone ${id} not found`);
  const entity = mockDb.entities.find((e) => e.id === phone.entity_id) || {};
  const client = mockDb.clients.find((c) => c.id === entity.client_id) || {};
  const logs   = mockDb.actionLogs.filter((l) => l.phone_id === id);

  return {
    ...phone,
    entity:           { ...entity, client_name: client.name },
    action_timeline:  logs.sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at)),
  };
}

/**
 * patchPhone — partial update of phone metadata / fields.
 *
 * @param {number} id      - phone record ID
 * @param {object} body    - partial update payload
 * @param {object} mockDb  - MockDataContext value
 *
 * // HOOK FOR REAL API:
 * //   return axios.patch(`/api/v1/phones/${id}`, body).then(r => r.data)
 */
export async function patchPhone(id, body, mockDb) {
  await mockDelay(350);
  mockDb.applyPatchPhone(id, body);
  return mockDb.phones.find((p) => p.id === id);
}
