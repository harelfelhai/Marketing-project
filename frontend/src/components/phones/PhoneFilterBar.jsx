/**
 * PhoneFilterBar — controls bound to UIContext.phoneFilters.
 *
 * Filter state lives in UIContext so values survive tab navigation
 * (operators jump between screens constantly). The bar is purely a
 * presentation/binding layer; the actual filtering happens in PhoneTable.
 */

import { Search, X } from 'lucide-react';

import { useUI }       from '../../contexts/UIContext';
import { useMockData } from '../../contexts/MockDataContext';
import { CLASSIFICATION_TYPES } from '../../mock/mockData';

const VERIFICATION_OPTIONS = [
  { value: '',              label: 'All statuses' },
  { value: 'pending',       label: 'Pending' },
  { value: 'verified_good', label: 'Verified Good' },
  { value: 'verified_bad',  label: 'Verified Bad' },
];

const SOURCE_OPTIONS = [
  { value: '',              label: 'All sources' },
  { value: 'api',           label: 'API' },
  { value: 'manual',        label: 'Manual' },
  { value: 'import',        label: 'Import' },
  { value: 'partner_feed',  label: 'Partner Feed' },
];

export default function PhoneFilterBar() {
  const { clients } = useMockData();
  const { phoneFilters, updatePhoneFilters, resetPhoneFilters } = useUI();

  const hasAny =
    phoneFilters.clientId           ||
    phoneFilters.verificationStatus ||
    phoneFilters.ingestionSource    ||
    phoneFilters.classificationType ||
    phoneFilters.search;

  const selectClass =
    'h-9 px-3 pr-8 text-sm rounded-md border border-slate-300 bg-white text-slate-800 ' +
    'focus:outline-none focus:ring-2 focus:ring-slate-300 min-w-0';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative grow min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={phoneFilters.search}
          onChange={(e) => updatePhoneFilters({ search: e.target.value })}
          placeholder="Search phone, entity ID, or client name…"
          className="w-full h-9 pl-8 pr-3 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>

      {/* Client */}
      <select
        value={phoneFilters.clientId}
        onChange={(e) => updatePhoneFilters({ clientId: e.target.value })}
        className={selectClass}
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Verification Status */}
      <select
        value={phoneFilters.verificationStatus}
        onChange={(e) => updatePhoneFilters({ verificationStatus: e.target.value })}
        className={selectClass}
      >
        {VERIFICATION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Source */}
      <select
        value={phoneFilters.ingestionSource}
        onChange={(e) => updatePhoneFilters({ ingestionSource: e.target.value })}
        className={selectClass}
      >
        {SOURCE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Classification Type */}
      <select
        value={phoneFilters.classificationType}
        onChange={(e) => updatePhoneFilters({ classificationType: e.target.value })}
        className={selectClass}
      >
        <option value="">All classifications</option>
        {CLASSIFICATION_TYPES.map((t) => (
          <option key={t} value={t}>{t.toUpperCase()}</option>
        ))}
      </select>

      {/* Reset */}
      {hasAny && (
        <button
          type="button"
          onClick={resetPhoneFilters}
          className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
