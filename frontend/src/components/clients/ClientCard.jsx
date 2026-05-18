/**
 * ClientCard — single client tile on the Client Hub grid.
 *
 * // HOOK FOR ENTERPRISE LABELS — all visible strings are abstract.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import ProgressBar     from '../primitives/ProgressBar';
import {
  CLIENT_CARD_FAILED_TITLE, CLIENT_CARD_PENDING_TITLE, CLIENT_CARD_OK_TITLE,
  CLIENT_CARD_ACTIVE, CLIENT_CARD_PENDING, CLIENT_CARD_FAILED,
  CLIENT_CARD_GOOD, CLIENT_CARD_BAD, CLIENT_CARD_DECIDED, CLIENT_CARD_QUALITY_SLA,
} from '../../config/strings.he';

export default function ClientCard({ client }) {
  const { getClientMetrics } = useMockData();
  const { seedClientFilter } = useUI();
  const navigate             = useNavigate();

  const metrics  = getClientMetrics(client.id);
  const decided  = metrics.good + metrics.bad;
  const slaPct   = decided > 0 ? Math.round((metrics.good / decided) * 100) : 0;
  const slaWarn  = slaPct < client.sla_threshold_pct;

  let alertDot;
  if (metrics.failed > 0) {
    alertDot = <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse-amber" title={CLIENT_CARD_FAILED_TITLE(metrics.failed)} />;
  } else if (metrics.pending > 0) {
    alertDot = <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse-amber" title={CLIENT_CARD_PENDING_TITLE(metrics.pending)} />;
  } else {
    alertDot = <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" title={CLIENT_CARD_OK_TITLE} />;
  }

  const handleClick = () => {
    seedClientFilter(client.id);
    navigate(`/phones?client_id=${client.id}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-start bg-white rounded-lg border border-slate-200 hover:border-slate-400 hover:shadow-md transition-all p-5 flex flex-col gap-4 group"
    >
      {/* Header row: client name + alert dot + chevron */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {alertDot}
          <h3 className="text-base font-semibold text-slate-900 truncate" title={client.name}>
            {client.name}
          </h3>
        </div>
        <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 shrink-0" />
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-3 gap-3">
        <Metric label={CLIENT_CARD_ACTIVE}  value={metrics.total}   tone="slate" />
        <Metric label={CLIENT_CARD_PENDING} value={metrics.pending} tone={metrics.pending > 0 ? 'amber' : 'slate'} />
        <Metric label={CLIENT_CARD_FAILED}  value={metrics.failed}  tone={metrics.failed  > 0 ? 'rose'  : 'slate'} />
      </div>

      {/* Verdict breakdown */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          <span className="font-medium text-emerald-700">{metrics.good}</span> {CLIENT_CARD_GOOD}
          {' · '}
          <span className="font-medium text-rose-700">{metrics.bad}</span> {CLIENT_CARD_BAD}
        </span>
        <span className="text-slate-400">{CLIENT_CARD_DECIDED(decided)}</span>
      </div>

      {/* SLA strip */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">{CLIENT_CARD_QUALITY_SLA}</span>
          <span className={slaWarn ? 'font-medium text-amber-700' : 'font-medium text-emerald-700'}>
            {slaPct}% / {client.sla_threshold_pct}%
          </span>
        </div>
        <ProgressBar value={slaPct} max={100} warnBelow={client.sla_threshold_pct} />
      </div>
    </button>
  );
}

function Metric({ label, value, tone = 'slate' }) {
  const toneClass = {
    slate: 'text-slate-900',
    amber: 'text-amber-700',
    rose:  'text-rose-700',
  }[tone];
  return (
    <div className="flex flex-col">
      <span className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</span>
      <span className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</span>
    </div>
  );
}
