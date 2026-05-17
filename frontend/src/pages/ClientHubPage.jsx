/**
 * ClientHubPage — placeholder for Phase 2 (real content lands later).
 */

import { useUI } from '../contexts/UIContext';
import Badge from '../components/primitives/Badge';

export default function ClientHubPage() {
  const { pushToast } = useUI();

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Client Hub</h1>
          <p className="text-sm text-slate-500 mt-1">
            Per-client pipeline overview and quick navigation.
          </p>
        </div>
        <Badge variant="gray">placeholder</Badge>
      </header>

      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
        Client Hub Placeholder — real card grid arrives in a later phase.
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => pushToast({ variant: 'success', message: 'Toast framework wired correctly.' })}
            className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Test success toast
          </button>
          <button
            type="button"
            onClick={() => pushToast({ variant: 'error', message: 'Sample error notification.' })}
            className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Test error toast
          </button>
        </div>
      </div>
    </section>
  );
}
