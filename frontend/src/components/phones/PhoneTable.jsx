/**
 * PhoneTable — filtered table over the live MockDataContext state.
 *
 * Uses table-fixed with explicit colgroup widths. Filter application is
 * a useMemo derivation; the source of truth stays in context so
 * mutations propagate instantly.
 */

import { useMemo } from 'react';

import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import PhoneRow        from './PhoneRow';
import Skeleton        from '../primitives/Skeleton';
import {
  TABLE_HEADER_PHONE, TABLE_HEADER_ASSOCIATION, TABLE_HEADER_VERIFICATION,
  TABLE_HEADER_ACTIONS, TABLE_HEADER_UPDATED, TABLE_EMPTY_PHONES, TABLE_SHOWING,
} from '../../config/strings.he';

const SKELETON_ROW_COUNT = 8;

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
  const { phones, entities, clients, actionLogs, loading } = useMockData();
  const { phoneFilters } = useUI();

  const rows = useMemo(
    () => applyFilters(phones, entities, clients, actionLogs, phoneFilters),
    [phones, entities, clients, actionLogs, phoneFilters]
  );

  return (
    <div className="bg-white rounded-lg border border-slate-200" aria-busy={loading || undefined}>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[180px]" />
          <col className="w-[200px]" />
          <col className="w-[160px]" />
          <col />
          <col className="w-[140px]" />
        </colgroup>
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>{TABLE_HEADER_PHONE}</Th>
            <Th>{TABLE_HEADER_ASSOCIATION}</Th>
            <Th>{TABLE_HEADER_VERIFICATION}</Th>
            <Th>{TABLE_HEADER_ACTIONS}</Th>
            <Th>{TABLE_HEADER_UPDATED}</Th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <SkeletonRow key={i} />
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                {TABLE_EMPTY_PHONES}
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
        {loading ? ' ' : TABLE_SHOWING(rows.length, phones.length)}
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={12} width="80%" />
          <Skeleton height={10} width="50%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={12} width="70%" />
          <Skeleton height={10} width="40%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={14} width={80} rounded="rounded-full" />
          <Skeleton height={10} width="55%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Skeleton height={20} width={20} rounded="rounded-full" />
          <Skeleton height={20} width={20} rounded="rounded-full" />
          <Skeleton height={20} width={20} rounded="rounded-full" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Skeleton height={10} width="80%" />
      </td>
    </tr>
  );
}

function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-start text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
      {children}
    </th>
  );
}
