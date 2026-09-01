import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import {
  ClipboardCheck, CheckCircle2, XCircle, Clock, DollarSign, Package,
  Building2, Loader2, ChevronDown, ChevronRight, ShieldAlert, Zap,
  TrendingUp, FileCheck2, AlertTriangle, RefreshCw, Search
} from 'lucide-react';
import toast from 'react-hot-toast';

interface SagePostingReview {
  id: string;
  sync_event_id: string;
  event_type: string;
  event_description: string | null;
  sage_code: string;
  transaction_type: string;
  sage_tx_code: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
  warehouse_id: number;
  warehouse_code: string | null;
  reference: string | null;
  reference2: string | null;
  sage_order_num?: string | null;
  sage_ext_order_num?: string | null;
  sage_delivery_note?: string | null;
  description: string | null;
  transaction_date: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  posted_at: string | null;
  sage_result: any;
  created_at: string;
}

interface ReviewGroup {
  key: string;
  sync_event_id: string;
  event_type: string;
  event_description: string | null;
  reference: string | null;
  lines: SagePostingReview[];
  status: 'pending' | 'approved' | 'rejected' | 'mixed';
  allPosted: boolean;
  totalValue: number;
  lineCount: number;
  created_at: string;
}

interface ReviewDocumentSummary {
  kind: 'grn' | 'generic';
  title: string;
  subtitle?: string;
  supplier?: string;
  warehouse?: string;
  date?: string;
  notes?: string | null;
  financeRefs?: {
    supplierInvoiceNo?: string | null;
    supplierDeliveryNoteNo?: string | null;
    supplierOrderNo?: string | null;
    externalReference?: string | null;
  };
  totalQty?: number;
  totalValue?: number;
  weighbridge?: {
    ticket?: string | null;
    productCode?: string | null;
    vehicle?: string | null;
    driver?: string | null;
    nettMass?: number | null;
  };
  lines?: Array<{
    code?: string | null;
    name?: string | null;
    qty?: number;
    unitCost?: number;
    total?: number;
    batch?: string | null;
  }>;
}

const EVENT_LABELS: Record<string, string> = {
  grn_confirmed: 'GRN Receipt',
  materials_issued: 'RM Issue',
  production_completed: 'Batch Complete',
  dispatch_delivered: 'Dispatch',
  macropack_manufactured: 'Macropack',
  macropack_completed: 'Macropack',
  reconciliation_variance_approved: 'Recon Variance',
};

