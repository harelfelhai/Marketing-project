/**
 * DataAdminPage — UAT round-3 admin tab for editing + soft-deleting
 * entities and phones.
 *
 * Page-level structure:
 *   ┌────────────────────────────────────────────┐
 *   │  [Persons]  [Phones]    [show deleted ▢]   │
 *   ├────────────────────────────────────────────┤
 *   │  Table: id | name | client | actions       │
 *   │  Actions: ✎ edit · 🗑 delete · ↩ restore    │
 *   └────────────────────────────────────────────┘
 *
 * Page is admin-gated via <RequireRole role="admin">. The tab itself
 * is also hidden from the nav for non-admins as a UX hint, but the
 * gate is the source of truth.
 *
 * Delete cascades on entities — the confirm-modal surfaces the live
 * count of phones that will also be tombstoned, so the operator sees
 * the blast radius before confirming.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2, RotateCcw, X, Loader2 } from 'lucide-react';

import { useMockData } from '../contexts/MockDataContext';
import { useUI }       from '../contexts/UIContext';
import {
  listEntities, patchEntity, softDeleteEntity, restoreEntity,
} from '../api/entityApi';
import {
  listPhones, adminPatchPhone, softDeletePhone, restorePhone,
} from '../api/phonesApi';
import { getClientById } from '../config/clientRegistry';
import { normalizeError } from '../api/client';
import {
  ADMIN_PAGE_TITLE, ADMIN_PAGE_SUB,
  ADMIN_TAB_PERSONS, ADMIN_TAB_PHONES, ADMIN_TOGGLE_INCLUDE_DELETED,
  ADMIN_BTN_EDIT, ADMIN_BTN_DELETE, ADMIN_BTN_RESTORE,
  ADMIN_BTN_SAVE, ADMIN_BTN_CANCEL,
  ADMIN_CONFIRM_DELETE_ENTITY, ADMIN_CONFIRM_DELETE_PHONE,
  ADMIN_TOAST_SAVED, ADMIN_TOAST_DELETED, ADMIN_TOAST_RESTORED,
  ADMIN_TOAST_ERROR,
  ADMIN_FIELD_FIRST_NAME, ADMIN_FIELD_LAST_NAME, ADMIN_FIELD_RELATION,
  ADMIN_FIELD_PHONE_NUMBER, ADMIN_FIELD_VERIFICATION,
} from '../config/strings.he';


export default function DataAdminPage() {
  const [subTab, setSubTab]           = useState('persons');
  const [includeDeleted, setInclDel]  = useState(false);

  return (
    <section className="space-y-4" dir="rtl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{ADMIN_PAGE_TITLE}</h1>
        <p className="text-sm text-slate-500 mt-1">{ADMIN_PAGE_SUB}</p>
      </header>

      <div className="flex items-center justify-between bg-white rounded-lg border border-slate-200 px-3 py-2">
        <div className="flex items-center gap-1">
          <TabBtn
            active={subTab === 'persons'}
            onClick={() => setSubTab('persons')}
            testId="admin-tab-persons"
          >
            {ADMIN_TAB_PERSONS}
          </TabBtn>
          <TabBtn
            active={subTab === 'phones'}
            onClick={() => setSubTab('phones')}
            testId="admin-tab-phones"
          >
            {ADMIN_TAB_PHONES}
          </TabBtn>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => setInclDel(e.target.checked)}
            data-testid="admin-toggle-include-deleted"
          />
          {ADMIN_TOGGLE_INCLUDE_DELETED}
        </label>
      </div>

      {subTab === 'persons' ? (
        <PersonsAdmin includeDeleted={includeDeleted} />
      ) : (
        <PhonesAdmin includeDeleted={includeDeleted} />
      )}
    </section>
  );
}


function TabBtn({ active, onClick, children, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={[
        'h-9 px-3 rounded-md text-sm transition-colors',
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}


/* ===========================================================================
 * Persons sub-tab
 * ========================================================================= */

