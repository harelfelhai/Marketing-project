/**
 * NotificationOptInPanel — Phase NOTIF inline opt-in component.
 *
 * Drop-in for any workflow's success state. Three visual states:
 *
 *   COLLAPSED  ─── click ──▶  EXPANDED  ─── save ──▶  ACTIVE
 *      ▲                          │                      │
 *      │                          │ cancel               │ edit
 *      │                          ▼                      │
 *      └──────────────────── COLLAPSED ◀─────────────────┘
 *
 * Lifecycle:
 *   - On mount, list ALL active subscriptions for (contextKind, contextId).
 *     The panel groups them and renders the ACTIVE state if any exist.
 *   - "Save" replaces the operator's prior subscription set for this
 *     context: ANY pre-existing subscriptions for events the operator
 *     un-checked are deleted; ANY events the operator newly-checked
 *     are created. Edits to recipients are PATCHed onto the existing
 *     rows (so audit history stays intact when only the channel set
 *     changes).
 *   - "Delete" hard-deletes EVERY subscription for this context.
 *
 * The panel takes ONE call site per workflow — the parent passes
 * contextKind / contextId, the panel owns everything else (loading,
 * mutation, state machine, toast emission).
 *
 * State is entirely local — no UIContext slice. Subscriptions are a
 * per-record concern; a global cache would cost more than the live
 * fetch on mount.
 */

import { useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, Loader2, Check, X, Trash2 } from 'lucide-react';

import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  updateSubscription,
} from '../../api/notificationsApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import { useAuth }     from '../../contexts/MockAuthContext';
import { CHAT_CHANNELS, getChannelLabel } from '../../config/chatChannelRegistry';
import {
  getEventCatalog,
  getDefaultEventKeys,
} from '../../config/notificationEventCatalog';
import {
  NOTIF_OPT_IN_COLLAPSED_CTA, NOTIF_OPT_IN_ACTIVE_LABEL, NOTIF_OPT_IN_EDIT,
  NOTIF_FORM_EVENTS_LABEL, NOTIF_FORM_RECIPIENTS_LABEL,
  NOTIF_BTN_SAVE, NOTIF_BTN_SUBMITTING, NOTIF_BTN_CANCEL, NOTIF_BTN_DELETE,
  NOTIF_ERR_NO_EVENTS, NOTIF_ERR_NO_RECIPIENTS,
  NOTIF_TOAST_SAVED, NOTIF_TOAST_UPDATED, NOTIF_TOAST_DELETED, NOTIF_TOAST_ERROR,
} from '../../config/strings.he';


