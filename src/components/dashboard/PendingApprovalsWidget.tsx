import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { canApprove } from '../../types/approval';
import StatusBadge from '../ui/StatusBadge';

const CATEGORY_META: Record<string, { label: string; pill: string }> = {
  grn:                   { label: 'GRN',            pill: 'bg-blue-100 text-blue-700' },
  quality_inspection:    { label: 'Quality',         pill: 'bg-purple-100 text-purple-700' },
  production_order:      { label: 'Production',      pill: 'bg-teal-100 text-teal-700' },
  macropack_order:       { label: 'Macropack',       pill: 'bg-orange-100 text-orange-700' },
  dispatch_order:        { label: 'Dispatch',        pill: 'bg-indigo-100 text-indigo-700' },
  work_order:            { label: 'Maintenance',     pill: 'bg-slate-100 text-slate-600' },
  reconciliation_period: { label: 'Reconciliation',  pill: 'bg-emerald-100 text-emerald-700' },
  material_transfer:     { label: 'Transfer',        pill: 'bg-amber-100 text-amber-700' },
  chick_booking:         { label: 'Chick Bookings',  pill: 'bg-emerald-100 text-emerald-700' },
  weigh_bridge_ticket:   { label: 'Weigh Bridge',    pill: 'bg-cyan-100 text-cyan-700' },
};

const STAGE_META: Record<string, string> = {
  PENDING_RM:         'bg-sky-100 text-sky-700',
  PENDING_SUPERVISOR: 'bg-violet-100 text-violet-700',
};

interface PendingApproval {
  entity_type: string;
  entity_id: string;
  entity_number: string;
  entity_name: string;
  status: string;
  created_at: string;
  created_by?: string;
  branch_id?: string;
}

interface WidgetProps { limit?: number; compact?: boolean; }

