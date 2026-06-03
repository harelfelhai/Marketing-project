/**
 * EntityFileUploadPanel — Phase E2-D Tab 2 (Excel/CSV entity bulk upload).
 *
 * Mirrors the phone-side `FileUploadPanel` architecturally: template
 * download → file selection (drag/drop or browse) → preflight (extension
 * + size) → submit → BulkResultPanel inline. The only differences vs.
 * the phone-side panel are the API endpoints and the column contract
 * (entity bulk-upload uses 4 columns: first_name, relation_type,
 * target_entity_id, last_name).
 *
 * Each row in the file creates one Entity (no shared envelope). Per-row
 * failures land in the summary; file-shape errors (wrong extension,
 * missing required columns, too many rows) surface as toasts.
 */

import { useCallback, useRef, useState } from 'react';
import { Loader2, Upload, Download, FileSpreadsheet, X } from 'lucide-react';

import { bulkIngestEntityUpload, getEntityBulkTemplate } from '../../api/entityApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import BulkResultPanel from '../ingestion/BulkResultPanel';
import {
  ENTITY_FILE_INTRO,
  ENTITY_FILE_DROPZONE, ENTITY_FILE_DROPZONE_HINT,
  ENTITY_FILE_BTN_BROWSE, ENTITY_FILE_BTN_REMOVE, ENTITY_FILE_BTN_DOWNLOAD,
  ENTITY_FILE_BTN_SUBMIT, ENTITY_FILE_BTN_SUBMITTING,
  ENTITY_FILE_ERR_EMPTY, ENTITY_FILE_ERR_EXTENSION, ENTITY_FILE_ERR_SIZE,
  ENTITY_FILE_TOAST_TEMPLATE_OK, ENTITY_FILE_TOAST_TEMPLATE_ERR,
  ENTITY_FILE_TOAST_UPLOAD_ERR,
  ENTITY_BULK_BTN_NEW_BATCH,
  ENTITY_BTN_CANCEL,
  BULK_FILE_SIZE_KB, BULK_FILE_SIZE_MB,
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

export default function EntityFileUploadPanel() {
  const mockDb = useMockData();
  const { closeEntityIngestionModal, pushToast } = useUI();

  const [file, setFile]                 = useState(null);
  const [preflightErr, setPreflightErr] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [summary, setSummary]           = useState(null);
  const [downloading, setDownloading]   = useState(false);
  const [dragOver, setDragOver]         = useState(false);

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
      setPreflightErr(ENTITY_FILE_ERR_EXTENSION(ext || ''));
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setPreflightErr(ENTITY_FILE_ERR_SIZE(formatBytes(f.size), formatBytes(MAX_BYTES)));
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
      await getEntityBulkTemplate();
      pushToast({ variant: 'success', message: ENTITY_FILE_TOAST_TEMPLATE_OK });
    } catch (err) {
      pushToast({ variant: 'error', message: ENTITY_FILE_TOAST_TEMPLATE_ERR(err.message) });
    } finally {
      setDownloading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!file) {
      setPreflightErr(ENTITY_FILE_ERR_EMPTY);
      return;
    }
    setSubmitting(true);
    try {
      const result = await bulkIngestEntityUpload(file, mockDb);
      setSummary(result);
    } catch (err) {
      pushToast({ variant: 'error', message: ENTITY_FILE_TOAST_UPLOAD_ERR(err.message) });
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
  // Result mode — same BulkResultPanel as the phone-side flow.
  // -------------------------------------------------------------------------
  if (summary) {
    return (
      <div className="space-y-5" dir="rtl">
        <BulkResultPanel summary={summary} />
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={closeEntityIngestionModal}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {ENTITY_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={handleNewBatch}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4" />
            {ENTITY_BULK_BTN_NEW_BATCH}
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
        <p className="text-sm text-slate-500 flex-1">{ENTITY_FILE_INTRO}</p>
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
          {ENTITY_FILE_BTN_DOWNLOAD}
        </button>
      </div>

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
        data-testid="entity-file-dropzone"
      >
        <FileSpreadsheet className="w-8 h-8 text-slate-400" />
        <p className="text-sm font-medium text-slate-700">{ENTITY_FILE_DROPZONE}</p>
        <p className="text-[11px] text-slate-400">{ENTITY_FILE_DROPZONE_HINT}</p>
        <span className="inline-flex items-center gap-1 mt-1 text-xs text-slate-600 font-medium underline">
          {ENTITY_FILE_BTN_BROWSE}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          onChange={handleInputChange}
          className="hidden"
          data-testid="entity-file-input"
        />
      </div>

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
            aria-label={ENTITY_FILE_BTN_REMOVE}
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
          onClick={closeEntityIngestionModal}
          disabled={submitting}
          className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
        >
          {ENTITY_BTN_CANCEL}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !file}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {ENTITY_FILE_BTN_SUBMITTING}</>
            : <><Upload className="w-4 h-4" /> {ENTITY_FILE_BTN_SUBMIT}</>
          }
        </button>
      </div>
    </div>
  );
}
