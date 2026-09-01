import { useState, useEffect, useRef } from 'react';
import { Upload, Download, Trash2, File, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';

interface Attachment {
  id: string;
  grn_id: string;
  file_name: string;
  file_url: string;
  storage_path?: string;
  file_size: number;
  uploaded_by: string;
  created_at: string;
  profiles?: { full_name: string };
}

interface GRNAttachmentsProps {
  grnId: string;
  readOnly?: boolean;
}

export default function GRNAttachments({ grnId, readOnly = false }: GRNAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function fetchAttachments() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('grn_attachments')
        .select('*, profiles(full_name)')
        .eq('grn_id', grnId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAttachments(data || []);
    } catch (err: any) {
      // Only log if it's a real error, not just empty results
      if (err?.message && !err.message.includes('No rows')) {
        console.error('Failed to fetch attachments:', err);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAttachments();
  }, [grnId]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.currentTarget.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!allowedTypes.includes(file.type)) {
      alert('Only PDF and image files (JPG, PNG) are allowed');
      return;
    }

    if (file.size > maxSize) {
      alert('File size must be less than 10MB');
      return;
    }

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');

      // Upload file to storage
      const fileName = `${grnId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('grn-attachments')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('grn-attachments')
        .getPublicUrl(fileName);

      // Insert attachment record
      const { error: insertError } = await supabase
        .from('grn_attachments')
        .insert({
          grn_id: grnId,
          file_name: file.name,
          file_url: publicUrl,
          storage_path: fileName,
          file_size: file.size,
          uploaded_by: user.id,
        });

      if (insertError) throw insertError;

      fetchAttachments();
      // Reset input safely using ref
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload file. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(attachment: Attachment) {
    try {
      if (!attachment.storage_path) {
        alert('File path not available');
        return;
      }

      // Get signed URL for viewing
      const { data, error } = await supabase.storage
        .from('grn-attachments')
        .createSignedUrl(attachment.storage_path, 3600); // 1 hour expiry

      if (error) throw error;

      // Open in new tab/page
      window.open(data.signedUrl, '_blank');
    } catch (error) {
      console.error('Open file failed:', error);
      alert('Failed to open file. Please try again.');
    }
  }

  async function handleDelete(attachment: Attachment) {
    if (!confirm(`Delete "${attachment.file_name}"?`)) return;

    setDeleting(attachment.id);
    try {
      // Delete from storage using storage_path
      if (attachment.storage_path) {
        await supabase.storage
          .from('grn-attachments')
          .remove([attachment.storage_path]);
      }

      // Delete record
      const { error } = await supabase
        .from('grn_attachments')
        .delete()
        .eq('id', attachment.id);

      if (error) throw error;

      fetchAttachments();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete attachment. Please try again.');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Attachments</h3>

      {!readOnly && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium cursor-pointer transition-colors disabled:opacity-50">
            <Upload className="w-4 h-4" />
            Upload File
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
          {uploading && <span className="text-xs text-slate-500">Uploading...</span>}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : attachments.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <File className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No attachments yet</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
          {attachments.map((att) => (
            <div key={att.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <File className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{att.file_name}</p>
                  <p className="text-xs text-slate-500">
                    {(att.file_size / 1024).toFixed(1)} KB • {att.profiles?.full_name || 'Unknown'} • {format(new Date(att.created_at), 'dd MMM yyyy HH:mm')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <button
                  onClick={() => handleDownload(att)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                {!readOnly && (
                  <button
                    onClick={() => handleDelete(att)}
                    disabled={deleting === att.id}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
