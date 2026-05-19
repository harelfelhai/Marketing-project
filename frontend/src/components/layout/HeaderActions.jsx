/**
 * HeaderActions — right-side action buttons in the global header.
 *
 * Two operator-facing ingestion entry points:
 *   1. "+ Ingest"      — opens the phone-centric IngestionModal (Phase E1).
 *   2. "+ Add Person"  — opens the entity-centric EntityIngestionModal
 *                        (Phase E2). Sibling modal hosting the single-entry,
 *                        two-step grid, and file-upload channels.
 *
 * Both buttons flip flags in UIContext. The modals themselves are
 * mounted globally in App.jsx so they survive route changes.
 */

import { Plus, UserPlus } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import { BTN_INGEST_NEW, BTN_ADD_PERSON } from '../../config/strings.he';

export default function HeaderActions() {
  const { openIngestionModal, openEntityIngestionModal } = useUI();

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={openEntityIngestionModal}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
      >
        <UserPlus className="w-4 h-4" />
        {BTN_ADD_PERSON}
      </button>
      <button
        type="button"
        onClick={openIngestionModal}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {BTN_INGEST_NEW}
      </button>
    </div>
  );
}
