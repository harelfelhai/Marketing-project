/**
 * ExportConfigModal — Phase EXP: column selection + ordering UI.
 *
 * Two-column layout (RTL: visually right→left in Hebrew):
 *   - "Currently in export" — selected columns, with remove (×) + up/
 *     down reorder buttons. Order in this list IS the .xlsx column
 *     order.
 *   - "Available to add"    — every catalog field NOT currently
 *     selected, each a checkbox-style add button.
 *
 * UX choices I made:
 *   - Checkboxes + arrow buttons, no drag-and-drop. Keyboard-accessible,
 *     mobile-safe, ships faster. DnD can land later if asked.
 *   - "Save and download" is the primary action — saves the selection
 *     to localStorage AND immediately fires the export. Operators who
 *     just want to save the config can use the secondary path: change
 *     → cancel → the change is discarded (no save-without-export).
 *     If you want pure save, hit X / Cancel and re-open the menu's
 *     main button. This is intentional friction so the modal stays
 *     single-purpose.
 *   - Reset link at the bottom restores `catalog.defaults`.
 *
 * State lives entirely in the parent (`TableExportButton`) so the
 * parent can hit Save-and-download without round-tripping props.
 */

import { useMemo } from 'react';
import { Plus, X, ChevronUp, ChevronDown, RotateCcw, Download } from 'lucide-react';

import Modal from '../primitives/Modal';
import { EXPORT_CATALOG_BY_TABLE } from '../../config/exportCatalog';
import {
  EXPORT_MODAL_TITLE,
  EXPORT_MODAL_VISIBLE_HEADER, EXPORT_MODAL_AVAILABLE_HEADER,
  EXPORT_MODAL_RESET, EXPORT_MODAL_CANCEL, EXPORT_MODAL_SAVE_AND_GO,
  EXPORT_MODAL_REMOVE_ARIA, EXPORT_MODAL_ADD_ARIA,
  EXPORT_MODAL_MOVE_UP_ARIA, EXPORT_MODAL_MOVE_DOWN_ARIA,
  EXPORT_MODAL_EMPTY_NOTE,
} from '../../config/strings.he';


export default function ExportConfigModal({
  tableId,
  isOpen,
  onClose,
  selectedKeys,       // string[] in current export order
  onChange,           // (nextKeys: string[]) => void  — also persists
  onSaveAndExport,    // () => void  — fired by the primary CTA
  submitting,
}) {
  const catalog = EXPORT_CATALOG_BY_TABLE[tableId];

  // O(1) lookup table for column metadata (label, format).
  const byKey = useMemo(
    () => new Map((catalog?.columns || []).map((c) => [c.key, c])),
    [catalog],
  );

  // Ordered list of selected column descriptors. Stale entries (a key
  // that was removed from the catalog after the operator saved a
  // selection) are filtered out — they'd be 422'd by the backend
  // anyway, so quietly dropping them is safer than surfacing a
  // confusing error.
  const selectedColumns = useMemo(
    () => selectedKeys.map((k) => byKey.get(k)).filter(Boolean),
    [selectedKeys, byKey],
  );

  // Available = everything in the catalog NOT in selectedKeys.
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const availableColumns = useMemo(
    () => (catalog?.columns || []).filter((c) => !selectedSet.has(c.key)),
    [catalog, selectedSet],
  );

  const handleRemove = (key) => onChange(selectedKeys.filter((k) => k !== key));
  const handleAdd    = (key) => onChange([...selectedKeys, key]);
  const handleReset  = () => onChange([...(catalog?.defaults || [])]);

  const handleMove = (key, delta) => {
    const idx = selectedKeys.indexOf(key);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= selectedKeys.length) return;
    const next = selectedKeys.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  if (!catalog) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={EXPORT_MODAL_TITLE} size="xl">
      <div className="grid grid-cols-2 gap-4" dir="rtl">

        {/* Selected column — right side in LTR / right side in RTL too;
            the Modal already flips with dir="rtl". */}
        <section
          aria-label="selected columns"
          className="rounded-md border border-slate-200 bg-slate-50/40 overflow-hidden"
        >
          <header className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700">
            {EXPORT_MODAL_VISIBLE_HEADER(selectedColumns.length)}
          </header>
          <ul data-testid="export-selected-list" className="max-h-[360px] overflow-y-auto">
            {selectedColumns.length === 0 && (
              <li className="px-3 py-4 text-xs text-rose-600">
                {EXPORT_MODAL_EMPTY_NOTE}
              </li>
            )}
            {selectedColumns.map((c, idx) => (
              <li
                key={c.key}
                data-testid={`export-selected-${c.key}`}
                className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100 text-sm"
              >
                <span className="flex-1 truncate" title={c.label}>{c.label}</span>
                <button
                  type="button"
                  aria-label={EXPORT_MODAL_MOVE_UP_ARIA(c.label)}
                  disabled={idx === 0}
                  onClick={() => handleMove(c.key, -1)}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label={EXPORT_MODAL_MOVE_DOWN_ARIA(c.label)}
                  disabled={idx === selectedColumns.length - 1}
                  onClick={() => handleMove(c.key, 1)}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label={EXPORT_MODAL_REMOVE_ARIA(c.label)}
                  onClick={() => handleRemove(c.key)}
                  className="text-slate-400 hover:text-rose-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Available column */}
        <section
          aria-label="available columns"
          className="rounded-md border border-slate-200 overflow-hidden"
        >
          <header className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700">
            {EXPORT_MODAL_AVAILABLE_HEADER(availableColumns.length)}
          </header>
          <ul data-testid="export-available-list" className="max-h-[360px] overflow-y-auto">
            {availableColumns.map((c) => (
              <li
                key={c.key}
                data-testid={`export-available-${c.key}`}
                className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100 text-sm"
              >
                <span className="flex-1 truncate text-slate-600" title={c.label}>
                  {c.label}
                </span>
                <button
                  type="button"
                  aria-label={EXPORT_MODAL_ADD_ARIA(c.label)}
                  onClick={() => handleAdd(c.key)}
                  className="inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md text-slate-700 hover:bg-slate-100"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-slate-200">
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1 h-8 px-2 text-xs text-slate-500 hover:text-slate-900"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {EXPORT_MODAL_RESET}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {EXPORT_MODAL_CANCEL}
          </button>
          <button
            type="button"
            onClick={onSaveAndExport}
            data-testid="export-modal-save"
            disabled={submitting || selectedKeys.length === 0}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {EXPORT_MODAL_SAVE_AND_GO}
          </button>
        </div>
      </div>
    </Modal>
  );
}
