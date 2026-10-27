import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
import { AlertTriangle, ArrowRightLeft, Boxes, CalendarDays, ChevronDown, CircleDollarSign, ClipboardList, Download, Factory, FileText, PackageCheck, RefreshCw, Scale, TrendingUp } from 'lucide-react';
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

const REPORT_SECTIONS = [
  { id: 'report-overview', label: 'Overview', icon: TrendingUp },
  { id: 'stock-position', label: 'Stock position', icon: Boxes },
  { id: 'material-costs', label: 'Material costs', icon: CircleDollarSign },
  { id: 'manufacturing-batches', label: 'Manufacturing', icon: Factory },
];

interface Material {
  id: string;
  name: string;
  code: string;
  current_stock: number;
  cost_per_unit: number;
  currency_code: string;
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
  purchaseSpend: number;
  issueCost: number;
  consumedCost: number;
  wipCost: number;
  unitCost: number;
  currency: string;
  inventoryValue: number;
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

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
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

async function fetchPaged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
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
  const [purchaseLinesWithoutCost, setPurchaseLinesWithoutCost] = useState(0);
  const [activeSection, setActiveSection] = useState(REPORT_SECTIONS[0].id);

  const period = months[monthIndex];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const openingDate = format(subDays(new Date(`${period.start}T00:00:00`), 1), 'yyyy-MM-dd');
      const endTs = `${period.end}T23:59:59`;

