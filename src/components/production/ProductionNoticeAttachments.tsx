import { useEffect, useRef, useState } from 'react';
import { Download, File, Loader2, Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

type Attachment = { id: string; file_name: string; storage_path: string; file_size: number; created_at: string; uploaded_by: string };

export default function ProductionNoticeAttachments({ noticeId }: { noticeId: string }) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('production_notice_attachments').select('*').eq('production_notice_id', noticeId).order('created_at', { ascending: false });
    if (error) toast.error(error.message); else setFiles((data as Attachment[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [noticeId]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return toast.error('Only PDF, JPG and PNG files are allowed.');
    if (file.size > 10 * 1024 * 1024) return toast.error('Files must be 10 MB or smaller.');
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in again.');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${noticeId}/${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage.from('production-notice-attachments').upload(storagePath, file);
      if (uploadError) throw uploadError;
      const { error: rowError } = await supabase.from('production_notice_attachments').insert({ production_notice_id: noticeId, file_name: file.name, storage_path: storagePath, file_size: file.size, file_type: file.type, uploaded_by: user.id });
      if (rowError) {
        await supabase.storage.from('production-notice-attachments').remove([storagePath]);
        throw rowError;
      }
      toast.success('Evidence attached to this production notice.');
      await load();
    } catch (error: any) { toast.error(error.message || 'Unable to attach file.'); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const open = async (file: Attachment) => {
    const { data, error } = await supabase.storage.from('production-notice-attachments').createSignedUrl(file.storage_path, 3600);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const remove = async (file: Attachment) => {
    if (!window.confirm(`Remove ${file.file_name}?`)) return;
    const { error } = await supabase.from('production_notice_attachments').delete().eq('id', file.id);
    if (error) return toast.error(error.message);
    await supabase.storage.from('production-notice-attachments').remove([file.storage_path]);
    toast.success('Attachment removed.');
    load();
  };

  return <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-700">Notice evidence</p><label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-semibold text-teal-700 shadow-sm ring-1 ring-slate-200 hover:bg-teal-50"><Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Attach file'}<input ref={inputRef} className="hidden" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={upload} disabled={uploading} /></label></div>
    {loading ? <Loader2 className="mx-auto my-3 h-4 w-4 animate-spin text-slate-400" /> : files.length === 0 ? <p className="mt-2 text-xs text-slate-500">Attach the signed notice, BOM, count sheet or exception proof.</p> : <div className="mt-2 space-y-1">{files.map(file => <div key={file.id} className="flex items-center gap-2 rounded bg-white px-2 py-1.5 text-xs"><File className="h-3.5 w-3.5 text-slate-400" /><span className="min-w-0 flex-1 truncate">{file.file_name} ({(file.file_size / 1024).toFixed(0)} KB)</span><button onClick={() => open(file)} aria-label={`Open ${file.file_name}`} className="text-teal-700"><Download className="h-3.5 w-3.5" /></button><button onClick={() => remove(file)} aria-label={`Remove ${file.file_name}`} className="text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}
  </div>;
}
