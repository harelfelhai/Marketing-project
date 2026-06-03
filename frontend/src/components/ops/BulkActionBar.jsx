/**
 * BulkActionBar — floating action toolbar for Task Center bulk updates.
 *
 * Visible when one or more tasks are checkbox-selected. Two primary
 * actions ("Mark as resolved" / "Mark as rejected") fire a single
 * POST /api/v1/tasks/bulk-status call and surface a partial-success
 * toast matching the Phase E1 bulk-ingestion convention.
 *
 * The bar is sticky at the bottom of the OperationsQueue layout so it
 * never hides table rows the operator is acting on. It mounts only
 * when `selectedIds.size > 0` — empty selection hides it entirely so
 * the visual chrome doesn't take up space until the operator needs it.
 *
 * Operator attribution: the operator_id is read from MockAuthContext.
 * Phase G replaces that seam with a server-side dependency, at which
 * point this component drops the explicit operator_id from the body
 * and the backend reads it from the auth context. The Field stays in
 * `BulkResolveTaskRequest` until that swap.
 */

import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, X } from 'lucide-react';

import { bulkUpdateTasks }   from '../../api/tasksApi';
import { useMockData }       from '../../contexts/MockDataContext';
import { useUI }             from '../../contexts/UIContext';
import { useAuth }           from '../../contexts/MockAuthContext';
import {
  TASK_BULK_BAR_SELECTED_COUNT,
  TASK_BULK_BAR_CLEAR_SELECTION,
  TASK_BULK_BAR_RESOLVE,
  TASK_BULK_BAR_REJECT,
  TASK_BULK_BAR_PROCESSING,
  TASK_BULK_TOAST_ALL_OK,
  TASK_BULK_TOAST_PARTIAL,
  TASK_BULK_TOAST_NONE_OK,
  TASK_BULK_TOAST_ERROR,
} from '../../config/strings.he';

export default function BulkActionBar({ selectedIds, onClear }) {
  const mockDb       = useMockData();
  const { pushToast } = useUI();
  const { operatorId } = useAuth();

  const [submitting, setSubmitting] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  const handleBulk = async (outcome) => {
    const ids = Array.from(selectedIds);
    setSubmitting(true);
    try {
      const summary = await bulkUpdateTasks(
        {
          task_ids:    ids,
          // Phase AUTH-B: operator_id is server-derived from the
          // session. Sent in mock-mode bodies only via the
          // tasksApi adapter; the real-mode wire body drops it.
          operator_id: operatorId,
          outcome,
        },
        mockDb,
      );

      // Operator-facing toast variant follows the Phase E1 bulk-text
      // convention — partial success is the documented happy path.
      if (summary.failed_count === 0 && summary.success_count > 0) {
        pushToast({
          variant: 'success',
          message: TASK_BULK_TOAST_ALL_OK(summary.success_count),
        });
      } else if (summary.success_count === 0) {
        pushToast({ variant: 'error', message: TASK_BULK_TOAST_NONE_OK });
      } else {
        pushToast({
          variant: 'info',
          message: TASK_BULK_TOAST_PARTIAL(summary.success_count, summary.failed_count),
        });
      }

      // Clear selection on success — those rows have moved to a
      // terminal status and the operator's mental model says "done".
      onClear?.();
    } catch (err) {
      pushToast({
        variant: 'error',
        message: TASK_BULK_TOAST_ERROR(err?.message || 'error'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="task-bulk-action-bar"
      className={[
        'sticky bottom-4 inset-x-0 z-30',
        'mx-auto max-w-3xl',
        'flex items-center gap-3',
        'rounded-lg border border-slate-300 bg-white shadow-lg px-4 py-2.5',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClear}
        disabled={submitting}
        aria-label={TASK_BULK_BAR_CLEAR_SELECTION}
        className="text-slate-400 hover:text-slate-700 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      <span className="text-sm font-medium text-slate-900">
        {TASK_BULK_BAR_SELECTED_COUNT(count)}
      </span>

      <span className="flex-1" />

      <button
        type="button"
        onClick={() => handleBulk('rejected')}
        disabled={submitting}
        data-testid="task-bulk-reject"
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 text-sm font-medium transition-colors disabled:opacity-50"
      >
        {submitting
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <XCircle className="w-4 h-4" />
        }
        {TASK_BULK_BAR_REJECT}
      </button>

      <button
        type="button"
        onClick={() => handleBulk('resolved')}
        disabled={submitting}
        data-testid="task-bulk-resolve"
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
      >
        {submitting
          ? <><Loader2 className="w-4 h-4 animate-spin" /> {TASK_BULK_BAR_PROCESSING}</>
          : <><CheckCircle2 className="w-4 h-4" /> {TASK_BULK_BAR_RESOLVE}</>
        }
      </button>
    </div>
  );
}
