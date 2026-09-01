import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Download, RefreshCw, TrendingUp, AlertTriangle, Package, DollarSign } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { supabase } from '../lib/supabase';
import StatCard from '../components/ui/StatCard';

interface ProductSummary {
  id?: string;
  product_name: string;
  formulation_code: string;
  formulation_version: string;
  tonnes_produced: number;
  rm_cost_per_mt_usd: number;
  total_rm_cost_usd: number;
  sell_price_per_mt_usd: number;
  total_sell_value_usd: number;
  margin_per_mt_usd: number;
  total_margin_usd: number;
  margin_pct: number;
}

interface FormulationVersion {
  id: string;
  code: string;
  name: string;
  version: number;
  ingredients: IngredientCost[];
  totalCostPerTonne: number;
}

interface IngredientCost {
  raw_material_id: string;
  ingredient_name: string;
  ingredient_code: string;
  kg_per_tonne: number;
  cost_per_kg_usd: number;
  cost_contribution: number;
  percentage: number;
}

const TABS = ['Monthly Summary', 'Formulation Cost Comparison'] as const;
type TabType = typeof TABS[number];

function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = subMonths(now, i);
    options.push({
      label: format(d, 'MMMM yyyy'),
      start: format(startOfMonth(d), 'yyyy-MM-dd'),
      end: format(endOfMonth(d), 'yyyy-MM-dd'),
    });
  }
  return options;
}

