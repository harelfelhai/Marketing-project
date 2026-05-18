/**
 * PipelineHealthStrip — large colored count boxes for pipeline-wide stats.
 *
 * Derives all numbers from MockDataContext live state so any mutation
 * (verdict, retry, ingest) is reflected immediately.
 */

import { useMockData } from '../../contexts/MockDataContext';

export default function PipelineHealthStrip() {
  const { phones, actionLogs } = useMockData();

  const pending  = phones.filter((p) => p.verification_status === 'pending').length;
  const good     = phones.filter((p) => p.verification_status === 'verified_good').length;
  const bad      = phones.filter((p) => p.verification_status === 'verified_bad').length;
  const failed   = actionLogs.filter((l) => l.status === 'failed').length;
  const retryQ   = actionLogs.filter((l) => l.status === 'scheduled_retry').length;
  const total    = phones.length;

  const metrics = [
    { label: 'Total Phones',    value: total,   tone: 'slate'   },
    { label: 'Pending Verdict', value: pending,  tone: pending  > 0 ? 'amber'  : 'slate' },
    { label: 'Verified Good',   value: good,     tone: good     > 0 ? 'green'  : 'slate' },
    { label: 'Verified Bad',    value: bad,      tone: bad      > 0 ? 'red'    : 'slate' },
    { label: 'Failed Actions',  value: failed,   tone: failed   > 0 ? 'rose'   : 'slate' },
    { label: 'Retry Queue',     value: retryQ,   tone: retryQ   > 0 ? 'sky'    : 'slate' },
  ];

  const TONE = {
    slate: { bg: 'bg-slate-50  border-slate-200',  val: 'text-slate-900', lbl: 'text-slate-500' },
    amber: { bg: 'bg-amber-50  border-amber-200',  val: 'text-amber-800', lbl: 'text-amber-600' },
    green: { bg: 'bg-emerald-50 border-emerald-200', val: 'text-emerald-800', lbl: 'text-emerald-600' },
    red:   { bg: 'bg-red-50    border-red-200',    val: 'text-red-800',   lbl: 'text-red-600'   },
    rose:  { bg: 'bg-rose-50   border-rose-200',   val: 'text-rose-800',  lbl: 'text-rose-600'  },
    sky:   { bg: 'bg-sky-50    border-sky-200',    val: 'text-sky-800',   lbl: 'text-sky-600'   },
  };

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {metrics.map(({ label, value, tone }) => {
        const t = TONE[tone] || TONE.slate;
        return (
          <div key={label} className={`rounded-lg border p-4 flex flex-col ${t.bg}`}>
            <span className={`text-3xl font-bold tabular-nums ${t.val}`}>{value}</span>
            <span className={`text-[11px] uppercase tracking-wide font-semibold mt-1 ${t.lbl}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