function PersonsAdmin({ includeDeleted }) {
  const mockDb = useMockData();
  const { pushToast } = useUI();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // entity being edited
  const [deleting, setDeleting] = useState(null); // entity pending confirm

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listEntities({ includeDeleted }, mockDb);
      setRows(items);
    } finally {
      setLoading(false);
    }
  }, [mockDb, includeDeleted]);

  useEffect(() => { load(); }, [load]);

  // Cascade preview — count active phones per entity for the delete
  // confirm dialog. Pulled live from mockDb so the count reflects any
  // mid-session deletes.
  const activePhoneCountByEntity = useMemo(() => {
    const map = new Map();
    for (const p of mockDb.phones) {
      if (p.deleted_at) continue;
      map.set(p.entity_id, (map.get(p.entity_id) || 0) + 1);
    }
    return map;
  }, [mockDb.phones]);

  const handleSave = async (body) => {
    if (!editing) return;
    try {
      await patchEntity(editing.id, body, mockDb);
      pushToast({ variant: 'success', message: ADMIN_TOAST_SAVED });
      setEditing(null);
      await load();
    } catch (err) {
      pushToast({ variant: 'error', message: ADMIN_TOAST_ERROR(normalizeError(err).message) });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await softDeleteEntity(deleting.id, mockDb);
      pushToast({ variant: 'success', message: ADMIN_TOAST_DELETED });
      setDeleting(null);
      await load();
    } catch (err) {
      pushToast({ variant: 'error', message: ADMIN_TOAST_ERROR(normalizeError(err).message) });
    }
  };

  const handleRestore = async (row) => {
    try {
      await restoreEntity(row.id, mockDb);
      pushToast({ variant: 'success', message: ADMIN_TOAST_RESTORED });
      await load();
    } catch (err) {
      pushToast({ variant: 'error', message: ADMIN_TOAST_ERROR(normalizeError(err).message) });
    }
  };

  return (
    <>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden" data-testid="admin-persons-table">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-[11px] uppercase">
            <tr>
              <th className="text-start px-3 py-2 w-20">מזהה</th>
              <th className="text-start px-3 py-2">שם</th>
              <th className="text-start px-3 py-2 w-32">סוג קרבה</th>
              <th className="text-start px-3 py-2 w-36">לקוח</th>
              <th className="text-start px-3 py-2 w-24">סטטוס</th>
              <th className="text-end   px-3 py-2 w-40">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin inline" />
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">לא נמצאו ישויות.</td></tr>
            ) : (
              rows.map((e) => {
                // UAT round-3 fix: when both name parts are empty
                // (envelopes, in-progress drafts) show a soft "ללא שם"
                // marker instead of falling back to the row id —
                // operators were confused by the "#5" lookalike.
                const fullName = [e.first_name, e.last_name].filter(Boolean).join(' ');
                const clientName = getClientById(e.client_id)?.name || `Client ${e.client_id}`;
                const isDeleted = !!e.deleted_at;
                return (
                  <tr
                    key={e.id}
                    data-testid="admin-person-row"
                    className={`border-t border-slate-100 ${isDeleted ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">#{e.id}</td>
                    <td className="px-3 py-2 text-slate-900">
                      {fullName || <span className="text-slate-400 italic">ללא שם</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{e.entity_type}</td>
                    <td className="px-3 py-2 text-slate-700">{clientName}</td>
                    <td className="px-3 py-2 text-xs">
                      {isDeleted
                        ? <span className="text-rose-600">נמחק</span>
                        : <span className="text-emerald-600">פעיל</span>}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {isDeleted ? (
                        <button
                          type="button"
                          onClick={() => handleRestore(e)}
                          data-testid={`admin-person-restore-${e.id}`}
                          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {ADMIN_BTN_RESTORE}
                        </button>
                      ) : (
                        <div className="inline-flex gap-3">
                          <button
                            type="button"
                            onClick={() => setEditing(e)}
                            data-testid={`admin-person-edit-${e.id}`}
                            className="inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {ADMIN_BTN_EDIT}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleting(e)}
                            data-testid={`admin-person-delete-${e.id}`}
                            className="inline-flex items-center gap-1 text-xs text-rose-700 hover:text-rose-900"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {ADMIN_BTN_DELETE}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EntityEditModal
          entity={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="מחיקת ישות"
          body={ADMIN_CONFIRM_DELETE_ENTITY(
            [deleting.first_name, deleting.last_name].filter(Boolean).join(' ') || `#${deleting.id}`,
            activePhoneCountByEntity.get(deleting.id) || 0,
          )}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
          testId="admin-confirm-delete-entity"
        />
      )}
    </>
  );
}


