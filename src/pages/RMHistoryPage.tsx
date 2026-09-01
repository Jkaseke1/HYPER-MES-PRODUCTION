import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MATERIAL_NAMES = [
  'Beef Carcass Meal', 'Solvent Soya', 'Full Fat Soya Meal', 'Low Fat Soya Meal',
  'Soya Beans', 'Cotton Seed', 'Cottonseed Meal', 'Sunflower Cake',
  'Sunflower Meal', 'Sunflower Seeds', 'Sesame Seeds', 'Congluten',
  'Maize Yellow', 'Maize White', 'Mealie Meal', 'Millet',
  'Maize Bran', 'Wheat Bran', 'RICE BRAN', 'Sorghum',
  'Mollases', 'Hay Bales', 'Cotton Hulls', 'Cotton cake fuzzy',
  'Lucerne pellets', 'Maltculms', 'Thin Corn', 'Barley Straw',
  'Wheat Straw', 'Sorghum Straw/Pellets', 'Limestone flour', 'Limestone grits',
  'Magnesium Oxide', 'Mono calcium Phosphate', 'Calcium Oxide', 'Salt Fine', 'Salt Course',
];

type Snap = { snapshot_date: string; raw_material_name: string; physical_stock: number; stock_variance: number };

export default function RMHistoryPage() {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [compareDate, setCompareDate] = useState<string>('');
  const [data, setData] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchDates() {
    const { data: d } = await supabase.from('rm_daily_snapshots').select('snapshot_date').order('snapshot_date', { ascending: false });
    const unique = Array.from(new Set((d || []).map((r: any) => r.snapshot_date)));
    setDates(unique);
    if (unique.length > 0 && !selectedDate) setSelectedDate(unique[0]);
  }

  async function fetchData() {
    if (!selectedDate) return;
    setLoading(true);
    const { data: d } = await supabase
      .from('rm_daily_snapshots')
      .select('snapshot_date, raw_material_name, physical_stock, stock_variance')
      .eq('snapshot_date', selectedDate);
    setData((d as Snap[]) || []);
    setLoading(false);
  }

  useEffect(() => { fetchDates(); }, []);
  useEffect(() => { fetchData(); }, [selectedDate]);

  function getRow(name: string) {
    return data.find((d) => d.raw_material_name === name) || {
      snapshot_date: selectedDate,
      raw_material_name: name,
      physical_stock: 0,
      stock_variance: 0,
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Historical Snapshots</h1>
          <p className="text-sm text-gray-500 mt-0.5">View and compare past stock positions</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
          >
            {dates.map((d) => (
              <option key={d} value={d}>{format(new Date(d + 'T00:00:00'), 'EEEE, dd MMM yyyy')}</option>
            ))}
          </select>
          <select
            value={compareDate}
            onChange={(e) => setCompareDate(e.target.value)}
            className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
          >
            <option value="">Compare with...</option>
            {dates.filter((d) => d !== selectedDate).map((d) => (
              <option key={d} value={d}>{format(new Date(d + 'T00:00:00'), 'dd MMM yyyy')}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3 font-medium min-w-[160px]">Raw Material</th>
                <th className="px-3 py-3 font-medium text-right">Physical Stock</th>
                <th className="px-3 py-3 font-medium text-right">Variance</th>
                {compareDate && (
                  <>
                    <th className="px-3 py-3 font-medium text-right border-l border-gray-200">Compare Stock</th>
                    <th className="px-3 py-3 font-medium text-right">Delta</th>
                  </>
                )}
                <th className="px-3 py-3 font-medium text-center w-16">Trend</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={compareDate ? 6 : 4} className="py-16 text-center text-gray-400">Loading...</td></tr>
              ) : (
                MATERIAL_NAMES.map((name) => {
                  const row = getRow(name);
                  const cmp = compareDate ? getRow(name) : null;
                  const delta = cmp ? row.physical_stock - cmp.physical_stock : 0;
                  return (
                    <tr key={name} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                      <td className="px-3 py-2.5 font-medium text-gray-900">{name}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{row.physical_stock.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${Math.abs(row.stock_variance) > 0.1 ? 'text-red-600 font-medium' : 'text-emerald-600'}`}>
                        {row.stock_variance.toFixed(3)}
                      </td>
                      {compareDate && (
                        <>
                          <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums border-l border-gray-200">{cmp?.physical_stock.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) || '0'}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                            {delta > 0 ? '+' : ''}{delta.toFixed(3)}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2.5 text-center">
                        <button className="text-gray-400 hover:text-teal-600 transition-colors" title="View trend">
                          <TrendingUp className="w-4 h-4" />
                        </button>
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
  );
}
