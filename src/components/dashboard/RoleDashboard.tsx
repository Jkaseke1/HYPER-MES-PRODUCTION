import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LayoutDashboard, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { dashboardModulesForRole, type DashboardModule } from '../../lib/dashboardAccess';
import type { MesRole } from '../../lib/roleAccess';

type Summary = { module: DashboardModule; count: number | null; pending: number | null; failed: boolean };

export default function RoleDashboard({ role }: { role: MesRole }) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSummaries([]);
    setUpdated(null);
    const modules = dashboardModulesForRole(role);
    void Promise.all(modules.map(async module => {
      // Count only visible rows. No prices, personal data or write operations.
      try {
        let query = supabase.from(module.table).select('id', { count: 'exact', head: true });
        if (module.statuses) query = query.in('status', module.statuses);
        const total = await query;
        const pending = module.pending
          ? await supabase.from(module.table).select('id', { count: 'exact', head: true }).in('status', module.pending)
          : null;
        return { module, count: total.error ? null : total.count, pending: pending?.error ? null : pending?.count ?? null, failed: !!total.error || !!pending?.error };
      } catch {
        return { module, count: null, pending: null, failed: true };
      }
    })).then(results => {
      if (cancelled) return;
      setSummaries(results);
      setUpdated(new Date());
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [role, refresh]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-6 w-6 text-teal-600" />
          <div><h1 className="text-xl font-semibold text-slate-900">Dashboard</h1><p className="text-sm text-slate-500">Operational summary</p></div>
        </div>
        <div className="flex items-center gap-3">
          {updated && <span className="text-xs text-slate-500">Updated {updated.toLocaleTimeString()}</span>}
          <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading} aria-label="Refresh dashboard" title="Refresh dashboard" className="rounded-md border border-slate-200 p-2 text-teal-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </header>
      {loading ? <p role="status" className="text-sm text-slate-500">Loading summary...</p> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {summaries.map(({ module, count, pending, failed }) => (
            <section key={module.path} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-700">{module.label}</h2>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <p className="text-3xl font-semibold tabular-nums text-slate-900">{count === null ? 'Unavailable' : count.toLocaleString()}</p>
                {pending !== null && <span className="text-sm text-amber-700">Open: {pending.toLocaleString()}</span>}
              </div>
              {failed && <p role="status" className="mt-2 text-xs text-amber-700">Summary could not be fully loaded.</p>}
              <Link to={module.path} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-teal-700">View {module.label.toLowerCase()}<ArrowRight className="h-4 w-4" /></Link>
            </section>
          ))}
        </div>
      )}
      {!loading && summaries.length === 0 && <p className="text-sm text-slate-500">No operational modules are assigned to your account.</p>}
    </div>
  );
}
