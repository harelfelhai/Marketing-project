/**
 * App.jsx — Top-level layout and route table.
 *
 * Renders the AppShell (header + nav + content slot) and wires the five
 * primary routes via React Router v6. Portal-mounted globals (ToastStack,
 * IngestionModal) are mounted here once so they survive all route changes.
 */

import { Routes, Route } from 'react-router-dom';

import AppShell             from './components/layout/AppShell';
import ToastStack           from './components/primitives/Toast';
import IngestionModal       from './components/ingestion/IngestionModal';
import EntityIngestionModal from './components/entityIngestion/EntityIngestionModal';

import ClientHubPage       from './pages/ClientHubPage';
import PhoneGridPage       from './pages/PhoneGridPage';
import SystemOpsPage       from './pages/SystemOpsPage';
import DashboardPage       from './pages/DashboardPage';
import OperationsQueuePage from './pages/OperationsQueuePage';

export default function App() {
  return (
    <>
      <AppShell>
        <Routes>
          <Route path="/"           element={<ClientHubPage />} />
          <Route path="/phones"     element={<PhoneGridPage />} />
          <Route path="/ops"        element={<SystemOpsPage />} />
          <Route path="/operations" element={<OperationsQueuePage />} />
          <Route path="/dashboard"  element={<DashboardPage />} />
          {/* Fallback — any unknown path returns to Client Hub. */}
          <Route path="*"           element={<ClientHubPage />} />
        </Routes>
      </AppShell>

      {/* Global portals — rendered outside AppShell to overlay all content. */}
      <IngestionModal />
      <EntityIngestionModal />
      <ToastStack />
    </>
  );
}
