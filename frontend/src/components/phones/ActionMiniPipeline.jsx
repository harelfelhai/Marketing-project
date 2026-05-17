/**
 * ActionMiniPipeline — last 5 action attempts as an icon strip with
 * tooltips that open upward (bottom-full) so they escape any row
 * height constraint, and edge items get right-anchored tooltips to
 * avoid being clipped by the viewport's right edge.
 *
 * No row-level overflow:hidden is used anywhere; the only clipping in
 * the row is inside Column 2's metadata div, which doesn't host icons.
 */

import { iconForActionType, labelForActionType } from '../../utils/actionTypeIcons';
import { actionLabel } from '../../utils/classifyStatus';
import { formatRelative } from '../../utils/formatDate';

const STATUS_ICON_STYLES = {
  sent:            { bg: 'bg-emerald-50',  ring: 'ring-emerald-200',  text: 'text-emerald-700' },
  delivered:       { bg: 'bg-emerald-50',  ring: 'ring-emerald-200',  text: 'text-emerald-700' },
  scheduled_retry: { bg: 'bg-sky-50',      ring: 'ring-sky-200',      text: 'text-sky-700' },
  failed:          { bg: 'bg-rose-50',     ring: 'ring-rose-200',     text: 'text-rose-700' },
  superseded:      { bg: 'bg-slate-50',    ring: 'ring-slate-200',    text: 'text-slate-500' },
  pending:         { bg: 'bg-amber-50',    ring: 'ring-amber-200',    text: 'text-amber-700' },
};

const MAX_ICONS = 5;

export default function ActionMiniPipeline({ logs }) {
  if (!logs || logs.length === 0) {
    return <span className="text-xs text-slate-400 italic">no actions yet</span>;
  }

  // Sort by requested_at desc, take latest 5, then re-order ascending
  // so the strip reads left → right oldest → newest (common UX convention).
  const slice = [...logs]
    .sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at))
    .slice(0, MAX_ICONS)
    .reverse();

  return (
    <div className="flex items-center gap-1.5">
      {slice.map((log, idx) => {
        const Icon  = iconForActionType(log.action_type);
        const style = STATUS_ICON_STYLES[log.status] || STATUS_ICON_STYLES.pending;

        // Right-anchor the tooltip for the last two icons so it doesn't
        // overflow the viewport's right edge.
        const anchorRight = idx >= slice.length - 2 && slice.length >= 3;
        const tooltipPosition = anchorRight
          ? 'right-0'
          : 'left-1/2 -translate-x-1/2';

        return (
          <span key={log.id} className="relative group">
            <span
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full ring-1 ${style.bg} ${style.ring} ${style.text}`}
            >
              <Icon className="w-3.5 h-3.5" />
            </span>

            {/* Upward-opening tooltip (escapes row vertically; z-20 lifts above neighbors) */}
            <span
              className={`absolute bottom-full mb-2 ${tooltipPosition} z-20 hidden group-hover:block pointer-events-none whitespace-nowrap`}
              role="tooltip"
            >
              <span className="block bg-slate-900 text-white text-[11px] leading-snug rounded-md px-2.5 py-1.5 shadow-lg">
                <span className="block font-semibold">{labelForActionType(log.action_type)}</span>
                <span className="block text-slate-200">
                  {actionLabel(log.status)} · retry #{log.retry_count}
                </span>
                <span className="block text-slate-400 mt-0.5">{formatRelative(log.requested_at)}</span>
                {log.extra_data?.error_detail && (
                  <span className="block text-rose-200 mt-1 max-w-[240px] whitespace-normal">
                    {log.extra_data.error_detail}
                  </span>
                )}
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
