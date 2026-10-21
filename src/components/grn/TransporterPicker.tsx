import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type Transporter = { id: string; name: string; transporter_code: string; default_currency: string };
export default function TransporterPicker({ value, onSelect }: {
  value: string;
  onSelect: (transporter: Transporter) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<Transporter[]>([]);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const loadTransporters = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true); setLoadError('');
    try {
      const { data, error } = await supabase.rpc('list_inbound_transporters_for_weighbridge');
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('The transporter list could not be loaded.');
      if (request === requestId.current) setRows(data);
    } catch (err: any) {
      if (request === requestId.current) setLoadError(err?.code === 'PGRST202'
        ? 'The transporter-list database update is missing. Ask Admin to apply the LIVE receiving transporter update.'
        : err?.message || 'Could not load transporters. Retry the list.');
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadTransporters();
    return () => { ++requestId.current; };
  }, [loadTransporters]);
  const select = async (row: Transporter) => {
    setBusy(true); setError('');
    try { await onSelect(row); } catch (err: any) { setError(err?.message || 'Transporter could not be selected.'); }
    finally { setBusy(false); }
  };
  const register = async () => {
    if (name.trim().length < 3) { setError('Enter the transporter name.'); return; }
    setBusy(true); setError('');
    try {
      const { data: id, error } = await supabase.rpc('register_pending_transporter', {
        p_name: name.trim(), p_phone: phone.trim() || null, p_note: note.trim() || null,
      });
      if (error) throw error;
      const { data, error: listError } = await supabase.rpc('list_inbound_transporters_for_weighbridge');
      if (listError) throw listError;
      setRows(data || []);
      const row = (data || []).find((item: Transporter) => item.id === id);
      if (!row) throw new Error('Transporter was captured but could not be loaded. Refresh the list.');
      await onSelect(row);
      setCreating(false); setSearch('');
    } catch (err: any) { setError(err?.message || 'New transporter could not be captured.'); }
    finally { setBusy(false); }
  };
  const selected = rows.find(row => row.id === value);
  const filtered = rows.filter(row => row.id === value || `${row.name} ${row.transporter_code}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-2">
    <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="Search transporters" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search transporter name or code" className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm" /></div>
    <div className="flex items-center gap-2"><select aria-label="Transporter" value={value} disabled={busy || loading || Boolean(loadError)} onChange={event => { const row = rows.find(item => item.id === event.target.value); if (row) void select(row); }} className="min-w-0 w-full rounded-md border border-slate-300 bg-white p-2 text-sm disabled:opacity-60">
      <option value="">{loading ? 'Loading transporters...' : 'Select transporter'}</option>
      {filtered.map(row => <option key={row.id} value={row.id}>{row.name} - {row.transporter_code.startsWith('NEW-') ? 'New / Finance review' : row.transporter_code}</option>)}
    </select><button type="button" aria-label={loadError ? 'Retry transporter list' : 'Refresh transporters'} title={loadError ? 'Retry transporter list' : 'Refresh transporters'} disabled={busy || loading} onClick={() => void loadTransporters()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button></div>
    {loadError && <p role="alert" className="text-xs text-red-700">{loadError}</p>}
    {!loading && !loadError && !rows.length && <p role="status" className="text-xs text-slate-600">No active transporters are available.</p>}
    {!loading && !loadError && rows.length > 0 && !filtered.length && <p role="status" className="text-xs text-slate-600">No transporters match this search.</p>}
    {selected?.transporter_code.startsWith('NEW-') && <p className="flex items-center gap-2 text-xs font-semibold text-orange-800"><AlertTriangle className="h-4 w-4 shrink-0" />Finance registration review required</p>}
    <button type="button" disabled={busy || loading || Boolean(loadError)} onClick={() => setCreating(!creating)} className="inline-flex items-center gap-1 text-sm font-semibold text-orange-700 disabled:opacity-50"><Plus className="h-4 w-4" />Transporter not listed</button>
    {creating && <div className="space-y-2 rounded-md border border-orange-200 bg-orange-50 p-3">
      <p className="text-xs font-bold text-orange-900">New transporter - pending Finance registration</p>
      <input aria-label="New transporter name" value={name} maxLength={160} onChange={event => setName(event.target.value)} placeholder="Transporter / registered business name" className="w-full rounded-md border border-orange-200 bg-white p-2 text-sm" />
      <input aria-label="Transporter contact phone" value={phone} maxLength={50} onChange={event => setPhone(event.target.value)} placeholder="Contact phone (optional)" className="w-full rounded-md border border-orange-200 bg-white p-2 text-sm" />
      <input aria-label="Transporter note for Finance" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Registration details / note for Finance" className="w-full rounded-md border border-orange-200 bg-white p-2 text-sm" />
      <button type="button" onClick={() => void register()} disabled={busy || name.trim().length < 3} className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Capture new transporter</button>
    </div>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
