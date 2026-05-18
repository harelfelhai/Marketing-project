/**
 * ThroughputBars — 14-day rolling ingestion throughput as a pure flex bar chart.
 *
 * Derives data from MockDataContext.actionLogs grouped by requested_at date.
 * No external chart library — purely flex divs + Tailwind with fixed heights.
 * Each bar's height is proportional to the day with the highest count.
 */

import { useMemo } from 'react';
import { useMockData } from '../../contexts/MockDataContext';
import { formatDate }  from '../../utils/formatDate';

const CHART_HEIGHT_PX = 120;
const DAYS            = 14;

function buildDays(actionLogs) {
  const today  = new Date();
  const days   = [];
  const counts = {};

  // Build an array of the last N dates.
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = formatDate(d.toISOString());
    days.push(key);
    counts[key] = 0;
  }

  // Count action log entries per date.
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
        <h3 className="text-sm font-semibold text-slate-900">Daily Action Throughput</h3>
        <p className="text-xs text-slate-400 mt-0.5">Last 14 days — action log entries per day</p>
      </div>

      <div className="flex items-end gap-1" style={{ height: `${CHART_HEIGHT_PX}px` }}>
        {days.map(({ date, count }) => {
          const pct     = (count / maxVal) * 100;
          const isEmpty = count === 0;
          // Short label: month/day only.
          const label   = date.slice(5); // "MM-DD"

          return (
            <div
              key={date}
              className="flex-1 flex flex-col items-center justify-end gap-0.5 group"
              title={`${date}: ${count} action${count === 1 ? '' : 's'}`}
            >
              {/* Value label (visible on hover) */}
              {!isEmpty && (
                <span className="text-[9px] text-slate-400 hidden group-hover:block tabular-nums">
                  {count}
                </span>
              )}
              {/* Bar */}
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

      {/* X-axis labels: show every other day to avoid crowding */}
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
