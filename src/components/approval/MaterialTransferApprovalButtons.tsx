import { useState } from 'react';
import { Check, X, Loader2, ArrowRight, Package, Factory } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { TWO_STEP_MATERIAL_TRANSFER } from '../../types/approval';

interface MaterialTransferApprovalButtonsProps {
  transferId: string;
  currentStatus: string;
  quantity: number;
  rawMaterialId: string;
  fromWarehouseId: string;
  onApproved: () => void;
  onRejected: () => void;
}

export default function MaterialTransferApprovalButtons({
  transferId,
  currentStatus,
  quantity,
  rawMaterialId,
  fromWarehouseId,
  onApproved,
  onRejected,
}: MaterialTransferApprovalButtonsProps) {
  const { profile } = useAuth();
  const [processing, setProcessing] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const userRole = profile?.role || '';

  // Normalize status to avoid TypeScript narrowing issues
  const status = String(currentStatus);

  // Only Production acceptance step remains (Step 2).
  // Buffer move is done automatically when the transfer is created.
  const canApproveStep2 = TWO_STEP_MATERIAL_TRANSFER.step2.roles.includes(userRole as any) && status === 'in_buffer';

  if (!canApproveStep2) {
    return null;
  }

  function renderStepIndicator(current: string) {
    return (
      <div className="mb-3.5 p-3 bg-slate-50 border border-slate-200/80 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs font-semibold">
          <div className={`flex items-center gap-1.5 ${
            current === 'pending' ? 'text-amber-600 font-bold' : 
            current === 'in_buffer' || current === 'received' ? 'text-emerald-600 font-bold' : 'text-slate-400'
          }`}>
            <Package className="w-3.5 h-3.5" />
            <span>1. RM Warehouse</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className={`flex items-center gap-1.5 ${
            current === 'in_buffer' ? 'text-amber-600 font-bold' : 
            current === 'received' ? 'text-emerald-600 font-bold' : 'text-slate-400'
          }`}>
            <Package className="w-3.5 h-3.5" />
            <span>2. Buffer</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className={`flex items-center gap-1.5 ${
            current === 'received' ? 'text-emerald-600 font-bold' : 'text-slate-400'
          }`}>
            <Factory className="w-3.5 h-3.5" />
            <span>3. Production</span>
          </div>
        </div>
      </div>
    );
  }

  async function handleStep2Approve() {
    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');

      const { error: approveError } = await supabase.rpc('approve_material_transfer_to_production', {
        p_transfer_id: transferId,
        p_approved_by: user.id,
      });

      if (approveError) throw approveError;

      onApproved();
    } catch (error: any) {
      console.error('Step 2 approval error:', error);

      const message = String(error?.message || '');
      if (message.toLowerCase().includes('insufficient stock in buffer')) {
        alert(`Failed to accept to production: ${message}`);
      } else if (message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
        alert('Network interruption detected. Once network is back, click Accept to Production again — processing is retry-safe.');
      } else {
        alert(`Failed to accept to production: ${message || 'Please try again.'}`);
      }
    } finally {
      setProcessing(false);
    }
  }

  async function handleReject() {
    if (!rejectionReason.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }
    setProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');

      // If rejecting from in_buffer, return stock to RM Warehouse
      if (status === 'in_buffer') {
        // Get Buffer Warehouse ID
        const { data: bufferWarehouse } = await supabase
          .from('warehouses')
          .select('id')
          .eq('code', 'BUFFER')
          .single();

        if (bufferWarehouse) {
          // Deduct from Buffer, return to RM
          await supabase.rpc('update_warehouse_balance', {
            p_raw_material_id: rawMaterialId,
            p_warehouse_id: bufferWarehouse.id,
            p_quantity_delta: -quantity
          });

          await supabase.rpc('update_warehouse_balance', {
            p_raw_material_id: rawMaterialId,
            p_warehouse_id: fromWarehouseId,
            p_quantity_delta: quantity
          });
        }

        // Record reversal movements
        await supabase.from('stock_movements').insert({
          raw_material_id: rawMaterialId,
          movement_type: 'transfer',
          quantity: -quantity,
          warehouse_id: bufferWarehouse?.id,
          reference_type: 'material_transfer',
          reference_id: transferId,
          notes: `Rejection reversal: ${rejectionReason}`,
          performed_by: user.id,
        });

        await supabase.from('stock_movements').insert({
          raw_material_id: rawMaterialId,
          movement_type: 'transfer',
          quantity: quantity,
          warehouse_id: fromWarehouseId,
          reference_type: 'material_transfer',
          reference_id: transferId,
          notes: `Rejection return: ${rejectionReason}`,
          performed_by: user.id,
        });
      }

      const { error: updateError } = await supabase
        .from('material_transfers')
        .update({
          status: 'rejected',
          rejection_reason: rejectionReason,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', transferId);

      if (updateError) throw updateError;

      // Log rejection
      try {
        await supabase.rpc('log_approval_action', {
          p_entity_type: 'material_transfer',
          p_entity_id: transferId,
          p_action: 'rejected',
          p_previous_status: currentStatus,
          p_new_status: 'rejected',
          p_approved_by: user.id,
          p_comments: rejectionReason
        });
      } catch (logError) {
        console.warn('Failed to log rejection:', logError);
      }

      setShowRejectModal(false);
      setRejectionReason('');
      onRejected();
    } catch (error) {
      console.error('Rejection error:', error);
      alert('Failed to reject. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <>
      {/* Step indicator */}
      {renderStepIndicator(status)}

      <div className="flex flex-wrap items-center gap-2.5">
        {canApproveStep2 && (
          <button
            onClick={handleStep2Approve}
            disabled={processing}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Accept to Production
          </button>
        )}

        <button
          onClick={() => setShowRejectModal(true)}
          disabled={processing}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50"
        >
          <X className="w-4 h-4" />
          Reject
        </button>
      </div>

      {showRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Reject Transfer</h3>
            <p className="text-sm text-slate-600 mb-4">
              Please provide a reason for rejecting this material transfer:
              {status === 'in_buffer' && (
                <span className="block mt-2 text-amber-600 font-medium">
                  ⚠️ Stock will be returned to RM Warehouse
                </span>
              )}
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={4}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
              placeholder="Enter rejection reason..."
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectionReason('');
                }}
                disabled={processing}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={processing || !rejectionReason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {processing ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
