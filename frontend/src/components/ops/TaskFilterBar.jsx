/**
 * TaskFilterBar — controls bound to UIContext.taskFilters (Phase DX).
 *
 * Filter state lives in UIContext so values survive tab navigation
 * (same convention as PhoneFilterBar §4.6 of the handover).
 *
 * Search icon is right-anchored (RTL: start-side = right).
 */

import { Search, X } from 'lucide-react';

import { useUI } from '../../contexts/UIContext';
import { taskStatusLabel, taskTypeLabel } from '../../utils/classifyStatus';
import {
  TASK_FILTER_SEARCH_PLACEHOLDER,
  TASK_FILTER_ALL_STATUSES,
  TASK_FILTER_ALL_TYPES,
  TASK_FILTER_BTN_CLEAR,
  TASK_FILTER_PHONE_CHIP,
  TASK_FILTER_CLIENT_CHIP,
} from '../../config/strings.he';

const STATUS_OPTIONS = ['pending', 'assigned', 'resolved', 'rejected'];
const TYPE_OPTIONS   = ['remediation_failure', 'approval_required', 'manual_recommendation'];

export default function TaskFilterBar() {
  const { taskFilters, updateTaskFilters, resetTaskFilters } = useUI();

  const hasAny =
    taskFilters.status   ||
    taskFilters.taskType ||
    taskFilters.search   ||
    taskFilters.phoneId  != null ||
    taskFilters.clientId != null;

  const selectClass =
    'h-9 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-800 ' +
    'focus:outline-none focus:ring-2 focus:ring-slate-300 min-w-0';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
      {/* Search — icon on the right (RTL start side) */}
      <div className="relative grow min-w-[200px]">
        <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={taskFilters.search}
          onChange={(e) => updateTaskFilters({ search: e.target.value })}
          placeholder={TASK_FILTER_SEARCH_PLACEHOLDER}
          className="w-full h-9 pr-8 ps-3 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>

      {/* Status */}
      <select
        value={taskFilters.status}
        onChange={(e) => updateTaskFilters({ status: e.target.value })}
        className={selectClass}
      >
        <option value="">{TASK_FILTER_ALL_STATUSES}</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{taskStatusLabel(s)}</option>
        ))}
      </select>

      {/* Task type */}
      <select
        value={taskFilters.taskType}
        onChange={(e) => updateTaskFilters({ taskType: e.target.value })}
        className={selectClass}
      >
        <option value="">{TASK_FILTER_ALL_TYPES}</option>
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>{taskTypeLabel(t)}</option>
        ))}
      </select>

      {/* Cross-link chips: shown when the filter was seeded from a URL param.
          No dedicated UI control — clear via the reset button. */}
      {taskFilters.phoneId != null && (
        <span className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800">
          {TASK_FILTER_PHONE_CHIP(taskFilters.phoneId)}
        </span>
      )}
      {taskFilters.clientId != null && (
        <span className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md border border-sky-200 bg-sky-50 text-sky-800">
          {TASK_FILTER_CLIENT_CHIP(taskFilters.clientId)}
        </span>
      )}

      {hasAny && (
        <button
          type="button"
          onClick={resetTaskFilters}
          className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          {TASK_FILTER_BTN_CLEAR}
        </button>
      )}
    </div>
  );
}
