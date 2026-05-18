/**
 * VerdictSplitButtons — Approve / Reject controls with inline reason textarea.
 */

import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';

import { submitVerdict } from '../../api/verificationApi';
import { useMockData }   from '../../contexts/MockDataContext';
import { useUI }         from '../../contexts/UIContext';
import { useAuth }       from '../../contexts/MockAuthContext';
import {
  VERDICT_BTN_APPROVE, VERDICT_BTN_REJECT,
  VERDICT_CONFIRM_GOOD, VERDICT_CONFIRM_BAD,
  VERDICT_REASON_PLACEHOLDER, VERDICT_BTN_CANCEL,
  VERDICT_BTN_SUBMITTING, VERDICT_BTN_CONFIRM_APPROVE, VERDICT_BTN_CONFIRM_REJECT,
  VERDICT_TOAST_SUCCESS, VERDICT_TOAST_ERROR,
} from '../../config/strings.he';
import { verificationLabel } from '../../utils/classifyStatus';

export default function VerdictSplitButtons({ phone }) {
  const mockDb           = useMockData();
  const { operatorId }   = useAuth();
  const { pushToast }    = useUI();

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
      pushToast({ variant: 'success', message: VERDICT_TOAST_SUCCESS(verificationLabel(pendingChoice)) });
      cancel();
    } catch (err) {
      pushToast({ variant: 'error', message: VERDICT_TOAST_ERROR(err.message) });
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
          {VERDICT_BTN_APPROVE}
        </button>
        <button
          type="button"
          onClick={() => setPendingChoice('verified_bad')}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors"
        >
          <ShieldAlert className="w-4 h-4" />
          {VERDICT_BTN_REJECT}
        </button>
      </div>
    );
  }

  const isApprove = pendingChoice === 'verified_good';

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {isApprove ? VERDICT_CONFIRM_GOOD : VERDICT_CONFIRM_BAD}
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={VERDICT_REASON_PLACEHOLDER}
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
          {VERDICT_BTN_CANCEL}
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
          {submitting
            ? VERDICT_BTN_SUBMITTING
            : (isApprove ? VERDICT_BTN_CONFIRM_APPROVE : VERDICT_BTN_CONFIRM_REJECT)
          }
        </button>
      </div>
    </div>
  );
}
