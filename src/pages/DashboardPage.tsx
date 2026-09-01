import { useEffect, useMemo, useState, useCallback } from 'react';
import { format } from 'date-fns';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart,
} from 'recharts';
import {
  TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Circle, Play, Activity, Gauge, Users, Zap,
  Layers, Scale, Sparkles, ShieldCheck, Factory, Truck, Database, CheckCircle2
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-500">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-3" />
        <p className="text-sm font-semibold text-slate-700">Loading Operations Command Center...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 bg-slate-50/60 min-h-screen">
      {/* Sleek Low Stock Notice Banner */}
      {filteredLowStock.length > 0 && (
        <div className="bg-slate-900 border border-amber-500/30 text-white rounded-2xl p-4 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-amber-500/20 text-amber-300 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-amber-500/30 uppercase tracking-wider">
                  Reorder Notice
                </span>
                <span className="text-xs text-slate-400">Finance & Warehouse Notice</span>
              </div>
              <p className="text-xs text-slate-200 mt-1 font-medium">
                <strong className="text-amber-400">{filteredLowStock.length} raw material(s)</strong> are below reorder threshold ({filteredLowStock.slice(0, 3).map(({ item }) => item.name).join(', ')}...)
              </p>
            </div>
          </div>
          <Link
            to="/raw-materials"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all shrink-0 active:scale-95 border border-teal-400/30"
          >
            View Low Stock List
          </Link>
        </div>
      )}

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

        return (
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-3xl p-5 text-white shadow-xl relative overflow-hidden border border-slate-800">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-700/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Factory className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      Live Feed
                    </span>
                    <span className="text-xs text-slate-400">Updated {format(lastUpdated, 'HH:mm:ss')}</span>
                  </div>
                  <h2 className="text-lg font-extrabold tracking-tight mt-0.5">
                    Active Batch: <span className="font-mono text-emerald-400">{heroOrder.batch_number}</span> — {(heroOrder.formulations as any)?.name}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => { fetchLiveOrders(); fetchDashboardData(false); }}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>
            </div>

            {heroOrder && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Throughput', value: `${throughputVal.toLocaleString()} ${unitStr}/hr`, pct: Math.min(100, throughputVal / 10), color: '#10b981', icon: Zap },
                    { label: 'Yield Rate', value: `${yieldPct}%`, pct: yieldPct, color: '#3b82f6', icon: Gauge },
                    { label: 'Batch Progress', value: `${(heroOrder.actual_qty || 0).toLocaleString()} / ${heroOrder.planned_qty.toLocaleString()} kg`, pct: yieldPct, color: '#f59e0b', icon: Activity },
                    { label: 'Active Lines', value: `${liveOrders.filter(o => o.status === 'in_progress').length} Line Running`, pct: Math.min(100, liveOrders.filter(o => o.status === 'in_progress').length * 50), color: '#a855f7', icon: Users },
                  ].map(({ label, value, pct, color, icon: Icon }) => (
                    <div key={label} className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
                      <div className="flex items-center gap-1.5 mb-1 text-slate-400">
                        <Icon className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
                      </div>
                      <p className="text-base font-extrabold text-white mb-2">{value}</p>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* KPI Stat Cards Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Orders</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <h3 className="text-3xl font-extrabold text-slate-900 font-mono">{String(stats.activeOrders).padStart(2, '0')}</h3>
            {stats.activeOrders > 0 && <TrendingUp className="w-4 h-4 text-emerald-500" />}
          </div>
          <p className="text-xs text-slate-500 mt-1">{stats.activeOrders > 0 ? 'Batches in active queue' : 'No active runs'}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Production</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1 mt-2">
            <h3 className="text-3xl font-extrabold text-slate-900 font-mono">{stats.totalProduction.toLocaleString()}</h3>
            <span className="text-xs font-bold text-slate-400">tonnes</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Cumulative plant output</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Pending Dispatch</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <h3 className="text-3xl font-extrabold text-slate-900 font-mono">{String(stats.pendingDispatches).padStart(2, '0')}</h3>
            <span className="text-xs font-bold text-purple-600">trips</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">{stats.pendingDispatches > 0 ? 'Shipments queueing' : 'All dispatched'}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Plant Efficiency</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Gauge className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <h3 className="text-3xl font-extrabold text-slate-900 font-mono">{stats.efficiency}%</h3>
            {stats.efficiency >= 85 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-amber-500" />}
          </div>
          <p className="text-xs text-slate-500 mt-1">Target OEE: &gt;85%</p>
        </div>
      </div>

      {/* Analytics Charts & Dual-Source Stock Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        
        {/* Left Main Column: Operations Trends Chart + Live Dispatch & Logistics Activity Hub */}
        <div className="xl:col-span-2 space-y-5">
          {/* Operations Trends Chart */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">12-Month Operations Trends & Analytics</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Production Output (t) vs RM Consumption vs Branch Dispatches</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-emerald-500 rounded" /> Production</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-blue-500 rounded" /> Consumption</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-slate-400 border-t border-dashed" /> Dispatch</span>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={290}>
              <ComposedChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#e2e8f0' }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="production" fill="#10b981" radius={[6, 6, 0, 0]} name="Production (t)" />
                <Bar dataKey="consumption" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Consumption (t)" />
                <Line type="monotone" dataKey="dispatch" stroke="#64748b" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Dispatch (t)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Live Dispatch & Logistics Activity Hub */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-purple-600" />
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Live Dispatch & Logistics Activity</h3>
                  <p className="text-[11px] text-slate-400">Real-time status of outgoing shipments, D-Notes & Sage posting</p>
                </div>
              </div>
              <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200">
                {stats.pendingDispatches} Pending Dispatches
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-900 text-white uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3 text-left">Dispatch Ref</th>
                    <th className="px-4 py-3 text-left">Destination / Type</th>
                    <th className="px-4 py-3 text-right">Weight (kg)</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Sage Posting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentDispatches.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400">No recent dispatch activity</td>
                    </tr>
                  ) : (
                    recentDispatches.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">
                          {d.dispatch_number}
                          {d.physical_dnote_number && (
                            <span className="ml-2 text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded font-mono">D-Note #{d.physical_dnote_number}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800">
                          {d.dispatch_type === 'customer_direct' ? (d.customer_name || 'Direct Customer') : ((d.branches as any)?.name || 'Branch Transfer')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-extrabold text-slate-900">
                          {d.total_weight.toLocaleString()} <span className="font-normal text-slate-400">kg</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={d.status} />
                        </td>
                        <td className="px-4 py-3">
                          {d.accounts_posting_status === 'approved' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                              <Sparkles className="w-3 h-3 text-purple-600" /> Posted to Sage
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                              Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Sidebar Widgets */}
        <div className="space-y-5">
          {/* RM Variance Alert Banner */}
          {varianceAlerts.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <h3 className="text-xs font-bold text-rose-900 uppercase tracking-wider">Raw Material Variance Alert</h3>
                </div>
                <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">{varianceAlerts.length} Alerts</span>
              </div>
              <div className="space-y-1.5 pt-1">
                {varianceAlerts.map((v) => (
                  <div key={v.raw_material_name} className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-rose-100 shadow-sm">
                    <span className="font-semibold text-rose-900">{v.raw_material_name}</span>
                    <span className="font-mono font-extrabold text-rose-700">+{v.stock_variance.toFixed(3)} kg</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DUAL-SOURCE STOCK & REORDER ALERTS WIDGET (MES + SAGE DB) */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Stock & Reorder Alerts</h3>
                  <p className="text-[10px] text-slate-400">Monitoring both MES & Sage DB stock levels</p>
                </div>
              </div>
              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                {filteredLowStock.length} Alerts
              </span>
            </div>

            {filteredLowStock.length === 0 ? (
              <div className="py-8 text-center text-slate-400 space-y-1">
                <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-1" />
                <p className="text-xs font-bold text-slate-700">All MES & Sage DB stock levels healthy</p>
                <p className="text-[10px] text-slate-400">No raw materials are currently below reorder levels in MES or Sage DB.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1 pt-1 pb-1">
                {filteredLowStock.map(({ item, alertInfo }) => (
                  <div key={item.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-200/70 hover:bg-slate-100 transition-colors space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${alertInfo.severity === 'critical' ? 'bg-rose-500 animate-ping' : 'bg-amber-500'}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{item.name}</p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span className="font-mono font-bold text-blue-700">{item.code}</span>
                            <span>• Reorder: <strong className="font-mono">{item.reorder_level.toLocaleString()} {item.unit}</strong></span>
                          </div>
                        </div>
                      </div>

                      <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded shrink-0 ${
                        alertInfo.severity === 'critical' ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}>
                        {alertInfo.alertReason || alertInfo.severity}
                      </span>
                    </div>

                    {/* MES vs SAGE DUAL-SOURCE STOCK COMPARISON BADGES */}
                    <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-200/60 text-[10px]">
                      <div className="bg-white px-2 py-1.5 rounded-xl border border-slate-200 flex items-center justify-between min-w-0">
                        <span className="text-slate-500 font-bold shrink-0 text-[10px]">MES Stock:</span>
                        <span className={`font-mono font-extrabold whitespace-nowrap ml-1 ${alertInfo.mesStock <= item.reorder_level ? 'text-amber-700' : 'text-slate-900'}`}>
                          {alertInfo.mesStock.toLocaleString()} {item.unit}
                        </span>
                      </div>

                      <div className="bg-white px-2 py-1.5 rounded-xl border border-slate-200 flex items-center justify-between min-w-0">
                        <span className="text-slate-500 font-bold flex items-center gap-1 shrink-0 text-[10px]">
                          <Database className="w-3 h-3 text-indigo-500 shrink-0" /> Sage DB:
                        </span>
                        {alertInfo.sageStock !== null ? (
                          <span className={`font-mono font-extrabold whitespace-nowrap ml-1 ${alertInfo.sageStock <= item.reorder_level ? 'text-rose-700 font-black' : 'text-slate-900'}`}>
                            {alertInfo.sageStock.toLocaleString()} {item.unit}
                          </span>
                        ) : (
                          <span className="font-bold text-slate-400 italic text-[10px] whitespace-nowrap">Not Synced</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Approvals */}
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            <PendingApprovalsWidget limit={5} compact />
          </div>
        </div>
      </div>

      {/* Recent Production Orders Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-600" />
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Recent Production Orders</h2>
          </div>
          <span className="text-xs font-bold text-slate-500">{recentOrders.length} Recent Batches</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-900 text-white uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-5 py-3.5 text-left">Batch Number</th>
                <th className="px-5 py-3.5 text-left">Product Formulation</th>
                <th className="px-5 py-3.5 text-right">Planned (kg)</th>
                <th className="px-5 py-3.5 text-right">Actual (kg)</th>
                <th className="px-5 py-3.5 text-left">Status</th>
                <th className="px-5 py-3.5 text-left">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400">No production orders found</td>
                </tr>
              ) : (
                recentOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5 font-mono font-bold text-slate-900">{order.batch_number}</td>
                    <td className="px-5 py-3.5 font-bold text-slate-800">{order.formulations?.name || '-'}</td>
                    <td className="px-5 py-3.5 text-right font-mono font-bold text-slate-700">{order.planned_qty?.toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-right font-mono font-bold text-emerald-700">{order.actual_qty?.toLocaleString()}</td>
                    <td className="px-5 py-3.5"><StatusBadge status={order.status} /></td>
                    <td className="px-5 py-3.5 text-slate-500">{format(new Date(order.created_at), 'dd MMM yyyy')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
