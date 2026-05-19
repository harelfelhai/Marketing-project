import { mockDelay, MOCK_MODE, apiClient } from './client';
import { normalizeFormSchema } from './adapters/schemaAdapter';
import { SEED_FORM_SCHEMA }    from '../mock/mockData';

/**
 * getLeadFormSchema — dynamic ingestion form field definitions.
 *
 * MOCK_MODE = false → GET /schema/lead-form; normalized via schemaAdapter.
 * MOCK_MODE = true  → returns static seed schema (also normalized so
 *                     DynamicField.jsx always receives {value, label} options).
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function getLeadFormSchema() {
  if (!MOCK_MODE) {
    const { data } = await apiClient.get('/schema/lead-form');
    return normalizeFormSchema(data);
  }
  await mockDelay(200);
  return normalizeFormSchema(structuredClone(SEED_FORM_SCHEMA));
}
