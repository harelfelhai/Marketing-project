/**
 * SystemOpsPage — engine cockpit + pipeline health strip.
 */

import EngineControlCard   from '../components/ops/EngineControlCard';
import PipelineHealthStrip from '../components/ops/PipelineHealthStrip';
import {
  PAGE_SYSTEM_OPS_TITLE, PAGE_SYSTEM_OPS_SUB,
  PAGE_SYSTEM_OPS_ENGINES, PAGE_SYSTEM_OPS_HEALTH,
} from '../config/strings.he';

export default function SystemOpsPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{PAGE_SYSTEM_OPS_TITLE}</h1>
        <p className="text-sm text-slate-500 mt-1">{PAGE_SYSTEM_OPS_SUB}</p>
      </header>

      {/* Engine Cockpit */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          {PAGE_SYSTEM_OPS_ENGINES}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EngineControlCard engineName="retry" />
          <EngineControlCard engineName="verification" />
        </div>
      </div>

      {/* Pipeline Health */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          {PAGE_SYSTEM_OPS_HEALTH}
        </h2>
        <PipelineHealthStrip />
      </div>
    </section>
  );
}
