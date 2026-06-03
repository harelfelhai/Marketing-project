/**
 * ManualActionModal — retained as a stub; action dispatch was removed with ActionLog.
 */

import { useState } from 'react';
import { Loader2, Zap } from 'lucide-react';

import Modal from '../primitives/Modal';
import { useUI }  from '../../contexts/UIContext';
import { KNOWN_ACTION_TYPES, labelForActionType } from '../../utils/actionTypeIcons';
import {
  ACTION_MODAL_TITLE, ACTION_MODAL_TARGET_PHONE,
  ACTION_MODAL_ACTION_TYPE, ACTION_MODAL_HELP,
  ACTION_MODAL_BTN_CANCEL, ACTION_MODAL_BTN_DISPATCH, ACTION_MODAL_BTN_DISPATCHING,
  ACTION_MODAL_TOAST_ERROR,
} from '../../config/strings.he';

export default function ManualActionModal({ isOpen, onClose, phone }) {
  const { pushToast } = useUI();

  const [actionType, setActionType] = useState(KNOWN_ACTION_TYPES[0]);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      pushToast({ variant: 'error', message: ACTION_MODAL_TOAST_ERROR('Action dispatch is not available') });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!phone) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={ACTION_MODAL_TITLE}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {ACTION_MODAL_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {submitting ? ACTION_MODAL_BTN_DISPATCHING : ACTION_MODAL_BTN_DISPATCH}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-slate-500">{ACTION_MODAL_TARGET_PHONE}</span>
          <span className="font-mono text-slate-900">{phone.phone_number}</span>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {ACTION_MODAL_ACTION_TYPE}
          </label>
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md border border-slate-300"
          >
            {allowed.map((t) => (
              <option key={t} value={t}>{labelForActionType(t)}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">{ACTION_MODAL_HELP}</p>
        </div>
      </div>
    </Modal>
  );
}