export default function PendingApprovalsWidget({ limit = 10, compact = false }: WidgetProps) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [creatorNames, setCreatorNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { profile } = useAuth();
  const navigate = useNavigate();

  const fetchPendingApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const approvalsMap = new Map<string, PendingApproval>();
      const role = profile?.role;

      if (!role) {
        setApprovals([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      // ── GRN ──
      if (canApprove('grn', role)) {
        try {
          const { data: grns } = await supabase
            .from('goods_received_notes')
            .select('id, grn_number, status, created_at, received_by, suppliers(name)')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
          grns?.forEach((g: any) => {
            approvalsMap.set(`grn:${g.id}`, {
              entity_type: 'grn', entity_id: g.id, entity_number: g.grn_number,
              entity_name: g.suppliers?.name || 'Unknown Supplier', status: g.status,
              created_at: g.created_at, created_by: g.received_by || undefined,
            });
          });
        } catch (e) { console.warn('GRN fallback error:', e); }
      }

      // ── Material Transfers ──
      if (canApprove('material_transfer', role)) {
        try {
          const { data: transfers } = await supabase
            .from('material_transfers')
            .select('id, transfer_number, status, created_at, requested_by, raw_materials(name)')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
          transfers?.forEach((t: any) => {
            approvalsMap.set(`material_transfer:${t.id}`, {
              entity_type: 'material_transfer', entity_id: t.id,
              entity_number: t.transfer_number || t.id.substring(0, 8),
              entity_name: t.raw_materials?.name || 'Unknown Material', status: t.status,
              created_at: t.created_at, created_by: t.requested_by || undefined,
            });
          });
        } catch (e) { console.warn('Transfer fallback error:', e); }
      }

      // ── Chick Bookings ──
      if (canApprove('chick_booking', role)) {
        try {
          const { data: chickPOs } = await supabase
            .from('chick_purchase_orders')
            .select('id, po_number, status, created_at, created_by, chick_suppliers(name)')
            .not('status', 'in', "('DRAFT','APPROVED','DISPATCHED','DELIVERED','INVOICED','rejected')")
            .order('created_at', { ascending: false });
          chickPOs?.forEach((po: any) => {
            approvalsMap.set(`chick_booking:${po.id}`, {
              entity_type: 'chick_booking', entity_id: po.id, entity_number: po.po_number,
              entity_name: po.chick_suppliers?.name || 'Unknown Supplier', status: po.status,
              created_at: po.created_at, created_by: po.created_by || undefined,
            });
          });
        } catch (e) { console.warn('Chick fallback error:', e); }
      }

      // ── Production Orders ──
      if (canApprove('production_order', role)) {
        try {
          const { data: pos } = await supabase
            .from('production_orders')
            .select('id, batch_number, status, created_at, operator_id')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
          pos?.forEach((p: any) => {
            approvalsMap.set(`production_order:${p.id}`, {
              entity_type: 'production_order', entity_id: p.id, entity_number: p.batch_number,
              entity_name: p.batch_number, status: p.status,
              created_at: p.created_at, created_by: p.operator_id || undefined,
            });
          });
        } catch (e) { console.warn('Production order fallback error:', e); }
      }

      // ── Dispatch Orders ──
      if (canApprove('dispatch_order', role)) {
        try {
          const { data: dispatches } = await supabase
            .from('dispatch_orders')
            .select('id, dispatch_number, status, created_at, prepared_by')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
          dispatches?.forEach((d: any) => {
            approvalsMap.set(`dispatch_order:${d.id}`, {
              entity_type: 'dispatch_order', entity_id: d.id, entity_number: d.dispatch_number,
              entity_name: d.dispatch_number, status: d.status,
              created_at: d.created_at, created_by: d.prepared_by || undefined,
            });
          });
        } catch (e) { console.warn('Dispatch fallback error:', e); }
      }

      // ── Macropack Orders ──
      if (canApprove('macropack_order', role)) {
        try {
          const { data: mpos } = await supabase
            .from('macropack_manufacture_orders')
            .select('id, status, created_at, submitted_by')
            .in('status', ['PENDING_RM', 'PENDING_SUPERVISOR'])
            .order('created_at', { ascending: false });
          mpos?.forEach((m: any) => {
            approvalsMap.set(`macropack_order:${m.id}`, {
              entity_type: 'macropack_order', entity_id: m.id, entity_number: m.id.substring(0, 8),
              entity_name: 'Macropack Order', status: m.status,
              created_at: m.created_at, created_by: m.submitted_by || undefined,
            });
          });
        } catch (e) { console.warn('Macropack fallback error:', e); }
      }

      // ── Weigh Bridge Tickets ──
      if (canApprove('weigh_bridge_ticket', role)) {
        try {
          const { data: wbts } = await supabase
            .from('weigh_bridge_tickets')
            .select('id, ticket_no, status, created_at, created_by, vehicle_reg')
            .eq('status', 'open')
            .order('created_at', { ascending: false });
          wbts?.forEach((w: any) => {
            approvalsMap.set(`weigh_bridge_ticket:${w.id}`, {
              entity_type: 'weigh_bridge_ticket', entity_id: w.id, entity_number: w.ticket_no,
              entity_name: w.vehicle_reg || w.ticket_no, status: 'pending_link',
              created_at: w.created_at, created_by: w.created_by || undefined,
            });
          });
        } catch (e) { console.warn('Weigh bridge fallback error:', e); }
      }

      const combined = Array.from(approvalsMap.values()).sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setApprovals(combined.slice(0, limit));
      setTotalCount(combined.length);

      // Load creator names
      const ids = [...new Set(combined.map(a => a.created_by).filter(Boolean))] as string[];
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        const map = new Map<string, string>();
        profiles?.forEach((p: any) => map.set(p.id, p.full_name));
        setCreatorNames(map);
      }
    } catch (err: any) {
      console.error('Error fetching pending approvals:', err);
      setError(err.message || 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [limit, profile?.role]);

  useEffect(() => {
    fetchPendingApprovals();
  }, [fetchPendingApprovals]);

  function navigateToEntity(approval: PendingApproval) {
    const routes: Record<string, string> = {
      grn: '/goods-received',
      quality_inspection: '/quality-inspection',
      production_order: '/production-orders',
      dispatch_order: '/dispatch',
      work_order: '/maintenance-work-orders',
      reconciliation_period: '/reconciliation',
      macropack_order: '/macropack-manufacturing',
      chick_booking: '/chick-bookings',
      material_transfer: '/material-transfer',
      weigh_bridge_ticket: '/weigh-bridge',
    };
    const route = routes[approval.entity_type];
    if (route) navigate(route);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const pad = compact ? 'px-4 py-2.5' : 'px-6 py-4';
  const headerPad = compact ? 'px-4 py-3' : 'px-6 py-4';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className={`${headerPad} border-b border-slate-200`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`${compact ? 'p-1.5' : 'p-2'} bg-amber-100 rounded-lg`}>
              <Clock className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-amber-600`} />
            </div>
            <div>
              <h3 className={`${compact ? 'text-sm' : 'text-lg'} font-bold text-slate-800`}>Pending Approvals</h3>
              <p className="text-xs text-slate-500">Items requiring your approval</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchPendingApprovals}
              disabled={loading}
              className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {totalCount > 0 && (
              <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                {totalCount}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-h-[360px] overflow-y-auto">
        {error ? (
          <div className={`${compact ? 'px-4 py-5' : 'px-6 py-8'} text-center`}>
            <AlertCircle className={`${compact ? 'w-7 h-7' : 'w-10 h-10'} text-red-400 mx-auto mb-2`} />
            <p className="text-sm text-red-600 font-medium">Error loading approvals</p>
            <p className="text-xs text-slate-500 mt-1">{error}</p>
            <button
              onClick={fetchPendingApprovals}
              className="mt-3 px-3 py-1.5 text-xs font-semibold text-teal-600 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        ) : approvals.length === 0 ? (
          <div className={`${compact ? 'px-4 py-5' : 'px-6 py-8'} text-center`}>
            <AlertCircle className={`${compact ? 'w-7 h-7' : 'w-10 h-10'} text-slate-300 mx-auto mb-2`} />
            <p className="text-sm text-slate-500">No pending approvals</p>
            <p className="text-xs text-slate-400 mt-1">All caught up!</p>
          </div>
        ) : (() => {
          // Group by entity_type for categorised sections
          const grouped = approvals.reduce<Record<string, PendingApproval[]>>((acc, a) => {
            (acc[a.entity_type] = acc[a.entity_type] || []).push(a);
            return acc;
          }, {});
          return Object.entries(grouped).map(([type, items]) => {
            const meta = CATEGORY_META[type] || { label: type, pill: 'bg-slate-100 text-slate-600' };
            return (
              <div key={type}>
                {/* Category header */}
                <div className="px-4 py-1.5 bg-slate-50 border-y border-slate-100 flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.pill}`}>{meta.label}</span>
                  <span className="text-[11px] text-slate-400">{items.length} pending</span>
                </div>
                {/* Items in this category */}
                {items.map((approval) => {
                  const stagePill = STAGE_META[approval.status];
                  return (
                    <button
                      key={`${approval.entity_type}-${approval.entity_id}`}
                      onClick={() => navigateToEntity(approval)}
                      className={`w-full ${pad} hover:bg-slate-50 transition-colors text-left group border-b border-slate-100 last:border-b-0`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold text-slate-800 truncate">
                              {approval.entity_name}
                            </span>
                            <span className="text-xs text-slate-500 font-mono shrink-0">
                              {approval.entity_number}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {stagePill ? (
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${stagePill}`}>
                                {approval.status.replace('_', ' ')}
                              </span>
                            ) : (
                              <StatusBadge status={approval.status} />
                            )}
                            {approval.created_by && creatorNames.get(approval.created_by) && (
                              <span className="text-xs text-slate-500 truncate">
                                By <span className="font-medium text-slate-700">{creatorNames.get(approval.created_by)}</span>
                              </span>
                            )}
                            <span className="text-xs text-slate-400">
                              {new Date(approval.created_at).toLocaleDateString('en-GB')}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-teal-500 transition-colors flex-shrink-0 ml-2" />
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          });
        })()}
      </div>

      {approvals.length > 0 && (
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {totalCount > approvals.length ? `Showing ${approvals.length} of ${totalCount}` : 'Click an item to review'}
          </p>
          {totalCount > approvals.length && (
            <button onClick={() => navigate('/goods-received')} className="text-xs font-semibold text-teal-600 hover:text-teal-700">
              View all →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
