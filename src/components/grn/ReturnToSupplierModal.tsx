import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import toast from 'react-hot-toast';

type ReturnLine = {
  id: string;
  raw_material_id: string;
  received_qty: number;
  unit_cost: number;
  batch_number?: string | null;
  raw_materials?: { name?: string; code?: string } | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grn: any;
  items: ReturnLine[];
  sageGrvNumber: string;
  onCreated?: () => void;
};

export default function ReturnToSupplierModal({ open, onOpenChange, grn, items, sageGrvNumber, onCreated }: Props) {
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  const canApprove = ['admin', 'finance'].includes(profile?.role || '');

  useEffect(() => {
    if (!open || !grn?.id) return;
    setReason('');
    setQuantities({});
    setExisting(null);
    supabase
      .from('return_to_supplier_requests')
      .select('*, return_to_supplier_items(*)')
      .eq('original_grn_id', grn.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setExisting(data || null));
  }, [open, grn?.id]);

  const createRequest = async () => {
    const lines = items
      .map((item) => ({ grn_item_id: item.id, quantity: Number(quantities[item.id] || 0) }))
      .filter((line) => line.quantity > 0);
    if (!reason.trim()) return toast.error('Enter the reason for the return.');
    if (lines.length === 0) return toast.error('Enter a return quantity for at least one line.');
    if (lines.some((line) => line.quantity > Number(items.find((item) => item.id === line.grn_item_id)?.received_qty || 0))) {
      return toast.error('A return quantity cannot exceed the received quantity.');
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('request_grn_return', {
        p_grn_id: grn.id,
        p_reason: reason,
        p_lines: lines,
      });
      if (error) throw error;
      toast.success('RTS created and awaiting Finance approval.');
      onCreated?.();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Could not create the RTS.');
    } finally {
      setSaving(false);
    }
  };

  const approveRequest = async () => {
    if (!existing || !canApprove) return;
    setApproving(true);
    try {
      const { error } = await supabase.rpc('approve_grn_return', { p_rts_id: existing.id });
      if (error) throw error;
      setExisting({ ...existing, status: 'approved' });
      toast.success('RTS approved and queued for Sage posting.');
      onCreated?.();
    } catch (error: any) {
      toast.error(error.message || 'Could not approve the RTS.');
    } finally {
      setApproving(false);
    }
  };

  const isPosted = existing?.status === 'posted';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-rose-600" /> Return to Supplier</DialogTitle>
          <DialogDescription>
            Create a separate RTS for approved GRN <span className="font-mono font-semibold">{grn?.grn_number}</span>. The original GRN will not be changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><p>Sage GRV <span className="font-mono font-semibold">{sageGrvNumber || '-'}</span> is already posted. Only returned quantities will be reversed.</p></div>
          </div>

          {existing ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">RTS request</span><span className="font-mono font-bold text-slate-900">{existing.rts_number}</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500">Status:</span><span className="font-semibold capitalize">{existing.status.replace('_', ' ')}</span>{isPosted && <CheckCircle className="h-4 w-4 text-emerald-600" />}</div>
              <p className="text-sm text-slate-700">{existing.reason}</p>
              {existing.status === 'pending_finance' && canApprove && <Button onClick={approveRequest} disabled={approving} className="bg-rose-700 text-white hover:bg-rose-800">{approving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve & queue Sage RTS</Button>}
              {existing.status === 'pending_finance' && !canApprove && <p className="text-xs text-amber-700">Waiting for Finance approval before Sage posting.</p>}
              {existing.status === 'approved' || existing.status === 'processing' ? <p className="text-xs text-blue-700">Approved. The bridge will post this RTS to Sage.</p> : null}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-800">Reason for return *</label>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why the material is being returned" className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-[1fr_130px_130px] gap-3 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500"><span>Material</span><span>Received</span><span>Return qty</span></div>
                {items.map((item) => <div key={item.id} className="grid grid-cols-[1fr_130px_130px] items-center gap-3 border-t border-slate-100 px-3 py-3 text-sm"><div><p className="font-semibold text-slate-800">{item.raw_materials?.name || item.raw_materials?.code || item.raw_material_id}</p><p className="font-mono text-xs text-slate-500">{item.raw_materials?.code || ''}</p></div><span>{Number(item.received_qty).toLocaleString()} kg</span><input type="number" min="0" max={item.received_qty} step="0.01" value={quantities[item.id] || ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="rounded-md border border-slate-300 px-2 py-2" placeholder="0" /></div>)}
              </div>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={createRequest} disabled={saving} className="bg-rose-700 text-white hover:bg-rose-800">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create RTS for Finance approval</Button></div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
