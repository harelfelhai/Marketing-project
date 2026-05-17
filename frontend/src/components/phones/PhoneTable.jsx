/**
 * PhoneTable — filtered table over the live MockDataContext state.
 *
 * Uses table-fixed with explicit colgroup widths so a long string in
 * Column 2 cannot push Columns 3-5 off-screen. Filter application is
 * a useMemo derivation; the source of truth stays in context so
 * mutations propagate instantly.
 */

import { useMemo } from 'react';

import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import PhoneRow        from './PhoneRow';

function applyFilters(phones, entities, clients, actionLogs, filters) {
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const logsByPhone = actionLogs.reduce((acc, l) => {
    (acc[l.phone_id] ||= []).push(l);
    return acc;
  }, {});

  const rows = phones.map((phone) => {
    const entity = entityById.get(phone.entity_id);
    const client = entity ? clientById.get(entity.client_id) : null;
    const logs   = logsByPhone[phone.id] || [];
    return { phone, entity, client, logs };
  });

  return rows.filter(({ phone, entity, client }) => {
    if (filters.clientId           && entity?.client_id           !== filters.clientId)           return false;
    if (filters.verificationStatus && phone.verification_status   !== filters.verificationStatus) return false;
    if (filters.ingestionSource    && phone.ingestion_source      !== filters.ingestionSource)    return false;
    if (filters.classificationType && phone.classification_type   !== filters.classificationType) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      const hay = [
        phone.phone_number,
        String(phone.entity_id),
        client?.name || '',
        client?.id   || '',
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export default function PhoneTable({ selectedId, onSelect }) {
  const { phones, entities, clients, actionLogs } = useMockData();
  const { phoneFilters } = useUI();

  const rows = useMemo(
    () => applyFilters(phones, entities, clients, actionLogs, phoneFilters),
    [phones, entities, clients, actionLogs, phoneFilters]
  );

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[180px]" />  {/* Phone + classification */}
          <col className="w-[200px]" />  {/* Association          */}
          <col className="w-[160px]" />  {/* Verification         */}
          <col />                        {/* Action pipeline      */}
          <col className="w-[140px]" />  {/* Last updated         */}
        </colgroup>
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>Phone / Type</Th>
            <Th>Association</Th>
            <Th>Verification</Th>
            <Th>Recent Actions</Th>
            <Th>Updated</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                No phones match the current filters.
              </td>
            </tr>
          ) : (
            rows.map(({ phone, entity, client, logs }) => (
              <PhoneRow
                key={phone.id}
                phone={phone}
                entity={entity}
                client={client}
                logs={logs}
                isSelected={selectedId === phone.id}
                onSelect={onSelect}
              />
            ))
          )}
        </tbody>
      </table>

      <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
        Showing {rows.length} of {phones.length} phone{phones.length === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
      {children}
    </th>
  );
}
