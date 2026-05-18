/**
 * EngineControlCard — status tile for a single background worker engine.
 *
 * Global executing state lives in MockDataContext (not local) so that
 * the spinner persists when the operator switches tabs mid-simulation.
 *
 * The "Force Run Now" button is disabled when `executing === true`.
 * The engine name prop is 'retry' | 'verification'.
 *
 * // HOOK FOR ENTERPRISE LABELS — engine.label is the swap point.
 */

import { Loader2, Play, CheckCircle2, Activity } from 'lucide-react';

import { runWorker }    from '../../api/systemApi';
import { useMockData }  from '../../contexts/MockDataContext';
import { useUI }        from '../../contexts/UIContext';
import { formatRelative } from '../../utils/formatDate';

export default function EngineControlCard({ engineName }) {
  const mockDb        = useMockData();
  const { pushToast } = useUI();

  const engine  = mockDb.engines[engineName];
  if (!engine) return null;

  const { label, lastRunAt, lastProcessedCount, executing } = engine;

  const forceRun = async () => {
    try {
      const result = await runWorker(engineName, mockDb);
      pushToast({
        variant: 'success',
        message:  `${label} completed — ${result.processed_count} record${result.processed_count === 1 ? '' : 's'} processed.`,
      });
    } catch (err) {
      mockDb.setEngineExecuting(engineName, false);
      pushToast({ variant: 'error', message: `Engine run failed: ${err.message}` });
    }
  };

  return (
    <div className={`bg-white rounded-lg border border-slate-200 p-5 flex flex-col gap-4 transition-opacity ${executing ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${executing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-400'}`} />
          <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
        </div>
        <Activity className="w-4 h-4 text-slate-300" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-500 uppercase tracking-wide text-[10px] mb-0.5">Last Run</p>
          <p className="text-slate-800 font-medium">{lastRunAt ? formatRelative(lastRunAt) : '—'}</p>
        </div>
        <div>
          <p className="text-slate-500 uppercase tracking-wide text-[10px] mb-0.5">Processed</p>
          <p className="text-slate-800 font-medium tabular-nums">{lastProcessedCount ?? '—'} records</p>
        </div>
      </div>

      {/* Status line */}
      <div className="flex items-center gap-2 text-xs">
        {executing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
            <span className="text-amber-700 font-medium">Processing — do not trigger again</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-slate-500">Idle — ready for next run</span>
          </>
        )}
      </div>

      {/* Force Run button */}
      <button
        type="button"
        onClick={forceRun}
        disabled={executing}
        className="mt-auto inline-flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {executing
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
          : <><Play className="w-4 h-4" /> Force Run Now</>
        }
      </button>
    </div>
  );
}
