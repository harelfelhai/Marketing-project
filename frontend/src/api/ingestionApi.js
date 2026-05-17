import { mockDelay } from './client';

/**
 * ingestCircleMember — submit a new phone number for pipeline ingestion.
 *
 * @param {object} payload  - form fields from IngestionModal
 * @param {object} mockDb   - MockDataContext value (mutators + state)
 *
 * // HOOK FOR REAL API:
 * //   return axios.post('/api/v1/ingest', payload).then(r => r.data)
 * //   (remove mockDb parameter)
 */
export async function ingestCircleMember(payload, mockDb) {
  await mockDelay(500);
  mockDb.applyIngest(payload);
  // Return a shape matching the backend IngestionResponse contract.
  const phones = mockDb.phones;
  const newest = phones[phones.length - 1];
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
