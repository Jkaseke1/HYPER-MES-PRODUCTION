import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Download, Filter, RefreshCw, Scale, FileText, ArrowRightLeft } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/ui/StatusBadge';

type DocType = 'all' | 'weighbridge' | 'grn' | 'transfer';

interface ReportRow {
  id: string;
  sortDate: string;
  dateLabel: string;
  type: Exclude<DocType, 'all'>;
  typeLabel: string;
  reference: string;
  party: string;
  material: string;
  vehicle: string;
  quantity: number | null;
  unit: string;
  linked: string;
  status: string;
}

interface MatchRow {
  ticketId: string;
  ticketNo: string;
  dateLabel: string;
  supplier: string;
  vehicle: string;
  nett: number | null;
  grnNumbers: string;
  grnQty: number | null;
  variance: number | null;
  status: string;
}

function inRange(value: string | null | undefined, start: string, end: string) {
  if (!value) return false;
  const day = value.slice(0, 10);
  return day >= start && day <= end;
}

function qty(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export default function IntakeMovementReportPage() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [docType, setDocType] = useState<DocType>('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [ticketsRes, grnsRes, transfersRes] = await Promise.all([
      supabase
        .from('weigh_bridge_tickets')
        .select('id, ticket_no, vehicle_reg, product_name, product_code, nett_mass, status, created_at, supplier_id, unregistered_supplier_name, suppliers(name)')
        .gte('created_at', startDate)
        .lte('created_at', `${endDate}T23:59:59`)
        .order('created_at', { ascending: false }),
      supabase
        .from('goods_received_notes')
        .select('id, grn_number, received_date, status, weigh_bridge_ticket_id, weigh_bridge_ticket_no, wb_vehicle_reg, wb_nett_mass, suppliers(name), grn_items(received_qty, raw_materials(name, code, unit))')
        .gte('received_date', startDate)
        .lte('received_date', `${endDate}T23:59:59`)
        .order('received_date', { ascending: false }),
      supabase
        .from('material_transfers')
        .select('id, transfer_number, transfer_date, created_at, quantity, unit, status, purpose, to_location, raw_materials(name, code, unit), warehouses:from_warehouse_id(name)')
        .gte('transfer_date', startDate)
        .lte('transfer_date', `${endDate}T23:59:59`)
        .order('transfer_date', { ascending: false }),
    ]);

    const failure = ticketsRes.error || grnsRes.error || transfersRes.error;
    if (failure) {
      setError(failure.message || 'Could not load the intake report.');
      setRows([]);
      setMatches([]);
      setLoading(false);
      return;
    }

    const tickets = (ticketsRes.data || []) as any[];
    const grns = (grnsRes.data || []) as any[];
    const transfers = ((transfersRes.data || []) as any[]).filter((row) => inRange(row.transfer_date || row.created_at, startDate, endDate));

    const grnsByTicket = new Map<string, any[]>();
    grns.forEach((grn) => {
      if (!grn.weigh_bridge_ticket_id) return;
      const list = grnsByTicket.get(grn.weigh_bridge_ticket_id) || [];
      list.push(grn);
      grnsByTicket.set(grn.weigh_bridge_ticket_id, list);
    });
    const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));

    const nextRows: ReportRow[] = [];

    tickets.forEach((ticket) => {
      const linked = (grnsByTicket.get(ticket.id) || []).map((grn) => grn.grn_number).filter(Boolean);
      nextRows.push({
        id: `wb-${ticket.id}`,
        sortDate: ticket.created_at || '',
        dateLabel: ticket.created_at ? format(new Date(ticket.created_at), 'dd MMM yyyy') : '—',
        type: 'weighbridge',
        typeLabel: 'Weighbridge',
        reference: ticket.ticket_no || '—',
        party: ticket.suppliers?.name || ticket.unregistered_supplier_name || '—',
        material: ticket.product_name || ticket.product_code || '—',
        vehicle: ticket.vehicle_reg || '—',
        quantity: ticket.nett_mass === null || ticket.nett_mass === undefined ? null : Number(ticket.nett_mass),
        unit: 'kg',
        linked: linked.length ? linked.join(', ') : 'No GRN',
        status: ticket.status || 'open',
      });
    });

    grns.forEach((grn) => {
      const items = Array.isArray(grn.grn_items) ? grn.grn_items : [];
      const received = items.reduce((sum: number, item: any) => sum + Number(item.received_qty || 0), 0);
      const material = items.length
        ? items.map((item: any) => item.raw_materials?.name || item.raw_materials?.code).filter(Boolean).join(', ')
        : '—';
      const ticket = ticketById.get(grn.weigh_bridge_ticket_id);
      nextRows.push({
        id: `grn-${grn.id}`,
        sortDate: grn.received_date || '',
        dateLabel: grn.received_date ? format(new Date(grn.received_date), 'dd MMM yyyy') : '—',
        type: 'grn',
        typeLabel: 'GRN',
        reference: grn.grn_number || '—',
        party: grn.suppliers?.name || '—',
        material: material || '—',
        vehicle: grn.wb_vehicle_reg || ticket?.vehicle_reg || '—',
        quantity: items.length ? received : (grn.wb_nett_mass === null || grn.wb_nett_mass === undefined ? null : Number(grn.wb_nett_mass)),
        unit: items[0]?.raw_materials?.unit || 'kg',
        linked: ticket?.ticket_no || grn.weigh_bridge_ticket_no || 'No ticket',
        status: grn.status || 'pending',
      });
    });

    transfers.forEach((transfer) => {
      const when = transfer.transfer_date || transfer.created_at;
      nextRows.push({
        id: `tr-${transfer.id}`,
        sortDate: when || '',
        dateLabel: when ? format(new Date(when), 'dd MMM yyyy') : '—',
        type: 'transfer',
        typeLabel: 'Transfer',
        reference: transfer.transfer_number || '—',
        party: transfer.warehouses?.name || transfer.to_location || '—',
        material: transfer.raw_materials?.name || '—',
        vehicle: '—',
        quantity: transfer.quantity === null || transfer.quantity === undefined ? null : Math.abs(Number(transfer.quantity)),
        unit: transfer.unit || transfer.raw_materials?.unit || 'kg',
        linked: transfer.purpose || transfer.to_location || '—',
        status: transfer.status || 'pending',
      });
    });

    nextRows.sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)));

    const nextMatches: MatchRow[] = tickets.map((ticket) => {
      const linkedGrns = grnsByTicket.get(ticket.id) || [];
      const grnQty = linkedGrns.reduce((sum, grn) => {
        const items = Array.isArray(grn.grn_items) ? grn.grn_items : [];
        return sum + items.reduce((lineSum: number, item: any) => lineSum + Number(item.received_qty || 0), 0);
      }, 0);
      const nett = ticket.nett_mass === null || ticket.nett_mass === undefined ? null : Number(ticket.nett_mass);
      return {
        ticketId: ticket.id,
        ticketNo: ticket.ticket_no || '—',
        dateLabel: ticket.created_at ? format(new Date(ticket.created_at), 'dd MMM yyyy') : '—',
        supplier: ticket.suppliers?.name || ticket.unregistered_supplier_name || '—',
        vehicle: ticket.vehicle_reg || '—',
        nett,
        grnNumbers: linkedGrns.map((grn) => grn.grn_number).filter(Boolean).join(', ') || '—',
        grnQty: linkedGrns.length ? grnQty : null,
        variance: linkedGrns.length && nett !== null ? Number((grnQty - nett).toFixed(3)) : null,
        status: ticket.status || 'open',
      };
    });

    setRows(nextRows);
    setMatches(nextMatches);
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (docType !== 'all' && row.type !== docType) return false;
      if (!q) return true;
      return [row.reference, row.party, row.material, row.vehicle, row.linked, row.typeLabel]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, docType, search]);

  const totals = useMemo(() => {
    const ofType = (type: ReportRow['type']) => filtered.filter((row) => row.type === type);
    const sum = (type: ReportRow['type']) => ofType(type).reduce((total, row) => total + Number(row.quantity || 0), 0);
    return {
      tickets: ofType('weighbridge').length,
      grns: ofType('grn').length,
      transfers: ofType('transfer').length,
      ticketKg: sum('weighbridge'),
      grnKg: sum('grn'),
      transferKg: sum('transfer'),
      unmatched: matches.filter((row) => row.grnNumbers === '—').length,
    };
  }, [filtered, matches]);

  function exportWorkbook() {
    const sheet = XLSX.utils.json_to_sheet(filtered.map((row) => ({
      Date: row.dateLabel,
      Type: row.typeLabel,
      Reference: row.reference,
      Party: row.party,
      Material: row.material,
      Vehicle: row.vehicle,
      Quantity: row.quantity,
      Unit: row.unit,
      Linked: row.linked,
      Status: row.status,
    })));
    const matchSheet = XLSX.utils.json_to_sheet(matches.map((row) => ({
      Date: row.dateLabel,
      Ticket: row.ticketNo,
      Supplier: row.supplier,
      Vehicle: row.vehicle,
      'Nett kg': row.nett,
      GRN: row.grnNumbers,
      'GRN qty': row.grnQty,
      'GRN minus nett': row.variance,
      Status: row.status,
    })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Movements');
    XLSX.utils.book_append_sheet(book, matchSheet, 'Ticket to GRN');
    XLSX.writeFile(book, `Intake-movement-${startDate}-to-${endDate}.xlsx`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Intake & movement</h1>
          <p className="mt-1 text-sm text-slate-500">Weighbridge tickets, goods received notes, and material transfers for the selected dates.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={exportWorkbook} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Filter className="h-4 w-4" /> Filters
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          From
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          To
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </label>
        <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
          <option value="all">All documents</option>
          <option value="weighbridge">Weighbridge tickets</option>
          <option value="grn">GRNs</option>
          <option value="transfer">Material transfers</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference, supplier, material, vehicle"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Weighbridge tickets', value: totals.tickets, note: `${qty(totals.ticketKg)} kg nett`, icon: Scale },
          { label: 'Goods received', value: totals.grns, note: `${qty(totals.grnKg)} received`, icon: FileText },
          { label: 'Material transfers', value: totals.transfers, note: `${qty(totals.transferKg)} moved`, icon: ArrowRightLeft },
          { label: 'Tickets without a GRN', value: totals.unmatched, note: 'In this date range', icon: Scale },
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

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Ticket to GRN</h2>
          <p className="text-xs text-slate-500">Nett mass on the weighbridge ticket against quantity received on the linked GRN.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                {['Date', 'Ticket', 'Supplier', 'Vehicle', 'Nett kg', 'GRN', 'GRN qty', 'Difference', 'Status'].map((heading) => (
                  <th key={heading} className="px-4 py-3 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Loading report…</td></tr>
              ) : matches.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No weighbridge tickets in this range.</td></tr>
              ) : matches.map((row) => (
                <tr key={row.ticketId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{row.dateLabel}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.ticketNo}</td>
                  <td className="px-4 py-3 text-slate-700">{row.supplier}</td>
                  <td className="px-4 py-3 text-slate-700">{row.vehicle}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-800">{qty(row.nett)}</td>
                  <td className="px-4 py-3 text-slate-700">{row.grnNumbers}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-800">{qty(row.grnQty)}</td>
                  <td className={`px-4 py-3 tabular-nums ${row.variance === null ? 'text-slate-400' : Math.abs(row.variance) < 0.05 ? 'text-teal-700' : 'text-amber-700'}`}>
                    {row.variance === null ? '—' : `${row.variance > 0 ? '+' : ''}${qty(row.variance)}`}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">All documents</h2>
            <p className="text-xs text-slate-500">{filtered.length} rows</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                {['Date', 'Type', 'Reference', 'Party', 'Material', 'Vehicle', 'Quantity', 'Linked', 'Status'].map((heading) => (
                  <th key={heading} className="px-4 py-3 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Loading report…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Nothing matches these filters.</td></tr>
              ) : filtered.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{row.dateLabel}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.type === 'weighbridge' ? 'bg-sky-50 text-sky-700' : row.type === 'grn' ? 'bg-teal-50 text-teal-700' : 'bg-violet-50 text-violet-700'
                    }`}>{row.typeLabel}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.reference}</td>
                  <td className="px-4 py-3 text-slate-700">{row.party}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-slate-700" title={row.material}>{row.material}</td>
                  <td className="px-4 py-3 text-slate-700">{row.vehicle}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-800">{qty(row.quantity)} <span className="text-xs text-slate-400">{row.unit}</span></td>
                  <td className="px-4 py-3 text-slate-600">{row.linked}</td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
