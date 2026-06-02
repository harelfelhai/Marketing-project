/**
 * TaskTable — 5-column scannable table over MockDataContext.tasks (Phase DX).
 *
 * Uses `table-fixed` with explicit <colgroup> widths so layout is
 * deterministic and skeleton rows can match the live rows pixel-for-pixel
 * (§4.4 layout discipline).
 *
 * Filter application:
 *   - status   — exact match on task.status
 *   - taskType — exact match on task.task_type
 *   - search   — client-side substring over phone_number + client_name +
 *                requested_by + resolved_by (Phase D §3.4 client-side
 *                search convention; no backend equivalent).
 *
 * Loading discipline: when `loading === true`, renders 8 skeleton rows
 * inside the same colgroup so the empty-state never flashes before data
 * arrives (Phase D §6.2 Deliverable 3 rule).
 */

import { useEffect, useMemo, useState } from 'react';

import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import { resolveCustomFilters, rowMatchesCustom } from '../../config/customFilters';
import { resolveVisibleColumns } from '../../config/displayFields';
import { getSystemSettings } from '../../api/systemApi';
import TaskRow         from './TaskRow';
import Skeleton        from '../primitives/Skeleton';
import {
  TASK_TABLE_COL_CLIENT,
  TASK_TABLE_EMPTY, TASK_TABLE_SHOWING,
  TASK_HEADER_SELECT_ALL_ARIA,
} from '../../config/strings.he';

const SKELETON_ROW_COUNT = 8;

// Physical table columns (the selection checkbox is structural, always shown,
// and not listed here). Order is fixed; visibility is config-driven via the
// 'operations' display-fields surface. The `client` physical column also hosts
// the optional `client_id` caption, so it shows when either key is enabled.
const PHYSICAL_COLUMNS = [
  { key: 'task_type', widthClass: 'w-[180px]' },
  { key: 'phone',     widthClass: 'w-[180px]' },
  { key: 'client',    widthClass: 'w-[180px]' },
  { key: 'status',    widthClass: null },        // flex column
  { key: 'updated',   widthClass: 'w-[140px]' },
];

/**
 * applyFilters — pure filter function for unit-testability.
 *
 * Exported so DX-T2 tests/unit/TaskTable.applyFilters.test.js can exercise
 * the combinatorial matrix of status × taskType × phoneId × rootEntityId ×
 * openOnly × search without mounting the React tree. Component code
 * imports the default export below; tests import the named export.
 */
