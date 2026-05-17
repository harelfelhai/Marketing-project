/**
 * HeaderActions — right-side action buttons in the global header.
 *
 * Currently exposes a single button: "+ Ingest New Number", which flips the
 * isIngestionModalOpen flag in UIContext. The actual <IngestionModal> is
 * rendered in a later phase but the wiring is in place now.
 */

import { Plus } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

export default function HeaderActions() {
  const { openIngestionModal } = useUI();

  return (
    <button
      type="button"
      onClick={openIngestionModal}
      className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
    >
      <Plus className="w-4 h-4" />
      Ingest New Number
    </button>
  );
}
