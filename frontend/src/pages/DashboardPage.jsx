/**
 * DashboardPage — throughput bars, quality funnel, and SLA indicator.
 *
 * All three components derive data directly from MockDataContext — no
 * separate API calls needed. getDashboardMetrics() exists in the API layer
 * for the real-backend cutover; here we skip the extra delay and read live.
 */

import ThroughputBars from '../components/dashboard/ThroughputBars';
import QualityFunnel  from '../components/dashboard/QualityFunnel';
import SlaIndicator   from '../components/dashboard/SlaIndicator';
import { PAGE_DASHBOARD_TITLE, PAGE_DASHBOARD_SUB } from '../config/strings.he';

export default function DashboardPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{PAGE_DASHBOARD_TITLE}</h1>
        <p className="text-sm text-slate-500 mt-1">{PAGE_DASHBOARD_SUB}</p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ThroughputBars />
        <SlaIndicator />
      </div>

      <QualityFunnel />
    </section>
  );
}
