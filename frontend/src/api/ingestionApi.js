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