export default function NotificationOptInPanel({ contextKind, contextId }) {
  const mockDb       = useMockData();
  const { pushToast } = useUI();
  const { operatorId } = useAuth();

  // Existing subscription rows for this context. Keyed by trigger_event_type
  // so the diff (create / patch / delete) at save time is O(events).
  const [existingByEvent, setExistingByEvent] = useState(new Map());

  // Visual state. Starts loading until the list call resolves; flips to
  // 'collapsed' or 'active' based on whether existingByEvent has rows.
  const [view, setView]            = useState('loading');
  const [selectedEvents, setSelectedEvents] = useState(new Set());
  const [selectedRecipients, setSelectedRecipients] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg,   setErrorMsg]   = useState('');

  const catalog = useMemo(() => getEventCatalog(contextKind), [contextKind]);

  // ----- Mount: fetch live subscription state ----------------------------
  useEffect(() => {
    let cancelled = false;
    listSubscriptions(
      { targetKind: contextKind, targetId: contextId, active: true },
      mockDb,
    )
      .then((rows) => {
        if (cancelled) return;
        const map = new Map();
        rows.forEach((r) => map.set(r.trigger_event_type, r));
        setExistingByEvent(map);
        setView(rows.length > 0 ? 'active' : 'collapsed');
      })
      .catch(() => {
        if (cancelled) return;
        // List failure is non-fatal — operator just sees the collapsed
        // CTA and can try to subscribe fresh.
        setView('collapsed');
      });
    return () => { cancelled = true; };
    // contextKind/contextId are the stable identity of THIS opt-in panel;
    // mockDb is the per-test context. No re-fetch on save/cancel — the
    // save path updates the local map in-place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKind, contextId]);

  // ----- Helpers -----------------------------------------------------------

  const openExpanded = () => {
    // Seed selection from existing rows if any; otherwise from defaults.
    if (existingByEvent.size > 0) {
      const events = new Set(existingByEvent.keys());
      const recipientUnion = new Set();
      for (const sub of existingByEvent.values()) {
        (sub.recipients || []).forEach((r) => recipientUnion.add(r));
      }
      setSelectedEvents(events);
      setSelectedRecipients(recipientUnion);
    } else {
      setSelectedEvents(new Set(getDefaultEventKeys(contextKind)));
      setSelectedRecipients(new Set());
    }
    setErrorMsg('');
    setView('expanded');
  };

  const closeExpanded = () => {
    setErrorMsg('');
    setView(existingByEvent.size > 0 ? 'active' : 'collapsed');
  };

  const toggleEvent = (key) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setErrorMsg('');
  };

  const toggleRecipient = (id) => {
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setErrorMsg('');
  };

  // ----- Save: diff existing vs selected, apply each change ---------------
  //
  // The diff treats `selectedEvents` as the authoritative set of
  // event subscriptions for this context. For each existing event NOT
  // in the selection → DELETE. For each selected event WITHOUT an
  // existing row → CREATE. For events present in BOTH → PATCH the
  // recipient list (cheaper than delete+create and preserves audit).
  const handleSave = async () => {
    if (selectedEvents.size === 0) {
      setErrorMsg(NOTIF_ERR_NO_EVENTS);
      return;
    }
    if (selectedRecipients.size === 0) {
      setErrorMsg(NOTIF_ERR_NO_RECIPIENTS);
      return;
    }

    setSubmitting(true);
    const recipients = Array.from(selectedRecipients);
    const hadExisting = existingByEvent.size > 0;
    const nextMap = new Map(existingByEvent);

    try {
      // 1) Deletes — events present before, not selected now.
      for (const [evt, sub] of existingByEvent.entries()) {
        if (!selectedEvents.has(evt)) {
          await deleteSubscription(sub.id, mockDb);
          nextMap.delete(evt);
        }
      }
      // 2) Creates — events selected now but not present before.
      for (const evt of selectedEvents) {
        if (!existingByEvent.has(evt)) {
          const created = await createSubscription({
            trigger_event_type: evt,
            target_kind:        contextKind,
            target_id:          contextId,
            recipients,
            // Phase AUTH-B: created_by is server-derived from the
            // session. Forwarded to mock-mode mutators via the
            // notificationsApi adapter; the real-mode wire body
            // drops it.
            created_by:         operatorId,
          }, mockDb);
          nextMap.set(evt, created);
        }
      }
      // 3) Patches — events in both, recipient set may have changed.
      for (const evt of selectedEvents) {
        const existing = existingByEvent.get(evt);
        if (!existing) continue;     // covered by step 2
        const before = new Set(existing.recipients || []);
        const changed =
          before.size !== selectedRecipients.size ||
          recipients.some((r) => !before.has(r));
        if (changed) {
          const updated = await updateSubscription(existing.id, { recipients }, mockDb);
          nextMap.set(evt, updated);
        }
      }

      setExistingByEvent(nextMap);
      setView(nextMap.size > 0 ? 'active' : 'collapsed');
      pushToast({
        variant: 'success',
        message: hadExisting ? NOTIF_TOAST_UPDATED : NOTIF_TOAST_SAVED,
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        message: NOTIF_TOAST_ERROR(err?.message || 'error'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ----- Delete-all: nuke every subscription for this context -------------
  const handleDelete = async () => {
    setSubmitting(true);
    try {
      for (const sub of existingByEvent.values()) {
        await deleteSubscription(sub.id, mockDb);
      }
      setExistingByEvent(new Map());
      setView('collapsed');
      pushToast({ variant: 'success', message: NOTIF_TOAST_DELETED });
    } catch (err) {
      pushToast({
        variant: 'error',
        message: NOTIF_TOAST_ERROR(err?.message || 'error'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================================
  // Render
  // =========================================================================

  if (view === 'loading') {
    // Skeleton — same vertical footprint as the collapsed CTA so the
    // layout doesn't jump when the list call resolves.
    return (
      <div
        data-testid="notif-panel-loading"
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-slate-200 bg-slate-50/40 text-sm text-slate-400"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>…</span>
      </div>
    );
  }

  if (view === 'collapsed') {
    return (
      <button
        type="button"
        onClick={openExpanded}
        data-testid="notif-panel-collapsed"
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-sm text-slate-700 transition-colors"
      >
        <Bell className="w-4 h-4 text-slate-400" />
        {NOTIF_OPT_IN_COLLAPSED_CTA}
      </button>
    );
  }

  if (view === 'active') {
    return (
      <div
        data-testid="notif-panel-active"
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-emerald-200 bg-emerald-50/50 text-sm text-emerald-800"
      >
        <BellRing className="w-4 h-4 text-emerald-600" />
        <span>{NOTIF_OPT_IN_ACTIVE_LABEL(existingByEvent.size)}</span>
        <button
          type="button"
          onClick={openExpanded}
          className="text-xs text-emerald-700 hover:text-emerald-900 underline ms-2"
        >
          {NOTIF_OPT_IN_EDIT}
        </button>
      </div>
    );
  }

  // EXPANDED ---------------------------------------------------------------
  return (
    <div
      data-testid="notif-panel-expanded"
      className="rounded-md border border-slate-200 bg-white p-3 space-y-3"
    >
      {/* Event checklist */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700 mb-1">
          {NOTIF_FORM_EVENTS_LABEL}
        </legend>
        <ul className="space-y-1">
          {catalog.map((evt) => (
            <li key={evt.key}>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedEvents.has(evt.key)}
                  onChange={() => toggleEvent(evt.key)}
                  data-testid={`notif-event-${evt.key}`}
                  className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-300"
                />
                {evt.label}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {/* Recipient picker */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700 mb-1">
          {NOTIF_FORM_RECIPIENTS_LABEL}
        </legend>
        <ul className="space-y-1">
          {CHAT_CHANNELS.map((ch) => (
            <li key={ch.id}>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedRecipients.has(ch.id)}
                  onChange={() => toggleRecipient(ch.id)}
                  data-testid={`notif-recipient-${ch.id}`}
                  className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-300"
                />
                <span>{ch.label}</span>
                <span className="text-[10px] text-slate-400 uppercase">{ch.kind}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {errorMsg && (
        <p role="alert" className="text-xs text-rose-600">{errorMsg}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        {existingByEvent.size > 0 ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            data-testid="notif-delete-all"
            className="inline-flex items-center gap-1 h-8 px-2 text-xs text-rose-600 hover:text-rose-800 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {NOTIF_BTN_DELETE}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={closeExpanded}
            disabled={submitting}
            className="h-8 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {NOTIF_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            data-testid="notif-save"
            className="inline-flex items-center gap-2 h-8 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {NOTIF_BTN_SUBMITTING}</>
              : <><Check className="w-4 h-4" /> {NOTIF_BTN_SAVE}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
