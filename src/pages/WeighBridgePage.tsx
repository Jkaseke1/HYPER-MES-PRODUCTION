import { useState, useEffect } from 'react';
import {
  Scale, Plus, Search, Eye, CheckCircle, X, RefreshCw,
  Truck, Calendar, User, ArrowRight, FileText, CheckCircle2, ShieldAlert, FilePlus, Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dialog, DialogContent } from '../components/ui/dialog';
import WeighBridgeTicket from '../components/grn/WeighBridgeTicket';
import { cacheData, getCachedData } from '../lib/offlineSync';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

interface WBTicket {
  id: string;
  ticket_no: string;
  vehicle_reg: string;
  haulier_code: string;
  driver_name: string;
  driver_id: string;
  product_code: string;
  product_name: string;
  supplier_id: string;
  supplier_name?: string;
  unregistered_supplier_name?: string;
  finance_note?: string;
  trailer_number: string;
  time_in: string;
  time_out: string;
  first_mass: number;
  second_mass: number;
  nett_mass: number;
  comment: string;
  driver_signed: boolean;
  status: 'open' | 'linked' | 'cancelled';
  created_at: string;
  grn_number?: string;
}

const emptyWBForm = {
  wb_transaction_no: '',
  wb_vehicle_reg: '',
  wb_haulier_code: 'HYPER',
  wb_product_code: '',
  wb_product_name: '',
  wb_supplier_id: '',
  wb_unregistered_supplier_name: '',
  wb_finance_note: '',
  wb_comment: '',
  wb_trailer_number: '',
  wb_driver_name: '',
  wb_driver_id: '',
  wb_time_in: '',
  wb_first_mass: '',
  wb_time_out: '',
  wb_second_mass: '',
  wb_nett_mass: '',
  wb_driver_signed: false,
};

const STATUS_STYLES: Record<string, { label: string; bg: string; color: string; border: string }> = {
  open: { label: 'Open Ticket', bg: 'bg-amber-50', color: 'text-amber-700', border: 'border-amber-200' },
  linked: { label: 'Linked to GRN', bg: 'bg-emerald-50', color: 'text-emerald-700', border: 'border-emerald-200' },
  cancelled: { label: 'Cancelled', bg: 'bg-slate-100', color: 'text-slate-500', border: 'border-slate-200' },
};

