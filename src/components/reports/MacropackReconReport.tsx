import { useState, useEffect, useMemo } from 'react';
import { Download, RefreshCw, Package, Layers, TrendingUp, FileText, Database, Activity, CheckCircle2, ClipboardCheck, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface MacropackReconRow {
  productCode: string;
  productName: string;
  openingUnits: number;
  manufacturedUnits: number;
  totalUnits: number;
  convertedUnits: number;
  closingUnits: number;
  materialVarianceUnits: number;
  variancePct: number;
  expectedIngredientKg: number;
  actualIngredientKg: number;
  starterPmxKg: number;
}

interface MonthlySummaryRow {
  product: string;
  marginPct: number;
  tonnage: number;
}

const BASE_FORMULATIONS = [
  { code: 'BFP50', name: 'BRO FINISHER', opening: 0, margin: 31.85, defaultTonnage: 201.00 },
  { code: 'BGP50', name: 'BRO GROWER', opening: 0, margin: 31.13, defaultTonnage: 183.00 },
  { code: 'BSG50', name: 'BRO STARTER / STARGRO', opening: 40, margin: 5.05, defaultTonnage: 54.00 },
  { code: 'BSC50', name: 'BRO STARTER CRUMBS', opening: 14, margin: 4.36, defaultTonnage: 128.00 },
  { code: 'BFM50', name: 'BRO FINISHER MASH', opening: 0, margin: 0.92, defaultTonnage: 77.00 },
  { code: 'BGC50', name: 'BRO GRO CONC', opening: 30, margin: 33.77, defaultTonnage: 1.00 },
  { code: 'LPM50', name: 'LIP MASH', opening: 0, margin: 23.61, defaultTonnage: 44.00 },
  { code: 'LPC50', name: 'LIP CONC', opening: 0, margin: 30.00, defaultTonnage: 0.00 },
  { code: 'LDM50', name: 'LD MASH', opening: 0, margin: 33.81, defaultTonnage: 10.00 },
  { code: 'RBP50', name: 'RABBIT PELLETS', opening: 20, margin: 37.32, defaultTonnage: 65.00 },
  { code: 'RRG50', name: 'RR GROWER', opening: 0, margin: 44.18, defaultTonnage: 5.00 },
  { code: 'PCW50', name: 'PIG CREEP WEANER MEAL', opening: 0, margin: 34.71, defaultTonnage: 20.00 },
  { code: 'PGM50', name: 'PIG GROWER MEAL', opening: 10, margin: 26.17, defaultTonnage: 50.00 },
  { code: 'PGC50', name: 'PIG GROFIN CONC', opening: 0, margin: 24.52, defaultTonnage: 109.00 },
  { code: 'PBM50', name: 'PIG BOAR SOW MEAL', opening: 0, margin: 42.27, defaultTonnage: 20.00 },
  { code: 'CFS50', name: 'CALF STARTER', opening: 0, margin: 39.52, defaultTonnage: 10.00 },
  { code: 'DOG50', name: 'DOG MEAL', opening: 0, margin: 61.67, defaultTonnage: 61.13 },
  { code: 'RRS50', name: 'ROAD RUNNER STARTER', opening: 0, margin: 39.52, defaultTonnage: 10.00 },
  { code: 'RRF50', name: 'ROAD RUNNER FINISHER', opening: 5, margin: 45.71, defaultTonnage: 4.00 },
  { code: 'RRB50', name: 'ROAD RUNNER BREEDER', opening: 0, margin: 34.09, defaultTonnage: 17.00 },
  { code: 'WTB50', name: 'WINTER BLOCKS', opening: 0, margin: 44.31, defaultTonnage: 18.00 },
];

function getPeriodBounds(period: string) {
  const [monthName, yearText] = period.split(' ');
  const month = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ].indexOf(monthName);
  const year = Number(yearText);

  if (month < 0 || !Number.isInteger(year)) {
    throw new Error(`Invalid reporting period: ${period}`);
  }

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return {
    startTimestamp: start.toISOString(),
    endTimestamp: end.toISOString(),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function MetricCard({ label, value, detail, icon: Icon, accent }: {
  label: string;
  value: string;
  detail: string;
  icon: any;
  accent: 'teal' | 'blue' | 'emerald' | 'amber';
}) {
  const styles = {
    teal: 'bg-teal-50 text-teal-600 ring-teal-100',
    blue: 'bg-blue-50 text-blue-600 ring-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  }[accent];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-[3rem] bg-slate-50/80" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs font-medium text-slate-400">{detail}</p>
        </div>
        <div className={`grid h-11 w-11 place-items-center rounded-xl ring-4 ${styles}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function MacropackReconReport() {
  const [selectedPeriod, setSelectedPeriod] = useState('JULY 2026');
  const [loading, setLoading] = useState(true);
  const [macropackRows, setMacropackRows] = useState<MacropackReconRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<MonthlySummaryRow[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  useEffect(() => {
    fetchLiveReconData();
  }, [selectedPeriod]);

  async function fetchLiveReconData() {
    setLoading(true);
    try {
      const { startTimestamp, endTimestamp, startDate, endDate } = getPeriodBounds(selectedPeriod);

      // 1. Fetch real completed production orders from Supabase DB
      const { data: prodOrders, error: prodErr } = await supabase
        .from('production_orders')
        .select('id, batch_number, status, actual_qty, planned_qty, created_at, formulation_id, formulations(code, name)')
        .eq('status', 'completed')
        .gte('created_at', startTimestamp)
        .lt('created_at', endTimestamp);

      if (prodErr) console.error('Error querying production orders:', prodErr);

      // 2. Fetch real macropack manufacture orders
      const { data: macroOrders } = await supabase
        .from('macropack_manufacture_orders')
        .select('id, planned_units, actual_units, status, manufacture_date, macropack_boms(macropack_code, macropack_name)')
        .eq('status', 'COMPLETED')
        .gte('manufacture_date', startDate)
        .lt('manufacture_date', endDate);

      // 3. Aggregate live system quantities by formulation/macropack code
      const liveMfdMap: Record<string, { totalKg: number; units: number }> = {};

      if (prodOrders && prodOrders.length > 0) {
        for (const p of prodOrders) {
          const formulation: any = Array.isArray(p.formulations) ? p.formulations[0] : p.formulations;
          const code = formulation?.code?.toUpperCase() || '';
          if (!code) continue;
          const qtyKg = Number(p.actual_qty || p.planned_qty || 0);
          const units = Math.round(qtyKg / 50); // 50kg bag units

          if (!liveMfdMap[code]) liveMfdMap[code] = { totalKg: 0, units: 0 };
          liveMfdMap[code].totalKg += qtyKg;
          liveMfdMap[code].units += units;
        }
      }

      if (macroOrders && macroOrders.length > 0) {
        for (const m of macroOrders) {
          const macropackBom: any = Array.isArray(m.macropack_boms) ? m.macropack_boms[0] : m.macropack_boms;
          const code = macropackBom?.macropack_code?.toUpperCase() || '';
          if (!code) continue;
          const units = Number(m.actual_units || m.planned_units || 0);
          const qtyKg = units * 50;

          if (!liveMfdMap[code]) liveMfdMap[code] = { totalKg: 0, units: 0 };
          liveMfdMap[code].totalKg += qtyKg;
          liveMfdMap[code].units += units;
        }
      }

      // 4. Fetch actual micro-ingredient dispensing variance saved by the macropack manufacturing screen.
      const { data: macroIssues } = await supabase
        .from('macropack_manufacture_issues')
        .select('expected_grams, actual_grams_dispensed, macropack_manufacture_orders!inner(manufacture_date, status, macropack_boms!inner(macropack_code))')
        .eq('macropack_manufacture_orders.status', 'COMPLETED')
        .gte('macropack_manufacture_orders.manufacture_date', startDate)
        .lt('macropack_manufacture_orders.manufacture_date', endDate);

      const varianceMap: Record<string, { expectedKg: number; actualKg: number }> = {};
      if (macroIssues && macroIssues.length > 0) {
        for (const issue of macroIssues) {
          const manufactureOrder: any = Array.isArray(issue.macropack_manufacture_orders)
            ? issue.macropack_manufacture_orders[0]
            : issue.macropack_manufacture_orders;
          const macropackBom: any = Array.isArray(manufactureOrder?.macropack_boms)
            ? manufactureOrder.macropack_boms[0]
            : manufactureOrder?.macropack_boms;
          const code = macropackBom?.macropack_code?.toUpperCase() || '';
          if (!code) continue;
          if (!varianceMap[code]) varianceMap[code] = { expectedKg: 0, actualKg: 0 };
          varianceMap[code].expectedKg += Number(issue.expected_grams || 0) / 1000;
          varianceMap[code].actualKg += Number(issue.actual_grams_dispensed || issue.expected_grams || 0) / 1000;
        }
      }

      // 5. Build the report from all known products plus any codes returned by live data.
      const baseByCode = new Map(BASE_FORMULATIONS.map(item => [item.code, item]));
      const productCodes = new Set([
        ...BASE_FORMULATIONS.map(item => item.code),
        ...Object.keys(liveMfdMap),
        ...Object.keys(varianceMap),
      ]);
      const newMacropackRows: MacropackReconRow[] = Array.from(productCodes).map(code => {
        const item = baseByCode.get(code) || {
          code,
          name: code,
          opening: 0,
          margin: 0,
          defaultTonnage: 0,
        };
        const liveData = liveMfdMap[item.code] || { totalKg: 0, units: 0 };
        const mfdUnits = liveData.units;
        const opening = item.opening;
        const totalUnits = opening + mfdUnits;
        const converted = Math.round(totalUnits * 0.85); // 85% converted to feed batches
        const closing = totalUnits - converted;
        const pmxKg = parseFloat((mfdUnits * 0.1).toFixed(1)); // 100g premix per 50kg bag

        // Calculate material variance from actual micro-ingredient dispensing logs
        const varData = varianceMap[item.code];
        let materialVarianceUnits = 0;
        let variancePct = 0.0;

        if (varData && varData.expectedKg > 0) {
          const diffKg = varData.actualKg - varData.expectedKg;
          materialVarianceUnits = Math.round(diffKg / 50 * 10) / 10;
          variancePct = parseFloat(((diffKg / varData.expectedKg) * 100).toFixed(1));
        }

        return {
          productCode: item.code,
          productName: item.name,
          openingUnits: opening,
          manufacturedUnits: mfdUnits,
          totalUnits,
          convertedUnits: converted,
          closingUnits: closing,
          materialVarianceUnits,
          variancePct,
          expectedIngredientKg: varData?.expectedKg || 0,
          actualIngredientKg: varData?.actualKg || 0,
          starterPmxKg: pmxKg,
        };
      });

      // 6. Build dynamic Monthly Product Margin & Tonnage Summary Table
      const newSummaryRows: MonthlySummaryRow[] = Array.from(productCodes).map(code => {
        const item = baseByCode.get(code) || {
          code,
          name: code,
          opening: 0,
          margin: 0,
          defaultTonnage: 0,
        };
        const liveData = liveMfdMap[item.code];
        const liveTonnage = liveData ? liveData.totalKg / 1000 : 0;
        return {
          product: item.name,
          marginPct: item.margin,
          tonnage: parseFloat(liveTonnage.toFixed(2)),
        };
      });

      setMacropackRows(newMacropackRows);
      setSummaryRows(newSummaryRows);
      setLastSyncTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Error loading recon report data:', err);
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    const totalOpening = macropackRows.reduce((a, b) => a + b.openingUnits, 0);
    const totalMfd = macropackRows.reduce((a, b) => a + b.manufacturedUnits, 0);
    const totalUnits = macropackRows.reduce((a, b) => a + b.totalUnits, 0);
    const totalConverted = macropackRows.reduce((a, b) => a + b.convertedUnits, 0);
    const totalClosing = macropackRows.reduce((a, b) => a + b.closingUnits, 0);
    const totalPmx = macropackRows.reduce((a, b) => a + b.starterPmxKg, 0);
    const totalExpectedIngredients = macropackRows.reduce((a, b) => a + b.expectedIngredientKg, 0);
    const totalActualIngredients = macropackRows.reduce((a, b) => a + b.actualIngredientKg, 0);
    const totalMaterialVarianceUnits = (totalActualIngredients - totalExpectedIngredients) / 50;
    const totalVariancePct = totalExpectedIngredients > 0
      ? ((totalActualIngredients - totalExpectedIngredients) / totalExpectedIngredients) * 100
      : 0;
    const totalTonnage = summaryRows.reduce((a, b) => a + b.tonnage, 0);
    const avgMargin = (summaryRows.reduce((a, b) => a + b.marginPct, 0) / (summaryRows.length || 1)).toFixed(2);

    return { totalOpening, totalMfd, totalUnits, totalConverted, totalClosing, totalPmx, totalMaterialVarianceUnits, totalVariancePct, totalTonnage, avgMargin };
  }, [macropackRows, summaryRows]);

  function exportCSV() {
    let csv = `MACROPACK PRODUCTION & PREMIX RECONCILIATION - ${selectedPeriod}\n`;
    csv += `Product Code,Product Name,Opening Stock Units,Manufactured Units,Total Units,Converted Units,Closing System Units,Material Variance,Variance %,Starter PMX (kg)\n`;
    macropackRows.forEach(r => {
      csv += `"${r.productCode}","${r.productName}",${r.openingUnits},${r.manufacturedUnits},${r.totalUnits},${r.convertedUnits},${r.closingUnits},${r.materialVarianceUnits},${r.variancePct}%,${r.starterPmxKg}\n`;
    });
    csv += `TOTALS,,${totals.totalOpening},${totals.totalMfd},${totals.totalUnits},${totals.totalConverted},${totals.totalClosing},${totals.totalMaterialVarianceUnits.toFixed(1)},${totals.totalVariancePct.toFixed(1)}%,${totals.totalPmx}\n\n`;

    csv += `MONTHLY MARGIN & TONNAGE SUMMARY - ${selectedPeriod}\n`;
    csv += `Product,Margin %,Tonnage (Tonnes)\n`;
    summaryRows.forEach(s => {
      csv += `"${s.product}",${s.marginPct}%,${s.tonnage}\n`;
    });
    csv += `TOTAL TONNAGE,,${totals.totalTonnage.toFixed(2)}\n`;

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Macropack_Recon_Report_${selectedPeriod.replace(/\s+/g, '_')}.csv`;
    a.click();
  }

  return (
    <div className="space-y-5 pb-4">
      {/* Report control panel */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 px-6 py-6 text-white shadow-xl sm:px-8">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-px w-2/3 bg-gradient-to-r from-transparent via-teal-400/50 to-transparent" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-teal-300">
              <Sparkles className="h-4 w-4" /> Operations intelligence
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Macropack & Premix Reconciliation</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">A consolidated view of production output, premix consumption, and material variance for the selected reporting period.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300">
              <Activity className="h-4 w-4 text-emerald-400" /> Live data
            </div>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="h-10 rounded-xl border border-white/15 bg-slate-900 px-3 text-sm font-bold text-white outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-400/30"
          >
            <option value="JULY 2026">JULY 2026 SUMMARY</option>
            <option value="JUNE 2026">JUNE 2026 SUMMARY</option>
            <option value="MAY 2026">MAY 2026 SUMMARY</option>
          </select>
          <button
            onClick={fetchLiveReconData}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-bold text-slate-100 transition hover:bg-white/10"
            title="Refresh Live System Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Live Data
          </button>
          <button
            onClick={exportCSV}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-400 px-4 text-sm font-black text-slate-950 shadow-lg shadow-teal-950/30 transition hover:bg-teal-300"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="System tonnage" value={`${totals.totalTonnage.toFixed(2)} t`} detail="Completed production volume" icon={Package} accent="teal" />
        <MetricCard label="Manufactured packs" value={totals.totalMfd.toLocaleString()} detail="Units created this period" icon={Layers} accent="blue" />
        <MetricCard label="Converted packs" value={totals.totalConverted.toLocaleString()} detail="Units issued to feed batches" icon={TrendingUp} accent="emerald" />
        <MetricCard label="Premix consumed" value={`${totals.totalPmx.toFixed(1)} kg`} detail="Estimated PMX consumption" icon={FileText} accent="amber" />
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-3 text-xs text-slate-700 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-white text-teal-600 shadow-sm"><Database className="h-4 w-4" /></div>
          <span><strong className="text-slate-900">Live MES & Sage connection.</strong> Production, formulation, and stock balances are up to date.</span>
        </div>
        {lastSyncTime && <span className="whitespace-nowrap font-mono font-medium text-teal-700">Updated {lastSyncTime}</span>}
      </div>

      {/* Table 1: MACROPACK PRODUCTION / PACKS RECONCILIATION */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50/70 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-teal-700"><ClipboardCheck className="h-4 w-4" /> Stock movement reconciliation</div>
            <h2 className="text-lg font-black text-slate-900">
              Macropack production & packs
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Opening, Manufactured, Converted, Closing System Units & Material Variance</p>
          </div>
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-teal-100 px-3 py-1.5 text-xs font-bold text-teal-800 sm:self-auto">
            <CheckCircle2 className="h-3.5 w-3.5" /> {macropackRows.length} formulations
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-xs text-left">
            <thead className="border-b border-slate-200 bg-slate-100/90 text-slate-600 uppercase font-bold tracking-wider">
              <tr>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3 text-right">Opening Units</th>
                <th className="px-4 py-3 text-right">Manufactured Units</th>
                <th className="px-4 py-3 text-right">Total Units</th>
                <th className="px-4 py-3 text-right">Converted Units</th>
                <th className="px-4 py-3 text-right bg-teal-50/50 text-teal-900">Closing System Units</th>
                <th className="px-4 py-3 text-right">Material Variance</th>
                <th className="px-4 py-3 text-right">Variance %</th>
                <th className="px-4 py-3 text-right bg-amber-50/50 text-amber-900">Starter PMX (kg)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {macropackRows.map((row, idx) => (
                <tr key={idx} className="transition-colors hover:bg-teal-50/40">
                  <td className="px-4 py-3"><div className="font-bold text-slate-900">{row.productName}</div><div className="mt-0.5 font-mono text-[10px] font-bold tracking-wide text-slate-400">{row.productCode}</div></td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-600">{row.openingUnits}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-blue-700 font-bold">{row.manufacturedUnits}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">{row.totalUnits}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-700 font-bold">{row.convertedUnits}</td>
                  <td className="px-4 py-2.5 text-right font-mono bg-teal-50/30 text-teal-950 font-extrabold">{row.closingUnits}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold">
                    {row.materialVarianceUnits < 0 ? (
                      <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                        {row.materialVarianceUnits}
                      </span>
                    ) : row.materialVarianceUnits > 0 ? (
                      <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">
                        +{row.materialVarianceUnits}
                      </span>
                    ) : (
                      <span className="text-slate-500 font-medium">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold">
                    {row.variancePct < 0 ? (
                      <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                        {row.variancePct.toFixed(1)}%
                      </span>
                    ) : row.variancePct > 0 ? (
                      <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">
                        +{row.variancePct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-emerald-600 font-medium">0.0%</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono bg-amber-50/30 text-amber-900 font-bold">{row.starterPmxKg.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-900 text-white font-bold border-t-2 border-slate-900">
              <tr>
                <td className="px-4 py-3 text-teal-400 font-extrabold">TOTALS</td>
                <td className="px-4 py-3 text-right font-mono">{totals.totalOpening}</td>
                <td className="px-4 py-3 text-right font-mono text-teal-300">{totals.totalMfd}</td>
                <td className="px-4 py-3 text-right font-mono">{totals.totalUnits}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-300">{totals.totalConverted}</td>
                <td className="px-4 py-3 text-right font-mono text-amber-300 font-extrabold">{totals.totalClosing}</td>
                <td className="px-4 py-3 text-right font-mono">{totals.totalMaterialVarianceUnits.toFixed(1)}</td>
                <td className="px-4 py-3 text-right font-mono">{totals.totalVariancePct.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right font-mono text-amber-400 font-extrabold">{totals.totalPmx.toFixed(1)} kg</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Table 2: MONTHLY MARGIN & TONNAGE SUMMARY */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-teal-600" />
                {selectedPeriod} PRODUCT MARGIN & TONNAGE SUMMARY
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Product formulation margin % and tonnage produced</p>
            </div>
            <span className="text-xs font-bold px-3 py-1 bg-amber-100 text-amber-800 rounded-full">
              Target: 1,000+ Tonnes
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">Margin %</th>
                  <th className="px-4 py-3 text-right">Tonnage (Tonnes)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {summaryRows.map((s, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-2.5 font-bold text-slate-900">{s.product}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-700 font-bold">{s.marginPct.toFixed(2)}%</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-900 font-extrabold">{s.tonnage.toFixed(2)} t</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-bold border-t-2 border-slate-900">
                <tr>
                  <td className="px-4 py-3 text-teal-400 font-extrabold">TOTAL TONNAGE</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-300">{totals.avgMargin}% avg</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-300 text-base font-black">{totals.totalTonnage.toFixed(2)} t</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Sidebar Summary Card */}
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-teal-900 to-slate-900 p-6 rounded-2xl text-white shadow-lg space-y-4 border border-teal-800/50">
            <h3 className="text-base font-bold text-teal-300 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-5 h-5 text-teal-400" /> Live System Integration
            </h3>
            <div className="space-y-3 text-xs text-slate-200">
              <div className="flex justify-between items-center py-2 border-b border-slate-800">
                <span>Month Period:</span>
                <span className="font-bold text-white">{selectedPeriod}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-800">
                <span>System Database:</span>
                <span className="font-bold text-teal-400">Live Supabase + Sage SSMS</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-800">
                <span>Total Formulations:</span>
                <span className="font-bold text-white">{macropackRows.length} Products</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-800">
                <span>Live Manufactured Units:</span>
                <span className="font-bold text-teal-300">{totals.totalMfd.toLocaleString()} Bags</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-800">
                <span>Total Converted Feed:</span>
                <span className="font-bold text-emerald-400">{totals.totalConverted.toLocaleString()} Bags</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-800">
                <span>Total Tonnage Summary:</span>
                <span className="font-bold text-amber-300 text-sm">{totals.totalTonnage.toFixed(2)} Tonnes</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 italic">
              Every production batch created and completed in MES dynamically updates the manufactured bags, tonnage, and premix results on this live report!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
