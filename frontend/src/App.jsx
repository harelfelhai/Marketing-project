/**
 * App.jsx — Top-level layout, auth gate, and route table.
 *
 * Renders the AppShell (header + nav + content slot) and wires the
 * primary routes via React Router v6. Portal-mounted globals
 * (ToastStack, IngestionModal) are mounted here once so they
 * survive all route changes.
 *
 * PHASE AUTH GATE
 * ---------------
 * Top-level routing branches on AuthContext.status:
 *
 *   loading          → render a small splash (avoid flash-of-login
 *                       during the on-mount /auth/me hydrate)
 *   unauthenticated  → only /login + /register are routable;
 *                       anything else redirects to /login with the
 *                       attempted path stashed in router state.from
 *   guest            → full app, no protected-route gating; the
 *                       Task Center page itself enforces its own
 *                       RequireRole guard inside the page
 *   authenticated    → full app; admin OR regular role
 *
 * The login + register pages render WITHOUT the AppShell (header,
 * nav etc.) so they look like a proper auth landing rather than a
 * dressed-up internal page.
 */

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import AppShell             from './components/layout/AppShell';
import ToastStack           from './components/primitives/Toast';
import IngestionModal       from './components/ingestion/IngestionModal';
import EntityIngestionModal from './components/entityIngestion/EntityIngestionModal';

import ClientHubPage       from './pages/ClientHubPage';
import PhoneGridPage       from './pages/PhoneGridPage';
import SystemOpsPage       from './pages/SystemOpsPage';
import DashboardPage       from './pages/DashboardPage';
import OperationsQueuePage from './pages/OperationsQueuePage';
import EntitiesPage        from './pages/EntitiesPage';
import DataAdminPage       from './pages/DataAdminPage';
import SystemSettingsPage  from './pages/SystemSettingsPage';
import ProfilePage         from './pages/ProfilePage';
import LoginPage           from './pages/LoginPage';
import RegisterPage        from './pages/RegisterPage';
import RequireRole         from './components/primitives/RequireRole';

import { useAuth } from './contexts/MockAuthContext';


export default function App() {
  const { status } = useAuth();

  // Hydrate gap — show a centered spinner instead of flashing the
  // login page for the ~100ms /auth/me round-trip.
  if (status === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </main>
    );
  }

  // Unauthenticated — only /login and /register are routable.
  if (status === 'unauthenticated') {
    return (
      <>
        <Routes>
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* Anything else → /login, remembering the attempted path. */}
          <Route path="*"         element={<RememberAndRedirect to="/login" />} />
        </Routes>
        <ToastStack />
      </>
    );
  }

  // status === 'guest' or 'authenticated' — full app routes.
  return (
    <>
      <Routes>
        {/* /login + /register remain navigable so authenticated
            operators can log out + re-log-in without forcing a full
            navigation reset. The pages themselves redirect onward
            if status is already past the gate. */}
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {/* Everything else lives inside the AppShell. */}
        <Route path="/*" element={
          <AppShell>
            <Routes>
              <Route path="/"           element={<ClientHubPage />} />
              <Route path="/entities"   element={<EntitiesPage />} />
              <Route path="/phones"     element={<PhoneGridPage />} />
              <Route path="/ops"        element={<SystemOpsPage />} />
              <Route path="/operations" element={<OperationsQueuePage />} />
              <Route path="/dashboard"  element={<DashboardPage />} />
              <Route path="/admin"      element={<DataAdminPage />} />
              <Route path="/system"     element={
                <RequireRole role="admin" fallback={<Navigate to="/" replace />}>
                  <SystemSettingsPage />
                </RequireRole>
              } />
              <Route path="/profile"    element={<ProfilePage />} />
              <Route path="*"           element={<ClientHubPage />} />
            </Routes>
          </AppShell>
        } />
      </Routes>

      {/* Global portals — rendered outside the Routes so they overlay
          all content regardless of which route is active. */}
      <IngestionModal />
      <EntityIngestionModal />
      <ToastStack />
    </>
  );
}


/**
 * Helper — redirects the unauthenticated visitor to /login while
 * stashing the original target in router state so the LoginPage
 * can route them back after a successful auth.
 */
function RememberAndRedirect({ to }) {
  const location = useLocation();
  return (
    <Navigate
      to={to}
      replace
      state={{ from: location.pathname + location.search }}
    />
  );
}
