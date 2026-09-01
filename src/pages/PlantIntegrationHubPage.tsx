import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ChevronRight, Database, Factory, Link2, Plus, Radio, RefreshCw, ShieldCheck, Waypoints } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '../lib/supabase';

type Source = {
  id: string; source_key: string; name: string; provider: string; integration_type: string;
  endpoint_url: string | null; authentication_method: string; polling_interval_seconds: number | null;
  enabled: boolean; status: string; last_seen_at: string | null; last_error: string | null;
  capabilities: string[]; created_at: string;
};
type Event = { id: string; event_type: string; event_key: string; occurred_at: string; received_at: string; processing_status: string; processing_error: string | null; batch_number: string | null; plant_integration_sources?: { name: string; source_key: string }[] | null };

const emptyForm = { source_key: '', name: '', provider: 'Automill', integration_type: 'api', endpoint_url: '', authentication_method: 'gateway_secret', polling_interval_seconds: '30', capabilities: 'production_count, machine_state, downtime_started, downtime_ended' };
const statusStyles: Record<string, string> = { connected: 'bg-emerald-50 text-emerald-700 border-emerald-200', testing: 'bg-blue-50 text-blue-700 border-blue-200', paused: 'bg-amber-50 text-amber-700 border-amber-200', error: 'bg-red-50 text-red-700 border-red-200', not_configured: 'bg-slate-100 text-slate-600 border-slate-200' };

