import { mockDelay, MOCK_MODE, apiClient } from './client';

/**
 * ingestCircleMember — submit a new phone number for pipeline ingestion.
 *
 * MOCK_MODE = false → POST /ingest with the form payload; triggers refetchPhones
 *                     so the context reflects the authoritative server state.
 * MOCK_MODE = true  → applies to in-memory mock state directly.
 *
 * Payload mapping: form field names match IngestionPayload field names exactly
 * (phone_number, entity_type, target_phone_number, ingestion_source,
 * ingestion_reason, entity_extra, phone_extra). No transformation required.
 *
 * json_blob fields: IngestionModal.jsx validates and parses them before
 * calling this function — empty blobs arrive as {}, valid JSON as parsed objects.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 * // HOOK FOR ENTERPRISE AUTH: operator_id stamped via extra_metadata if needed.
 */
export async function ingestCircleMember(payload, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/ingest', payload);
    await mockDb.refetchPhones();
    return data;
  }

  await mockDelay(500);
  mockDb.applyIngest(payload);
  const newest = mockDb.phones[mockDb.phones.length - 1];
  return {
    id:                  newest.id,
    phone_number:        newest.phone_number,
    entity_id:           newest.entity_id,
    verification_status: newest.verification_status,
    ingestion_source:    newest.ingestion_source,
    ingestion_reason:    newest.ingestion_reason,
    ingested_at:         newest.ingested_at,
    created_at:          newest.created_at,
  };
}

// ---------------------------------------------------------------------------
// Phase E1-A — Bulk text ingestion
//
// Submits a free-form textarea of phone numbers under a SHARED envelope
// context (one new Entity is created server-side for the whole batch).
// The server returns a BulkIngestSummary payload describing per-row
// successes/failures; the modal renders that summary inline rather than
// dismissing — operators need to see which lines failed and why.
//
// Resilience contract: per-row failures land in `failed_rows` alongside
// a 200 response. Only request-shape errors (invalid target_entity_id,
// empty input) raise.
// ---------------------------------------------------------------------------

/**
 * bulkIngestText — submit a batch of phone numbers under a shared envelope.
 *
 * @param {object} payload   Matches BulkTextIngestRequest:
 *   - phone_numbers_raw (string, required)
 *   - client_id         (number, required)
 *   - entity_type       (string, required)
 *   - ingestion_source  (string, required)
 *   - target_entity_id  (number, optional)
 *   - ingestion_reason  (string, optional)
 *   - entity_extra      (object, optional)
 *   - phone_extra_shared (object, optional)
 * @param {object} mockDb    MockDataContext instance for parity in mock mode.
 * @returns {Promise<object>} BulkIngestSummary-shaped object.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function bulkIngestText(payload, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/phones/bulk-text', payload);
    await mockDb.refetchPhones();
    return data;
  }

  await mockDelay(500);
  return mockDb.applyBulkIngest(payload);
}
