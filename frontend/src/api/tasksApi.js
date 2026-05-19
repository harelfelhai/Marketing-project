/**
 * tasksApi.js — Domain E (Phase DX): Operations Task Queue client.
 *
 * Same shape as phonesApi.js / actionsApi.js. Every function accepts
 * `mockDb` as its last argument; the real path branches on `MOCK_MODE`
 * and triggers the appropriate refetch from MockDataContext after each
 * mutation (Phase D narrowed-refetch contract).
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 * // HOOK FOR ENTERPRISE AUTH: requested_by / operator_id are passed
 * //                          explicitly by every caller; never read
 * //                          from MockAuthContext inside this module.
 */

import { mockDelay, MOCK_MODE, apiClient } from './client';
import { unwrapPage } from './adapters/paginationAdapter';
import { enrichTask, enrichTaskList } from './adapters/taskAdapter';


/**
 * listTasks — paginated task queue with optional filters (filter-as-view §3.3).
 *
 * Frontend filter keys are camelCase; converted to backend snake_case query
 * params here (same mapping convention as listPhones / listActionLogs).
 *
 * MOCK_MODE = false → GET /tasks; items enriched via taskAdapter.
 * MOCK_MODE = true  → filters and enriches from mockDb.tasks.
 *
 * @param {object} filters - { status, taskType, phoneId, pageSize }.
 * @param {object} mockDb  - The MockDataContext value, for mock-mode reads.
 */
export async function listTasks(filters = {}, mockDb) {
  if (!MOCK_MODE) {
    const params = { page_size: filters.pageSize || 200 };
    if (filters.status)    params.status    = filters.status;
    if (filters.taskType)  params.task_type = filters.taskType;
    if (filters.phoneId)   params.phone_id  = filters.phoneId;

    const { data }  = await apiClient.get('/tasks', { params });
    const { items } = unwrapPage(data);
    return enrichTaskList(items);
  }

  // --- mock path ---
  await mockDelay(250);
  let rows = [...(mockDb?.tasks || [])];
  if (filters.status)   rows = rows.filter((t) => t.status    === filters.status);
  if (filters.taskType) rows = rows.filter((t) => t.task_type === filters.taskType);
  if (filters.phoneId)  rows = rows.filter((t) => t.phone_id  === filters.phoneId);
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return enrichTaskList(rows);
}


/**
 * getTaskDetail — single-task detail for the OperationsQueue drawer.
 *
 * MOCK_MODE = false → GET /tasks/{id}; enriched via taskAdapter.
 * MOCK_MODE = true  → reads from mockDb.tasks.
 */
export async function getTaskDetail(id, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.get(`/tasks/${id}`);
    return enrichTask(data);
  }

  await mockDelay(200);
  const task = mockDb.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task ${id} not found`);
  return enrichTask(task);
}


/**
 * openTask — create a new pending task.
 *
 * MOCK_MODE = false → POST /tasks; triggers refetchTasks (wholesale)
 *                     because the new task's server-assigned id is unknown
 *                     to the client beforehand. Mirrors ingestCircleMember.
 * MOCK_MODE = true  → appends a new task to in-memory state.
 *
 * // HOOK FOR ENTERPRISE AUTH: body.requested_by carries operator_id
 * //                           from the caller — never read from a context
 * //                           here, always passed in explicitly.
 *
 * @param {object} body   - { phone_id, task_type, requested_by,
 *                            source_action_log_id?, extra_data? }.
 * @param {object} mockDb - MockDataContext value.
 */
export async function openTask(body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/tasks', {
      phone_id:             body.phone_id,
      task_type:            body.task_type,
      requested_by:         body.requested_by,
      source_action_log_id: body.source_action_log_id ?? null,
      extra_data:           body.extra_data           ?? null,
    });
    await mockDb.refetchTasks();
    return enrichTask(data);
  }

  await mockDelay(450);
  mockDb.applyOpenTask(body);
  const newest = mockDb.tasks[mockDb.tasks.length - 1];
  return enrichTask(newest);
}


/**
 * resolveTask — terminally settle a task ('resolved' or 'rejected').
 *
 * MOCK_MODE = false → POST /tasks/{id}/resolve; triggers refetchTaskById
 *                     (Phase D narrowed refetch). The response is the
 *                     updated PipelineTaskResponse, so the merge happens
 *                     against authoritative server state.
 * MOCK_MODE = true  → writes the terminal state to in-memory mock task.
 *
 * // HOOK FOR ENTERPRISE AUTH: body.operator_id carries the Senior Admin's
 * //                           operator_id from the caller. Phase G replaces
 * //                           this with a server-side Depends(get_current_operator).
 *
 * @param {number} id     - Task id.
 * @param {object} body   - { operator_id, outcome, resolution_note? }.
 * @param {object} mockDb - MockDataContext value.
 */
export async function resolveTask(id, body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post(`/tasks/${id}/resolve`, {
      operator_id:     body.operator_id,
      outcome:         body.outcome,
      resolution_note: body.resolution_note ?? null,
    });
    await mockDb.refetchTaskById(id);
    return enrichTask(data);
  }

  await mockDelay(500);
  mockDb.applyResolveTask(id, body);
  const updated = mockDb.tasks.find((t) => t.id === id);
  return enrichTask(updated);
}


/**
 * bulkUpdateTasks — settle many tasks in one request (Task Center bulk).
 *
 * Hits POST /api/v1/tasks/bulk-status. Per-task failures (already
 * terminal, missing) land in the response's `failed_rows`; only
 * request-shape errors (empty `task_ids`, invalid `outcome`) raise 4xx.
 *
 * @param {object} body   - { task_ids: number[], operator_id: string,
 *                             outcome: 'resolved'|'rejected',
 *                             resolution_note?: string }.
 * @param {object} mockDb - MockDataContext value.
 * @returns {Promise<object>} BulkResolveTaskResponse-shaped object:
 *   { success_count, failed_count, success_ids, failed_rows }.
 */
export async function bulkUpdateTasks(body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/tasks/bulk-status', {
      task_ids:        body.task_ids,
      operator_id:     body.operator_id,
      outcome:         body.outcome,
      resolution_note: body.resolution_note ?? null,
    });
    // Wholesale refetch — settling N tasks may flip N rows' statuses
    // and the narrowed refetchTaskById is awkward to apply in a loop.
    // The list endpoint is cheap (one round-trip).
    await mockDb.refetchTasks();
    return data;
  }

  await mockDelay(500);
  return mockDb.applyBulkResolveTasks(body);
}
