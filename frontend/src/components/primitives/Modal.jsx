/**
 * Modal — generic centered modal with backdrop dismiss + Escape key support.
 *
 * Renders via portal so it overlays the entire viewport regardless of where
 * it's mounted in the tree.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ARIA_CLOSE_MODAL } from '../../config/strings.he';

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer = null,
  size = 'md',
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  }[size] || 'max-w-md';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`relative w-full ${sizeClass} bg-white rounded-lg shadow-2xl flex flex-col max-h-[90vh]`}
      >
        <header className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition-colors"
            aria-label={ARIA_CLOSE_MODAL}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          {children}
        </div>

        {footer && (
          <footer className="shrink-0 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}
