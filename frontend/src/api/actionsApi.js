// actionsApi.js — ActionLog endpoints were removed from the backend.
// This module is kept as a stub so any stale import doesn't hard-crash.
// Callers should be removed; these exports are no-ops.

export async function listActionLogs() { return []; }
export async function triggerManualAction() { return null; }
export async function retryNow() { return null; }
