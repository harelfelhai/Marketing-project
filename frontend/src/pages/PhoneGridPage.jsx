/**
 * PhoneGridPage — placeholder for Phase 2.
 */

import Badge from '../components/primitives/Badge';

export default function PhoneGridPage() {
  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Phone Grid</h1>
          <p className="text-sm text-slate-500 mt-1">
            Filterable table of all phone records and their pipeline state.
          </p>
        </div>
        <Badge variant="gray">placeholder</Badge>
      </header>

      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
        Phone Grid Placeholder — filter bar, table, and detail drawer arrive later.
      </div>
    </section>
  );
}
