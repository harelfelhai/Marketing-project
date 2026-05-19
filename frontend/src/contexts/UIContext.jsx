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
  clientId:           '',
  verificationStatus: '',
  ingestionSource:    '',
  classificationType: '',
  search:             '',
  // Phase DY — table sort order. 'priority' (default) shows the
  // prioritised review queue with NULLS LAST + id tiebreaker;
  // 'ingested_at' preserves the legacy chronological view.
  sortBy:             'priority',
};

// Phase DX — Operations Queue filter shape; mirrors TaskFilterBar controls.
// `phoneId`, `clientId`, `openOnly` have no dedicated UI control — they are
// seeded from URL params (cross-links from PhoneDetailDrawer / ClientCard)
// and cleared via the reset button. Surfaced visually as chips in
// TaskFilterBar.
const DEFAULT_TASK_FILTERS = {
  status:   '',
  taskType: '',
  search:   '',
  phoneId:  null,
  clientId: null,
  openOnly: false,
};

export function UIProvider({ children }) {
  // -------------------------------------------------------------------------
  // Ingestion modal
  // -------------------------------------------------------------------------
  const [isIngestionModalOpen, setIsIngestionModalOpen] = useState(false);
  const openIngestionModal  = useCallback(() => setIsIngestionModalOpen(true), []);
  const closeIngestionModal = useCallback(() => setIsIngestionModalOpen(false), []);

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
  // first navigation to /phones?client_id=X without overwriting other filters.
  const seedClientFilter = useCallback((clientId) => {
    setPhoneFilters((prev) => ({ ...prev, clientId: clientId || '' }));
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

  // Seed the client_id filter from a URL param (cross-link from ClientCard).
  const seedTaskClientFilter = useCallback((clientId) => {
    setTaskFilters((prev) => ({
      ...prev,
      clientId: clientId == null || clientId === '' ? null : clientId,
    }));
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
    // Modal
    isIngestionModalOpen,
    openIngestionModal,
    closeIngestionModal,
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
