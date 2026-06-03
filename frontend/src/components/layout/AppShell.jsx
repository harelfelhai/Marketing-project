/**
 * AppShell — top-level chrome: header bar, nav tabs, content slot.
 *
 * Header right-cluster components (left to right in RTL):
 *   - HeaderActions ("+ Add Person", "+ Ingest")
 *   - PersonalizationToggle — Phase AUTH-C global "Show my / Show all"
 *     chip. Visible only when the operator is authenticated (logged-in
 *     regular OR admin). Hidden for guest mode (no personalization
 *     context to toggle).
 *   - Operator chip (avatar + username) + Logout link
 *
 * ms-auto is used (logical property) so the right cluster pushes to the
 * inline-end edge in both LTR and RTL layouts.
 */

import { Activity, Filter, Globe, LogOut, SlidersHorizontal } from 'lucide-react';
import { Link as RouterLink, NavLink } from 'react-router-dom';

import NavTabs       from './NavTabs';
import HeaderActions from './HeaderActions';
import RequireRole   from '../primitives/RequireRole';
import { useAuth }   from '../../contexts/MockAuthContext';
import { useUI }     from '../../contexts/UIContext';
import {
  APP_NAME, ROLE_TITLE,
  AUTH_HEADER_GUEST_BADGE, AUTH_HEADER_LOGOUT,
  AUTH_TOAST_LOGOUT, NAV_SYSTEM_SETTINGS,
} from '../../config/strings.he';


export default function AppShell({ children }) {
  const { status, operatorId, operatorRole, user, logout, exitGuest } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center gap-8">
          {/* Branding — // HOOK FOR ENTERPRISE LABELS */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-md bg-slate-900 text-white flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
            <span className="font-semibold text-slate-900 tracking-tight">
              {APP_NAME}
            </span>
          </div>

          {/* Tabs */}
          <NavTabs />

          {/* End cluster — ms-auto pushes to the inline-end edge. */}
          <div className="ms-auto flex items-center gap-3">
            <HeaderActions />

            {/* System Settings — admin-only, deliberately separated from the
                primary NavTabs (it's infrastructure config, not part of the
                normal operator workflow). */}
            <RequireRole role="admin">
              <NavLink
                to="/system"
                data-testid="nav-system-settings"
                title={NAV_SYSTEM_SETTINGS}
                aria-label={NAV_SYSTEM_SETTINGS}
                className={({ isActive }) =>
                  `inline-flex items-center justify-center w-9 h-9 rounded-md border transition-colors ${
                    isActive
                      ? 'border-slate-900 text-slate-900 bg-slate-50'
                      : 'border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300'
                  }`
                }
              >
                <SlidersHorizontal className="w-4 h-4" />
              </NavLink>
            </RequireRole>

            {/* Phase AUTH-C — personalization toggle. Visible only to
                authenticated operators with at least one managed
                client; guests have nothing to personalize. */}
            {status === 'authenticated'
              && (user?.managed_client_ids?.length || 0) > 0
              && <PersonalizationToggle />
            }

            {/* Operator chip + logout (or just guest badge) */}
            <OperatorChip
              status={status}
              operatorId={operatorId}
              operatorRole={operatorRole}
              displayName={user?.display_name}
              onLogout={logout}
              onExitGuest={exitGuest}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-6 py-6">
        {children}
      </main>
    </div>
  );
}


/* ===========================================================================
 * Personalization toggle chip
 * ========================================================================= */


function PersonalizationToggle() {
  const { personalizationActive, togglePersonalization } = useAuth();
  const label = personalizationActive
    ? 'מציג: הנתונים שלי'
    : 'מציג: כל המערכת';
  const Icon = personalizationActive ? Filter : Globe;
  return (
    <button
      type="button"
      onClick={togglePersonalization}
      data-testid="personalization-toggle"
      aria-pressed={personalizationActive}
      className={[
        'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm transition-colors',
        personalizationActive
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
      ].join(' ')}
      title={label}
    >
      <Icon className="w-4 h-4" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}


/* ===========================================================================
 * Operator chip — username + role tooltip + logout (or guest badge)
 * ========================================================================= */


function OperatorChip({ status, operatorId, operatorRole, displayName, onLogout, onExitGuest }) {
  const { pushToast } = useUI();

  const handleLogout = async () => {
    try {
      await onLogout();
      pushToast({ variant: 'success', message: AUTH_TOAST_LOGOUT });
    } catch (err) {
      // Logout is idempotent server-side; nothing useful to surface.
    }
  };

  // Guest mode — small static badge + exit-to-login link. Guests have
  // no server session so there's nothing to terminate; the click just
  // clears the localStorage guestMode flag and flips status back to
  // 'unauthenticated' so the route gate redirects to /login.
  if (status === 'guest') {
    return (
      <div
        className="inline-flex items-center gap-2 ps-3 border-s border-slate-200 text-xs text-slate-500"
        data-testid="auth-guest-badge"
      >
        <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-semibold">
          ?
        </div>
        <span>{AUTH_HEADER_GUEST_BADGE}</span>
        <button
          type="button"
          onClick={onExitGuest}
          data-testid="auth-exit-guest-btn"
          aria-label={AUTH_HEADER_LOGOUT}
          className="ms-1 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Authenticated — avatar + name (links to /profile) + logout.
  const initials = (displayName || operatorId || '??').slice(0, 2).toUpperCase();
  return (
    <div className="inline-flex items-center gap-2 ps-3 border-s border-slate-200">
      <RouterLink
        to="/profile"
        title="פרופיל"
        data-testid="auth-profile-link"
        className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <div
          className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center"
        >
          {initials}
        </div>
        <span className="text-xs text-slate-600 truncate max-w-[120px]" title={ROLE_TITLE(operatorRole)}>
          {displayName || operatorId}
        </span>
      </RouterLink>
      <button
        type="button"
        onClick={handleLogout}
        data-testid="auth-logout-btn"
        aria-label={AUTH_HEADER_LOGOUT}
        className="ms-1 text-slate-400 hover:text-slate-700 transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
