/**
 * Toast / ToastStack — portal-mounted notification overlay.
 *
 * Reads the toast queue from UIContext and renders a fixed stack in the
 * lower-right corner. Each toast auto-dismisses after 4s (handled in
 * UIContext.pushToast); the X button forces immediate removal.
 *
 * Mounted once at the App root so notifications survive route changes.
 */

import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

const VARIANT_STYLES = {
  success: {
    container: 'bg-white border-green-200',
    iconWrap:  'text-green-600',
    Icon:      CheckCircle2,
  },
  error: {
    container: 'bg-white border-rose-200',
    iconWrap:  'text-rose-600',
    Icon:      AlertCircle,
  },
  info: {
    container: 'bg-white border-slate-200',
    iconWrap:  'text-slate-500',
    Icon:      Info,
  },
};

export default function ToastStack() {
  const { toasts, dismissToast } = useUI();

  // Render nothing if no toasts, but still mount the portal target check.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => {
        const style = VARIANT_STYLES[t.variant] || VARIANT_STYLES.info;
        const Icon  = style.Icon;
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-[420px] px-4 py-3 rounded-md border shadow-lg ${style.container}`}
          >
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${style.iconWrap}`} />
            <div className="flex-1 text-sm text-slate-800 break-words">
              {t.message}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
