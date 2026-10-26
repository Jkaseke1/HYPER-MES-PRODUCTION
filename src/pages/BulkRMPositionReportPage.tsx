import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
import { AlertTriangle, Download, RefreshCw, Scale, FileText, ArrowRightLeft, Factory, PackageCheck } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

const BULK_ORDER = [
  'Beef Carcass Meal', 'Poultry Render', 'Solvent Soya', 'Full Fat Soya Meal', 'Low Fat Soya Meal',
  'Soya Beans', 'Cotton Seed', 'Cottonseed Meal', 'Sunflower Cake', 'Sunflower Meal', 'Sunflower Seeds',
  'Sesame Seeds', 'Congluten', 'Maize Yellow', 'Maize White', 'Mealie Meal', 'Millet', 'Maize Bran',
  'Wheat Bran', 'RICE BRAN', 'Sorghum', 'Mollases', 'Hay Bales', 'Cotton Hulls', 'Cotton cake fuzzy',
  'Lucerne pellets', 'Maltculms', 'Thin Corn', 'Barley Straw', 'Wheat Straw', 'Sorghum Straw/Pellets',
  'Limestone flour', 'Limestone grits', 'Magnesium Oxide', 'Mono calcium Phosphate', 'Calcium Oxide',
  'Salt Fine', 'Salt Course',
];

interface Material {
  id: string;
  name: string;
  code: string;
  current_stock: number;
}

interface PositionRow {
  key: string;
  materialId: string | null;
  name: string;
  code: string;
  opening: number;
  weighbridge: number;
  grn: number;
  transfers: number;
  issues: number;
  consumed: number;
  inManufacturing: number;
  physical: number | null;
  system: number;
}

interface BatchRow {
  id: string;
  batch: string;
  formula: string;
  line: string;
  status: string;
  planned: number;
  actual: number;
  issuedKg: number;
  sageIssue: string;
  sageComplete: string;
  fgTransfer: string;
}

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function rel(v: unknown) {
  return Array.isArray(v) ? v[0] || null : v || null;
}

function norm(v: unknown) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function qty(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  if (Math.abs(v) < 0.0005) return '0.00';
  return v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthOptions() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(now, i);
    return {
      label: format(d, 'MMMM yyyy'),
      start: format(startOfMonth(d), 'yyyy-MM-dd'),
      end: format(endOfMonth(d), 'yyyy-MM-dd'),
    };
  });
}

async function fetchPaged<T>(build: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>) {
  const page = 1000;
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < page) break;
    from += page;
  }
  return rows;
}

function add(map: Record<string, number>, key: string, amount: number) {
  if (!key || !amount) return;
  map[key] = (map[key] || 0) + amount;
}

