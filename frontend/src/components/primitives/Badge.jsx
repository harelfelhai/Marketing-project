/**
 * Badge — uniform pill primitive for status, source, and metadata flags.
 *
 * Variant taxonomy (mapped to a single design palette):
 *   pending  — amber   (awaiting action / verdict)
 *   good     — green   (verified_good / sent / delivered)
 *   bad      — red     (verified_bad / suppressed)
 *   failed   — rose    (action failed, retry exhausted)
 *   retry    — sky     (scheduled_retry — in-flight recovery)
 *   info     — slate   (generic neutral)
 *   gray     — gray    (low-emphasis metadata)
 *
 * // HOOK FOR ENTERPRISE LABELS: the variant tokens above are abstract —
 * // when proprietary labels are introduced, only the consumer's variant
 * // selector needs to change, never this file.
 */

const VARIANTS = {
  pending: 'bg-amber-50  text-amber-700  border-amber-200',
  good:    'bg-green-50  text-green-700  border-green-200',
  bad:     'bg-red-50    text-red-700    border-red-200',
  failed:  'bg-rose-50   text-rose-700   border-rose-200',
  retry:   'bg-sky-50    text-sky-700    border-sky-200',
  info:    'bg-slate-100 text-slate-700  border-slate-200',
  gray:    'bg-slate-50  text-slate-500  border-slate-200',
};

const SIZES = {
  xs: 'text-[10px] px-1.5 py-0.5',
  sm: 'text-xs   px-2   py-0.5',
  md: 'text-sm   px-2.5 py-1',
};

export default function Badge({
  children,
  variant = 'info',
  size    = 'sm',
  className = '',
}) {
  const variantClasses = VARIANTS[variant] || VARIANTS.info;
  const sizeClasses    = SIZES[size]       || SIZES.sm;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium leading-none ${variantClasses} ${sizeClasses} ${className}`}
    >
      {children}
    </span>
  );
}
