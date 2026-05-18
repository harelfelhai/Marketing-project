/**
 * VerticalAuditTimeline — chronological milestone list for a phone.
 *
 * RTL layout: the rail is on the right (pr-8 / right-3),
 * dots are right-anchored (-right-[18px]), content has mr-3 offset.
 */

import { Inbox, ShieldCheck, ShieldAlert } from 'lucide-react';

import { iconForActionType, labelForActionType } from '../../utils/actionTypeIcons';
import { actionLabel } from '../../utils/classifyStatus';
import { formatDateTime } from '../../utils/formatDate';
import {
  TIMELINE_HEADING, TIMELINE_EMPTY,
  TIMELINE_INGESTED, TIMELINE_SOURCE, TIMELINE_RETRY, TIMELINE_OPERATOR,
  TIMELINE_VERIFIED_GOOD, TIMELINE_VERIFIED_BAD,
  TIMELINE_SYSTEM, TIMELINE_VERIFICATION_DETAIL, TIMELINE_VERIFICATION_RECORDED,
} from '../../config/strings.he';

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
    title:  TIMELINE_INGESTED,
    detail: TIMELINE_SOURCE(phone.ingestion_source) +
      (phone.ingestion_reason ? ` · ${phone.ingestion_reason}` : ''),
  });

  logs.forEach((log) => {
    const Icon = iconForActionType(log.action_type);
    let tone = 'neutral';
    if (log.status === 'sent' || log.status === 'delivered') tone = 'sent';
    else if (log.status === 'failed')                        tone = 'failed';
    else if (log.status === 'scheduled_retry')               tone = 'retry';
    else if (log.status === 'pending')                       tone = 'pending';

    const retryPart    = TIMELINE_RETRY(log.retry_count);
    const operatorPart = log.extra_data?.operator_id
      ? ` · ${TIMELINE_OPERATOR(log.extra_data.operator_id)}`
      : '';

    events.push({
      key:    `log-${log.id}`,
      when:   log.requested_at,
      tone,
      Icon,
      title:  `${labelForActionType(log.action_type)} — ${actionLabel(log.status)}`,
      detail: log.extra_data?.error_detail
        ? log.extra_data.error_detail
        : `${retryPart}${operatorPart}`,
    });
  });

  if (phone.verified_at) {
    const isGood = phone.verification_status === 'verified_good';
    const src    = phone.verification_source || TIMELINE_SYSTEM;
    events.push({
      key:    `verdict-${phone.id}`,
      when:   phone.verified_at,
      tone:   isGood ? 'good' : 'bad',
      Icon:   isGood ? ShieldCheck : ShieldAlert,
      title:  isGood ? TIMELINE_VERIFIED_GOOD : TIMELINE_VERIFIED_BAD,
      detail: phone.verification_reason
        ? TIMELINE_VERIFICATION_DETAIL(src, phone.verification_reason)
        : TIMELINE_VERIFICATION_RECORDED(src),
    });
  }

  return events.sort((a, b) => new Date(a.when) - new Date(b.when));
}

export default function VerticalAuditTimeline({ phone, logs }) {
  const events = buildEvents(phone, logs);

  if (events.length === 0) {
    return (
      <section className="bg-white rounded-md border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">{TIMELINE_HEADING}</h3>
        <p className="text-xs text-slate-400 italic">{TIMELINE_EMPTY}</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-md border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{TIMELINE_HEADING}</h3>

      {/* RTL: rail on right, items flow right-to-left, content offset via mr-3 */}
      <ol className="relative pr-8">
        <span
          aria-hidden="true"
          className="absolute right-3 top-2 bottom-2 w-px bg-slate-200"
        />

        {events.map(({ key, when, tone, Icon, title, detail }) => {
          const style = DOT_STYLES[tone] || DOT_STYLES.neutral;
          return (
            <li key={key} className="relative pb-4 last:pb-0">
              {/* Dot — right-anchored */}
              <span
                className={`absolute -right-[18px] top-0 w-6 h-6 rounded-full ring-1 ring-white flex items-center justify-center shadow-sm ${style}`}
              >
                <Icon className="w-3 h-3" />
              </span>

              <div className="mr-3">
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
