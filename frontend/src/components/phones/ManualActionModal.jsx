/**
 * ManualActionModal — operator-initiated action dispatch.
 *
 * Action type picker is scoped to the phone's classification_type.
 * // HOOK FOR ENTERPRISE LABELS — ACTION_SCOPE_BY_CLASSIFICATION is the swap point.
 */

import { useState } from 'react';
import { Loader2, Zap } from 'lucide-react';

import Modal from '../primitives/Modal';
import { triggerManualAction } from '../../api/actionsApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import { useAuth }     from '../../contexts/MockAuthContext';
import { KNOWN_ACTION_TYPES, labelForActionType } from '../../utils/actionTypeIcons';
import {
  ACTION_MODAL_TITLE, ACTION_MODAL_TARGET_PHONE, ACTION_MODAL_CLASSIFICATION,
  ACTION_MODAL_ACTION_TYPE, ACTION_MODAL_HELP,
  ACTION_MODAL_BTN_CANCEL, ACTION_MODAL_BTN_DISPATCH, ACTION_MODAL_BTN_DISPATCHING,
  ACTION_MODAL_TOAST_SUCCESS, ACTION_MODAL_TOAST_ERROR,
} from '../../config/strings.he';

// // HOOK FOR ENTERPRISE LABELS — map classification_type → allowed actions.
const ACTION_SCOPE_BY_CLASSIFICATION = {
  type_a: ['outreach_a', 'outreach_c'],
  type_b: ['outreach_b', 'outreach_d'],
  type_c: ['outreach_a', 'outreach_b'],
  type_d: ['outreach_c', 'outreach_d'],
};

export default function ManualActionModal({ isOpen, onClose, phone }) {
  const mockDb        = useMockData();
  const { pushToast } = useUI();
  const { operatorId } = useAuth();

  const allowed = (phone?.classification_type && ACTION_SCOPE_BY_CLASSIFICATION[phone.classification_type])
    || KNOWN_ACTION_TYPES;

  const [actionType, setActionType] = useState(allowed[0]);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await triggerManualAction(
        { phone_id: phone.id, action_type: actionType, operator_id: operatorId },
        mockDb
      );
      pushToast({ variant: 'success', message: ACTION_MODAL_TOAST_SUCCESS(labelForActionType(actionType)) });
      onClose();
    } catch (err) {
      pushToast({ variant: 'error', message: ACTION_MODAL_TOAST_ERROR(err.message) });
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
        {phone.classification_type && (
          <div className="flex items-baseline justify-between">
            <span className="text-slate-500">{ACTION_MODAL_CLASSIFICATION}</span>
            <span className="font-mono text-slate-900 uppercase tracking-wide text-xs">
              {phone.classification_type}
            </span>
          </div>
        )}

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
