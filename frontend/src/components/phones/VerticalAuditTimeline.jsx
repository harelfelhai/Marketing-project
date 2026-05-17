/**
 * VerticalAuditTimeline — chronological milestone list for a phone.
 *
 * Composes three event sources:
 *   1. Ingestion event       (always exactly one, from phone.ingested_at)
 *   2. Action log entries    (zero or more, from phone.action_timeline)
 *   3. Verification verdict  (zero or one, if phone.verified_at is set)
 *
 * Rendered as a vertical rail with colored dots; the connecting line is a
 * single absolute-positioned div behind the dots, so it always visually
 * spans the full timeline.
 */

import { Inbox, ShieldCheck, ShieldAlert } from 'lucide-react';

import { iconForActionType, labelForActionType } from '../../utils/actionTypeIcons';
import { actionLabel } from '../../utils/classifyStatus';
import { formatDateTime } from '../../utils/formatDate';

const DOT_STYLES = {
  ingest:   'bg-slate-200 text-slate-700',
  good:     'bg-emerald-100 text-emerald-700 ring-emerald-200',
  bad:      'bg-rose-100 text-rose-700 ring-rose-200',
  sent:     'bg-emerald-100 text-emerald-700 ring-emerald-200',
  failed:   'bg-rose-100 text-rose-700 ring-rose-200',
  retry:    'bg-sky-100 text-sky-700 ring-sky-200',
  pending:  'bg-amber-100 text-amber-700 ring-amber-200',
  neutral:  'bg-slate-100 text-slate-600 ring-slate-200',
};

function buildEvents(phone, logs) {
  const events = [];

  events.push({
    key:    `ingest-${phone.id}`,
    when:   phone.ingested_at,
    tone:   'ingest',
    Icon:   Inbox,
    title:  'Ingested',
    detail: `Source: ${phone.ingestion_source}${phone.ingestion_reason ? ` · ${phone.ingestion_reason}` : ''}`,
  });

  logs.forEach((log) => {
    const Icon = iconForActionType(log.action_type);
    let tone = 'neutral';
    if (log.status === 'sent' || log.status === 'delivered') tone = 'sent';
    else if (log.status === 'failed')                        tone = 'failed';
    else if (log.status === 'scheduled_retry')               tone = 'retry';
    else if (log.status === 'pending')                       tone = 'pending';

    events.push({
      key:    `log-${log.id}`,
      when:   log.requested_at,
      tone,
      Icon,
      title:  `${labelForActionType(log.action_type)} — ${actionLabel(log.status)}`,
      detail: log.extra_data?.error_detail
        ? log.extra_data.error_detail
        : `Retry #${log.retry_count}${log.extra_data?.operator_id ? ` · operator ${log.extra_data.operator_id}` : ''}`,
    });
  });

  if (phone.verified_at) {
    const isGood = phone.verification_status === 'verified_good';
    events.push({
      key:    `verdict-${phone.id}`,
      when:   phone.verified_at,
      tone:   isGood ? 'good' : 'bad',
      Icon:   isGood ? ShieldCheck : ShieldAlert,
      title:  isGood ? 'Verified Good' : 'Verified Bad',
      detail: phone.verification_reason
        ? `${phone.verification_source || 'system'} · ${phone.verification_reason}`
        : `Recorded by ${phone.verification_source || 'system'}`,
    });
  }

  return events.sort((a, b) => new Date(a.when) - new Date(b.when));
}

export default function VerticalAuditTimeline({ phone, logs }) {
  const events = buildEvents(phone, logs);

  if (events.length === 0) {
    return (
      <section className="bg-white rounded-md border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Audit Timeline</h3>
        <p className="text-xs text-slate-400 italic">No events recorded yet.</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-md border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">Audit Timeline</h3>

      <ol className="relative pl-8">
        {/* Connecting rail — full-height vertical line behind the dots */}
        <span
          aria-hidden="true"
          className="absolute left-3 top-2 bottom-2 w-px bg-slate-200"
        />

        {events.map(({ key, when, tone, Icon, title, detail }) => {
          const style = DOT_STYLES[tone] || DOT_STYLES.neutral;
          return (
            <li key={key} className="relative pb-4 last:pb-0">
              {/* Dot */}
              <span
                className={`absolute -left-[18px] top-0 w-6 h-6 rounded-full ring-1 ring-white flex items-center justify-center shadow-sm ${style}`}
              >
                <Icon className="w-3 h-3" />
              </span>

              <div className="ml-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800 truncate" title={title}>
                    {title}
                  </p>
                  <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                    {formatDateTime(when)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 break-words">{detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
