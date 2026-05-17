/**
 * VerdictSplitButtons — Approve (green) / Reject (red) controls with an
 * inline reason textarea (no separate modal — keeps the footer flow tight).
 *
 * On submit: calls submitVerdict() (which calls applyVerdict() under the
 * hood). The drawer remains open so the operator sees the status badge
 * flip in the header.
 */

import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';

import { submitVerdict } from '../../api/verificationApi';
import { useMockData }   from '../../contexts/MockDataContext';
import { useUI }         from '../../contexts/UIContext';
import { useAuth }       from '../../contexts/MockAuthContext';

export default function VerdictSplitButtons({ phone }) {
  const mockDb           = useMockData();
  const { operatorId }   = useAuth();
  const { pushToast }    = useUI();

  // pendingChoice is the verdict the operator picked but hasn't submitted yet:
  //   null            — collapsed (showing the two buttons)
  //   'verified_good' — reason textarea visible, Approve flow
  //   'verified_bad'  — reason textarea visible, Reject flow
  const [pendingChoice, setPendingChoice] = useState(null);
  const [reason, setReason]               = useState('');
  const [submitting, setSubmitting]       = useState(false);

  const cancel = () => {
    setPendingChoice(null);
    setReason('');
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await submitVerdict(phone.id, pendingChoice, reason.trim(), operatorId, mockDb);
      const niceLabel = pendingChoice === 'verified_good' ? 'verified good' : 'verified bad';
      pushToast({ variant: 'success', message: `Verdict recorded — phone marked as ${niceLabel}.` });
      cancel();
    } catch (err) {
      pushToast({ variant: 'error', message: `Verdict failed: ${err.message}` });
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingChoice === null) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPendingChoice('verified_good')}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
        >
          <ShieldCheck className="w-4 h-4" />
          Approve
        </button>
        <button
          type="button"
          onClick={() => setPendingChoice('verified_bad')}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors"
        >
          <ShieldAlert className="w-4 h-4" />
          Reject
        </button>
      </div>
    );
  }

  const isApprove = pendingChoice === 'verified_good';

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {isApprove
          ? 'Confirming verdict as Verified Good.'
          : 'Confirming verdict as Verified Bad.'}
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Optional: brief reason for this verdict (e.g. confirmed via callback, number disconnected, low confidence score)."
        rows={2}
        className="w-full text-sm rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={submitting}
          className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className={`inline-flex items-center gap-2 h-9 px-3 rounded-md text-white text-sm font-medium transition-colors disabled:opacity-60 ${
            isApprove
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : 'bg-rose-600 hover:bg-rose-700'
          }`}
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Submitting…' : (isApprove ? 'Confirm Approve' : 'Confirm Reject')}
        </button>
      </div>
    </div>
  );
}
