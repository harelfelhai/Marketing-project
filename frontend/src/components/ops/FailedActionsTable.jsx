/**
 * FailedActionsTable — ActionLog endpoints were removed from the backend.
 * This component always renders the empty state.
 */

import {
  FAILED_TABLE_HEADING, FAILED_TABLE_SUBTITLE, FAILED_TABLE_EMPTY,
} from '../../config/strings.he';

export default function FailedActionsTable() {
  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{FAILED_TABLE_HEADING}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{FAILED_TABLE_SUBTITLE(0)}</p>
        </div>
      </header>
      <div className="px-4 py-10 text-center text-sm text-slate-400">
        {FAILED_TABLE_EMPTY}
      </div>
    </div>
  );
}
