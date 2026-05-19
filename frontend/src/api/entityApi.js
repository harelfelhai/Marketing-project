/**
 * entityApi.js — Phase E2 entity-centric ingestion client.
 *
 * Mirrors the architecture of `ingestionApi.js` (phone-centric):
 *   - Real mode (VITE_USE_REAL_API=true): posts to the backend.
 *   - Mock mode: delegates to MockDataContext mutators for parity.
 *
 * Phase E2-A — createEntity (single-entry). Bulk-text, bulk-upload, and
 * template download will be appended here in subsequent PRs (E2-D).
 */

import { mockDelay, MOCK_MODE, apiClient } from './client';

/**
 * createEntity — submit one named person for entity-centric ingestion.
 *
 * The backend stores `first_name` and `last_name` inside `Entity.extra_data`
 * per the Secrets-Free Mandate — never on schema-level columns. The
 * response echoes them back so the UI's success panel can render the
 * confirmation chip and seed the follow-on phone modal.
 *
 * @param {object} payload   Matches EntitySingleCreateIn:
 *   - first_name       (string, required)
 *   - last_name        (string|null)
 *   - relation_type    ('family' | 'friend' | 'colleague' | 'spouse')
 *   - target_entity_id (number, required)
 *   - extra_data       (object|null)
 * @param {object} mockDb    MockDataContext instance for parity in mock mode.
 * @returns {Promise<object>} EntitySingleCreateOut-shaped object:
 *   { id, client_id, relation_type, target_entity_id, first_name, last_name, created_at }
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function createEntity(payload, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/entities', payload);
    // Entities don't appear in the phones list, so no refetchPhones here.
    // If a refetchEntities path lands later, plug it in.
    return data;
  }

  await mockDelay(400);
  return mockDb.applyCreateEntity(payload);
}

// ---------------------------------------------------------------------------
// Phase E2-D — Bulk-text (Two-Step grid) entity ingestion
// ---------------------------------------------------------------------------

/**
 * bulkIngestEntityText — submit a curated grid of N people for ingestion.
 *
 * The frontend tokenizes the operator's raw paste (Step 1) and renders
 * the inline editor (Step 2). By the time this call fires, `rows` is a
 * list of typed records: { row_token, first_name, last_name,
 * relation_type, target_entity_id }. Per-row relation_type and
 * target_entity_id may be null — those rows inherit the request-level
 * defaults.
 *
 * Resilience contract: per-row failures land in the BulkIngestSummary,
 * NOT as thrown errors. Only request-level default_target_entity_id
 * errors throw (422 from the backend).
 *
 * @param {object} payload          Matches EntityBulkTextIn:
 *   - default_relation_type    (string, required)
 *   - default_target_entity_id (number, required)
 *   - rows                     (array, 1..500)
 * @param {object} mockDb           MockDataContext instance.
 * @returns {Promise<object>}       BulkIngestSummary-shaped object.
 */
export async function bulkIngestEntityText(payload, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/entities/bulk-text', payload);
    return data;
  }

  await mockDelay(400);
  return mockDb.applyEntityBulkText(payload);
}

// ---------------------------------------------------------------------------
// Phase E2-D — Excel / CSV bulk upload
// ---------------------------------------------------------------------------

/**
 * bulkIngestEntityUpload — submit an .xlsx or .csv file of people.
 *
 * Each row in the file is its own ingestion context: own
 * relation_type, own target_entity_id. No request-level defaults
 * (different from bulk-text).
 *
 * Mock mode reads the file as text in-browser, parses CSV, delegates
 * to MockDataContext.applyEntityBulkUploadCsv. .xlsx is rejected in
 * mock mode (no openpyxl-equivalent JS bundled); operator-friendly
 * error suggests CSV or the real API.
 *
 * @param {File} file       Selected file from the upload input.
 * @param {object} mockDb   MockDataContext instance.
 * @returns {Promise<object>} BulkIngestSummary-shaped object.
 */