      const [materialsRes, openingSnapsRes, physicalSnapsRes, sageRes, tickets, grns, transfers, issues, createdOrders, completedOrders, openOrders] = await Promise.all([
        supabase.from('raw_materials').select('id, name, code, current_stock, cost_per_unit, currency_code').eq('is_active', true).order('name'),
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
            .select('id, status, received_date, grn_items(received_qty, unit_cost, raw_material_id, raw_materials(id, name, code))')
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
            .select('production_order_id, raw_material_id, planned_qty, actual_qty, unit_cost, total_cost, issued, issued_at, raw_materials(id, name, code)')
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
      const purchaseSpend: Record<string, number> = {};
      const issueCost: Record<string, number> = {};
      const consumedCost: Record<string, number> = {};
      const wipCost: Record<string, number> = {};
      let missingCostLines = 0;
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
          if (mat) {
            const quantity = n(item.received_qty);
            const unitCost = n(item.unit_cost);
            add(grnQty, mat.id, quantity);
            if (unitCost > 0) add(purchaseSpend, mat.id, quantity * unitCost);
            else if (quantity > 0) missingCostLines += 1;
          }
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
        const cost = n(row.total_cost) || amount * n(row.unit_cost);
        const order = orderMap.get(row.production_order_id);
        if (mat) {
          add(issueQty, mat.id, amount);
          add(issueCost, mat.id, cost);
          if (order?.status === 'completed') {
            add(consumedQty, mat.id, amount);
            add(consumedCost, mat.id, cost);
          } else {
            add(wipQty, mat.id, amount);
            add(wipCost, mat.id, cost);
          }
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
          purchaseSpend: mat ? purchaseSpend[mat.id] || 0 : 0,
          issueCost: mat ? issueCost[mat.id] || 0 : 0,
          consumedCost: mat ? consumedCost[mat.id] || 0 : 0,
          wipCost: mat ? wipCost[mat.id] || 0 : 0,
          unitCost: mat ? n(mat.cost_per_unit) : 0,
          currency: mat?.currency_code || 'USD',
          inventoryValue: mat ? system * n(mat.cost_per_unit) : 0,
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
      setPurchaseLinesWithoutCost(missingCostLines);
    } catch (err: any) {
      setError(err.message || 'Could not build the bulk raw materials position.');
      setRows([]);
      setBatches([]);
      setPurchaseLinesWithoutCost(0);
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

  const financialTotals = useMemo(() => {
    const byCurrency: Record<string, { purchaseSpend: number; issueCost: number; consumedCost: number; wipCost: number; inventoryValue: number }> = {};
    visible.forEach((row) => {
      const currency = row.currency || 'USD';
      byCurrency[currency] ||= { purchaseSpend: 0, issueCost: 0, consumedCost: 0, wipCost: 0, inventoryValue: 0 };
      byCurrency[currency].purchaseSpend += row.purchaseSpend;
      byCurrency[currency].issueCost += row.issueCost;
      byCurrency[currency].consumedCost += row.consumedCost;
      byCurrency[currency].wipCost += row.wipCost;
      byCurrency[currency].inventoryValue += row.inventoryValue;
    });
    return Object.entries(byCurrency).filter(([, values]) => Object.values(values).some((value) => value !== 0));
  }, [visible]);

  const costRows = useMemo(() => visible.filter((row) =>
    row.purchaseSpend || row.issueCost || row.consumedCost || row.wipCost || row.inventoryValue
  ), [visible]);

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
      Currency: row.currency,
      'Recorded GRN spend': row.purchaseSpend,
      'Current unit cost': row.unitCost,
      'Issued material cost': row.issueCost,
      'Consumed material cost': row.consumedCost,
      'Manufacturing WIP material cost': row.wipCost,
      'System stock valuation': row.inventoryValue,
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
    const costSheet = XLSX.utils.json_to_sheet(financialTotals.map(([currency, values]) => ({
      Currency: currency,
      'Recorded GRN spend': values.purchaseSpend,
      'Material cost issued': values.issueCost,
      'Consumed in completed batches': values.consumedCost,
      'In open manufacturing': values.wipCost,
      'System stock valuation': values.inventoryValue,
    })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Bulk RM');
    XLSX.utils.book_append_sheet(book, mfgSheet, 'Manufacturing');
    XLSX.utils.book_append_sheet(book, costSheet, 'Cost summary');
    XLSX.writeFile(book, `Bulk-RM-position-${period.start}-to-${period.end}.xlsx`);
  }

  const mobilePositionTotals: Array<[string, number]> = [
    ['Weighbridge', totals.weighbridge],
    ['GRN receipts', totals.grn],
    ['Transfers', totals.transfers],
    ['BOM issues', totals.issues],
    ['Consumed', totals.consumed],
    ['In manufacturing', totals.inManufacturing],
    ['THEO close', totals.theo],
  ];

  return (
    <div className="mx-auto max-w-[1680px] space-y-5 pb-8">
      <header className="relative isolate overflow-hidden rounded-[1.5rem] bg-[#0b1220] text-white shadow-xl shadow-slate-900/10 sm:rounded-[1.75rem]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_82%_15%,rgba(249,115,22,0.22),transparent_35%),radial-gradient(ellipse_at_12%_100%,rgba(20,184,166,0.17),transparent_38%)]" />
        <div className="pointer-events-none absolute right-[-4rem] top-[-7rem] h-80 w-80 rounded-full border border-white/[0.06]" />
        <div className="pointer-events-none absolute right-[-1rem] top-[-4rem] h-56 w-56 rounded-full border border-white/[0.06]" />
        <div className="relative grid gap-5 px-4 py-5 sm:px-7 sm:py-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-9 lg:py-8">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-orange-200">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-300" />
                Executive operations
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-300">
                <CalendarDays className="h-3.5 w-3.5" />
                {format(new Date(`${period.start}T00:00:00`), 'MMMM yyyy')}
              </span>
            </div>
            <div className="flex items-start gap-4">
              <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10 text-teal-200 sm:flex">
                <Factory className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="max-w-3xl text-[1.65rem] font-bold leading-tight tracking-tight sm:text-3xl lg:text-[2.1rem]">Raw materials to manufacturing</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  Follow every delivery from weighbridge and GRN through stock, production and finished output.
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:flex-col lg:items-stretch">
            <button onClick={load} disabled={loading} className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-2.5 py-3 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-70 sm:px-4 sm:text-sm">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="truncate">{loading ? 'Refreshing' : 'Refresh'}</span>
            </button>
            <button onClick={exportWorkbook} className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl bg-orange-400 px-2.5 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-orange-950/20 transition hover:bg-orange-300 sm:px-4 sm:text-sm">
              <Download className="h-4 w-4 shrink-0" /> <span className="truncate">Export workbook</span>
            </button>
          </div>
        </div>
        <div className="relative grid grid-cols-2 border-t border-white/10 bg-white/[0.035] sm:grid-cols-4">
          {[
            { label: 'Weighbridge', value: `${qty(totals.weighbridge)} kg`, icon: Scale },
            { label: 'Received on GRN', value: `${qty(totals.grn)} kg`, icon: ClipboardList },
            { label: 'Issued to production', value: `${qty(totals.issues)} kg`, icon: ArrowRightLeft },
            { label: 'Finished output', value: `${qty(manufacturing.produced)} kg`, icon: PackageCheck },
          ].map(({ label, value, icon: Icon }, index) => (
            <div key={label} className={`flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-6 ${index > 0 ? 'border-l border-white/10' : ''} ${index > 1 ? 'border-t border-white/10 sm:border-t-0' : ''}`}>
              <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-teal-200 sm:flex"><Icon className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-white">{loading ? '—' : value}</p>
              </div>
            </div>
          ))}
        </div>
      </header>

      <section aria-label="Report filters" className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><FileText className="h-4 w-4" /></span>
          Report period
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Report month"
            value={monthIndex}
            onChange={(e) => setMonthIndex(Number(e.target.value))}
            className="min-w-40 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          >
            {months.map((month, index) => (
              <option key={month.start} value={index}>{month.label}</option>
            ))}
          </select>
          <button onClick={() => setHideZeros((v) => !v)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            {hideZeros ? 'Show zeros' : 'Hide zeros'}
          </button>
        </div>
      </section>

      <nav aria-label="Report sections" className="sticky top-16 z-20 grid grid-cols-2 gap-1 rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-sm backdrop-blur-md sm:flex sm:flex-wrap sm:gap-2 sm:p-2">
        {REPORT_SECTIONS.map(({ id, label, icon: Icon }) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              type="button"
              aria-controls={id}
              aria-current={isActive ? 'location' : undefined}
              onClick={() => {
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActiveSection(id);
              }}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-2.5 py-2.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 sm:w-auto sm:shrink-0 sm:justify-start sm:gap-2 sm:px-4 sm:text-sm ${isActive ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-teal-300' : 'text-slate-400'}`} />
              {label}
            </button>
          );
        })}
      </nav>

      <section id="report-overview" className="scroll-mt-44 space-y-3 sm:scroll-mt-32">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-700">Period overview</p>
            <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">Operations at a glance</h2>
          </div>
          <span className="text-xs text-slate-500">{loading ? 'Updating report…' : `${manufacturing.total} batch records in this view`}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
          {[
            { label: 'Transfers to production', value: `${qty(totals.transfers)} kg`, note: 'Moved from raw material stores', icon: ArrowRightLeft, tone: 'violet' },
            { label: 'Raw material issued', value: `${qty(totals.issues)} kg`, note: `${qty(totals.consumed)} kg consumed · ${qty(totals.inManufacturing)} kg in open batches`, icon: Factory, tone: 'amber' },
            { label: 'Open manufacturing', value: String(manufacturing.running), note: 'Finance review, issued or running', icon: ClipboardList, tone: 'sky' },
            { label: 'Output vs planned', value: `${manufacturing.yieldPct.toFixed(1)}%`, note: `${qty(manufacturing.produced)} of ${qty(manufacturing.planned)} kg`, icon: TrendingUp, tone: 'teal' },
          ].map(({ label, value, note, icon: Icon, tone }) => (
            <div key={label} className="group min-w-0 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone === 'violet' ? 'bg-violet-50 text-violet-700' : tone === 'amber' ? 'bg-amber-50 text-amber-700' : tone === 'sky' ? 'bg-sky-50 text-sky-700' : 'bg-teal-50 text-teal-700'}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-4 ring-emerald-50" />
              </div>
              <p className="mt-3 text-[11px] font-semibold leading-4 text-slate-500 sm:mt-4 sm:text-xs">{label}</p>
              <p className="mt-1 break-words text-xl font-bold tracking-tight tabular-nums text-slate-900 sm:text-2xl">{loading ? '—' : value}</p>
              <p className="mt-1 min-h-8 text-[10px] leading-4 text-slate-400 sm:text-[11px]">{note}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="material-costs" className="scroll-mt-44 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:scroll-mt-32">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Raw material spend &amp; valuation</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Purchase spend uses GRN received quantity × recorded unit cost. Issue and consumption costs use manufacturing issue records. Stock valuation uses system stock × current master cost. Values are grouped by currency with no conversion.</p>
            </div>
            <span className="mt-1 w-fit rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 sm:mt-0">By currency</span>
          </div>
        </div>
        {financialTotals.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No recorded material costs for this period.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3 sm:gap-3 sm:p-5 2xl:grid-cols-5">
            {financialTotals.flatMap(([currency, values]) => [
              { label: `Purchase spend · ${currency}`, value: values.purchaseSpend, note: 'Recorded on received GRN lines' },
              { label: `Material issued · ${currency}`, value: values.issueCost, note: 'Cost assigned to production issues' },
              { label: `Consumed · ${currency}`, value: values.consumedCost, note: 'Issued to completed batches' },
              { label: `Open batch cost · ${currency}`, value: values.wipCost, note: 'Issued to batches not yet completed' },
              { label: `Stock value · ${currency}`, value: values.inventoryValue, note: 'System quantity × current unit cost' },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-3 sm:p-3.5">
                <p className="text-[10px] font-semibold leading-4 text-slate-500 sm:text-[11px]">{item.label}</p>
                <p className="mt-1.5 break-all text-base font-bold tabular-nums tracking-tight text-slate-900 sm:mt-2 sm:text-lg">{money(item.value, currency)}</p>
                <p className="mt-1 text-[9px] leading-4 text-slate-500 sm:text-[10px]">{item.note}</p>
              </div>
            )))}
          </div>
        )}
        {purchaseLinesWithoutCost > 0 && (
          <p className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:mx-5">
            {purchaseLinesWithoutCost} received GRN line(s) have no unit cost; they are included in received quantities but excluded from purchase spend.
          </p>
        )}
      </section>

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

      <section id="stock-position" className="scroll-mt-44 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:scroll-mt-32">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-teal-700">Inventory control</p>
              <h2 className="mt-1 text-base font-bold tracking-tight text-slate-900">Bulk raw material position</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-500">
                {visible.length} materials shown
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-500">
                Opening as at {openingAsAt ? format(new Date(`${openingAsAt}T00:00:00`), 'dd MMM yyyy') : 'previous close'}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            THEO closing = opening + GRN − BOM issues. Consumed is completed manufacturing; in manufacturing is still on an open batch. Expand a material on smaller screens for the full movement breakdown.
          </p>
        </div>
        <div className="space-y-2.5 p-3 xl:hidden">
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">Building material positions…</div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No bulk movement in this month.</div>
          ) : (
            <>
              {visible.map((row) => {
                const highlight = row.variance !== null && Math.abs(row.variance) > 0.1;
                const metrics: Array<[string, number | null]> = [
                  ['Opening', row.opening],
                  ['Weighbridge', row.weighbridge],
                  ['GRN receipts', row.grn],
                  ['Total received', row.total],
                  ['Transfers', row.transfers],
                  ['BOM issues', row.issues],
                  ['Consumed', row.consumed],
                  ['In manufacturing', row.inManufacturing],
                  ['Physical stock', row.physical],
                  ['System stock', row.system],
                  ['Variance', row.variance],
                ];
                return (
                  <details key={row.key} className={`group overflow-hidden rounded-xl border ${highlight ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-white'}`}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-slate-900">{row.name}</span>
                        {row.code && <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{row.code}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-right">
                          <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">THEO close</span>
                          <span className="block text-sm font-bold tabular-nums text-slate-900">{qty(row.theo)} kg</span>
                        </span>
                        <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                      </span>
                    </summary>
                    <dl className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100">
                      {metrics.map(([label, value]) => (
                        <div key={label} className={`min-w-0 px-3 py-2.5 ${label === 'Variance' ? 'col-span-2 bg-slate-50' : 'bg-white'}`}>
                          <dt className="truncate text-[10px] font-medium text-slate-400">{label}</dt>
                          <dd className={`mt-0.5 truncate text-xs font-semibold tabular-nums ${label === 'Variance' && highlight ? 'text-rose-700' : 'text-slate-700'}`}>{value === null ? '—' : `${qty(value)} kg`}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                );
              })}
              <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
                <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Period totals</p>
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200">
                  {mobilePositionTotals.map(([label, value]) => (
                    <div key={label} className="bg-white px-3 py-2.5">
                      <dt className="text-[10px] font-medium text-slate-400">{label}</dt>
                      <dd className="mt-0.5 text-xs font-bold tabular-nums text-slate-800">{qty(value)} kg</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          )}
        </div>
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[1360px] text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                <th className="min-w-56 px-4 py-3 font-semibold">Raw material</th>
                <th className="px-3 py-3 text-right font-semibold">Opening</th>
                <th className="px-3 py-3 text-right font-semibold">Weighbridge</th>
                <th className="px-3 py-3 text-right font-semibold">GRN receipts</th>
                <th className="px-3 py-3 text-right font-semibold">Total</th>
                <th className="px-3 py-3 text-right font-semibold">Transfers</th>
                <th className="px-3 py-3 text-right font-semibold">Issues</th>
                <th className="px-3 py-3 text-right font-semibold">Consumed</th>
                <th className="px-3 py-3 text-right font-semibold">In mfg</th>
                <th className="px-3 py-3 text-right font-semibold">THEO closing</th>
                <th className="px-3 py-3 text-right font-semibold">Physical</th>
                <th className="px-3 py-3 text-right font-semibold">System</th>
                <th className="px-3 py-3 text-right font-semibold">Variance</th>
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
                  <tr key={row.key} className={`border-t border-slate-100 transition-colors ${highlight ? 'bg-red-50/60 hover:bg-red-50' : 'odd:bg-white even:bg-slate-50/40 hover:bg-teal-50/50'}`}>
                    <td className="px-4 py-3 font-semibold text-slate-900">
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
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-orange-700">Cost breakdown</p>
          <h2 className="mt-1 text-base font-bold tracking-tight text-slate-900">Cost by raw material</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Currency is shown per material so unlike amounts are never totalled together. Master unit cost is current; purchase spend uses period GRNs.</p>
        </div>
        <div className="space-y-2.5 p-3 xl:hidden">
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">Loading material costs…</div>
          ) : costRows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No material cost data for this period.</div>
          ) : costRows.map((row) => {
            const metrics: Array<[string, number]> = [
              ['Purchase spend', row.purchaseSpend],
              ['Master cost / unit', row.unitCost],
              ['Material issued', row.issueCost],
              ['Consumed', row.consumedCost],
              ['Open batch cost', row.wipCost],
              ['Stock valuation', row.inventoryValue],
            ];
            return (
            <details key={row.key} className="group overflow-hidden rounded-xl border border-slate-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-bold text-slate-900">{row.name}</h3>
                  {row.code && <p className="mt-0.5 font-mono text-[10px] text-slate-400">{row.code}</p>}
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-right">
                    <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">{row.currency} purchase</span>
                    <span className="block text-xs font-bold tabular-nums text-slate-800">{money(row.purchaseSpend, row.currency)}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <dl className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100">
                {metrics.map(([label, value]) => (
                  <div key={label} className="min-w-0 bg-white px-3 py-2.5">
                    <dt className="truncate text-[10px] font-medium text-slate-400">{label}</dt>
                    <dd className="mt-0.5 break-all text-xs font-semibold tabular-nums text-slate-800">{money(value, row.currency)}</dd>
                  </div>
                ))}
              </dl>
            </details>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                <th className="px-3 py-3 font-semibold">Raw material</th>
                <th className="px-3 py-3 text-center font-semibold">Currency</th>
                <th className="px-3 py-3 text-right font-semibold">Purchase spend</th>
                <th className="px-3 py-3 text-right font-semibold">Master cost / unit</th>
                <th className="px-3 py-3 text-right font-semibold">Issued cost</th>
                <th className="px-3 py-3 text-right font-semibold">Consumed cost</th>
                <th className="px-3 py-3 text-right font-semibold">Open batch cost</th>
                <th className="px-3 py-3 text-right font-semibold">Stock valuation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">Loading material costs…</td></tr>
              ) : costRows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">No material cost data for this period.</td></tr>
              ) : costRows.map((row) => (
                <tr key={row.key} className="transition-colors odd:bg-white even:bg-slate-50/40 hover:bg-teal-50/50">
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {row.name}
                    {row.code ? <span className="ml-2 font-mono text-[10px] text-slate-400">{row.code}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600">{row.currency}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-800">{money(row.purchaseSpend, row.currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{money(row.unitCost, row.currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-800">{money(row.issueCost, row.currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{money(row.consumedCost, row.currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-sky-800">{money(row.wipCost, row.currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800">{money(row.inventoryValue, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="manufacturing-batches" className="scroll-mt-44 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:scroll-mt-32">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-violet-700">Production execution</p>
          <h2 className="mt-1 text-base font-bold tracking-tight text-slate-900">Manufacturing batches</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Orders created or completed this month, plus open batches still on the floor. Sage GI is materials issued; Sage complete is the finished-goods receipt.
          </p>
        </div>
        <div className="space-y-2.5 p-3 xl:hidden">
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">Loading manufacturing…</div>
          ) : batches.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No manufacturing batches in this month.</div>
          ) : batches.map((row) => {
            const productionMetrics: Array<[string, number]> = [
              ['Planned', row.planned],
              ['Produced', row.actual],
              ['RM issued', row.issuedKg],
            ];
            const sageStages: Array<[string, string]> = [
              ['Sage GI', row.sageIssue],
              ['Sage complete', row.sageComplete],
              ['FG transfer', row.fgTransfer],
            ];
            return (
            <article key={row.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-start justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-slate-900">{row.batch}</p>
                  <h3 className="mt-1 truncate text-sm font-semibold text-slate-800">{row.formula}</h3>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">{row.line}</p>
                </div>
                <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${row.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : row.status === 'failed' || row.status === 'cancelled' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                  {row.status.replace(/_/g, ' ')}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-px border-y border-slate-100 bg-slate-100">
                {productionMetrics.map(([label, value]) => (
                  <div key={label} className="min-w-0 bg-slate-50 px-3 py-2.5">
                    <dt className="truncate text-[10px] font-medium text-slate-400">{label}</dt>
                    <dd className="mt-0.5 truncate text-xs font-bold tabular-nums text-slate-800">{qty(value)} kg</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2 p-3">
                {sageStages.map(([label, value]) => (
                  <span key={label} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[10px]">
                    <span className="font-semibold text-slate-400">{label}</span>
                    <span className={`font-bold capitalize ${value === 'success' ? 'text-emerald-700' : value === 'failed' ? 'text-rose-700' : 'text-slate-600'}`}>{value.replace(/_/g, ' ')}</span>
                  </span>
                ))}
              </div>
            </article>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[1120px] text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                <th className="px-3 py-3 font-semibold">Batch</th>
                <th className="px-3 py-3 font-semibold">Formula</th>
                <th className="px-3 py-3 font-semibold">Line</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 text-right font-semibold">Planned</th>
                <th className="px-3 py-3 text-right font-semibold">Produced</th>
                <th className="px-3 py-3 text-right font-semibold">RM issued</th>
                <th className="px-3 py-3 font-semibold">Sage GI</th>
                <th className="px-3 py-3 font-semibold">Sage complete</th>
                <th className="px-3 py-3 font-semibold">FG transfer</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-16 text-center text-slate-400">Loading manufacturing…</td></tr>
              ) : batches.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-16 text-center text-slate-400">No manufacturing batches in this month.</td></tr>
              ) : batches.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 transition-colors odd:bg-white even:bg-slate-50/40 hover:bg-teal-50/50">
                  <td className="px-3 py-2.5 font-mono text-xs font-bold text-slate-900">{row.batch}</td>
                  <td className="px-3 py-2.5 text-slate-800">{row.formula}</td>
                  <td className="px-3 py-2.5 text-slate-600">{row.line}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${row.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : row.status === 'failed' || row.status === 'cancelled' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                      {row.status.replace(/_/g, ' ')}
                    </span>
                  </td>
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
      </section>
    </div>
  );
}
