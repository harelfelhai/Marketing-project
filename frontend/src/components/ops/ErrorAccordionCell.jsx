/**
 * ErrorAccordionCell — collapsible error detail for a failed action log row.
 *
 * Collapsed view: first line of error_detail (or a generic fallback).
 * Expanded view: full error_detail + stack_trace in a monospace <pre> block
 * with a one-click Copy button. The raw <pre> makes the trace selectable
 * and copy-paste-ready even without the button.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

export default function ErrorAccordionCell({ extraData = {} }) {
  const [isOpen,    setIsOpen]    = useState(false);
  const [copied,    setCopied]    = useState(false);

  const summary    = extraData.error_detail || 'Action failed after max retry attempts — handler returned a non-retryable error.';
  const stackTrace = extraData.stack_trace  || null;

  const copyText   = [summary, stackTrace].filter(Boolean).join('\n\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can select the <pre> manually */
    }
  };

  return (
    <div className="text-xs space-y-1">
      {/* Collapsed summary row */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-start gap-1.5 text-left group w-full"
      >
        <span className="shrink-0 mt-0.5 text-slate-400 group-hover:text-slate-700 transition-colors">
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
        <span className="text-rose-700 break-words line-clamp-2 group-hover:line-clamp-none transition-all">
          {summary}
        </span>
      </button>

      {/* Expanded trace panel */}
      {isOpen && (
        <div className="relative mt-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
              Stack Trace
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-900 transition-colors"
              title="Copy error detail"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="font-mono text-[10px] leading-relaxed bg-slate-900 text-slate-100 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all select-all">
            {stackTrace || '(no stack trace recorded)'}
          </pre>
        </div>
      )}
    </div>
  );
}
