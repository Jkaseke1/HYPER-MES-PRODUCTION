import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleDollarSign, ClipboardCheck, Landmark, Link2, Loader2, Plus, ReceiptText, Scale, Send, ShieldCheck, Truck, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import TransporterAccounts, { type RateInput, type TransporterRateCard } from '../components/inbound-transport/TransporterAccounts';
import TransporterSetupDialog, { type TransporterMasterInput } from '../components/inbound-transport/TransporterSetupDialog';
import './InboundTransportPage.css';

type Transporter = {
  id: string; transporter_code: string; name: string; legal_name: string | null; account_reference: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null;
  tax_registration_no: string | null; payment_terms_days: number; business_address: string | null; vehicle_capabilities: string | null; compliance_expiry: string | null; notes: string; default_currency: string; is_active: boolean;
};
type Ticket = {
  id: string; ticket_no: string; vehicle_reg: string | null; haulier_code: string | null; driver_name: string | null; nett_mass: number | null; driver_signed: boolean;
  inbound_transport_mode: 'supplier_provided' | 'company_hired'; inbound_transporter_id: string | null; inbound_rate_per_tonne: number | null; inbound_currency_code: string | null;
};
type Grn = { id: string; grn_number: string; status: string; weigh_bridge_ticket_id: string | null };
type Claim = {
  id: string; claim_number: string; status: string; net_mass_kg: number; rate_per_tonne: number; calculated_amount: number; currency_code: string;
  invoice_number: string | null; waybill_reference: string | null; notes: string; review_note: string | null; payment_reference: string | null; created_at: string;
  transporter_id: string; weigh_bridge_ticket_id: string; grn_id: string;
  inbound_transporters?: Transporter;
};

const money = (value: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value || 0);
const statusStyle: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700', submitted: 'border-sky-200 bg-sky-50 text-sky-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700', rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  paid: 'border-teal-200 bg-teal-50 text-teal-700', cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
};

