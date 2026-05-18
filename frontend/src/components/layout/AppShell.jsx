/**
 * AppShell — top-level chrome: header bar, nav tabs, and content slot.
 *
 * ms-auto is used (logical property) so the right cluster pushes to the
 * inline-end edge in both LTR and RTL layouts.
 * The operator chip uses ps-4 / border-s for the same reason.
 *
 * // HOOK FOR ENTERPRISE AUTH: swap operator chip to real user dropdown.
 */

import { Activity } from 'lucide-react';

import NavTabs       from './NavTabs';
import HeaderActions from './HeaderActions';
import { useAuth }   from '../../contexts/MockAuthContext';
import { APP_NAME, ROLE_TITLE } from '../../config/strings.he';

export default function AppShell({ children }) {
  const { operatorId, operatorRole } = useAuth();

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

          {/* End cluster: actions + operator chip — ms-auto pushes to inline-end */}
          <div className="ms-auto flex items-center gap-4">
            <HeaderActions />
            <div
              className="flex items-center gap-2 ps-4 border-s border-slate-200"
              title={ROLE_TITLE(operatorRole)}
            >
              <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center">
                {operatorId.slice(-2).toUpperCase()}
              </div>
              <span className="text-xs text-slate-600 truncate max-w-[120px]">
                {operatorId}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-6 py-6">
        {children}
      </main>
    </div>
  );
}
