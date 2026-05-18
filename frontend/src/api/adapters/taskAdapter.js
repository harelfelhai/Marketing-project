/**
 * taskAdapter — enriches backend PipelineTaskResponse objects with
 * `client_name` resolved from the frontend clientRegistry.
 *
 * The backend stores only the opaque integer client_id (Secrets-Free
 * Mandate). The JOIN on /api/v1/tasks already echoes client_id onto every
 * row alongside phone_number, entity_id, and entity_type, so this adapter
 * does NOT have to cross-reference db.phones to resolve the relation —
 * which would be a synchronization hazard under Phase D's narrowed-refetch
 * model (tasks can refresh independently of phones).
 *
 * // HOOK FOR ENTERPRISE LABELS — client display names are swapped here by
 * // updating clientRegistry.js, not by changing the backend schema.
 */

import { getClientName } from '../../config/clientRegistry';

/**
 * Enrich a single PipelineTaskResponse with client_name from the registry.
 * @param {object} task - Raw PipelineTaskResponse from the backend.
 * @returns {object} Same task plus a derived `client_name` field.
 */
export function enrichTask(task) {
  if (!task) return task;
  return { ...task, client_name: getClientName(task.client_id) };
}

/**
 * Batch enrichment for paginated list responses.
 * Called by listTasks after `unwrapPage()` strips the envelope.
 * @param {object[]} items
 * @returns {object[]}
 */
export function enrichTaskList(items) {
  return (items || []).map(enrichTask);
}
