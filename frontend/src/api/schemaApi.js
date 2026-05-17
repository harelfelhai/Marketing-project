import { mockDelay } from './client';
import { SEED_FORM_SCHEMA } from '../mock/mockData';

/**
 * getLeadFormSchema — fetch the dynamic ingestion form field definitions.
 *
 * // HOOK FOR REAL API: return axios.get('/api/v1/schema/lead-form').then(r => r.data)
 */
export async function getLeadFormSchema() {
  await mockDelay(200);
  return structuredClone(SEED_FORM_SCHEMA);
}
