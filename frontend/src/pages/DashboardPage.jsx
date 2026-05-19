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
import Skeleton       from '../components/primitives/Skeleton';
import { useMockData } from '../contexts/MockDataContext';
import { PAGE_DASHBOARD_TITLE, PAGE_DASHBOARD_SUB } from '../config/strings.he';

export default function DashboardPage() {
  const { loading } = useMockData();

  return (
    <section className="space-y-6" aria-busy={loading || undefined}>
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{PAGE_DASHBOARD_TITLE}</h1>
        <p className="text-sm text-slate-500 mt-1">{PAGE_DASHBOARD_SUB}</p>
      </header>

      {loading ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ChartTileSkeleton />
            <ChartTileSkeleton />
          </div>
          <FunnelTileSkeleton />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ThroughputBars />
            <SlaIndicator />
          </div>
          <QualityFunnel />
        </>
      )}
    </section>
  );
}

function ChartTileSkeleton() {
  return (
    <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
      <Skeleton height={14} width="40%" />
      <Skeleton height={10} width="60%" />
      <div className="flex items-end gap-1 pt-2" style={{ height: '120px' }}>
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex-1 flex items-end">
            <Skeleton height={`${30 + ((i * 13) % 60)}%`} width="100%" rounded="rounded-t-sm" />
          </div>
        ))}
      </div>
    </section>
  );
}

function FunnelTileSkeleton() {
  return (
    <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
      <Skeleton height={14} width="30%" />
      <Skeleton height={10} width="50%" />
      <div className="space-y-3 pt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-baseline justify-between">
              <Skeleton height={10} width={80} />
              <Skeleton height={10} width={40} />
            </div>
            <Skeleton height={8} width="100%" rounded="rounded-full" />
          </div>
        ))}
      </div>
    </section>
  );
}
