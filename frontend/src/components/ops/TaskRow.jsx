/**
 * TaskRow — single row in the OperationsQueue TaskTable (Phase DX).
 *
 * Five strictly-sized columns per §4.4 layout discipline:
 *   1. task_type badge + created_at caption
 *   2. phone_number + entity caption
 *   3. client_name + client_id caption
 *   4. status badge + requested_by + (if resolved) resolved_by
 *   5. updated_at (tabular-nums)
 *
 * Every overflowing cell uses `flex flex-col min-w-0 max-w-[...]` + `truncate`
 * + `title={fullValue}` per the §4.4 truncation contract — without `min-w-0`
 * the flex children refuse to shrink and the colgroup breaks.
 *
 * Click selects the row → DX-4 will wire this to opening the detail drawer.
 * For now `onSelect` is a no-op when omitted.
 */

import Badge from '../primitives/Badge';
import {
  taskStatusVariant, taskStatusLabel,
  taskTypeVariant,   taskTypeLabel,
} from '../../utils/classifyStatus';
import { formatRelative } from '../../utils/formatDate';
import {
  TASK_ROW_REQUESTED_BY,
  TASK_ROW_RESOLVED_BY,
  TASK_ROW_ENTITY_LINE,
} from '../../config/strings.he';

export default function TaskRow({ task, isSelected, onSelect }) {
  const handleClick = () => onSelect?.(task.id);

  return (
    <tr
      onClick={handleClick}
      className={`cursor-pointer border-b border-slate-100 transition-colors ${
        isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
      }`}
    >
      {/* Column 1 — task_type badge + created_at caption */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col gap-1 min-w-0">
          <Badge
            variant={taskTypeVariant(task.task_type)}
            size="sm"
            className="self-start"
          >
            {taskTypeLabel(task.task_type)}
          </Badge>
          <span className="text-[10px] text-slate-400 tabular-nums">
            {formatRelative(task.created_at)}
          </span>
        </div>
      </td>

      {/* Column 2 — phone_number (mono) + entity caption */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col min-w-0 max-w-[170px]">
          <span
            className="font-mono text-sm font-semibold text-slate-900 truncate"
            title={task.phone_number || `#${task.phone_id}`}
          >
            {task.phone_number || `#${task.phone_id}`}
          </span>
          <span
            className="text-xs text-slate-500 truncate"
            title={TASK_ROW_ENTITY_LINE(task.entity_id, task.entity_type || '—')}
          >
            {TASK_ROW_ENTITY_LINE(task.entity_id, task.entity_type || '—')}
          </span>
        </div>
      </td>

      {/* Column 3 — client_name + client_id caption */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col min-w-0 max-w-[170px]">
          <span
            className="text-sm font-medium text-slate-800 truncate"
            title={task.client_name || '—'}
          >
            {task.client_name || '—'}
          </span>
          <span className="text-[11px] text-slate-400 uppercase tracking-wide">
            #{task.client_id ?? '—'}
          </span>
        </div>
      </td>

      {/* Column 4 — status badge + attribution captions */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col gap-1 items-start min-w-0">
          <Badge variant={taskStatusVariant(task.status)} size="sm">
            {taskStatusLabel(task.status)}
          </Badge>
          <span
            className="text-[10px] text-slate-500 truncate max-w-[260px]"
            title={task.requested_by}
          >
            {TASK_ROW_REQUESTED_BY(task.requested_by)}
          </span>
          {task.resolved_by && (
            <span
              className="text-[10px] text-emerald-700 truncate max-w-[260px]"
              title={task.resolved_by}
            >
              {TASK_ROW_RESOLVED_BY(task.resolved_by)}
            </span>
          )}
        </div>
      </td>

      {/* Column 5 — updated_at */}
      <td className="px-4 py-3 align-middle">
        <span className="text-sm text-slate-700 tabular-nums whitespace-nowrap">
          {formatRelative(task.updated_at)}
        </span>
      </td>
    </tr>
  );
}
