/**
 * SlaIndicator — mean time-to-verdict + SLA threshold warning.
 *
 * // HOOK FOR ENTERPRISE SLA THRESHOLD — swap SLA_WARN_HOURS to match
 * // the client-specific contractual SLA when labels are introduced.
 */

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useMockData } from '../../contexts/MockDataContext';
import {
  SLA_HEADING, SLA_SUBTITLE, SLA_AVG_LABEL, SLA_SAMPLE, SLA_TARGET,
  SLA_BREACH_TITLE, SLA_BREACH_BODY, SLA_BREACH_ACTION,
  SLA_OK, SLA_NOTE,
} from '../../config/strings.he';

const SLA_WARN_HOURS = 6;  // // HOOK FOR ENTERPRISE SLA THRESHOLD

export default function SlaIndicator() {
  const { phones } = useMockData();

  const { meanHours, sampleSize } = useMemo(() => {
    const decided = phones.filter(
      (p) => p.verification_status === 'verified' || p.verification_status === 'rejected',
    );
    return { meanHours: null, sampleSize: decided.length };
  }, [phones]);

  const isWarn  = meanHours !== null && meanHours > SLA_WARN_HOURS;
  const display = meanHours === null ? '—' : `${meanHours}h`;

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{SLA_HEADING}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{SLA_SUBTITLE}</p>
      </div>

      {/* Main metric */}
      <div className="flex items-end gap-3">
        <div>
          <span className="text-4xl font-bold tabular-nums text-slate-900">
            {display}
          </span>
          <span className="text-sm text-slate-500 ms-1">{SLA_AVG_LABEL}</span>
        </div>
        <div className="text-xs text-slate-400 pb-1">
          {SLA_SAMPLE(sampleSize)}
        </div>
      </div>

      {/* SLA threshold reference */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        {SLA_TARGET(SLA_WARN_HOURS)}
      </div>

      {/* Conditional warning / clean banner */}
      {meanHours !== null && (
        isWarn ? (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 break-words">
              <span className="font-semibold">{SLA_BREACH_TITLE}</span>{' '}
              {SLA_BREACH_BODY(display, SLA_WARN_HOURS)}{' '}
              {SLA_BREACH_ACTION}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-xs text-emerald-800 font-medium">{SLA_OK}</span>
          </div>
        )
      )}

      {/* Per-client SLA note */}
      <p className="text-[11px] text-slate-400 break-words">
        {SLA_NOTE}
        {/* // HOOK FOR ENTERPRISE LABELS — add per-client breakdown when client
            // contracts are migrated into this environment. */}
      </p>
    </section>
  );
}