const EVENT_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  grn_confirmed:                    { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  materials_issued:                 { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500' },
  production_completed:             { bg: 'bg-emerald-50',text: 'text-emerald-700',border: 'border-emerald-200',dot: 'bg-emerald-500' },
  dispatch_delivered:               { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  macropack_manufactured:           { bg: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200',   dot: 'bg-teal-500' },
  macropack_completed:              { bg: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200',   dot: 'bg-teal-500' },
  reconciliation_variance_approved: { bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-200',   dot: 'bg-rose-500' },
};

const TX_LABELS: Record<string, string> = {
  GRV:  'Goods Received',
  MFDR: 'Material Issue',
  MFMF: 'Stock In',
  WHT:  'Warehouse Transfer',
  ADJ:  'Adjustment',
};

const TX_COLORS: Record<string, string> = {
  GRV:  'bg-blue-100 text-blue-700 border-blue-200',
  MFDR: 'bg-amber-100 text-amber-700 border-amber-200',
  MFMF: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  WHT:  'bg-slate-100 text-slate-600 border-slate-200',
  ADJ:  'bg-rose-100 text-rose-700 border-rose-200',
};

function groupStatus(lines: SagePostingReview[]): ReviewGroup['status'] {
  const statuses = new Set(lines.map((l) => l.status));
  if (statuses.size === 1) return lines[0].status;
  return 'mixed';
}

function buildGroups(reviews: SagePostingReview[]): ReviewGroup[] {
  const map = new Map<string, SagePostingReview[]>();
  for (const r of reviews) {
    const key = r.sync_event_id || r.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }

  const groups: ReviewGroup[] = [];
  for (const [key, lines] of map) {
    lines.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const first = lines[0];
    groups.push({
      key,
      sync_event_id: first.sync_event_id,
      event_type: first.event_type,
      event_description: first.event_description || lines.find((l) => l.event_description)?.event_description || null,
      reference: first.reference || lines.find((l) => l.reference)?.reference || null,
      lines,
      status: groupStatus(lines),
      allPosted: lines.every((l) => !!l.posted_at || l.status === 'rejected'),
      totalValue: lines.reduce((sum, l) => sum + Number(l.total_value || 0), 0),
      lineCount: lines.length,
      created_at: first.created_at,
    });
  }

  groups.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return groups;
}

function StatusPill({ group }: { group: ReviewGroup }) {
  if (group.status === 'approved' && group.allPosted) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
        <FileCheck2 className="w-3 h-3" /> Posted to Sage
      </span>
    );
  }
  if (group.status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-100 text-sky-700 border border-sky-200">
        <Zap className="w-3 h-3" /> Approved — Queued
      </span>
    );
  }
  if (group.status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-700 border border-red-200">
        <XCircle className="w-3 h-3" /> Rejected
      </span>
    );
  }
  if (group.status === 'mixed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
        <AlertTriangle className="w-3 h-3" /> Mixed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
      <Clock className="w-3 h-3" /> Pending Review
    </span>
  );
}

function LinePill({ status, posted_at }: { status: string; posted_at: string | null }) {
  if (status === 'approved' && posted_at) return <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">Posted</span>;
  if (status === 'approved') return <span className="text-[10px] font-bold text-sky-600 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">Approved</span>;
  if (status === 'rejected') return <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">Rejected</span>;
  return <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Pending</span>;
}

function KPICard({ label, value, sub, icon: Icon, accent }: { label: string; value: string | number; sub?: string; icon: any; accent: string }) {
  return (
    <div className={`rounded-2xl border bg-white shadow-sm p-4 flex items-center gap-3 ${accent}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent.replace('border-', 'bg-').replace('-200', '-100')}`}>
        <Icon className={`w-5 h-5 ${accent.replace('border-', 'text-').replace('-200', '-600')}`} />
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-xl font-extrabold text-slate-900 leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function DocumentSummaryPanel({ summary }: { summary?: ReviewDocumentSummary }) {
  if (!summary) return null;

  return (
    <div className="bg-white border-b border-slate-100">
      <div className="px-4 py-3 bg-blue-50/60 border-b border-blue-100">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Source Document Summary</p>
            <h3 className="text-sm font-extrabold text-slate-900 mt-0.5">{summary.title}</h3>
            {summary.subtitle && <p className="text-xs text-slate-500 mt-0.5">{summary.subtitle}</p>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs min-w-0 lg:min-w-[520px]">
            <div className="rounded-lg bg-white border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Supplier</p>
              <p className="font-bold text-slate-800 truncate">{summary.supplier || '-'}</p>
            </div>
            <div className="rounded-lg bg-white border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Warehouse</p>
              <p className="font-bold text-slate-800 truncate">{summary.warehouse || '-'}</p>
            </div>
            <div className="rounded-lg bg-white border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Total Qty</p>
              <p className="font-mono font-bold text-slate-800">{Number(summary.totalQty || 0).toLocaleString()} kg</p>
            </div>
            <div className="rounded-lg bg-white border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">GRN Value</p>
              <p className="font-mono font-bold text-emerald-700">${Number(summary.totalValue || 0).toFixed(2)}</p>
            </div>
          </div>
        </div>

        {summary.financeRefs && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Supplier Invoice</p>
              <p className="font-mono font-bold text-slate-800 truncate">{summary.financeRefs.supplierInvoiceNo || '-'}</p>
            </div>
            <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Delivery Note</p>
              <p className="font-mono font-bold text-slate-800 truncate">{summary.financeRefs.supplierDeliveryNoteNo || '-'}</p>
            </div>
            <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Order / PO</p>
              <p className="font-mono font-bold text-slate-800 truncate">{summary.financeRefs.supplierOrderNo || '-'}</p>
            </div>
            <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">External Ref</p>
              <p className="font-mono font-bold text-slate-800 truncate">{summary.financeRefs.externalReference || '-'}</p>
            </div>
          </div>
        )}

        {summary.weighbridge?.ticket && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <div className="rounded-lg bg-white/80 border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">WB Ticket</p>
              <p className="font-mono font-bold text-slate-800">{summary.weighbridge.ticket}</p>
            </div>
            <div className="rounded-lg bg-white/80 border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">WB Product</p>
              <p className="font-mono font-bold text-slate-800">{summary.weighbridge.productCode || '-'}</p>
            </div>
            <div className="rounded-lg bg-white/80 border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Vehicle</p>
              <p className="font-bold text-slate-800">{summary.weighbridge.vehicle || '-'}</p>
            </div>
            <div className="rounded-lg bg-white/80 border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Driver</p>
              <p className="font-bold text-slate-800 truncate">{summary.weighbridge.driver || '-'}</p>
            </div>
            <div className="rounded-lg bg-white/80 border border-blue-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Nett Mass</p>
              <p className="font-mono font-bold text-teal-700">{summary.weighbridge.nettMass != null ? `${Number(summary.weighbridge.nettMass).toLocaleString()} kg` : '-'}</p>
            </div>
          </div>
        )}
      </div>

      {summary.lines && summary.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase tracking-wide text-[10px]">Product</th>
                <th className="text-right px-3 py-2 font-bold text-slate-500 uppercase tracking-wide text-[10px]">Qty</th>
                <th className="text-right px-3 py-2 font-bold text-slate-500 uppercase tracking-wide text-[10px]">Price</th>
                <th className="text-right px-3 py-2 font-bold text-slate-500 uppercase tracking-wide text-[10px]">Line Total</th>
                <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase tracking-wide text-[10px]">Batch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.lines.map((line, index) => (
                <tr key={`${line.code || 'line'}-${index}`} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    <p className="font-bold text-slate-800">{line.name || '-'}</p>
                    <p className="font-mono text-[10px] text-blue-700">{line.code || '-'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-800">{Number(line.qty || 0).toLocaleString()} kg</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-600">${Number(line.unitCost || 0).toFixed(4)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">${Number(line.total || 0).toFixed(2)}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-500">{line.batch || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SagePostingReviewPage() {
  const { profile, loading: authLoading } = useAuth();
  const [reviews, setReviews] = useState<SagePostingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [rejectGroup, setRejectGroup] = useState<ReviewGroup | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [batchApproving, setBatchApproving] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [documentSummaries, setDocumentSummaries] = useState<Record<string, ReviewDocumentSummary>>({});

  const isFinance = profile?.role === 'finance' || profile?.role === 'accountant' || profile?.role === 'admin';

  const loadDocumentSummaries = useCallback(async (nextReviews: SagePostingReview[]) => {
    const syncIds = [...new Set(nextReviews.filter((r) => r.event_type === 'grn_confirmed').map((r) => r.sync_event_id).filter(Boolean))];
    if (syncIds.length === 0) {
      setDocumentSummaries({});
      return;
    }

    const { data: syncRows, error: syncError } = await supabase
      .from('sync_log')
      .select('id, reference_id, reference_type')
      .in('id', syncIds);

    if (syncError || !syncRows) {
      console.warn('Failed to load source sync rows for Sage review summaries:', syncError);
      return;
    }

    const grnIds = syncRows.map((row: any) => row.reference_id).filter(Boolean);
    if (grnIds.length === 0) return;

    const { data: grns, error: grnError } = await supabase
      .from('goods_received_notes')
      .select('*, suppliers(name, code), warehouses(name, code), grn_items(*, raw_materials(code, name))')
      .in('id', grnIds);

    if (grnError || !grns) {
      console.warn('Failed to load GRN source details for Sage review summaries:', grnError);
      return;
    }

    const grnMap = new Map((grns as any[]).map((grn) => [grn.id, grn]));
    const nextSummaries: Record<string, ReviewDocumentSummary> = {};

    for (const row of syncRows as any[]) {
      const grn = grnMap.get(row.reference_id);
      if (!grn) continue;

      const lines = (grn.grn_items || []).map((item: any) => {
        const qty = Number(item.received_qty || 0);
        const unitCost = Number(item.unit_cost || 0);
        return {
          code: item.raw_materials?.code,
          name: item.raw_materials?.name,
          qty,
          unitCost,
          total: qty * unitCost,
          batch: item.batch_number,
        };
      });

      nextSummaries[row.id] = {
        kind: 'grn',
        title: grn.grn_number || 'GRN Receipt',
        subtitle: grn.received_date ? `Received ${new Date(grn.received_date).toLocaleDateString('en-ZW')}` : undefined,
        supplier: grn.suppliers?.name,
        warehouse: grn.warehouses?.name || grn.warehouses?.code,
        date: grn.received_date,
        notes: grn.notes,
        financeRefs: {
          supplierInvoiceNo: grn.supplier_invoice_no,
          supplierDeliveryNoteNo: grn.supplier_delivery_note_no,
          supplierOrderNo: grn.supplier_order_no,
          externalReference: grn.external_reference,
        },
        totalQty: lines.reduce((sum: number, line: any) => sum + Number(line.qty || 0), 0),
        totalValue: lines.reduce((sum: number, line: any) => sum + Number(line.total || 0), 0),
        weighbridge: {
          ticket: grn.wb_transaction_no || grn.weigh_bridge_ticket_no,
          productCode: grn.wb_product_code,
          vehicle: grn.wb_vehicle_reg || grn.weigh_bridge_ticket_vehicle_number,
          driver: grn.wb_driver_name || grn.weigh_bridge_ticket_driver_name,
          nettMass: grn.wb_nett_mass || grn.weigh_bridge_ticket_net_weight || grn.weigh_bridge_ticket_weight,
        },
        lines,
      };
    }

    setDocumentSummaries(nextSummaries);
  }, []);

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    let query = supabase
      .from('sage_posting_reviews')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;
    if (error) {
      toast.error(`Failed to load: ${error.message}`);
    } else {
      const nextReviews = data || [];
      setReviews(nextReviews);
      loadDocumentSummaries(nextReviews);
    }
    if (!isSilent) setLoading(false);
  }, [filter, loadDocumentSummaries]);

  useEffect(() => {
    fetchData(false);
    const interval = setInterval(() => fetchData(true), 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const groups = useMemo(() => buildGroups(reviews), [reviews]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter((g) =>
      g.event_description?.toLowerCase().includes(q) ||
      g.reference?.toLowerCase().includes(q) ||
      g.event_type.toLowerCase().includes(q) ||
      g.lines.some((l) => l.sage_code?.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q))
    );
  }, [groups, searchQuery]);

  const approveGroup = async (group: ReviewGroup) => {
    const approvableIds = group.lines
      .filter((l) => l.status === 'pending' || l.status === 'rejected')
      .map((l) => l.id);

    if (approvableIds.length === 0) { toast.error('No approvable lines in this package (already posted)'); return; }

    setActingKey(group.key);
    const { error } = await supabase
      .from('sage_posting_reviews')
      .update({ 
        status: 'approved', 
        reviewed_by: profile?.id, 
        reviewed_at: new Date().toISOString(), 
        updated_at: new Date().toISOString()
      })
      .in('id', approvableIds);
    setActingKey(null);

    if (error) {
      toast.error(`Failed to approve: ${error.message}`);
    } else {
      toast.success(`✅ Approved ${EVENT_LABELS[group.event_type] || group.event_type}${group.reference ? ` — ${group.reference}` : ''}`);
      fetchData(true);
    }
  };

  const handleReject = async () => {
    if (!rejectGroup) return;
    if (!rejectReason.trim()) { toast.error('Please provide a rejection reason'); return; }

    const pendingIds = rejectGroup.lines.filter((l) => l.status === 'pending').map((l) => l.id);
    if (pendingIds.length === 0) { toast.error('No pending lines to reject'); return; }

    setActingKey(rejectGroup.key);
    const { error } = await supabase
      .from('sage_posting_reviews')
      .update({ 
        status: 'rejected', 
        reviewed_by: profile?.id, 
        reviewed_at: new Date().toISOString(), 
        updated_at: new Date().toISOString(),
        sage_result: { rejection_reason: rejectReason, rejected_at: new Date().toISOString() }
      })
      .in('id', pendingIds);
    setActingKey(null);

    if (error) {
      toast.error(`Failed to reject: ${error.message}`);
    } else {
      toast.success(`Rejected package (${pendingIds.length} lines)`);
      setRejectGroup(null);
      setRejectReason('');
      fetchData(true);
    }
  };

  const handleBatchApprove = async () => {
    const pendingGroups = groups.filter((g) => g.status === 'pending' || g.lines.some((l) => l.status === 'pending'));
    if (pendingGroups.length === 0) { toast.error('No pending packages to approve'); return; }

    setBatchApproving(true);
    let successCount = 0;
    for (const group of pendingGroups) {
      const pendingIds = group.lines.filter((l) => l.status === 'pending').map((l) => l.id);
      if (pendingIds.length === 0) continue;
      const { error } = await supabase
        .from('sage_posting_reviews')
        .update({ status: 'approved', reviewed_by: profile?.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('id', pendingIds);
      if (!error) successCount++;
    }
    setBatchApproving(false);
    toast.success(`✅ Approved ${successCount} of ${pendingGroups.length} packages`);
    fetchData(true);
  };

  const pendingLineCount  = reviews.filter((r) => r.status === 'pending').length;
  const pendingGroupCount = groups.filter((g) => g.lines.some((l) => l.status === 'pending')).length;
  const approvedCount     = reviews.filter((r) => r.status === 'approved').length;
  const rejectedCount     = reviews.filter((r) => r.status === 'rejected').length;
  const postedCount       = reviews.filter((r) => r.posted_at).length;
  const totalValue        = reviews.filter((r) => r.status === 'pending').reduce((sum, r) => sum + Number(r.total_value), 0);

  const toggleExpand = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Loading & Access Check ─────────────────────────────────
  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-500">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
          <p className="text-xs font-semibold text-slate-600">Loading Sage Posting Reviews...</p>
        </div>
      </div>
    );
  }

  if (!isFinance) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center max-w-sm">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">Access Restricted</h2>
          <p className="text-sm text-slate-500">You need Finance or Admin access to review Sage postings.</p>
        </div>
      </div>
    );
  }

  // ── Main Page ──────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 p-5 sm:p-6 rounded-2xl text-white shadow-xl relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-teal-500/5 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-indigo-500/20 text-indigo-300 text-xs px-2.5 py-0.5 rounded-full border border-indigo-500/30 font-mono font-medium">Finance Gateway</span>
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              Live Sync
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Sage Posting Review</h1>
          <p className="text-slate-300 text-sm mt-1">Approve or reject transaction packages before they post to Sage 200 Evolution</p>
        </div>
        <div className="relative flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            onClick={() => fetchData(false)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-semibold rounded-xl transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {pendingGroupCount > 0 && (
            <button
              onClick={handleBatchApprove}
              disabled={batchApproving}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-60"
            >
              {batchApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve All ({pendingGroupCount})
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPICard label="Pending Packages" value={pendingGroupCount} icon={Clock}        accent="border-amber-200"  sub="awaiting review" />
        <KPICard label="Pending Lines"    value={pendingLineCount}  icon={Package}      accent="border-slate-200"  sub="individual entries" />
        <KPICard label="Approved Lines"   value={approvedCount}     icon={CheckCircle2} accent="border-blue-200"   sub="ready to post" />
        <KPICard label="Posted to Sage"   value={postedCount}       icon={TrendingUp}   accent="border-emerald-200" sub="in Sage GL/AP/ST" />
        <KPICard label="Pending Value"    value={`$${totalValue.toFixed(2)}`} icon={DollarSign} accent="border-slate-200" sub="under review" />
      </div>

      {/* Filter & Live Search Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wide mr-1">Filter:</span>
          {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                filter === f
                  ? 'bg-slate-900 text-white border-slate-900 shadow'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {f === 'pending' && <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {f === 'approved' && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {f === 'rejected' && <XCircle className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Live Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reference, Sage code, event..."
            className="w-full pl-9 pr-4 py-1.5 border border-slate-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-slate-50/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <span className="text-xs text-slate-400 font-medium shrink-0">
          {filteredGroups.length} package{filteredGroups.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Package List */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 py-20 text-center">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
            <p className="text-sm text-slate-500 mt-3 font-medium">Loading review packages…</p>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 py-20 text-center">
            <ClipboardCheck className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-400">No {filter !== 'all' ? filter : ''} packages found</p>
            <p className="text-xs text-slate-400 mt-1">
              {searchQuery ? 'No reviews matched your search criteria.' : 'All clear — nothing needs attention right now.'}
            </p>
          </div>
        ) : (
          filteredGroups.map((group) => {
            const isOpen    = !!expanded[group.key];
            const hasPending = group.lines.some((l) => l.status === 'pending');
            const codes     = [...new Set(group.lines.map((l) => l.sage_code))].slice(0, 5);
            const moreCodes = group.lineCount - codes.length;
            const ec        = EVENT_COLORS[group.event_type] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' };
            const createdAt = new Date(group.created_at).toLocaleString('en-ZW', { dateStyle: 'medium', timeStyle: 'short' });

            return (
              <div key={group.key} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-shadow hover:shadow-md">

                {/* Package Row */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-4">

                  {/* Left — expand + event info */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(group.key)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="flex items-start gap-3">
                      {/* Expand icon */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${isOpen ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'} transition-colors`}>
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        {/* Event label + badges */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${ec.bg} ${ec.text} ${ec.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ec.dot}`} />
                            {EVENT_LABELS[group.event_type] || group.event_type}
                          </span>
                          <StatusPill group={group} />
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                            {group.lineCount} line{group.lineCount !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {/* Description / Reference */}
                        <p className="text-sm font-semibold text-slate-800 mt-1.5 truncate">
                          {group.event_description || group.reference || '—'}
                          {group.reference && group.event_description ? (
                            <span className="text-slate-400 font-normal"> · {group.reference}</span>
                          ) : null}
                        </p>

                        {/* Sage codes + timestamp */}
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          {codes.map((c) => (
                            <span key={c} className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">{c}</span>
                          ))}
                          {moreCodes > 0 && (
                            <span className="text-[10px] text-slate-400">+{moreCodes} more</span>
                          )}
                          <span className="text-[10px] text-slate-400 ml-auto">{createdAt}</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Right — value + actions */}
                  <div className="flex items-center justify-between lg:justify-end gap-4 lg:pl-2 shrink-0">
                    <div className="text-right">
                      <div className="text-lg font-extrabold text-slate-900 font-mono">${group.totalValue.toFixed(2)}</div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Package Value</div>
                    </div>

                    {hasPending ? (
                      <div className="flex gap-2">
                        <button
                          disabled={actingKey === group.key}
                          onClick={() => approveGroup(group)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-sm shadow-emerald-200 transition-all disabled:opacity-50"
                        >
                          {actingKey === group.key ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          Approve
                        </button>
                        <button
                          disabled={actingKey === group.key}
                          onClick={() => { setRejectGroup(group); setRejectReason(''); }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-red-50 hover:text-red-600 rounded-xl border border-slate-200 transition-all disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </div>
                    ) : group.status === 'rejected' || group.lines.some((l) => l.status === 'rejected') ? (
                      <div className="flex gap-2">
                        <button
                          disabled={actingKey === group.key}
                          onClick={() => approveGroup(group)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-md transition-all disabled:opacity-50"
                        >
                          {actingKey === group.key ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          Re-Approve Package
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Expanded Item Details */}
                {isOpen && (
                  <div className="border-t border-slate-100">
                    <DocumentSummaryPanel summary={documentSummaries[group.sync_event_id]} />
                    <div className="bg-slate-50/80 px-4 py-2 border-b border-slate-100">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Transaction Lines — {group.lineCount} entries</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-100/80 border-b border-slate-200">
                            <th className="text-left px-4 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px]">Sage Code</th>
                            <th className="text-left px-3 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px]">Tx Type</th>
                            <th className="text-right px-3 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px]">Qty</th>
                            <th className="text-right px-3 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px]">Unit Cost</th>
                            <th className="text-right px-3 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px]">Total Value</th>
                            <th className="text-left px-3 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px]">Warehouse</th>
                            <th className="text-left px-3 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px]">Status</th>
                            <th className="text-left px-4 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px]">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.lines.map((r) => (
                            <tr key={r.id} className="hover:bg-white transition-colors">
                              <td className="px-4 py-3 font-mono font-bold text-slate-800">{r.sage_code}</td>
                              <td className="px-3 py-3">
                                <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded border ${TX_COLORS[r.sage_tx_code] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                  {r.sage_tx_code}
                                </span>
                                <div className="text-slate-400 text-[10px] mt-0.5">{TX_LABELS[r.sage_tx_code] || ''}</div>
                              </td>
                              <td className="px-3 py-3 text-right">
                                <span className={`font-mono font-bold ${Number(r.quantity) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                  {Number(r.quantity) > 0 ? '+' : ''}{Number(r.quantity).toLocaleString()}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-slate-600">
                                ${Number(r.unit_cost).toFixed(4)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-bold text-slate-800">
                                ${Number(r.total_value).toFixed(2)}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1.5">
                                  <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                                  <span className="text-slate-600 font-medium">{r.warehouse_code || `ID:${r.warehouse_id}`}</span>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <LinePill status={r.status} posted_at={r.posted_at} />
                                {r.sage_result?.error && (
                                  <div className="text-red-500 text-[10px] mt-0.5 max-w-[140px] truncate" title={r.sage_result.error}>
                                    ⚠ {r.sage_result.error}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-500 max-w-[220px] truncate" title={r.description || ''}>
                                {r.description || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Reject Dialog */}
      <Dialog open={!!rejectGroup} onOpenChange={(open) => !open && setRejectGroup(null)}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          <DialogHeader className="bg-gradient-to-r from-red-600 to-red-700 px-5 py-4">
            <DialogTitle className="text-white font-extrabold flex items-center gap-2">
              <XCircle className="w-5 h-5" /> Reject Package
            </DialogTitle>
          </DialogHeader>
          <div className="p-5 space-y-4">
            {rejectGroup && (
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-wide">Event</span>
                  <span className="font-bold text-slate-800">{EVENT_LABELS[rejectGroup.event_type] || rejectGroup.event_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-wide">Reference</span>
                  <span className="font-mono font-bold text-slate-700">{rejectGroup.reference || '—'}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 mt-2">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-wide">Package Value</span>
                  <span className="font-extrabold text-red-600">${rejectGroup.totalValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-wide">Lines</span>
                  <span className="font-bold text-slate-700">{rejectGroup.lineCount}</span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Rejection Reason *</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this package is being rejected so the operations team can correct it…"
                rows={3}
                className="resize-none border-slate-200 bg-slate-50 focus:border-red-400"
              />
            </div>
          </div>
          <DialogFooter className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex gap-2">
            <button
              onClick={() => setRejectGroup(null)}
              className="flex-1 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleReject}
              className="flex-1 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-colors"
            >
              Reject Package
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
