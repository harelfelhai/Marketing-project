/**
 * exportApi.js — Phase EXP: client for the table-export endpoints.
 *
 * One function per exportable table, plus a shared utility that
 * downloads the returned blob into a file on the operator's machine.
 *
 * Real mode posts the request, receives .xlsx bytes, and triggers the
 * browser download via an object-URL anchor (same pattern as
 * `getBulkTemplate` in ingestionApi).
 *
 * Mock mode synthesizes a CSV mirror — same column contract, same
 * filename convention — so operators in `MOCK_MODE=true` get a
 * working file even without a live backend.
 */

import { mockDelay, MOCK_MODE, apiClient } from './client';


/**
 * exportTable — POST /api/v1/{tableId}/export and trigger a download.
 *
 * @param {string} tableId   — 'phones' | 'tasks'
 * @param {object} body      — { filters: {...}, columns: [{key,label,format}], filename_hint? }
 * @param {object} mockDb    — MockDataContext value, for mock-mode parity
 * @returns {Promise<void>}    side-effect only (triggers the download)
 * @throws  on backend 4xx — caller catches and surfaces a toast
 */
export async function exportTable(tableId, body, mockDb) {
  if (!MOCK_MODE) {
    const res = await apiClient.post(`/${tableId}/export`, body, {
      responseType: 'blob',
    });
    const cd = res.headers['content-disposition']
      || res.headers['Content-Disposition']
      || '';
    const match = /filename="([^"]+)"/.exec(cd);
    const filename = match ? match[1] : `${tableId}_export.xlsx`;
    _downloadBlob(res.data, filename);
    return;
  }

  // Mock parity — synthesize a CSV using the per-table mutator on
  // MockDataContext. The mock honors the same column projection and
  // filter shape as the real backend so operator tests in MOCK_MODE
  // exercise the same code paths.
  await mockDelay(300);
  const { blob, filename } = mockDb.applyTableExport(tableId, body);
  _downloadBlob(blob, filename);
}


/**
 * Trigger a browser download from a Blob — identical pattern to
 * `getBulkTemplate`. Kept private here so each api module that emits
 * downloads has its own copy (no cross-module coupling).
 */
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
