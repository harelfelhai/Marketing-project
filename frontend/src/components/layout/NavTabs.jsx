/**
 * NavTabs — four primary navigation tabs.
 *
 * Uses NavLink so the active path automatically gets the `active` styling
 * via the className callback. Tab labels are kept generic.
 * // HOOK FOR ENTERPRISE LABELS
 */

import { NavLink } from 'react-router-dom';
import { LayoutGrid, Phone, Activity, ClipboardList, BarChart3, Users, Settings } from 'lucide-react';
import { useAuth } from '../../contexts/MockAuthContext';
import {
  NAV_CLIENT_HUB, NAV_PHONE_GRID, NAV_SYSTEM_OPS, NAV_OPERATIONS, NAV_DASHBOARD,
  NAV_ENTITIES, NAV_DATA_ADMIN,
} from '../../config/strings.he';

const TABS = [
  { to: '/',           label: NAV_CLIENT_HUB, icon: LayoutGrid },
  { to: '/entities',   label: NAV_ENTITIES,   icon: Users },
  { to: '/phones',     label: NAV_PHONE_GRID, icon: Phone },
  { to: '/ops',        label: NAV_SYSTEM_OPS, icon: Activity },
  { to: '/operations', label: NAV_OPERATIONS, icon: ClipboardList },
  { to: '/dashboard',  label: NAV_DASHBOARD,  icon: BarChart3 },
  { to: '/admin',      label: NAV_DATA_ADMIN, icon: Settings, adminOnly: true },
];

const baseClasses   = 'inline-flex items-center gap-2 h-14 px-3 text-sm font-medium border-b-2 transition-colors';
const activeClasses = 'border-slate-900 text-slate-900';
const idleClasses   = 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300';

export default function NavTabs() {
  // useAuth lives one component away; importing here keeps NavTabs
  // role-aware without prop drilling. AdminOnly tabs are hidden for
  // non-admins (route still 403s via RequireRole if reached directly).
  const { operatorRole } = useAuth();
  const visibleTabs = TABS.filter(
    (t) => !t.adminOnly || operatorRole === 'admin',
  );
  return (
    <nav className="flex items-center gap-1">
      {visibleTabs.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `${baseClasses} ${isActive ? activeClasses : idleClasses}`
          }
        >
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
