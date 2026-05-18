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

import { useState } from 'react';

import TaskFilterBar  from '../components/ops/TaskFilterBar';
import TaskTable      from '../components/ops/TaskTable';
import RequireRole    from '../components/primitives/RequireRole';
import {
  PAGE_OPERATIONS_TITLE,
  PAGE_OPERATIONS_SUB,
  PERMISSION_DENIED_NOTICE,
} from '../config/strings.he';

export default function OperationsQueuePage() {
  // DX-3 holds the id but the drawer is wired in DX-4; for now this is a
  // visual selection only.
  const [selectedId, setSelectedId] = useState(null);

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

        {/* DX-4 will mount <TaskDetailDrawer phoneId={selectedId} onClose=…/> here. */}
      </section>
    </RequireRole>
  );
}
