/**
 * notificationsApi.js — Phase NOTIF: subscription CRUD + test-fire client.
 *
 * Real mode hits the backend; mock mode delegates to MockDataContext's
 * applyNotification* mutators for in-memory parity. Same shape as
 * tasksApi / entityApi / exportApi.
 *
 * The functions are kept small and consistent — one API verb per
 * function, no opinion about retry / loading state (the calling
 * component owns that UX).
 */

import { mockDelay, MOCK_MODE, apiClient } from './client';


/**
 * listSubscriptions — GET /api/v1/notifications/subscriptions
 *
 * Used by the inline OptInPanel on mount to discover whether the
 * record already has an active subscription. Pass the four filters
 * the backend accepts; mock mode applies them in-memory.
 *
 * @param {object} filters - { targetKind?, targetId?, triggerEventType?, active? }
 * @param {object} mockDb
 * @returns {Promise<object[]>}  Array of NotificationSubscriptionResponse rows.
 */
export async function listSubscriptions(filters = {}, mockDb) {
  if (!MOCK_MODE) {
    const params = {};
    if (filters.targetKind !== undefined)        params.target_kind        = filters.targetKind;
    if (filters.targetId !== undefined)          params.target_id          = filters.targetId;
    if (filters.triggerEventType !== undefined)  params.trigger_event_type = filters.triggerEventType;
    if (filters.active !== undefined)            params.active             = filters.active;
    const { data } = await apiClient.get('/notifications/subscriptions', { params });
    return data;
  }
  await mockDelay(150);
  return mockDb.listNotificationSubscriptions(filters);
}


/**
 * createSubscription — POST /api/v1/notifications/subscriptions
 *
 * Phase AUTH-B: `created_by` removed from the wire body — the
 * backend derives it from the session.
 *
 * @param {object} body - matches NotificationSubscriptionCreate:
 *   - trigger_event_type   (string, required)
 *   - target_kind          ('phone'|'entity'|'task'|'global')
 *   - target_id            (number|null)
 *   - recipients           (string[], 1..50)
 *   - title_template?      (string|null)
 *   - body_template?       (string|null)
 *   - extra_data?          (object|null)
 * @param {object} mockDb
 * @returns {Promise<object>}  NotificationSubscriptionResponse
 */
export async function createSubscription(body, mockDb) {
  if (!MOCK_MODE) {
    const { created_by: _legacy, ...wireBody } = body;
    const { data } = await apiClient.post('/notifications/subscriptions', wireBody);
    return data;
  }
  await mockDelay(300);
  return mockDb.applyCreateNotificationSubscription(body);
}


/**
 * updateSubscription — PATCH /api/v1/notifications/subscriptions/{id}
 *
 * Partial update — pass only the fields you want to change.
 * Trigger / target fields are NOT editable; to re-scope, delete + create.
 *
 * @param {number} id
 * @param {object} body - { recipients?, title_template?, body_template?,
 *                          active?, extra_data? }
 * @param {object} mockDb
 */
export async function updateSubscription(id, body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.patch(`/notifications/subscriptions/${id}`, body);
    return data;
  }
  await mockDelay(250);
  return mockDb.applyUpdateNotificationSubscription(id, body);
}


/**
 * deleteSubscription — DELETE /api/v1/notifications/subscriptions/{id}
 *
 * Hard delete. Historical NotificationDelivery rows are preserved.
 */
export async function deleteSubscription(id, mockDb) {
  if (!MOCK_MODE) {
    await apiClient.delete(`/notifications/subscriptions/${id}`);
    return;
  }
  await mockDelay(200);
  mockDb.applyDeleteNotificationSubscription(id);
}


/**
 * testFire — POST /api/v1/notifications/test-fire
 *
 * Operator-triggered smoke test. Returns the persisted
 * NotificationDelivery row so callers can verify status ('sent' vs
 * 'failed') and surface a clear pass/fail toast.
 */
export async function testFire(body, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/notifications/test-fire', body);
    return data;
  }
  await mockDelay(300);
  return mockDb.applyNotificationTestFire(body);
}
