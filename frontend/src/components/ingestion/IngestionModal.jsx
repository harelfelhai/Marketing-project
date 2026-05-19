/**
 * IngestionModal — multi-tab phone-number ingestion modal (Phase E1-C).
 *
 * Three operator-facing channels live behind a tab strip:
 *
 *   1. Single        — the original DynamicField-driven single-row form.
 *                      Pre-E1 contract preserved verbatim in SingleIngestionPanel.
 *   2. Multi-Text    — paste a list under a shared envelope; collapses
 *                      into ONE new Entity + N PhoneNumbers (Phase E1-A
 *                      backend endpoint).
 *   3. File Upload   — Excel/CSV upload + template download (Phase E1-D,
 *                      placeholder for now).
 *
 * The modal itself owns only the tab strip + the active-panel switch; each
 * panel owns its own submit button, validation state, and reset behaviour
 * so they can evolve independently.
 */

import { useState, useEffect } from 'react';
import { User, ClipboardList, FileSpreadsheet } from 'lucide-react';

import Modal             from '../primitives/Modal';
import SingleIngestionPanel    from './SingleIngestionPanel';
import MultiTextIngestionPanel from './MultiTextIngestionPanel';
import FileUploadPanel         from './FileUploadPanel';
import { useUI } from '../../contexts/UIContext';
import {
  INGEST_MODAL_TITLE_BULK,
  INGEST_TAB_SINGLE, INGEST_TAB_MULTI_TEXT, INGEST_TAB_FILE,
} from '../../config/strings.he';

const TABS = [
  { id: 'single',     label: INGEST_TAB_SINGLE,     Icon: User             },
  { id: 'multi-text', label: INGEST_TAB_MULTI_TEXT, Icon: ClipboardList    },
  { id: 'file',       label: INGEST_TAB_FILE,       Icon: FileSpreadsheet  },
];

export default function IngestionModal() {
  const { isIngestionModalOpen, closeIngestionModal } = useUI();
  const [activeTab, setActiveTab] = useState('single');

  // Reset to the default tab whenever the modal closes so the next open
  // starts in a known state (operators expect "blank slate on reopen").
  useEffect(() => {
    if (!isIngestionModalOpen) setActiveTab('single');
  }, [isIngestionModalOpen]);

  return (
    <Modal
      isOpen={isIngestionModalOpen}
      onClose={closeIngestionModal}
      title={INGEST_MODAL_TITLE_BULK}
      size="xl"
    >
      {/* Tab strip */}
      <div
        role="tablist"
        aria-label="Ingestion mode"
        className="flex gap-1 border-b border-slate-200 -mx-5 -mt-4 px-5 mb-4"
      >
        {TABS.map(({ id, label, Icon }) => {
          const selected = id === activeTab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`ingest-tab-${id}`}
              aria-controls={`ingest-panel-${id}`}
              aria-selected={selected}
              onClick={() => setActiveTab(id)}
              className={[
                'inline-flex items-center gap-2 px-3 py-2 -mb-px text-sm font-medium',
                'border-b-2 transition-colors',
                selected
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Active panel — rendered via conditional mount so each panel's
          local state (form values, summary view) resets when the operator
          switches tabs. Mounting all three side-by-side with display:none
          would persist that state across tabs, which is the wrong default
          for an ingestion modal. */}
      <div
        role="tabpanel"
        id={`ingest-panel-${activeTab}`}
        aria-labelledby={`ingest-tab-${activeTab}`}
      >
        {activeTab === 'single'     && <SingleIngestionPanel active={isIngestionModalOpen && activeTab === 'single'} />}
        {activeTab === 'multi-text' && <MultiTextIngestionPanel />}
        {activeTab === 'file'       && <FileUploadPanel />}
      </div>
    </Modal>
  );
}
