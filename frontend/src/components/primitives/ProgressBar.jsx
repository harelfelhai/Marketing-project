/**
 * ProgressBar — simple horizontal bar with conditional warning color.
 *
 * `value` and `max` define the fill percentage. `warnBelow` flips the bar
 * to amber when the value is under the threshold, used for SLA cards.
 */

export default function ProgressBar({
  value,
  max = 100,
  warnBelow = null,
  className = '',
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const isWarn = warnBelow !== null && value < warnBelow;
  const fillColor = isWarn ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className={`h-1.5 w-full bg-slate-100 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full ${fillColor} transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
