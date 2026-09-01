import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { canApprove, getApprovalActionLabel } from '../../types/approval';

interface ApprovalButtonsProps {
  entityType: 'grn' | 'quality_inspection' | 'production_order' | 'dispatch_order' | 'work_order' | 'reconciliation_period' | 'material_transfer';
  entityId: string;
  currentStatus: string;
  onApproved: () => void;
  onRejected: () => void;
  approveStatus: string;
  rejectStatus: string;
  className?: string;
}

export default function ApprovalButtons({
  entityType,
  entityId,
  currentStatus,
  onApproved,
  onRejected,
  approveStatus,
  rejectStatus,
  className = ''
}: ApprovalButtonsProps) {
  const { profile } = useAuth();
  const [processing, setProcessing] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const canUserApprove = profile?.role ? canApprove(entityType, profile.role) : false;
  const labels = getApprovalActionLabel(entityType);

  if (!canUserApprove) {
    return null;
  }

  async function handleApprove() {
    if (!profile) return;
    setProcessing(true);

    try {
      // Get the actual user ID from auth
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');

      const tableName = getTableName(entityType);
      
      // Update entity status
      const { error: updateError } = await supabase
        .from(tableName)
        .update({
          status: approveStatus,
          approved_by: user.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', entityId);

      if (updateError) throw updateError;

      // Log approval action (non-blocking - continue even if logging fails)
      try {
        await supabase.rpc('log_approval_action', {
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_action: 'approved',
          p_previous_status: currentStatus,
          p_new_status: approveStatus,
          p_approved_by: user.id,
          p_comments: null
        });
      } catch (logError) {
        console.warn('Failed to log approval action:', logError);
        // Continue anyway - approval was successful
      }

      onApproved();
    } catch (error) {
      console.error('Approval error:', error);
      alert('Failed to approve. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleReject() {
    if (!profile || !rejectionReason.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }
    setProcessing(true);

    try {
      // Get the actual user ID from auth
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');

      const tableName = getTableName(entityType);
      
      // Update entity status
      const { error: updateError } = await supabase
        .from(tableName)
        .update({
          status: rejectStatus,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          rejection_reason: rejectionReason
        })
        .eq('id', entityId);

      if (updateError) throw updateError;

      // Log rejection action
      try {
        await supabase.rpc('log_approval_action', {
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_action: 'rejected',
          p_previous_status: currentStatus,
          p_new_status: rejectStatus,
          p_approved_by: user.id,
          p_comments: rejectionReason
        });
      } catch (logError) {
        console.warn('Failed to log rejection action:', logError);
        // Continue anyway - rejection was successful
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
      <div className={`flex items-center gap-2 ${className}`}>
        <button
          onClick={handleApprove}
          disabled={processing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {labels.approve}
        </button>
        <button
          onClick={() => setShowRejectModal(true)}
          disabled={processing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <X className="w-4 h-4" />
          {labels.reject}
        </button>
      </div>

      {showRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Confirm Rejection</h3>
            <p className="text-sm text-slate-600 mb-4">
              Please provide a reason for rejecting this {entityType.replace('_', ' ')}:
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

function getTableName(entityType: string): string {
  const tableMap: Record<string, string> = {
    grn: 'goods_received_notes',
    quality_inspection: 'quality_inspections',
    production_order: 'production_orders',
    dispatch_order: 'dispatch_orders',
    work_order: 'maintenance_work_orders',
    reconciliation_period: 'reconciliation_periods',
    material_transfer: 'stock_movements'
  };
  return tableMap[entityType] || entityType;
}
