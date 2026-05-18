/**
 * QualityFunnel — horizontal stacked funnel showing pipeline conversion.
 *
 * Stages:
 *   1. Total phones ingested              (100%)
 *   2. Phones with at least one action    (phase-2 reach)
 *   3. Phones with verified_good verdict  (phase-3 good)
 *   4. Phones with verified_bad verdict   (phase-3 bad)
 *
 * Derived live from MockDataContext. Each row is a full-width bar
 * that shrinks proportionally to stage 1 so the funnel narrows visually.
 */

import { useMemo } from 'react';
import { useMockData } from '../../contexts/MockDataContext';

export default function QualityFunnel() {
  const { phones, actionLogs } = useMockData();

  const metrics = useMemo(() => {
    const total     = phones.length;
    const phonesWithActions = new Set(actionLogs.map((l) => l.phone_id));
    const actioned  = phones.filter((p) => phonesWithActions.has(p.id)).length;
    const good      = phones.filter((p) => p.verification_status === 'verified_good').length;
    const bad       = phones.filter((p) => p.verification_status === 'verified_bad').length;
    const pending   = phones.filter((p) => p.verification_status === 'pending').length;

    const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
    return { total, actioned, good, bad, pending, pct };
  }, [phones, actionLogs]);

  const stages = [
    {
      label:   'Ingested',
      value:   metrics.total,
      pct:     100,
      barColor:'bg-slate-700',
      textColor:'text-slate-700',
    },
    {
      label:   'Action Reached',
      value:   metrics.actioned,
      pct:     metrics.pct(metrics.actioned),
      barColor:'bg-sky-600',
      textColor:'text-sky-700',
    },
    {
      label:   'Verified Good',
      value:   metrics.good,
      pct:     metrics.pct(metrics.good),
      barColor:'bg-emerald-500',
      textColor:'text-emerald-700',
    },
    {
      label:   'Verified Bad',
      value:   metrics.bad,
      pct:     metrics.pct(metrics.bad),
      barColor:'bg-rose-500',
      textColor:'text-rose-700',
    },
    {
      label:   'Pending Verdict',
      value:   metrics.pending,
      pct:     metrics.pct(metrics.pending),
      barColor:'bg-amber-400',
      textColor:'text-amber-700',
    },
  ];

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Quality Conversion Funnel</h3>
        <p className="text-xs text-slate-400 mt-0.5">Pipeline throughput from ingestion to verified verdict</p>
      </div>

      <div className="space-y-3">
        {stages.map(({ label, value, pct, barColor, textColor }) => (
          <div key={label} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs gap-2">
              <span className="text-slate-600 font-medium">{label}</span>
              <span className={`tabular-nums font-semibold ${textColor}`}>
                {value} <span className="text-slate-400 font-normal">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${barColor} rounded-full transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