export default function InboundTransportPage() {
  const { profile } = useAuth();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [rateCards, setRateCards] = useState<TransporterRateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showTransporter, setShowTransporter] = useState(false);
  const [showTransporterSetup, setShowTransporterSetup] = useState(false);
  const [form, setForm] = useState({ ticketId: '', transporterId: '', rate: '', currency: 'USD', invoice: '', waybill: '', notes: '' });
  const [transporterForm, setTransporterForm] = useState({ code: '', name: '', contactName: '', contactPhone: '', currency: 'USD' });

  const canPrepare = profile?.role === 'admin';
  const canReview = profile?.role === 'admin';

  const fetchData = async () => {
    setLoading(true);
    const [claimsRes, transportersRes, ticketsRes, grnsRes, rateCardsRes] = await Promise.all([
      supabase.from('inbound_transport_claims').select('*, inbound_transporters(id, transporter_code, name, legal_name, account_reference, contact_name, contact_phone, contact_email, tax_registration_no, payment_terms_days, business_address, vehicle_capabilities, compliance_expiry, notes, default_currency, is_active)').order('created_at', { ascending: false }),
      supabase.from('inbound_transporters').select('id, transporter_code, name, legal_name, account_reference, contact_name, contact_phone, contact_email, tax_registration_no, payment_terms_days, business_address, vehicle_capabilities, compliance_expiry, notes, default_currency, is_active').eq('is_active', true).order('name'),
      supabase.from('weigh_bridge_tickets').select('id, ticket_no, vehicle_reg, haulier_code, driver_name, nett_mass, driver_signed, inbound_transport_mode, inbound_transporter_id, inbound_rate_per_tonne, inbound_currency_code').eq('driver_signed', true).gt('nett_mass', 0).order('created_at', { ascending: false }),
      supabase.from('goods_received_notes').select('id, grn_number, status, weigh_bridge_ticket_id').not('weigh_bridge_ticket_id', 'is', null).order('created_at', { ascending: false }),
      supabase.from('inbound_transporter_rate_cards').select('id, transporter_id, route_from, route_to, vehicle_type, material_group, currency_code, rate_per_tonne, effective_from, effective_to, is_active, notes').order('effective_from', { ascending: false }),
    ]);
    if (claimsRes.error || transportersRes.error || ticketsRes.error || grnsRes.error || rateCardsRes.error) {
      setError(claimsRes.error?.message || transportersRes.error?.message || ticketsRes.error?.message || grnsRes.error?.message || rateCardsRes.error?.message || 'Unable to load transport data.');
    } else {
      setClaims((claimsRes.data || []) as Claim[]);
      setTransporters((transportersRes.data || []) as Transporter[]);
      setTickets((ticketsRes.data || []) as Ticket[]);
      setGrns((grnsRes.data || []) as Grn[]);
      setRateCards((rateCardsRes.data || []) as TransporterRateCard[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);
  useRealtimeRefresh('inbound-transport-live', ['inbound_transport_claims', 'inbound_transporters', 'inbound_transporter_rate_cards', 'weigh_bridge_tickets', 'goods_received_notes'], fetchData);

  const grnByTicket = useMemo(() => new Map(grns.map((grn) => [grn.weigh_bridge_ticket_id, grn])), [grns]);
  const claimedTicketIds = useMemo(() => new Set(claims.map((claim) => claim.weigh_bridge_ticket_id)), [claims]);
  const eligibleTickets = useMemo(() => tickets.filter((ticket) => (
    ticket.inbound_transport_mode === 'company_hired'
    && grnByTicket.has(ticket.id)
    && !claimedTicketIds.has(ticket.id)
  )), [tickets, grnByTicket, claimedTicketIds]);
  const findTicketTransporter = (ticket?: Ticket) => {
    const haulierCode = ticket?.haulier_code?.trim().toUpperCase();
    return haulierCode ? transporters.find((transporter) => transporter.transporter_code.trim().toUpperCase() === haulierCode) : undefined;
  };
  const selectedTicket = tickets.find((ticket) => ticket.id === form.ticketId);
  const ticketTransporter = findTicketTransporter(selectedTicket);
  const calculated = selectedTicket && form.rate !== '' ? (Number(selectedTicket.nett_mass || 0) / 1000) * Number(form.rate) : 0;
  const stats = useMemo(() => ({ ready: eligibleTickets.length, submitted: claims.filter((claim) => claim.status === 'submitted').length, approved: claims.filter((claim) => claim.status === 'approved').length, approvedValue: claims.filter((claim) => ['approved', 'paid'].includes(claim.status)).reduce((sum, claim) => sum + Number(claim.calculated_amount || 0), 0) }), [claims, eligibleTickets]);

  const openClaim = () => {
    const firstTicket = eligibleTickets[0];
    const linkedTransporter = findTicketTransporter(firstTicket);
    const transporter = linkedTransporter || transporters[0];
    setForm({ ticketId: firstTicket?.id || '', transporterId: linkedTransporter?.id || firstTicket?.inbound_transporter_id || transporter?.id || '', rate: firstTicket?.inbound_rate_per_tonne == null ? '' : String(firstTicket.inbound_rate_per_tonne), currency: firstTicket?.inbound_currency_code || linkedTransporter?.default_currency || transporter?.default_currency || 'USD', invoice: '', waybill: '', notes: '' });
    setError(null); setShowForm(true);
  };

  const selectTicket = (ticketId: string) => {
    const ticket = tickets.find((item) => item.id === ticketId);
    const linkedTransporter = findTicketTransporter(ticket);
    setForm((current) => ({
      ...current,
      ticketId,
      transporterId: linkedTransporter?.id || ticket?.inbound_transporter_id || current.transporterId,
      rate: ticket?.inbound_rate_per_tonne == null ? current.rate : String(ticket.inbound_rate_per_tonne),
      currency: ticket?.inbound_currency_code || linkedTransporter?.default_currency || current.currency,
    }));
  };

  const saveClaim = async (submit: boolean) => {
    if (!form.ticketId || !form.transporterId || form.rate === '') { setError('Select the evidence ticket, transporter, and rate per tonne.'); return; }
    setSaving(true); setError(null);
    const { data: claimId, error: saveError } = await supabase.rpc('save_inbound_transport_claim', {
      p_claim_id: null, p_weigh_bridge_ticket_id: form.ticketId, p_transporter_id: form.transporterId,
      p_rate_per_tonne: Number(form.rate), p_currency_code: form.currency, p_invoice_number: form.invoice,
      p_waybill_reference: form.waybill, p_notes: form.notes,
    });
    if (saveError) { setError(saveError.message); setSaving(false); return; }
    if (submit) {
      const { error: submitError } = await supabase.rpc('submit_inbound_transport_claim', { p_claim_id: claimId });
      if (submitError) { setError(submitError.message); setSaving(false); await fetchData(); return; }
    }
    setShowForm(false); setSaving(false); await fetchData();
  };

  const reviewClaim = async (claim: Claim, approved: boolean) => {
    const note = window.prompt(approved ? 'Approval note (optional)' : 'Reason for returning this claim (required)');
    if (!approved && !note?.trim()) return;
    setSaving(true); setError(null);
    const { error: reviewError } = await supabase.rpc('review_inbound_transport_claim', { p_claim_id: claim.id, p_approved: approved, p_note: note || null });
    if (reviewError) setError(reviewError.message);
    setSaving(false); await fetchData();
  };

  const submitClaim = async (claim: Claim) => {
    setSaving(true); setError(null);
    const { error: submitError } = await supabase.rpc('submit_inbound_transport_claim', { p_claim_id: claim.id });
    if (submitError) setError(submitError.message);
    setSaving(false); await fetchData();
  };

  const markPaid = async (claim: Claim) => {
    const reference = window.prompt('Payment reference');
    if (!reference?.trim()) return;
    setSaving(true); setError(null);
    const { error: paidError } = await supabase.rpc('mark_inbound_transport_claim_paid', { p_claim_id: claim.id, p_payment_reference: reference });
    if (paidError) setError(paidError.message);
    setSaving(false); await fetchData();
  };

  const addTransporter = async () => {
    if (!transporterForm.code.trim() || !transporterForm.name.trim()) return;
    setSaving(true); setError(null);
    const { error: transporterError } = await supabase.from('inbound_transporters').insert({ transporter_code: transporterForm.code.trim().toUpperCase(), name: transporterForm.name.trim(), contact_name: transporterForm.contactName.trim() || null, contact_phone: transporterForm.contactPhone.trim() || null, default_currency: transporterForm.currency, created_by: profile?.id });
    if (transporterError) setError(transporterError.message); else { setShowTransporter(false); setTransporterForm({ code: '', name: '', contactName: '', contactPhone: '', currency: 'USD' }); await fetchData(); }
    setSaving(false);
  };

  const createTransporterMaster = async (input: TransporterMasterInput) => {
    setSaving(true); setError(null);
    const { error: transporterError } = await supabase.from('inbound_transporters').insert({
      transporter_code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      legal_name: input.legalName.trim(),
      account_reference: input.accountReference.trim() || null,
      default_currency: input.currency,
      payment_terms_days: Number(input.paymentTermsDays),
      contact_name: input.contactName.trim() || null,
      contact_phone: input.contactPhone.trim() || null,
      contact_email: input.contactEmail.trim() || null,
      tax_registration_no: input.taxRegistrationNo.trim() || null,
      business_address: input.address.trim() || null,
      vehicle_capabilities: input.vehicleCapabilities.trim() || null,
      compliance_expiry: input.complianceExpiry || null,
      notes: input.notes.trim(),
      created_by: profile?.id,
    });
    if (transporterError) setError(transporterError.message); else await fetchData();
    setSaving(false);
    return !transporterError;
  };

  const addRateCard = async (transporterId: string, input: RateInput) => {
    setSaving(true); setError(null);
    const { error: rateError } = await supabase.from('inbound_transporter_rate_cards').insert({
      transporter_id: transporterId,
      route_from: input.routeFrom.trim(),
      route_to: input.routeTo.trim(),
      vehicle_type: input.vehicleType.trim() || null,
      material_group: input.materialGroup.trim() || null,
      currency_code: input.currency,
      rate_per_tonne: Number(input.rate),
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo || null,
      notes: input.notes.trim(),
      created_by: profile?.id,
    });
    if (rateError) setError(rateError.message); else await fetchData();
    setSaving(false);
    return !rateError;
  };

  return <div className="transport-control space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-xl font-semibold text-slate-900">Inbound Transport Costs</h1><p className="mt-0.5 text-sm text-slate-500">Weighbridge-linked freight claims with Finance approval control.</p></div>
      <div className="flex flex-wrap gap-2">
        {canPrepare && <button onClick={() => setShowTransporterSetup(true)} className="inline-flex items-center gap-1.5 bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"><Truck className="h-3.5 w-3.5" /> Set up transporter</button>}
        {canPrepare && <button onClick={() => setShowTransporter(true)} className="inline-flex items-center gap-1.5 border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Truck className="h-3.5 w-3.5" /> Add transporter</button>}
        {canPrepare && <button onClick={openClaim} disabled={!eligibleTickets.length || !transporters.length} className="inline-flex items-center gap-1.5 bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> New transport claim</button>}
      </div>
    </div>

    <section className="transport-workflow" aria-label="Inbound transport cost workflow">
      <div><Scale className="h-4 w-4" /><span>Signed weighbridge</span></div><ArrowRight className="h-4 w-4" /><div><ReceiptText className="h-4 w-4" /><span>GRN linked</span></div><ArrowRight className="h-4 w-4" /><div><Link2 className="h-4 w-4" /><span>Transport claim</span></div><ArrowRight className="h-4 w-4" /><div><ShieldCheck className="h-4 w-4" /><span>Finance review</span></div><ArrowRight className="h-4 w-4" /><div><Landmark className="h-4 w-4" /><span>Payment recorded</span></div>
    </section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="transport-stat border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">Ready to claim</p><p className="mt-1 text-2xl font-semibold text-slate-900">{stats.ready}</p><span>Signed ticket + GRN</span></div>
      <div className="transport-stat border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">Awaiting Finance</p><p className="mt-1 text-2xl font-semibold text-slate-900">{stats.submitted}</p><span>Submitted claims</span></div>
      <div className="border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">Approved, unpaid</p><p className="mt-1 text-2xl font-semibold text-emerald-700">{stats.approved}</p></div>
      <div className="border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">Approved value</p><p className="mt-1 text-2xl font-semibold text-slate-900">{money(stats.approvedValue, 'USD')}</p></div>
    </div>

    {error && <div className="flex items-center gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"><X className="h-4 w-4" />{error}</div>}
    <div className="overflow-hidden border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Claim</th><th className="px-3 py-3">Evidence</th><th className="px-3 py-3">Transporter</th><th className="px-3 py-3 text-right">Net mass</th><th className="px-3 py-3 text-right">Rate / t</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Actions</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={8} className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr> : claims.length === 0 ? <tr><td colSpan={8} className="py-14 text-center text-slate-400">No inbound transport claims yet.</td></tr> : claims.map((claim) => { const ticket = tickets.find((item) => item.id === claim.weigh_bridge_ticket_id); const grn = grns.find((item) => item.id === claim.grn_id); return <tr key={claim.id} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-mono text-xs font-semibold text-slate-800">{claim.claim_number}<span className="mt-1 block font-sans font-normal text-slate-500">{claim.invoice_number || claim.waybill_reference || 'No document'}</span></td><td className="px-3 py-3"><span className="block font-medium text-slate-800">{ticket?.ticket_no || 'Weighbridge ticket'}</span><span className="mt-1 block text-xs text-slate-500">{grn?.grn_number || 'Linked GRN'} · {ticket?.vehicle_reg || 'Vehicle not set'}</span></td><td className="px-3 py-3"><span className="font-medium text-slate-800">{claim.inbound_transporters?.name}</span><span className="ml-1 font-mono text-xs text-slate-400">{claim.inbound_transporters?.transporter_code}</span></td><td className="px-3 py-3 text-right font-mono text-slate-700">{Number(claim.net_mass_kg).toLocaleString()} kg</td><td className="px-3 py-3 text-right font-mono text-slate-700">{money(Number(claim.rate_per_tonne), claim.currency_code)}</td><td className="px-3 py-3 text-right font-semibold text-slate-900">{money(Number(claim.calculated_amount), claim.currency_code)}</td><td className="px-3 py-3"><span className={`inline-flex border px-2 py-1 text-xs font-semibold capitalize ${statusStyle[claim.status] || statusStyle.draft}`}>{claim.status}</span>{claim.review_note && <span className="mt-1 block max-w-44 truncate text-xs text-rose-700" title={claim.review_note}>{claim.review_note}</span>}</td><td className="px-3 py-3"><div className="flex justify-end gap-1.5">{canPrepare && ['draft', 'rejected'].includes(claim.status) && <button onClick={() => submitClaim(claim)} className="inline-flex items-center gap-1 border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"><Send className="h-3.5 w-3.5" /> Submit</button>}{canReview && claim.status === 'submitted' && <><button onClick={() => reviewClaim(claim, true)} className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"><CheckCircle2 className="h-3.5 w-3.5" /> Approve</button><button onClick={() => reviewClaim(claim, false)} className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100">Return</button></>}{canReview && claim.status === 'approved' && <button onClick={() => markPaid(claim)} className="inline-flex items-center gap-1 border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100"><CircleDollarSign className="h-3.5 w-3.5" /> Paid</button>}</div></td></tr>; })}
    </tbody></table></div></div>

    <TransporterAccounts transporters={transporters} claims={claims} rateCards={rateCards} saving={saving} onAddRate={addRateCard} />

    <TransporterSetupDialog open={showTransporterSetup} saving={saving} onClose={() => setShowTransporterSetup(false)} onSave={createTransporterMaster} />

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><div className="w-full max-w-2xl border border-slate-200 bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-4 text-white"><div><h2 className="font-semibold">New transport claim</h2><p className="mt-0.5 text-xs text-slate-300">Value is calculated from signed net mass and rate per tonne.</p></div><button onClick={() => setShowForm(false)} className="p-1 text-slate-300 hover:text-white" title="Close"><X className="h-5 w-5" /></button></div><div className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Evidence ticket<select value={form.ticketId} onChange={(e) => selectTicket(e.target.value)} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Select ticket and GRN</option>{eligibleTickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.ticket_no} · {grnByTicket.get(ticket.id)?.grn_number} · {Number(ticket.nett_mass).toLocaleString()} kg</option>)}</select></label><label className="text-sm font-medium text-slate-700">Transporter<select value={form.transporterId} onChange={(e) => { const transporter = transporters.find((item) => item.id === e.target.value); setForm({ ...form, transporterId: e.target.value, currency: transporter?.default_currency || form.currency }); }} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Select transporter</option>{transporters.map((transporter) => <option key={transporter.id} value={transporter.id}>{transporter.transporter_code} · {transporter.name}</option>)}</select></label>{selectedTicket && <div className="transport-evidence-summary sm:col-span-2"><div><span>Signed ticket</span><strong>{selectedTicket.ticket_no}</strong><small>{selectedTicket.vehicle_reg || 'Vehicle not recorded'} · {Number(selectedTicket.nett_mass).toLocaleString()} kg</small></div><div><span>GRN</span><strong>{grnByTicket.get(selectedTicket.id)?.grn_number}</strong><small>{ticketTransporter ? `Matched to ${ticketTransporter.name}` : `Haulier code: ${selectedTicket.haulier_code || 'not recorded'}`}</small></div></div>}<label className="text-sm font-medium text-slate-700">Rate per tonne<input type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm" placeholder="0.00" /></label><label className="text-sm font-medium text-slate-700">Currency<select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm"><option>USD</option><option>ZIG</option><option>ZAR</option></select></label><div className="border border-teal-200 bg-teal-50 p-3 sm:col-span-2"><div className="flex items-center justify-between"><span className="text-sm font-medium text-teal-900">Calculated transport cost</span><span className="font-mono text-lg font-semibold text-teal-900">{money(calculated, form.currency)}</span></div><p className="mt-1 text-xs text-teal-700">{selectedTicket ? `${Number(selectedTicket.nett_mass).toLocaleString()} kg ÷ 1,000 × ${Number(form.rate || 0).toLocaleString()} per tonne` : 'Select a signed ticket to calculate.'}</p></div><label className="text-sm font-medium text-slate-700">Invoice number<input value={form.invoice} onChange={(e) => setForm({ ...form, invoice: e.target.value })} className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-sm font-medium text-slate-700">Waybill reference<input value={form.waybill} onChange={(e) => setForm({ ...form, waybill: e.target.value })} className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">Notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 min-h-20 w-full border border-slate-300 px-3 py-2 text-sm" placeholder="Route, agreed terms, or supporting detail" /></label></div><div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button onClick={() => setShowForm(false)} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button><button onClick={() => saveClaim(false)} disabled={saving} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Save draft</button><button onClick={() => saveClaim(true)} disabled={saving} className="inline-flex items-center gap-1.5 bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"><Send className="h-4 w-4" /> Submit to Finance</button></div></div></div>}
    {showTransporter && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">Add transporter</h2><button onClick={() => setShowTransporter(false)} className="text-slate-500 hover:text-slate-900" title="Close"><X className="h-5 w-5" /></button></div><div className="space-y-3 p-5"><label className="block text-sm font-medium text-slate-700">Code<input value={transporterForm.code} onChange={(e) => setTransporterForm({ ...transporterForm, code: e.target.value })} className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. TRANS-001" /></label><label className="block text-sm font-medium text-slate-700">Name<input value={transporterForm.name} onChange={(e) => setTransporterForm({ ...transporterForm, name: e.target.value })} className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm" /></label><label className="block text-sm font-medium text-slate-700">Default currency<select value={transporterForm.currency} onChange={(e) => setTransporterForm({ ...transporterForm, currency: e.target.value })} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm"><option>USD</option><option>ZIG</option><option>ZAR</option></select></label></div><div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button onClick={() => setShowTransporter(false)} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button><button onClick={addTransporter} disabled={saving} className="bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Add transporter</button></div></div></div>}
  </div>;
}