export default function GrossMarginReportPage() {
  const monthOptions = useMemo(() => getMonthOptions(), []);

  const [selectedMonth, setSelectedMonth] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>('Monthly Summary');
  const [usdZigRate, setUsdZigRate] = useState('');
  const [defaultRate, setDefaultRate] = useState<number | null>(null);
  const [summaryRows, setSummaryRows] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Tab 2 state
  const [formulations, setFormulations] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [formulationVersions, setFormulationVersions] = useState<FormulationVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const period = monthOptions[selectedMonth];

  // Fetch latest USD:ZiG rate
  useEffect(() => {
    async function fetchRate() {
      const { data } = await supabase
        .from('usd_zig_rate_history')
        .select('rate')
        .order('effective_date', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setDefaultRate(data[0].rate);
        setUsdZigRate(String(data[0].rate));
      }
    }
    fetchRate();
  }, []);

  // Fetch existing summary data
  const fetchSummary = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('period_production_summary')
      .select('*')
      .eq('period_start', period.start)
      .eq('period_end', period.end)
      .order('formulation_version');
    setSummaryRows((data || []).map((d: any) => ({
      id: d.id,
      product_name: d.formulation_version?.split(' — ')[0] || 'Unknown',
      formulation_code: d.formulation_version?.split(' — ')[1] || '',
      formulation_version: d.formulation_version || '',
      tonnes_produced: Number(d.tonnes_produced) || 0,
      rm_cost_per_mt_usd: Number(d.rm_cost_per_mt_usd) || 0,
      total_rm_cost_usd: (Number(d.tonnes_produced) || 0) * (Number(d.rm_cost_per_mt_usd) || 0),
      sell_price_per_mt_usd: Number(d.sell_price_per_mt_usd) || 0,
      total_sell_value_usd: (Number(d.tonnes_produced) || 0) * (Number(d.sell_price_per_mt_usd) || 0),
      margin_per_mt_usd: Number(d.margin_per_mt_usd) || 0,
      total_margin_usd: Number(d.total_margin_usd) || 0,
      margin_pct: Number(d.margin_pct) || 0,
    })));
    setLoading(false);
  }, [period.start, period.end]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // Fetch formulations list for Tab 2
  useEffect(() => {
    async function fetchFormulations() {
      const { data } = await supabase
        .from('formulations')
        .select('id, code, name, version, status')
        .order('name');
      setFormulations(data || []);
    }
    fetchFormulations();
  }, []);

  // Generate report from production orders
  async function handleGenerate() {
    setGenerating(true);
    try {
      // Delete existing summary for this period
      await supabase
        .from('period_production_summary')
        .delete()
        .eq('period_start', period.start)
        .eq('period_end', period.end);

      // Fetch completed production orders in the period
      const { data: orders } = await supabase
        .from('production_orders')
        .select('id, batch_number, formulation_id, actual_qty, raw_material_cost, total_cost, cost_per_unit, formulations(id, code, name, version)')
        .eq('status', 'completed')
        .gte('actual_end', period.start)
        .lte('actual_end', period.end + 'T23:59:59');

      if (!orders || orders.length === 0) {
        alert('No completed production orders found for this period.');
        setGenerating(false);
        return;
      }

      // Group by formulation
      const grouped: Record<string, {
        formulation: any;
        totalQtyKg: number;
        totalRmCost: number;
        totalCost: number;
        count: number;
      }> = {};

      orders.forEach((o: any) => {
        const fId = o.formulation_id || 'unknown';
        if (!grouped[fId]) {
          grouped[fId] = {
            formulation: o.formulations,
            totalQtyKg: 0,
            totalRmCost: 0,
            totalCost: 0,
            count: 0,
          };
        }
        grouped[fId].totalQtyKg += Number(o.actual_qty) || 0;
        grouped[fId].totalRmCost += Number(o.raw_material_cost) || 0;
        grouped[fId].totalCost += Number(o.total_cost) || 0;
        grouped[fId].count += 1;
      });

      const rate = parseFloat(usdZigRate) || defaultRate || 1;

      // Build summary rows
      const summaryInserts = Object.entries(grouped).map(([, g]) => {
        const tonnesProduced = g.totalQtyKg / 1000;
        const rmCostPerMt = tonnesProduced > 0 ? g.totalRmCost / tonnesProduced : 0;
        // Placeholder sell price — to be updated manually or from a pricing table
        const sellPricePerMt = rmCostPerMt * 1.35; // Default 35% markup estimate
        const marginPerMt = sellPricePerMt - rmCostPerMt;
        const totalMargin = marginPerMt * tonnesProduced;
        const marginPct = sellPricePerMt > 0 ? (marginPerMt / sellPricePerMt) * 100 : 0;

        const fName = g.formulation?.name || 'Unknown';
        const fCode = g.formulation?.code || '';
        const fVersion = `${fName} — ${fCode} v${g.formulation?.version || 1}`;

        return {
          period_start: period.start,
          period_end: period.end,
          product_id: g.formulation?.id || null,
          formulation_version: fVersion,
          tonnes_produced: parseFloat(tonnesProduced.toFixed(4)),
          rm_cost_per_mt_usd: parseFloat(rmCostPerMt.toFixed(4)),
          sell_price_per_mt_usd: parseFloat(sellPricePerMt.toFixed(4)),
          margin_per_mt_usd: parseFloat(marginPerMt.toFixed(4)),
          total_margin_usd: parseFloat(totalMargin.toFixed(4)),
          margin_pct: parseFloat(marginPct.toFixed(4)),
          usd_zig_rate: rate,
        };
      });

      if (summaryInserts.length > 0) {
        const { error } = await supabase.from('period_production_summary').insert(summaryInserts);
        if (error) throw error;
      }

      await fetchSummary();
    } catch (error: any) {
      console.error('Error generating report:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  }

  // Tab 2: Load formulation versions with ingredient costs
  async function loadFormulationVersions(productName: string) {
    setLoadingVersions(true);
    setSelectedProduct(productName);

    // Find all formulation versions for this product
    const matchingFormulations = formulations.filter(f => f.name === productName);

    const versions: FormulationVersion[] = [];

    for (const f of matchingFormulations) {
      // Fetch ingredients
      const { data: ingredients } = await supabase
        .from('formulation_ingredients')
        .select('raw_material_id, quantity, percentage, raw_materials(id, code, name, cost_per_unit)')
        .eq('formulation_id', f.id)
        .order('sort_order');

      // Fetch latest costs from rm_cost_register
      const { data: costs } = await supabase
        .from('rm_cost_register')
        .select('raw_material_id, cost_per_tonne_usd')
        .order('effective_date', { ascending: false });

      const costMap: Record<string, number> = {};
      (costs || []).forEach((c: any) => {
        if (!costMap[c.raw_material_id]) {
          costMap[c.raw_material_id] = Number(c.cost_per_tonne_usd);
        }
      });

      const ingredientCosts: IngredientCost[] = (ingredients || []).map((ing: any) => {
        const rm = ing.raw_materials;
        const kgPerTonne = (Number(ing.quantity) / 50) * 1000; // Scale from 50kg batch to 1 tonne
        const costPerTonneUsd = costMap[ing.raw_material_id] || (Number(rm?.cost_per_unit) || 0);
        const costPerKg = costPerTonneUsd / 1000;
        const costContribution = kgPerTonne * costPerKg;

        return {
          raw_material_id: ing.raw_material_id,
          ingredient_name: rm?.name || 'Unknown',
          ingredient_code: rm?.code || '',
          kg_per_tonne: parseFloat(kgPerTonne.toFixed(4)),
          cost_per_kg_usd: parseFloat(costPerKg.toFixed(6)),
          cost_contribution: parseFloat(costContribution.toFixed(4)),
          percentage: Number(ing.percentage) || 0,
        };
      });

      const totalCostPerTonne = ingredientCosts.reduce((s, i) => s + i.cost_contribution, 0);

      versions.push({
        id: f.id,
        code: f.code,
        name: f.name,
        version: f.version,
        ingredients: ingredientCosts,
        totalCostPerTonne: parseFloat(totalCostPerTonne.toFixed(4)),
      });
    }

    setFormulationVersions(versions);
    setLoadingVersions(false);
  }

  // Export CSV
  function handleExport() {
    if (summaryRows.length === 0) {
      alert('No data to export.');
      return;
    }
    const headers = [
      'Product', 'Formulation Version', 'Tonnes Produced', 'RM Cost/MT (USD)',
      'Total RM Cost (USD)', 'Sell Price/MT (USD)', 'Total Sell Value (USD)',
      'Margin/MT (USD)', 'Total Margin (USD)', 'Margin %',
    ];
    const csvRows = summaryRows.map(r => [
      r.product_name, r.formulation_version, r.tonnes_produced.toFixed(2),
      r.rm_cost_per_mt_usd.toFixed(2), r.total_rm_cost_usd.toFixed(2),
      r.sell_price_per_mt_usd.toFixed(2), r.total_sell_value_usd.toFixed(2),
      r.margin_per_mt_usd.toFixed(2), r.total_margin_usd.toFixed(2),
      r.margin_pct.toFixed(2),
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Gross_Margin_Report_${period.start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Stats
  const totalProducts = summaryRows.length;
  const avgMargin = totalProducts > 0 ? summaryRows.reduce((s, r) => s + r.margin_pct, 0) / totalProducts : 0;
  const below25 = summaryRows.filter(r => r.margin_pct < 25).length;
  const below15 = summaryRows.filter(r => r.margin_pct < 15).length;

  // Grand totals
  const grandTotals = useMemo(() => ({
    tonnes: summaryRows.reduce((s, r) => s + r.tonnes_produced, 0),
    totalRmCost: summaryRows.reduce((s, r) => s + r.total_rm_cost_usd, 0),
    totalSellValue: summaryRows.reduce((s, r) => s + r.total_sell_value_usd, 0),
    totalMargin: summaryRows.reduce((s, r) => s + r.total_margin_usd, 0),
  }), [summaryRows]);

  // Unique product names for Tab 2 dropdown
  const productNames = useMemo(() => {
    const names = [...new Set(formulations.map(f => f.name))];
    return names.sort();
  }, [formulations]);

  function getMarginRowClass(pct: number): string {
    if (pct < 15) return 'bg-red-50';
    if (pct < 25) return 'bg-amber-50';
    return '';
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Gross Margin Report</h1>
          <p className="text-sm text-slate-500 mt-1">Production cost analysis and margin tracking</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-end gap-4 bg-white border border-slate-200 rounded-lg p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Period</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
          >
            {monthOptions.map((opt, i) => (
              <option key={i} value={i}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            USD:ZiG Rate {defaultRate && <span className="text-slate-400">(default: {defaultRate})</span>}
          </label>
          <input
            type="number"
            step="0.0001"
            value={usdZigRate}
            onChange={(e) => setUsdZigRate(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none w-32"
            placeholder="e.g. 50"
          />
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Generating...' : 'Generate Report'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Products" value={totalProducts} icon={Package} />
        <StatCard title="Average Margin" value={`${avgMargin.toFixed(1)}%`} icon={TrendingUp} color="emerald" />
        <StatCard title="Below 25%" value={below25} icon={AlertTriangle} color="amber" />
        <StatCard title="Below 15%" value={below15} icon={AlertTriangle} color="red" />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab 1: Monthly Summary */}
      {activeTab === 'Monthly Summary' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
            </div>
          ) : summaryRows.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No gross margin data for this period.</p>
              <p className="text-slate-400 text-xs mt-1">Click "Generate Report" to calculate from production orders.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-600 min-w-[180px]">Product</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-600 min-w-[120px]">Formulation</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-600">Tonnes</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-600">RM Cost/MT</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-600">Total RM Cost</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-600">Sell Price/MT</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-600">Total Sell Value</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-600">Margin/MT</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-600">Total Margin</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-600">Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summaryRows.map((row, idx) => (
                      <tr key={row.id || idx} className={`hover:bg-slate-50 transition-colors ${getMarginRowClass(row.margin_pct)}`}>
                        <td className="px-3 py-2 font-medium text-slate-800">{row.product_name}</td>
                        <td className="px-3 py-2 text-slate-600 font-mono text-xs">{row.formulation_code || row.formulation_version}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.tonnes_produced.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">${row.rm_cost_per_mt_usd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">${row.total_rm_cost_usd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">${row.sell_price_per_mt_usd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">${row.total_sell_value_usd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">${row.margin_per_mt_usd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">${row.total_margin_usd.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-bold ${
                          row.margin_pct < 15 ? 'text-red-600' : row.margin_pct < 25 ? 'text-amber-600' : 'text-emerald-600'
                        }`}>
                          {row.margin_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    {/* Grand Totals */}
                    <tr className="bg-slate-50 font-semibold border-t-2 border-slate-300">
                      <td className="px-3 py-2.5 text-slate-700" colSpan={2}>Grand Totals</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{grandTotals.tonnes.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">—</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">${grandTotals.totalRmCost.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">—</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">${grandTotals.totalSellValue.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">—</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">${grandTotals.totalMargin.toFixed(2)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${
                        grandTotals.totalSellValue > 0
                          ? ((grandTotals.totalMargin / grandTotals.totalSellValue) * 100 < 15 ? 'text-red-600' :
                             (grandTotals.totalMargin / grandTotals.totalSellValue) * 100 < 25 ? 'text-amber-600' : 'text-emerald-600')
                          : 'text-slate-500'
                      }`}>
                        {grandTotals.totalSellValue > 0
                          ? `${((grandTotals.totalMargin / grandTotals.totalSellValue) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tab 2: Formulation Cost Comparison */}
      {activeTab === 'Formulation Cost Comparison' && (
        <div className="space-y-4">
          {/* Product Selector */}
          <div className="flex items-end gap-4 bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex-1 max-w-md">
              <label className="block text-xs font-medium text-slate-600 mb-1">Product</label>
              <select
                value={selectedProduct}
                onChange={(e) => {
                  if (e.target.value) loadFormulationVersions(e.target.value);
                  else { setSelectedProduct(''); setFormulationVersions([]); }
                }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
              >
                <option value="">Select a product...</option>
                {productNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          {loadingVersions ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
            </div>
          ) : formulationVersions.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Select a product to compare formulation versions.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-600 min-w-[180px] sticky left-0 bg-slate-50">Ingredient</th>
                      {formulationVersions.map(v => (
                        <th key={v.id} colSpan={3} className="px-3 py-2.5 text-center font-medium text-teal-700 border-l border-slate-200">
                          {v.code} v{v.version}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-left text-xs text-slate-500 sticky left-0 bg-slate-50"></th>
                      {formulationVersions.map(v => (
                        <React.Fragment key={v.id}>
                          <th className="px-2 py-2 text-right text-xs text-slate-500 border-l border-slate-200">kg/MT</th>
                          <th className="px-2 py-2 text-right text-xs text-slate-500">$/kg</th>
                          <th className="px-2 py-2 text-right text-xs text-slate-500">Cost</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {/* Get all unique ingredient names */}
                    {(() => {
                      const allIngredients = new Map<string, string>();
                      formulationVersions.forEach(v => {
                        v.ingredients.forEach(ing => {
                          allIngredients.set(ing.raw_material_id, `${ing.ingredient_code} — ${ing.ingredient_name}`);
                        });
                      });

                      return Array.from(allIngredients.entries()).map(([rmId, label]) => (
                        <tr key={rmId} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-800 sticky left-0 bg-white">{label}</td>
                          {formulationVersions.map(v => {
                            const ing = v.ingredients.find(i => i.raw_material_id === rmId);
                            return (
                              <React.Fragment key={v.id}>
                                <td className="px-2 py-2 text-right tabular-nums text-slate-600 border-l border-slate-100">
                                  {ing ? ing.kg_per_tonne.toFixed(2) : '—'}
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                                  {ing ? `$${ing.cost_per_kg_usd.toFixed(4)}` : '—'}
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-700">
                                  {ing ? `$${ing.cost_contribution.toFixed(2)}` : '—'}
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                    {/* Total row */}
                    <tr className="bg-teal-50 font-semibold border-t-2 border-teal-300">
                      <td className="px-3 py-2.5 text-teal-800 sticky left-0 bg-teal-50">Total Cost / Tonne</td>
                      {formulationVersions.map(v => (
                        <td key={v.id} colSpan={3} className="px-3 py-2.5 text-center tabular-nums text-teal-800 border-l border-teal-200 text-sm">
                          ${v.totalCostPerTonne.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
