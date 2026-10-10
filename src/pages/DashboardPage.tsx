import { useEffect, useMemo, useState, useCallback } from 'react';
import { format } from 'date-fns';
import {
  Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart,
} from 'recharts';
import {
  AlertTriangle, RefreshCw, Activity, Gauge,
  Layers, Scale, Sparkles, Factory, Truck,
  Clock, ArrowRight, Package, ClipboardList, FlaskConical
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ProductionOrder, RawMaterial, MonthlyTrendRow, InventoryForecastRow, DispatchOrder } from '../types/database';
import StatusBadge from '../components/ui/StatusBadge';
import PendingApprovalsWidget from '../components/dashboard/PendingApprovalsWidget';

interface DashboardStats {
  totalProduction: number;
  activeOrders: number;
  rawMaterialCount: number;
  formulationCount: number;
  pendingDispatches: number;
  efficiency: number;
}

import { Link } from 'react-router-dom';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalProduction: 0, activeOrders: 0, rawMaterialCount: 0,
    formulationCount: 0, pendingDispatches: 0, efficiency: 0,
  });
  const [recentOrders, setRecentOrders] = useState<ProductionOrder[]>([]);
  const [lowStockItems, setLowStockItems] = useState<RawMaterial[]>([]);
  const [sageStockByMatId, setSageStockByMatId] = useState<Record<string, number>>({});
  const [sageStockMap, setSageStockMap] = useState<Record<string, number>>({});
  const [snapshotStockMap, setSnapshotStockMap] = useState<Record<string, number>>({});
  const [trends, setTrends] = useState<MonthlyTrendRow[]>([]);
  const [inventoryForecasts, setInventoryForecasts] = useState<InventoryForecastRow[]>([]);
  const [recentDispatches, setRecentDispatches] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [varianceAlerts, setVarianceAlerts] = useState<{ raw_material_name: string; stock_variance: number }[]>([]);
  const [liveOrders, setLiveOrders] = useState<ProductionOrder[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchLiveOrders = useCallback(async () => {
    const { data } = await supabase
      .from('production_orders')
      .select('*, formulations(name, code)')
      .in('status', ['materials_issued', 'in_progress', 'pending'])
      .order('created_at', { ascending: false })
      .limit(8);
    setLiveOrders((data as ProductionOrder[]) || []);
    setLastUpdated(new Date());
  }, []);

  const fetchDashboardData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const [ordersRes, materialsRes, formulationsRes, dispatchRes, recentRes, stockRes, trendRes, forecastRes, varianceRes, sageStockRes, snapshotsRes, recentDispatchRes] =
      await Promise.all([
        supabase.from('production_orders').select('planned_qty, actual_qty, status'),
        supabase.from('raw_materials').select('id', { count: 'exact', head: true }),
        supabase.from('formulations').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('dispatch_orders').select('id', { count: 'exact', head: true }).in('status', ['pending', 'loading']),
        supabase.from('production_orders').select('*, formulations(name, code)').order('created_at', { ascending: false }).limit(10),
        supabase.from('raw_materials').select('id, name, code, unit, current_stock, reorder_level, alert_threshold_pct, days_of_cover_target, is_active').order('name'),
        supabase.from('monthly_operations_trends').select('*'),
        supabase.from('inventory_depletion_forecasts').select('*'),
        supabase.from('rm_daily_snapshots').select('raw_material_name, stock_variance').eq('snapshot_date', todayStr).gt('stock_variance', 0.1).order('stock_variance', { ascending: false }).limit(5),
        supabase.from('sage_stock_balances').select('*'),
        supabase.from('rm_daily_snapshots').select('raw_material_name, physical_stock').order('snapshot_date', { ascending: false }).limit(100),
        supabase.from('dispatch_orders').select('*, branches(name)').order('created_at', { ascending: false }).limit(5),
      ]);

    const orders = ordersRes.data || [];
    const completed = orders.filter((o) => o.status === 'completed');
    const totalProd = completed.reduce((sum, o) => sum + (o.actual_qty || 0), 0);
    const activeCount = orders.filter((o) => ['pending', 'materials_issued', 'in_progress'].includes(o.status)).length;
    const totalPlanned = completed.reduce((sum, o) => sum + (o.planned_qty || 0), 0);
    const efficiency = totalPlanned > 0 ? Math.round((totalProd / totalPlanned) * 100) : 0;

    setStats({
      totalProduction: Math.round(totalProd * 10) / 10,
      activeOrders: activeCount,
      rawMaterialCount: materialsRes.count || 0,
      formulationCount: formulationsRes.count || 0,
      pendingDispatches: dispatchRes.count || 0,
      efficiency,
    });
    setRecentOrders((recentRes.data as ProductionOrder[]) || []);
    setRecentDispatches((recentDispatchRes.data as DispatchOrder[]) || []);
    
    const allMaterials = (stockRes.data as RawMaterial[]) || [];
    setLowStockItems(allMaterials);
    setTrends((trendRes.data as MonthlyTrendRow[]) || []);
    setInventoryForecasts((forecastRes.data as InventoryForecastRow[]) || []);
    setVarianceAlerts((varianceRes.data as any[]) || []);

    // 1. Build Sage stock map strictly from Sage balance columns
    const sageMapByMatId: Record<string, number> = {};
    const sageMapByCode: Record<string, number> = {};

    if (sageStockRes?.data) {
      for (const row of sageStockRes.data as any[]) {
        const qty = Number(
          row.quantity !== undefined && row.quantity !== null 
            ? row.quantity 
            : (row.quantity_on_hand !== undefined && row.quantity_on_hand !== null
                ? row.quantity_on_hand 
                : (row.balance || 0))
        );

        if (row.raw_material_id) {
          sageMapByMatId[row.raw_material_id] = (sageMapByMatId[row.raw_material_id] || 0) + qty;
        }
        if (row.sage_code) {
          const k = String(row.sage_code).toUpperCase().trim();
          sageMapByCode[k] = (sageMapByCode[k] || 0) + qty;
        }
        if (row.item_code) {
          const k = String(row.item_code).toUpperCase().trim();
          sageMapByCode[k] = (sageMapByCode[k] || 0) + qty;
        }
        if (row.code) {
          const k = String(row.code).toUpperCase().trim();
          sageMapByCode[k] = (sageMapByCode[k] || 0) + qty;
        }
      }
    }

    setSageStockByMatId(sageMapByMatId);
    setSageStockMap(sageMapByCode);

    // 2. Build snapshot stock map strictly using physical_stock (never system_stock)
    const snapMap: Record<string, number> = {};
    if (snapshotsRes?.data) {
      for (const s of snapshotsRes.data as any[]) {
        const nameKey = (s.raw_material_name || '').toUpperCase().trim();
        if (nameKey && snapMap[nameKey] === undefined && s.physical_stock !== null && s.physical_stock !== undefined) {
          snapMap[nameKey] = Number(s.physical_stock);
        }
      }
    }
    setSnapshotStockMap(snapMap);

    if (isInitial) setLoading(false);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    fetchLiveOrders();
    fetchDashboardData(true);

    const channel = supabase
      .channel('live-dashboard-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, () => {
        fetchLiveOrders();
        fetchDashboardData(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sage_stock_balances' }, () => {
        fetchDashboardData(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_materials' }, () => {
        fetchDashboardData(false);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchLiveOrders, fetchDashboardData]);

  const forecastMap = useMemo(() => {
    return inventoryForecasts.reduce<Record<string, InventoryForecastRow>>((acc, row) => {
      acc[row.raw_material_id] = row;
      return acc;
    }, {});
  }, [inventoryForecasts]);

  // Evaluates stock health across BOTH MES and Sage DB
  const getStockAlertInfo = useCallback((item: RawMaterial) => {
    const forecast = forecastMap[item.id];
    const reorderLevel = Number(item.reorder_level || 0);
    const codeKey = (item.code || '').toUpperCase().trim();
    const nameKey = (item.name || '').toUpperCase().trim();

    // Multi-tier Sage stock resolution (strict Sage DB sources only)
    const sageByMatId = sageStockByMatId[item.id];
    const sageByCode = sageStockMap[codeKey];
    const sageBySnap = snapshotStockMap[nameKey];
    
    let sageStock: number | null = null;
    if (sageByMatId !== undefined) {
      sageStock = sageByMatId;
    } else if (sageByCode !== undefined) {
      sageStock = sageByCode;
    } else if (sageBySnap !== undefined) {
      sageStock = sageBySnap;
    }

    const mesStock = Number(item.current_stock || 0);
    const hasReorderLevel = reorderLevel > 0;
    const thresholdStock = hasReorderLevel ? reorderLevel * (1 + (item.alert_threshold_pct || 0.1)) : 0;

    const mesBelow = hasReorderLevel && mesStock <= thresholdStock;
    const sageBelow = sageStock !== null && hasReorderLevel && sageStock <= thresholdStock;

    const daysToDepletion = forecast?.days_to_depletion;
    const targetCover = item.days_of_cover_target || 7;
    const depletionBelow = typeof daysToDepletion === 'number' && daysToDepletion > 0 && daysToDepletion <= targetCover;

    let severity: 'critical' | 'warning' | 'healthy' = 'healthy';
    let alertReason: string[] = [];

    if (hasReorderLevel) {
      if (mesStock === 0 || (sageStock !== null && sageStock === 0)) {
        severity = 'critical';
        if (mesStock === 0) alertReason.push('MES Out of Stock');
        if (sageStock === 0) alertReason.push('Sage Out of Stock');
      } else if (mesBelow && sageBelow) {
        severity = 'critical';
        alertReason.push('MES & Sage Low');
      } else if (mesBelow) {
        severity = 'warning';
        alertReason.push('MES Low Stock');
      } else if (sageBelow) {
        severity = 'warning';
        alertReason.push('Sage DB Low Stock');
      } else if (depletionBelow) {
        severity = 'warning';
        alertReason.push('Depletion Warning');
      }
    } else if (mesStock > 0 && depletionBelow) {
      severity = 'warning';
      alertReason.push('Depletion Warning');
    }

    return {
      severity,
      alertReason: alertReason.join(' & '),
      mesStock,
      sageStock,
      reorderLevel,
      forecast,
    };
  }, [forecastMap, sageStockByMatId, sageStockMap, snapshotStockMap]);

  const filteredLowStock = useMemo(() => {
    return lowStockItems
      .filter((item) => item.is_active !== false)
      .map((item) => ({ item, alertInfo: getStockAlertInfo(item) }))
      .filter(({ alertInfo }) => alertInfo.severity !== 'healthy');
  }, [lowStockItems, getStockAlertInfo]);

  const trendChartData = trends.map((row) => ({
    month: format(new Date(row.month), 'MMM yyyy'),
    production: Number(row.production_t || 0),
    consumption: Math.abs(Number(row.consumption_t || 0)),
    dispatch: Number(row.dispatch_t || 0),
  }));

  const todayLabel = format(new Date(), 'EEEE, d MMMM yyyy');
  const latestTrend = trendChartData[trendChartData.length - 1];

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-slate-500">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-700">Loading plant overview</p>
        <p className="mt-1 text-xs text-slate-400">MES and Sage balances</p>
      </div>
    );
  }

  const shortcuts = [
    { to: '/production-orders', label: 'Production orders', hint: 'Batches and runs', icon: ClipboardList, tint: 'bg-teal-500' },
    { to: '/formulations', label: 'Formulations', hint: 'Active recipes', icon: FlaskConical, tint: 'bg-sky-500' },
    { to: '/raw-materials', label: 'Raw materials', hint: 'Stock and reorder', icon: Package, tint: 'bg-amber-500' },
    { to: '/dispatch', label: 'Dispatch', hint: 'Loads leaving site', icon: Truck, tint: 'bg-violet-500' },
    { to: '/goods-received', label: 'Goods received', hint: 'Inbound deliveries', icon: Scale, tint: 'bg-emerald-600' },
    { to: '/production-control', label: 'Control centre', hint: 'Floor status', icon: Factory, tint: 'bg-slate-700' },
  ];

  return (
    <div className="-mx-4 -mt-4 bg-[#e8eef3] sm:-mx-6 sm:-mt-6">
      <section className="relative overflow-hidden bg-[#07111f] text-white">
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-teal-400/15 blur-3xl" />
        <div className="relative px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 shrink-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-teal-300">PlantControl · {todayLabel}</p>
              <h1 className="text-lg font-semibold tracking-tight">Operations floor</h1>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 xl:max-w-3xl">
              {[
                { label: 'Active orders', value: stats.activeOrders.toLocaleString(), note: stats.activeOrders > 0 ? 'In the queue' : 'No active runs', icon: Activity },
                { label: 'Production', value: stats.totalProduction.toLocaleString(), note: 'Completed tonnes', icon: Scale },
                { label: 'Dispatch', value: stats.pendingDispatches.toLocaleString(), note: stats.pendingDispatches > 0 ? 'Trips waiting' : 'All dispatched', icon: Truck },
                { label: 'Efficiency', value: `${stats.efficiency}%`, note: 'Target 85%', icon: Gauge },
              ].map(({ label, value, note, icon: Icon }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</span>
                    <Icon className="h-3.5 w-3.5 shrink-0 text-teal-300" />
                  </div>
                  <p className="mt-1 text-xl font-semibold tabular-nums leading-none tracking-tight">{value}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-400">{note}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => { fetchLiveOrders(); fetchDashboardData(false); }}
              className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/15"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh · {format(lastUpdated, 'HH:mm')}
            </button>
          </div>

          {filteredLowStock.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-amber-50">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                <span>
                  <span className="font-semibold">{filteredLowStock.length} material{filteredLowStock.length === 1 ? '' : 's'} below reorder.</span>{' '}
                  {filteredLowStock.slice(0, 3).map(({ item }) => item.name).join(', ')}
                  {filteredLowStock.length > 3 ? ` and ${filteredLowStock.length - 3} more` : ''}
                </span>
              </p>
              <Link to="/raw-materials" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-900">
                Review materials <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      </section>

      <div className="space-y-3 px-4 py-3 sm:px-5">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {shortcuts.map(({ to, label, hint, icon: Icon, tint }) => (
            <Link key={to} to={to} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition hover:border-slate-300">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white ${tint}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight text-slate-900">{label}</span>
                <span className="block text-[11px] leading-tight text-slate-400">{hint}</span>
              </span>
            </Link>
          ))}
        </div>

      {/* Hero Live Production Banner */}
      {(() => {
        const inProgressOrders = liveOrders.filter((o) => o.status === 'in_progress');
        const heroOrder = inProgressOrders[0] || liveOrders[0];

        if (!heroOrder) return null;

        const yieldPct = heroOrder.planned_qty > 0
          ? Math.round(((heroOrder.actual_qty || 0) / heroOrder.planned_qty) * 100)
          : 0;

        const actualStart = (heroOrder as any).actual_start || (heroOrder as any).start_time;
        const elapsedHours = actualStart
          ? Math.max(0.1, (Date.now() - new Date(actualStart).getTime()) / 3600000)
          : 1;
        const throughputVal = Math.round((((heroOrder.actual_qty || 0) / elapsedHours) * 100)) / 100;
        const unitStr = (heroOrder as any).unit || 'kg';

        const runningLines = liveOrders.filter((o) => o.status === 'in_progress').length;

        return (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                  <Factory className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-teal-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                      Live batch
                    </span>
                  </div>
                  <p className="mt-0.5 text-base font-semibold tracking-tight text-slate-900">{heroOrder.batch_number}</p>
                  <p className="text-sm text-slate-500">{(heroOrder.formulations as any)?.name || 'Formulation pending'}</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-slate-100 md:grid-cols-4 md:divide-x">
              {[
                { label: 'Throughput', value: `${throughputVal.toLocaleString()} ${unitStr}/hr` },
                { label: 'Yield', value: `${yieldPct}%` },
                { label: 'Progress', value: `${(heroOrder.actual_qty || 0).toLocaleString()} / ${heroOrder.planned_qty.toLocaleString()} kg` },
                { label: 'Lines running', value: String(runningLines) },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-slate-900">Twelve-month movement</h2>
                <p className="text-[11px] text-slate-500">Tonnes produced, consumed, and dispatched</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                {latestTrend && (
                  <span className="font-medium text-slate-700">
                    {latestTrend.month}: {Number(latestTrend.production).toLocaleString()} produced · {Number(latestTrend.consumption).toLocaleString()} consumed · {Number(latestTrend.dispatch).toLocaleString()} dispatched
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal-600" /> Production</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-sky-300" /> Consumption</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-amber-500" /> Dispatch</span>
              </div>
            </div>
            <div className="-mx-1">
              <ResponsiveContainer width="100%" height={168}>
                <ComposedChart data={trendChartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="prodFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="month" stroke="#e2e8f0" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#e2e8f0" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '12px', padding: '10px 12px' }}
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                  />
                  <Area type="monotone" dataKey="production" stroke="#0f766e" fill="url(#prodFill)" strokeWidth={2.5} name="Production (t)" />
                  <Bar dataKey="consumption" fill="#7dd3fc" radius={[4, 4, 0, 0]} name="Consumption (t)" barSize={12} />
                  <Line type="monotone" dataKey="dispatch" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }} name="Dispatch (t)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-slate-900">Dispatch</h2>
                <p className="text-[11px] text-slate-500">Shipments, delivery notes, and Sage posting</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{stats.pendingDispatches} pending</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Reference</th>
                    <th className="px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Destination</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Weight</th>
                    <th className="px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Status</th>
                    <th className="px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Sage</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDispatches.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No recent dispatches</td></tr>
                  ) : recentDispatches.map((d) => (
                    <tr key={d.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/70">
                      <td className="px-4 py-2">
                        <p className="font-medium tabular-nums text-slate-900">{d.dispatch_number}</p>
                        {d.physical_dnote_number && <p className="text-[11px] text-slate-400">D-note {d.physical_dnote_number}</p>}
                      </td>
                      <td className="px-4 py-2 text-slate-800">
                        {d.dispatch_type === 'customer_direct' ? (d.customer_name || 'Direct customer') : ((d.branches as any)?.name || 'Branch transfer')}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800">{d.total_weight.toLocaleString()} <span className="text-xs text-slate-400">kg</span></td>
                      <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-2">
                        {d.accounts_posting_status === 'approved' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700"><Sparkles className="h-3 w-3" /> Posted</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><Clock className="h-3 w-3" /> Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-600">
                  <Layers className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-slate-900">Recent production</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Latest batches recorded in PlantControl</p>
                </div>
              </div>
              <span className="text-xs text-slate-400">{recentOrders.length} batches</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Batch</th>
                    <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Formulation</th>
                    <th className="px-5 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Planned</th>
                    <th className="px-5 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Actual</th>
                    <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Status</th>
                    <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">No production orders yet</td>
                    </tr>
                  ) : (
                    recentOrders.map((order) => {
                      const yieldRate = order.planned_qty > 0 ? Math.round(((order.actual_qty || 0) / order.planned_qty) * 100) : 0;
                      const yieldColor = yieldRate >= 90 ? 'text-teal-700' : yieldRate >= 70 ? 'text-amber-700' : 'text-rose-700';
                      return (
                        <tr key={order.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/70">
                          <td className="px-5 py-3.5 font-medium tabular-nums text-slate-900">{order.batch_number}</td>
                          <td className="px-5 py-3.5">
                            <p className="text-slate-800">{order.formulations?.name || '—'}</p>
                            {order.formulations?.code && (
                              <p className="mt-0.5 text-xs text-slate-400">{order.formulations.code}</p>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right tabular-nums text-slate-700">
                            {order.planned_qty?.toLocaleString()} <span className="text-xs text-slate-400">kg</span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <p className="tabular-nums text-slate-900">{order.actual_qty?.toLocaleString()} <span className="text-xs text-slate-400">kg</span></p>
                            <p className={`mt-0.5 text-xs ${yieldColor}`}>{yieldRate}% yield</p>
                          </td>
                          <td className="px-5 py-3.5"><StatusBadge status={order.status} /></td>
                          <td className="px-5 py-3.5 text-slate-600">
                            {format(new Date(order.created_at), 'dd MMM yyyy')}
                            <span className="ml-2 text-xs text-slate-400">{format(new Date(order.created_at), 'HH:mm')}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {varianceAlerts.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Stock variance</h2>
                <span className="text-xs text-rose-700">{varianceAlerts.length}</span>
              </div>
              <div className="space-y-2">
                {varianceAlerts.map((v) => (
                  <div key={v.raw_material_name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{v.raw_material_name}</span>
                    <span className="shrink-0 tabular-nums text-rose-700">+{v.stock_variance.toFixed(3)} kg</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <h2 className="text-sm font-semibold tracking-tight text-slate-900">Reorder</h2>
              <span className="text-xs font-medium text-amber-800">{filteredLowStock.length}</span>
            </div>
            {filteredLowStock.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">Stock is within reorder limits</p>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                    <th className="px-3 py-1 font-medium">Material</th>
                    <th className="px-2 py-1 text-right font-medium">MES</th>
                    <th className="px-3 py-1 text-right font-medium">Sage</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLowStock.map(({ item, alertInfo }) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="max-w-[140px] px-3 py-1">
                        <p className="truncate font-medium text-slate-900">{item.name}</p>
                        <p className="truncate text-[10px] text-slate-400">reorder {item.reorder_level.toLocaleString()} {item.unit}</p>
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${alertInfo.mesStock <= item.reorder_level ? 'font-medium text-amber-700' : 'text-slate-700'}`}>
                        {alertInfo.mesStock.toLocaleString()}
                      </td>
                      <td className={`px-3 py-1 text-right tabular-nums ${alertInfo.sageStock !== null && alertInfo.sageStock <= item.reorder_level ? 'font-medium text-rose-700' : 'text-slate-500'}`}>
                        {alertInfo.sageStock !== null ? alertInfo.sageStock.toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
            <PendingApprovalsWidget limit={5} compact />
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}
