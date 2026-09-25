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
  const selectedQuantity = Object.values(quantities).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const selectedValue = items.reduce((sum, item) => sum + (Number(quantities[item.id] || 0) * Number(item.unit_cost || 0)), 0);
  const statusLabel = existing?.status?.replaceAll('_', ' ');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl">
        <div className="bg-slate-950 px-5 py-3.5 text-white">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-rose-200"><RotateCcw className="h-3 w-3" /> Finance control</div>
                <DialogTitle className="text-lg font-bold tracking-tight text-white">Return to Supplier</DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-slate-300">Controlled reversal for <span className="font-mono font-semibold text-white">{grn?.grn_number}</span>. Original GRN remains unchanged.</DialogDescription>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Sage GRV</p>
                <p className="mt-0.5 font-mono text-xs font-bold text-emerald-300">{sageGrvNumber || '-'}</p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Supplier</p><p className="mt-0.5 truncate text-xs font-bold text-slate-900">{grn?.suppliers?.name || 'Supplier'}</p></div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Original received</p><p className="mt-0.5 text-xs font-bold text-slate-900">{items.reduce((sum, item) => sum + Number(item.received_qty || 0), 0).toLocaleString()} <span className="text-[10px] font-medium text-slate-500">kg</span></p></div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wider text-rose-600">Return value</p><p className="mt-0.5 text-xs font-bold text-rose-800">${selectedValue.toFixed(2)}</p></div>
          </div>

          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /><p><span className="font-bold">Two-step control:</span> create the RTS for review first; Sage changes only after Finance approval.</p></div>

          {existing ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Existing RTS request</p><p className="mt-0.5 font-mono text-base font-bold text-slate-900">{existing.rts_number}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${isPosted ? 'bg-emerald-100 text-emerald-700' : existing.status === 'pending_finance' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{isPosted && <CheckCircle className="mr-1 inline h-3 w-3" />}{statusLabel}</span></div>
              <div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Reason</p><p className="mt-0.5 text-xs leading-5 text-slate-700">{existing.reason}</p></div>
              {existing.status === 'pending_finance' && canApprove && <Button onClick={approveRequest} disabled={approving} className="mt-4 w-full bg-rose-700 py-5 text-white hover:bg-rose-800">{approving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve & queue Sage RTS</Button>}
              {existing.status === 'pending_finance' && !canApprove && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">Waiting for Finance approval before Sage posting.</p>}
              {existing.status === 'approved' || existing.status === 'processing' ? <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">Approved. The bridge will post this RTS to Sage.</p> : null}
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-bold text-slate-900">Reason for return <span className="text-rose-600">*</span></p><p className="mt-0.5 text-[10px] text-slate-500">Retained in the Finance audit trail.</p></div><span className="text-[10px] font-semibold text-slate-400">Required</span></div>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Damaged bags received during unloading" className="min-h-16 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs outline-none transition focus:border-rose-500 focus:bg-white focus:ring-2 focus:ring-rose-100" />
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><div><p className="text-xs font-bold text-slate-900">Material to return</p><p className="mt-0.5 text-[10px] text-slate-500">Enter only the quantity physically leaving the site.</p></div><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{items.length} line{items.length === 1 ? '' : 's'}</span></div>
                <div className="grid grid-cols-[1fr_100px_130px] gap-3 bg-slate-50 px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500"><span>Material</span><span>Available</span><span>Return quantity</span></div>
                {items.map((item) => <div key={item.id} className="grid grid-cols-[1fr_100px_130px] items-center gap-3 border-t border-slate-100 px-4 py-2.5"><div><p className="text-xs font-bold text-slate-900">{item.raw_materials?.name || item.raw_materials?.code || item.raw_material_id}</p><p className="mt-0.5 font-mono text-[10px] text-slate-500">{item.raw_materials?.code || ''}{item.batch_number ? ` · Batch ${item.batch_number}` : ''}</p></div><span className="text-xs font-semibold text-slate-600">{Number(item.received_qty).toLocaleString()} <span className="text-[10px] font-normal text-slate-400">kg</span></span><div className="relative"><input type="number" min="0" max={item.received_qty} step="0.01" value={quantities[item.id] || ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 pr-8 text-right font-mono text-xs font-bold text-slate-900 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100" placeholder="0" /><span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">kg</span></div></div>)}
                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs"><span className="font-semibold text-slate-500">Selected for return</span><span className="font-mono font-bold text-rose-700">{selectedQuantity.toLocaleString()} kg</span></div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-1"><Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-lg px-4 py-2 text-xs">Cancel</Button><Button onClick={createRequest} disabled={saving || selectedQuantity <= 0} className="rounded-lg bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-700/20 hover:bg-rose-800">{saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Create RTS for Finance approval</Button></div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
