/**
 * EntityIngestionModal — Phase E2 entity-centric ingestion modal.
 *
 * Sibling of `IngestionModal` (phone-centric). Mounted globally at App
 * level so it survives all route changes. Operators open it via the
 * "+ Add Person" header button.
 *
 * Three operator-facing channels live behind a tab strip:
 *
 *   1. Single        — one named individual associated with a root target.
 *   2. Multi-Text    — Two-Step grid (Phase E2-D, placeholder for now).
 *   3. File Upload   — Excel/CSV upload (Phase E2-D, placeholder for now).
 *
 * The modal owns the tab strip and panel routing; each panel owns its
 * own submit lifecycle. Inactive panels are NOT mounted (rather than
 * hidden with CSS) so each tab's local state resets cleanly when the
 * operator switches tabs — matching `IngestionModal`'s convention.
 */

import { useState, useEffect } from 'react';
import { User, ClipboardList, FileSpreadsheet } from 'lucide-react';

import Modal from '../primitives/Modal';
import SingleEntityPanel       from './SingleEntityPanel';
import MultiEntityIngestionPanel from './MultiEntityIngestionPanel';
import EntityFileUploadPanel   from './EntityFileUploadPanel';
import { useUI } from '../../contexts/UIContext';
import {
  ENTITY_MODAL_TITLE,
  ENTITY_TAB_SINGLE, ENTITY_TAB_MULTI_TEXT, ENTITY_TAB_FILE,
} from '../../config/strings.he';

const TABS = [
  { id: 'single',     label: ENTITY_TAB_SINGLE,     Icon: User            },
  { id: 'multi-text', label: ENTITY_TAB_MULTI_TEXT, Icon: ClipboardList   },
  { id: 'file',       label: ENTITY_TAB_FILE,       Icon: FileSpreadsheet },
];

export default function EntityIngestionModal() {
  const { isEntityIngestionModalOpen, closeEntityIngestionModal } = useUI();
  const [activeTab, setActiveTab] = useState('single');

  // Reset to the default tab whenever the modal closes — operators
  // expect "blank slate on reopen" (same convention as IngestionModal).
  useEffect(() => {
    if (!isEntityIngestionModalOpen) setActiveTab('single');
  }, [isEntityIngestionModalOpen]);

  return (
    <Modal
      isOpen={isEntityIngestionModalOpen}
      onClose={closeEntityIngestionModal}
      title={ENTITY_MODAL_TITLE}
      size="xl"
    >
      {/* Tab strip */}
      <div
        role="tablist"
        aria-label="Entity ingestion mode"
        className="flex gap-1 border-b border-slate-200 -mx-5 -mt-4 px-5 mb-4"
      >
        {TABS.map(({ id, label, Icon }) => {
          const selected = id === activeTab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`entity-tab-${id}`}
              aria-controls={`entity-panel-${id}`}
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

      {/* Active panel — mounted by tab. */}
      <div
        role="tabpanel"
        id={`entity-panel-${activeTab}`}
        aria-labelledby={`entity-tab-${activeTab}`}
      >
        {activeTab === 'single' && (
          <SingleEntityPanel
            active={isEntityIngestionModalOpen && activeTab === 'single'}
          />
        )}
        {activeTab === 'multi-text' && <MultiEntityIngestionPanel />}
        {activeTab === 'file'       && <EntityFileUploadPanel />}
      </div>
    </Modal>
  );
}
