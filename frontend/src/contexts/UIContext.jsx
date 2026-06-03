/**
 * UIContext — modal visibility, toast queue, and persistent phone filter state.
 *
 * Filter state for the Phone Grid lives here (not local to PhoneGridPage) so
 * that operators navigating between tabs return to the exact filters they left.
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const UIContext = createContext(null);

// Default filter shape — mirrors PhoneFilterBar controls.
const DEFAULT_FILTERS = {
  rootEntityId:           '',
  verificationStatus: '',
  ingestionSource:    '',
  phoneType:          '',
  search:             '',
  entityName:         '',
  relationType:       '',
  sortBy:             'score',
};

// Phase DX — Operations Queue filter shape; mirrors TaskFilterBar controls.
// `phoneId`, `rootEntityId`, `openOnly` have no dedicated UI control — they are
// seeded from URL params (cross-links from PhoneDetailDrawer / ClientCard)
// and cleared via the reset button. Surfaced visually as chips in
// TaskFilterBar.
const DEFAULT_TASK_FILTERS = {
  status:   '',
  taskType: '',
  search:   '',
  phoneId:  null,
  rootEntityId: null,
  openOnly: false,
  // Task Center default-hide for resolved/rejected rows. ON by default
  // so managers land on an "action required now" view; flipping the
  // toggle in TaskFilterBar brings the historical rows back for audit.
  // Honored both client-side (TaskTable.applyFilters) and server-side
  // (`?exclude_terminal=true` on GET /tasks when no explicit status
  // filter is set).
  hideResolved: true,
};

export function UIProvider({ children }) {
  // -------------------------------------------------------------------------
  // Ingestion modal (phone-centric — Phase E1)
  // -------------------------------------------------------------------------
  const [isIngestionModalOpen, setIsIngestionModalOpen] = useState(false);

  // Phase E2-C — cross-modal handoff preset. When the entity-success
  // panel fires "Add a phone for this person", it stashes the new
  // entity's context here and opens the phone modal. The phone modal's
  // SingleIngestionPanel reads this on mount, pre-fills the matching
  // form fields, then clears it. Shape:
  //   { entityType: string, targetEntityId: number, rootEntityId: number }
  // Null means "no preset; render blank form".
  const [phoneIngestionPreset, setPhoneIngestionPreset] = useState(null);

  const openIngestionModal  = useCallback(() => setIsIngestionModalOpen(true), []);
  const closeIngestionModal = useCallback(() => {
    setIsIngestionModalOpen(false);
    // Clear the preset on close so the NEXT open (without a handoff)
    // starts from a blank form.
    setPhoneIngestionPreset(null);
  }, []);

  // -------------------------------------------------------------------------
  // Entity ingestion modal (entity-centric — Phase E2)
  // -------------------------------------------------------------------------
  const [isEntityIngestionModalOpen, setIsEntityIngestionModalOpen] = useState(false);
  const openEntityIngestionModal  = useCallback(
    () => setIsEntityIngestionModalOpen(true),
    [],
  );
  const closeEntityIngestionModal = useCallback(
    () => setIsEntityIngestionModalOpen(false),
    [],
  );

  // -------------------------------------------------------------------------
  // Phase E2-C — Friction-free handoff. The entity-success CTA calls this
  // to close the entity modal AND open the phone modal with the new
  // entity's context pre-filled. The phone modal reads `phoneIngestionPreset`
  // on mount and clears it on close.
  // -------------------------------------------------------------------------
  const openPhoneIngestionWithPreset = useCallback((preset) => {
    setPhoneIngestionPreset(preset);
    setIsEntityIngestionModalOpen(false);
    setIsIngestionModalOpen(true);
  }, []);

  // -------------------------------------------------------------------------
  // Persistent phone grid filters — survive tab navigation.
  // -------------------------------------------------------------------------
  const [phoneFilters, setPhoneFilters] = useState(DEFAULT_FILTERS);

  const updatePhoneFilters = useCallback((partial) => {
    setPhoneFilters((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetPhoneFilters = useCallback(() => {
    setPhoneFilters(DEFAULT_FILTERS);
  }, []);

  // Convenience setter for seeding the client filter from a URL param on
  // first navigation to /phones?root_entity_id=X without overwriting other filters.
  const seedClientFilter = useCallback((rootEntityId) => {
    setPhoneFilters((prev) => ({ ...prev, rootEntityId: rootEntityId || '' }));
  }, []);

  // -------------------------------------------------------------------------
  // Persistent Operations Queue filters (Phase DX) — survive tab navigation.
  // -------------------------------------------------------------------------
  const [taskFilters, setTaskFilters] = useState(DEFAULT_TASK_FILTERS);

  const updateTaskFilters = useCallback((partial) => {
    setTaskFilters((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetTaskFilters = useCallback(() => {
    setTaskFilters(DEFAULT_TASK_FILTERS);
  }, []);

  // Seed the phone_id filter from a URL param (no-op for null/empty values).
  // Same pattern as seedClientFilter on phoneFilters.
  const seedTaskPhoneFilter = useCallback((phoneId) => {
    setTaskFilters((prev) => ({
      ...prev,
      phoneId: phoneId == null || phoneId === '' ? null : phoneId,
    }));
  }, []);

  // Seed the root_entity_id filter from a URL param (cross-link from ClientCard).
  const seedTaskClientFilter = useCallback((rootEntityId) => {
    setTaskFilters((prev) => ({
      ...prev,
      rootEntityId: rootEntityId == null || rootEntityId === '' ? null : rootEntityId,
    }));
  }, []);

  // -------------------------------------------------------------------------
  // Admin-defined custom filter values, keyed by surface id
  // ('phones' | 'operations' | 'entities'). Kept separate from the fixed-shape
  // built-in filter objects above so arbitrary admin-defined keys can never
  // collide with a built-in key. Each surface maps { customFilterKey: value }.
  // Survives tab navigation, exactly like the built-in filters.
  // -------------------------------------------------------------------------
  const [customFilterValues, setCustomFilterValues] = useState({});

  const updateCustomFilterValues = useCallback((surface, partial) => {
    setCustomFilterValues((prev) => ({
      ...prev,
      [surface]: { ...(prev[surface] || {}), ...partial },
    }));
  }, []);

  const resetCustomFilterValues = useCallback((surface) => {
    setCustomFilterValues((prev) => ({ ...prev, [surface]: {} }));
  }, []);

  // -------------------------------------------------------------------------
  // Toast queue
  // -------------------------------------------------------------------------
  const toastIdRef = useRef(0);
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback(({ variant = 'success', message }) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, variant, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = {
    // Phone ingestion modal (Phase E1)
    isIngestionModalOpen,
    openIngestionModal,
    closeIngestionModal,
    phoneIngestionPreset,
    // Entity ingestion modal (Phase E2)
    isEntityIngestionModalOpen,
    openEntityIngestionModal,
    closeEntityIngestionModal,
    openPhoneIngestionWithPreset,
    // Phone filters
    phoneFilters,
    updatePhoneFilters,
    resetPhoneFilters,
    seedClientFilter,
    // Task filters (Phase DX)
    taskFilters,
    updateTaskFilters,
    resetTaskFilters,
    seedTaskPhoneFilter,
    seedTaskClientFilter,
    // Custom (admin-defined) filter values, per surface
    customFilterValues,
    updateCustomFilterValues,
    resetCustomFilterValues,
    // Toasts
    toasts,
    pushToast,
    dismissToast,
  };

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
