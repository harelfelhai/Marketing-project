/**
 * ResolveTaskModal — collect a mandatory resolution_note and call
 * resolveTask(...) via tasksApi (Phase DX, DX-4).
 *
 * Renders inside the existing <Modal /> primitive. Mandatory inline
 * validation: empty note shows a per-field error and blocks submit
 * (no toast — same convention as DynamicField required validation).
 *
 * // HOOK FOR ENTERPRISE AUTH — operator_id is read from useAuth() here
 * // and passed explicitly to resolveTask. Phase G replaces useAuth()
 * // with real JWT-backed identity and this signature stays unchanged.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import Modal           from '../primitives/Modal';
import { resolveTask } from '../../api/tasksApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import { useAuth }     from '../../contexts/MockAuthContext';
import {
  RESOLVE_MODAL_TITLE_RESOLVE, RESOLVE_MODAL_TITLE_REJECT,
  RESOLVE_MODAL_NOTE_LABEL, RESOLVE_MODAL_NOTE_PLACEHOLDER,
  RESOLVE_MODAL_NOTE_REQUIRED,
  RESOLVE_MODAL_BTN_CANCEL, RESOLVE_MODAL_BTN_CONFIRM, RESOLVE_MODAL_BTN_SUBMITTING,
  RESOLVE_TOAST_SUCCESS, RESOLVE_TOAST_ERROR,
} from '../../config/strings.he';

export default function ResolveTaskModal({ task, outcome, isOpen, onClose }) {
  const mockDb         = useMockData();
  const { pushToast }  = useUI();
  const { operatorId } = useAuth();

  const [note, setNote]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState('');

  const title = outcome === 'resolved'
    ? RESOLVE_MODAL_TITLE_RESOLVE
    : RESOLVE_MODAL_TITLE_REJECT;

  const handleClose = () => {
    if (submitting) return;
    setNote('');
    setError('');
    onClose();
  };

  const handleSubmit = async () => {
    if (!note.trim()) {
      setError(RESOLVE_MODAL_NOTE_REQUIRED);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await resolveTask(
        task.id,
        {
          // // HOOK FOR ENTERPRISE AUTH — operator_id sourced from useAuth().
          operator_id:     operatorId,
          outcome,
          resolution_note: note.trim(),
        },
        mockDb,
      );
      pushToast({ variant: 'success', message: RESOLVE_TOAST_SUCCESS(outcome) });
      setNote('');
      onClose();
    } catch (err) {
      pushToast({ variant: 'error', message: RESOLVE_TOAST_ERROR(err.message || '') });
    } finally {
      setSubmitting(false);
    }
  };

  if (!task) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="h-9 px-3 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            {RESOLVE_MODAL_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md text-white transition-colors disabled:opacity-50 ${
              outcome === 'resolved'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? RESOLVE_MODAL_BTN_SUBMITTING : RESOLVE_MODAL_BTN_CONFIRM(outcome)}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          {RESOLVE_MODAL_NOTE_LABEL}
        </label>
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) setError('');
          }}
          placeholder={RESOLVE_MODAL_NOTE_PLACEHOLDER}
          rows={4}
          disabled={submitting}
          className={`w-full px-3 py-2 text-sm rounded-md border bg-white focus:outline-none focus:ring-2 disabled:bg-slate-50 ${
            error
              ? 'border-rose-400 focus:ring-rose-300'
              : 'border-slate-300 focus:ring-slate-300'
          }`}
        />
        {error && (
          <p className="text-xs text-rose-600">{error}</p>
        )}
      </div>
    </Modal>
  );
}
