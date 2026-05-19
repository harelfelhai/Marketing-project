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

import { useMemo } from 'react';

import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import TaskRow         from './TaskRow';
import Skeleton        from '../primitives/Skeleton';
import {
  TASK_TABLE_COL_TYPE, TASK_TABLE_COL_PHONE, TASK_TABLE_COL_CLIENT,
  TASK_TABLE_COL_STATUS, TASK_TABLE_COL_UPDATED,
  TASK_TABLE_EMPTY, TASK_TABLE_SHOWING,
} from '../../config/strings.he';

const SKELETON_ROW_COUNT = 8;

/**
 * applyFilters — pure filter function for unit-testability.
 *
 * Exported so DX-T2 tests/unit/TaskTable.applyFilters.test.js can exercise
 * the combinatorial matrix of status × taskType × phoneId × clientId ×
 * openOnly × search without mounting the React tree. Component code
 * imports the default export below; tests import the named export.
 */
export function applyFilters(tasks, filters) {
  return tasks.filter((t) => {
    if (filters.status   && t.status    !== filters.status)   return false;
    if (filters.taskType && t.task_type !== filters.taskType) return false;
    // phoneId is seeded from the /operations?phone_id=N cross-link from
    // PhoneDetailDrawer; cleared via the filter-bar reset button.
    if (filters.phoneId != null && String(t.phone_id) !== String(filters.phoneId)) {
      return false;
    }
    // clientId is seeded from /operations?client_id=N cross-link from
    // ClientCard (Phase DX-5). Same String(...) coercion as §5.1.
    if (filters.clientId != null && String(t.client_id) !== String(filters.clientId)) {
      return false;
    }
    // openOnly is seeded from /operations?open=true (ClientCard open-task
    // badge). Restricts the view to non-terminal statuses so the badge's
    // "N משימות פתוחות" promise matches what the table actually shows.
    if (filters.openOnly && t.status !== 'pending' && t.status !== 'assigned') {
      return false;
    }
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      const hay = [
        t.phone_number   || '',
        t.client_name    || '',
        t.requested_by   || '',
        t.resolved_by    || '',
        String(t.client_id ?? ''),
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export default function TaskTable({ selectedId, onSelect }) {
  const { tasks, loading } = useMockData();
  const { taskFilters }    = useUI();

  const rows = useMemo(
    () => applyFilters(tasks, taskFilters),
    [tasks, taskFilters]
  );

  return (
    <div
      className="bg-white rounded-lg border border-slate-200"
      aria-busy={loading || undefined}
    >
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[180px]" />
          <col className="w-[180px]" />
          <col className="w-[180px]" />
          <col />
          <col className="w-[140px]" />
        </colgroup>
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>{TASK_TABLE_COL_TYPE}</Th>
            <Th>{TASK_TABLE_COL_PHONE}</Th>
            <Th>{TASK_TABLE_COL_CLIENT}</Th>
            <Th>{TASK_TABLE_COL_STATUS}</Th>
            <Th>{TASK_TABLE_COL_UPDATED}</Th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <TaskSkeletonRow key={i} />
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                {TASK_TABLE_EMPTY}
              </td>
            </tr>
          ) : (
            rows.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isSelected={selectedId === task.id}
                onSelect={onSelect}
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

function TaskSkeletonRow() {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={14} width={90} rounded="rounded-full" />
          <Skeleton height={10} width="50%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={12} width="80%" />
          <Skeleton height={10} width="50%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={12} width="70%" />
          <Skeleton height={10} width="35%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={14} width={80} rounded="rounded-full" />
          <Skeleton height={10} width="65%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Skeleton height={10} width="80%" />
      </td>
    </tr>
  );
}