export default function WeighBridgePage() {
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<WBTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [viewTicket, setViewTicket] = useState<WBTicket | null>(null);
  const [form, setForm] = useState(emptyWBForm);
  const [saving, setSaving] = useState(false);

  async function fetchTickets(silent = false) {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('weigh_bridge_tickets')
        .select('*, created_by_user:profiles!created_by(full_name, email), suppliers(name, code)')
        .order('created_at', { ascending: false });

      if (error) {
        if (!navigator.onLine) {
          const cached = await getCachedData('weigh_bridge_tickets_all');
          if (cached) setTickets(cached);
        } else {
          console.error('Error loading WB tickets:', error);
        }
      } else if (data) {
        setTickets(data);
        cacheData('weigh_bridge_tickets_all', data);
      }
    } catch {
      const cached = await getCachedData('weigh_bridge_tickets_all');
      if (cached) setTickets(cached);
    }
    if (!silent) setLoading(false);
  }

  async function generateNextTicketNo() {
    const year = new Date().getFullYear();
    const { data, error } = await supabase
      .from('weigh_bridge_tickets')
      .select('ticket_no')
      .like('ticket_no', `WB-${year}-%`)
      .order('ticket_no', { ascending: false })
      .limit(1);
    
    if (error || !data || data.length === 0) {
      return `WB-${year}-001`;
    }
    
    const lastTicketNo = data[0].ticket_no;
    const lastSeq = parseInt(lastTicketNo.split('-')[2] || '0');
    const nextSeq = String(lastSeq + 1).padStart(3, '0');
    return `WB-${year}-${nextSeq}`;
  }

  useEffect(() => { fetchTickets(); }, []);

  useRealtimeRefresh(
    'weighbridge-live',
    ['weigh_bridge_tickets', 'goods_received_notes', 'sync_log'],
    () => fetchTickets(true),
  );

  async function openNewTicketModal() {
    const nextTicketNo = await generateNextTicketNo();
    setForm({ ...emptyWBForm, wb_transaction_no: nextTicketNo });
    setNewOpen(true);
  }

  function handleFormChange(field: string, value: any) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.wb_transaction_no) {
      alert('Transaction No is required.');
      return;
    }
    if (!form.wb_product_code || !form.wb_product_name) {
      alert('Product is required before saving a weighbridge ticket.');
      return;
    }
    if (!form.wb_supplier_id && !form.wb_unregistered_supplier_name.trim()) {
      alert('Select a supplier, or record the supplier name for Finance.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ticket_no: form.wb_transaction_no,
        vehicle_reg: form.wb_vehicle_reg,
        haulier_code: form.wb_haulier_code,
        driver_name: form.wb_driver_name,
        driver_id: form.wb_driver_id,
        product_code: form.wb_product_code,
        product_name: form.wb_product_name,
        supplier_id: form.wb_supplier_id || null,
        unregistered_supplier_name: form.wb_unregistered_supplier_name.trim() || null,
        finance_note: form.wb_finance_note.trim() || null,
        trailer_number: form.wb_trailer_number,
        time_in: form.wb_time_in || null,
        time_out: form.wb_time_out || null,
        first_mass: form.wb_first_mass ? parseFloat(form.wb_first_mass) : null,
        second_mass: form.wb_second_mass ? parseFloat(form.wb_second_mass) : null,
        nett_mass: form.wb_nett_mass ? parseFloat(form.wb_nett_mass) : null,
        comment: form.wb_comment,
        driver_signed: form.wb_driver_signed,
        status: 'open',
        created_by: profile?.id || null,
      };
      const { error } = await supabase.from('weigh_bridge_tickets').insert(payload);
      if (error) throw error;
      setNewOpen(false);
      setForm(emptyWBForm);
      fetchTickets();
    } catch (err: any) {
      alert(`Failed to save ticket: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const filtered = tickets.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.ticket_no?.toLowerCase().includes(q) ||
      t.vehicle_reg?.toLowerCase().includes(q) ||
      t.driver_name?.toLowerCase().includes(q) ||
      t.product_code?.toLowerCase().includes(q) ||
      t.product_name?.toLowerCase().includes(q)
    );
  });

  const openCount = tickets.filter(t => t.status === 'open').length;
  const linkedCount = tickets.filter(t => t.status === 'linked').length;
  const todayCount = tickets.filter(t => {
    const d = new Date(t.created_at);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;

  const thisMonthCount = tickets.filter(t => {
    const ticketDate = new Date(t.created_at);
    const today = new Date();
    return ticketDate.getMonth() === today.getMonth() && ticketDate.getFullYear() === today.getFullYear();
  }).length;

  const totalNettMassKg = tickets.reduce((sum, t) => sum + (Number(t.nett_mass) || 0), 0);

  return (
    <div className="h-[calc(100vh-2rem)] flex flex-col bg-slate-50/60 p-4 md:p-6 overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col space-y-5">

        {/* STATIC FIXED TOP SECTION (Pinned at top, does NOT scroll) */}
        <div className="shrink-0 space-y-3.5">
          <section className="overflow-hidden rounded-lg border border-[#0d2036] bg-[#0d2036] text-white shadow-lg shadow-slate-900/20">
            <div className="flex flex-col gap-5 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="border border-[#f39200]/70 bg-[#f39200]/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#ffc36b]">Inbound logistics</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Live intake connected</span>
                </div>
                <h1 className="mt-3 text-2xl font-bold">Weigh Bridge</h1>
                <p className="mt-1 text-sm text-slate-300">Vehicle weight control before Goods Received Notes and Sage GRV processing.</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => fetchTickets(true)}
                  className="inline-flex h-12 w-12 items-center justify-center border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
                  title="Refresh weighbridge register"
                  aria-label="Refresh weighbridge register"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
                <button
                  onClick={openNewTicketModal}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-none bg-[#f39200] px-5 text-sm font-bold text-white shadow-lg shadow-black/20 transition-colors hover:bg-[#dc8500]"
                >
                  <Plus className="h-5 w-5" />
                  New WB Ticket
                </button>
              </div>
            </div>
            <div className="grid border-t border-white/10 sm:grid-cols-2 xl:grid-cols-5">
              <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Register</p><p className="mt-2 text-3xl font-bold">{tickets.length}</p><p className="mt-1 text-xs text-slate-400">Vehicle tickets</p></div>
              <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Awaiting GRN</p><p className="mt-2 text-3xl font-bold text-[#ffc36b]">{openCount}</p><p className="mt-1 text-xs text-slate-400">Ready to link</p></div>
              <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Linked to GRN</p><p className="mt-2 text-3xl font-bold text-emerald-300">{linkedCount}</p><p className="mt-1 text-xs text-slate-400">Intake handed over</p></div>
              <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">This Month</p><p className="mt-2 text-3xl font-bold text-cyan-300">{thisMonthCount}</p><p className="mt-1 text-xs text-slate-400">Vehicles weighed</p></div>
              <div className="px-5 py-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Live intake activity</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="inline-flex items-center gap-1.5 text-[#ffc36b]"><span className="h-1.5 w-1.5 rounded-full bg-[#f39200]" />Open {openCount}</span><span className="inline-flex items-center gap-1.5 text-cyan-300"><Loader2 className="h-3.5 w-3.5" />Today {todayCount}</span><span className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircle className="h-3.5 w-3.5" />Linked {linkedCount}</span></div><p className="mt-2 text-xs text-slate-400">{totalNettMassKg.toLocaleString()} kg recorded</p></div>
            </div>
          </section>

          {/* Search & Filter Bar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
            <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                {['all', 'open', 'linked', 'cancelled'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                      statusFilter === st
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    {st === 'all' ? 'All Tickets' : st}
                  </button>
                ))}
              </div>

              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search ticket #, vehicle, driver, product..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 border border-slate-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-slate-50/50"
                />
              </div>
            </div>
          </div>
        </div>

        {/* SCROLLABLE TABLE / CONTENT SECTION (Scrolls underneath static top) */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-white rounded-2xl border border-slate-200 shadow-sm relative">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <div className="w-8 h-8 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-2" />
              <p className="text-xs font-semibold text-slate-600">Loading weighbridge tickets...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Scale className="w-12 h-12 mb-3 text-slate-300 animate-pulse" />
              <p className="text-sm font-bold text-slate-700">No weighbridge tickets found</p>
              <p className="text-xs mt-1 text-slate-400">Click "New WB Ticket" above to record a vehicle weighing.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-900 text-white uppercase tracking-wider font-semibold sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-5 py-3.5 text-left">Ticket #</th>
                    <th className="px-5 py-3.5 text-left">Vehicle Reg</th>
                    <th className="px-5 py-3.5 text-left">Driver Name</th>
                    <th className="px-5 py-3.5 text-left">Product / Material</th>
                    <th className="px-5 py-3.5 text-left">Supplier</th>
                    <th className="px-5 py-3.5 text-left">Initiated By</th>
                    <th className="px-5 py-3.5 text-right">Nett Mass (kg)</th>
                    <th className="px-5 py-3.5 text-left">Time In</th>
                    <th className="px-5 py-3.5 text-left">Status</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(t => {
                    const stStyle = STATUS_STYLES[t.status] || STATUS_STYLES.open;

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3.5 font-mono font-bold text-slate-900">{t.ticket_no}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                            <Truck className="w-3.5 h-3.5 text-slate-400" />
                            {t.vehicle_reg || '—'}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-700">{t.driver_name || '—'}</td>
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-slate-900">{t.product_name || '—'}</div>
                          {t.product_code && (
                            <span className="text-[10px] font-mono text-blue-700 bg-blue-50 px-1 rounded border border-blue-200">
                              {t.product_code}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-slate-600 font-medium">{(t as any).suppliers?.name || t.unregistered_supplier_name || '—'}</td>
                        <td className="px-5 py-3.5 text-slate-700 text-xs font-medium">{(t as any).created_by_user?.full_name || (t as any).created_by_user?.email || '—'}</td>
                        <td className="px-5 py-3.5 text-right font-extrabold text-slate-900 font-mono text-sm">
                          {t.nett_mass != null ? Number(t.nett_mass).toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'}
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 font-mono text-[11px]">
                          {t.time_in ? format(new Date(t.time_in), 'dd MMM HH:mm') : '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${stStyle.bg} ${stStyle.color} ${stStyle.border}`}>
                            {t.status === 'linked' ? (
                              <>
                                <CheckCircle className="w-3 h-3 text-emerald-600" /> Linked to GRN
                              </>
                            ) : stStyle.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => setViewTicket(t)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors text-xs font-bold"
                          >
                            <Eye className="w-3.5 h-3.5" /> View Ticket
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* New Ticket Modal */}
      <Dialog open={newOpen} onOpenChange={() => setNewOpen(false)}>
        <DialogContent className="max-w-[1100px] w-[96vw] max-h-[94vh] p-0 overflow-hidden flex flex-col sm:!max-w-[1100px] rounded-lg border-0 shadow-2xl [&>button.absolute]:hidden">
          {/* Header */}
          <div className="bg-[#09072c] border-b-4 border-orange-500 text-white px-6 py-4 flex-shrink-0 relative">
            <button
              onClick={() => setNewOpen(false)}
              className="absolute top-3.5 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-500/15 border border-orange-400/30 rounded-lg flex items-center justify-center">
                <Scale className="w-5 h-5 text-orange-300" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">New Weighbridge Ticket</h2>
                <p className="text-slate-300 text-xs mt-0.5">Record gross & tare vehicle weights — link to a GRN after saving</p>
              </div>
            </div>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSave} className="flex-1 overflow-y-auto bg-slate-50/80">
            <div className="p-6">
              <WeighBridgeTicket
                data={form as any}
                onChange={handleFormChange}
                hideHeader
              />
            </div>
            {/* Sticky Footer */}
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-3 shadow-lg">
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                <Scale className="w-4 h-4" />
                {saving ? 'Saving Ticket...' : 'Save WeighBridge Ticket'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Ticket Modal */}
      {viewTicket && (
        <Dialog open={!!viewTicket} onOpenChange={() => setViewTicket(null)}>
          <DialogContent className="max-w-[680px] w-[95vw] p-0 overflow-hidden rounded-3xl border-0 shadow-2xl [&>button.absolute]:hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white px-6 py-4 relative">
              <button
                onClick={() => setViewTicket(null)}
                className="absolute top-3.5 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-white" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-emerald-500/20 border border-emerald-500/30 rounded-xl flex items-center justify-center">
                  <Scale className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-xl font-black font-mono tracking-tight">WB Ticket #{viewTicket.ticket_no}</h2>
                  <p className="text-slate-300 text-xs mt-0.5">Created {format(new Date(viewTicket.created_at), 'dd MMM yyyy HH:mm')}</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5 bg-slate-50/80">
              {/* Nett Mass Hero Card */}
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-5 shadow-lg border border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">1st Mass (Gross)</p>
                    <p className="text-lg font-bold text-white font-mono">{viewTicket.first_mass != null ? Number(viewTicket.first_mass).toLocaleString() : '—'} <span className="text-xs font-normal text-slate-400">kg</span></p>
                  </div>
                  <div className="text-slate-400 text-xl font-light">−</div>
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">2nd Mass (Tare)</p>
                    <p className="text-lg font-bold text-white font-mono">{viewTicket.second_mass != null ? Number(viewTicket.second_mass).toLocaleString() : '—'} <span className="text-xs font-normal text-slate-400">kg</span></p>
                  </div>
                  <div className="text-slate-400 text-xl font-light">=</div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Nett Mass</p>
                  <p className="text-2xl font-black text-emerald-400 font-mono">{viewTicket.nett_mass != null ? Number(viewTicket.nett_mass).toLocaleString() : '—'} <span className="text-sm font-normal text-emerald-300">kg</span></p>
                </div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1">Vehicle Logistics</h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Registration</span>
                      <span className="font-bold text-slate-900 font-mono">{viewTicket.vehicle_reg || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Haulier</span>
                      <span className="font-bold text-slate-900">{viewTicket.haulier_code || 'HYPER'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Trailer No</span>
                      <span className="font-bold text-slate-900">{viewTicket.trailer_number || '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1">Driver & Timestamps</h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Driver</span>
                      <span className="font-bold text-slate-900">{viewTicket.driver_name || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Time In</span>
                      <span className="font-mono text-slate-800">{viewTicket.time_in ? format(new Date(viewTicket.time_in), 'dd MMM HH:mm') : '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Time Out</span>
                      <span className="font-mono text-slate-800">{viewTicket.time_out ? format(new Date(viewTicket.time_out), 'dd MMM HH:mm') : '—'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Product Info */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-1 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Product / Raw Material</span>
                <p className="font-extrabold text-slate-900 text-sm">{viewTicket.product_name || '—'} <span className="font-mono font-bold text-blue-700">({viewTicket.product_code || '—'})</span></p>
                <p className="text-[11px] text-slate-500">Supplier: {(viewTicket as any).suppliers?.name || viewTicket.unregistered_supplier_name || '—'}</p>
                {!viewTicket.supplier_id && viewTicket.unregistered_supplier_name && (
                  <p className="text-[11px] font-semibold text-amber-700">Finance follow-up required before GRN linking</p>
                )}
              </div>

              {viewTicket.finance_note && (
                <div className="bg-blue-50 p-3 rounded-2xl border border-blue-200 text-xs text-blue-900">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-blue-700 block mb-0.5">Finance Follow-up</span>
                  {viewTicket.finance_note}
                </div>
              )}

              {/* Comment */}
              {viewTicket.comment && (
                <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200 text-xs text-amber-900">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-amber-700 block mb-0.5">Comment</span>
                  {viewTicket.comment}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className={`px-3 py-1 rounded-full text-xs font-bold border ${STATUS_STYLES[viewTicket.status]?.bg || ''} ${STATUS_STYLES[viewTicket.status]?.color || ''} ${STATUS_STYLES[viewTicket.status]?.border || ''}`}>
                  {viewTicket.status === 'linked' ? `Linked to ${viewTicket.grn_number || 'GRN'}` : STATUS_STYLES[viewTicket.status]?.label}
                </span>
                <button
                  onClick={() => setViewTicket(null)}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
                >
                  Close
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
