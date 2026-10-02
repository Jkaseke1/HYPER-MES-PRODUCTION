import { useMemo, useState } from 'react';
import { CheckCircle2, Link2, Loader2, ReceiptText, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export type SageHistoryEntry = {
  id: string; supplier_account: string; transaction_type: 'APTx' | 'CBAP'; reference: string; audit_number: string;
  description: string; transaction_date: string; debit: number; credit: number;
};
export type SageAllocation = { claim_id: string; sage_history_id: string; allocated_amount: number };
export type ClaimReconciliation = {
  claim_id: string; charge_allocated: number; payment_allocated: number; outstanding_amount: number;
  charge_evidence: string | null; payment_evidence: string | null;
  reconciliation_status: 'awaiting_sage_charge' | 'awaiting_payment' | 'part_paid' | 'paid';
};

type Props = {
  claim: { id: string; claim_number: string; calculated_amount: number; currency_code: string; invoice_number: string | null; waybill_reference: string | null; inbound_transporters?: { name: string; sage_supplier_account?: string | null } };
  evidence: { ticketNo?: string; grnNumber?: string };
  reconciliation?: ClaimReconciliation;
  entries: SageHistoryEntry[];
  chargeAllocations: SageAllocation[];
  paymentAllocations: SageAllocation[];
  onClose: () => void;
  onSaved: () => Promise<void>;
};

const amount = (value: number) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ledgerAmount = (entry: SageHistoryEntry) => entry.transaction_type === 'APTx' ? Number(entry.credit) - Number(entry.debit) : Number(entry.debit) - Number(entry.credit);

export default function TransportClaimReconciliationDialog({ claim, evidence, reconciliation, entries, chargeAllocations, paymentAllocations, onClose, onSaved }: Props) {
  const [entryId, setEntryId] = useState('');
  const [allocation, setAllocation] = useState('');
  const [mode, setMode] = useState<'APTx' | 'CBAP'>('APTx');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const supplier = claim.inbound_transporters?.sage_supplier_account?.trim().toUpperCase();
  const total = Number(claim.calculated_amount || 0);
  const selectedAllocations = mode === 'APTx' ? chargeAllocations : paymentAllocations;
  const candidates = useMemo(() => entries.filter((entry) => entry.transaction_type === mode && entry.supplier_account.trim().toUpperCase() === supplier), [entries, mode, supplier]);
  const usedFor = (historyId: string) => selectedAllocations.filter((item) => item.sage_history_id === historyId).reduce((sum, item) => sum + Number(item.allocated_amount), 0);
  const alreadyOnClaim = (historyId: string) => selectedAllocations.find((item) => item.claim_id === claim.id && item.sage_history_id === historyId)?.allocated_amount || 0;
  const selected = candidates.find((entry) => entry.id === entryId);
  const remainingClaim = mode === 'APTx'
    ? Math.max(total - Number(reconciliation?.charge_allocated || 0) + Number(alreadyOnClaim(entryId)), 0)
    : Math.max(total - Number(reconciliation?.payment_allocated || 0) + Number(alreadyOnClaim(entryId)), 0);
  const remainingEntry = selected ? Math.max(ledgerAmount(selected) - usedFor(selected.id) + Number(alreadyOnClaim(selected.id)), 0) : 0;

  const selectEntry = (id: string) => {
    setEntryId(id);
    const found = candidates.find((entry) => entry.id === id);
    if (!found) { setAllocation(''); return; }
    const current = alreadyOnClaim(id);
    const claimAvailable = mode === 'APTx' ? total - Number(reconciliation?.charge_allocated || 0) + Number(current) : total - Number(reconciliation?.payment_allocated || 0) + Number(current);
    setAllocation(String(Math.max(0, Math.min(ledgerAmount(found) - usedFor(id) + Number(current), claimAvailable)).toFixed(2)));
  };

  const save = async () => {
    if (!selected || Number(allocation) <= 0) { setError('Select an imported Sage entry and enter a positive allocation.'); return; }
    if (Number(allocation) > remainingClaim + 0.01 || Number(allocation) > remainingEntry + 0.01) { setError('Allocation exceeds the remaining claim or Sage entry amount.'); return; }
    setSaving(true); setError('');
    const { error: rpcError } = await supabase.rpc('allocate_inbound_transport_sage_entry', {
      p_claim_id: claim.id, p_sage_history_id: selected.id, p_allocated_amount: Number(allocation), p_entry_type: mode,
    });
    if (rpcError) { setError(rpcError.message); setSaving(false); return; }
    await onSaved();
    setSaving(false);
  };

  const state = reconciliation?.reconciliation_status || 'awaiting_sage_charge';
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="transport-reconciliation-title">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-start justify-between bg-slate-900 px-5 py-4 text-white"><div><h2 id="transport-reconciliation-title" className="text-lg font-semibold">Sage delivery reconciliation</h2><p className="mt-1 text-sm text-slate-300">Allocate imported Sage evidence to this signed weighbridge delivery. No Sage posting is created here.</p></div><button onClick={onClose} className="rounded border border-slate-700 p-1.5 text-slate-200 hover:bg-slate-800" title="Close"><X className="h-4 w-4" /></button></header>
      <div className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-3"><div className="border border-slate-200 p-3"><span className="text-xs font-medium uppercase tracking-wide text-slate-500">Delivery evidence</span><strong className="mt-1 block font-mono text-sm text-slate-900">{evidence.ticketNo || 'Ticket unavailable'}</strong><span className="mt-1 block text-xs text-slate-500">{evidence.grnNumber || 'GRN unavailable'}</span></div><div className="border border-slate-200 p-3"><span className="text-xs font-medium uppercase tracking-wide text-slate-500">Transporter</span><strong className="mt-1 block text-sm text-slate-900">{claim.inbound_transporters?.name || 'Not recorded'}</strong><span className="mt-1 block font-mono text-xs text-slate-500">{supplier || 'Sage supplier not mapped'}</span></div><div className="border border-teal-200 bg-teal-50 p-3"><span className="text-xs font-medium uppercase tracking-wide text-teal-700">Claim value</span><strong className="mt-1 block font-mono text-lg text-teal-900">{claim.currency_code} {amount(total)}</strong><span className="mt-1 block text-xs text-teal-700">{claim.invoice_number || claim.waybill_reference || 'No supplier document recorded'}</span></div></div>
        <div className="grid gap-3 sm:grid-cols-3"><div className="border border-slate-200 p-3"><span className="text-xs text-slate-500">Sage charge matched</span><strong className="mt-1 block font-mono">{amount(Number(reconciliation?.charge_allocated || 0))}</strong><span className="mt-1 block text-xs text-slate-500">{reconciliation?.charge_evidence || 'Not yet allocated'}</span></div><div className="border border-slate-200 p-3"><span className="text-xs text-slate-500">Sage payment matched</span><strong className="mt-1 block font-mono">{amount(Number(reconciliation?.payment_allocated || 0))}</strong><span className="mt-1 block text-xs text-slate-500">{reconciliation?.payment_evidence || 'Not yet allocated'}</span></div><div className="border border-slate-200 p-3"><span className="text-xs text-slate-500">PlantControl status</span><strong className="mt-1 block capitalize text-slate-900">{state.replace('_', ' ')}</strong><span className="mt-1 block text-xs text-slate-500">Outstanding: {amount(Number(reconciliation?.outstanding_amount ?? total))}</span></div></div>
        {!supplier ? <div className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Map the transporter to its verified Sage supplier account before reconciling this delivery.</div> : <><div className="flex gap-2 border-b border-slate-200"><button onClick={() => { setMode('APTx'); setEntryId(''); setAllocation(''); setError(''); }} className={`border-b-2 px-3 py-2 text-sm font-semibold ${mode === 'APTx' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'}`}><ReceiptText className="mr-1 inline h-4 w-4" /> Match Sage charge</button><button onClick={() => { setMode('CBAP'); setEntryId(''); setAllocation(''); setError(''); }} className={`border-b-2 px-3 py-2 text-sm font-semibold ${mode === 'CBAP' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'}`}><CheckCircle2 className="mr-1 inline h-4 w-4" /> Match Sage payment</button></div>
          {mode === 'CBAP' && Number(reconciliation?.charge_allocated || 0) <= 0 && <div className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Allocate the supplier's Sage charge first. This keeps a payment tied to a charge and delivery.</div>}
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]"><label className="text-sm font-medium text-slate-700">Imported Sage {mode === 'APTx' ? 'charge' : 'payment'}<select value={entryId} onChange={(event) => selectEntry(event.target.value)} disabled={mode === 'CBAP' && Number(reconciliation?.charge_allocated || 0) <= 0} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Select imported evidence</option>{candidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.transaction_date} · {entry.reference} / {entry.audit_number} · available {amount(Math.max(ledgerAmount(entry) - usedFor(entry.id) + Number(alreadyOnClaim(entry.id)), 0))}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Allocation amount<input type="number" min="0.01" step="0.01" value={allocation} onChange={(event) => setAllocation(event.target.value)} className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm" /></label></div>
          {selected && <div className="border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><div className="flex items-center gap-2 font-semibold text-slate-800"><Link2 className="h-4 w-4 text-teal-700" />{selected.reference} / {selected.audit_number}</div><p className="mt-1">{selected.description}</p><p className="mt-2">Entry available: {amount(remainingEntry)} · Claim remaining: {amount(remainingClaim)}</p></div>}</>}
        {error && <p role="alert" className="border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button onClick={onClose} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Close</button><button onClick={save} disabled={saving || !supplier || !entryId || (mode === 'CBAP' && Number(reconciliation?.charge_allocated || 0) <= 0)} className="inline-flex items-center gap-1.5 bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Allocate imported Sage {mode === 'APTx' ? 'charge' : 'payment'}</button></footer>
    </div>
  </div>;
}