export default function BulkRMPositionReportPage() {
  const months = useMemo(() => monthOptions(), []);
  const [monthIndex, setMonthIndex] = useState(0);
  const [hideZeros, setHideZeros] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [openingAsAt, setOpeningAsAt] = useState<string | null>(null);

  const period = months[monthIndex];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const openingDate = format(subDays(new Date(`${period.start}T00:00:00`), 1), 'yyyy-MM-dd');
      const endTs = `${period.end}T23:59:59`;

      const [materialsRes, openingSnapsRes, physicalSnapsRes, sageRes, tickets, grns, transfers, issues, createdOrders, completedOrders, openOrders] = await Promise.all([
        supabase.from('raw_materials').select('id, name, code, current_stock').eq('is_active', true).order('name'),
        supabase.from('rm_daily_snapshots').select('snapshot_date, raw_material_name, physical_stock, opening_stock').lte('snapshot_date', openingDate).order('snapshot_date', { ascending: false }).limit(4000),
        supabase.from('rm_daily_snapshots').select('snapshot_date, raw_material_name, physical_stock').lte('snapshot_date', period.end).order('snapshot_date', { ascending: false }).limit(4000),
        supabase.from('sage_stock_balances').select('*'),
        fetchPaged<any>((from, to) =>
          supabase.from('weigh_bridge_tickets')
            .select('id, product_name, product_code, nett_mass, status, created_at')
            .gte('created_at', period.start)
            .lte('created_at', endTs)
            .neq('status', 'cancelled')
            .range(from, to)
        ),
        fetchPaged<any>((from, to) =>
          supabase.from('goods_received_notes')
            .select('id, status, received_date, grn_items(received_qty, raw_material_id, raw_materials(id, name, code))')
            .gte('received_date', period.start)
            .lte('received_date', period.end)
            .neq('status', 'rejected')
            .range(from, to)
        ),
        fetchPaged<any>((from, to) =>
          supabase.from('material_transfers')
            .select('id, quantity, status, transfer_date, raw_material_id, raw_materials(id, name, code)')
            .gte('transfer_date', period.start)
            .lte('transfer_date', period.end)
            .neq('status', 'rejected')
            .range(from, to)
        ),
        fetchPaged<any>((from, to) =>
          supabase.from('production_order_materials')
            .select('production_order_id, raw_material_id, planned_qty, actual_qty, issued, issued_at, raw_materials(id, name, code)')
            .eq('issued', true)
            .gte('issued_at', period.start)
            .lte('issued_at', endTs)
            .range(from, to)
        ),
        fetchPaged<any>((from, to) =>
          supabase.from('production_orders')
            .select('id, batch_number, status, planned_qty, actual_qty, created_at, actual_end, formulations(name, code), machines(name)')
            .gte('created_at', period.start)
            .lte('created_at', endTs)
            .neq('status', 'cancelled')
            .range(from, to)
        ),
        fetchPaged<any>((from, to) =>
          supabase.from('production_orders')
            .select('id, batch_number, status, planned_qty, actual_qty, created_at, actual_end, formulations(name, code), machines(name)')
            .eq('status', 'completed')
            .gte('actual_end', period.start)
            .lte('actual_end', endTs)
            .range(from, to)
        ),
        fetchPaged<any>((from, to) =>
          supabase.from('production_orders')
            .select('id, batch_number, status, planned_qty, actual_qty, created_at, actual_end, formulations(name, code), machines(name)')
            .in('status', ['pending', 'pending_finance', 'materials_issued', 'in_progress'])
            .lte('created_at', endTs)
            .range(from, to)
        ),
      ]);

      if (materialsRes.error) throw materialsRes.error;
      if (openingSnapsRes.error) throw openingSnapsRes.error;
      if (physicalSnapsRes.error) throw physicalSnapsRes.error;
      if (sageRes.error) throw sageRes.error;

      const materials = (materialsRes.data || []) as Material[];
      const byId: Record<string, Material> = {};
      const byCode: Record<string, Material> = {};
      const byName: Record<string, Material> = {};
      materials.forEach((m) => {
        byId[m.id] = m;
        if (m.code) byCode[norm(m.code)] = m;
        byName[norm(m.name)] = m;
      });

      const matchMaterial = (id?: string | null, code?: string | null, name?: string | null) =>
        (id && byId[id]) || (code && byCode[norm(code)]) || (name && byName[norm(name)]) || null;

      const orderMap = new Map<string, any>();
      [...createdOrders, ...completedOrders, ...openOrders].forEach((order) => {
        if (order?.id) orderMap.set(order.id, order);
      });
      const manufacturingOrders = Array.from(orderMap.values());
      const orderIds = manufacturingOrders.map((order) => order.id);

      let sageLogs: any[] = [];
      let fgTransfers: any[] = [];
      if (orderIds.length) {
        try {
          [sageLogs, fgTransfers] = await Promise.all([
            fetchPaged<any>((from, to) =>
              supabase.from('sync_log')
                .select('reference_id, event_type, status, updated_at')
                .in('event_type', ['materials_issued', 'production_completed'])
                .in('reference_id', orderIds.slice(0, 200))
                .order('updated_at', { ascending: false })
                .range(from, to)
            ),
            fetchPaged<any>((from, to) =>
              supabase.from('finished_goods_transfers')
                .select('production_order_id, quantity, verified_quantity, status, created_at')
                .in('production_order_id', orderIds.slice(0, 200))
                .order('created_at', { ascending: false })
                .range(from, to)
            ),
          ]);
        } catch {
          sageLogs = [];
          fgTransfers = [];
        }
      }

      const latestSage: Record<string, Record<string, string>> = {};
      sageLogs.forEach((log: any) => {
        if (!log.reference_id || !log.event_type) return;
        latestSage[log.reference_id] ||= {};
        if (!latestSage[log.reference_id][log.event_type]) {
          latestSage[log.reference_id][log.event_type] = log.status || 'unknown';
        }
      });
      const latestFg: Record<string, string> = {};
      fgTransfers.forEach((row: any) => {
        if (row.production_order_id && !latestFg[row.production_order_id]) {
          latestFg[row.production_order_id] = row.status || '—';
        }
      });

      const weighbridge: Record<string, number> = {};
      const grnQty: Record<string, number> = {};
      const transferQty: Record<string, number> = {};
      const issueQty: Record<string, number> = {};
      const consumedQty: Record<string, number> = {};
      const wipQty: Record<string, number> = {};
      const issuedByOrder: Record<string, number> = {};
      const unmatchedWb: Record<string, number> = {};

      tickets.forEach((t) => {
        const mat = matchMaterial(null, t.product_code, t.product_name);
        const amount = n(t.nett_mass);
        if (mat) add(weighbridge, mat.id, amount);
        else add(unmatchedWb, t.product_name || t.product_code || 'Unmatched weighbridge', amount);
      });

      grns.forEach((grn) => {
        const items = Array.isArray(grn.grn_items) ? grn.grn_items : [];
        items.forEach((item: any) => {
          const rm = rel(item.raw_materials);
          const mat = matchMaterial(item.raw_material_id || rm?.id, rm?.code, rm?.name);
          if (mat) add(grnQty, mat.id, n(item.received_qty));
        });
      });

      transfers.forEach((row) => {
        const rm = rel(row.raw_materials);
        const mat = matchMaterial(row.raw_material_id || rm?.id, rm?.code, rm?.name);
        if (mat) add(transferQty, mat.id, Math.abs(n(row.quantity)));
      });

      issues.forEach((row) => {
        const rm = rel(row.raw_materials);
        const mat = matchMaterial(row.raw_material_id || rm?.id, rm?.code, rm?.name);
        const amount = n(row.actual_qty) || n(row.planned_qty);
        const order = orderMap.get(row.production_order_id);
        if (mat) {
          add(issueQty, mat.id, amount);
          if (order?.status === 'completed') add(consumedQty, mat.id, amount);
          else add(wipQty, mat.id, amount);
        }
        if (row.production_order_id) add(issuedByOrder, row.production_order_id, amount);
      });

      setBatches(manufacturingOrders
        .map((order) => {
          const formula = rel(order.formulations);
          const line = rel(order.machines);
          return {
            id: order.id,
            batch: order.batch_number || '—',
            formula: formula?.name || formula?.code || '—',
            line: line?.name || '—',
            status: order.status || 'pending',
            planned: n(order.planned_qty),
            actual: n(order.actual_qty),
            issuedKg: issuedByOrder[order.id] || 0,
            sageIssue: latestSage[order.id]?.materials_issued || 'not queued',
            sageComplete: latestSage[order.id]?.production_completed || 'not queued',
            fgTransfer: latestFg[order.id] || 'none',
          };
        })
        .sort((a, b) => a.batch.localeCompare(b.batch)));

      const openingByName: Record<string, number> = {};
      let usedOpeningDate: string | null = null;
      (openingSnapsRes.data || []).forEach((snap: any) => {
        const key = norm(snap.raw_material_name);
        if (!key || openingByName[key] !== undefined) return;
        openingByName[key] = n(snap.physical_stock);
        if (!usedOpeningDate) usedOpeningDate = snap.snapshot_date;
      });

      const physicalByName: Record<string, number> = {};
      (physicalSnapsRes.data || []).forEach((snap: any) => {
        const key = norm(snap.raw_material_name);
        if (!key || physicalByName[key] !== undefined) return;
        if (snap.physical_stock === null || snap.physical_stock === undefined) return;
        physicalByName[key] = n(snap.physical_stock);
      });

      const sageById: Record<string, number> = {};
      const sageByCode: Record<string, number> = {};
      (sageRes.data || []).forEach((row: any) => {
        const amount = n(row.quantity ?? row.quantity_on_hand ?? row.balance);
        if (row.raw_material_id) sageById[row.raw_material_id] = (sageById[row.raw_material_id] || 0) + amount;
        [row.sage_code, row.item_code, row.code].forEach((code) => {
          if (code) sageByCode[norm(code)] = (sageByCode[norm(code)] || 0) + amount;
        });
      });

      const seen = new Set<string>();
      const next: PositionRow[] = [];

      const pushRow = (mat: Material | null, name: string, extra?: Partial<PositionRow>) => {
        const key = mat?.id || `name:${norm(name)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const opening = openingByName[norm(name)] ?? (mat ? openingByName[norm(mat.name)] : 0) ?? 0;
        const physical = physicalByName[norm(name)] ?? (mat ? physicalByName[norm(mat.name)] : undefined);
        const system = mat
          ? (sageById[mat.id] ?? sageByCode[norm(mat.code)] ?? n(mat.current_stock))
          : 0;
        next.push({
          key,
          materialId: mat?.id || null,
          name,
          code: mat?.code || '',
          opening,
          weighbridge: mat ? weighbridge[mat.id] || 0 : 0,
          grn: mat ? grnQty[mat.id] || 0 : 0,
          transfers: mat ? transferQty[mat.id] || 0 : 0,
          issues: mat ? issueQty[mat.id] || 0 : 0,
          consumed: mat ? consumedQty[mat.id] || 0 : 0,
          inManufacturing: mat ? wipQty[mat.id] || 0 : 0,
          physical: physical === undefined ? null : physical,
          system,
          ...extra,
        });
      };

      BULK_ORDER.forEach((name) => {
        const mat = byName[norm(name)] || materials.find((m) => norm(m.name) === norm(name)) || null;
        pushRow(mat, name);
      });
      materials.forEach((mat) => pushRow(mat, mat.name));
      Object.entries(unmatchedWb).forEach(([name, amount]) => {
        pushRow(null, name, { weighbridge: amount, system: 0, physical: null });
      });

      setOpeningAsAt(usedOpeningDate);
      setRows(next);
    } catch (err: any) {
      setError(err.message || 'Could not build the bulk raw materials position.');
      setRows([]);
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, [period.start, period.end]);

  useEffect(() => { load(); }, [load]);

  const withCalcs = useMemo(() => rows.map((row) => {
    const total = row.opening + row.grn;
    const theo = total - row.issues;
    const wbGap = row.grn - row.weighbridge;
    const physical = row.physical;
    const variance = physical === null ? null : physical - row.system;
    return { ...row, total, theo, wbGap, variance };
  }), [rows]);

  const visible = useMemo(() => {
    if (!hideZeros) return withCalcs;
    return withCalcs.filter((row) =>
      row.opening || row.weighbridge || row.grn || row.transfers || row.issues || row.consumed || row.inManufacturing || row.physical || row.system
    );
  }, [withCalcs, hideZeros]);

  const totals = useMemo(() => visible.reduce((acc, row) => ({
    opening: acc.opening + row.opening,
    weighbridge: acc.weighbridge + row.weighbridge,
    grn: acc.grn + row.grn,
    transfers: acc.transfers + row.transfers,
    issues: acc.issues + row.issues,
    consumed: acc.consumed + row.consumed,
    inManufacturing: acc.inManufacturing + row.inManufacturing,
    theo: acc.theo + row.theo,
    system: acc.system + row.system,
    physical: acc.physical + (row.physical || 0),
  }), { opening: 0, weighbridge: 0, grn: 0, transfers: 0, issues: 0, consumed: 0, inManufacturing: 0, theo: 0, system: 0, physical: 0 }), [visible]);

  const manufacturing = useMemo(() => {
    const completed = batches.filter((b) => b.status === 'completed');
    const running = batches.filter((b) => ['materials_issued', 'in_progress', 'pending_finance'].includes(b.status));
    const produced = completed.reduce((sum, b) => sum + b.actual, 0);
    const planned = batches.reduce((sum, b) => sum + b.planned, 0);
    const sageGi = batches.filter((b) => b.sageIssue === 'success').length;
    const sageDone = batches.filter((b) => b.sageComplete === 'success').length;
    const yieldPct = planned > 0 ? (produced / planned) * 100 : 0;
    return { completed: completed.length, running: running.length, produced, planned, sageGi, sageDone, yieldPct, total: batches.length };
  }, [batches]);

  function exportWorkbook() {
    const sheet = XLSX.utils.json_to_sheet(visible.map((row) => ({
      Material: row.name,
      Code: row.code,
      [`Opening (${openingAsAt || period.start})`]: row.opening,
      'Weighbridge kg': row.weighbridge,
      'GRN receipts kg': row.grn,
      'WB vs GRN': row.wbGap,
      Total: row.total,
      'Transfers to production': row.transfers,
      'BOM issues': row.issues,
      'Consumed in completed batches': row.consumed,
      'In manufacturing WIP': row.inManufacturing,
      'THEO closing': row.theo,
      'Physical stock': row.physical,
      'System stock': row.system,
      'Stock variance': row.variance,
    })));
    const mfgSheet = XLSX.utils.json_to_sheet(batches.map((row) => ({
      Batch: row.batch,
      Formula: row.formula,
      Line: row.line,
      Status: row.status,
      'Planned kg': row.planned,
      'Produced kg': row.actual,
      'RM issued kg': row.issuedKg,
      'Sage GI': row.sageIssue,
      'Sage complete': row.sageComplete,
      'FG transfer': row.fgTransfer,
    })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Bulk RM');
    XLSX.utils.book_append_sheet(book, mfgSheet, 'Manufacturing');
    XLSX.writeFile(book, `Bulk-RM-position-${period.start}-to-${period.end}.xlsx`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#f39200]">Manufacturing stock position</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{format(new Date(`${period.start}T00:00:00`), 'MMMM yyyy')} bulk raw materials</h1>
          <p className="mt-1 text-sm text-slate-500">
            Purchased stock through manufacturing: weighbridge, GRN, transfers, BOM issues, batches, Sage GI / completion, and finished goods.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={monthIndex}
            onChange={(e) => setMonthIndex(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {months.map((month, index) => (
              <option key={month.start} value={index}>{month.label}</option>
            ))}
          </select>
          <button onClick={() => setHideZeros((v) => !v)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {hideZeros ? 'Show zeros' : 'Hide zeros'}
          </button>
          <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={exportWorkbook} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Weighbridge intake', value: qty(totals.weighbridge), note: 'Nett mass received at the bridge', icon: Scale },
          { label: 'GRN receipts', value: qty(totals.grn), note: 'Purchased quantity booked in', icon: FileText },
          { label: 'Transfers to production', value: qty(totals.transfers), note: 'Moved from RM warehouse', icon: ArrowRightLeft },
          { label: 'BOM issues', value: qty(totals.issues), note: `${qty(totals.consumed)} consumed · ${qty(totals.inManufacturing)} still in batches`, icon: Factory },
          { label: 'Finished goods produced', value: qty(manufacturing.produced), note: `${manufacturing.completed} completed batches`, icon: PackageCheck },
          { label: 'Open manufacturing', value: String(manufacturing.running), note: 'Finance review, issued or running', icon: Factory },
          { label: 'Sage manufacturing', value: `${manufacturing.sageGi}/${manufacturing.total}`, note: `${manufacturing.sageDone} batch completions posted`, icon: FileText },
          { label: 'Output vs planned', value: `${manufacturing.yieldPct.toFixed(1)}%`, note: `${qty(manufacturing.produced)} of ${qty(manufacturing.planned)} kg`, icon: PackageCheck },
        ].map(({ label, value, note, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">{label}</p>
              <Icon className="h-4 w-4 text-teal-700" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
            <p className="mt-1 text-xs text-slate-400">{note}</p>
          </div>
        ))}
      </div>

      {Math.abs(totals.grn - totals.weighbridge) > 0.5 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          GRN booked {qty(totals.grn)} kg against weighbridge nett {qty(totals.weighbridge)} kg. Difference {qty(totals.grn - totals.weighbridge)} kg.
        </div>
      )}
      {totals.transfers - totals.issues > 0.5 && (
        <div className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {qty(totals.transfers - totals.issues)} kg transferred to production has not been issued onto a batch yet.
        </div>
      )}
      {totals.inManufacturing > 0.5 && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <Factory className="mt-0.5 h-4 w-4 shrink-0" />
          {qty(totals.inManufacturing)} kg is issued to open manufacturing batches and has not become finished goods yet.
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Bulk raw materials</h2>
          <p className="text-xs text-slate-500">
            Opening as at {openingAsAt ? format(new Date(`${openingAsAt}T00:00:00`), 'dd MMM yyyy') : 'previous close'}.
            THEO closing = opening + GRN − BOM issues. Consumed is completed manufacturing; in manufacturing is still on an open batch.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3 font-medium">Raw material</th>
                <th className="px-3 py-3 text-right font-medium">Opening</th>
                <th className="px-3 py-3 text-right font-medium">Weighbridge</th>
                <th className="px-3 py-3 text-right font-medium">GRN receipts</th>
                <th className="px-3 py-3 text-right font-medium">Total</th>
                <th className="px-3 py-3 text-right font-medium">Transfers</th>
                <th className="px-3 py-3 text-right font-medium">Issues</th>
                <th className="px-3 py-3 text-right font-medium">Consumed</th>
                <th className="px-3 py-3 text-right font-medium">In mfg</th>
                <th className="px-3 py-3 text-right font-medium">THEO closing</th>
                <th className="px-3 py-3 text-right font-medium">Physical</th>
                <th className="px-3 py-3 text-right font-medium">System</th>
                <th className="px-3 py-3 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="px-3 py-16 text-center text-slate-400">Building position from weighbridge, GRN, transfers, issues and manufacturing…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={13} className="px-3 py-16 text-center text-slate-400">No bulk movement in this month.</td></tr>
              ) : visible.map((row) => {
                const highlight = row.variance !== null && Math.abs(row.variance) > 0.1;
                const wbWarn = Math.abs(row.wbGap) > 0.5 && (row.weighbridge > 0 || row.grn > 0);
                return (
                  <tr key={row.key} className={`border-t border-slate-100 ${highlight ? 'bg-red-50/40' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {row.name}
                      {row.code ? <span className="ml-2 font-mono text-[10px] text-slate-400">{row.code}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{qty(row.opening)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${wbWarn ? 'text-amber-700' : 'text-slate-700'}`}>{qty(row.weighbridge)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{qty(row.grn)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{qty(row.total)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-violet-700">{qty(row.transfers)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{qty(row.issues)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{qty(row.consumed)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sky-700">{qty(row.inManufacturing)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{qty(row.theo)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{qty(row.physical)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{qty(row.system)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${highlight ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{qty(row.variance)}</td>
                  </tr>
                );
              })}
            </tbody>
            {!loading && visible.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td className="px-3 py-3">Totals</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.opening)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.weighbridge)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.grn)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.opening + totals.grn)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.transfers)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.issues)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.consumed)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.inManufacturing)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.theo)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.physical)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.system)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{qty(totals.physical - totals.system)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Manufacturing batches</h2>
          <p className="text-xs text-slate-500">
            Orders created or completed this month, plus open batches still on the floor. Sage GI is materials issued; Sage complete is the finished-goods receipt.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3 font-medium">Batch</th>
                <th className="px-3 py-3 font-medium">Formula</th>
                <th className="px-3 py-3 font-medium">Line</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Planned</th>
                <th className="px-3 py-3 text-right font-medium">Produced</th>
                <th className="px-3 py-3 text-right font-medium">RM issued</th>
                <th className="px-3 py-3 font-medium">Sage GI</th>
                <th className="px-3 py-3 font-medium">Sage complete</th>
                <th className="px-3 py-3 font-medium">FG transfer</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-16 text-center text-slate-400">Loading manufacturing…</td></tr>
              ) : batches.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-16 text-center text-slate-400">No manufacturing batches in this month.</td></tr>
              ) : batches.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-900">{row.batch}</td>
                  <td className="px-3 py-2.5 text-slate-800">{row.formula}</td>
                  <td className="px-3 py-2.5 text-slate-600">{row.line}</td>
                  <td className="px-3 py-2.5 capitalize text-slate-700">{row.status.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{qty(row.planned)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{qty(row.actual)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{qty(row.issuedKg)}</td>
                  <td className={`px-3 py-2.5 ${row.sageIssue === 'success' ? 'text-emerald-700' : row.sageIssue === 'failed' ? 'text-red-700' : 'text-slate-500'}`}>{row.sageIssue.replace(/_/g, ' ')}</td>
                  <td className={`px-3 py-2.5 ${row.sageComplete === 'success' ? 'text-emerald-700' : row.sageComplete === 'failed' ? 'text-red-700' : 'text-slate-500'}`}>{row.sageComplete.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2.5 capitalize text-slate-600">{row.fgTransfer.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
