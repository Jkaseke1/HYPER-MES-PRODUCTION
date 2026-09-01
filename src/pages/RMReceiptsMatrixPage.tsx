import { useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDate } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, Save } from 'lucide-react';
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

type ReceiptRow = { receipt_date: string; raw_material_name: string; quantity_kg: number };

export default function RMReceiptsMatrixPage() {
  const [month, setMonth] = useState(new Date());
  const [data, setData] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unsaved, setUnsaved] = useState<Record<string, number>>({});

  const days = useMemo(() => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    return eachDayOfInterval({ start, end });
  }, [month]);

  async function fetchData() {
    setLoading(true);
    const start = format(startOfMonth(month), 'yyyy-MM-dd');
    const end = format(endOfMonth(month), 'yyyy-MM-dd');
    const { data: d } = await supabase
      .from('rm_daily_receipts')
      .select('receipt_date, raw_material_name, quantity_kg')
      .gte('receipt_date', start)
      .lte('receipt_date', end);
    setData((d as ReceiptRow[]) || []);
    setUnsaved({});
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, [month]);

  const matrix = useMemo(() => {
    const m: Record<string, Record<number, number>> = {};
    for (const row of data) {
      const name = row.raw_material_name;
      const day = getDate(new Date(row.receipt_date + 'T00:00:00'));
      if (!m[name]) m[name] = {};
      m[name][day] = row.quantity_kg;
    }
    return m;
  }, [data]);

  function getValue(name: string, day: number) {
    const key = `${name}|${day}`;
    if (unsaved[key] !== undefined) return unsaved[key];
    return matrix[name]?.[day] || 0;
  }

  function setValue(name: string, day: number, value: number) {
    const key = `${name}|${day}`;
    setUnsaved((prev) => ({ ...prev, [key]: value }));
  }

  async function saveAll() {
    const entries = Object.entries(unsaved);
    if (entries.length === 0) return;

    for (const [key, qty] of entries) {
      const [name, dayStr] = key.split('|');
      const day = parseInt(dayStr, 10);
      const dateStr = format(new Date(month.getFullYear(), month.getMonth(), day), 'yyyy-MM-dd');

      await supabase.from('rm_daily_receipts').upsert(
        {
          receipt_date: dateStr,
          raw_material_name: name,
          quantity_kg: qty,
        },
        { onConflict: 'receipt_date,raw_material_name' }
      );
    }
    setUnsaved({});
    fetchData();
  }

  function rowTotal(name: string) {
    let sum = 0;
    for (const day of days) {
      sum += getValue(name, getDate(day));
    }
    return sum;
  }

  function exportCSV() {
    const header = ['Material', ...days.map((d) => String(getDate(d))), 'Total'];
    const rows = MATERIAL_NAMES.map((name) => [
      name,
      ...days.map((d) => String(getValue(name, getDate(d)))),
      String(rowTotal(name)),
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RM-Receipts-${format(month, 'yyyy-MM')}.csv`;
    a.click();
  }

  const dayFmt = (d: Date) => getDate(d);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Monthly Receipts Matrix</h1>
          <p className="text-sm text-gray-500 mt-0.5">{format(month, 'MMMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <button onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
          {Object.keys(unsaved).length > 0 && (
            <button onClick={saveAll} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">
              <Save className="w-3.5 h-3.5" /> Save ({Object.keys(unsaved).length})
            </button>
          )}
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-2 py-2 font-medium sticky left-0 bg-gray-50 min-w-[160px] border-r border-gray-200">Raw Material</th>
                {days.map((d) => (
                  <th key={d.toISOString()} className="px-1.5 py-2 font-medium text-center min-w-[44px]">{dayFmt(d)}</th>
                ))}
                <th className="px-2 py-2 font-medium text-right min-w-[70px] border-l border-gray-200">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={days.length + 2} className="py-16 text-center text-gray-400">Loading...</td></tr>
              ) : (
                MATERIAL_NAMES.map((name) => (
                  <tr key={name} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                    <td className="px-2 py-1.5 font-medium text-gray-900 sticky left-0 bg-white border-r border-gray-200 whitespace-nowrap">{name}</td>
                    {days.map((d) => {
                      const day = getDate(d);
                      const val = getValue(name, day);
                      return (
                        <td key={day} className="px-1 py-1 text-center">
                          <input
                            type="number"
                            step="0.001"
                            value={val === 0 ? '' : val}
                            onChange={(e) => setValue(name, day, e.target.value === '' ? 0 : Number(e.target.value))}
                            className={`w-full px-1 py-1 text-center border rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-teal-500 tabular-nums ${
                              val > 0 ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-100 text-gray-400'
                            }`}
                            placeholder="0"
                          />
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right font-semibold text-gray-700 tabular-nums border-l border-gray-200">{rowTotal(name).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
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
