/**
 * SlaIndicator — mean time-to-verdict + SLA threshold warning.
 *
 * Computes the average time (in hours) between ingested_at and verified_at
 * for all phones that have a verdict. If the mean exceeds SLA_WARN_HOURS,
 * a warning banner is shown.
 *
 * // HOOK FOR ENTERPRISE SLA THRESHOLD — swap SLA_WARN_HOURS to match
 * // the client-specific contractual SLA when labels are introduced.
 */

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useMockData } from '../../contexts/MockDataContext';

const SLA_WARN_HOURS = 6;  // // HOOK FOR ENTERPRISE SLA THRESHOLD

export default function SlaIndicator() {
  const { phones } = useMockData();

  const { meanHours, sampleSize } = useMemo(() => {
    const decided = phones.filter((p) => p.verified_at && p.ingested_at);
    if (decided.length === 0) return { meanHours: null, sampleSize: 0 };

    const totalMs = decided.reduce((sum, p) => {
      return sum + (new Date(p.verified_at) - new Date(p.ingested_at));
    }, 0);

    const meanMs    = totalMs / decided.length;
    const meanHours = parseFloat((meanMs / 3600000).toFixed(1));
    return { meanHours, sampleSize: decided.length };
  }, [phones]);

  const isWarn  = meanHours !== null && meanHours > SLA_WARN_HOURS;
  const display = meanHours === null ? '—' : `${meanHours}h`;

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">SLA Performance</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Average time from ingestion to verified verdict
        </p>
      </div>

      {/* Main metric */}
      <div className="flex items-end gap-3">
        <div>
          <span className="text-4xl font-bold tabular-nums text-slate-900">
            {display}
          </span>
          <span className="text-sm text-slate-500 ml-1">avg time-to-verdict</span>
        </div>
        <div className="text-xs text-slate-400 pb-1">
          based on {sampleSize} decided phone{sampleSize === 1 ? '' : 's'}
        </div>
      </div>

      {/* SLA threshold reference */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        Target threshold: &lt;{SLA_WARN_HOURS}h
      </div>

      {/* Conditional warning / clean banner */}
      {meanHours !== null && (
        isWarn ? (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 break-words">
              <span className="font-semibold">SLA breach detected.</span>{' '}
              Mean time-to-verdict ({display}) exceeds the {SLA_WARN_HOURS}h threshold.
              Consider running the Verification Engine to clear the pending queue.
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-xs text-emerald-800 font-medium">
              Within SLA — no action required.
            </span>
          </div>
        )
      )}

      {/* Per-client SLA note */}
      <p className="text-[11px] text-slate-400 break-words">
        Individual client SLA targets are configured per account. This figure reflects
        the aggregate across all active clients.
        {/* // HOOK FOR ENTERPRISE LABELS — add per-client breakdown when client
            // contracts are migrated into this environment. */}
      </p>
    </section>
  );
}
