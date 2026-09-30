import { useMemo, useState } from 'react';
import { AlertTriangle, BadgeDollarSign, ChevronRight, FileWarning, Plus, ReceiptText, Route, Truck, X } from 'lucide-react';

export type TransporterAccount = {
  id: string;
  transporter_code: string;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  default_currency: string;
};

export type TransportClaim = {
  id: string;
  claim_number: string;
  transporter_id: string;
  status: string;
  net_mass_kg: number;
  rate_per_tonne: number;
  calculated_amount: number;
  currency_code: string;
  invoice_number: string | null;
  waybill_reference: string | null;
  review_note: string | null;
  created_at: string;
};

export type TransporterRateCard = {
  id: string;
  transporter_id: string;
  route_from: string;
  route_to: string;
  vehicle_type: string | null;
  material_group: string | null;
  currency_code: string;
  rate_per_tonne: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  notes: string;
};

export type RateInput = {
  routeFrom: string;
  routeTo: string;
  vehicleType: string;
  materialGroup: string;
  currency: string;
  rate: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
};

const money = (value: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value || 0);
const emptyRate = (): RateInput => ({ routeFrom: '', routeTo: '', vehicleType: '', materialGroup: '', currency: 'USD', rate: '', effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '', notes: '' });

export default function TransporterAccounts({
  transporters,
  claims,
  rateCards,
  saving,
  onAddRate,
}: {
  transporters: TransporterAccount[];
  claims: TransportClaim[];
  rateCards: TransporterRateCard[];
  saving: boolean;
  onAddRate: (transporterId: string, input: RateInput) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRateForm, setShowRateForm] = useState(false);
  const [rateInput, setRateInput] = useState<RateInput>(emptyRate);
  const selected = transporters.find((transporter) => transporter.id === selectedId) || null;
  const accountClaims = useMemo(() => claims.filter((claim) => claim.transporter_id === selectedId), [claims, selectedId]);
  const accountRates = useMemo(() => rateCards.filter((rate) => rate.transporter_id === selectedId).sort((a, b) => b.effective_from.localeCompare(a.effective_from)), [rateCards, selectedId]);
  const accountSummary = useMemo(() => ({
    approvedUnpaid: accountClaims.filter((claim) => claim.status === 'approved').reduce((sum, claim) => sum + Number(claim.calculated_amount), 0),
    paid: accountClaims.filter((claim) => claim.status === 'paid').reduce((sum, claim) => sum + Number(claim.calculated_amount), 0),
    tonnes: accountClaims.reduce((sum, claim) => sum + Number(claim.net_mass_kg || 0), 0) / 1000,
  }), [accountClaims]);
  const exceptions = useMemo(() => {
    const invoiceCounts = new Map<string, number>();
    accountClaims.forEach((claim) => {
      const key = claim.invoice_number?.trim().toUpperCase();
      if (key) invoiceCounts.set(key, (invoiceCounts.get(key) || 0) + 1);
    });
    return accountClaims.flatMap((claim) => {
      const flags: string[] = [];
      if (!claim.invoice_number && !claim.waybill_reference) flags.push('Missing invoice or waybill');
      if (claim.invoice_number && (invoiceCounts.get(claim.invoice_number.trim().toUpperCase()) || 0) > 1) flags.push('Duplicate invoice reference');
      if (claim.status === 'rejected') flags.push('Returned for correction');
      if (claim.status === 'draft' && Date.now() - new Date(claim.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) flags.push('Draft older than seven days');
      return flags.map((flag) => ({ claim, flag }));
    });
  }, [accountClaims]);

  const submitRate = async () => {
    if (!selected || !rateInput.routeFrom.trim() || !rateInput.routeTo.trim() || !rateInput.rate || Number(rateInput.rate) <= 0) return;
    if (await onAddRate(selected.id, rateInput)) {
      setShowRateForm(false);
      setRateInput(emptyRate());
    }
  };

  return (
    <section className="border border-slate-200 bg-white" aria-label="Transporter accounts">
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-base font-semibold text-slate-900">Transporter accounts</h2><p className="mt-0.5 text-xs text-slate-500">Local cost accounts only. No Sage posting is created from this register.</p></div>
        <span className="inline-flex w-fit items-center gap-1.5 border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800"><Truck className="h-3.5 w-3.5" />{transporters.length} active accounts</span>
      </div>

      <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-3">
        {transporters.length === 0 ? <p className="col-span-full px-4 py-8 text-center text-sm text-slate-400">Create a transporter account to start recording hired transport costs.</p> : transporters.map((transporter) => {
          const transporterClaims = claims.filter((claim) => claim.transporter_id === transporter.id);
          const outstanding = transporterClaims.filter((claim) => claim.status === 'approved').reduce((sum, claim) => sum + Number(claim.calculated_amount), 0);
          const currency = transporterClaims[0]?.currency_code || transporter.default_currency;
          return <button key={transporter.id} type="button" onClick={() => { setSelectedId(transporter.id); setShowRateForm(false); }} className={`min-w-0 p-4 text-left transition-colors hover:bg-slate-50 ${selectedId === transporter.id ? 'bg-teal-50/60 ring-1 ring-inset ring-teal-500' : ''}`}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{transporter.name}</p><p className="mt-0.5 font-mono text-xs text-slate-500">{transporter.transporter_code}</p></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" /></div>
            <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Approved, unpaid</p><p className="mt-1 font-mono text-sm font-semibold text-slate-900">{money(outstanding, currency)}</p></div><p className="text-xs text-slate-500">{transporterClaims.length} claims</p></div>
          </button>;
        })}
      </div>

      {selected && <div className="border-t border-slate-200 bg-slate-50/70 p-4 sm:p-5">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-mono text-xs text-teal-700">{selected.transporter_code}</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{selected.name}</h3><p className="mt-1 text-xs text-slate-500">{selected.contact_name || 'Contact not recorded'}{selected.contact_phone ? ` · ${selected.contact_phone}` : ''}</p></div><button type="button" onClick={() => setShowRateForm(true)} className="inline-flex items-center justify-center gap-1.5 bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800"><Plus className="h-3.5 w-3.5" /> Add rate card</button></div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Approved, unpaid</p><p className="mt-1 font-mono text-lg font-semibold text-slate-900">{money(accountSummary.approvedUnpaid, selected.default_currency)}</p></div><div className="border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Paid history</p><p className="mt-1 font-mono text-lg font-semibold text-teal-700">{money(accountSummary.paid, selected.default_currency)}</p></div><div className="border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Recorded tonnes</p><p className="mt-1 font-mono text-lg font-semibold text-slate-900">{accountSummary.tonnes.toLocaleString(undefined, { maximumFractionDigits: 3 })} t</p></div></div>

        {showRateForm && <div className="mt-4 border border-teal-200 bg-white p-4"><div className="flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-900">New approved rate</h4><p className="mt-0.5 text-xs text-slate-500">Rates are retained as history; do not overwrite a previous agreement.</p></div><button onClick={() => setShowRateForm(false)} className="p-1 text-slate-500 hover:text-slate-900" title="Close rate form"><X className="h-4 w-4" /></button></div><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-semibold text-slate-700">From<input value={rateInput.routeFrom} onChange={(e) => setRateInput({ ...rateInput, routeFrom: e.target.value })} className="mt-1 w-full border border-slate-300 px-2.5 py-2 text-sm" placeholder="Origin" /></label><label className="text-xs font-semibold text-slate-700">To<input value={rateInput.routeTo} onChange={(e) => setRateInput({ ...rateInput, routeTo: e.target.value })} className="mt-1 w-full border border-slate-300 px-2.5 py-2 text-sm" placeholder="Destination" /></label><label className="text-xs font-semibold text-slate-700">Rate per tonne<input type="number" min="0" step="0.01" value={rateInput.rate} onChange={(e) => setRateInput({ ...rateInput, rate: e.target.value })} className="mt-1 w-full border border-slate-300 px-2.5 py-2 text-sm" placeholder="0.00" /></label><label className="text-xs font-semibold text-slate-700">Currency<select value={rateInput.currency} onChange={(e) => setRateInput({ ...rateInput, currency: e.target.value })} className="mt-1 w-full border border-slate-300 bg-white px-2.5 py-2 text-sm"><option>USD</option><option>ZIG</option><option>ZAR</option></select></label><label className="text-xs font-semibold text-slate-700">Effective from<input type="date" value={rateInput.effectiveFrom} onChange={(e) => setRateInput({ ...rateInput, effectiveFrom: e.target.value })} className="mt-1 w-full border border-slate-300 px-2.5 py-2 text-sm" /></label><label className="text-xs font-semibold text-slate-700">Effective to<input type="date" value={rateInput.effectiveTo} onChange={(e) => setRateInput({ ...rateInput, effectiveTo: e.target.value })} className="mt-1 w-full border border-slate-300 px-2.5 py-2 text-sm" /></label><label className="text-xs font-semibold text-slate-700">Vehicle type<input value={rateInput.vehicleType} onChange={(e) => setRateInput({ ...rateInput, vehicleType: e.target.value })} className="mt-1 w-full border border-slate-300 px-2.5 py-2 text-sm" placeholder="Optional" /></label><label className="text-xs font-semibold text-slate-700">Material group<input value={rateInput.materialGroup} onChange={(e) => setRateInput({ ...rateInput, materialGroup: e.target.value })} className="mt-1 w-full border border-slate-300 px-2.5 py-2 text-sm" placeholder="Optional" /></label></div><label className="mt-3 block text-xs font-semibold text-slate-700">Notes<input value={rateInput.notes} onChange={(e) => setRateInput({ ...rateInput, notes: e.target.value })} className="mt-1 w-full border border-slate-300 px-2.5 py-2 text-sm" placeholder="Agreement reference or approval note" /></label><div className="mt-3 flex justify-end"><button type="button" onClick={submitRate} disabled={saving || !rateInput.routeFrom.trim() || !rateInput.routeTo.trim() || Number(rateInput.rate) <= 0} className="inline-flex items-center gap-1.5 bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><BadgeDollarSign className="h-3.5 w-3.5" /> Save approved rate</button></div></div>}

        <div className="mt-5 grid gap-4 xl:grid-cols-2"><div className="border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3"><Route className="h-4 w-4 text-teal-700" /><h4 className="text-sm font-semibold text-slate-900">Rate-card history</h4></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Route</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2">Effective</th></tr></thead><tbody>{accountRates.length === 0 ? <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">No approved rates recorded.</td></tr> : accountRates.map((rate) => <tr key={rate.id} className="border-t border-slate-100"><td className="px-3 py-2.5"><span className="font-medium text-slate-800">{rate.route_from} to {rate.route_to}</span><span className="mt-0.5 block text-slate-500">{[rate.vehicle_type, rate.material_group].filter(Boolean).join(' · ') || 'All vehicles and materials'}</span></td><td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-800">{money(rate.rate_per_tonne, rate.currency_code)}<span className="mt-0.5 block text-[10px] font-normal text-slate-500">per tonne</span></td><td className="px-3 py-2.5 text-slate-600">{rate.effective_from}{rate.effective_to ? ` to ${rate.effective_to}` : ''}{rate.is_active && <span className="mt-1 block w-fit border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">Active</span>}</td></tr>)}</tbody></table></div></div>
          <div className="border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3"><AlertTriangle className="h-4 w-4 text-amber-600" /><h4 className="text-sm font-semibold text-slate-900">Exceptions requiring review</h4></div><div className="divide-y divide-slate-100">{exceptions.length === 0 ? <p className="px-3 py-8 text-center text-sm text-slate-400">No current exceptions.</p> : exceptions.map(({ claim, flag }) => <div key={`${claim.id}-${flag}`} className="flex gap-2 px-3 py-2.5"><FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div className="min-w-0"><p className="font-mono text-xs font-semibold text-slate-800">{claim.claim_number}</p><p className="mt-0.5 text-xs text-amber-800">{flag}</p></div></div>)}</div></div></div>

        <div className="mt-4 border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3"><ReceiptText className="h-4 w-4 text-teal-700" /><h4 className="text-sm font-semibold text-slate-900">Account claim history</h4></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Claim</th><th className="px-3 py-2">Evidence</th><th className="px-3 py-2 text-right">Tonnes</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead><tbody>{accountClaims.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No claims recorded for this account.</td></tr> : accountClaims.map((claim) => <tr key={claim.id} className="border-t border-slate-100"><td className="px-3 py-2.5 font-mono font-semibold text-slate-800">{claim.claim_number}</td><td className="px-3 py-2.5 text-slate-600">{claim.invoice_number || claim.waybill_reference || 'No document'}</td><td className="px-3 py-2.5 text-right font-mono text-slate-700">{(Number(claim.net_mass_kg) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-800">{money(claim.calculated_amount, claim.currency_code)}</td><td className="px-3 py-2.5 capitalize text-slate-700">{claim.status}</td></tr>)}</tbody></table></div></div>
      </div>}
    </section>
  );
}
