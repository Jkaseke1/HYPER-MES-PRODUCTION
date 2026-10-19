import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

export default function PendingTransporterDetails({ grnId, transporterId, onSaved }: {
  grnId: string; transporterId: string; onSaved: (name: string) => void;
}) {
  const { profile } = useAuth();
  const canEdit = ['admin', 'raw_material_manager', 'rm_manager'].includes(profile?.role || '');
  const [record, setRecord] = useState<any>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    setRecord(null); setError('');
    supabase.from('inbound_transporters').select('name,contact_phone,registration_note,sage_registration_status')
      .eq('id', transporterId).single().then(({ data, error }) => {
        if (!active) return;
        if (error) { setError('Transporter details could not be loaded.'); return; }
        setRecord(data); setName(data.name || ''); setPhone(data.contact_phone || ''); setNote(data.registration_note || '');
      });
    return () => { active = false; };
  }, [transporterId, canEdit]);
  const save = async () => {
    if (!canEdit) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const { error } = await supabase.rpc('update_pending_grn_transporter_details', {
        p_grn_id: grnId, p_name: name.trim(), p_phone: phone.trim() || null, p_note: note.trim() || null,
      });
      if (error) throw error;
      onSaved(name.trim()); setSaved(true);
    } catch (err: any) { setError(err?.message || 'Transporter details could not be saved.'); }
    finally { setBusy(false); }
  };
  if (!canEdit) return null;
  if (error && !record) return <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>;
  if (!record || record.sage_registration_status !== 'pending') return null;
  const inputClass = 'mt-1 w-full rounded-md border border-orange-200 bg-white p-2 text-sm';
  return <fieldset disabled={busy} className="mt-3 space-y-2 border-t border-orange-200 pt-3">
    <legend className="text-xs font-semibold text-orange-900">Pending transporter details</legend>
    <label className="block text-xs font-medium">Transporter name<input value={name} maxLength={160} onChange={event => { setName(event.target.value); setSaved(false); }} className={inputClass} /></label>
    <label className="block text-xs font-medium">Contact phone<input value={phone} maxLength={50} onChange={event => { setPhone(event.target.value); setSaved(false); }} className={inputClass} /></label>
    <label className="block text-xs font-medium">Note for Finance<textarea value={note} maxLength={500} rows={2} onChange={event => { setNote(event.target.value); setSaved(false); }} className={inputClass} /></label>
    <button type="button" disabled={busy || name.trim().length < 3} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save transporter details</button>
    {saved && <p role="status" className="text-xs text-emerald-800">Transporter details saved. Finance verification pending.</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </fieldset>;
}
