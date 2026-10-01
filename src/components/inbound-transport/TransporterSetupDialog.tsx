import { Building2, FileBadge, ShieldCheck, Truck, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export type TransporterMasterInput = {
  code: string;
  name: string;
  legalName: string;
  accountReference: string;
  currency: string;
  paymentTermsDays: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  taxRegistrationNo: string;
  address: string;
  vehicleCapabilities: string;
  complianceExpiry: string;
  notes: string;
};

const emptyInput = (): TransporterMasterInput => ({
  code: '', name: '', legalName: '', accountReference: '', currency: 'USD', paymentTermsDays: '30', contactName: '', contactPhone: '', contactEmail: '', taxRegistrationNo: '', address: '', vehicleCapabilities: '', complianceExpiry: '', notes: '',
});

const input = 'mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';
const label = 'block text-xs font-semibold text-slate-700';

export default function TransporterSetupDialog({ open, saving, onClose, onSave }: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (input: TransporterMasterInput) => Promise<boolean>;
}) {
  const [form, setForm] = useState<TransporterMasterInput>(emptyInput);

  useEffect(() => { if (open) setForm(emptyInput()); }, [open]);
  if (!open) return null;

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.legalName.trim() || Number(form.paymentTermsDays) < 0) return;
    if (await onSave(form)) onClose();
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-hidden border border-slate-200 bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-200 bg-slate-900 px-5 py-4 text-white"><div className="flex gap-3"><div className="flex h-9 w-9 items-center justify-center bg-teal-600"><Truck className="h-5 w-5" /></div><div><h2 className="font-semibold">Set up transporter account</h2><p className="mt-0.5 text-xs text-slate-300">PlantControl carrier master. This does not create a Sage supplier or payment record.</p></div></div><button onClick={onClose} className="p-1 text-slate-300 hover:text-white" title="Close"><X className="h-5 w-5" /></button></div><div className="max-h-[calc(92vh-132px)] overflow-y-auto p-5"><section><div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2"><Building2 className="h-4 w-4 text-teal-700" /><h3 className="text-sm font-semibold text-slate-900">Account identity</h3></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className={label}>Transporter code *<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={input} placeholder="e.g. CARRIER-001" /></label><label className={label}>Operating name *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} placeholder="Trading name" /></label><label className={label}>Legal name *<input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} className={input} placeholder="Registered company name" /></label><label className={label}>Local account reference<input value={form.accountReference} onChange={(e) => setForm({ ...form, accountReference: e.target.value })} className={input} placeholder="Optional internal reference" /></label></div></section><section className="mt-6"><div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2"><FileBadge className="h-4 w-4 text-teal-700" /><h3 className="text-sm font-semibold text-slate-900">Commercial and contact details</h3></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className={label}>Default currency<select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={input}><option>USD</option><option>ZIG</option><option>ZAR</option></select></label><label className={label}>Payment terms (days)<input type="number" min="0" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })} className={input} /></label><label className={label}>Contact person<input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className={input} /></label><label className={label}>Contact phone<input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className={input} /></label><label className={label}>Contact email<input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className={input} /></label><label className={label}>Tax registration no.<input value={form.taxRegistrationNo} onChange={(e) => setForm({ ...form, taxRegistrationNo: e.target.value })} className={input} /></label><label className={`${label} sm:col-span-2`}>Business address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={input} /></label></div></section><section className="mt-6"><div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2"><ShieldCheck className="h-4 w-4 text-teal-700" /><h3 className="text-sm font-semibold text-slate-900">Operational and compliance profile</h3></div><div className="grid gap-3 sm:grid-cols-2"><label className={label}>Vehicle capabilities<input value={form.vehicleCapabilities} onChange={(e) => setForm({ ...form, vehicleCapabilities: e.target.value })} className={input} placeholder="e.g. Tipper, bulk tanker, 30-ton articulated" /></label><label className={label}>Compliance expiry<input type="date" value={form.complianceExpiry} onChange={(e) => setForm({ ...form, complianceExpiry: e.target.value })} className={input} /></label><label className={`${label} sm:col-span-2`}>Account notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${input} min-h-20`} placeholder="Insurance, agreement, limitations, or onboarding notes" /></label></div></section></div><div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button onClick={onClose} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button><button onClick={submit} disabled={saving || !form.code.trim() || !form.name.trim() || !form.legalName.trim() || Number(form.paymentTermsDays) < 0} className="inline-flex items-center gap-1.5 bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Truck className="h-4 w-4" /> Create transporter account</button></div></div></div>;
}
