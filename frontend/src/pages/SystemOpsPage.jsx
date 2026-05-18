/**
 * SystemOpsPage — engine cockpit + health strip + failed-action recovery.
 */

import EngineControlCard  from '../components/ops/EngineControlCard';
import PipelineHealthStrip from '../components/ops/PipelineHealthStrip';
import FailedActionsTable  from '../components/ops/FailedActionsTable';

export default function SystemOpsPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">System Ops</h1>
        <p className="text-sm text-slate-500 mt-1">
          Engine controls, pipeline health, and failed-action recovery.
        </p>
      </header>

      {/* Engine Cockpit */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Engine Cockpit
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EngineControlCard engineName="retry" />
          <EngineControlCard engineName="verification" />
        </div>
      </div>

      {/* Pipeline Health */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Pipeline Health
        </h2>
        <PipelineHealthStrip />
      </div>

      {/* Failed Actions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Failed Action Recovery
        </h2>
        <FailedActionsTable />
      </div>
    </section>
  );
}