export async function bulkIngestEntityUpload(file, mockDb) {
  if (!MOCK_MODE) {
    const form = new FormData();
    form.append('file', file);
    const { data } = await apiClient.post('/entities/bulk-upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  }

  await mockDelay(500);

  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx')) {
    throw new Error(
      'Excel (.xlsx) parsing requires the real backend. Use a .csv file in mock mode.',
    );
  }
  if (!name.endsWith('.csv')) {
    throw new Error(`Unsupported file extension: '${file.name}'. Allowed: .xlsx, .csv`);
  }

  const text = await readFileAsText(file);
  return mockDb.applyEntityBulkUploadCsv(text);
}

// Re-implement the file-read helper here to avoid coupling entityApi to
// the phone-side ingestionApi module. The helper is small and pure;
// duplicating it keeps each api module standalone.
function readFileAsText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsText(file);
  });
}

/**
 * getEntityBulkTemplate — download the .xlsx (real mode) or .csv (mock)
 * upload template.
 *
 * Real mode: streams the .xlsx bytes from GET /api/v1/entities/bulk-template.
 * The backend includes a live `valid_targets` reference sheet generated
 * from the current root-target table.
 *
 * Mock mode: synthesizes a CSV with the four entity columns +
 * a few example rows. No live target list (the mock has no equivalent
 * sheet concept), so operators pick target ids from the existing
 * entity dropdown context.
 *
 * Side-effect: triggers the browser download. Returns nothing.
 */
export async function getEntityBulkTemplate() {
  let blob;
  let filename;

  if (!MOCK_MODE) {
    const res = await apiClient.get('/entities/bulk-template', { responseType: 'blob' });
    blob = res.data;
    const cd = res.headers['content-disposition'] || res.headers['Content-Disposition'] || '';
    const match = /filename="([^"]+)"/.exec(cd);
    filename = match ? match[1] : 'bulk_entities_template.xlsx';
  } else {
    await mockDelay(150);
    // CSV mirror of the backend template's "data" sheet — header +
    // two example rows operators can replace with real data.
    const csvLines = [
      'first_name,relation_type,target_entity_id,last_name',
      'Jane,family,1,Doe',
      'Sam,colleague,1,Chen',
    ];
    blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
    filename = 'bulk_entities_template.csv';
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}


/* ===========================================================================
 * UAT round-3 — admin CRUD: list / detail / patch / soft-delete / restore
 * ===========================================================================
 *
 * The same five mutation shapes wrapped for entities and phones. Each
 * function follows the established pattern: MOCK_MODE branch first
 * (calls into MockDataContext mutators), real-API branch second. The
 * mutators on mockDb keep mock-mode tests honest end-to-end.
 */


/**
 * listEntities — paginated entities for the view tab + admin tab.
 *
 * filters: { clientId?, clientIds?, entityType?, includeDeleted?, q? }
 */
export async function listEntities(filters = {}, mockDb) {
  if (!MOCK_MODE) {
    const params = {};
    if (filters.clientId != null && filters.clientId !== '') params.client_id = filters.clientId;
    if (filters.clientIds?.length)                            params.client_ids = filters.clientIds;
    if (filters.entityType)                                   params.entity_type = filters.entityType;
    if (filters.includeDeleted)                               params.include_deleted = true;
    if (filters.q)                                            params.q = filters.q;
    const { data } = await apiClient.get('/entities', { params });
    return data.items || [];
  }
  await mockDelay(200);
  return mockDb.applyListEntities(filters);
}


export async function getEntityDetail(id, includeDeleted, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.get(`/entities/${id}`, {
      params: includeDeleted ? { include_deleted: true } : {},
    });
    return data;
  }
  await mockDelay(150);
  return mockDb.applyGetEntityDetail(id, includeDeleted);
}


export async function patchEntity(id, body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.patch(`/entities/${id}`, body);
    await mockDb.refetchPhones?.();
    return data;
  }
  await mockDelay(250);
  return mockDb.applyPatchEntity(id, body);
}


export async function softDeleteEntity(id, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.delete(`/entities/${id}`);
    await mockDb.refetchPhones?.();
    return data;
  }
  await mockDelay(250);
  return mockDb.applySoftDeleteEntity(id);
}


export async function restoreEntity(id, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post(`/entities/${id}/restore`);
    await mockDb.refetchPhones?.();
    return data;
  }
  await mockDelay(250);
  return mockDb.applyRestoreEntity(id);
}
