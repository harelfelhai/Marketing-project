/**
 * OperationsQueuePage — Senior Admin work-queue dashboard (Phase DX, DX-3).
 *
 * Layout: page header → TaskFilterBar → TaskTable.
 *
 * DX-3 ships the page skeleton without the detail drawer; clicking a row
 * stores the selected id in local state but renders no drawer yet. DX-4
 * will mount `<TaskDetailDrawer>` on the same selected-id signal.
 *
 * Permission gating: the entire page sits behind `<RequireRole role="admin">`.
 * Today the mock auth context always returns 'admin', so the gate is a no-op.
 * Phase G activates the gate by replacing the underlying useAuth() seam —
 * this component does not change.
 *
 * Selected-id state is purely a UI concern (which row's drawer is open),
 * so it lives as local state, not in UIContext. Filter state DOES live in
 * UIContext (mirrors PhoneGridPage convention) so navigating away and back
 * preserves the operator's view.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import TaskFilterBar    from '../components/ops/TaskFilterBar';
import TaskTable        from '../components/ops/TaskTable';
import TaskDetailDrawer from '../components/ops/TaskDetailDrawer';
import RequireRole      from '../components/primitives/RequireRole';
import { useUI }        from '../contexts/UIContext';
import {
  PAGE_OPERATIONS_TITLE,
  PAGE_OPERATIONS_SUB,
  PERMISSION_DENIED_NOTICE,
} from '../config/strings.he';

export default function OperationsQueuePage() {
  const [selectedId, setSelectedId]   = useState(null);
  const [searchParams]                = useSearchParams();
  const {
    seedTaskPhoneFilter,
    seedTaskClientFilter,
    updateTaskFilters,
  } = useUI();

  // Phase DX cross-links — URL is authoritative for the phone_id /
  // client_id / open filters. Every URL change resets all three
  // (presence → seeded value; absence → cleared). This prevents the
  // "double-stacked filter" bug where navigating to /operations?phone_id=N
  // would keep a stale client_id filter from a previous cross-link.
  //
  // Numeric coercion guard same as PhoneGridPage §5.1: URL params are
  // strings, IDs in real mode are integers.
  useEffect(() => {
    const coerceId = (raw) => {
      if (raw == null || raw === '') return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : raw;
    };
    seedTaskPhoneFilter(coerceId(searchParams.get('phone_id')));
    seedTaskClientFilter(coerceId(searchParams.get('client_id')));
    updateTaskFilters({ openOnly: searchParams.get('open') === 'true' });
  }, [searchParams, seedTaskPhoneFilter, seedTaskClientFilter, updateTaskFilters]);

  return (
    <RequireRole
      role="admin"
      fallback={
        <section className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-500">
          {PERMISSION_DENIED_NOTICE}
        </section>
      }
    >
      <section className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">{PAGE_OPERATIONS_TITLE}</h1>
          <p className="text-sm text-slate-500 mt-1">{PAGE_OPERATIONS_SUB}</p>
        </header>

        <TaskFilterBar />
        <TaskTable selectedId={selectedId} onSelect={setSelectedId} />

        <TaskDetailDrawer taskId={selectedId} onClose={() => setSelectedId(null)} />
      </section>
    </RequireRole>
  );
}
