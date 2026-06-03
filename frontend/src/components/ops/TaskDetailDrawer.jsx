/**
 * TaskDetailDrawer — left-anchored slide-over for the OperationsQueue
 * (Phase DX, DX-4).
 *
 * Three-region layout discipline per HANDOVER §4.5:
 *   - Header  shrink-0       (never compresses)
 *   - Body    flex-1 overflow-y-auto  (THE ONLY scroll surface)
 *   - Footer  shrink-0 sticky bottom-0 opaque bg + border-t
 *
 * Read-only payload viewer: the operator never edits a task's extra_data;
 * they resolve / reject. So this drawer uses a small inline definition
 * list rather than the editable JsonMetadataExplorer used on PhoneDrawer.
 *
 * Permission gating: the Resolve / Reject buttons in the footer are
 * wrapped in <RequireRole role="admin">. Today the mock returns 'admin'
 * so the gate is a no-op; Phase G tightens it in one swap.
 *
 * Terminal tasks (status in {resolved, rejected}) replace the footer
 * verdict buttons with a TASK_DRAWER_TERMINAL_NOTICE strip — once a
 * task is settled it cannot be re-settled (backend enforces this with
 * TaskStateTransitionError → 422; we surface the constraint visually).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ExternalLink } from 'lucide-react';

import Badge          from '../primitives/Badge';
import RequireRole    from '../primitives/RequireRole';
import ResolveTaskModal from './ResolveTaskModal';
import NotificationOptInPanel from '../notifications/NotificationOptInPanel';
import { useMockData } from '../../contexts/MockDataContext';
import {
  taskStatusVariant, taskStatusLabel,
  taskTypeVariant,   taskTypeLabel,
} from '../../utils/classifyStatus';
import { formatDateTime } from '../../utils/formatDate';
import {
  ARIA_TASK_DETAIL, ARIA_CLOSE_TASK_DRAWER,
  TASK_DRAWER_LABEL_PHONE, TASK_DRAWER_LABEL_CLIENT,
  TASK_DRAWER_LABEL_ENTITY,
  TASK_DRAWER_SECTION_PAYLOAD,
  TASK_DRAWER_EMPTY_PAYLOAD,
  TASK_DRAWER_OPEN_PHONE, TASK_DRAWER_TERMINAL_NOTICE,
  TASK_DRAWER_BTN_RESOLVE, TASK_DRAWER_BTN_REJECT,
} from '../../config/strings.he';

const TERMINAL_STATUSES = new Set(['done', 'rejected']);


export default function TaskDetailDrawer({ taskId, onClose }) {
  const { tasks }    = useMockData();
  const navigate     = useNavigate();
  const [resolveOutcome, setResolveOutcome] = useState(null);

  if (taskId == null) return null;
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const isTerminal = TERMINAL_STATUSES.has(task.status);

  const handleOpenPhone = () => {
    if (task.phone_id != null) {
      // Do NOT call onClose() — navigating away unmounts this drawer
      // naturally. Calling onClose() here would race the navigate() and
      // (on pages that mutate URL params in their close handler) yank us
      // back. Same pattern as PhoneDetailDrawer's task-pill cross-link.
      navigate(`/phones?phone_id=${task.phone_id}`);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-30 bg-slate-900/30"
        aria-hidden="true"
      />

      {/* Drawer panel — left-anchored for RTL layout */}
      <aside
        className="fixed top-0 left-0 z-40 h-screen w-full sm:w-[480px] lg:w-[40%] lg:min-w-[480px] lg:max-w-[640px] bg-white shadow-2xl flex flex-col animate-drawer-in"
        role="dialog"
        aria-modal="true"
        aria-label={ARIA_TASK_DETAIL}
      >
        {/* ---------- Header ---------- */}
        <header className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={taskTypeVariant(task.task_type)} size="sm">
                  {taskTypeLabel(task.task_type)}
                </Badge>
                <Badge variant={taskStatusVariant(task.status)} size="sm">
                  {taskStatusLabel(task.status)}
                </Badge>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  #{task.id}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-slate-400 hover:text-slate-900 transition-colors"
              aria-label={ARIA_CLOSE_TASK_DRAWER}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick facts */}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <Fact label={TASK_DRAWER_LABEL_PHONE}>
              <span className="font-mono truncate" title={task.phone_number || ''}>
                {task.phone_number || `#${task.phone_id}`}
              </span>
            </Fact>
            <Fact label={TASK_DRAWER_LABEL_CLIENT}>
              <span className="truncate max-w-[160px]" title={task.client_name || '—'}>
                {task.client_name || '—'}
              </span>
            </Fact>
            <Fact label={TASK_DRAWER_LABEL_ENTITY}>
              <span className="truncate">
                #{task.entity_id ?? '—'}
              </span>
            </Fact>
          </dl>

          <button
            type="button"
            onClick={handleOpenPhone}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
          >
            {TASK_DRAWER_OPEN_PHONE}
            <ExternalLink className="w-3 h-3" />
          </button>
        </header>

        {/* ---------- Body (the only scroll surface) ---------- */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin bg-slate-50">
          {/* Proprietary payload (read-only KV view) */}
          <section className="bg-white rounded-md border border-slate-200 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              {TASK_DRAWER_SECTION_PAYLOAD}
            </h3>
            <ExtraDataKVList data={task.extra_data} />
          </section>

          {/* Phase NOTIF-C — inline opt-in for alerts about this task.
              Useful for non-terminal tasks (operator wants to know
              when someone else resolves it / it escalates) and also
              after settlement (operator wants to know if it gets
              re-opened or new actions land against it). */}
          <NotificationOptInPanel
            contextKind="task"
            contextId={task.id}
          />
        </div>

        {/* ---------- Footer (sticky, opaque) ---------- */}
        <footer className="shrink-0 sticky bottom-0 bg-white border-t border-slate-200 px-5 py-3">
          {isTerminal ? (
            <div className="text-center text-xs text-slate-500 py-1.5">
              {TASK_DRAWER_TERMINAL_NOTICE(task.status)}
            </div>
          ) : (
            <RequireRole role="admin">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResolveOutcome('rejected')}
                  className="inline-flex items-center justify-center h-9 px-3 text-sm font-medium rounded-md border border-rose-300 text-rose-700 hover:bg-rose-50 transition-colors"
                >
                  {TASK_DRAWER_BTN_REJECT}
                </button>
                <button
                  type="button"
                  onClick={() => setResolveOutcome('resolved')}
                  className="inline-flex items-center justify-center h-9 px-3 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  {TASK_DRAWER_BTN_RESOLVE}
                </button>
              </div>
            </RequireRole>
          )}
        </footer>
      </aside>

      {/* Resolve / Reject modal — driven by local outcome state */}
      <ResolveTaskModal
        task={task}
        outcome={resolveOutcome}
        isOpen={resolveOutcome !== null}
        onClose={() => setResolveOutcome(null)}
      />
    </>
  );
}


// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function Fact({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 truncate">{children}</dd>
    </div>
  );
}

/**
 * ExtraDataKVList — read-only key/value display for task.extra_data.
 *
 * Object/array values are JSON.stringify'd one level deep with monospace
 * styling so the operator can read structured payload without an explorer
 * widget. For deeper inspection we will introduce a shared
 * <JsonReadOnlyTree /> in Phase E if the need surfaces.
 */
function ExtraDataKVList({ data }) {
  const entries = Object.entries(data || {});
  if (entries.length === 0) {
    return <p className="text-xs text-slate-400">{TASK_DRAWER_EMPTY_PAYLOAD}</p>;
  }
  return (
    <dl className="space-y-2 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 min-w-0">
          <dt className="text-slate-500 uppercase tracking-wide text-[10px]">{k}</dt>
          <dd className="text-slate-800 break-words">
            {typeof v === 'object' && v !== null ? (
              <code className="font-mono text-[11px] bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 inline-block max-w-full overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(v, null, 2)}
              </code>
            ) : (
              String(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

