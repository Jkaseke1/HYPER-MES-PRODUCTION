import { useState, useEffect, useMemo } from 'react';
import { Warehouse as WarehouseIcon, Package, AlertTriangle, ArrowUpDown, Search, Filter, Check, RefreshCw, Database } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { RawMaterial, StockMovement } from '../types/database';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import toast from 'react-hot-toast';

type Tab = 'stock' | 'buffer' | 'movements';
const MOVE_TYPES = ['All', 'Receipt', 'Issue', 'Transfer', 'Production Input', 'Production Output', 'Dispatch'];
const statusBarColor: Record<string, string> = { in_stock: 'bg-emerald-500', low_stock: 'bg-amber-500', out_of_stock: 'bg-red-500' };
const mvBadge: Record<string, string> = {
  receipt: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  issue: 'bg-red-50 text-red-700 border-red-200',
  transfer: 'bg-teal-50 text-teal-700 border-teal-200',
  production_input: 'bg-amber-50 text-amber-700 border-amber-200',
  production_output: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dispatch: 'bg-slate-50 text-slate-700 border-slate-200',
};
const thCls = 'px-4 py-3 font-semibold text-slate-600';
const inputCls = 'border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500';

export default function WarehousePage() {
  const [tab, setTab] = useState<Tab>('stock');
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [bufferBalances, setBufferBalances] = useState<any[]>([]);
  const [rmWarehouseBalances, setRmWarehouseBalances] = useState<Record<string, number>>({});
  const [trackedRmMaterialIds, setTrackedRmMaterialIds] = useState<string[]>([]);
  const [sageBalanceCount, setSageBalanceCount] = useState(0);
  const [bufferSearchTerm, setBufferSearchTerm] = useState('');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'name' | 'rm_balance'>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [moveType, setMoveType] = useState('All');
  const [loading, setLoading] = useState(true);
  const [editingReorder, setEditingReorder] = useState<string | null>(null);
  const [reorderValue, setReorderValue] = useState<string>('');
  const [lastAlertSignature, setLastAlertSignature] = useState('');

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { if (tab === 'movements') fetchMovements(); }, [tab, dateFrom, dateTo, moveType]);
  useEffect(() => { if (tab === 'buffer') fetchBufferBalances(); }, [tab]);

  useEffect(() => {
    const channel = supabase
      .channel('warehouse-live-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_stock_balances' }, () => {
        fetchData(true);
        if (tab === 'buffer') fetchBufferBalances();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sage_stock_balances' }, () => {
        fetchData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, () => {
        fetchData(true);
        if (tab === 'movements') fetchMovements();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_transfers' }, () => {
        fetchData(true);
      })
      .subscribe();

    const intervalId = window.setInterval(() => {
      fetchData(true);
      if (tab === 'buffer') fetchBufferBalances();
      if (tab === 'movements') fetchMovements();
    }, 12000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [tab, dateFrom, dateTo, moveType]);

  async function fetchData(silent = false) {
    if (!silent) setLoading(true);
    const [
      { data: m },
      { data: formulations },
      { data: sageRmBalances },
      { data: mesRmBalances }
    ] = await Promise.all([
      supabase.from('raw_materials').select('*, warehouses(*)').or('is_active.eq.true,is_active.is.null').order('name'),
      supabase.from('formulations').select('sage_code').eq('status', 'active'),
      supabase
        .from('sage_stock_balances')
        .select('raw_material_id, sage_code, quantity')
        .eq('warehouse_id', 18),
      supabase
        .from('warehouse_stock_balances')
        .select('raw_material_id, quantity, warehouses!inner(code)')
        .eq('warehouses.code', 'RM'),
    ]);

    const finishedGoodCodes = new Set(
      (formulations || []).map((formulation) => String(formulation.sage_code || '').trim().toUpperCase())
    );
    setMaterials((m || []).filter((material) => {
      const sageCode = String(material.sage_code || material.code || '').trim().toUpperCase();
      return sageCode && !finishedGoodCodes.has(sageCode);
    }));

    const rmMapById: Record<string, number> = {};
    const rmMapByCode: Record<string, number> = {};
    (sageRmBalances || []).forEach((b: any) => {
      if (b.raw_material_id) rmMapById[b.raw_material_id] = Number(b.quantity || 0);
      if (b.sage_code) rmMapByCode[String(b.sage_code).trim().toUpperCase()] = Number(b.quantity || 0);
    });
    const mesMapById: Record<string, number> = {};
    (mesRmBalances || []).forEach((b: any) => {
      if (b.raw_material_id) mesMapById[b.raw_material_id] = Number(b.quantity || 0);
    });
    setTrackedRmMaterialIds([...new Set([
      ...(mesRmBalances || []).map((b: any) => b.raw_material_id).filter(Boolean),
      ...(sageRmBalances || []).map((b: any) => b.raw_material_id).filter(Boolean),
    ])]);
    const rmMap: Record<string, number> = {};
    (m || []).forEach((material: any) => {
      const code = String(material.sage_code || material.code || '').trim().toUpperCase();
      rmMap[material.id] = rmMapById[material.id] ?? rmMapByCode[code] ?? mesMapById[material.id] ?? Number(material.current_stock || 0);
    });
    setRmWarehouseBalances(rmMap);
    setSageBalanceCount((sageRmBalances || []).length);

    if (!silent) setLoading(false);
  }

  async function fetchMovements() {
    let q = supabase.from('stock_movements').select('*, raw_materials(*), formulations(*), warehouses(*), performer:profiles!performed_by(full_name, email)').order('movement_date', { ascending: false }).limit(300);
    if (dateFrom) q = q.gte('movement_date', dateFrom);
    if (dateTo) q = q.lte('movement_date', dateTo);
    if (moveType !== 'All') q = q.eq('movement_type', moveType.toLowerCase().replace(/ /g, '_'));
    const { data } = await q;
    setMovements(data || []);
  }

  async function fetchBufferBalances() {
    const { data } = await supabase
      .from('warehouse_stock_balances')
      .select('*, raw_materials(*), warehouses(*)')
      .eq('raw_materials.is_active', true)
      .eq('warehouses.code', 'BUFFER')
      .gt('quantity', 0)
      .order('updated_at', { ascending: false });
    setBufferBalances(data || []);
  }

  const catalogRows = useMemo(() => materials.map((m) => ({
      ...m,
      rm_balance: rmWarehouseBalances[m.id] ?? 0,
  })).filter((m) => trackedRmMaterialIds.includes(m.id)), [materials, rmWarehouseBalances, trackedRmMaterialIds]);

  const rmRows = useMemo(() => {
    let list = [...catalogRows];

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
    }

    return [...list].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [catalogRows, searchTerm, sortField, sortAsc]);

  const stats = useMemo(() => ({
    rmValue: catalogRows.reduce((s, m) => s + (m.rm_balance * m.cost_per_unit), 0),
    lowCount: catalogRows.filter((m) => {
      return m.reorder_level > 0 && m.rm_balance <= m.reorder_level;
    }).length,
    stockedCount: catalogRows.filter((m) => m.rm_balance > 0).length,
    total: catalogRows.length,
  }), [catalogRows]);

  const hasLiveSageBalances = sageBalanceCount > 0;

  const stockHealth = useMemo(() => {
    const critical = catalogRows.filter((m) => m.reorder_level > 0 && m.rm_balance === 0);
    const low = catalogRows.filter((m) => m.reorder_level > 0 && m.rm_balance > 0 && m.rm_balance <= m.reorder_level);
    return { critical, low, healthy: catalogRows.length - critical.length - low.length };
  }, [catalogRows]);

  useEffect(() => {
    const signature = [...stockHealth.critical, ...stockHealth.low].map((m) => `${m.id}:${m.rm_balance}`).join('|');
    if (signature && signature !== lastAlertSignature) {
      toast.error(`${stockHealth.critical.length ? `${stockHealth.critical.length} critical, ` : ''}${stockHealth.low.length} low RM stock alert${stockHealth.low.length === 1 ? '' : 's'} need attention.`, { duration: 7000 });
    }
    setLastAlertSignature(signature);
  }, [stockHealth, lastAlertSignature]);

  function toggleSort(f: 'name' | 'rm_balance') {
    if (sortField === f) setSortAsc(!sortAsc);
    else { setSortField(f); setSortAsc(true); }
  }

  function getStatus(rmBalance: number, reorderLevel: number) {
    if (rmBalance === 0) return 'out_of_stock';
    return (rmBalance <= reorderLevel && reorderLevel > 0) ? 'low_stock' : 'in_stock';
  }

  function stockPct(rmBalance: number, reorderLevel: number) {
    return reorderLevel === 0 ? 100 : Math.min(100, Math.round((rmBalance / (reorderLevel * 2)) * 100));
  }

  // Handle reorder level editing
  const startEditingReorder = (materialId: string, currentValue: number) => {
    setEditingReorder(materialId);
    setReorderValue(currentValue.toString());
  };

  const saveReorderLevel = async (materialId: string) => {
    const newReorderLevel = parseFloat(reorderValue) || 0;
    
    try {
      const { error } = await supabase
        .from('raw_materials')
        .update({ reorder_level: newReorderLevel })
        .eq('id', materialId);

      if (error) throw error;

      // Update local state
      setMaterials(materials.map(m => 
        m.id === materialId ? { ...m, reorder_level: newReorderLevel } : m
      ));

      setEditingReorder(null);
      setReorderValue('');
    } catch (error: any) {
      console.error('Error updating reorder level:', error);
      alert('Failed to update reorder level');
    }
  };

  const cancelEditingReorder = () => {
    setEditingReorder(null);
    setReorderValue('');
  };

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
      <section className="overflow-hidden rounded-lg border border-[#0d2036] bg-[#0d2036] text-white shadow-lg shadow-slate-900/20">
        <div className="flex flex-col gap-5 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[#f39200]/70 bg-[#f39200]/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#ffc36b]">Inventory control</span>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${hasLiveSageBalances ? 'text-emerald-300' : 'text-[#ffc36b]'}`}><span className={`h-1.5 w-1.5 rounded-full ${hasLiveSageBalances ? 'bg-emerald-300' : 'bg-[#f39200]'}`} />{hasLiveSageBalances ? 'Sage stock synchronized' : 'PlantControl opening balance active'}</span>
            </div>
            <h1 className="mt-3 text-2xl font-bold">Raw Materials Warehouse</h1>
            <p className="mt-1 text-sm text-slate-300">{hasLiveSageBalances ? 'Live Sage RM stock, reorder thresholds, and movement history.' : 'Verified RM opening balances, reorder thresholds, and movement history.'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex h-12 items-center gap-2 border border-white/20 bg-white/10 px-4 text-xs font-semibold text-slate-100"><Database className="h-4 w-4 text-emerald-300" />Refreshes every 12 sec</span>
            <button type="button" onClick={() => fetchData(true)} className="inline-flex h-12 w-12 items-center justify-center border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20" title="Refresh RM stock" aria-label="Refresh RM stock"><RefreshCw className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-2 xl:grid-cols-5">
          <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">On-hand value</p><p className="mt-2 text-3xl font-bold">$ {stats.rmValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p><p className="mt-1 text-xs text-slate-400">{hasLiveSageBalances ? 'Current Sage valuation' : 'PlantControl valuation'}</p></div>
          <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Stock lines</p><p className="mt-2 text-3xl font-bold text-emerald-300">{stats.stockedCount}</p><p className="mt-1 text-xs text-slate-400">Materials on hand</p></div>
          <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Reorder alerts</p><p className={`mt-2 text-3xl font-bold ${stats.lowCount ? 'text-[#ffc36b]' : 'text-emerald-300'}`}>{stats.lowCount}</p><p className="mt-1 text-xs text-slate-400">At or below threshold</p></div>
          <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Tracked materials</p><p className="mt-2 text-3xl font-bold text-cyan-300">{catalogRows.length}</p><p className="mt-1 text-xs text-slate-400">Stocked or managed</p></div>
          <div className="px-5 py-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Stock source</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold"><span className={`inline-flex items-center gap-1.5 ${hasLiveSageBalances ? 'text-emerald-300' : 'text-[#ffc36b]'}`}><span className={`h-1.5 w-1.5 rounded-full ${hasLiveSageBalances ? 'bg-emerald-300' : 'bg-[#f39200]'}`} />{hasLiveSageBalances ? 'Sage RM warehouse 18' : 'PlantControl RM warehouse'}</span><span className="inline-flex items-center gap-1.5 text-cyan-300"><Database className="h-3.5 w-3.5" />{hasLiveSageBalances ? 'Synchronized' : 'Opening balance'}</span></div><p className="mt-2 text-xs text-slate-400">{hasLiveSageBalances ? 'Live Sage stock is active' : 'Switches to Sage after live integration'}</p></div>
        </div>
      </section>
      <div className="flex w-fit gap-1 border border-slate-200 bg-slate-50 p-1">
        {(['stock', 'buffer', 'movements'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'stock' ? 'Stock Overview' : t === 'buffer' ? 'Buffer / Holding Bay' : 'Stock Movements'}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className={`border-l-4 p-5 ${stockHealth.critical.length ? 'border-rose-500 bg-rose-50' : stockHealth.low.length ? 'border-amber-500 bg-amber-50' : 'border-emerald-500 bg-emerald-50'}`}>
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Replenishment watch</p><h2 className="mt-1 text-lg font-bold text-slate-900">{stockHealth.critical.length ? 'Restock immediately' : stockHealth.low.length ? 'Reorder attention needed' : 'Stock position healthy'}</h2><p className="mt-1 text-sm text-slate-600">Set each material's reorder point directly in the stock register.</p></div><AlertTriangle className={`h-6 w-6 shrink-0 ${stockHealth.critical.length ? 'text-rose-600' : stockHealth.low.length ? 'text-amber-600' : 'text-emerald-600'}`} /></div>
              {(stockHealth.critical.length || stockHealth.low.length) > 0 && <div className="mt-4 flex flex-wrap gap-2">{[...stockHealth.critical, ...stockHealth.low].slice(0, 6).map((m) => <span key={m.id} className="border border-white bg-white px-2 py-1 text-xs font-semibold text-slate-700">{m.name}: {m.rm_balance.toLocaleString()} / {m.reorder_level.toLocaleString()} {m.unit}</span>)}</div>}
            </div>
            <div className="min-w-0 border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Stock health mix</p><div className="mt-2 flex h-32 justify-center"><ResponsiveContainer width={240} height={128}><PieChart><Pie data={[{ name: 'Healthy', value: Math.max(0, stockHealth.healthy) }, { name: 'Low', value: stockHealth.low.length }, { name: 'Critical', value: stockHealth.critical.length }]} dataKey="value" nameKey="name" innerRadius={32} outerRadius={52} paddingAngle={3}><Cell fill="#10b981" /><Cell fill="#f59e0b" /><Cell fill="#ef4444" /></Pie><Tooltip /></PieChart></ResponsiveContainer></div><div className="flex justify-between text-[11px] text-slate-500"><span>Healthy {stockHealth.healthy}</span><span>Low {stockHealth.low.length}</span><span>Critical {stockHealth.critical.length}</span></div></div>
          </div>
          <div className="border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="text-base font-bold text-slate-900">RM stock register</h2><p className="mt-0.5 text-xs text-slate-500">{hasLiveSageBalances ? 'Sage RM on-hand quantities with editable reorder thresholds.' : 'PlantControl opening and catch-up quantities with editable reorder thresholds.'}</p></div>
              <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search materials..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className={`w-full pl-10 pr-4 py-2 ${inputCls}`} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className={`text-left ${thCls} cursor-pointer`} onClick={() => toggleSort('name')}>
                      <span className="inline-flex items-center gap-1">Material <ArrowUpDown className="w-3 h-3" /></span>
                    </th>
                    <th className={`text-left ${thCls}`}>Code</th>
                    <th className={`text-right ${thCls} cursor-pointer`} onClick={() => toggleSort('rm_balance')}>
                      <span className="inline-flex items-center gap-1 justify-end">{hasLiveSageBalances ? 'Sage RM On Hand' : 'RM On Hand'} <ArrowUpDown className="w-3 h-3" /></span>
                    </th>
                    <th className={`text-right ${thCls}`}>Reorder Level</th>
                    <th className={`text-center ${thCls}`}>Stock Level</th>
                    <th className={`text-center ${thCls}`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rmRows.map((m) => {
                    const st = getStatus(m.rm_balance, m.reorder_level);
                    return (
                      <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{m.name}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{m.code}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{m.rm_balance.toLocaleString()} <span className="text-xs font-normal text-slate-400">{m.unit}</span></td>
                        <td className="px-4 py-3 text-right">
                          {editingReorder === m.id ? (
                            <div className="flex items-center gap-1 justify-end">
                              <input
                                type="number"
                                step="0.01"
                                value={reorderValue}
                                onChange={(e) => setReorderValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveReorderLevel(m.id);
                                  if (e.key === 'Escape') cancelEditingReorder();
                                }}
                                className="w-20 px-2 py-1 text-right border border-teal-500 rounded text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                                autoFocus
                              />
                              <button
                                onClick={() => saveReorderLevel(m.id)}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                                title="Save"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                onClick={cancelEditingReorder}
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                title="Cancel"
                              >
                                <AlertTriangle className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEditingReorder(m.id, m.reorder_level)}
                              className="text-right text-slate-500 hover:text-teal-600 hover:bg-teal-50 px-2 py-1 rounded text-sm transition-colors"
                              title="Click to edit reorder level"
                            >
                              {m.reorder_level.toLocaleString()}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-full bg-slate-100 rounded-full h-2">
                            <div className={`h-2 rounded-full ${statusBarColor[st]}`} style={{ width: `${stockPct(m.rm_balance, m.reorder_level)}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center"><StatusBadge status={st} /></td>
                      </tr>
                    );
                  })}
                  {rmRows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No RM stock or replenishment thresholds found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'buffer' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard title="Buffer Items" value={bufferBalances.length} icon={Package} color="teal" />
            <StatCard title="Total Buffer Quantity" value={bufferBalances.reduce((s, b) => s + (b.quantity || 0), 0).toLocaleString()} icon={WarehouseIcon} color="amber" />
            <StatCard title="Buffer Warehouse" value="BUFFER" icon={WarehouseIcon} color="emerald" />
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search buffer materials..." value={bufferSearchTerm} onChange={(e) => setBufferSearchTerm(e.target.value)} className={`w-full max-w-md pl-10 pr-4 py-2 ${inputCls}`} />
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className={`text-left ${thCls}`}>Material</th>
                    <th className={`text-left ${thCls}`}>Code</th>
                    <th className={`text-left ${thCls}`}>Unit</th>
                    <th className={`text-right ${thCls}`}>Quantity in Buffer</th>
                    <th className={`text-left ${thCls}`}>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {bufferBalances
                    .filter((b) => {
                      if (!bufferSearchTerm) return true;
                      const q = bufferSearchTerm.toLowerCase();
                      const name = (b.raw_materials?.name || '').toLowerCase();
                      const code = (b.raw_materials?.code || '').toLowerCase();
                      return name.includes(q) || code.includes(q);
                    })
                    .map((b) => (
                      <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{b.raw_materials?.name || 'Unknown'}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{b.raw_materials?.code || '-'}</td>
                        <td className="px-4 py-3 text-slate-500">{b.raw_materials?.unit || 'kg'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{(b.quantity || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-slate-500">{b.updated_at ? format(new Date(b.updated_at), 'dd MMM yyyy HH:mm') : '-'}</td>
                      </tr>
                    ))}
                  {bufferBalances.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No materials currently in Buffer / Holding Bay</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'movements' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`px-3 py-2 ${inputCls}`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`px-3 py-2 ${inputCls}`} />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select value={moveType} onChange={(e) => setMoveType(e.target.value)} className={`pl-10 pr-4 py-2 ${inputCls} appearance-none bg-white`}>
                {MOVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className={`text-left ${thCls}`}>Date</th>
                    <th className={`text-left ${thCls}`}>Type</th>
                    <th className={`text-left ${thCls}`}>Material / Product</th>
                    <th className={`text-left ${thCls}`}>Warehouse</th>
                    <th className={`text-right ${thCls}`}>Addition / Deduction</th>
                    <th className={`text-left ${thCls}`}>Initiated By</th>
                    <th className={`text-left ${thCls}`}>Batch Number</th>
                    <th className={`text-left ${thCls}`}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((mv) => {
                    const badge = mvBadge[mv.movement_type] || 'bg-slate-50 text-slate-600 border-slate-200';
                    const label = mv.movement_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                    const isAddition = ['receipt', 'production_output', 'transfer_in'].includes(mv.movement_type) || mv.quantity > 0;
                    const isDeduction = ['issue', 'production_input', 'dispatch', 'transfer_out'].includes(mv.movement_type) || mv.quantity < 0;
                    const qtyVal = Math.abs(mv.quantity);
                    
                    return (
                      <tr key={mv.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{format(new Date(mv.movement_date), 'dd MMM yyyy HH:mm')}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${badge}`}>{label}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">{mv.raw_materials?.name || mv.formulations?.name || '-'}</td>
                        <td className="px-4 py-3 text-slate-600 font-semibold">{mv.warehouses?.name || '-'}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-sm">
                          {isAddition ? (
                            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 inline-block">+{qtyVal.toLocaleString()} {mv.unit}</span>
                          ) : isDeduction ? (
                            <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 inline-block">-{qtyVal.toLocaleString()} {mv.unit}</span>
                          ) : (
                            <span className="text-slate-800">{qtyVal.toLocaleString()} {mv.unit}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-700 font-medium">{(mv as any).performer?.full_name || (mv as any).performer?.email || '—'}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{mv.batch_number || '-'}</td>
                        <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{mv.notes || '-'}</td>
                      </tr>
                    );
                  })}
                  {movements.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">No movements found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
