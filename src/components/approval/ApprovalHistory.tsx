import { useState, useEffect } from 'react';
import { Clock, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ApprovalEntry {
  id: string;
  action: string;
  previous_status?: string;
  new_status: string;
  created_at: string;
  approver?: { full_name: string };
}

interface ApprovalHistoryProps {
  entityType: string;
  entityId: string;
}

export default function ApprovalHistory({ entityType, entityId }: ApprovalHistoryProps) {
  const [history, setHistory] = useState<ApprovalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [entityType, entityId]);

  async function fetchHistory() {
    setLoading(true);
    try {
      // For GRN approvals, fetch the GRN and derive approval history from status fields
      // Single-step approval: Finance approves directly (pending → approved)
      if (entityType === 'grn') {
        const { data: grn } = await supabase
          .from('goods_received_notes')
          .select('*, approved_by_user:profiles!approved_by(full_name)')
          .eq('id', entityId)
          .single();

        if (grn) {
          const entries: ApprovalEntry[] = [];

          // Add Finance approval if it exists
          if (grn.approved_at && grn.status === 'approved') {
            entries.push({
              id: `approved_${grn.id}`,
              action: 'finance_approved',
              previous_status: 'pending',
              new_status: 'approved',
              created_at: grn.approved_at,
              approver: grn.approved_by_user
            });
          }

          // Add rejection if it exists
          if (grn.status === 'rejected' && grn.approved_at) {
            entries.push({
              id: `rejected_${grn.id}`,
              action: 'rejected',
              previous_status: 'pending',
              new_status: 'rejected',
              created_at: grn.approved_at,
              approver: grn.approved_by_user
            });
          }

          setHistory(entries);
        }
      }

      // For Material Transfer approvals, two-step workflow
      if (entityType === 'material_transfer') {
        const { data: transfer } = await supabase
          .from('material_transfers')
          .select('*, buffer_approver:profiles!buffer_approved_by(full_name), production_approver:profiles!production_approved_by(full_name), rejecter:profiles!approved_by(full_name)')
          .eq('id', entityId)
          .single();

        if (transfer) {
          const entries: ApprovalEntry[] = [];

          // Add automatic buffer transfer (done on creation by requester)
          if (transfer.buffer_approved_at && transfer.buffer_approved_by) {
            entries.push({
              id: `buffer_${transfer.id}`,
              action: 'buffer_transferred',
              previous_status: 'pending',
              new_status: 'in_buffer',
              created_at: transfer.buffer_approved_at,
              approver: transfer.buffer_approver
            });
          }

          // Add Step 2: Buffer → Production approval
          if (transfer.production_approved_at && transfer.production_approved_by) {
            entries.push({
              id: `production_${transfer.id}`,
              action: 'production_approved',
              previous_status: 'in_buffer',
              new_status: 'received',
              created_at: transfer.production_approved_at,
              approver: transfer.production_approver
            });
          }

          // Add rejection if it exists
          if (transfer.status === 'rejected' && transfer.approved_at) {
            entries.push({
              id: `rejected_${transfer.id}`,
              action: 'rejected',
              previous_status: transfer.buffer_approved_at ? 'in_buffer' : 'pending',
              new_status: 'rejected',
              created_at: transfer.approved_at,
              approver: transfer.rejecter
            });
          }

          setHistory(entries);
        }
      }
    } catch (error) {
      console.error('Failed to fetch approval history:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <Clock className="w-8 h-8 mx-auto mb-2" />
        <p className="text-sm">No approval history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Approval History</h3>
      <div className="space-y-3">
        {history.map((entry) => (
          <div key={entry.id} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-full ${getActionColor(entry.action)}`}>
                  {getActionIcon(entry.action)}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {getActionLabel(entry.action)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {entry.previous_status && `${formatStatus(entry.previous_status)} → `}
                    {formatStatus(entry.new_status)}
                  </p>
                </div>
              </div>
              <span className="text-xs text-slate-500">
                {new Date(entry.created_at).toLocaleString()}
              </span>
            </div>
            
            {entry.approver && (
              <div className="flex items-center gap-2 text-xs text-slate-600 mb-2">
                <User className="w-3 h-3" />
                <span>{entry.approver.full_name}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    submitted: 'Submitted',
    approved: 'Approved',
    rm_manager_approved: 'Raw/Procurement Approved',
    rm_approved: 'Released to Buffer',
    buffer_transferred: 'Transferred to Buffer (Auto)',
    production_approved: 'Accepted to Production',
    finance_approved: 'Finance Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    reopened: 'Reopened'
  };
  return labels[action] || action.replace(/_/g, ' ');
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pending',
    rm_approved: 'RM Approved',
    in_buffer: 'In Buffer',
    approved: 'Approved',
    received: 'Received',
    rejected: 'Rejected'
  };
  return labels[status] || status.replace(/_/g, ' ');
}

function getActionColor(action: string): string {
  const colors: Record<string, string> = {
    submitted: 'bg-blue-100 text-blue-600',
    approved: 'bg-emerald-100 text-emerald-600',
    rm_manager_approved: 'bg-teal-100 text-teal-600',
    rm_approved: 'bg-teal-100 text-teal-600',
    buffer_transferred: 'bg-amber-100 text-amber-600',
    production_approved: 'bg-emerald-100 text-emerald-600',
    finance_approved: 'bg-emerald-100 text-emerald-600',
    rejected: 'bg-red-100 text-red-600',
    cancelled: 'bg-slate-100 text-slate-600',
    reopened: 'bg-orange-100 text-orange-600'
  };
  return colors[action] || 'bg-slate-100 text-slate-600';
}

function getActionIcon(action: string) {
  const icons: Record<string, JSX.Element> = {
    submitted: <Clock className="w-3 h-3" />,
    approved: <Clock className="w-3 h-3" />,
    rm_manager_approved: <Clock className="w-3 h-3" />,
    rm_approved: <Clock className="w-3 h-3" />,
    buffer_transferred: <Clock className="w-3 h-3" />,
    production_approved: <Clock className="w-3 h-3" />,
    finance_approved: <Clock className="w-3 h-3" />,
    rejected: <Clock className="w-3 h-3" />,
    cancelled: <Clock className="w-3 h-3" />,
    reopened: <Clock className="w-3 h-3" />
  };
  return icons[action] || <Clock className="w-3 h-3" />;
}
