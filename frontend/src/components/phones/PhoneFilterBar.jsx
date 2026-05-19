/**
 * PhoneFilterBar — controls bound to UIContext.phoneFilters.
 *
 * Filter state lives in UIContext so values survive tab navigation.
 * Search icon is right-anchored (RTL: start-side = right).
 */

import { Search, X } from 'lucide-react';

import { useUI }       from '../../contexts/UIContext';
import { useMockData } from '../../contexts/MockDataContext';
import { CLASSIFICATION_TYPES } from '../../mock/mockData';
import {
  FILTER_SEARCH_PLACEHOLDER, FILTER_ALL_CLIENTS, FILTER_ALL_STATUSES,
  FILTER_STATUS_PENDING, FILTER_STATUS_GOOD, FILTER_STATUS_BAD,
  FILTER_ALL_SOURCES, FILTER_SOURCE_API, FILTER_SOURCE_MANUAL,
  FILTER_SOURCE_IMPORT, FILTER_SOURCE_PARTNER, FILTER_ALL_CLASSIFICATIONS,
  FILTER_BTN_CLEAR,
  FILTER_SORT_LABEL_PRIORITY, FILTER_SORT_LABEL_INGESTED_AT,
} from '../../config/strings.he';

const SORT_OPTIONS = [
  { value: 'priority',     label: FILTER_SORT_LABEL_PRIORITY },
  { value: 'ingested_at',  label: FILTER_SORT_LABEL_INGESTED_AT },
];

const VERIFICATION_OPTIONS = [
  { value: '',              label: FILTER_ALL_STATUSES },
  { value: 'pending',       label: FILTER_STATUS_PENDING },
  { value: 'verified_good', label: FILTER_STATUS_GOOD },
  { value: 'verified_bad',  label: FILTER_STATUS_BAD },
];

const SOURCE_OPTIONS = [
  { value: '',              label: FILTER_ALL_SOURCES },
  { value: 'api',           label: FILTER_SOURCE_API },
  { value: 'manual',        label: FILTER_SOURCE_MANUAL },
  { value: 'import',        label: FILTER_SOURCE_IMPORT },
  { value: 'partner_feed',  label: FILTER_SOURCE_PARTNER },
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
    'h-9 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-800 ' +
    'focus:outline-none focus:ring-2 focus:ring-slate-300 min-w-0';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
      {/* Search — icon on the right (RTL start side) */}
      <div className="relative grow min-w-[200px]">
        <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={phoneFilters.search}
          onChange={(e) => updatePhoneFilters({ search: e.target.value })}
          placeholder={FILTER_SEARCH_PLACEHOLDER}
          className="w-full h-9 pr-8 ps-3 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>

      {/* Client */}
      <select
        value={phoneFilters.clientId}
        onChange={(e) => updatePhoneFilters({ clientId: e.target.value })}
        className={selectClass}
      >
        <option value="">{FILTER_ALL_CLIENTS}</option>
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
        <option value="">{FILTER_ALL_CLASSIFICATIONS}</option>
        {CLASSIFICATION_TYPES.map((t) => (
          <option key={t} value={t}>{t.toUpperCase()}</option>
        ))}
      </select>

      {/* Sort (Phase DY-3) */}
      <select
        value={phoneFilters.sortBy || 'priority'}
        onChange={(e) => updatePhoneFilters({ sortBy: e.target.value })}
        className={selectClass}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
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
          {FILTER_BTN_CLEAR}
        </button>
      )}
    </div>
  );
}