export function applyFilters(tasks, filters) {
  // Phase AUTH-C — multi-value personalization filter, derived in
  // OperationsQueuePage from useAuth().
  const clientIdsAllowed = filters.rootEntityIds?.length
    ? new Set(filters.rootEntityIds.map(String))
    : null;
  return tasks.filter((t) => {
    if (clientIdsAllowed && !clientIdsAllowed.has(String(t.root_entity_id))) return false;
    if (filters.status   && t.status    !== filters.status)   return false;
    if (filters.taskType && t.task_type !== filters.taskType) return false;
    // phoneId is seeded from the /operations?phone_id=N cross-link from
    // PhoneDetailDrawer; cleared via the filter-bar reset button.
    if (filters.phoneId != null && String(t.phone_id) !== String(filters.phoneId)) {
      return false;
    }
    // rootEntityId is seeded from /operations?root_entity_id=N cross-link from
    // ClientCard (Phase DX-5). Same String(...) coercion as §5.1.
    if (filters.rootEntityId != null && String(t.root_entity_id) !== String(filters.rootEntityId)) {
      return false;
    }
    // openOnly is seeded from /operations?open=true (ClientCard open-task
    // badge). Restricts the view to non-terminal statuses so the badge's
    // "N משימות פתוחות" promise matches what the table actually shows.
    if (filters.openOnly && t.status !== 'pending') {
      return false;
    }
    if (filters.hideResolved && !filters.status) {
      if (t.status === 'done' || t.status === 'rejected') return false;
    }
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      const hay = [
        t.phone_number   || '',
        t.client_name    || '',
        String(t.root_entity_id ?? ''),
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // Admin-defined custom filters (incl. extra_data keys) — evaluated against
    // the task row, mirroring the backend `filters` param (Stage 2B).
    if (filters.customDescriptors?.length
        && !rowMatchesCustom(t, filters.customDescriptors, filters.customValues)) {
      return false;
    }
    return true;
  });
}

export default function TaskTable({
  selectedId,
  onSelect,
  selectedIds,
  onToggleRow,
  onToggleAll,
  rootEntityIds,
}) {
  const mockDb = useMockData();
  const { tasks, loading } = mockDb;
  const { taskFilters, customFilterValues } = useUI();

  const [customDescriptors, setCustomDescriptors] = useState([]);
  const [displayFields, setDisplayFields] = useState(null);
  const [displayLabels, setDisplayLabels] = useState(null);
  useEffect(() => {
    let alive = true;
    getSystemSettings(mockDb)
      .then((s) => {
        if (!alive) return;
        setCustomDescriptors(resolveCustomFilters('operations', s.custom_filters || {}));
        setDisplayFields(s.display_fields || {});
        setDisplayLabels(s.display_labels || {});
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Config-driven columns ('operations' surface). Defaults show every column,
  // so the table is unchanged until an admin toggles fields in System Settings.
  const visibleCols = useMemo(
    () => resolveVisibleColumns('operations', displayFields, displayLabels),
    [displayFields, displayLabels],
  );
  const visibleKeys = useMemo(() => new Set(visibleCols.map((c) => c.key)), [visibleCols]);
  const labelOf = useMemo(
    () => Object.fromEntries(visibleCols.map((c) => [c.key, c.label])),
    [visibleCols],
  );
  // Physical columns actually rendered, in fixed order. The client column is
  // kept when either the name or the id caption is enabled.
  const physCols = useMemo(() => PHYSICAL_COLUMNS.filter((c) =>
    c.key === 'client'
      ? (visibleKeys.has('client') || visibleKeys.has('client_id'))
      : visibleKeys.has(c.key),
  ), [visibleKeys]);
  const colSpan = physCols.length + 1;

  // Phase AUTH-C — same merge pattern as PhoneTable: the page derives
  // personalization rootEntityIds from useAuth and hands them in here.
  const customValues = customFilterValues.operations || {};
  const effectiveFilters = useMemo(
    () => ({
      ...taskFilters,
      ...(rootEntityIds?.length ? { rootEntityIds } : {}),
      customDescriptors,
      customValues,
    }),
    [taskFilters, rootEntityIds, customDescriptors, customValues]
  );

  const rows = useMemo(
    () => applyFilters(tasks, effectiveFilters),
    [tasks, effectiveFilters]
  );

  // Selection state semantics for the header checkbox:
  //   - unchecked: no row in the current view is selected
  //   - indeterminate: some but not all visible rows are selected
  //   - checked: every visible row is selected
  // Visible = post-filter. Selecting "all" only ever affects what the
  // operator can see — the bulk action will then act on those ids.
  const visibleIds = rows.map((r) => r.id);
  const selectedSet = selectedIds || new Set();
  const visibleSelectedCount = visibleIds.filter((id) => selectedSet.has(id)).length;
  const allChecked  = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const someChecked = visibleSelectedCount > 0 && !allChecked;

  return (
    <div
      className="bg-white rounded-lg border border-slate-200"
      aria-busy={loading || undefined}
    >
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[40px]" />
          {physCols.map((c) => (
            <col key={c.key} className={c.widthClass || undefined} />
          ))}
        </colgroup>
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-3 py-2.5">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = someChecked; }}
                onChange={() => onToggleAll?.(visibleIds, !allChecked)}
                aria-label={TASK_HEADER_SELECT_ALL_ARIA}
                disabled={visibleIds.length === 0}
                data-testid="task-select-all"
                className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-300"
              />
            </th>
            {physCols.map((c) => (
              <Th key={c.key}>
                {c.key === 'client' ? (labelOf.client || TASK_TABLE_COL_CLIENT) : labelOf[c.key]}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <TaskSkeletonRow key={i} colCount={physCols.length} />
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-slate-400">
                {TASK_TABLE_EMPTY}
              </td>
            </tr>
          ) : (
            rows.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                columns={physCols}
                visibleKeys={visibleKeys}
                isSelected={selectedId === task.id}
                onSelect={onSelect}
                isChecked={selectedSet.has(task.id)}
                onToggleRow={onToggleRow}
              />
            ))
          )}
        </tbody>
      </table>

      <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
        {loading ? ' ' : TASK_TABLE_SHOWING(rows.length, tasks.length)}
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-start text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
      {children}
    </th>
  );
}

function TaskSkeletonRow({ colCount }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-3">
        <Skeleton width={16} height={16} rounded="rounded" />
      </td>
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <Skeleton height={12} width="75%" />
            <Skeleton height={10} width="45%" />
          </div>
        </td>
      ))}
    </tr>
  );
}
