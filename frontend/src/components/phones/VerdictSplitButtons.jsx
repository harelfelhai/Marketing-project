/**
 * VerdictSplitButtons — Phase DY-4-C forked verdict surface.
 *
 * Replaces the legacy single Approve/Reject pair with a context-adaptive
 * two-axis grid. The component name is kept so callers don't need to
 * change their import path; the internals are a full rewrite.
 *
 * Shape adapts to the owning entity:
 *   - Vector A (named entity): 2x2 axis grid (phone-to-person &
 *     person-to-target), each row independently confirm/refute/none.
 *   - Vector B (envelope):     single phone-in-network axis + an
 *     inline Identify form for promoting the envelope owner. Either
 *     surface or both can be submitted in one click.
 *
 * Submit semantics:
 *   - Empty submission (no axes touched + no identification) → toast
 *     "select at least one action" and do nothing.
 *   - Successful submission → server-anchored refetch via the existing
 *     submitVerdict API (Phase D narrowed refetch).
 */

import { useState } from 'react';
import {
  Loader2,
  Phone as PhoneIcon, User, Radio, Search,
} from 'lucide-react';

import { submitVerdict } from '../../api/verificationApi';
import { useMockData }   from '../../contexts/MockDataContext';
import { useUI }         from '../../contexts/UIContext';
import { useAuth }       from '../../contexts/MockAuthContext';
import { isEnvelope }    from '../../utils/classifyStatus';
import {
  VERDICT_FORM_HEADING_VECTOR_A, VERDICT_FORM_HEADING_VECTOR_B,
  VERDICT_FORM_AXIS_PHONE_LABEL, VERDICT_FORM_AXIS_PHONE_NET,
  VERDICT_FORM_AXIS_RELATION_LBL,
  VERDICT_AXIS_CONFIRM, VERDICT_AXIS_REFUTE,
  VERDICT_REASON_PLACEHOLDER_V2,
  VERDICT_BTN_SUBMIT_AXES, VERDICT_BTN_SUBMITTING_V2,
  VERDICT_TOAST_SUCCESS_AXES, VERDICT_TOAST_EMPTY_AXES, VERDICT_TOAST_ERROR,
  IDENTIFY_FORM_HEADING, IDENTIFY_FORM_FIRST_NAME, IDENTIFY_FORM_LAST_NAME,
  IDENTIFY_FORM_RELATION, IDENTIFY_FORM_RELATION_NONE,
  IDENTIFY_FORM_RELATION_OPTIONS, IDENTIFY_BTN_SAVE,
} from '../../config/strings.he';


