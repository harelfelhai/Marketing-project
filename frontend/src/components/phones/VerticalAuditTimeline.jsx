/**
 * VerticalAuditTimeline — verification status strip for a phone.
 */

import { Inbox, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';

import { formatDateTime } from '../../utils/formatDate';
import {
  TIMELINE_HEADING, TIMELINE_EMPTY,
  TIMELINE_INGESTED, TIMELINE_SOURCE,
  TIMELINE_VERIFIED_GOOD, TIMELINE_VERIFIED_BAD,
} from '../../config/strings.he';

const DOT_STYLES = {
  ingest:  'bg-slate-200 text-slate-700',
  good:    'bg-emerald-100 text-emerald-700 ring-emerald-200',
  bad:     'bg-rose-100 text-rose-700 ring-rose-200',
  pending: 'bg-amber-100 text-amber-700 ring-amber-200',
};

function buildEvents(phone) {
  const events = [];

  events.push({
    key:    `ingest-${phone.id}`,
    when:   null,
    tone:   'ingest',
    Icon:   Inbox,
    title:  TIMELINE_INGESTED,
    detail: TIMELINE_SOURCE(phone.ingestion_source),
  });

  if (phone.verification_status === 'verified') {
    events.push({
      key:    `verdict-${phone.id}`,
      when:   null,
      tone:   'good',
      Icon:   ShieldCheck,
      title:  TIMELINE_VERIFIED_GOOD,
      detail: '',
    });
  } else if (phone.verification_status === 'rejected') {
    events.push({
      key:    `verdict-${phone.id}`,
      when:   null,
      tone:   'bad',
      Icon:   ShieldAlert,
      title:  TIMELINE_VERIFIED_BAD,
      detail: '',
    });
  } else {
    events.push({
      key:    `pending-${phone.id}`,
      when:   null,
      tone:   'pending',
      Icon:   Clock,
      title:  'ממתין לאימות',
      detail: '',
    });
  }

  return events;
}

export default function VerticalAuditTimeline({ phone }) {
  const events = buildEvents(phone);

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
                <p className="text-sm font-medium text-slate-800 truncate" title={title}>
                  {title}
                </p>
                {detail && (
                  <p className="text-xs text-slate-500 break-words">{detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
