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

// ---------------------------------------------------------------------------
// Phase E1-B / E1-D — Excel/CSV bulk file upload + template download
// ---------------------------------------------------------------------------

/**
 * Read a File/Blob as UTF-8 text. Uses File.text() when available (modern
 * browsers) and falls back to FileReader (jsdom / older browsers / older
 * Safari versions).
 */
function readFileAsText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsText(file);
  });
}

/**
 * bulkIngestUpload — submit an .xlsx or .csv file for per-row ingestion.
 *
 * Unlike bulkIngestText (single shared envelope), bulkIngestUpload creates
 * ONE Entity per row — each row carries its own context columns.
 *
 * Real mode: posts multipart/form-data with a `file` field to
 *   POST /api/v1/phones/bulk-upload.
 *
 * Mock mode: reads the File as text in-browser, parses CSV, and delegates
 * to MockDataContext.applyBulkUploadRows() for parity with the backend's
 * tokenize/normalize/dedup per-row contract. XLSX cannot be parsed in
 * mock mode without shipping an xlsx library — the mock will throw a
 * friendly error suggesting CSV or the real API.
 *
 * @param {File} file       Selected file from the upload input.
 * @param {object} mockDb   MockDataContext instance.
 * @returns {Promise<object>} BulkIngestSummary-shaped object.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function bulkIngestUpload(file, mockDb) {
  if (!MOCK_MODE) {
    const form = new FormData();
    form.append('file', file);
    const { data } = await apiClient.post('/phones/bulk-upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    await mockDb.refetchPhones();
    return data;
  }

  await mockDelay(500);

  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx')) {
    // The mock can't parse xlsx without bundling openpyxl-equivalent JS.
    // We surface a clear operator-friendly error rather than silently
    // pretending an empty workbook.
    throw new Error(
      'Excel (.xlsx) parsing requires the real backend. Use a .csv file in mock mode.'
    );
  }
  if (!name.endsWith('.csv')) {
    throw new Error(`Unsupported file extension: '${file.name}'. Allowed: .xlsx, .csv`);
  }

  const text = await readFileAsText(file);
  return mockDb.applyBulkUploadCsv(text);
}

/**
 * getBulkTemplate — download the .xlsx (or, in mock mode, .csv) upload template.
 *
 * Real mode: streams the .xlsx bytes from GET /api/v1/phones/bulk-template and
 * triggers a browser download via an object URL.
 *
 * Mock mode: synthesizes a CSV template in-browser (the column contract
 * is identical to the backend's "data" sheet); operators in mock mode get
 * a usable template even with no live backend, at the cost of a different
 * file extension. Acceptable since the bulk-upload mock also requires CSV.
 *
 * Side-effect: triggers the browser download. Returns nothing.
 *
 * // HOOK FOR REAL API: wired. Set VITE_USE_REAL_API=true to activate.
 */
export async function getBulkTemplate() {
  let blob;
  let filename;

  if (!MOCK_MODE) {
    const res = await apiClient.get('/phones/bulk-template', { responseType: 'blob' });
    blob = res.data;
    // Try to extract filename from Content-Disposition; fall back to a default.
    const cd = res.headers['content-disposition'] || res.headers['Content-Disposition'] || '';
    const match = /filename="([^"]+)"/.exec(cd);
    filename = match ? match[1] : 'bulk_phones_template.xlsx';
  } else {
    await mockDelay(150);
    // CSV mirror of the backend template's "data" sheet: header + 3 examples.
    // Operators ingest a populated copy of this file via the upload tab.
    const csvLines = [
      'phone_number,client_id,relation_type,ingestion_source,target_entity_id',
      '+14155551111,1,family,manual,',
      '+14155551112,1,friend,manual,',
      '+14155551113,2,associated,automated,',
    ];
    blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
    filename = 'bulk_phones_template.csv';
  }

  // Trigger a one-shot download via an anchor element.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the click has time to process in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
