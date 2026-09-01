import { useState, useEffect } from 'react';
import { Calendar, Download, RefreshCw, DollarSign, BarChart3, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import StatCard from '../components/ui/StatCard';
import { MONTH_NAMES } from '../types/reconciliation';

interface LabourCostData {
  production_line: string;
  formulation: string;
  tonnes_produced: number;
  labour_rate: number;
  total_labour_cost: number;
  percentage_of_total: number;
}

// Labour rates per tonne (USD) by formulation sage_code
const LABOUR_RATES: Record<string, number> = {
  // Main Plant
  'BSC50': 2.78, 'BSC05': 2.78,
  'BGP50': 2.78, 'BGP10': 2.78, 'BGP25': 2.78,
  'BFP50': 2.78, 'BFP10': 2.78, 'BFP25': 2.78,
  'BGF50': 8.04, 'BGF25': 2.78,
  'LPM50': 2.78,
  'LDM50': 2.78,
  'RBP50': 7.60, 'RBP10': 7.60, 'RBP25': 7.60, 'RBP05': 7.60,
  'PGFC50': 9.04,
  'PDBSM50': 9.04,
  'PCWM50': 9.04,
  'PGM50': 7.60,
  'DAI50': 6.00,
  
  // Dog Chunks Line
  'HDC10': 18.02, 'HDC8': 18.02,
  
  // Blocks Plant
  'BFAM50': 2.08,
  'BGC50': 6.75,
  'LAC50': 22.07,
  'LPMC50': 22.67,
  'DML50': 6.73,
  
  // Samukai Plant
  'MIS0001': 18.02,
  'RRST50': 25.50, 'RRGR50': 25.50, 'RRFI50': 25.50, 'RRBR50': 25.50,
  
  // Default rate for unmatched formulations
  'DEFAULT': 5.00
};

// Production line mapping by formulation sage_code
const PRODUCTION_LINES: Record<string, string> = {
  // Main Plant
  'BSC50': 'Main Plant', 'BSC05': 'Main Plant',
  'BGP50': 'Main Plant', 'BGP10': 'Main Plant', 'BGP25': 'Main Plant',
  'BFP50': 'Main Plant', 'BFP10': 'Main Plant', 'BFP25': 'Main Plant',
  'BGF50': 'Main Plant', 'BGF25': 'Main Plant',
  'LPM50': 'Main Plant',
  'LDM50': 'Main Plant',
  'RBP50': 'Main Plant', 'RBP10': 'Main Plant', 'RBP25': 'Main Plant', 'RBP05': 'Main Plant',
  'PGFC50': 'Main Plant',
  'PDBSM50': 'Main Plant',
  'PCWM50': 'Main Plant',
  'PGM50': 'Main Plant',
  'DAI50': 'Main Plant',
  
  // Dog Chunks Line
  'HDC10': 'Dog Chunks Line', 'HDC8': 'Dog Chunks Line',
  
  // Blocks Plant
  'BFAM50': 'Blocks Plant',
  'BGC50': 'Blocks Plant',
  'LAC50': 'Blocks Plant',
  'LPMC50': 'Blocks Plant',
  'DML50': 'Blocks Plant',
  
  // Samukai Plant
  'MIS0001': 'Samukai Plant',
  'RRST50': 'Samukai Plant', 'RRGR50': 'Samukai Plant', 'RRFI50': 'Samukai Plant', 'RRBR50': 'Samukai Plant',
};

// Pig pellets detection (any formulation containing "pig" in name)
const isPigPellet = (formulationName: string): boolean => {
  return formulationName.toLowerCase().includes('pig');
};

export default function LabourCostReportPage() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [labourData, setLabourData] = useState<LabourCostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [usdZigRate, setUsdZigRate] = useState<number | null>(null);

  async function fetchLabourData() {
    setLoading(true);
    try {
      const startDate = new Date(selectedYear, selectedMonth - 1, 1);
      const endDate = new Date(selectedYear, selectedMonth, 0);

      // Fetch completed production orders + current labour rates + latest FX rate
      const [ordersRes, ratesRes, fxRes] = await Promise.all([
        supabase
          .from('production_orders')
          .select(`
            id,
            actual_qty,
            status,
            created_at,
            formulation_id,
            formulations!inner(
              id,
              name,
              sage_code
            )
          `)
          .eq('status', 'completed')
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString())
          .order('created_at'),
        supabase
          .from('labour_rates')
          .select('formulation_id, rate_per_tonne_usd, effective_date')
          .order('effective_date', { ascending: false }),
        supabase
          .from('usd_zig_rate_history')
          .select('rate')
          .order('effective_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      setUsdZigRate(fxRes.data?.rate ? Number(fxRes.data.rate) : null);

      const orders = ordersRes.data;
      const ordersError = ordersRes.error;
      if (ordersError) throw ordersError;

      // Build latest-effective rate map keyed by formulation_id
      const dbRatesByFormulation: Record<string, number> = {};
      (ratesRes.data || []).forEach((r: any) => {
        if (dbRatesByFormulation[r.formulation_id] === undefined) {
          dbRatesByFormulation[r.formulation_id] = Number(r.rate_per_tonne_usd);
        }
      });

      // Process data for labour cost calculation
      const formulationMap = new Map<string, {
        formulation_name: string;
        sage_code: string;
        total_tonnes: number;
        production_line: string;
        labour_rate: number;
      }>();
      
      orders?.forEach(order => {
        const formulation = order.formulations as any;
        const sageCode = formulation.sage_code;
        const formulationName = formulation.name;
        const actualQty = order.actual_qty || 0;
        const tonnesProduced = actualQty / 1000; // Convert kg to tonnes
        
        const existing = formulationMap.get(sageCode) || {
          formulation_name: formulationName,
          sage_code: sageCode,
          total_tonnes: 0,
          production_line: '',
          labour_rate: 0
        };

        existing.total_tonnes += tonnesProduced;
        
        // Determine production line
        if (!existing.production_line) {
          if (isPigPellet(formulationName)) {
            existing.production_line = 'Samukai Plant';
          } else {
            existing.production_line = PRODUCTION_LINES[sageCode] || 'Main Plant';
          }
        }
        
        // Determine labour rate: DB (formulation_id) > hardcoded sage_code map > default
        if (!existing.labour_rate) {
          const fromDb = dbRatesByFormulation[(order as any).formulation_id];
          if (typeof fromDb === 'number' && !isNaN(fromDb)) {
            existing.labour_rate = fromDb;
          } else if (isPigPellet(formulationName)) {
            existing.labour_rate = LABOUR_RATES['MIS0001'];
          } else {
            existing.labour_rate = LABOUR_RATES[sageCode] || LABOUR_RATES['DEFAULT'];
          }
        }
        
        formulationMap.set(sageCode, existing);
      });

      // Calculate labour costs and percentages
      const processedData = Array.from(formulationMap.values()).map(item => {
        const totalLabourCost = item.total_tonnes * item.labour_rate;
        return {
          production_line: item.production_line,
          formulation: item.formulation_name,
          tonnes_produced: item.total_tonnes,
          labour_rate: item.labour_rate,
          total_labour_cost: totalLabourCost,
          percentage_of_total: 0 // Will calculate below
        };
      });

      // Calculate total cost and percentages
      const totalCost = processedData.reduce((sum, item) => sum + item.total_labour_cost, 0);
      processedData.forEach(item => {
        item.percentage_of_total = totalCost > 0 ? (item.total_labour_cost / totalCost) * 100 : 0;
      });

      // Sort by total labour cost descending
      processedData.sort((a, b) => b.total_labour_cost - a.total_labour_cost);

      setLabourData(processedData);

    } catch (error: any) {
      console.error('Error fetching labour data:', error);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }

  useEffect(() => {
    fetchLabourData();
  }, [selectedMonth, selectedYear]);

  // Calculate summary metrics
  const totalTonnes = labourData.reduce((sum, item) => sum + item.tonnes_produced, 0);
  const totalLabourCost = labourData.reduce((sum, item) => sum + item.total_labour_cost, 0);
  const avgCostPerTonne = totalTonnes > 0 ? totalLabourCost / totalTonnes : 0;

  // Group by production line for chart
  const lineData = labourData.reduce((acc, item) => {
    const existing = acc.get(item.production_line) || { line: item.production_line, cost: 0, tonnes: 0 };
    existing.cost += item.total_labour_cost;
    existing.tonnes += item.tonnes_produced;
    acc.set(item.production_line, existing);
    return acc;
  }, new Map<string, { line: string; cost: number; tonnes: number }>());

  const lineChartData = Array.from(lineData.values())
    .sort((a, b) => b.cost - a.cost);

  const exportToCSV = () => {
    const headers = [
      'Production Line', 'Formulation', 'Tonnes Produced',
      'Labour Rate (USD/tonne)', 'Total Labour Cost (USD)', 'Total Labour Cost (ZiG)', '% of Total'
    ];
    const rows = labourData.map(item => [
      item.production_line,
      item.formulation,
      item.tonnes_produced.toFixed(2),
      item.labour_rate.toFixed(2),
      item.total_labour_cost.toFixed(2),
      usdZigRate !== null ? (item.total_labour_cost * usdZigRate).toFixed(2) : '',
      `${item.percentage_of_total.toFixed(2)}%`
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `labour-cost-report-${MONTH_NAMES[selectedMonth - 1]}-${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Labour Cost Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {MONTH_NAMES[selectedMonth - 1]} {selectedYear} · Rate-per-tonne analysis by production line
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Refreshed {lastRefresh.toLocaleTimeString()}</span>
          <button onClick={exportToCSV} disabled={labourData.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 bg-white border border-slate-200 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <label className="text-sm font-medium text-slate-600">Month:</label>
          <select value={selectedMonth} onChange={e => setSelectedMonth(parseInt(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Year:</label>
          <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={fetchLabourData} disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          title="Total Tonnes Produced" 
          value={`${totalTonnes.toLocaleString()} T`} 
          icon={BarChart3} 
          color="teal" 
        />
        <StatCard
          title="Total Labour Cost"
          value={`$${totalLabourCost.toLocaleString()}`}
          icon={DollarSign}
          color="emerald"
          subtitle={usdZigRate !== null ? `≈ ZiG ${(totalLabourCost * usdZigRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : undefined}
        />
        <StatCard 
          title="Avg Labour Cost per Tonne" 
          value={`$${avgCostPerTonne.toFixed(2)}`} 
          icon={TrendingUp} 
          color="blue" 
        />
      </div>

      {/* Labour Cost Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Labour Cost Details by Formulation</h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Production Line</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Formulation</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Tonnes Produced</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Labour Rate ($/tonne)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Total Labour Cost (USD)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Total Labour Cost (ZiG)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-20 text-center">
                    <div className="flex items-center justify-center">
                      <RefreshCw className="w-6 h-6 animate-spin text-teal-600" />
                    </div>
                  </td>
                </tr>
              ) : labourData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-20 text-center text-slate-500">
                    <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium">No labour cost data found</p>
                  </td>
                </tr>
              ) : (
                labourData.map((item, index) => (
                  <tr key={index} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-1 rounded">
                        {item.production_line}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{item.formulation}</td>
                    <td className="px-4 py-3 text-right">{item.tonnes_produced.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">${item.labour_rate.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                      ${item.total_labour_cost.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-600">
                      {usdZigRate !== null ? `ZiG ${(item.total_labour_cost * usdZigRate).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-medium text-slate-700">
                        {item.percentage_of_total.toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Labour Cost by Production Line Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Labour Cost by Production Line</h3>
        <div className="space-y-3">
          {lineChartData.map((line, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700">{line.line}</span>
                <span className="text-xs text-slate-500">{line.tonnes.toLocaleString()} T</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-slate-100 rounded-full h-2">
                  <div 
                    className="bg-emerald-600 h-2 rounded-full"
                    style={{ width: `${(line.cost / totalLabourCost) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-emerald-600 w-20 text-right">
                  ${line.cost.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
