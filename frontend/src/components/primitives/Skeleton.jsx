/**
 * Skeleton — single primitive for cold-boot loading placeholders.
 *
 * `width` / `height` accept either a number (px) or a string (any CSS length
 * or Tailwind utility class via `className`). When numeric, the value is
 * applied via inline style so the same primitive composes inside fixed-width
 * <colgroup> tables without fighting Tailwind's purge.
 *
 * Direction-neutral by construction: ships no `ml-*` / `mr-*` / `ps-*` /
 * `pe-*` classes, so it is safe under the `dir="rtl"` document root.
 *
 * Marked `aria-hidden` because skeletons carry no semantic content —
 * the surrounding region should expose its own `aria-busy` state.
 */

import { ARIA_LOADING_CONTENT } from '../../config/strings.he';

export default function Skeleton({
  width,
  height,
  rounded   = 'rounded',
  className = '',
}) {
  const style = {};
  if (width  != null) style.width  = typeof width  === 'number' ? `${width}px`  : width;
  if (height != null) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`bg-slate-200 animate-pulse ${rounded} ${className}`}
      style={style}
      aria-hidden="true"
      aria-label={ARIA_LOADING_CONTENT}
    />
  );
}