/* ===========================================================================
 * Phones sub-tab
 * ========================================================================= */

function PhonesAdmin({ includeDeleted }) {
  const mockDb = useMockData();
  const { pushToast } = useUI();
  const [editing,  setEditing]  = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [rows, setRows]         = useState([]);

  // UAT round-3 fix: PhonesAdmin owns its own list-query because the
  // global mockDb.phones is purged of soft-deleted rows after every
  // refetchPhones (the boot loader uses GET /phones which hides them
  // by default). To support "show deleted" we must hit the endpoint
  // with include_deleted=true on demand.
  const load = useCallback(async () => {
    const items = await listPhones({ includeDeleted, pageSize: 200 }, mockDb);
    setRows(items);
  }, [mockDb, includeDeleted]);

  useEffect(() => { load(); }, [load]);

  const entityById = useMemo(() => {
    const map = new Map();
    for (const e of mockDb.entities || []) map.set(e.id, e);
    return map;
  }, [mockDb.entities]);

  const handleSave = async (body) => {
    if (!editing) return;
    try {
      await adminPatchPhone(editing.id, body, mockDb);
      pushToast({ variant: 'success', message: ADMIN_TOAST_SAVED });
      setEditing(null);
      await load();
    } catch (err) {
      pushToast({ variant: 'error', message: ADMIN_TOAST_ERROR(normalizeError(err).message) });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await softDeletePhone(deleting.id, mockDb);
      pushToast({ variant: 'success', message: ADMIN_TOAST_DELETED });
      setDeleting(null);
      await load();
    } catch (err) {
      pushToast({ variant: 'error', message: ADMIN_TOAST_ERROR(normalizeError(err).message) });
    }
  };

  const handleRestore = async (row) => {
    try {
      await restorePhone(row.id, mockDb);
      pushToast({ variant: 'success', message: ADMIN_TOAST_RESTORED });
      await load();
    } catch (err) {
      pushToast({ variant: 'error', message: ADMIN_TOAST_ERROR(normalizeError(err).message) });
    }
  };

  return (
    <>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden" data-testid="admin-phones-table">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-[11px] uppercase">
            <tr>
              <th className="text-start px-3 py-2 w-20">מזהה</th>
              <th className="text-start px-3 py-2">מספר</th>
              <th className="text-start px-3 py-2 w-32">סטטוס אימות</th>
              <th className="text-start px-3 py-2 w-32">לקוח</th>
              <th className="text-start px-3 py-2 w-24">סטטוס</th>
              <th className="text-end   px-3 py-2 w-40">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">אין טלפונים.</td></tr>
            ) : (
              rows.map((p) => {
                const ent = entityById.get(p.entity_id);
                const clientName = getClientById(ent?.client_id)?.name || `Client ${ent?.client_id ?? '?'}`;
                const isDeleted = !!p.deleted_at;
                return (
                  <tr
                    key={p.id}
                    data-testid="admin-phone-row"
                    className={`border-t border-slate-100 ${isDeleted ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">#{p.id}</td>
                    {/* UAT round-3 fix: keep the cell RTL-aligned (right side
                        in the table), but wrap the number itself so its
                        digits stay LTR. The previous dir="ltr" on the
                        whole <td> pushed the content to the cell's left
                        edge under an RTL document layout. */}
                    <td className="px-3 py-2 text-slate-900">
                      <span dir="ltr" className="inline-block">{p.phone_number}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{p.verification_status}</td>
                    <td className="px-3 py-2 text-slate-700">{clientName}</td>
                    <td className="px-3 py-2 text-xs">
                      {isDeleted
                        ? <span className="text-rose-600">נמחק</span>
                        : <span className="text-emerald-600">פעיל</span>}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {isDeleted ? (
                        <button
                          type="button"
                          onClick={() => handleRestore(p)}
                          data-testid={`admin-phone-restore-${p.id}`}
                          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {ADMIN_BTN_RESTORE}
                        </button>
                      ) : (
                        <div className="inline-flex gap-3">
                          <button
                            type="button"
                            onClick={() => setEditing(p)}
                            data-testid={`admin-phone-edit-${p.id}`}
                            className="inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {ADMIN_BTN_EDIT}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleting(p)}
                            data-testid={`admin-phone-delete-${p.id}`}
                            className="inline-flex items-center gap-1 text-xs text-rose-700 hover:text-rose-900"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {ADMIN_BTN_DELETE}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <PhoneEditModal
          phone={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="מחיקת טלפון"
          body={ADMIN_CONFIRM_DELETE_PHONE(deleting.phone_number)}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
          testId="admin-confirm-delete-phone"
        />
      )}
    </>
  );
}


/* ===========================================================================
 * Inline edit modals
 * ========================================================================= */

function EntityEditModal({ entity, onCancel, onSave }) {
  const [firstName, setFirstName] = useState(entity.first_name || '');
  const [lastName,  setLastName]  = useState(entity.last_name  || '');
  const [relation,  setRelation]  = useState(entity.entity_type || 'family');

  const handleSave = () =>
    onSave({
      first_name:    firstName,
      last_name:     lastName,
      relation_type: relation,
    });

  return (
    <ModalScaffold onCancel={onCancel} testId="admin-entity-edit-modal" title="עריכת ישות">
      <LabeledInput label={ADMIN_FIELD_FIRST_NAME} value={firstName} onChange={setFirstName} />
      <LabeledInput label={ADMIN_FIELD_LAST_NAME}  value={lastName}  onChange={setLastName}  />
      <LabeledInput label={ADMIN_FIELD_RELATION}   value={relation}  onChange={setRelation}  />
      <ModalActions onCancel={onCancel} onSave={handleSave} />
    </ModalScaffold>
  );
}


function PhoneEditModal({ phone, onCancel, onSave }) {
  const [number,   setNumber]   = useState(phone.phone_number || '');
  const [verif,    setVerif]    = useState(phone.verification_status || 'pending');

  const handleSave = () =>
    onSave({
      phone_number:        number,
      verification_status: verif,
    });

  return (
    <ModalScaffold onCancel={onCancel} testId="admin-phone-edit-modal" title="עריכת טלפון">
      <LabeledInput label={ADMIN_FIELD_PHONE_NUMBER} value={number} onChange={setNumber} dir="ltr" />
      <LabeledInput label={ADMIN_FIELD_VERIFICATION} value={verif}  onChange={setVerif}  />
      <ModalActions onCancel={onCancel} onSave={handleSave} />
    </ModalScaffold>
  );
}


function ConfirmModal({ title, body, onCancel, onConfirm, testId }) {
  return (
    <ModalScaffold onCancel={onCancel} testId={testId} title={title}>
      <p className="text-sm text-slate-700 whitespace-pre-wrap">{body}</p>
      <ModalActions
        onCancel={onCancel}
        onSave={onConfirm}
        saveLabel={ADMIN_BTN_DELETE}
        saveTone="danger"
      />
    </ModalScaffold>
  );
}


function ModalScaffold({ title, children, onCancel, testId }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
      data-testid={testId}
    >
      <div
        className="w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-lg p-5 space-y-3"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}


function ModalActions({ onCancel, onSave, saveLabel, saveTone }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
      <button
        type="button"
        onClick={onCancel}
        className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
      >
        {ADMIN_BTN_CANCEL}
      </button>
      <button
        type="button"
        onClick={onSave}
        data-testid="admin-modal-save"
        className={[
          'h-9 px-4 rounded-md text-sm font-medium transition-colors',
          saveTone === 'danger'
            ? 'bg-rose-600 hover:bg-rose-700 text-white'
            : 'bg-slate-900 hover:bg-slate-800 text-white',
        ].join(' ')}
      >
        {saveLabel || ADMIN_BTN_SAVE}
      </button>
    </div>
  );
}


function LabeledInput({ label, value, onChange, dir }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={dir}
        className="mt-1 block w-full h-9 px-2 rounded-md border border-slate-300 text-sm"
      />
    </label>
  );
}
