/**
 * TableExportButton — Phase EXP: drop-in export trigger for any table.
 *
 * Single shared component, used by `/phones` and `/operations`. Renders
 * a compact split-button next to the filter bar:
 *
 *   ┌──────────────────────────┐
 *   │ ⬇  ייצא לאקסל   ▾        │
 *   └──────────────────────────┘
 *
 *   - Main click   → export immediately with current filters + saved
 *                    column selection.
 *   - Chevron click → small menu with "Customize fields…" → opens the
 *                    ExportConfigModal.
 *
 * Caller responsibilities (via props):
 *   - `tableId`            — 'phones' | 'tasks'
 *   - `getCurrentFilters`  — () => { ...same shape as the list endpoint }
 *                            Reads UIContext filters lazily so we always
 *                            send the live state at click time, not stale
 *                            snapshots.
 *   - `filenameHint`       — optional short label woven into the filename
 *                            (e.g. 'pending' when the operator is
 *                             looking at the pending sub-view).
 *
 * State persistence — operator's column selection lives in localStorage
 * per table (`tableExport:{tableId}:v1`). Stale keys (catalog dropped
 * them) are silently filtered by the modal + the buildExportColumns
 * helper, so this never crashes on schema drift.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, Loader2, Settings } from 'lucide-react';

import { exportTable } from '../../api/exportApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import { normalizeError } from '../../api/client';
import {
  EXPORT_CATALOG_BY_TABLE,
  buildExportColumns,
} from '../../config/exportCatalog';
import ExportConfigModal from './ExportConfigModal';
import {
  EXPORT_BTN_LABEL, EXPORT_BTN_MENU_CURRENT, EXPORT_BTN_MENU_CUSTOMIZE,
  EXPORT_BTN_PROCESSING,
  EXPORT_TOAST_SUCCESS, EXPORT_TOAST_TOO_MANY, EXPORT_TOAST_ERROR,
} from '../../config/strings.he';


/**
 * localStorage key for an operator's column selection.
 * Versioned (`v1`) so future catalog changes can be migrated without
 * stomping on existing saved state.
 */
function _storageKey(tableId) {
  return `tableExport:${tableId}:v1`;
}


/**
 * Read saved column keys from localStorage, falling back to catalog
 * defaults. Defensive on every layer — corrupted JSON, missing
 * catalog, non-array values all degrade quietly to defaults.
 */
function _loadSelectedKeys(tableId) {
  const catalog = EXPORT_CATALOG_BY_TABLE[tableId];
  if (!catalog) return [];
  try {
    const raw = localStorage.getItem(_storageKey(tableId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return parsed;
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return [...catalog.defaults];
}


function _saveSelectedKeys(tableId, keys) {
  try {
    localStorage.setItem(_storageKey(tableId), JSON.stringify(keys));
  } catch {
    /* localStorage full / disabled — selection survives the session
       in component state, just doesn't persist across reloads. */
  }
}


export default function TableExportButton({
  tableId,
  getCurrentFilters,
  filenameHint,
}) {
  const mockDb = useMockData();
  const { pushToast } = useUI();

  const [selectedKeys, setSelectedKeys] = useState(() => _loadSelectedKeys(tableId));
  const [menuOpen,    setMenuOpen]      = useState(false);
  const [modalOpen,   setModalOpen]     = useState(false);
  const [submitting,  setSubmitting]    = useState(false);

  // Dismiss the menu when the operator clicks elsewhere. The split-
  // button has a tiny menu (2 items) so a global click-outside is
  // sufficient — no need for a popper / floating-ui dependency.
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const fireExport = useCallback(async () => {
    setSubmitting(true);
    setMenuOpen(false);
    try {
      const columns = buildExportColumns(tableId, selectedKeys);
      if (columns.length === 0) {
        // Modal's "Save and download" is the only path that allows
        // submitting empty (and it's disabled there); main button is
        // disabled too. Defensive — should never happen.
        return;
      }
      await exportTable(tableId, {
        filters:       getCurrentFilters() || {},
        columns,
        filename_hint: filenameHint,
      }, mockDb);
      pushToast({ variant: 'success', message: EXPORT_TOAST_SUCCESS });
      setModalOpen(false);
    } catch (err) {
      const { message } = normalizeError(err);
      // "Too many rows: NNN ..." → friendlier toast variant.
      const match = /Too many rows:\s*(\d+)/.exec(message || '');
      if (match) {
        pushToast({ variant: 'error', message: EXPORT_TOAST_TOO_MANY(match[1]) });
      } else {
        pushToast({ variant: 'error', message: EXPORT_TOAST_ERROR(message || 'error') });
      }
    } finally {
      setSubmitting(false);
    }
  }, [tableId, selectedKeys, getCurrentFilters, filenameHint, mockDb, pushToast]);

  const handleSelectedKeysChange = useCallback((nextKeys) => {
    setSelectedKeys(nextKeys);
    _saveSelectedKeys(tableId, nextKeys);
  }, [tableId]);

  const handleSaveAndExport = useCallback(async () => {
    // The modal already persisted via onChange callbacks; just fire.
    await fireExport();
  }, [fireExport]);

  return (
    <>
      <div ref={menuRef} className="relative inline-flex">
        {/* Main button — fires the export with current settings. */}
        <button
          type="button"
          onClick={fireExport}
          disabled={submitting || selectedKeys.length === 0}
          data-testid={`export-${tableId}-button`}
          className="inline-flex items-center gap-2 h-9 ps-3 pe-2 rounded-s-md border border-slate-300 bg-white hover:bg-slate-50 text-sm text-slate-700 transition-colors disabled:opacity-50"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {EXPORT_BTN_PROCESSING}</>
            : <><Download className="w-4 h-4" /> {EXPORT_BTN_LABEL}</>
          }
        </button>
        {/* Chevron button — opens the menu. */}
        <button
          type="button"
          aria-label="export options menu"
          onClick={() => setMenuOpen((o) => !o)}
          disabled={submitting}
          data-testid={`export-${tableId}-menu-toggle`}
          className="inline-flex items-center justify-center h-9 px-1.5 rounded-e-md border border-s-0 border-slate-300 bg-white hover:bg-slate-50 text-slate-500 disabled:opacity-50"
        >
          <ChevronDown className="w-4 h-4" />
        </button>

        {/* Tiny menu — two items. Positioned absolutely below the
            split-button group. */}
        {menuOpen && (
          <div
            role="menu"
            className="absolute top-full mt-1 end-0 z-30 min-w-[200px] rounded-md border border-slate-200 bg-white shadow-lg py-1"
          >
            <button
              type="button"
              role="menuitem"
              onClick={fireExport}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-4 h-4" />
              {EXPORT_BTN_MENU_CURRENT}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid={`export-${tableId}-customize`}
              onClick={() => { setMenuOpen(false); setModalOpen(true); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Settings className="w-4 h-4" />
              {EXPORT_BTN_MENU_CUSTOMIZE}
            </button>
          </div>
        )}
      </div>

      <ExportConfigModal
        tableId={tableId}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        selectedKeys={selectedKeys}
        onChange={handleSelectedKeysChange}
        onSaveAndExport={handleSaveAndExport}
        submitting={submitting}
      />
    </>
  );
}
