/**
 * FileUploadPanel — Phase E1-D Tab 3 (Excel/CSV bulk upload).
 *
 * Operator flow:
 *   1. Download the template (button at top) — backend serves an .xlsx with
 *      "data" + "instructions" sheets; mock mode serves a CSV mirror.
 *   2. Drag a file onto the dropzone, or click "Browse" → file picker.
 *   3. Client-side preflight (extension whitelist + size cap) before any
 *      bytes leave the browser. Both are operator-friendly errors.
 *   4. Submit → POST /api/v1/phones/bulk-upload (multipart) → BulkIngestSummary.
 *   5. Render BulkResultPanel inline; "New Batch" resets state.
 *
 * Unlike the Multi-Text tab, each row in the file produces its OWN Entity
 * (the backend's bulk-upload model is "every row is its own ingestion
 * context"). Per-row failures land in the summary; file-shape errors
 * (wrong extension, bad workbook, too many rows, missing columns) surface
 * as toast messages.
 */

import { useCallback, useRef, useState } from 'react';
import { Loader2, Upload, Download, FileSpreadsheet, X } from 'lucide-react';

import { bulkIngestUpload, getBulkTemplate } from '../../api/ingestionApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import BulkResultPanel from './BulkResultPanel';
import {
  BULK_FILE_INTRO,
  BULK_FILE_DROPZONE, BULK_FILE_DROPZONE_HINT,
  BULK_FILE_BTN_BROWSE, BULK_FILE_BTN_REMOVE, BULK_FILE_BTN_DOWNLOAD,
  BULK_FILE_BTN_SUBMIT, BULK_FILE_BTN_SUBMITTING,
  BULK_FILE_ERR_EMPTY, BULK_FILE_ERR_EXTENSION, BULK_FILE_ERR_SIZE,
  BULK_FILE_TOAST_TEMPLATE_OK, BULK_FILE_TOAST_TEMPLATE_ERR,
  BULK_FILE_TOAST_UPLOAD_ERR,
  BULK_FILE_SIZE_KB, BULK_FILE_SIZE_MB,
  BULK_TEXT_BTN_NEW_BATCH,
  INGEST_MODAL_BTN_CANCEL,
} from '../../config/strings.he';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS = ['.xlsx', '.csv'];

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    const kb = Math.round((bytes / 1024) * 10) / 10;
    return BULK_FILE_SIZE_KB(kb);
  }
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return BULK_FILE_SIZE_MB(mb);
}

function pickExtension(name) {
  const lower = (name || '').toLowerCase();
  const idx = lower.lastIndexOf('.');
  return idx === -1 ? '' : lower.slice(idx);
}

export default function FileUploadPanel() {
  const mockDb = useMockData();
  const { closeIngestionModal, pushToast } = useUI();

  const [file, setFile]             = useState(null);
  const [preflightErr, setPreflightErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary]       = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [dragOver, setDragOver]     = useState(false);

  const inputRef = useRef(null);

  // -------------------------------------------------------------------------
  // Preflight + selection
  // -------------------------------------------------------------------------
  const selectFile = useCallback((f) => {
    if (!f) {
      setFile(null);
      setPreflightErr('');
      return;
    }
    const ext = pickExtension(f.name);
    if (!ALLOWED_EXTS.includes(ext)) {
      setPreflightErr(BULK_FILE_ERR_EXTENSION(ext || ''));
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setPreflightErr(BULK_FILE_ERR_SIZE(formatBytes(f.size), formatBytes(MAX_BYTES)));
      setFile(null);
      return;
    }
    setPreflightErr('');
    setFile(f);
  }, []);

  const handleBrowseClick = () => inputRef.current?.click();

  const handleInputChange = (e) => {
    selectFile(e.target.files?.[0] || null);
    // Reset input value so picking the same file twice in a row still fires.
    e.target.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) selectFile(dropped);
  };

  // -------------------------------------------------------------------------
  // Template download
  // -------------------------------------------------------------------------
  const handleDownload = async () => {
    setDownloading(true);
    try {
      await getBulkTemplate();
      pushToast({ variant: 'success', message: BULK_FILE_TOAST_TEMPLATE_OK });
    } catch (err) {
      pushToast({ variant: 'error', message: BULK_FILE_TOAST_TEMPLATE_ERR(err.message) });
    } finally {
      setDownloading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!file) {
      setPreflightErr(BULK_FILE_ERR_EMPTY);
      return;
    }
    setSubmitting(true);
    try {
      const result = await bulkIngestUpload(file, mockDb);
      setSummary(result);
    } catch (err) {
      pushToast({ variant: 'error', message: BULK_FILE_TOAST_UPLOAD_ERR(err.message) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewBatch = () => {
    setFile(null);
    setPreflightErr('');
    setSummary(null);
  };

  // -------------------------------------------------------------------------
  // Result mode — same idiom as the Multi-Text tab.
  // -------------------------------------------------------------------------
  if (summary) {
    return (
      <div className="space-y-5" dir="rtl">
        <BulkResultPanel summary={summary} />
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={closeIngestionModal}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {INGEST_MODAL_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={handleNewBatch}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4" />
            {BULK_TEXT_BTN_NEW_BATCH}
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Upload mode.
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-500 flex-1">{BULK_FILE_INTRO}</p>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="shrink-0 inline-flex items-center gap-2 h-9 px-3 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          {downloading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Download className="w-4 h-4" />
          }
          {BULK_FILE_BTN_DOWNLOAD}
        </button>
      </div>

      {/* Dropzone — keyboard-accessible button + drag-and-drop target */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleBrowseClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleBrowseClick();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          'flex flex-col items-center justify-center gap-2 py-10 px-4 rounded-md border-2 border-dashed cursor-pointer transition-colors',
          dragOver
            ? 'border-slate-900 bg-slate-50'
            : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50',
        ].join(' ')}
        data-testid="bulk-file-dropzone"
      >
        <FileSpreadsheet className="w-8 h-8 text-slate-400" />
        <p className="text-sm font-medium text-slate-700">{BULK_FILE_DROPZONE}</p>
        <p className="text-[11px] text-slate-400">{BULK_FILE_DROPZONE_HINT}</p>
        <span className="inline-flex items-center gap-1 mt-1 text-xs text-slate-600 font-medium underline">
          {BULK_FILE_BTN_BROWSE}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          onChange={handleInputChange}
          className="hidden"
          data-testid="bulk-file-input"
        />
      </div>

      {/* Selected-file chip */}
      {file && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-slate-200 bg-slate-50">
          <FileSpreadsheet className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="text-sm font-mono text-slate-700 truncate flex-1" dir="ltr">
            {file.name}
          </span>
          <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
            {formatBytes(file.size)}
          </span>
          <button
            type="button"
            onClick={() => selectFile(null)}
            aria-label={BULK_FILE_BTN_REMOVE}
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {preflightErr && (
        <p role="alert" className="text-xs text-rose-600">{preflightErr}</p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={closeIngestionModal}
          disabled={submitting}
          className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
        >
          {INGEST_MODAL_BTN_CANCEL}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !file}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {BULK_FILE_BTN_SUBMITTING}</>
            : <><Upload className="w-4 h-4" /> {BULK_FILE_BTN_SUBMIT}</>
          }
        </button>
      </div>
    </div>
  );
}
