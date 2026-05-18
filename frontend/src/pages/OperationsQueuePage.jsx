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
  const [selectedId, setSelectedId] = useState(null);
  const [searchParams]              = useSearchParams();
  const { seedTaskPhoneFilter }     = useUI();

  // Phase DX cross-link — seed the persistent phoneId task filter from the
  // ?phone_id=N URL param. Same numeric-coercion guard as PhoneGridPage's
  // client_id seeder (§5.1): URL params are always strings, task.phone_id
  // is an integer in real mode.
  useEffect(() => {
    const raw = searchParams.get('phone_id');
    if (raw) {
      const parsed = Number(raw);
      seedTaskPhoneFilter(
        Number.isFinite(parsed) && raw.trim() !== '' ? parsed : raw
      );
    }
  }, [searchParams, seedTaskPhoneFilter]);

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
