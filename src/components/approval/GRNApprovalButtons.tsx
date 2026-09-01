import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

interface GRNApprovalButtonsProps {
  grnId: string;
  currentStatus: string;
  vatMode?: 'pending_finance' | 'exclusive' | 'inclusive' | 'no_vat' | null;
  vatReviewedAt?: string | null;
  onApproved: () => void;
  onRejected: () => void;
  onTaxReviewed?: (vatMode: 'exclusive' | 'inclusive' | 'no_vat') => void;
  className?: string;
}

export default function GRNApprovalButtons({
  grnId,
  currentStatus,
  vatMode = 'pending_finance',
  vatReviewedAt = null,
  onApproved,
  onRejected,
  onTaxReviewed,
  className = ''
}: GRNApprovalButtonsProps) {
  const { profile } = useAuth();
  const [processing, setProcessing] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showVatModal, setShowVatModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [selectedVatMode, setSelectedVatMode] = useState<'exclusive' | 'inclusive' | 'no_vat'>(
    vatMode === 'inclusive' || vatMode === 'no_vat' ? vatMode : 'exclusive'
  );

  // Single-step approval: Finance, Accountant, or Admin can approve
  const canApprove = (
    profile?.role === 'finance' || 
    profile?.role === 'accountant' || 
    profile?.role === 'admin'
  ) && currentStatus === 'pending';
  
  // Same roles can reject
  const canReject = canApprove;

  if (!canApprove && !canReject) {
    return null;
  }

  async function handleApprove() {
    if (!profile) return;
    setProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');

      const { error: approvalError } = await supabase.rpc('approve_grn_and_queue', {
        p_grn_id: grnId,
      });

      if (approvalError) throw approvalError;

      // Return the operator to the live dashboard immediately. The bridge will
      // provide queued, processing, and posted updates from this point.
      onApproved();

      // Auto-create rm_cost_register entries when GRN is approved
      try {
        // Fetch GRN details and line items
        const [grnRes, itemsRes, latestRateRes] = await Promise.all([
          supabase.from('goods_received_notes').select('received_date, grn_number, warehouse_id').eq('id', grnId).single(),
          supabase.from('grn_items').select('raw_material_id, received_qty, unit_cost, raw_materials(name)').eq('grn_id', grnId),
          supabase.from('usd_zig_rate_history').select('rate').order('effective_date', { ascending: false }).limit(1),
        ]);

        const grnDate = grnRes.data?.received_date;
        const grnNumber = grnRes.data?.grn_number;
        const warehouseId = grnRes.data?.warehouse_id;
        const items = itemsRes.data || [];
        const latestRate = latestRateRes.data?.[0]?.rate || null;

        if (items.length > 0 && grnDate) {
          const costEntries = items.map((item: any) => ({
            raw_material_id: item.raw_material_id,
            cost_per_tonne_usd: item.unit_cost * 1000,
            effective_date: grnDate,
            source: 'GRN',
            grn_id: grnId,
            usd_zig_rate: latestRate,
            created_by: user.id,
          }));

          await supabase.from('rm_cost_register').insert(costEntries);

          // Auto-link to DRS receipts
          const receiptEntries = items.map((item: any) => ({
            receipt_date: grnDate,
            raw_material_name: item.raw_materials?.name || 'Unknown',
            quantity_kg: item.received_qty,
            grn_reference: grnNumber || grnId,
          }));
          await supabase.from('rm_daily_receipts').insert(receiptEntries);

          // Update MES warehouse stock balance for each received item
          if (warehouseId) {
            const balanceUpdates = items.map((item: any) =>
              supabase.rpc('update_warehouse_balance', {
                p_raw_material_id: item.raw_material_id,
                p_warehouse_id: warehouseId,
                p_quantity_delta: Number(item.received_qty || 0),
              })
            );
            const balanceResults = await Promise.all(balanceUpdates);
            const balanceErrors = balanceResults.filter((r: any) => r.error);
            if (balanceErrors.length > 0) {
              console.warn('Warehouse balance update failed for some items:', balanceErrors.map((r: any) => r.error?.message).join('; '));
            }
          }
        }

      } catch (costError) {
        console.warn('Failed to auto-create RM cost entries:', costError);
      }
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');

      const { error: rejectionError } = await supabase.rpc('reject_grn', {
        p_grn_id: grnId,
        p_reason: rejectionReason,
      });

      if (rejectionError) throw rejectionError;

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

  async function handleVatReview() {
    setProcessing(true);
    try {
      const { error } = await supabase.rpc('record_grn_vat_review', {
        p_grn_id: grnId,
        p_vat_mode: selectedVatMode,
      });
      if (error) throw error;

      setShowVatModal(false);
      onTaxReviewed?.(selectedVatMode);
    } catch (error) {
      console.error('VAT review error:', error);
      alert('Failed to save the Finance VAT review. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <>
      <div className={`space-y-3 ${className}`}>
        {/* Finance Approval - Single Step */}
        {canApprove && (
          <div className="p-3 bg-[#0b0b30]/5 border border-[#0b0b30]/15 rounded-lg">
            <p className="text-xs font-semibold text-[#0b0b30] mb-1">Finance review</p>
            <p className="text-xs text-slate-600 mb-3">1. Set VAT configuration. 2. Approve and queue Sage, or reject.</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowVatModal(true)}
                disabled={processing}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  vatReviewedAt
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-[#0b0b30] hover:bg-[#171750] text-white'
                }`}
              >
                {vatReviewedAt ? 'VAT Configured' : 'Set VAT Configuration'}
              </button>
              <button
                onClick={handleApprove}
                disabled={processing || !vatReviewedAt}
                title={vatReviewedAt ? undefined : 'Complete the Finance VAT review before approval.'}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#ff9100] hover:bg-[#e67f00] text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Approve GRN
              </button>
              <button
                onClick={() => setShowRejectModal(true)}
                disabled={processing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Reject
              </button>
            </div>
          </div>
        )}
      </div>

      {showVatModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <h3 className="text-lg font-bold text-[#0b0b30]">Finance VAT Review</h3>
            <p className="text-sm text-slate-600 mt-1 mb-5">Raw-material GRNs default to Tax Exclusive using Sage Taxable Input 515 at 15.5%.</p>
            <div className="space-y-3">
              {[
                ['exclusive', 'Tax Exclusive', 'Entered unit costs exclude VAT. VAT is added to the supplier payable.'],
                ['inclusive', 'Tax Inclusive', 'Entered unit costs include VAT. Sage must calculate the net stock value and VAT portion.'],
                ['no_vat', 'No VAT', 'Use only for an exempt or zero-rated supplier invoice.'],
              ].map(([value, label, description]) => (
                <label key={value} className={`block border rounded-lg p-3 cursor-pointer ${selectedVatMode === value ? 'border-[#ff9100] bg-orange-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="vat-mode"
                    value={value}
                    checked={selectedVatMode === value}
                    onChange={() => setSelectedVatMode(value as 'exclusive' | 'inclusive' | 'no_vat')}
                    className="mr-2 accent-[#ff9100]"
                  />
                  <span className="text-sm font-semibold text-slate-800">{label}</span>
                  <span className="block ml-5 text-xs text-slate-600 mt-1">{description}</span>
                </label>
              ))}
            </div>
            {selectedVatMode !== 'no_vat' && (
              <p className="mt-4 rounded-lg bg-[#0b0b30]/5 border border-[#0b0b30]/10 px-3 py-2 text-xs text-[#0b0b30]">Sage tax code: <strong>515 Taxable Input</strong> at <strong>15.5%</strong>.</p>
            )}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowVatModal(false)} disabled={processing} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
              <button onClick={handleVatReview} disabled={processing} className="px-4 py-2 text-sm font-medium text-white bg-[#ff9100] hover:bg-[#e67f00] rounded-lg disabled:opacity-50">{processing ? 'Saving...' : 'Save VAT Review'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Reject GRN</h3>
            <p className="text-sm text-slate-600 mb-4">
              Please provide a reason for rejecting this Goods Received Note:
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