export default function PlantIntegrationHubPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    const [sourcesResult, eventsResult] = await Promise.all([
      supabase.from('plant_integration_sources').select('*').order('name'),
      supabase.from('plant_integration_events').select('id,event_type,event_key,occurred_at,received_at,processing_status,processing_error,batch_number,plant_integration_sources(name,source_key)').order('received_at', { ascending: false }).limit(12),
    ]);
    if (sourcesResult.error) console.error('Unable to load plant integrations:', sourcesResult.error);
    if (eventsResult.error) console.error('Unable to load plant events:', eventsResult.error);
    setSources((sourcesResult.data as Source[]) || []);
    setEvents((eventsResult.data as unknown as Event[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    connected: sources.filter((source) => source.status === 'connected').length,
    enabled: sources.filter((source) => source.enabled).length,
    exceptions: sources.filter((source) => source.status === 'error').length + events.filter((event) => event.processing_status === 'error' || event.processing_status === 'rejected').length,
    processedToday: events.filter((event) => event.processing_status === 'processed').length,
  }), [sources, events]);

  const saveSource = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const payload = {
      source_key: form.source_key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      name: form.name.trim(), provider: form.provider.trim() || 'custom', integration_type: form.integration_type,
      endpoint_url: form.endpoint_url.trim() || null, authentication_method: form.authentication_method,
      polling_interval_seconds: form.integration_type === 'webhook' ? null : Number(form.polling_interval_seconds || 30),
      capabilities: form.capabilities.split(',').map((value) => value.trim()).filter(Boolean), status: 'not_configured', enabled: false,
    };
    const { error } = await supabase.from('plant_integration_sources').insert(payload);
    setSaving(false);
    if (error) { alert(`Could not save integration: ${error.message}`); return; }
    setShowForm(false); setForm(emptyForm); load();
  };

  const toggleSource = async (source: Source) => {
    const { error } = await supabase.from('plant_integration_sources').update({ enabled: !source.enabled, status: !source.enabled ? 'testing' : 'paused' }).eq('id', source.id);
    if (error) { alert(`Could not update integration: ${error.message}`); return; }
    load();
  };

  return <div className="p-6 space-y-6">
    <section className="rounded-2xl bg-gradient-to-r from-slate-950 via-cyan-950 to-teal-900 p-7 text-white shadow-lg">
      <div className="flex flex-wrap justify-between gap-5">
        <div className="max-w-3xl"><div className="mb-3 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-teal-300"><Waypoints className="h-4 w-4" /> OPEN PLANT INTEGRATION PLATFORM</div><h1 className="text-3xl font-extrabold tracking-tight">Automation & Integration Hub</h1><p className="mt-2 text-sm leading-6 text-slate-300">MES remains the approved business record. Automill, PLC/SCADA, laboratory, weighbridge, and any future provider connect through an auditable on-site gateway contract.</p></div>
        <button onClick={() => setShowForm(true)} className="flex h-fit items-center gap-2 rounded-xl bg-teal-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-teal-300"><Plus className="h-4 w-4" /> Add integration</button>
      </div>
    </section>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[['Connected', counts.connected, CheckCircle2, 'text-emerald-600'], ['Active adapters', counts.enabled, Radio, 'text-cyan-600'], ['Events processed', counts.processedToday, Activity, 'text-blue-600'], ['Exceptions', counts.exceptions, AlertTriangle, 'text-amber-600']].map(([label, value, Icon, color]: any) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-slate-500"><span>{label}</span><Icon className={`h-4 w-4 ${color}`} /></div><div className="mt-2 text-3xl font-bold text-slate-800">{value}</div></div>)}
    </div>
    <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-slate-800">Integration sources</h2><p className="mt-0.5 text-xs text-slate-500">Connection settings only — passwords, certificates and API keys stay in the gateway/server secret store.</p></div><button onClick={load} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
      {sources.length === 0 && !loading ? <div className="p-10 text-center"><Link2 className="mx-auto h-9 w-9 text-slate-300" /><h3 className="mt-3 font-semibold text-slate-700">No plant system connected yet</h3><p className="mt-1 text-sm text-slate-500">Add Automill first, then test it through the gateway before enabling it.</p></div> : <div className="divide-y divide-slate-100">{sources.map((source) => <div key={source.id} className="flex flex-wrap items-center gap-4 px-5 py-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700"><Factory className="h-5 w-5" /></div><div className="min-w-[220px] flex-1"><div className="font-semibold text-slate-800">{source.name} <span className="ml-2 font-mono text-xs font-normal text-slate-400">{source.source_key}</span></div><div className="mt-1 text-xs text-slate-500">{source.provider} · {source.integration_type.toUpperCase()} · {source.capabilities?.join(', ') || 'No capabilities selected'}</div></div><div className="text-xs text-slate-500">{source.last_seen_at ? `Last seen ${formatDistanceToNow(new Date(source.last_seen_at), { addSuffix: true })}` : 'Not yet connected'}</div><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[source.status] || statusStyles.not_configured}`}>{source.status.replace('_', ' ')}</span><button onClick={() => toggleSource(source)} className={`rounded-lg px-3 py-2 text-xs font-bold ${source.enabled ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>{source.enabled ? 'Pause' : 'Test / enable'}</button></div>)}</div>}
    </section>
    <div className="grid gap-6 xl:grid-cols-3"><section className="xl:col-span-2 rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-800">Inbound event ledger</h2><p className="mt-0.5 text-xs text-slate-500">Every external event is deduplicated, validated and retained for audit.</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Source</th><th className="px-4 py-3">Event</th><th className="px-4 py-3">Batch</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{events.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No external events received. This is expected until a gateway is connected.</td></tr> : events.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-700">{item.plant_integration_sources?.[0]?.name || 'Unknown source'}</td><td className="px-4 py-3 font-mono text-xs text-slate-600">{item.event_type}</td><td className="px-4 py-3 text-slate-600">{item.batch_number || '—'}</td><td className="px-4 py-3 text-xs text-slate-500">{formatDistanceToNow(new Date(item.received_at), { addSuffix: true })}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.processing_status === 'processed' ? 'bg-emerald-50 text-emerald-700' : item.processing_status === 'error' || item.processing_status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{item.processing_status}</span></td></tr>)}</tbody></table></div></section><aside className="rounded-xl border border-teal-100 bg-teal-50/60 p-5"><ShieldCheck className="h-6 w-6 text-teal-600" /><h2 className="mt-3 font-bold text-slate-800">Safe connection rule</h2><p className="mt-2 text-sm leading-6 text-slate-600">Plant hardware never writes directly to Sage or browser-facing MES tables. An on-site gateway validates its payload, creates an idempotent event, then MES applies the approved workflow.</p><div className="mt-4 space-y-2 text-xs font-medium text-slate-700"><div className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-teal-600" /> Hardware / Automill</div><div className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-teal-600" /> On-site secure gateway</div><div className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-teal-600" /> MES event & approval ledger</div><div className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-teal-600" /> Sage posting review</div></div><div className="mt-5 rounded-lg border border-teal-100 bg-white p-3 text-xs text-slate-500"><Database className="mr-1 inline h-3.5 w-3.5" /> API credentials are intentionally not stored in this page or Supabase tables.</div></aside></div>
    {showForm && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={saveSource} className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"><div className="border-b border-slate-100 px-6 py-5"><h2 className="text-xl font-bold text-slate-800">Add plant integration</h2><p className="mt-1 text-sm text-slate-500">This creates an adapter profile. Put credentials in the gateway, not here.</p></div><div className="grid gap-4 p-6 md:grid-cols-2">{[['name','Display name'],['source_key','Stable source key'],['provider','Provider'],['endpoint_url','Gateway endpoint (optional)'],['polling_interval_seconds','Polling interval (seconds)'],['capabilities','Capabilities, comma separated']].map(([key,label]) => <label key={key} className={key === 'capabilities' ? 'md:col-span-2' : ''}><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span><input required={key === 'name' || key === 'source_key'} value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={key === 'source_key' ? 'automill-plant-1' : ''} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500" /></label>)}<label><span className="mb-1 block text-xs font-semibold text-slate-600">Connection type</span><select value={form.integration_type} onChange={(e) => setForm({ ...form, integration_type: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="api">API</option><option value="webhook">Webhook</option><option value="opc_ua">OPC UA gateway</option><option value="mqtt">MQTT gateway</option><option value="database">Database adapter</option><option value="file_drop">File drop</option></select></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Authentication</span><select value={form.authentication_method} onChange={(e) => setForm({ ...form, authentication_method: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="gateway_secret">Gateway secret</option><option value="mutual_tls">Mutual TLS</option><option value="api_key">API key in gateway</option><option value="none">None (test only)</option></select></label></div><div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4"><button type="button" onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={saving} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-60">{saving ? 'Saving…' : 'Save adapter profile'}</button></div></form></div>}
  </div>;
}
