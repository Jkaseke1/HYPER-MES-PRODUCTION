import { useEffect, useMemo, useState } from 'react';
import { Building2, Calendar, CheckCircle2, DollarSign, Mail, MapPin, Phone, Plus, Search, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/ui/StatCard';

type Segment = 'commercial' | 'small_scale' | 'dealer' | 'prospect' | 'institutional' | 'other';
type Customer = {
  id: string; legal_name: string; trading_name: string | null; sage_customer_code: string | null;
  segment: Segment; lifecycle_stage: string; status: string; area: string | null; customer_group: string | null;
  primary_contact_name: string | null; primary_email: string | null; primary_phone: string | null;
  payment_terms: string | null; credit_limit: number | null; account_balance: number | null; on_hold: boolean;
  physical_address: string | null; delivery_address: string | null; notes: string | null;
};
type Activity = { id: string; activity_type: string; subject: string; details: string | null; activity_date: string; completed_at: string | null };

const emptyForm = { legal_name: '', trading_name: '', sage_customer_code: '', segment: 'commercial' as Segment, lifecycle_stage: 'active', area: '', customer_group: '', primary_contact_name: '', primary_email: '', primary_phone: '', payment_terms: '', credit_limit: '', physical_address: '', delivery_address: '', notes: '' };

export default function CRMPage() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('all');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [activityText, setActivityText] = useState('');

  async function loadCustomers() {
    setLoading(true);
    const { data, error } = await supabase.from('crm_customers').select('*').order('legal_name');
    if (error) toast.error(error.message); else setCustomers((data || []) as Customer[]);
    setLoading(false);
  }
  async function loadActivities(customerId: string) {
    const { data } = await supabase.from('crm_activities').select('id, activity_type, subject, details, activity_date, completed_at').eq('customer_id', customerId).order('activity_date', { ascending: false }).limit(20);
    setActivities((data || []) as Activity[]);
  }
  useEffect(() => { loadCustomers(); }, []);
  useEffect(() => { if (selected) loadActivities(selected.id); else setActivities([]); }, [selected]);

  const filtered = useMemo(() => customers.filter((c) => {
    const haystack = [c.legal_name, c.trading_name, c.sage_customer_code, c.area, c.primary_contact_name].filter(Boolean).join(' ').toLowerCase();
    return (segment === 'all' || c.segment === segment) && haystack.includes(search.toLowerCase());
  }), [customers, search, segment]);
  const counts = { total: customers.length, commercial: customers.filter(c => c.segment === 'commercial').length, small: customers.filter(c => c.segment === 'small_scale').length, prospects: customers.filter(c => ['lead', 'prospect'].includes(c.lifecycle_stage)).length };

  function openNew() { setForm(emptyForm); setShowForm(true); }
  function openEdit(customer: Customer) { setSelected(customer); setForm({ ...emptyForm, ...Object.fromEntries(Object.keys(emptyForm).map(k => [k, (customer as any)[k] ?? ''])) } as typeof emptyForm); setShowForm(true); }
  async function saveCustomer(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, credit_limit: form.credit_limit ? Number(form.credit_limit) : null, created_by: user?.id };
    const query = selected ? supabase.from('crm_customers').update(payload).eq('id', selected.id) : supabase.from('crm_customers').insert(payload);
    const { error } = await query;
    if (error) { toast.error(error.message); return; }
    toast.success(selected ? 'Customer updated' : 'Customer created'); setShowForm(false); setSelected(null); await loadCustomers();
  }
  async function addActivity(e: React.FormEvent) {
    e.preventDefault(); if (!selected || !activityText.trim()) return;
    const { error } = await supabase.from('crm_activities').insert({ customer_id: selected.id, activity_type: 'note', subject: activityText.trim(), created_by: user?.id });
    if (error) toast.error(error.message); else { toast.success('Activity added'); setActivityText(''); loadActivities(selected.id); }
  }
  const field = (key: keyof typeof emptyForm, label: string, type = 'text') => <label className="block text-sm"><span className="text-slate-600">{label}</span><input type={type} value={form[key] as string} onChange={e => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-teal-500 focus:outline-none" /></label>;

  return <div className="p-6 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-800">Customer Relationship Management</h1><p className="mt-1 text-sm text-slate-500">One customer view for commercial, small-scale and channel growth.</p></div><button onClick={openNew} className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700"><Plus className="h-4 w-4" /> New customer</button></div>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4"><StatCard title="Customer base" value={counts.total} icon={Users} color="teal" /><StatCard title="Commercial" value={counts.commercial} icon={Building2} color="slate" /><StatCard title="Small-scale" value={counts.small} icon={MapPin} color="amber" /><StatCard title="Leads / prospects" value={counts.prospects} icon={Phone} color="emerald" /></div>
    <div className="flex flex-wrap gap-3"><div className="relative min-w-[260px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, Sage code, area or contact..." className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" /></div><select value={segment} onChange={e => setSegment(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="all">All segments</option><option value="commercial">Commercial</option><option value="small_scale">Small-scale</option><option value="dealer">Dealer</option><option value="prospect">Prospect</option><option value="institutional">Institutional</option></select></div>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-slate-50"><tr>{['Customer', 'Sage code', 'Segment', 'Area', 'Contact', 'Terms / credit', 'Status'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-600">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={7} className="p-8 text-center text-slate-500">Loading customer base...</td></tr> : filtered.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-slate-500">No customers found. Create the first CRM record or import Sage customers.</td></tr> : filtered.map(c => <tr key={c.id} onClick={() => setSelected(c)} className="cursor-pointer hover:bg-teal-50/40"><td className="px-4 py-3"><div className="font-medium text-slate-800">{c.trading_name || c.legal_name}</div><div className="text-xs text-slate-500">{c.legal_name}</div></td><td className="px-4 py-3 font-mono text-xs text-slate-600">{c.sage_customer_code || '—'}</td><td className="px-4 py-3"><span className="rounded-full bg-teal-50 px-2 py-1 text-xs text-teal-700">{c.segment.replace('_', ' ')}</span></td><td className="px-4 py-3 text-slate-600">{c.area || '—'}</td><td className="px-4 py-3"><div>{c.primary_contact_name || '—'}</div><div className="text-xs text-slate-500">{c.primary_phone || c.primary_email || ''}</div></td><td className="px-4 py-3 text-xs text-slate-600">{c.payment_terms || '—'}<br />{c.credit_limit != null ? `Credit: ${Number(c.credit_limit).toLocaleString()}` : ''}</td><td className="px-4 py-3">{c.on_hold ? <span className="text-xs font-medium text-red-600">On hold</span> : <span className="text-xs font-medium text-emerald-600">{c.lifecycle_stage}</span>}</td></tr>)}</tbody></table></div></div>
    {selected && <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={() => setSelected(null)}><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-wide text-teal-600">Customer 360</p><h2 className="mt-1 text-xl font-bold text-slate-800">{selected.trading_name || selected.legal_name}</h2><p className="text-sm text-slate-500">{selected.sage_customer_code || 'No Sage account mapped'}</p></div><button onClick={() => setSelected(null)} className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Segment</p><p className="mt-1 font-medium capitalize">{selected.segment.replace('_', ' ')}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Account balance</p><p className="mt-1 font-medium">{selected.account_balance != null ? Number(selected.account_balance).toLocaleString() : 'Not synced'}</p></div></div><div className="mt-5 space-y-2 text-sm text-slate-600">{selected.primary_contact_name && <p className="flex gap-2"><Users className="h-4 w-4 text-slate-400" />{selected.primary_contact_name}</p>}{selected.primary_phone && <p className="flex gap-2"><Phone className="h-4 w-4 text-slate-400" />{selected.primary_phone}</p>}{selected.primary_email && <p className="flex gap-2"><Mail className="h-4 w-4 text-slate-400" />{selected.primary_email}</p>}{selected.physical_address && <p className="flex gap-2"><MapPin className="h-4 w-4 text-slate-400" />{selected.physical_address}</p>}</div><div className="mt-5 flex gap-2"><button onClick={() => openEdit(selected)} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Edit customer</button>{selected.on_hold && <span className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Sage account on hold</span>}</div><div className="mt-7 border-t pt-5"><h3 className="font-semibold text-slate-800">Relationship activity</h3><form onSubmit={addActivity} className="mt-3 flex gap-2"><input value={activityText} onChange={e => setActivityText(e.target.value)} placeholder="Log a call, visit, note or follow-up..." className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><button className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white">Log</button></form><div className="mt-4 space-y-3">{activities.length === 0 ? <p className="text-sm text-slate-500">No activity recorded yet.</p> : activities.map(a => <div key={a.id} className="flex gap-3 rounded-lg border border-slate-100 p-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-teal-600" /><div><p className="text-sm text-slate-800">{a.subject}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Calendar className="h-3 w-3" />{new Date(a.activity_date).toLocaleString()}</p></div></div>)}</div></div></aside></div>}
    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setShowForm(false)}><form onSubmit={saveCustomer} onClick={e => e.stopPropagation()} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-xl font-bold text-slate-800">{selected ? 'Edit customer' : 'New customer'}</h2><button type="button" onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-500" /></button></div><div className="mt-5 grid gap-4 md:grid-cols-2">{field('legal_name', 'Legal / registered name *')}{field('trading_name', 'Trading name')}{field('sage_customer_code', 'Sage customer code')}{field('primary_contact_name', 'Primary contact')}{field('primary_email', 'Email', 'email')}{field('primary_phone', 'Phone')}{field('area', 'Area / territory')}{field('customer_group', 'Customer group')}{field('payment_terms', 'Payment terms')}{field('credit_limit', 'Credit limit', 'number')}<label className="block text-sm"><span className="text-slate-600">Customer segment</span><select value={form.segment} onChange={e => setForm({ ...form, segment: e.target.value as Segment })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="commercial">Commercial</option><option value="small_scale">Small-scale</option><option value="dealer">Dealer</option><option value="prospect">Prospect</option><option value="institutional">Institutional</option><option value="other">Other</option></select></label>{field('physical_address', 'Physical address')}{field('delivery_address', 'Delivery address')}<label className="block text-sm md:col-span-2"><span className="text-slate-600">Notes</span><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white">Save customer</button></div></form></div>}
  </div>;
}
