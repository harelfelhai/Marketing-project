/**
 * TaskFilterBar — data-driven filter bar for the operations surface.
 *
 * Active filter fields are loaded from system settings (filter_fields.operations).
 * When a text/select field is deactivated its UIContext value is cleared.
 * Toggle fields (hideResolved) are left unchanged when deactivated — the admin
 * decides the default behavior by choosing whether to include the toggle.
 * Filter state lives in UIContext so values survive tab navigation.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

import { useUI }       from '../../contexts/UIContext';
import { useMockData } from '../../contexts/MockDataContext';
import { getSystemSettings } from '../../api/systemApi';
import { resolveActiveFilters } from '../../config/filterFields';
import { resolveCustomFilters } from '../../config/customFilters';
import CustomFilterControls from '../filters/CustomFilterControls';
import { taskStatusLabel, taskTypeLabel } from '../../utils/classifyStatus';
import {
  TASK_FILTER_SEARCH_PLACEHOLDER,
  TASK_FILTER_ALL_STATUSES,
  TASK_FILTER_ALL_TYPES,
  TASK_FILTER_BTN_CLEAR,
  TASK_FILTER_PHONE_CHIP,
  TASK_FILTER_CLIENT_CHIP,
  TASK_FILTER_OPEN_ONLY_CHIP,
  TASK_FILTER_SHOW_RESOLVED,
  FILTER_ALL_CLIENTS,
} from '../../config/strings.he';

// Text/select keys that should be cleared (to '') when deactivated.
const TEXT_SELECT_KEYS = ['search', 'status', 'taskType', 'rootEntityId'];

export default function TaskFilterBar() {
  const mockDb = useMockData();
  const { clients, vocabularies } = mockDb;
  const {
    taskFilters, updateTaskFilters, resetTaskFilters,
    customFilterValues, updateCustomFilterValues, resetCustomFilterValues,
  } = useUI();
  const customValues = customFilterValues.operations || {};

  // Status / type values from the operator-managed vocabularies (single
  // source of truth). Labels still come from classifyStatus's label maps,
  // which fall back to the raw token for operator-added values.
  const STATUS_OPTIONS = vocabularies?.task_statuses || [];
  const TYPE_OPTIONS   = vocabularies?.task_types || [];

  // Load active filter fields + custom filters from settings.
  const [activeFilters, setActiveFilters] = useState(() =>
    resolveActiveFilters('operations', null)
  );
  const [customFilters, setCustomFilters] = useState([]);
  useEffect(() => {
    let alive = true;
    getSystemSettings(mockDb)
      .then((s) => {
        if (!alive) return;
        setActiveFilters(resolveActiveFilters('operations', s.filter_fields || {}));
        setCustomFilters(resolveCustomFilters('operations', s.custom_filters || {}));
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeKeys = useMemo(() => new Set(activeFilters.map((f) => f.key)), [activeFilters]);

  // Auto-clear UIContext values for text/select fields that are no longer active.
  useEffect(() => {
    const toClear = {};
    for (const key of TEXT_SELECT_KEYS) {
      if (!activeKeys.has(key) && taskFilters[key]) {
        toClear[key] = '';
      }
    }
    if (Object.keys(toClear).length > 0) updateTaskFilters(toClear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeys]);

  const hasAnyCustom = customFilters.some((d) => {
    const v = customValues[d.key];
    return v != null && v !== '';
  });
  const hasAny =
    taskFilters.status   ||
    taskFilters.taskType ||
    taskFilters.search   ||
    taskFilters.phoneId  != null ||
    taskFilters.rootEntityId != null ||
    taskFilters.openOnly ||
    hasAnyCustom;

  const clearAll = () => {
    resetTaskFilters();
    resetCustomFilterValues('operations');
  };

  const selectClass =
    'h-9 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-800 ' +
    'focus:outline-none focus:ring-2 focus:ring-slate-300 min-w-0';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2">

      {activeKeys.has('search') && (
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
      )}

      {activeKeys.has('status') && (
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
      )}

      {activeKeys.has('taskType') && (
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
      )}

      {activeKeys.has('rootEntityId') && (
        <select
          value={taskFilters.rootEntityId ?? ''}
          onChange={(e) => updateTaskFilters({ rootEntityId: e.target.value || null })}
          className={selectClass}
        >
          <option value="">{FILTER_ALL_CLIENTS}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {activeKeys.has('hideResolved') && (
        <label
          htmlFor="task-show-resolved-toggle"
          className="inline-flex items-center gap-2 h-9 px-2 text-sm text-slate-700 cursor-pointer select-none"
        >
          <input
            id="task-show-resolved-toggle"
            type="checkbox"
            checked={!taskFilters.hideResolved}
            onChange={(e) => updateTaskFilters({ hideResolved: !e.target.checked })}
            className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-300"
          />
          {TASK_FILTER_SHOW_RESOLVED}
        </label>
      )}

      {/* Cross-link chips: shown when the filter was seeded from a URL param.
          No dedicated UI control — clear via the reset button. */}
      {taskFilters.phoneId != null && (
        <span className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800">
          {TASK_FILTER_PHONE_CHIP(taskFilters.phoneId)}
        </span>
      )}
      {taskFilters.rootEntityId != null && !activeKeys.has('rootEntityId') && (
        <span className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md border border-sky-200 bg-sky-50 text-sky-800">
          {TASK_FILTER_CLIENT_CHIP(taskFilters.rootEntityId)}
        </span>
      )}
      {taskFilters.openOnly && (
        <span className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800">
          {TASK_FILTER_OPEN_ONLY_CHIP}
        </span>
      )}

      <CustomFilterControls
        descriptors={customFilters}
        values={customValues}
        onChange={(partial) => updateCustomFilterValues('operations', partial)}
      />

      {hasAny && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          {TASK_FILTER_BTN_CLEAR}
        </button>
      )}
    </div>
  );
}