export default function VerdictSplitButtons({ phone, entity }) {
  const mockDb         = useMockData();
  const { operatorId } = useAuth();
  const { pushToast }  = useUI();
  const envelope       = isEnvelope(entity?.entity_type);

  // Axis selections: null | 'confirm' | 'refute'.
  const [phoneAxis,    setPhoneAxis]    = useState(null);
  const [relationAxis, setRelationAxis] = useState(null);
  const [reason,       setReason]       = useState('');

  // Identify form (envelope only).
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [relation,  setRelation]  = useState('');

  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPhoneAxis(null);
    setRelationAxis(null);
    setReason('');
    setFirstName('');
    setLastName('');
    setRelation('');
  };

  const hasAxisSelection = phoneAxis !== null || relationAxis !== null;
  const hasIdentity      = firstName.trim() || lastName.trim() || relation;
  const canSubmit        = hasAxisSelection || hasIdentity;

  const handleSubmit = async () => {
    if (!canSubmit) {
      pushToast({ variant: 'error', message: VERDICT_TOAST_EMPTY_AXES });
      return;
    }
    setSubmitting(true);
    try {
      const payload = { reason: reason.trim() || undefined };
      if (phoneAxis)    payload.phone_axis    = phoneAxis;
      if (relationAxis) payload.relation_axis = relationAxis;
      if (envelope && hasIdentity) {
        payload.identification = {
          first_name: firstName.trim() || undefined,
          last_name:  lastName.trim()  || undefined,
          relation:   relation         || undefined,
        };
      }
      await submitVerdict(phone.id, payload, operatorId, mockDb);
      pushToast({ variant: 'success', message: VERDICT_TOAST_SUCCESS_AXES });
      reset();
    } catch (err) {
      pushToast({ variant: 'error', message: VERDICT_TOAST_ERROR(err.message || '') });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {envelope ? VERDICT_FORM_HEADING_VECTOR_B : VERDICT_FORM_HEADING_VECTOR_A}
      </h4>

      <div className="space-y-1.5">
        {/* Phone axis — same column on the backend (confidence_score)
            for both vectors; the label and icon adapt. */}
        <AxisRow
          icon={envelope ? Radio : PhoneIcon}
          label={envelope ? VERDICT_FORM_AXIS_PHONE_NET : VERDICT_FORM_AXIS_PHONE_LABEL}
          value={phoneAxis}
          onChange={setPhoneAxis}
          disabled={submitting}
        />

        {/* Relation axis — Vector A only. Envelopes don't have a
            person-to-target axis until identified; the Identify form
            below replaces it. */}
        {!envelope && (
          <AxisRow
            icon={User}
            label={VERDICT_FORM_AXIS_RELATION_LBL}
            value={relationAxis}
            onChange={setRelationAxis}
            disabled={submitting}
          />
        )}
      </div>

      {/* Envelope identification form */}
      {envelope && (
        <div className="border border-slate-200 rounded-md p-2 space-y-1.5 bg-slate-50">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Search className="w-3.5 h-3.5" />
            {IDENTIFY_FORM_HEADING}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={IDENTIFY_FORM_FIRST_NAME}
              disabled={submitting}
              className="h-8 px-2 text-xs rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={IDENTIFY_FORM_LAST_NAME}
              disabled={submitting}
              className="h-8 px-2 text-xs rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>
          <select
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
            disabled={submitting}
            className="w-full h-8 px-2 text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            <option value="">{IDENTIFY_FORM_RELATION_NONE}</option>
            {IDENTIFY_FORM_RELATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Optional shared resolution note */}
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={VERDICT_REASON_PLACEHOLDER_V2}
        rows={2}
        disabled={submitting}
        className="w-full text-xs rounded-md border border-slate-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !canSubmit}
        className="w-full inline-flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-slate-900 hover:bg-slate-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitting ? VERDICT_BTN_SUBMITTING_V2 : VERDICT_BTN_SUBMIT_AXES}
      </button>
    </div>
  );
}


function AxisRow({ icon: Icon, label, value, onChange, disabled }) {
  // Compact axis selector: icon + label on the start, two pill buttons
  // on the end. Buttons are mutually exclusive within the row; clicking
  // an already-selected button toggles it back to null (operator can
  // "unset" their pick before submitting).
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-slate-700 min-w-0">
        <Icon className="w-3.5 h-3.5 shrink-0 text-slate-500" />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <AxisChip
          state="confirm"
          active={value === 'confirm'}
          onClick={() => onChange(value === 'confirm' ? null : 'confirm')}
          disabled={disabled}
          label={VERDICT_AXIS_CONFIRM}
        />
        <AxisChip
          state="refute"
          active={value === 'refute'}
          onClick={() => onChange(value === 'refute' ? null : 'refute')}
          disabled={disabled}
          label={VERDICT_AXIS_REFUTE}
        />
      </div>
    </div>
  );
}


function AxisChip({ state, active, onClick, disabled, label }) {
  // state='confirm' → emerald when active; state='refute' → rose.
  const palette = state === 'confirm'
    ? (active ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50')
    : (active ? 'bg-rose-600 text-white border-rose-600'
              : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-7 px-2.5 text-[11px] font-medium rounded-md border transition-colors disabled:opacity-50 ${palette}`}
    >
      {label}
    </button>
  );
}
