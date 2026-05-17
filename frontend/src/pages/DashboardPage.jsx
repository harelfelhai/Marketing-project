/**
 * DashboardPage — placeholder for Phase 2.
 */

import Badge from '../components/primitives/Badge';

export default function DashboardPage() {
  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Throughput trends, quality funnel, and SLA monitoring.
          </p>
        </div>
        <Badge variant="gray">placeholder</Badge>
      </header>

      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
        Dashboard Placeholder — bars, funnel, and SLA strip arrive later.
      </div>
    </section>
  );
}
