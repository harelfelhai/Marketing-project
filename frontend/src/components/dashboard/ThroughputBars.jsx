/**
 * ThroughputBars — 14-day rolling action throughput as a pure flex bar chart.
 */

import { useMemo } from 'react';
import { useMockData } from '../../contexts/MockDataContext';
import { formatDate }  from '../../utils/formatDate';
import { THROUGHPUT_HEADING, THROUGHPUT_SUBTITLE, THROUGHPUT_TOOLTIP } from '../../config/strings.he';

const CHART_HEIGHT_PX = 120;
const DAYS            = 14;

function buildDays(actionLogs) {
  const today  = new Date();
  const days   = [];
  const counts = {};

  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = formatDate(d.toISOString());
    days.push(key);
    counts[key] = 0;
  }

  actionLogs.forEach((log) => {
    const key = formatDate(log.requested_at);
    if (key in counts) counts[key]++;
  });

  return days.map((key) => ({ date: key, count: counts[key] }));
}

export default function ThroughputBars() {
  const { actionLogs } = useMockData();

  const days   = useMemo(() => buildDays(actionLogs), [actionLogs]);
  const maxVal = Math.max(...days.map((d) => d.count), 1);

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{THROUGHPUT_HEADING}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{THROUGHPUT_SUBTITLE}</p>
      </div>

      <div className="flex items-end gap-1" style={{ height: `${CHART_HEIGHT_PX}px` }}>
        {days.map(({ date, count }) => {
          const pct     = (count / maxVal) * 100;
          const isEmpty = count === 0;

          return (
            <div
              key={date}
              className="flex-1 flex flex-col items-center justify-end gap-0.5 group"
              title={THROUGHPUT_TOOLTIP(date, count)}
            >
              {!isEmpty && (
                <span className="text-[9px] text-slate-400 hidden group-hover:block tabular-nums">
                  {count}
                </span>
              )}
              <div
                className={`w-full rounded-t-sm transition-all duration-300 ${
                  isEmpty ? 'bg-slate-100' : 'bg-slate-700 group-hover:bg-slate-900'
                }`}
                style={{ height: isEmpty ? '4px' : `${(pct / 100) * CHART_HEIGHT_PX}px` }}
              />
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-1">
        {days.map(({ date }, idx) => (
          <div key={date} className="flex-1 text-center">
            {idx % 2 === 0 && (
              <span className="text-[9px] text-slate-400 tabular-nums">{date.slice(5)}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
