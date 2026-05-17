/**
 * SystemOpsPage — placeholder for Phase 2.
 */

import Badge from '../components/primitives/Badge';

export default function SystemOpsPage() {
  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">System Ops</h1>
          <p className="text-sm text-slate-500 mt-1">
            Engine controls, pipeline health, and failed-action recovery.
          </p>
        </div>
        <Badge variant="gray">placeholder</Badge>
      </header>

      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
        System Ops Placeholder — engine cockpit and failed-actions log arrive later.
      </div>
    </section>
  );
}
