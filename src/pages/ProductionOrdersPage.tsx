import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, Eye, Play, Check, Package, CheckCircle2, Clock, RefreshCw, Layers, AlertCircle, AlertTriangle, ArrowRight, X, Factory, FileText, CalendarDays, ClipboardList, Activity, Radio } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ProductionOrder, Formulation, Machine as ProductionLine, Profile, ProductionPlan, ProductionLog } from '../types/database';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import StatusBadge from '../components/ui/StatusBadge';
import PackagingDeclaration from '../components/production/PackagingDeclaration';
import StickyOperationsPanel from '../components/layout/StickyOperationsPanel';
import { generateBatchNumber, generateProductionBatchNumber, peekProductionBatchNumber } from '../lib/batchNumberGenerator';
import { bagSizeKg, bagsFromKg, kgFromBags, formatBags } from '../lib/bagUnits';

interface OrderMaterial {
  id: string; 
  raw_material_id: string; 
  planned_qty: number; 
  actual_qty: number;
  wastage_qty: number; 
  unit: string; 
  unit_cost: number; 
  total_cost: number;
  issued: boolean; 
  issued_at?: string;
  issued_by?: string;
  raw_materials?: any;
}

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (() => Promise<void> | void) | null;
}

interface SageIssueStatus {
  status: string;
  message?: string | null;
  sage_response?: any;
  error_details?: any;
  updated_at?: string | null;
}

type SageIssueStatusByOrder = Record<string, SageIssueStatus>;

interface FinishedGoodsTransferStatus {
  id: string;
  transfer_number: string;
  production_order_id: string;
  quantity: number;
  verified_quantity?: number | null;
  verified_bags?: number | null;
  notes?: string | null;
  status: 'pending_finance' | 'pending' | 'posted' | 'failed' | 'cancelled';
  sage_response?: any;
  updated_at?: string | null;
}

type FinishedGoodsTransferStatusByOrder = Record<string, FinishedGoodsTransferStatus>;

// Helper to normalize raw_materials from array to object
const normalizeRawMaterials = (materials: any[]): OrderMaterial[] => {
  return materials.map(m => ({
    ...m,
    raw_materials: Array.isArray(m.raw_materials) && m.raw_materials.length > 0 
      ? m.raw_materials[0] 
      : m.raw_materials
  }));
}

type TabFilter = 'all' | 'pending' | 'materials_issued' | 'in_progress' | 'completed';
const tabs: { key: TabFilter; label: string }[] = [
  { key: 'all', label: 'All' }, 
  { key: 'pending', label: 'Pending' },
  { key: 'materials_issued', label: 'Materials Issued' },
  { key: 'in_progress', label: 'In Progress' }, 
  { key: 'completed', label: 'Completed' },
];

const calculateMaterialCost = (items: OrderMaterial[]) =>
  items.reduce((sum, mat) => sum + ((mat.actual_qty || mat.planned_qty) * (mat.unit_cost || 0)), 0);

// Calculate raw material cost from issued ingredients only
const calculateIssuedMaterialCost = (items: OrderMaterial[]) =>
  items.filter(m => m.issued).reduce((sum, mat) => sum + ((mat.actual_qty || mat.planned_qty) * (mat.unit_cost || 0)), 0);

// Calculate planned cost based on BOM quantities
const calculatePlannedMaterialCost = (items: OrderMaterial[]) =>
  items.reduce((sum, mat) => sum + (mat.planned_qty * (mat.unit_cost || 0)), 0);

// Labour rates per production line (per tonne)
const LABOUR_RATES: Record<string, number> = {
  'Main Plant': 2.78,
  'Dog Plant': 18.02,
  'Samora Mix': 5.00,
  'Red Plant': 25.50,
};

const emptyForm = {
  batch_number: '', 
  plan_id: '', 
  formulation_id: '', 
  machine_id: '', 
  planned_qty: 0, 
  planned_bags: 0,
  unit: 'kg',
  unit_size: '25',
  priority: 'normal' as const, 
  planned_start: '', 
  planned_end: '', 
  operator_id: '', 
  shift: 'Day Shift',
  operators: '',
  labour_force: '',
  week_number: '',
  notes: '',
};

export default function ProductionOrdersPage() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [productionLines, setProductionLines] = useState<ProductionLine[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tab, setTab] = useState<TabFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showEditQty, setShowEditQty] = useState(false);
  const [showFinishedGoodsTransfer, setShowFinishedGoodsTransfer] = useState(false);
  const [finishedGoodsTransferQty, setFinishedGoodsTransferQty] = useState('');
  const [finishedGoodsVerifiedBags, setFinishedGoodsVerifiedBags] = useState('');
  const [finishedGoodsTransferNotes, setFinishedGoodsTransferNotes] = useState('');
  const [productionTransferVerified, setProductionTransferVerified] = useState(false);
  const [financeTransferVerified, setFinanceTransferVerified] = useState(false);
  const [financeTransferReview, setFinanceTransferReview] = useState<FinishedGoodsTransferStatus | null>(null);
  const [finishedGoodsTransferSaving, setFinishedGoodsTransferSaving] = useState(false);
  const [selected, setSelected] = useState<ProductionOrder | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [materials, setMaterials] = useState<OrderMaterial[]>([]);
  const [detailMaterials, setDetailMaterials] = useState<OrderMaterial[]>([]);
  const [editQtyForm, setEditQtyForm] = useState({ planned_qty: 0 });
  const [productionFloorStock, setProductionFloorStock] = useState<Record<string, number>>({});
  const [sageStockBalances, setSageStockBalances] = useState<Record<string, number>>({});
  const [sageStockSyncedAt, setSageStockSyncedAt] = useState<Record<string, string | null>>({});
  const [logs, setLogs] = useState<ProductionLog[]>([]);
  const [detailTab, setDetailTab] = useState<'materials' | 'costing' | 'output' | 'variance' | 'downtime' | 'logs' | 'operations'>('materials');
  const [operations, setOperations] = useState<any[]>([]);
  const [downtimeEntries, setDowntimeEntries] = useState<any[]>([]);
  const [downtimeForm, setDowntimeForm] = useState({ downtime_hours: '', category: 'Mechanical', reason: '' });
  const [labourRatePerTonne, setLabourRatePerTonne] = useState<number>(5.00);
  const [overheadPct, setOverheadPct] = useState<number>(5);
  const [usdZigRate, setUsdZigRate] = useState<number | null>(null);
  const [bomVariances, setBomVariances] = useState<any[]>([]);
  const [costing, setCosting] = useState({ raw_material_cost: 0, labour_cost: 0, production_line_cost: 0, overhead_cost: 0 });
  const [output, setOutput] = useState({ actual_qty: 0, actual_bags: 0, rejected_qty: 0, rejected_bags: 0, wastage_qty: 0, wastage_bags: 0, actual_hours: '' as string, average_throughput: '' as string });
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [bomPreview, setBomPreview] = useState<any[]>([]);
  const [selectedFormulation, setSelectedFormulation] = useState<Formulation | null>(null);
  const [bomPackaging, setBomPackaging] = useState<any[]>([]);
  const [showPkgModal, setShowPkgModal] = useState(false);
  const [pkgBomItems, setPkgBomItems] = useState<any[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    destructive: false,
    onConfirm: null,
  });
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [sageIssueStatus, setSageIssueStatus] = useState<SageIssueStatus | null>(null);
  const [sageCompletionStatus, setSageCompletionStatus] = useState<SageIssueStatus | null>(null);
  const [sageIssueStatuses, setSageIssueStatuses] = useState<SageIssueStatusByOrder>({});
  const [finishedGoodsTransferStatuses, setFinishedGoodsTransferStatuses] = useState<FinishedGoodsTransferStatusByOrder>({});
  const notifiedSageIssueRef = useRef<Record<string, string>>({});
  const notifiedSageCompletionRef = useRef<Record<string, string>>({});
  const notifiedFinishedGoodsTransferRef = useRef<Record<string, string>>({});
  const SAGE_STOCK_MAX_AGE_MINUTES = 120;

  const showSageNotification = useCallback((
    kind: 'processing' | 'success' | 'error',
    title: string,
    detail: string,
  ) => {
    const presentation = {
      processing: {
        icon: <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />,
        iconClass: 'bg-blue-50 border-blue-100',
        labelClass: 'text-blue-700 bg-blue-50 border-blue-100',
        label: 'Sage processing',
        duration: 6000,
      },
      success: {
        icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
        iconClass: 'bg-emerald-50 border-emerald-100',
        labelClass: 'text-emerald-700 bg-emerald-50 border-emerald-100',
        label: 'Sage confirmed',
        duration: 5000,
      },
      error: {
        icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
        iconClass: 'bg-red-50 border-red-100',
        labelClass: 'text-red-700 bg-red-50 border-red-100',
        label: 'Sage attention',
        duration: 9000,
      },
    }[kind];

    toast.custom((notification) => (
      <div className={`w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl transition-all duration-200 ${notification.visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}>
        <div className="flex items-start gap-3 p-3.5">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${presentation.iconClass}`}>
            {presentation.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${presentation.labelClass}`}>{presentation.label}</span>
            </div>
            <p className="text-sm font-bold text-slate-900">{title}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-600">{detail}</p>
          </div>
          <button
            type="button"
            onClick={() => toast.dismiss(notification.id)}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={`h-1 ${kind === 'success' ? 'bg-emerald-500' : kind === 'error' ? 'bg-red-500' : 'bg-blue-500'}`} />
      </div>
    ), { duration: presentation.duration });
  }, []);

  const notifyFinishedGoodsTransferResult = useCallback((transfer: FinishedGoodsTransferStatus) => {
    const key = `${transfer.status}:${transfer.updated_at || ''}`;
    if (notifiedFinishedGoodsTransferRef.current[transfer.id] === key) return;
    notifiedFinishedGoodsTransferRef.current[transfer.id] = key;

    if (transfer.status === 'posted') {
      showSageNotification('success', 'Dispatch transfer posted', `${transfer.transfer_number} has moved from Production to DEB in Sage.`);
    } else if (transfer.status === 'failed') {
      showSageNotification('error', 'Dispatch transfer needs attention', transfer.sage_response?.message || `${transfer.transfer_number} was not posted to Sage. Review the transfer before retrying.`);
    }

    if (typeof window !== 'undefined' && ['posted', 'failed'].includes(transfer.status)) {
      const watchKey = 'sage-finished-goods-transfer-watch';
      if (window.sessionStorage.getItem(watchKey) === transfer.id) window.sessionStorage.removeItem(watchKey);
    }
  }, [showSageNotification]);

  const openConfirmDialog = (config: Omit<ConfirmDialogState, 'open'>) => {
    setConfirmDialog({
      open: true,
      ...config,
    });
  };

  const closeConfirmDialog = () => {
    if (confirmingAction) return;
    setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: null }));
  };

  const openFinishedGoodsTransfer = () => {
    if (!selected || selected.status !== 'completed') return;
    const existing = finishedGoodsTransferStatuses[selected.id];
    if (existing?.status === 'pending_finance' || existing?.status === 'failed') {
      setFinishedGoodsTransferQty(String(existing.verified_quantity || existing.quantity));
      setFinishedGoodsVerifiedBags(String(existing.verified_bags || bagsFromKg(existing.quantity, selected.unit_size)));
      setFinishedGoodsTransferNotes(existing.notes || '');
      setProductionTransferVerified(true);
      setFinanceTransferVerified(false);
      setFinanceTransferReview(existing);
      setWorkflowError(null);
      setShowFinishedGoodsTransfer(true);
      return;
    }
    setFinishedGoodsTransferQty(String(selected.actual_qty || 0));
    setFinishedGoodsVerifiedBags(String(selected.actual_bags || bagsFromKg(selected.actual_qty || 0, selected.unit_size)));
    setFinishedGoodsTransferNotes('');
    setProductionTransferVerified(false);
    setFinanceTransferVerified(false);
    setFinanceTransferReview(null);
    setWorkflowError(null);
    setShowFinishedGoodsTransfer(true);
  };

  const finalizeProductionHandover = async () => {
    if (!selected) return;
    const quantity = Number(finishedGoodsTransferQty);
    if (!selected.formulation_id) {
      setWorkflowError('This batch has no finished-good formulation to transfer.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setWorkflowError('Enter a finished-goods transfer quantity greater than zero.');
      return;
    }
    const verifiedBags = Number(finishedGoodsVerifiedBags);
    const expectedBags = bagsFromKg(quantity, selected.unit_size);
    if (quantity > Number(selected.actual_qty || 0) + 0.001) {
      setWorkflowError('The physical quantity cannot exceed the completed batch output.');
      return;
    }
    if (!Number.isFinite(verifiedBags) || verifiedBags <= 0 || Math.abs(verifiedBags - expectedBags) > 0.001) {
      setWorkflowError(`Physical bag count must match the transfer quantity (${expectedBags.toLocaleString()} bags).`);
      return;
    }
    if (!productionTransferVerified) {
      setWorkflowError('Production must confirm the physical finished-goods count before Finance review.');
      return;
    }
    setFinishedGoodsTransferSaving(true);
    try {
      const transferNumber = await generateBatchNumber('FGT');
      const { error } = await supabase.from('finished_goods_transfers').insert({
        transfer_number: transferNumber,
        production_order_id: selected.id,
        formulation_id: selected.formulation_id,
        quantity,
        unit: selected.unit || 'kg',
        transfer_date: format(new Date(), 'yyyy-MM-dd'),
        notes: finishedGoodsTransferNotes.trim() || null,
        initiated_by: profile?.id || null,
        verified_quantity: quantity,
        verified_bags: verifiedBags,
        production_verified_by: profile?.id || null,
        production_verified_at: new Date().toISOString(),
        status: 'pending_finance',
      });
      if (error) throw error;
      toast.success(`Production handover ${transferNumber} recorded. Finance review is required before Sage posting.`);
      setShowFinishedGoodsTransfer(false);
    } catch (error: any) {
      console.error('Error creating finished-goods transfer:', error);
      setWorkflowError(error?.message || 'Could not queue the finished-goods transfer.');
    } finally {
      setFinishedGoodsTransferSaving(false);
    }
  };

  const approveFinishedGoodsTransfer = async () => {
    if (!financeTransferReview) return;
    if (!financeTransferVerified) {
      setWorkflowError('Finance must confirm the reconciled production handover before Sage posting.');
      return;
    }
    setFinishedGoodsTransferSaving(true);
    try {
      const retryingFailedTransfer = financeTransferReview.status === 'failed';
      const { error } = await supabase
        .from('finished_goods_transfers')
        .update({
          finance_verified_by: profile?.id || null,
          finance_verified_at: new Date().toISOString(),
          status: 'pending',
          sage_response: {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', financeTransferReview.id)
        .in('status', ['pending_finance', 'failed']);
      if (error) throw error;
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('sage-finished-goods-transfer-watch', financeTransferReview.id);
      }
      showSageNotification('processing', retryingFailedTransfer ? 'Retrying dispatch transfer' : 'Dispatch transfer queued', `${financeTransferReview.transfer_number} is queued for Sage PD to DEB posting. MES will confirm the result when the bridge finishes.`);
      toast.success(retryingFailedTransfer
        ? `${financeTransferReview.transfer_number} has been re-queued for Sage posting.`
        : `Finance approved ${financeTransferReview.transfer_number}. Sage transfer is queued.`);
      setShowFinishedGoodsTransfer(false);
    } catch (error: any) {
      console.error('Error approving finished-goods transfer:', error);
      setWorkflowError(error?.message || 'Could not approve the finished-goods transfer.');
    } finally {
      setFinishedGoodsTransferSaving(false);
    }
  };

  const handleConfirmDialog = async () => {
    if (!confirmDialog.onConfirm) return;
    setConfirmingAction(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: null }));
    } catch (error: any) {
      setWorkflowError(error?.message || 'Action failed. Please try again.');
    } finally {
      setConfirmingAction(false);
    }
  };

  // Delete production order with status and admin protection
  const deleteOrder = async (order: ProductionOrder) => {
    // Check if user is admin
    if (profile?.role !== 'admin') {
      setWorkflowError('Access denied — only administrators can delete production orders.');
      return;
    }

    if (order.status !== 'pending') {
      setWorkflowError('Cannot delete — this order has been processed. Only pending orders can be deleted.');
      return;
    }

    openConfirmDialog({
      title: 'Delete Production Order',
      message: `Delete production order ${order.batch_number}? This action cannot be undone.`,
      confirmLabel: 'Delete Order',
      destructive: true,
      onConfirm: async () => {
        setSaving(true);
        try {
          const { error } = await supabase.from('production_orders').delete().eq('id', order.id);
          if (error) throw error;
          setShowDetail(false);
          fetchOrders();
        } catch (error: any) {
          console.error('Error deleting order:', error);
          setWorkflowError(`Failed to delete order: ${error.message}`);
          setSaving(false);
        }
      },
    });
  };

  const getOrderFormulationName = (order: ProductionOrder | null): string => {
    if (!order) return '';
    if (order.formulations?.name) return order.formulations.name;
    if (order.formulation_id) {
      const found = formulations.find((f) => f.id === order.formulation_id);
      if (found?.name) return found.name;
    }
    if ((order as any).product_name) return (order as any).product_name;
    if ((order as any).description) return (order as any).description;
    if (order.notes && !order.notes.trim().startsWith('{')) return order.notes.trim();
    return '';
  };

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    let q = supabase.from('production_orders').select('*, creator:profiles!created_by(full_name, email), operator:profiles!operator_id(full_name, email), formulations(name, code, batch_size, nominal_speed), machines(name, code)').order('created_at', { ascending: false });
    const { data, error } = await q;
    if (error) {
      console.error('Error fetching orders:', error);
      setOrders([]);
    } else {
      setOrders((data as ProductionOrder[]) || []);
    }
    if (!silent) setLoading(false);
  }, [tab, search]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Reconcile the list even when a browser misses a Supabase Realtime event.
  useEffect(() => {
    const interval = window.setInterval(() => { void fetchOrders(true); }, 3000);
    return () => window.clearInterval(interval);
  }, [fetchOrders]);

  const loadSageIssueStatuses = useCallback(async (orderIds: string[]) => {
    if (!orderIds.length) {
      setSageIssueStatuses({});
      return;
    }

    const { data, error } = await supabase
      .from('sync_log')
      .select('reference_id, status, message, sage_response, error_details, updated_at')
      .eq('event_type', 'materials_issued')
      .eq('reference_type', 'production_orders')
      .in('reference_id', orderIds)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error loading Sage issue statuses:', error);
      return;
    }

    const nextStatuses: SageIssueStatusByOrder = {};
    for (const row of data || []) {
      const orderId = (row as any).reference_id;
      if (orderId && !nextStatuses[orderId]) nextStatuses[orderId] = row as SageIssueStatus;
    }
    setSageIssueStatuses(nextStatuses);
  }, []);

  const loadFinishedGoodsTransferStatuses = useCallback(async (orderIds: string[]) => {
    if (!orderIds.length) {
      setFinishedGoodsTransferStatuses({});
      return;
    }
    const { data, error } = await supabase
      .from('finished_goods_transfers')
      .select('id, transfer_number, production_order_id, quantity, verified_quantity, verified_bags, notes, status, sage_response, updated_at')
      .in('production_order_id', orderIds)
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('Error loading finished-goods transfer statuses:', error);
      return;
    }
    const nextStatuses: FinishedGoodsTransferStatusByOrder = {};
    for (const row of data || []) {
      const orderId = (row as any).production_order_id;
      if (orderId && !nextStatuses[orderId]) nextStatuses[orderId] = row as FinishedGoodsTransferStatus;
    }
    setFinishedGoodsTransferStatuses(nextStatuses);
    if (typeof window !== 'undefined') {
      const watchedId = window.sessionStorage.getItem('sage-finished-goods-transfer-watch');
      const watchedTransfer = Object.values(nextStatuses).find((transfer) => transfer.id === watchedId);
      if (watchedTransfer && ['posted', 'failed'].includes(watchedTransfer.status)) notifyFinishedGoodsTransferResult(watchedTransfer);
    }
  }, [notifyFinishedGoodsTransferResult]);

  useEffect(() => {
    const orderIds = orders.map((order) => order.id).filter(Boolean);
    loadSageIssueStatuses(orderIds);
    loadFinishedGoodsTransferStatuses(orderIds);
    const interval = window.setInterval(() => {
      loadSageIssueStatuses(orderIds);
      loadFinishedGoodsTransferStatuses(orderIds);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [orders, loadSageIssueStatuses, loadFinishedGoodsTransferStatuses]);

  const loadSageIssueStatus = useCallback(async (orderId: string, notify = false) => {
    const { data, error } = await supabase
      .from('sync_log')
      .select('status, message, sage_response, error_details, updated_at')
      .eq('event_type', 'materials_issued')
      .eq('reference_type', 'production_orders')
      .eq('reference_id', orderId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error loading Sage material issue status:', error);
      return;
    }

    setSageIssueStatus((data as SageIssueStatus | null) || null);
    if (!notify || !data) return;

    const notificationKey = `${data.status}:${data.updated_at || ''}`;
    if (notifiedSageIssueRef.current[orderId] === notificationKey) return;
    notifiedSageIssueRef.current[orderId] = notificationKey;

    if (data.status === 'success') {
      const reference = data.sage_response?.materialIssue?.reference || 'Sage';
      showSageNotification('success', 'Material issue posted', `${reference} is confirmed in Sage and production can start.`);
    } else if (data.status === 'failed') {
      showSageNotification('error', 'Material issue needs attention', data.message || 'Open the production order to review the Sage response.');
    } else if (data.status === 'pending' || data.status === 'processing') {
      showSageNotification('processing', data.status === 'pending' ? 'Material issue queued' : 'Posting material issue', data.message || 'Sage is processing this production order.');
    }
  }, [showSageNotification]);

  useEffect(() => {
    if (!selected?.id) {
      setSageIssueStatus(null);
      return;
    }

    loadSageIssueStatus(selected.id);
    const interval = window.setInterval(() => loadSageIssueStatus(selected.id, true), 10000);
    return () => window.clearInterval(interval);
  }, [selected?.id, loadSageIssueStatus]);

  const loadSageCompletionStatus = useCallback(async (orderId: string) => {
    const { data, error } = await supabase
      .from('sync_log')
      .select('status, message, sage_response, error_details, updated_at')
      .eq('event_type', 'production_completed')
      .eq('reference_type', 'production_orders')
      .eq('reference_id', orderId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('Error loading Sage completion status:', error);
      return;
    }
    setSageCompletionStatus((data as SageIssueStatus | null) || null);
  }, []);

  useEffect(() => {
    if (!selected?.id) {
      setSageCompletionStatus(null);
      return;
    }
    loadSageCompletionStatus(selected.id);
    const interval = window.setInterval(() => loadSageCompletionStatus(selected.id), 5000);
    return () => window.clearInterval(interval);
  }, [selected?.id, loadSageCompletionStatus]);

  // Keep an open batch reconciled through the final Sage-to-MES handoff even if
  // Realtime is temporarily unavailable in the user's browser.
  useEffect(() => {
    const isFinalizing = selected?.status !== 'completed'
      && ['pending', 'processing', 'success'].includes(sageCompletionStatus?.status || '');
    if (!selected?.id || !isFinalizing) return;

    const refreshCompletion = async () => {
      const { data, error } = await supabase
        .from('production_orders')
        .select('*')
        .eq('id', selected.id)
        .maybeSingle();
      if (!error && data) {
        const updatedOrder = data as ProductionOrder;
        setSelected((current) => current?.id === updatedOrder.id ? { ...current, ...updatedOrder } : current);
        setOrders((current) => current.map((order) => order.id === updatedOrder.id ? { ...order, ...updatedOrder } : order));
      }
      loadSageCompletionStatus(selected.id);
    };

    void refreshCompletion();
    const interval = window.setInterval(refreshCompletion, 1500);
    return () => window.clearInterval(interval);
  }, [selected?.id, selected?.status, sageCompletionStatus?.status, loadSageCompletionStatus]);

  // Keep the production queue current when another MES user, the bridge, or a
  // database workflow changes an order. This removes the need to refresh the
  // browser repeatedly while a batch is being processed.
  useEffect(() => {
    const channel = supabase
      .channel('production-orders-live-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, (payload) => {
        const updatedOrder = payload.new as ProductionOrder;
        if (updatedOrder?.id) {
          setSelected((current) => current?.id === updatedOrder.id ? { ...current, ...updatedOrder } : current);
        }
        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_order_materials' }, () => {
        fetchOrders();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'finished_goods_transfers' }, (payload) => {
        const transfer = payload.new as FinishedGoodsTransferStatus;
        if (!transfer?.production_order_id) return;
        setFinishedGoodsTransferStatuses((current) => ({ ...current, [transfer.production_order_id]: transfer }));
        notifyFinishedGoodsTransferResult(transfer);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_log' }, (payload) => {
        const event = payload.new as any;
        if (event?.reference_type !== 'production_orders') return;

        if (event?.event_type === 'production_completed') {
          const status = {
            status: event.status,
            message: event.message,
            sage_response: event.sage_response,
            error_details: event.error_details,
            updated_at: event.updated_at,
          };
          setSageCompletionStatus((current) => selected?.id === event.reference_id ? status : current);

          const notificationKey = `${event.status}:${event.updated_at || ''}`;
          if (notifiedSageCompletionRef.current[event.reference_id] === notificationKey) return;
          notifiedSageCompletionRef.current[event.reference_id] = notificationKey;

          if (event.status === 'success') {
            showSageNotification('success', 'Finished goods posted', 'Sage confirmed the finished-goods receipt. MES is finalizing the batch now.');
          } else if (event.status === 'failed') {
            showSageNotification('error', 'Finished-goods receipt needs attention', event.message || 'Open the batch to review the Sage response.');
          }
          return;
        }

        if (event.event_type !== 'materials_issued') return;

        setSageIssueStatuses((current) => ({
          ...current,
          [event.reference_id]: {
            status: event.status,
            message: event.message,
            sage_response: event.sage_response,
            error_details: event.error_details,
            updated_at: event.updated_at,
          },
        }));

        const notificationKey = `${event.status}:${event.updated_at || ''}`;
        if (notifiedSageIssueRef.current[event.reference_id] === notificationKey) return;
        notifiedSageIssueRef.current[event.reference_id] = notificationKey;

        if (event.status === 'success') {
          const reference = event.sage_response?.materialIssue?.reference || 'the production order';
          showSageNotification('success', 'Material issue posted', `${reference} is confirmed in Sage and production can start.`);
        } else if (event.status === 'failed') {
          showSageNotification('error', 'Material issue needs attention', event.message || 'Open the production order to review the Sage response.');
        } else if (event.status === 'processing') {
          showSageNotification('processing', 'Posting material issue', event.message || 'Sage is processing this production order.');
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, selected?.id, showSageNotification, notifyFinishedGoodsTransferResult]);

  const renderSageIssueStatus = (order: ProductionOrder, compact = false) => {
    const status = sageIssueStatuses[order.id];
    const className = compact ? 'text-[11px]' : 'text-xs';
    if (!status) {
      if (['materials_issued', 'in_progress', 'completed'].includes(order.status)) {
        return <span className={`${className} font-semibold text-slate-500`}>Awaiting status</span>;
      }
      return <span className={`${className} text-slate-400`}>Not issued</span>;
    }
    if (status.status === 'success') {
      const reference = status.sage_response?.materialIssue?.reference;
      return <span className={`${className} inline-flex items-center gap-1 font-semibold text-emerald-700`} title={reference ? `Posted to Sage as ${reference} (MFDR)` : 'Posted to Sage'}><CheckCircle2 className="w-3.5 h-3.5" />Posted{reference ? ` ${reference}` : ''}</span>;
    }
    if (status.status === 'failed') {
      return <span className={`${className} inline-flex items-center gap-1 font-semibold text-red-700`} title={status.error_details?.message || status.message || 'Sage material issue failed'}><AlertCircle className="w-3.5 h-3.5" />Failed</span>;
    }
    if (status.status === 'processing') {
      return <span className={`${className} inline-flex items-center gap-1 font-semibold text-amber-700`}><RefreshCw className="w-3.5 h-3.5 animate-spin" />Posting</span>;
    }
    return <span className={`${className} inline-flex items-center gap-1 font-semibold text-amber-700`}><Clock className="w-3.5 h-3.5" />Queued</span>;
  };

  const renderOrderStage = (order: ProductionOrder, compact = false) => {
    const transfer = finishedGoodsTransferStatuses[order.id];
    const className = compact ? 'text-[11px]' : 'text-xs';
    if (order.status === 'completed' && transfer?.status === 'posted') {
      return <span className={`${className} inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700`}><CheckCircle2 className="h-3.5 w-3.5" />Transferred to Dispatch</span>;
    }
    if (order.status === 'completed' && transfer?.status === 'pending_finance') {
      return <span className={`${className} inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700`}><Clock className="h-3.5 w-3.5" />Finance Review Required</span>;
    }
    if (order.status === 'completed' && transfer?.status === 'pending') {
      return <span className={`${className} inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-700`}><Clock className="h-3.5 w-3.5" />Dispatch Transfer Queued</span>;
    }
    if (order.status === 'completed' && transfer?.status === 'failed') {
      const errorMessage = transfer.sage_response?.message || 'Sage did not post the PD to DEB transfer.';
      return <span className={`${className} inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700`} title={errorMessage}><AlertTriangle className="h-3.5 w-3.5" />Dispatch Transfer Failed</span>;
    }
    if (order.status === 'completed') {
      return <span className={`${className} inline-flex rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 font-semibold text-teal-700`}>Completed - In Production</span>;
    }
    return <StatusBadge status={order.status} />;
  };

  const selectedSageIssue = selected ? (sageIssueStatus || sageIssueStatuses[selected.id]) : null;
  const canStartProduction = selectedSageIssue?.status === 'success';
  useEffect(() => {
    Promise.all([
      supabase.from('formulations').select('*').eq('status', 'active'),
      supabase.from('machines').select('*').eq('is_active', true),
      supabase.from('profiles').select('*'),
      supabase.from('production_plans').select('*').order('created_at', { ascending: false }),
    ]).then(([f, m, p, pl]) => {
      setFormulations((f.data as Formulation[]) || []);
      setProductionLines((m.data as ProductionLine[]) || []);
      setProfiles((p.data as Profile[]) || []);
      setPlans((pl.data as ProductionPlan[]) || []);
    });
  }, []);

  const openCreate = async () => { 
    const batchNumber = await peekProductionBatchNumber();
    setForm({ ...emptyForm, batch_number: batchNumber }); 
    setMaterials([]); 
    setWorkflowError(null);
    setShowCreate(true); 
  };
  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors';
  const labelCls = 'block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5';

  // Load BOM ingredients when formulation changes (Issue 1)
  const onFormulationChange = async (fid: string) => {
    setForm((f) => ({ ...f, formulation_id: fid }));
    if (!fid) { 
      setMaterials([]);
      setBomPreview([]);
      setBomPackaging([]);
      setSelectedFormulation(null);
      return; 
    }
    const sel = formulations.find((f) => f.id === fid);
    if (!sel) return;
    
    setSelectedFormulation(sel);

    // Auto-set unit size from unit_size_variants or formulation name
    const variants = sel.unit_size_variants;
    let inferredSize: string | null = null;
    if (variants && variants.length > 0) {
      const parsed = parseInt(variants[0].size);
      if (!isNaN(parsed)) inferredSize = String(parsed);
    }
    if (!inferredSize) {
      const m = sel.name.match(/(\d+)\s*kg/i);
      if (m) inferredSize = m[1];
    }
    if (inferredSize) setForm(f => ({ ...f, unit_size: inferredSize! }));

    // Check if BOM exists for this formulation
    const [bomResult, packagingResult] = await Promise.all([
      supabase
        .from('formulation_ingredients')
        .select('*, raw_materials(name, code, cost_per_unit, current_stock)')
        .eq('formulation_id', fid)
        .eq('is_active', true),
      supabase
        .from('production_bom_packaging')
        .select('*')
        .eq('formulation_id', fid),
    ]);
    const { data: bomData, error: bomError } = bomResult;
    setBomPackaging(packagingResult.data || []);
    
    if (bomError || !bomData || bomData.length === 0) {
      setWorkflowError(`No BOM ingredients found for ${sel.name}. Please set up the BOM first.`);
      setMaterials([]);
      setBomPreview([]);
      return;
    }
    
    setWorkflowError(null);
    const scale = form.planned_qty > 0 ? form.planned_qty / sel.batch_size : 1;
    const materials = bomData.map((ing: any) => ({
      id: ing.id, 
      raw_material_id: ing.raw_material_id,
      planned_qty: Math.round(ing.quantity * scale * 100) / 100, 
      actual_qty: 0, 
      wastage_qty: 0,
      unit: ing.unit, 
      unit_cost: ing.raw_materials?.cost_per_unit || 0,
      total_cost: Math.round(ing.quantity * scale * (ing.raw_materials?.cost_per_unit || 0) * 100) / 100,
      issued: false, 
      raw_materials: ing.raw_materials,
    }));
    setMaterials(materials);
    
    // Formula quantities are stored against the approved formula batch size.
    // Never assume a fixed 50kg recipe: a 1,000kg formula must remain a 1,000kg recipe.
    const preview = bomData.map((ing: any, idx: number) => ({
      index: idx + 1,
      code: ing.raw_materials?.code || '-',
      name: ing.raw_materials?.name || '-',
      bomPercent: Number(ing.percentage) || Math.round((ing.quantity / sel.batch_size) * 10000) / 100,
      quantity: ing.quantity,
      unitCost: ing.raw_materials?.cost_per_unit || 0,
    }));
    setBomPreview(preview);
  };

  const createOrder = async () => {
    // Validate production line is required (Issue 3)
    if (!form.machine_id || form.machine_id === '') {
      setWorkflowError('Production Line selection is required. Every batch must be assigned to a specific production line.');
      return;
    }

    // Validate planned_qty is provided
    if (!form.planned_qty || form.planned_qty <= 0) {
      setWorkflowError('Planned Quantity must be greater than 0.');
      return;
    }

    if (!form.formulation_id) {
      setWorkflowError('Select an approved formulation before creating a production order.');
      return;
    }

    setSaving(true);
    try {
      // Finance control: a work order must be based on an approved formula whose
      // standard ingredient quantities reconcile to its declared batch size.
      const [{ data: formulation, error: formulationError }, { data: ingredients, error: ingredientsError }] = await Promise.all([
        supabase.from('formulations').select('batch_size, status').eq('id', form.formulation_id).single(),
        supabase.from('formulation_ingredients').select('quantity, is_active').eq('formulation_id', form.formulation_id),
      ]);
      if (formulationError) throw formulationError;
      if (ingredientsError) throw ingredientsError;
      if (formulation.status !== 'active') {
        throw new Error('This formulation is awaiting Finance approval and cannot be used for a work order yet.');
      }
      const ingredientTotal = (ingredients || [])
        .filter((ingredient) => ingredient.is_active !== false)
        .reduce((sum, ingredient) => sum + Number(ingredient.quantity || 0), 0);
      const batchSize = Number(formulation.batch_size || 0);
      if (ingredientTotal <= 0 || Math.abs(ingredientTotal - batchSize) > 0.01) {
        throw new Error(`Formula mass balance is invalid: BOM ingredients total ${ingredientTotal.toFixed(4)} kg but the approved batch is ${batchSize.toFixed(4)} kg. Ask Finance to review the formula before creating this order.`);
      }

      // Ensure planned_qty is a valid number and not multiplied
      const plannedQty = parseFloat(String(form.planned_qty));
      
      // Generate official batch number only on actual form submission
      const officialBatchNumber = await generateProductionBatchNumber();

      // Debug: Log form data before submission
      console.log('Creating order with form data:', {
        batch_number: officialBatchNumber,
        formulation_id: form.formulation_id,
        machine_id: form.machine_id,
        planned_qty: plannedQty,
        status: 'pending'
      });
      
      const { error } = await supabase.from('production_orders').insert({
        batch_number: officialBatchNumber,
        plan_id: form.plan_id || null,
        formulation_id: form.formulation_id || null,
        machine_id: form.machine_id, // Required field - NOT NULL in database
        planned_qty: plannedQty, 
        planned_bags: Number(form.planned_bags || bagsFromKg(plannedQty, form.unit_size)),
        unit: 'kg',
        unit_size: form.unit_size,
        priority: form.priority, 
        planned_start: form.planned_start || null,
        planned_end: form.planned_end || null, 
        operator_id: form.operator_id || null,
        created_by: profile?.id || null,
        shift: form.shift,
        operators: form.operators || null,
        labour_force: form.labour_force === '' ? null : Number(form.labour_force),
        week_number: form.week_number === '' ? null : Number(form.week_number),
        notes: form.notes, 
        status: 'pending',
      });

      if (error) throw error;

      // BOM ingredients will be auto-loaded by the database trigger
      setSaving(false); 
      setShowCreate(false); 
      fetchOrders();
    } catch (error: any) {
      console.error('Error creating order:', error);
      setWorkflowError(`Failed to create production order: ${error.message}`);
      setSaving(false);
    }
  };

  const loadBomVariances = async (orderId: string) => {
    try {
      const { data, error } = await supabase
        .rpc('calculate_bom_variance', { p_production_order_id: orderId });
      
      if (error) throw error;
      setBomVariances(data || []);
    } catch (error) {
      console.error('Error loading BOM variances:', error);
    }
  };

  const loadProductionFloorStock = async (materialIds: string[]) => {
    if (!materialIds.length) {
      setProductionFloorStock({});
      return;
    }

    const { data, error } = await supabase
      .from('stock_movements')
      .select('raw_material_id, quantity')
      .eq('movement_type', 'production_input')
      .in('raw_material_id', materialIds);

    if (error) {
      console.error('Error loading production floor stock:', error);
      return;
    }

    const stockMap: Record<string, number> = {};
    for (const row of data || []) {
      const materialId = (row as any).raw_material_id;
      const quantity = Number((row as any).quantity || 0);
      stockMap[materialId] = (stockMap[materialId] || 0) + quantity;
    }

    setProductionFloorStock(stockMap);
  };

  const loadSageStockBalances = async (materialIds: string[]) => {
    if (!materialIds.length) {
      setSageStockBalances({});
      setSageStockSyncedAt({});
      return;
    }

    const { data, error } = await supabase
      .from('sage_stock_balances')
      .select('raw_material_id, quantity, last_synced_at')
      .eq('warehouse_id', 19) // Production warehouse in Sage: material issues are posted from PD.
      .in('raw_material_id', materialIds);

    if (error) {
      console.error('Error loading Sage stock balances:', error);
      return;
    }

    const stockMap: Record<string, number> = {};
    const syncedMap: Record<string, string | null> = {};
    for (const row of data || []) {
      const materialId = (row as any).raw_material_id;
      const quantity = Number((row as any).quantity || 0);
      stockMap[materialId] = quantity;
      syncedMap[materialId] = (row as any).last_synced_at || null;
    }

    setSageStockBalances(stockMap);
    setSageStockSyncedAt(syncedMap);
  };

  const isSageRowFresh = (syncedAt?: string | null) => {
    if (!syncedAt) return true; // Graceful default
    const syncedMs = new Date(syncedAt).getTime();
    if (Number.isNaN(syncedMs)) return true;
    const ageMinutes = (Date.now() - syncedMs) / (1000 * 60);
    return ageMinutes <= SAGE_STOCK_MAX_AGE_MINUTES;
  };

  const runSageIssuePreflight = async (materialsToCheck: OrderMaterial[]) => {
    const pendingMaterials = materialsToCheck.filter((m) => !m.issued);
    if (pendingMaterials.length === 0) {
      return { ok: true as const };
    }

    const materialIds = Array.from(new Set(pendingMaterials.map((m) => m.raw_material_id).filter(Boolean)));
    
    // Query Sage stock balances
    const { data: sageData, error: sageStockError } = await supabase
      .from('sage_stock_balances')
      // `quantity` is the canonical bridge balance column. Querying the
      // retired `quantity_on_hand` field caused Supabase to reject the whole
      // request, then the UI silently fell back to MES zero balances.
      .select('raw_material_id, quantity, last_synced_at')
      .eq('warehouse_id', 19)
      .in('raw_material_id', materialIds);

    if (sageStockError) {
      throw new Error(`Unable to read Sage Production balances: ${sageStockError.message}`);
    }

    // Query raw_materials current stock as fallback
    const { data: rmData } = await supabase
      .from('raw_materials')
      .select('id, name, code, current_stock, unit')
      .in('id', materialIds);

    const stockMap: Record<string, number> = {};
    const syncedMap: Record<string, string | null> = {};
    const rmStockMap: Record<string, number> = {};

    for (const row of sageData || []) {
      const materialId = (row as any).raw_material_id;
      if (materialId) {
        stockMap[materialId] = Number((row as any).quantity ?? 0);
        syncedMap[materialId] = (row as any).last_synced_at || null;
      }
    }

    for (const row of rmData || []) {
      if (row.id) {
        rmStockMap[row.id] = Number(row.current_stock || 0);
      }
    }

    setSageStockBalances(stockMap);
    setSageStockSyncedAt(syncedMap);

    const insufficient: string[] = [];

    for (const material of pendingMaterials) {
      const name = material.raw_materials?.name || material.raw_material_id;
      const unit = material.unit || 'kg';
      const required = normalizeQty(material.planned_qty);
      
      const sageVal = stockMap[material.raw_material_id];
      const mesVal = rmStockMap[material.raw_material_id] ?? Number(material.raw_materials?.current_stock || 0);
      
      // Use Sage balance if available, otherwise fallback to MES stock
      const available = normalizeQty(typeof sageVal === 'number' && sageVal > 0 ? sageVal : mesVal);

      if (available + 0.001 < required) {
        insufficient.push(`${name} (required: ${formatQty(required)} ${unit}, available: ${formatQty(available)} ${unit})`);
      }
    }

    if (insufficient.length > 0) {
      return {
        ok: false as const,
        message: `Cannot issue materials — insufficient stock: ${insufficient.join('; ')}. Please restock before proceeding.`,
      };
    }

    return { ok: true as const };
  };

  const getAvailableStock = (material: OrderMaterial) => {
    const sageQty = sageStockBalances[material.raw_material_id];
    if (typeof sageQty === 'number' && sageQty > 0) return sageQty;
    
    const floorQty = productionFloorStock[material.raw_material_id];
    if (typeof floorQty === 'number' && floorQty > 0) return floorQty;
    
    return Number(material.raw_materials?.current_stock || 0);
  };

  const normalizeQty = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
  const formatQty = (value: number) => normalizeQty(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const hasSufficientStock = (material: OrderMaterial) => {
    const available = normalizeQty(getAvailableStock(material));
    const required = normalizeQty(material.planned_qty);
    return available + 0.001 >= required;
  };

  const openDetail = async (order: ProductionOrder) => {
    setSelected(order);
    setSageIssueStatus(null);
    setCosting({ raw_material_cost: order.raw_material_cost, labour_cost: order.labour_cost, production_line_cost: order.machine_cost, overhead_cost: order.overhead_cost });
    setOutput({
      actual_qty: order.actual_qty,
      actual_bags: Number(order.actual_bags ?? bagsFromKg(order.actual_qty, order.unit_size)),
      rejected_qty: order.rejected_qty,
      rejected_bags: Number(order.rejected_bags ?? bagsFromKg(order.rejected_qty, order.unit_size)),
      wastage_qty: order.wastage_qty,
      wastage_bags: Number(order.wastage_bags ?? bagsFromKg(order.wastage_qty, order.unit_size)),
      actual_hours: order.actual_hours != null ? String(order.actual_hours) : '',
      average_throughput: order.average_throughput != null ? String(order.average_throughput) : '',
    });
    setDetailTab(order.status === 'completed' ? 'output' : 'materials');

    // Fire all independent queries in parallel instead of sequentially awaiting each one
    const [
      { data: opsData },
      { data },
      { data: logData },
      { data: downtimeData },
      { data: rateRows },
      { data: ohRow },
      { data: fxRow },
    ] = await Promise.all([
      supabase
        .from('production_operations')
        .select('*, profiles!operator_id(full_name), machines(name)')
        .eq('production_order_id', order.id)
        .order('seq_no', { ascending: true }),
      supabase
        .from('production_order_materials')
        .select('id, production_order_id, raw_material_id, planned_qty, actual_qty, wastage_qty, unit, unit_cost, total_cost, issued, issued_at, issued_by, created_at, raw_materials(id, name, code, cost_per_unit, current_stock)')
        .eq('production_order_id', order.id),
      supabase.from('production_logs').select('*').eq('production_order_id', order.id).order('started_at', { ascending: true }),
      supabase.from('production_order_downtime').select('*').eq('production_order_id', order.id).order('created_at', { ascending: true }),
      order.formulation_id
        ? supabase
            .from('labour_rates')
            .select('rate_per_tonne_usd')
            .eq('formulation_id', order.formulation_id)
            .order('effective_date', { ascending: false })
            .limit(1)
        : Promise.resolve({ data: null } as any),
      supabase.from('cost_settings').select('value').eq('key', 'overhead_rate_percent').maybeSingle(),
      supabase.from('usd_zig_rate_history').select('rate').order('effective_date', { ascending: false }).limit(1).maybeSingle(),
    ]);

    setOperations(opsData || []);

    const mats = normalizeRawMaterials((data as any[]) || []);
    setDetailMaterials(mats);
    // Calculate raw material cost from issued ingredients only
    setCosting((prev) => ({ ...prev, raw_material_cost: calculateIssuedMaterialCost(mats) }));

    setLogs((logData as ProductionLog[]) || []);

    setDowntimeEntries(downtimeData || []);
    setDowntimeForm({ downtime_hours: '', category: 'Mechanical', reason: '' });

    // Resolve labour rate per tonne for this formulation (latest effective_date) + overhead %
    let ratePerTonne = 5.00;
    if (rateRows && rateRows.length > 0) ratePerTonne = Number(rateRows[0].rate_per_tonne_usd) || 5.00;
    setLabourRatePerTonne(ratePerTonne);

    const ohPct = ohRow?.value != null ? Number(ohRow.value) : 5;
    setOverheadPct(ohPct);

    // Latest USD:ZiG FX rate for dual-currency display
    setUsdZigRate(fxRow?.rate ? Number(fxRow.rate) : null);

    // These depend on the materials list resolved above, so run after
    await Promise.all([
      loadProductionFloorStock(mats.map((m) => m.raw_material_id).filter(Boolean)),
      loadSageStockBalances(mats.map((m) => m.raw_material_id).filter(Boolean)),
      order.status === 'completed' ? loadBomVariances(order.id) : Promise.resolve(),
    ]);

    // Auto-seed Labour/Overhead if the order hasn't stored values yet (treat 0/null as unset)
    const actualTonnes = (order.actual_qty || 0) / 1000;
    const autoLabour = actualTonnes > 0 ? Math.round(actualTonnes * ratePerTonne * 100) / 100 : 0;
    const rmCost = calculateIssuedMaterialCost(mats);
    const autoOverhead = rmCost > 0 ? Math.round(rmCost * (ohPct / 100) * 100) / 100 : 0;
    setCosting((prev) => ({
      ...prev,
      labour_cost: order.labour_cost > 0 ? order.labour_cost : autoLabour,
      overhead_cost: order.overhead_cost > 0 ? order.overhead_cost : autoOverhead,
    }));
    setWorkflowError(null);
    setShowDetail(true);
  };

  // The completion action owns output persistence, so the Sage receipt always
  // uses the exact quantities currently shown to the production clerk.
  const recordCompletionOutput = async (order: ProductionOrder) => {
    const { data: existing, error: existingError } = await supabase
      .from('production_outputs')
      .select('id')
      .eq('production_order_id', order.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    const payload = {
      production_order_id: order.id,
      quantity_produced: output.actual_qty,
      quantity_bags: output.actual_bags,
      rejected_quantity: output.rejected_qty,
      rejected_bags: output.rejected_bags,
      wastage_quantity: output.wastage_qty,
      wastage_bags: output.wastage_bags,
      bag_size_kg: bagSizeKg(order.unit_size),
      unit: order.unit,
      recorded_at: new Date().toISOString(),
      recorded_by: profile?.id || null,
    };

    const result = existing
      ? await supabase.from('production_outputs').update(payload).eq('id', existing.id)
      : await supabase.from('production_outputs').insert(payload);
    if (result.error) throw result.error;
  };

  // Issue individual ingredient (Issue 4)
  const issueIndividualIngredient = async (material: OrderMaterial) => {
    if (!selected) return;
    
    setSaving(true);
    try {
      // Hard gate: validate Sage stock freshness and quantity before issue
      const preflight = await runSageIssuePreflight([material]);
      if (!preflight.ok) {
        throw new Error(preflight.message);
      }

      // Call the database function to issue individual ingredient
      const { error } = await supabase.rpc('issue_individual_ingredient', {
        p_material_id: material.id,
        p_actual_qty: material.planned_qty,
        p_issued_by: profiles.find(p => p.email === 'admin@hyperfeeds.com')?.id || null
      });

      if (error) throw error;

      // Update unit_cost and total_cost from raw materials
      const unitCost = Math.round((material.raw_materials?.cost_per_unit || 0) * 10000) / 10000;
      const totalCost = Math.round((material.planned_qty * unitCost) * 10000) / 10000;
      
      console.log('DEBUG: Issuing ingredient', {
        materialId: material.id,
        materialName: material.raw_materials?.name,
        rawMaterialsObj: material.raw_materials,
        unitCost,
        plannedQty: material.planned_qty,
        totalCost
      });
      
      console.log('DEBUG: About to update material', {
        materialId: material.id,
        updatePayload: { unit_cost: unitCost, total_cost: totalCost }
      });

      const { error: updateError, data: updateData } = await supabase.from('production_order_materials').update({
        unit_cost: unitCost,
        total_cost: totalCost
      }).eq('id', material.id);
      
      console.log('DEBUG: Update response', { error: updateError, data: updateData });
      
      if (updateError) {
        console.error('ERROR updating unit_cost:', {
          message: updateError.message,
          code: updateError.code,
          details: updateError.details,
          hint: updateError.hint,
          fullError: updateError
        });
        throw updateError;
      }

      // Record as a stock movement so Material Transfer page reflects it
      const { error: movementError } = await supabase.from('stock_movements').insert({
        movement_type: 'production_input',
        raw_material_id: material.raw_material_id,
        quantity: -Math.abs(material.planned_qty),
        unit: 'kg',
        notes: `Issued to production order ${selected.batch_number}`,
        reference_type: 'production_order',
        reference_id: selected.id,
        batch_number: selected.batch_number,
        movement_date: new Date().toISOString(),
      });

      if (movementError) {
        console.error('ERROR recording stock movement:', movementError);
        // Don't throw - stock movement is secondary to the main issuance
      }

      // Auto-link to DRS issues
      await supabase.from('rm_daily_issues').insert({
        issue_date: new Date().toISOString().split('T')[0],
        raw_material_name: material.raw_materials?.name || 'Unknown',
        quantity_kg: material.planned_qty,
        production_order_ref: selected.batch_number,
      });

      // Refresh materials - add small delay to ensure database is updated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const { data: refreshedData } = await supabase
        .from('production_order_materials')
        .select('id, production_order_id, raw_material_id, planned_qty, actual_qty, wastage_qty, unit, unit_cost, total_cost, issued, issued_at, issued_by, created_at, raw_materials(id, name, code, cost_per_unit, current_stock)')
        .eq('production_order_id', selected.id);
      
      const refreshed = normalizeRawMaterials((refreshedData as any[]) || []);
      console.log('DEBUG: Refreshed materials after issue', refreshed);
      setDetailMaterials(refreshed);
      await Promise.all([
        loadProductionFloorStock(refreshed.map((m) => m.raw_material_id).filter(Boolean)),
        loadSageStockBalances(refreshed.map((m) => m.raw_material_id).filter(Boolean)),
      ]);
      setCosting((prev) => ({ ...prev, raw_material_cost: calculateIssuedMaterialCost(refreshed) }));
      
      setSaving(false);
    } catch (error: any) {
      console.error('Error issuing ingredient:', error);
      setWorkflowError(`Failed to issue ingredient: ${error.message}`);
      setSaving(false);
    }
  };

  // Check if all ingredients are issued
  const allIngredientsIssued = () => {
    return detailMaterials.length > 0 && detailMaterials.every(m => m.issued);
  };

  // Check if all materials have sufficient stock available
  const allMaterialsAvailable = () => {
    const pendingMaterials = detailMaterials.filter((m) => !m.issued);
    if (pendingMaterials.length === 0) return true;
    return pendingMaterials.every((m) => hasSufficientStock(m));
  };

  // Get list of materials with insufficient stock
  const getInsufficientMaterials = () => {
    return detailMaterials.filter(m => 
      !m.issued && !hasSufficientStock(m)
    );
  };

  // Bulk issue all materials at once
  const bulkIssueMaterials = async () => {
    if (!selected) return;
    openConfirmDialog({
      title: 'Issue All Materials',
      message: `Issue all ${detailMaterials.length} materials for this production order? This cannot be undone.`,
      confirmLabel: 'Issue Materials',
      destructive: false,
      onConfirm: async () => {
        setSaving(true);
        try {
          // Hard gate: query Sage balances directly before issue (no stale React-state dependency)
          const preflight = await runSageIssuePreflight(detailMaterials);
          if (!preflight.ok) {
            throw new Error(preflight.message);
          }

          // Issue all materials in parallel via RPC (RPC handles unit_cost and total_cost atomically)
          const issuePromises = detailMaterials.map(material =>
            supabase.rpc('issue_individual_ingredient', {
              p_material_id: material.id,
              p_actual_qty: material.planned_qty,
              p_issued_by: profiles.find(p => p.email === 'admin@hyperfeeds.com')?.id || null
            })
          );

          const results = await Promise.all(issuePromises);
          
          // Check for errors
          const errors = results.filter(r => r.error);
          if (errors.length > 0) {
            const errorMessages = errors.map((r, i) => `Item ${i + 1}: ${r.error?.message}`).join('; ');
            throw new Error(`Failed to issue ${errors.length} of ${results.length} ingredients: ${errorMessages}`);
          }

          // (stock_movements rows are already created inside issue_individual_ingredient RPC — no duplicate insert)

          // Now update order status to materials_issued
          await updateStatus('materials_issued');

          // Auto-link to DRS issues
          const issueEntries = detailMaterials.map((m) => ({
            issue_date: new Date().toISOString().split('T')[0],
            raw_material_name: m.raw_materials?.name || 'Unknown',
            quantity_kg: m.planned_qty,
            production_order_ref: selected.batch_number,
          }));
          await supabase.from('rm_daily_issues').insert(issueEntries);

          setSaving(false);
        } catch (error: any) {
          console.error('Error bulk issuing materials:', error);
          setWorkflowError(`Failed to issue materials: ${error.message}`);
          setSaving(false);
        }
      },
    });
  };

  // Edit production quantity and recalculate BOM
  const handleEditQuantity = async () => {
    if (!selected) return;
    const newQty = editQtyForm.planned_qty;
    if (newQty <= 0) {
      setWorkflowError('Quantity must be greater than 0');
      return;
    }
    if (newQty === selected.planned_qty) {
      setShowEditQty(false);
      return;
    }

    setSaving(true);
    try {
      const ratio = newQty / selected.planned_qty;
      
      // Update production order
      const { error: orderError } = await supabase
        .from('production_orders')
        .update({ planned_qty: newQty })
        .eq('id', selected.id);
      
      if (orderError) throw orderError;

      // Recalculate BOM quantities proportionally
      const updatePromises = detailMaterials.map(material => {
        const newPlannedQty = Math.round(material.planned_qty * ratio * 100) / 100;
        return supabase
          .from('production_order_materials')
          .update({ 
            planned_qty: newPlannedQty,
            total_cost: newPlannedQty * (material.unit_cost || 0)
          })
          .eq('id', material.id);
      });

      await Promise.all(updatePromises);
      
      // Reload the order detail to show updated BOM quantities
      const { data: updatedOrder } = await supabase
        .from('production_orders')
        .select('*, formulations(*), machines(*), profiles(*)')
        .eq('id', selected.id)
        .single();
      
      if (updatedOrder) {
        setSelected(updatedOrder);
        // Reload materials with updated quantities
        const { data: updatedMaterials } = await supabase
          .from('production_order_materials')
          .select('*, raw_materials(*)')
          .eq('production_order_id', selected.id);
        if (updatedMaterials) {
          setDetailMaterials(normalizeRawMaterials(updatedMaterials));
        }
      }
      
      setShowEditQty(false);
      await fetchOrders();
      setSaving(false);
    } catch (error: any) {
      console.error('Error editing quantity:', error);
      setWorkflowError(`Failed to update quantity: ${error.message}`);
      setSaving(false);
    }
  };

  const openEditQtyModal = () => {
    if (!selected) return;
    setEditQtyForm({ planned_qty: selected.planned_qty });
    setShowEditQty(true);
  };

  const [refreshingStock, setRefreshingStock] = useState(false);

  // Refresh Sage stock balances for current order
  const refreshSageStock = async (showToast = true) => {
    if (!selected || detailMaterials.length === 0) return;
    if (showToast) setRefreshingStock(true);
    try {
      const materialIds = detailMaterials.map(m => m.raw_material_id);
      await loadSageStockBalances(materialIds);

      // Re-fetch raw_materials to update current_stock in detailMaterials state
      const { data: rmData } = await supabase
        .from('raw_materials')
        .select('id, name, code, current_stock, cost_per_unit, unit')
        .in('id', materialIds);

      if (rmData && rmData.length > 0) {
        const rmMap = new Map(rmData.map(r => [r.id, r]));
        setDetailMaterials(prev => prev.map(m => {
          const freshRm = rmMap.get(m.raw_material_id);
          return freshRm ? { ...m, raw_materials: { ...m.raw_materials, ...freshRm } } : m;
        }));
      }

      // Clear stale error message banner when refreshed
      setWorkflowError(null);

      if (showToast) {
        toast.success('Stock balances refreshed');
      }
    } catch (err: any) {
      console.error('Error refreshing Sage stock:', err);
      if (showToast) {
        toast.error('Failed to refresh stock balances');
      }
    } finally {
      if (showToast) setRefreshingStock(false);
    }
  };

  // Auto-refresh Sage stock when order detail loads
  useEffect(() => {
    if (selected && detailMaterials.length > 0) {
      refreshSageStock(false);
    }
  }, [selected?.id, detailMaterials.length]);

  // The bridge publishes a balance update after each Sage post. Keep an open
  // production order aligned with it instead of leaving a stale stock warning
  // on screen after a material transfer completes.
  useEffect(() => {
    if (!selected || detailMaterials.length === 0) return;

    const materialIds = new Set(detailMaterials.map((material) => material.raw_material_id).filter(Boolean));
    const channel = supabase
      .channel(`production-order-sage-stock-${selected.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sage_stock_balances' }, (payload) => {
        const balance = payload.new as { raw_material_id?: string; warehouse_id?: number };
        if (balance?.warehouse_id !== 19 || !balance.raw_material_id || !materialIds.has(balance.raw_material_id)) return;
        loadSageStockBalances([...materialIds]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selected?.id, detailMaterials]);

  // Keep the detail current even when a Realtime connection is unavailable.
  useEffect(() => {
    if (!selected || detailMaterials.length === 0) return;
    
    const interval = setInterval(() => {
      refreshSageStock(false);
    }, 5000);

    return () => clearInterval(interval);
  }, [selected?.id, detailMaterials.length]);

  /* ── Production completion with packaging ── */
  async function handleCompletionRequest() {
    if (!selected) return;
    if (selected.status !== 'in_progress') {
      setWorkflowError('Cannot complete — production must be in progress.');
      return;
    }
    if (sageCompletionStatus?.status === 'pending' || sageCompletionStatus?.status === 'processing') {
      setWorkflowError('Sage finished-goods posting is already in progress. Please wait for Sage confirmation.');
      return;
    }
    if (sageCompletionStatus?.status === 'success') {
      setWorkflowError('Sage has already posted this finished-goods receipt. MES is finalizing the batch.');
      return;
    }
    if (sageCompletionStatus?.status === 'failed') {
      setWorkflowError('The previous Sage completion attempt needs review before it can be retried.');
      return;
    }
    const currentActual = output.actual_qty || selected.actual_qty || 0;
    if (currentActual <= 0) {
      setWorkflowError('Cannot complete — enter actual output quantity in Output tab first.');
      return;
    }
    setShowPkgModal(true);
  }

  async function handlePkgConfirm(lines: any[]) {
    setShowPkgModal(false);
    await updateStatus('completed', lines);
  }

  // Enforce workflow sequence (Issue 2)
  const updateStatus = async (status: string, pkgActuals: any[] = [], pkgNotes: string = '') => {
    if (!selected) return;
    setWorkflowError(null);
    setSaving(true);
    
    try {
      const updates: any = { status };
      
      // Validate workflow sequence
      if (status === 'materials_issued') {
        if (detailMaterials.length === 0) {
          throw new Error('Cannot issue materials — no ingredients linked to this order. Please set up the BOM for this formulation first.');
        }
        // Note: bulkIssueMaterials will handle issuing all ingredients before calling this
      }
      
      if (status === 'in_progress') {
        if (selected.status !== 'materials_issued') {
          throw new Error('Cannot start production — materials must be issued first. Please issue all ingredients before starting production.');
        }
        const { data: latestSageIssue, error: sageIssueError } = await supabase
          .from('sync_log')
          .select('status, message, updated_at')
          .eq('event_type', 'materials_issued')
          .eq('reference_type', 'production_orders')
          .eq('reference_id', selected.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sageIssueError) {
          throw new Error(`Cannot start production — unable to confirm Sage material issue: ${sageIssueError.message}`);
        }
        if (latestSageIssue?.status !== 'success') {
          const reason = latestSageIssue?.status === 'failed'
            ? `Sage material issue failed: ${latestSageIssue.message || 'resolve the Sage error and retry the issue.'}`
            : 'Sage material issue is still queued or posting.';
          throw new Error(`Cannot start production — ${reason}`);
        }
        updates.actual_start = new Date().toISOString();
      }
      
      if (status === 'completed') {
        if (selected.status !== 'in_progress') {
          throw new Error('Cannot complete production order — production must be in progress first. Please start production before completing.');
        }
        if (output.actual_qty <= 0) {
          throw new Error('Cannot complete production order — actual output quantities must be recorded first. Please enter production outputs in the Output tab.');
        }

        const { data: latestCompletion, error: completionError } = await supabase
          .from('sync_log')
          .select('status, message')
          .eq('event_type', 'production_completed')
          .eq('reference_type', 'production_orders')
          .eq('reference_id', selected.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (completionError) throw new Error(`Cannot check Sage completion status: ${completionError.message}`);
        if (latestCompletion?.status === 'pending' || latestCompletion?.status === 'processing') {
          throw new Error('Sage finished-goods posting is already queued or processing. Wait for its result before completing again.');
        }
        if (latestCompletion?.status === 'failed') {
          throw new Error(`Sage finished-goods posting failed: ${latestCompletion.message || 'review the Sage error before retrying.'}`);
        }
        
        // Production Line cost deprecated (double-counted labour). Labour card holds the authoritative per-tonne labour cost.
        const total = costing.raw_material_cost + costing.labour_cost + costing.overhead_cost;
        Object.assign(updates, {
          ...costing,
          production_line_cost: 0,
          machine_cost: 0,
          actual_qty: output.actual_qty,
          actual_bags: output.actual_bags,
          rejected_qty: output.rejected_qty,
          rejected_bags: output.rejected_bags,
          wastage_qty: output.wastage_qty,
          wastage_bags: output.wastage_bags,
          actual_hours: output.actual_hours === '' ? null : Number(output.actual_hours),
          average_throughput: output.average_throughput === '' ? null : Number(output.average_throughput),
          total_cost: Math.round(total * 100) / 100,
          cost_per_unit: output.actual_qty > 0 ? Math.round((total / output.actual_qty) * 10000) / 10000 : 0,
          // Keep the batch In Progress until the bridge confirms its MFMF
          // finished-goods receipt. The bridge is the only actor that marks it completed.
          status: 'in_progress',
          actual_end: null
        });
      }

      const { error } = await supabase.from('production_orders').update(updates).eq('id', selected.id);
      if (error) throw error;

      if (status === 'completed') {
        await recordCompletionOutput(selected);
      }

      if (status === 'materials_issued') {
        setSageIssueStatus({
          status: 'pending',
          message: 'Materials issued in MES. The Sage material issue has been queued.',
        });
        showSageNotification('processing', 'Material issue queued', 'Materials are issued in MES. Sage will confirm the issue before production can start.');
        window.setTimeout(() => loadSageIssueStatus(selected.id, true), 1500);
      }

      // Record stock movement for completed orders
      if (status === 'completed' && output.actual_qty > 0) {
        await supabase.from('stock_movements').insert([{
          movement_type: 'production_output',
          formulation_id: selected.formulation_id,
          quantity: output.actual_qty,
          unit: selected.unit,
          notes: 'Production output recorded',
          reference_type: 'production_order',
          reference_id: selected.id,
          batch_number: selected.batch_number,
          movement_date: new Date().toISOString()
        }]);
      }

      // Save packaging declaration for completed orders
      if (status === 'completed' && pkgActuals.length > 0) {
        const pkgData = pkgActuals
          .filter(a => a.packaging_sku_id && a.bags_used > 0)
          .map(a => ({
            production_order_id: selected.id,
            packaging_sku_id: a.packaging_sku_id,
            bags_used: a.bags_used,
            implied_tonnes: a.implied_tonnes || 0,
          }));
        if (pkgData.length > 0) {
          await supabase.from('batch_packaging_used').insert(pkgData);
        }
      }

      // Write sync_log entry for bridge to pick up on batch completion
      if (status === 'completed') {
        const { error: syncError } = await supabase
          .from('sync_log')
          .insert({
            event_type: 'production_completed',
            reference_type: 'production_orders',
            reference_id: selected.id,
            status: 'pending',
            description: `Batch completed — ${selected.batch_number}`,
            message: `Production completion queued. Please wait while Sage posts the finished-goods receipt; MES will complete this batch automatically once Sage confirms it.`,
            created_at: new Date().toISOString(),
          });
        if (syncError) {
          console.error('sync_log write failed:', syncError.message);
          // Don't throw — order is completed, bridge will need manual retry
        }
      }

      if (status === 'completed') {
        setSageCompletionStatus({
          status: 'pending',
          message: 'Production completion queued. Please wait while Sage posts the finished-goods receipt; MES will complete this batch automatically once Sage confirms it.',
        });
        showSageNotification('processing', 'Finished goods queued', 'Sage is posting the finished-goods receipt. MES will complete this batch automatically once it is confirmed.');
      }
      setSaving(false); 
      if (status !== 'completed') setShowDetail(false);
      fetchOrders();
    } catch (error: any) {
      console.error('Error updating status:', error);
      setWorkflowError(error.message);
      setSaving(false);
    }
  };

  const filtered = orders.filter((o) => {
    if (tab !== 'all' && o.status !== tab) return false;
    if (!search.trim()) return true;
    return o.batch_number.toLowerCase().includes(search.toLowerCase());
  });

  const totalOrders = orders.length;
  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const inProgressCount = orders.filter(o => o.status === 'in_progress').length;
  const completedCount = orders.filter(o => o.status === 'completed').length;
  const materialsIssuedCount = orders.filter(o => o.status === 'materials_issued').length;
  const activeOrders = orders.filter(o => ['materials_issued', 'in_progress'].includes(o.status));
  const plannedCompletedQuantity = orders.filter(o => o.status === 'completed').reduce((sum, order) => sum + Number(order.planned_qty || 0), 0);
  const actualCompletedQuantity = orders.filter(o => o.status === 'completed').reduce((sum, order) => sum + Number(order.actual_qty || 0), 0);
  const outputAttainment = plannedCompletedQuantity > 0 ? Math.round((actualCompletedQuantity / plannedCompletedQuantity) * 100) : 0;
  const lineWorkload = Object.entries(activeOrders.reduce<Record<string, ProductionOrder[]>>((byLine, order) => {
    const line = order.machines?.name || 'Unassigned line';
    (byLine[line] ||= []).push(order);
    return byLine;
  }, {})).sort(([, a], [, b]) => b.length - a.length).slice(0, 4);
  const activeSagePosts = Object.values(sageIssueStatuses).filter((status) => ['pending', 'processing'].includes(status.status)).length;
  const selectedFinishedGoodsTransfer = selected ? finishedGoodsTransferStatuses[selected.id] : null;
  const sageCompletionInFlight = sageCompletionStatus?.status === 'pending' || sageCompletionStatus?.status === 'processing';
  const sageCompletionPosted = sageCompletionStatus?.status === 'success';
  const sageCompletionFailed = sageCompletionStatus?.status === 'failed';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">
      <StickyOperationsPanel>
        <section className="overflow-hidden rounded-lg border border-[#0d2036] bg-[#0d2036] text-white shadow-lg shadow-slate-900/20">
          <div className="flex flex-col gap-5 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[#f39200]/70 bg-[#f39200]/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#ffc36b]">Production control</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300"><Radio className="h-3 w-3" /> Sage connected</span>
            </div>
            <h1 className="mt-3 text-2xl font-bold">Production Orders</h1>
            <p className="mt-1 text-sm text-slate-300">Live execution board for batches, material staging, and finished-goods completion.</p>
          </div>
          <button onClick={openCreate} className="inline-flex shrink-0 items-center justify-center gap-2 bg-[#f39200] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-black/20 transition-colors hover:bg-[#dc8500]">
            <Plus className="w-5 h-5" /> Create Production Order
          </button>
          </div>
          <div className="grid border-t border-white/10 sm:grid-cols-2 xl:grid-cols-4">
          <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Order book</p><Layers className="h-4 w-4 text-teal-300" /></div><p className="mt-2 text-3xl font-bold">{totalOrders}</p><p className="mt-1 text-xs text-slate-400">Registered batches</p></div>
          <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Awaiting issue</p><Clock className="h-4 w-4 text-[#ffc36b]" /></div><p className="mt-2 text-3xl font-bold text-[#ffc36b]">{pendingCount}</p><p className="mt-1 text-xs text-slate-400">Ready for material staging</p></div>
          <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">On the floor</p><Activity className="h-4 w-4 text-cyan-300" /></div><p className="mt-2 text-3xl font-bold text-cyan-300">{activeOrders.length}</p><p className="mt-1 text-xs text-slate-400">{materialsIssuedCount} staged · {inProgressCount} running</p></div>
          <div className="px-5 py-4"><div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Completed</p><CheckCircle2 className="h-4 w-4 text-emerald-300" /></div><p className="mt-2 text-3xl font-bold text-emerald-300">{completedCount}</p><p className="mt-1 text-xs text-slate-400">Finished batches</p></div>
          </div>
        </section>
      </StickyOperationsPanel>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:grid-cols-[1.15fr_0.9fr_1fr]">
        <div className="border-l-4 border-[#f39200] bg-[#fffaf1] px-4 py-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Output attainment</p><p className="text-xl font-bold text-[#0d2036]">{outputAttainment}%</p></div><div className="mt-2 h-2 overflow-hidden bg-amber-100"><div className={`h-full ${outputAttainment >= 100 ? 'bg-emerald-500' : 'bg-[#f39200]'}`} style={{ width: `${Math.min(100, outputAttainment)}%` }} /></div><p className="mt-2 text-xs text-slate-600">{actualCompletedQuantity.toLocaleString()} of {plannedCompletedQuantity.toLocaleString()} kg completed</p></div>
        <div className="flex items-center justify-between gap-4 border border-slate-100 px-4 py-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Live line</p><p className="mt-1 text-sm font-bold text-[#0d2036]">{lineWorkload.length ? lineWorkload.map(([line, lineOrders]) => `${line}: ${lineOrders.length}`).join(' · ') : 'No line activity'}</p><p className="mt-1 text-xs text-slate-500">{inProgressCount} running · {materialsIssuedCount} staged</p></div><Factory className="h-5 w-5 shrink-0 text-teal-600" /></div>
        <div className="flex items-center justify-between gap-4 border border-slate-100 px-4 py-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Workflow focus</p><p className="mt-1 text-sm font-bold text-[#0d2036]">{pendingCount ? `${pendingCount} batch${pendingCount === 1 ? '' : 'es'} need material issue` : activeOrders.length ? `${activeOrders.length} batch${activeOrders.length === 1 ? '' : 'es'} running on the floor` : 'No outstanding batches'}</p><p className="mt-1 text-xs text-slate-500">{activeSagePosts ? `${activeSagePosts} Sage action${activeSagePosts === 1 ? '' : 's'} processing` : 'Sage queue clear'}</p></div><ArrowRight className="h-5 w-5 shrink-0 text-[#f39200]" /></div>
      </section>

      {/* Filter & Search Bar */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-white p-3.5">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-all shrink-0 ${
                    tab === t.key
                      ? 'bg-slate-900 text-white shadow'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="relative max-w-sm w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search batch number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Package className="w-12 h-12 mb-3 text-slate-300" />
            <p className="text-sm font-medium">No production orders found matching filter</p>
          </div>
        ) : (
          <div>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/70">
                    <th className="text-left px-4 py-3.5 font-bold text-slate-700">Batch Number</th>
                    <th className="text-left px-4 py-3.5 font-bold text-slate-700">Formulation</th>
                    <th className="text-left px-4 py-3.5 font-bold text-slate-700">Production Line</th>
                    <th className="text-right px-4 py-3.5 font-bold text-slate-700">Planned Qty</th>
                    <th className="text-right px-4 py-3.5 font-bold text-slate-700">Actual Qty</th>
                    <th className="text-left px-4 py-3.5 font-bold text-slate-700">Status</th>
                    <th className="text-left px-4 py-3.5 font-bold text-slate-700">Sage</th>
                    <th className="text-center px-4 py-3.5 font-bold text-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-mono font-bold text-slate-900">{order.batch_number}</div>
                        {order.profiles?.full_name && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            Created by <span className="font-medium text-slate-700">{order.profiles.full_name}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-800">{order.formulations?.name || '-'}</div>
                        <div className="text-xs text-slate-400 font-mono">{order.formulations?.code}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-slate-700 font-medium">{order.machines?.name || '-'}</div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-800">
                        {formatBags(order.planned_qty, order.unit_size)} bags <span className="text-[10px] text-slate-400">({order.planned_qty.toLocaleString()} kg)</span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-800">
                        {order.actual_qty ? <>{formatBags(order.actual_qty, order.unit_size)} bags <span className="text-[10px] text-slate-400">({order.actual_qty.toLocaleString()} kg)</span></> : '-'}
                      </td>
                      <td className="px-4 py-3.5">
                        {renderOrderStage(order)}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {renderSageIssueStatus(order)}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center">
                          <button
                            onClick={() => openDetail(order)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg transition-colors"
                            title="Manage Batch Order"
                          >
                            <Eye className="w-3.5 h-3.5 text-teal-600" />
                            Manage
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Grid View */}
            <div className="block md:hidden divide-y divide-slate-100">
              {filtered.map((order) => (
                <div key={order.id} className="p-4 space-y-3 bg-white hover:bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-extrabold bg-slate-900 text-white px-2.5 py-1 rounded">
                      {order.batch_number}
                    </span>
                    {renderOrderStage(order, true)}
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-900 text-base">{order.formulations?.name || 'Production Batch'}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">Line: {order.machines?.name || 'Main Plant'}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg text-xs font-mono">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Planned</span>
                      <span className="font-bold text-slate-800">{formatBags(order.planned_qty, order.unit_size)} bags <span className="text-[10px] text-slate-400">({order.planned_qty} kg)</span></span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Actual</span>
                      <span className="font-bold text-slate-800">{formatBags(order.actual_qty || 0, order.unit_size)} bags <span className="text-[10px] text-slate-400">({order.actual_qty || 0} kg)</span></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Sage material issue</span>
                    {renderSageIssueStatus(order, true)}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-[11px] text-slate-400">
                      {order.profiles?.full_name ? `Operator: ${order.profiles.full_name}` : ''}
                    </span>
                    <button
                      onClick={() => openDetail(order)}
                      className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Manage Order
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create Order Modal */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-[1320px] w-[98vw] h-[94vh] max-h-[94vh] p-0 sm:!max-w-[1320px] flex flex-col [&>button.absolute]:hidden">
          <div className="shrink-0 border-b bg-slate-900 text-white px-5 py-3 rounded-t-lg relative">
            <div className="flex items-center justify-between pr-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-500 rounded-lg flex items-center justify-center shadow-lg">
                  <Factory className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">Create Production Order</h2>
                  <p className="text-slate-400 text-xs">Set up batch details, scheduling and review the BOM before submitting</p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/15 text-white border border-white/20">Draft</span>
            </div>
            <button
              onClick={() => setShowCreate(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 bg-gradient-to-b from-slate-200/80 via-slate-100 to-slate-300/70 space-y-4">
          {workflowError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center gap-2 text-red-800">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm font-medium">{workflowError}</span>
              </div>
            </div>
          )}

          {/* Top Summary Cards Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-500/10 via-emerald-500/5 to-white p-4 shadow-sm flex items-center gap-3.5 relative overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-teal-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-teal-500/20">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal-800">Expected Output</p>
                <p className="text-2xl font-black text-slate-900 font-mono tracking-tight mt-0.5">
                  {Number(form.planned_qty || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-semibold text-teal-700">kg</span>
                </p>
                <p className="text-[11px] font-medium text-slate-500">{(Number(form.planned_qty || 0) / 1000).toFixed(3)} Tonnes</p>
              </div>
            </div>

            <div className="rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-white p-4 shadow-sm flex items-center gap-3.5 relative overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-500/20">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-blue-800">Estimated Bags</p>
                <p className="text-2xl font-black text-slate-900 font-mono tracking-tight mt-0.5">
                  {Math.ceil(Number(form.planned_qty || 0) / (parseInt(form.unit_size, 10) || 50) || 0)} <span className="text-xs font-semibold text-blue-700">Bags</span>
                </p>
                <p className="text-[11px] font-medium text-slate-500">Bag Unit Size: {form.unit_size || 50} kg</p>
              </div>
            </div>

            <div className="rounded-2xl border border-purple-200/80 bg-gradient-to-br from-purple-500/10 via-slate-500/5 to-white p-4 shadow-sm flex items-center gap-3.5 relative overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-purple-500/20">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-purple-800">BOM Ingredients</p>
                <p className="text-2xl font-black text-slate-900 font-mono tracking-tight mt-0.5">
                  {bomPreview.length} <span className="text-xs font-semibold text-purple-700">Raw Items</span>
                </p>
                <p className="text-[11px] font-medium text-slate-500">Auto-scaled to batch size</p>
              </div>
            </div>
          </div>

          {/* Core Order Setup Card */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center font-bold text-xs">1</div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Primary Production Batch Details</h3>
              </div>
              <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-3 py-1 rounded-full border border-teal-200">
                Auto-Sequenced
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Batch Sequence #</label>
                <div className="relative">
                  <input
                    type="text"
                    value={form.batch_number}
                    onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                    className={`${inputCls} font-mono font-bold bg-slate-50 text-teal-900 border-teal-300`}
                    required
                    readOnly
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-teal-600 bg-teal-100 px-2 py-0.5 rounded">
                    LOCKED
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>Product Formulation * (Finance Activated Only)</label>
                {(() => {
                  const activeIds: string[] = JSON.parse(localStorage.getItem('daily_active_formulations') || '[]');
                  const dailyActiveFormulations = formulations.filter(
                    f => activeIds.includes(f.id) || (f as any).is_daily_active === true
                  );

                  return (
                    <div>
                      <select
                        value={form.formulation_id}
                        onChange={(e) => onFormulationChange(e.target.value)}
                        className={`${inputCls} font-bold text-slate-900 focus:ring-2 focus:ring-teal-500`}
                        required
                      >
                        <option value="">Select Finance-Activated formulation for today's run...</option>
                        {dailyActiveFormulations.map((f) => (
                          <option key={f.id} value={f.id}>
                            ✨ {f.code} — {f.name} (v{f.version}) [Finance Active Today]
                          </option>
                        ))}
                      </select>
                      {dailyActiveFormulations.length === 0 && (
                        <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                          <p className="font-bold">🔒 No Formulations Currently Active for Today</p>
                          <p>Finance (Jonga) has not activated any BOM versions on the Formulations page for today's run. Please ask Finance to set active BOMs.</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className={labelCls}>Production Line *</label>
                <select
                  value={form.machine_id}
                  onChange={(e) => setForm({ ...form, machine_id: e.target.value })}
                  className={`${inputCls} font-medium ${!form.machine_id ? 'border-amber-300 bg-amber-50/50' : 'border-slate-300'}`}
                  required
                >
                  <option value="">Select production line (required)</option>
                  {productionLines.map((m) => (
                    <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Planned Output (Bags) *</label>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={form.planned_bags || ''}
                    onChange={(e) => {
                      const plannedBags = parseFloat(e.target.value) || 0;
                      setForm({ ...form, planned_bags: plannedBags, planned_qty: kgFromBags(plannedBags, form.unit_size), unit: 'kg' });
                    }}
                    className={`${inputCls} font-mono font-bold text-base pr-16`}
                    required
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                    bags
                  </div>

                </div>
                <p className="mt-1 text-[11px] text-slate-500">Sage stock quantity: {Number(form.planned_qty || 0).toLocaleString()} kg</p>
              </div>

              <div>
                <label className={labelCls}>Sage / Stock Unit</label>
                <div className={`${inputCls} bg-slate-50 text-slate-600`}>Kilograms (stored automatically)</div>
              </div>

              <div>
                <label className={labelCls}>Bag Unit Size (kg)</label>
                <select
                  value={form.unit_size}
                  onChange={(e) => {
                    const unitSize = e.target.value;
                    setForm({ ...form, unit_size: unitSize, planned_qty: kgFromBags(form.planned_bags, unitSize), unit: 'kg' });
                  }}
                  className={`${inputCls} font-bold`}
                >
                  <option value="50">50 kg Bag</option>
                  <option value="25">25 kg Bag</option>
                  <option value="20">20 kg Bag</option>
                  <option value="10">10 kg Bag</option>
                  <option value="5">5 kg Bag</option>
                </select>
              </div>
            </div>
          </div>

          {/* Scheduling & Workforce Card */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center font-bold text-xs">2</div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Scheduling, Shift & Workforce Allocation</h3>
              </div>
              <span className="text-xs font-semibold text-slate-500">Optional Shift Setup</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
                  className={inputCls}
                >
                  <option value="normal">Normal Priority</option>
                  <option value="high">High Priority</option>
                  <option value="urgent">Urgent</option>
                  <option value="low">Low Priority</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Plant Operator</label>
                <select
                  value={form.operator_id}
                  onChange={(e) => setForm({ ...form, operator_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">Select operator</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Shift</label>
                <select
                  value={form.shift}
                  onChange={(e) => setForm({ ...form, shift: e.target.value })}
                  className={inputCls}
                >
                  <option value="Day Shift">Day Shift (07:00 – 17:00)</option>
                  <option value="Night Shift">Night Shift (17:00 – 05:00)</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Planned Start Date</label>
                <input
                  type="date"
                  value={form.planned_start}
                  onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Planned End Date</label>
                <input
                  type="date"
                  value={form.planned_end}
                  onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Labour Force (Crew)</label>
                <input
                  type="number"
                  min="0"
                  value={form.labour_force}
                  onChange={(e) => setForm({ ...form, labour_force: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. 5 workers"
                />
              </div>
            </div>
          </div>

          {bomPreview.length > 0 && selectedFormulation && (
            <div className="space-y-3 rounded-2xl border border-slate-300/70 bg-slate-50/95 shadow-sm p-4">
              {(() => {
                const premixLines = bomPreview.filter((ingredient: any) =>
                  /premix/i.test(`${ingredient.code || ''} ${ingredient.name || ''}`)
                );
                const premixKg = premixLines.reduce((sum: number, ingredient: any) =>
                  sum + ((Number(ingredient.quantity) || 0) / Number(selectedFormulation.batch_size || 1)) * Number(form.planned_qty || 0), 0
                );
                return (
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-teal-600" />
                  <h3 className="text-sm font-semibold text-slate-800">BOM Preview — Scaled to Planned Quantity</h3>
                </div>
                <div className="flex items-center gap-2">
                  {premixLines.length > 0 && (
                    <Badge className="bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200 text-[11px]">
                      Premix: {premixKg.toFixed(2)} kg
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[11px] border-teal-300 text-teal-700">{selectedFormulation.code} · {selectedFormulation.name}</Badge>
                </div>
              </div>
                );
              })()}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-teal-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-slate-700">#</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-700">Code</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-700">Ingredient Name</th>
                        <th className="px-3 py-2 text-right font-medium text-slate-700">BOM %</th>
                        <th className="px-3 py-2 text-right font-medium text-slate-700">Per Bag (kg)</th>
                        <th className="px-3 py-2 text-right font-medium text-slate-700">Batch Qty (kg)</th>
                        <th className="px-3 py-2 text-right font-medium text-slate-700">Unit Cost</th>
                        <th className="px-3 py-2 text-right font-medium text-slate-700">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bomPreview.map((ing: any) => {
                        const bagSize = bagSizeKg(form.unit_size, 50);
                        const qtyPerBag = (Number(ing.quantity) / Number(selectedFormulation.batch_size || 1)) * bagSize;
                        const qtyRequired = (Number(ing.quantity) / Number(selectedFormulation.batch_size || 1)) * Number(form.planned_qty || 0);
                        const lineTotal = qtyRequired * ing.unitCost;
                        const isPremix = /premix/i.test(`${ing.code || ''} ${ing.name || ''}`);
                        return (
                          <tr key={ing.index} className={`hover:bg-slate-50 ${isPremix ? 'bg-fuchsia-50/60' : ''}`}>
                            <td className="px-3 py-2 text-slate-600">{ing.index}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{ing.code}</td>
                            <td className="px-3 py-2 text-slate-700">
                              <span className="inline-flex items-center gap-2">
                                {ing.name}
                                {isPremix && <Badge className="bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200 text-[10px] px-1.5 py-0">Premix</Badge>}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">{ing.bomPercent.toFixed(2)}%</td>
                            <td className="px-3 py-2 text-right font-medium text-teal-700">{qtyPerBag.toFixed(4)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{qtyRequired.toFixed(4)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">${ing.unitCost.toFixed(4)}</td>
                            <td className="px-3 py-2 text-right font-medium text-slate-800">${lineTotal.toFixed(4)}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-teal-50 font-medium">
                        <td colSpan={4} className="px-3 py-2 text-right text-slate-700">Total:</td>
                        <td className="px-3 py-2 text-right text-teal-800">{bagSizeKg(form.unit_size, 50).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-slate-800">{form.planned_qty.toFixed(2)}</td>
                        <td colSpan={2} className="px-3 py-2 text-right text-slate-800">
                          ${bomPreview.reduce((sum: number, ing: any) => {
                            const qtyRequired = (Number(ing.quantity) / Number(selectedFormulation.batch_size || 1)) * Number(form.planned_qty || 0);
                            return sum + (qtyRequired * ing.unitCost);
                          }, 0).toFixed(4)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(() => {
                  const totalCost = bomPreview.reduce((sum: number, ing: any) => {
                    const qtyRequired = (Number(ing.quantity) / Number(selectedFormulation.batch_size || 1)) * Number(form.planned_qty || 0);
                    return sum + (qtyRequired * ing.unitCost);
                  }, 0);
                  const bagSize = parseInt(form.unit_size) || 25;
                  const numBags = Math.ceil(form.planned_qty / bagSize);
                  const costPerBag = numBags > 0 ? totalCost / numBags : 0;
                  const costPerKg = form.planned_qty > 0 ? totalCost / form.planned_qty : 0;
                  
                  return (
                    <>
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-xs font-medium text-green-700 mb-1">Expected Output</div>
                        <div className="text-sm font-semibold text-green-900">{form.planned_qty.toFixed(2)} kg</div>
                        <div className="text-xs text-green-600 mt-1">{numBags} × {bagSize}kg bags</div>
                      </div>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="text-xs font-medium text-blue-700 mb-1">Cost per Bag</div>
                        <div className="text-sm font-semibold text-blue-900">${costPerBag.toFixed(2)}</div>
                      </div>
                      <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="text-xs font-medium text-purple-700 mb-1">Cost per kg</div>
                        <div className="text-sm font-semibold text-purple-900">${costPerKg.toFixed(2)}</div>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-wide text-amber-900">Packaging linked to {selectedFormulation.code}</p>
                    <p className="text-[11px] text-amber-800">This formula's packaging requirements scale with the production order.</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-amber-900">{Number(form.planned_bags || bagsFromKg(form.planned_qty, form.unit_size)).toLocaleString()} bags</span>
                </div>
                {bomPackaging.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {bomPackaging.map((item: any) => {
                      const expectedQty = (Number(item.expected_qty_per_tonne || 0) / 1000) * Number(form.planned_qty || 0);
                      return <div key={item.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs">
                        <p className="font-bold text-slate-800">{item.item_code} — {item.description}</p>
                        <p className="mt-1 text-slate-600">Expected: <strong>{expectedQty.toFixed(4)} {item.unit}</strong></p>
                      </div>;
                    })}
                  </div>
                ) : <p className="text-xs text-amber-800">No packaging SKU is linked yet. Finance can add it on the Packaging tab of this formula.</p>}
              </div>
            </div>
          )}
          </div>

          <div className="shrink-0 flex justify-end gap-2 border-t bg-white px-5 py-3">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={createOrder}
              disabled={saving || !form.machine_id}
              className="px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Order'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Quantity Modal */}
      <Dialog open={showEditQty} onOpenChange={setShowEditQty}>
        <DialogContent className="max-w-md">
          <h3 className="text-lg font-semibold mb-4">Edit Production Quantity</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Current Quantity</label>
              <div className="text-lg font-bold text-slate-800">{selected?.planned_qty?.toLocaleString()} kg</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Quantity (kg)</label>
              <input
                type="number"
                value={editQtyForm.planned_qty}
                onChange={(e) => setEditQtyForm({ planned_qty: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                min="1"
              />
              <p className="text-xs text-slate-500 mt-1">BOM quantities will be recalculated proportionally</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={() => setShowEditQty(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleEditQuantity}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Updating...' : 'Update Quantity'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showFinishedGoodsTransfer} onOpenChange={setShowFinishedGoodsTransfer}>
        <DialogContent className="max-w-md p-0 overflow-hidden [&>button.absolute]:hidden">
          <div className="bg-slate-950 px-5 py-4 text-white flex items-center justify-between">
            <div>
              <h2 className="text-base font-extrabold">Transfer Finished Goods</h2>
              <p className="text-xs text-slate-300 mt-0.5">Production (PD) to Dispatch (DEB)</p>
            </div>
            <button onClick={() => setShowFinishedGoodsTransfer(false)} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs text-teal-950">
              <div className="font-bold">{financeTransferReview?.status === 'failed' ? 'Finance retry review' : financeTransferReview ? 'Finance release review' : 'Production stock handover'}</div>
              <p className="mt-1">{selected?.formulations?.name || 'Finished goods'} from <span className="font-mono font-bold">{selected?.batch_number}</span> moves only after the physical count is reconciled and Finance releases it.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="block text-slate-500">Production stock</span><strong>{Number(selected?.actual_qty || 0).toLocaleString()} kg</strong></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="block text-slate-500">Packed stock</span><strong>{Number(selected?.actual_bags || bagsFromKg(selected?.actual_qty || 0, selected?.unit_size)).toLocaleString()} bags</strong></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Physical kg for handover</label><input type="number" min="0.001" step="0.001" value={finishedGoodsTransferQty} onChange={(event) => setFinishedGoodsTransferQty(event.target.value)} className={inputCls} disabled={Boolean(financeTransferReview)} /></div>
              <div><label className={labelCls}>Physical bag count</label><input type="number" min="0.001" step="0.001" value={finishedGoodsVerifiedBags} onChange={(event) => setFinishedGoodsVerifiedBags(event.target.value)} className={inputCls} disabled={Boolean(financeTransferReview)} /><p className="mt-1 text-[11px] text-slate-500">Expected: {bagsFromKg(Number(finishedGoodsTransferQty || 0), selected?.unit_size).toLocaleString()} bags</p></div>
            </div>
            <div><label className={labelCls}>Count-sheet, pallet, or variance reference</label><textarea value={finishedGoodsTransferNotes} onChange={(event) => setFinishedGoodsTransferNotes(event.target.value)} rows={2} className={inputCls} placeholder="Optional traceability note" disabled={Boolean(financeTransferReview)} /></div>
            {financeTransferReview ? (
              <label className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-950 cursor-pointer">
                <input type="checkbox" checked={financeTransferVerified} onChange={(event) => setFinanceTransferVerified(event.target.checked)} className="mt-0.5" />
                <span>{financeTransferReview?.status === 'failed' ? 'Finance confirms the physical handover remains correct and authorizes a retry of the same Sage PD to DEB transfer.' : 'Finance confirms this physical handover agrees with the completed production quantity and authorizes Sage posting from PD to DEB.'}</span>
              </label>
            ) : (
              <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950 cursor-pointer">
                <input type="checkbox" checked={productionTransferVerified} onChange={(event) => setProductionTransferVerified(event.target.checked)} className="mt-0.5" />
                <span>Production confirms the physical stock above is on hand in PD and ready for Finance verification.</span>
              </label>
            )}
          </div>
          <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
            <button onClick={() => setShowFinishedGoodsTransfer(false)} disabled={finishedGoodsTransferSaving} className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg">Cancel</button>
            <button onClick={financeTransferReview ? approveFinishedGoodsTransfer : finalizeProductionHandover} disabled={finishedGoodsTransferSaving || (financeTransferReview ? !financeTransferVerified : !productionTransferVerified)} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
              <ArrowRight className="w-4 h-4" /> {finishedGoodsTransferSaving ? 'Saving...' : financeTransferReview?.status === 'failed' ? 'Finance Approve & Retry Sage' : financeTransferReview ? 'Finance Approve & Queue Sage' : 'Finalize Production Handover'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Detail Modal - Redesigned modern layout */}
      <Dialog open={showDetail} onOpenChange={() => setShowDetail(false)}>
        <DialogContent className="max-w-[1280px] w-[96vw] max-h-[94vh] p-0 overflow-hidden flex flex-col sm:!max-w-[1280px] [&>button.absolute]:hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-teal-950 text-white px-6 py-4 flex-shrink-0 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-emerald-500/5 pointer-events-none" />
            <button
              onClick={() => setShowDetail(false)}
              className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 border border-white/20 flex items-center justify-center transition-colors z-10"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white" />
            </button>
            <div className="relative flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-teal-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-teal-500/30">
                <Factory className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-extrabold tracking-tight font-mono">{selected?.batch_number}</h2>
                  {selected && renderOrderStage(selected)}
                  {downtimeEntries.length > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full">
                      <Clock className="w-3 h-3" />
                      {downtimeEntries.reduce((s, d) => s + Number(d.downtime_hours || 0), 0).toFixed(2)}h downtime
                    </span>
                  )}
                </div>
                <p className="text-slate-300 text-xs mt-1 truncate">
                  <span className="font-semibold text-white">{getOrderFormulationName(selected) || 'Production Order'}</span> • Line: <span className="font-semibold text-white">{selected?.machines?.name || 'Main Plant'}</span> • Bag size: {selected?.unit_size || '50'}kg
                  {((selected as any)?.creator?.full_name || (selected as any)?.operator?.full_name) && (
                    <span className="text-slate-400"> • Initiated by {(selected as any)?.creator?.full_name || (selected as any)?.operator?.full_name || (selected as any)?.creator?.email}</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {selected && (
            <div className="flex-1 overflow-y-auto bg-slate-50">
              {/* Error Banner */}
              {workflowError && (
                <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <div className="flex items-center gap-2 text-red-800">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-xs font-semibold">{workflowError}</span>
                  </div>
                </div>
              )}

              {sageIssueStatus && (
                <div className={`mx-4 mt-3 p-3 border rounded-xl flex items-start gap-3 ${
                  sageIssueStatus.status === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : sageIssueStatus.status === 'failed'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}>
                  {sageIssueStatus.status === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : sageIssueStatus.status === 'failed' ? (
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  ) : (
                    <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold uppercase tracking-wide">
                      Sage Material Issue: {sageIssueStatus.status === 'success' ? 'Posted' : sageIssueStatus.status}
                    </div>
                    <div className="text-xs mt-0.5 break-words">
                      {sageIssueStatus.status === 'success' && sageIssueStatus.sage_response?.materialIssue?.reference
                        ? `Posted to Sage as ${sageIssueStatus.sage_response.materialIssue.reference} (${sageIssueStatus.sage_response.materialIssue.transactionCode || 'MFDR'}).`
                        : sageIssueStatus.message || 'Awaiting Sage bridge update.'}
                    </div>
                    {sageIssueStatus.status === 'failed' && sageIssueStatus.error_details?.message && (
                      <div className="text-[11px] mt-1 text-red-700 break-words">{sageIssueStatus.error_details.message}</div>
                    )}
                  </div>
                </div>
              )}

              {sageCompletionStatus && (
                <div className={`mx-4 mt-3 p-3 border rounded-xl flex items-start gap-3 ${
                  sageCompletionStatus.status === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : sageCompletionStatus.status === 'failed'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}>
                  {sageCompletionStatus.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" /> : sageCompletionStatus.status === 'failed' ? <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" /> : <RefreshCw className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-spin" />}
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold uppercase tracking-wide">Sage Finished-Goods Receipt: {sageCompletionStatus.status === 'success' ? 'Posted' : sageCompletionStatus.status === 'processing' ? 'Posting' : sageCompletionStatus.status}</div>
                    <div className="text-xs mt-0.5 break-words">{sageCompletionStatus.message || 'Waiting for Sage finished-goods posting.'}</div>
                    {sageCompletionStatus.status === 'failed' && sageCompletionStatus.error_details?.message && <div className="text-[11px] mt-1 text-red-700 break-words">{sageCompletionStatus.error_details.message}</div>}
                  </div>
                </div>
              )}

              {selectedFinishedGoodsTransfer && (
                <div className={`mx-4 mt-3 p-3 border rounded-xl flex items-start gap-3 ${
                  selectedFinishedGoodsTransfer.status === 'posted'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : selectedFinishedGoodsTransfer.status === 'failed'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}>
                  {selectedFinishedGoodsTransfer.status === 'posted' ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" /> : selectedFinishedGoodsTransfer.status === 'failed' ? <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" /> : <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold uppercase tracking-wide">Sage Finished-Goods Transfer: {selectedFinishedGoodsTransfer.status === 'posted' ? 'Posted to DEB' : selectedFinishedGoodsTransfer.status === 'failed' ? 'Failed at PD to DEB posting' : selectedFinishedGoodsTransfer.status}</div>
                    <div className="text-xs mt-0.5 break-words">{selectedFinishedGoodsTransfer.transfer_number} - {Number(selectedFinishedGoodsTransfer.quantity).toLocaleString()} kg from Production to DEB.</div>
                    {selectedFinishedGoodsTransfer.status === 'failed' && (
                      <div className="mt-1 text-[11px] text-red-700 break-words">{selectedFinishedGoodsTransfer.sage_response?.message || 'Sage did not post this PD to DEB transfer. Finance can review and re-queue the same verified transfer.'}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Quick Stats Row */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-white border-b border-slate-200 shadow-sm">
                <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Expected</div>
                  <div className="text-lg font-extrabold text-slate-900 font-mono mt-0.5">{selected.planned_qty?.toLocaleString()} <span className="text-xs font-normal text-slate-500">{selected.unit}</span></div>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 text-center">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Actual</div>
                  <div className="text-lg font-extrabold text-emerald-700 font-mono mt-0.5">{(selected.actual_qty || output.actual_qty || 0).toLocaleString()} <span className="text-xs font-normal text-emerald-600">{selected.unit}</span></div>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-center">
                  <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Yield</div>
                  <div className="text-lg font-extrabold text-blue-700 font-mono mt-0.5">
                    {selected.planned_qty > 0 ? Math.round(((selected.actual_qty || output.actual_qty || 0) / selected.planned_qty) * 100) : 0}%
                  </div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 text-center">
                  <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Materials Issued</div>
                  <div className="text-lg font-extrabold text-amber-700 font-mono mt-0.5">{detailMaterials.filter(m => m.issued).length}/{detailMaterials.length}</div>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-900 text-white p-3 text-center col-span-2 sm:col-span-1">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Cost</div>
                  <div className="text-lg font-extrabold text-teal-400 font-mono mt-0.5">${(costing.raw_material_cost + costing.labour_cost + costing.overhead_cost).toFixed(2)}</div>
                </div>
              </div>

              {/* Workflow Actions Bar */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-slate-200 flex-wrap">
                <div className="flex items-center gap-3">
                  {selected.status === 'pending' && (
                    <button
                      onClick={() => (allIngredientsIssued() ? updateStatus('materials_issued') : bulkIssueMaterials())}
                      disabled={saving || detailMaterials.length === 0 || (!allIngredientsIssued() && !allMaterialsAvailable())}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-extrabold shadow-sm shadow-emerald-200 transition-all disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                      Approve & Issue Materials
                    </button>
                  )}
                  {selected.status === 'materials_issued' && (
                    <button
                      onClick={() => updateStatus('in_progress')}
                      disabled={saving || !canStartProduction}
                      title={canStartProduction ? 'Sage material issue posted. Start production.' : 'Production unlocks after Sage posts the material issue successfully.'}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-extrabold shadow-sm shadow-teal-200 transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {canStartProduction ? <Play className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                      {canStartProduction ? 'Start Production' : 'Waiting for Sage Issue'}
                    </button>
                  )}
                  {selected.status === 'in_progress' && (
                    <button
                      onClick={handleCompletionRequest}
                      disabled={saving || sageCompletionInFlight || sageCompletionPosted || sageCompletionFailed || (output.actual_qty <= 0 && (selected.actual_qty || 0) <= 0)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-extrabold shadow-sm shadow-emerald-200 transition-all disabled:opacity-50"
                    >
                      {sageCompletionInFlight ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {sageCompletionInFlight ? 'Waiting for Sage Receipt' : sageCompletionPosted ? 'Sage Receipt Posted' : sageCompletionFailed ? 'Sage Completion Failed' : 'Complete Production'}
                    </button>
                  )}
                  {selected.status === 'completed' && (
                    <button
                      onClick={openFinishedGoodsTransfer}
                      disabled={saving || selectedFinishedGoodsTransfer?.status === 'posted' || selectedFinishedGoodsTransfer?.status === 'pending'}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold shadow-sm shadow-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title={selectedFinishedGoodsTransfer?.status === 'posted' ? 'Finished goods have already been transferred to DEB.' : selectedFinishedGoodsTransfer?.status === 'pending' ? 'This finished-goods transfer is queued for Sage.' : selectedFinishedGoodsTransfer?.status === 'pending_finance' ? 'Production handover is awaiting Finance verification.' : selectedFinishedGoodsTransfer?.status === 'failed' ? 'The PD to DEB Sage transfer failed. Review and re-queue the same verified transfer.' : 'Transfer finished goods from Production to DEB'}
                    >
                      {selectedFinishedGoodsTransfer?.status === 'posted' ? <CheckCircle2 className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                      {selectedFinishedGoodsTransfer?.status === 'posted' ? 'Transferred to DEB' : selectedFinishedGoodsTransfer?.status === 'pending' ? 'Sage Transfer Queued' : selectedFinishedGoodsTransfer?.status === 'pending_finance' ? 'Finance Review Required' : selectedFinishedGoodsTransfer?.status === 'failed' ? 'Review & Retry Sage Transfer' : 'Verify Finished Goods'}
                    </button>
                  )}
                  <span className="hidden md:inline-flex text-[11px] font-semibold text-slate-400 bg-slate-100 border border-slate-200 px-3 py-1 rounded-lg">
                    Pending → Materials Issued → In Progress → Completed
                  </span>
                </div>
                {selected.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={openEditQtyModal}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 rounded-lg text-xs font-bold transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Edit Qty
                    </button>
                    <button
                      onClick={() => deleteOrder(selected)}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 rounded-lg text-xs font-bold transition-colors"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {/* Production Batch Summary Card Bar (Product, Bag Count & Warehouse) */}
              <div className="mx-4 my-2.5 p-3.5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl shadow-md border border-slate-700/60 flex flex-wrap items-center justify-between gap-4">
                {/* Product Summary */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-300 font-bold text-base shrink-0">
                    📦
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-black text-slate-400">Product Summary</div>
                    <div className="text-xs font-black text-white flex items-center gap-1.5 mt-0.5">
                      <span className="text-teal-400 bg-teal-950/80 border border-teal-800 px-2 py-0.5 rounded font-mono">
                        {selected.formulations?.sage_code || selected.formulations?.code || 'FG'}
                      </span>
                      <span className="text-slate-400">•</span>
                      <span>{getOrderFormulationName(selected) || 'Formulation Product'}</span>
                    </div>
                  </div>
                </div>

                {/* Bags Quantity Produced / Expected */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold text-base shrink-0">
                    🎒
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-black text-slate-400">
                      {selected.status === 'completed' ? 'Quantity Produced (Bags)' : 'Expected Quantity (Bags)'}
                    </div>
                    <div className="text-xs font-black text-amber-300 flex items-center gap-1.5 mt-0.5 font-mono">
                      <span className="text-sm font-extrabold text-amber-400">
                        {Math.round((selected.actual_qty || output.actual_qty || selected.planned_qty || 0) / (parseFloat(selected.unit_size) || 50)).toLocaleString()} Bags
                      </span>
                      <span className="text-[11px] text-slate-300 font-normal">
                        ({selected.unit_size || '50'}kg/bag — Total {(selected.actual_qty || output.actual_qty || selected.planned_qty || 0).toLocaleString()} kg)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Target Warehouse */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-300 font-bold text-base shrink-0">
                    🏭
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-black text-slate-400">Finished-Goods Location</div>
                    <div className="text-xs font-black text-blue-300 flex items-center gap-1.5 mt-0.5">
                      <span>Production Warehouse</span>
                      <span className="text-[10px] bg-blue-950 border border-blue-800 text-blue-300 px-2 py-0.5 rounded font-mono font-bold">Sage PD (19)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="border-b border-slate-200 bg-white px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 overflow-x-auto py-1.5">
                    {(['materials', 'costing', 'output', 'operations', 'variance', 'downtime', 'logs'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setDetailTab(t);
                          if (t === 'materials') refreshSageStock();
                        }}
                        className={`py-1.5 px-3 text-xs font-bold rounded-lg transition-all ${
                          detailTab === t
                            ? 'bg-slate-900 text-white shadow'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                        disabled={t === 'variance' && selected?.status !== 'completed'}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                        {t === 'variance' && selected?.status !== 'completed' && (
                          <span className="ml-1 text-[10px] text-slate-400 font-normal">(Done)</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {detailTab === 'materials' && (
                    <button
                      onClick={() => refreshSageStock(true)}
                      disabled={saving || refreshingStock}
                      className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-100 flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshingStock ? 'animate-spin text-teal-600' : ''}`} />
                      {refreshingStock ? 'Refreshing...' : 'Refresh Sage Stock'}
                    </button>
                  )}
                </div>
              </div>

              {/* Tab Content */}
              <div className="p-4">

            {/* Materials Tab */}
            {detailTab === 'materials' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900">Components (BOM Ingredients)</h3>
                    <p className="text-xs text-slate-400">List of raw materials required to execute this batch</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-slate-700">
                      {detailMaterials.filter(m => m.issued).length} of {detailMaterials.length} issued
                    </span>
                    {detailMaterials.some(m => !m.issued) && selected.status === 'pending' && (
                      <button
                        onClick={bulkIssueMaterials}
                        disabled={saving || !allMaterialsAvailable()}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs rounded-xl shadow-md shadow-emerald-200 transition-all disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                        Issue All at Once ({detailMaterials.filter(m => !m.issued).length} Items)
                      </button>
                    )}
                  </div>
                </div>

                {!allMaterialsAvailable() && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="font-bold text-red-900 text-sm mb-1">⚠️ Insufficient Stock - Cannot Proceed</h4>
                        <p className="text-xs text-red-700 mb-2">The following materials do not have sufficient stock available:</p>
                        <ul className="text-xs text-red-700 space-y-1 font-medium">
                          {getInsufficientMaterials().map((m) => (
                            <li key={m.id}>• <strong>{m.raw_materials?.name}</strong> — Need {formatQty(m.planned_qty)} {m.unit}, have {formatQty(getAvailableStock(m))} {m.unit}</li>
                          ))}
                        </ul>
                        <p className="text-xs text-red-600 mt-2 font-medium">Please restock these materials in Sage or MES before issuing.</p>
                      </div>
                    </div>
                  </div>
                )}
                
                {detailMaterials.length === 0 ? (
                  <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
                    <Layers className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-medium">No ingredients loaded — BOM may not be set up</p>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold uppercase text-[10px]">
                          <th className="text-left px-4 py-3">Material</th>
                          <th className="text-right px-3 py-3">Planned Qty</th>
                          <th className="text-right px-3 py-3">Actual Qty</th>
                          <th className="text-right px-3 py-3">Unit Cost</th>
                          <th className="text-right px-3 py-3">Total Cost</th>
                          <th className="text-center px-3 py-3">Status</th>
                          <th className="text-center px-3 py-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailMaterials.map((material) => {
                          const availableStock = normalizeQty(getAvailableStock(material));
                          const isOutOfStock = !hasSufficientStock(material);
                          const qty = material.issued ? (material.actual_qty || material.planned_qty) : material.planned_qty;
                          const lineCost = (qty || 0) * (material.unit_cost || 0);

                          return (
                            <tr key={material.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-4 py-3">
                                <div className="font-bold text-slate-900 text-sm">{material.raw_materials?.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{material.raw_materials?.code}</div>
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-medium text-slate-700">
                                {material.planned_qty.toLocaleString()} <span className="text-slate-400 text-[10px]">{material.unit}</span>
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-bold text-slate-900">
                                {material.issued ? (material.actual_qty || material.planned_qty).toLocaleString() : '-'} {material.issued ? <span className="text-slate-400 text-[10px]">{material.unit}</span> : ''}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-slate-600">
                                ${Number(material.unit_cost || 0).toFixed(4)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-bold text-slate-900">
                                ${material.issued ? lineCost.toFixed(2) : '$0.00'}
                              </td>
                              <td className="px-3 py-3 text-center">
                                {material.issued ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full">
                                    <CheckCircle2 className="w-3 h-3" /> Issued
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 rounded-full">
                                    <Clock className="w-3 h-3" /> Pending
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-center">
                                {!material.issued && selected.status === 'pending' && (
                                  <div className="flex flex-col items-center gap-1">
                                    {isOutOfStock && (
                                      <span className="text-[10px] text-red-600 font-bold flex items-center gap-0.5">
                                        <AlertTriangle className="w-3 h-3" /> Out of stock
                                      </span>
                                    )}
                                    <button
                                      onClick={() => issueIndividualIngredient(material)}
                                      disabled={saving || isOutOfStock}
                                      className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                                        isOutOfStock
                                          ? 'bg-red-100 text-red-700 cursor-not-allowed opacity-50'
                                          : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm'
                                      }`}
                                    >
                                      <Check className="w-3 h-3" /> Issue
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Costing Tab */}
            {detailTab === 'costing' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-slate-800">Cost Breakdown</h3>
                
                {(() => {
                  // Calculate all costs. Production Line card is deprecated (double-counted labour); Labour card is authoritative.
                  const rawMaterialCost = costing.raw_material_cost;
                  const actualTonnes = output.actual_qty > 0 ? output.actual_qty / 1000 : 0;
                  const totalCost = rawMaterialCost + costing.labour_cost + costing.overhead_cost;
                  const costPerKg = output.actual_qty > 0 ? totalCost / output.actual_qty : 0;

                  // Planned cost calculation
                  const plannedBomCost = calculatePlannedMaterialCost(detailMaterials);
                  const plannedTotalCost = plannedBomCost + costing.labour_cost + costing.overhead_cost;
                  const plannedCostPerKg = selected.planned_qty > 0 ? plannedTotalCost / selected.planned_qty : 0;
                  
                  const varianceCostPerKg = costPerKg - plannedCostPerKg;
                  
                  return (
                    <>
                      {/* Cost Summary Cards */}
                      <div className="grid grid-cols-4 gap-3">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <div className="text-xs font-medium text-slate-500 mb-1">Raw Material</div>
                          <div className="text-xl font-bold text-slate-800">${rawMaterialCost.toFixed(2)}</div>
                          <div className="text-xs text-slate-400 mt-1">Issued ingredients</div>
                        </div>
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                          <div className="text-xs font-medium text-purple-600 mb-1">Labour</div>
                          <div className="text-xl font-bold text-purple-700">${costing.labour_cost.toFixed(2)}</div>
                          <div className="text-xs text-purple-600 mt-1">
                            {actualTonnes.toFixed(2)}t × ${labourRatePerTonne.toFixed(2)}/t
                            {usdZigRate !== null && <span className="block text-purple-500">≈ ZiG {(costing.labour_cost * usdZigRate).toFixed(2)}</span>}
                          </div>
                        </div>
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                          <div className="text-xs font-medium text-orange-600 mb-1">Overhead</div>
                          <div className="text-xl font-bold text-orange-700">${costing.overhead_cost.toFixed(2)}</div>
                          <div className="text-xs text-orange-600 mt-1">{overheadPct}% of RM cost</div>
                        </div>
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                          <div className="text-xs font-medium text-emerald-600 mb-1">Total Cost</div>
                          <div className="text-xl font-bold text-emerald-700">${totalCost.toFixed(2)}</div>
                          <div className="text-xs text-emerald-600 mt-1">
                            All costs
                            {usdZigRate !== null && <span className="block text-emerald-500">≈ ZiG {(totalCost * usdZigRate).toFixed(2)}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Cost Per Unit Cards */}
                      <div className="grid grid-cols-3 gap-4 border-t border-slate-200 pt-4">
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                          <div className="text-xs font-medium text-amber-600 mb-1">Actual Cost per kg</div>
                          <div className="text-2xl font-bold text-amber-700">${costPerKg.toFixed(4)}</div>
                          <div className="text-xs text-amber-600 mt-1">Based on {output.actual_qty} kg output</div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                          <div className="text-xs font-medium text-slate-600 mb-1">Expected Cost per kg</div>
                          <div className="text-2xl font-bold text-slate-700">${plannedCostPerKg.toFixed(4)}</div>
                          <div className="text-xs text-slate-600 mt-1">Based on {selected.planned_qty} kg expected</div>
                        </div>
                        <div className={`rounded-lg p-4 border ${varianceCostPerKg > 0 ? 'bg-red-50 border-red-200' : varianceCostPerKg < 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                          <div className={`text-xs font-medium mb-1 ${varianceCostPerKg > 0 ? 'text-red-600' : varianceCostPerKg < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                            Variance per kg
                          </div>
                          <div className={`text-2xl font-bold ${varianceCostPerKg > 0 ? 'text-red-700' : varianceCostPerKg < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                            ${(varianceCostPerKg > 0 ? '+' : '') + varianceCostPerKg.toFixed(4)}
                          </div>
                          <div className={`text-xs mt-1 ${varianceCostPerKg > 0 ? 'text-red-600' : varianceCostPerKg < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                            {varianceCostPerKg > 0 ? 'Over budget' : varianceCostPerKg < 0 ? 'Under budget' : 'On budget'}
                          </div>
                        </div>
                      </div>

                      {/* Editable Fields with auto-calc */}
                      {(() => {
                        const autoLabour = actualTonnes > 0 ? Math.round(actualTonnes * labourRatePerTonne * 100) / 100 : 0;
                        const autoOverhead = rawMaterialCost > 0 ? Math.round(rawMaterialCost * (overheadPct / 100) * 100) / 100 : 0;
                        const labourOverridden = Math.abs(costing.labour_cost - autoLabour) > 0.01 && costing.labour_cost > 0;
                        const overheadOverridden = Math.abs(costing.overhead_cost - autoOverhead) > 0.01 && costing.overhead_cost > 0;
                        return (
                          <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className={labelCls + ' !mb-0'}>Labour Cost</label>
                                {autoLabour > 0 && labourOverridden && selected.status === 'in_progress' && (
                                  <button
                                    onClick={() => setCosting({ ...costing, labour_cost: autoLabour })}
                                    className="text-xs font-medium text-teal-600 hover:text-teal-700"
                                  >
                                    Reset to auto (${autoLabour.toFixed(2)})
                                  </button>
                                )}
                              </div>
                              <input
                                type="number"
                                step="0.01"
                                value={costing.labour_cost}
                                onChange={(e) => setCosting({ ...costing, labour_cost: parseFloat(e.target.value) || 0 })}
                                className={inputCls}
                                disabled={selected.status !== 'in_progress'}
                              />
                              <div className="text-xs text-slate-500 mt-1">
                                {autoLabour > 0 ? (
                                  <>Auto-calculated: {actualTonnes.toFixed(2)}t × ${labourRatePerTonne.toFixed(2)}/t = <strong>${autoLabour.toFixed(2)}</strong>{usdZigRate !== null && <> (≈ ZiG {(autoLabour * usdZigRate).toFixed(2)})</>}{labourOverridden && ' — overridden'}</>
                                ) : (
                                  <>Record <em>actual output quantity</em> to auto-calculate. Rate: ${labourRatePerTonne.toFixed(2)}/tonne{usdZigRate !== null && <> (≈ ZiG {(labourRatePerTonne * usdZigRate).toFixed(2)}/t)</>}</>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className={labelCls + ' !mb-0'}>Overhead Cost</label>
                                {autoOverhead > 0 && overheadOverridden && selected.status === 'in_progress' && (
                                  <button
                                    onClick={() => setCosting({ ...costing, overhead_cost: autoOverhead })}
                                    className="text-xs font-medium text-teal-600 hover:text-teal-700"
                                  >
                                    Reset to auto (${autoOverhead.toFixed(2)})
                                  </button>
                                )}
                              </div>
                              <input
                                type="number"
                                step="0.01"
                                value={costing.overhead_cost}
                                onChange={(e) => setCosting({ ...costing, overhead_cost: parseFloat(e.target.value) || 0 })}
                                className={inputCls}
                                disabled={selected.status !== 'in_progress'}
                              />
                              <div className="text-xs text-slate-500 mt-1">
                                Auto-calculated: {overheadPct}% of ${rawMaterialCost.toFixed(2)} RM = <strong>${autoOverhead.toFixed(2)}</strong>{overheadOverridden && ' (overridden)'}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Read-only Fields */}
                      <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
                        <div>
                          <label className={labelCls}>Raw Material Cost (Auto-calculated)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={rawMaterialCost}
                            className={`${inputCls} bg-slate-100 cursor-not-allowed`}
                            disabled
                          />
                          <div className="text-xs text-slate-500 mt-1">Sum of {detailMaterials.filter(m => m.issued).length} issued ingredients</div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Output Tab */}
            {detailTab === 'output' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-800">Production Output</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Actual Output (Bags)</label>
                    <input
                      type="number"
                      step="1"
                      value={output.actual_bags || ''}
                      onChange={(e) => {
                        const actualBags = parseFloat(e.target.value) || 0;
                        setOutput({ ...output, actual_bags: actualBags, actual_qty: kgFromBags(actualBags, selected.unit_size) });
                      }}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">{output.actual_qty.toLocaleString()} kg at {bagSizeKg(selected.unit_size)} kg/bag</p>
                  </div>
                  <div>
                    <label className={labelCls}>Rejected (Bags)</label>
                    <input
                      type="number"
                      step="1"
                      value={output.rejected_bags || ''}
                      onChange={(e) => {
                        const rejectedBags = parseFloat(e.target.value) || 0;
                        setOutput({ ...output, rejected_bags: rejectedBags, rejected_qty: kgFromBags(rejectedBags, selected.unit_size) });
                      }}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">{output.rejected_qty.toLocaleString()} kg</p>
                  </div>
                  <div>
                    <label className={labelCls}>Wastage (Bags)</label>
                    <input
                      type="number"
                      step="1"
                      value={output.wastage_bags || ''}
                      onChange={(e) => {
                        const wastageBags = parseFloat(e.target.value) || 0;
                        setOutput({ ...output, wastage_bags: wastageBags, wastage_qty: kgFromBags(wastageBags, selected.unit_size) });
                      }}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">{output.wastage_qty.toLocaleString()} kg</p>
                  </div>
                  <div>
                    <label className={labelCls}>Actual Production Hours</label>
                    <input
                      type="number"
                      step="0.01"
                      value={output.actual_hours}
                      onChange={(e) => setOutput({ ...output, actual_hours: e.target.value })}
                      className={inputCls}
                      placeholder="e.g. 4.5"
                      disabled={selected.status !== 'in_progress'}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Average Throughput (mt/hr)</label>
                    <input
                      type="number"
                      step="0.001"
                      value={output.average_throughput}
                      onChange={(e) => setOutput({ ...output, average_throughput: e.target.value })}
                      className={inputCls}
                      placeholder={output.actual_hours && output.actual_qty > 0 ? `auto = ${((output.actual_qty/1000)/Number(output.actual_hours)).toFixed(3)}` : 'e.g. 3.95'}
                      disabled={selected.status !== 'in_progress'}
                    />
                    <div className="text-xs text-slate-400 mt-1">Leave blank to auto-calc from Actual Qty ÷ Hours.</div>
                  </div>
                </div>

                {/* Yield & Process Loss Summary */}
                {(output.actual_qty > 0 || selected.actual_qty > 0) && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                      <p className="text-xs text-emerald-600 uppercase font-medium">Yield %</p>
                      <p className="text-xl font-bold text-emerald-800">
                        {selected.planned_qty > 0 ? Math.round(((selected.actual_qty || output.actual_qty) / selected.planned_qty) * 1000) / 10 : 0}%
                      </p>
                      <p className="text-xs text-emerald-600 mt-1">
                        {(selected.actual_qty || output.actual_qty).toLocaleString()} of {selected.planned_qty.toLocaleString()} kg
                      </p>
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
                      <p className="text-xs text-amber-600 uppercase font-medium">Process Loss</p>
                      <p className="text-xl font-bold text-amber-800">
                        {selected.planned_qty > 0 ? Math.round(((selected.planned_qty - (selected.actual_qty || output.actual_qty)) / selected.planned_qty) * 1000) / 10 : 0}%
                      </p>
                      <p className="text-xs text-amber-600 mt-1">
                        {Math.max(0, selected.planned_qty - (selected.actual_qty || output.actual_qty)).toLocaleString()} kg lost
                      </p>
                    </div>
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-center">
                      <p className="text-xs text-red-600 uppercase font-medium">Rejects + Wastage</p>
                      <p className="text-xl font-bold text-red-800">
                        {((output.rejected_qty || selected.rejected_qty || 0) + (output.wastage_qty || selected.wastage_qty || 0)).toLocaleString()} kg
                      </p>
                      <p className="text-xs text-red-600 mt-1">
                        {(output.rejected_qty || selected.rejected_qty || 0)} rejected + {(output.wastage_qty || selected.wastage_qty || 0)} wastage
                      </p>
                    </div>
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-center">
                      <p className="text-xs text-blue-600 uppercase font-medium">Efficiency vs Nominal</p>
                      <p className="text-xl font-bold text-blue-800">
                        {(selected.formulations?.nominal_speed || 0) > 0 && Number(output.average_throughput || selected.average_throughput || 0) > 0
                          ? Math.round((Number(output.average_throughput || selected.average_throughput || 0) / (selected.formulations?.nominal_speed || 1)) * 1000) / 10
                          : 0}%
                      </p>
                      <p className="text-xs text-blue-600 mt-1">
                        Nominal: {(selected.formulations?.nominal_speed || 0).toFixed(2)} mt/hr
                      </p>
                    </div>
                  </div>
                )}

                {/* Output Status */}
                {selected.actual_qty > 0 && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="text-sm font-medium text-green-800">
                      Production output recorded: {selected.actual_qty} {selected.unit}
                    </div>
                    <div className="text-xs text-green-600 mt-1">
                      {selected.status === 'completed' ? 'Finished goods are ready for the Production and Finance dispatch handover.' : 'Output will be saved automatically when you complete production.'}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Operations / Job Cards Tab */}
            {detailTab === 'operations' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-800">Job Cards (Per-Operation Tracking)</h3>
                  {selected.status !== 'completed' && (
                    <button
                      onClick={async () => {
                        if (!selected) return;
                        setSaving(true);
                        // Seed default operations from templates
                        const { data: templates } = await supabase.from('operation_templates').select('*').eq('is_active', true).order('seq_no');
                        if (!templates?.length) { setSaving(false); return; }
                        const ops = templates.map((t: any) => ({
                          production_order_id: selected.id,
                          seq_no: t.seq_no,
                          operation_name: t.name,
                          description: t.description,
                          estimated_time_mins: t.default_estimated_time_mins,
                          prep_time_mins: t.default_prep_time_mins,
                          planned_qty: selected.planned_qty,
                          status: 'pending',
                        }));
                        const { error } = await supabase.from('production_operations').insert(ops);
                        setSaving(false);
                        if (error) { setWorkflowError('Failed to create operations: ' + error.message); return; }
                        // Refresh
                        const { data: opsData } = await supabase.from('production_operations').select('*, profiles!operator_id(full_name), machines(name)').eq('production_order_id', selected.id).order('seq_no');
                        setOperations(opsData || []);
                      }}
                      disabled={saving || operations.length > 0}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      <Play className="w-4 h-4" />
                      {operations.length > 0 ? 'Operations Created' : 'Generate Operations'}
                    </button>
                  )}
                </div>

                {operations.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 border border-dashed border-slate-200 rounded-lg">
                    <Layers className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm">No operations recorded yet</p>
                    <p className="text-xs text-slate-400 mt-1">Generate operations to track each manufacturing step</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {operations.map((op: any) => (
                      <div key={op.id} className={`border rounded-lg p-4 ${op.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : op.status === 'in_progress' ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold">{op.seq_no}</span>
                            <div>
                              <p className="font-semibold text-slate-800 text-sm">{op.operation_name}</p>
                              <p className="text-xs text-slate-500">{op.description}</p>
                            </div>
                          </div>
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                            op.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                            op.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                            op.status === 'skipped' ? 'bg-slate-100 text-slate-600' :
                            'bg-amber-100 text-amber-700'
                          }`}>{op.status.replace('_', ' ')}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-slate-500">Planned Qty</p>
                            <p className="font-medium text-slate-700">{op.planned_qty?.toLocaleString() || 0} kg</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Actual Qty</p>
                            <p className="font-medium text-slate-700">{op.actual_qty?.toLocaleString() || 0} kg</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Est. Time</p>
                            <p className="font-medium text-slate-700">{op.estimated_time_mins || 0} min</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Actual Time</p>
                            <p className="font-medium text-slate-700">{op.actual_time_mins || 0} min</p>
                          </div>
                        </div>
                        {op.profiles?.full_name && (
                          <p className="text-xs text-slate-500 mt-2">Operator: {op.profiles.full_name}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Variance Tab */}
            {detailTab === 'variance' && selected.status === 'completed' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-slate-800">BOM Variance Analysis</h3>
                  <div className="text-sm text-slate-600">
                    Comparing BOM required vs actual materials used
                  </div>
                </div>
                
                {bomVariances.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No variance data available</p>
                  </div>
                ) : (
                  <>
                    {/* Variance Summary */}
                    <div className="grid grid-cols-4 gap-4 mb-6">
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        <div className="text-xs font-medium text-emerald-600 mb-1">Within Tolerance</div>
                        <div className="text-lg font-bold text-emerald-700">
                          {bomVariances.filter(v => v.status === 'Within Tolerance').length}
                        </div>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="text-xs font-medium text-amber-600 mb-1">Minor Variance</div>
                        <div className="text-lg font-bold text-amber-700">
                          {bomVariances.filter(v => v.status === 'Minor Variance').length}
                        </div>
                      </div>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="text-xs font-medium text-red-600 mb-1">Major Variance</div>
                        <div className="text-lg font-bold text-red-700">
                          {bomVariances.filter(v => v.status === 'Major Variance').length}
                        </div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-xs font-medium text-slate-600 mb-1">Total Variance</div>
                        <div className="text-lg font-bold text-slate-700">
                          ${bomVariances.reduce((sum, v) => sum + (v.cost_variance || 0), 0).toFixed(2)}
                        </div>
                      </div>
                    </div>

                    {/* Detailed Variance Table */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Material</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600">BOM Required</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600">Actual Used</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600">Qty Variance</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600">% Variance</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600">Cost Variance</th>
                            <th className="text-center px-3 py-2 font-medium text-slate-600">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {bomVariances.map((variance, index) => (
                            <tr key={index}>
                              <td className="px-3 py-2">
                                <div className="font-medium">{variance.raw_material_name}</div>
                                <div className="text-xs text-slate-500">{variance.raw_material_code}</div>
                              </td>
                              <td className="px-3 py-2 text-right">{variance.planned_qty} {variance.unit}</td>
                              <td className="px-3 py-2 text-right">{variance.actual_qty} {variance.unit}</td>
                              <td className="px-3 py-2 text-right">
                                <span className={`font-medium ${
                                  variance.variance_qty > 0 ? 'text-red-600' : 
                                  variance.variance_qty < 0 ? 'text-amber-600' : 'text-emerald-600'
                                }`}>
                                  {variance.variance_qty > 0 ? '+' : ''}{variance.variance_qty} {variance.unit}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <span className={`font-medium ${
                                  Math.abs(variance.variance_pct) <= 5 ? 'text-emerald-600' :
                                  Math.abs(variance.variance_pct) <= 10 ? 'text-amber-600' : 'text-red-600'
                                }`}>
                                  {variance.variance_pct > 0 ? '+' : ''}{variance.variance_pct}%
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <span className={`font-medium ${
                                  variance.cost_variance > 0 ? 'text-red-600' : 
                                  variance.cost_variance < 0 ? 'text-emerald-600' : 'text-slate-600'
                                }`}>
                                  ${variance.cost_variance > 0 ? '+' : ''}{variance.cost_variance.toFixed(2)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                                  variance.status === 'Within Tolerance' ? 'bg-emerald-100 text-emerald-700' :
                                  variance.status === 'Minor Variance' ? 'bg-amber-100 text-amber-700' :
                                  variance.status === 'Major Variance' ? 'bg-red-100 text-red-700' :
                                  'bg-slate-100 text-slate-700'
                                }`}>
                                  {variance.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Variance Insights */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                        <div className="text-sm text-blue-800">
                          <div className="font-medium mb-1">Variance Analysis Insights</div>
                          <ul className="space-y-1 text-xs">
                            <li>• Materials with &le;5% variance are within acceptable tolerance</li>
                            <li>• Materials with 5-10% variance require investigation</li>
                            <li>• Materials with &gt;10% variance indicate significant process issues</li>
                            <li>• Total cost variance impacts profitability and pricing decisions</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Downtime Tab */}
            {detailTab === 'downtime' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-800">Downtime</h3>
                  <div className="text-sm text-slate-600">
                    Total: <strong className="text-slate-800">{downtimeEntries.reduce((s, d) => s + Number(d.downtime_hours || 0), 0).toFixed(2)} hrs</strong>
                  </div>
                </div>

                {(selected.status === 'in_progress' || selected.status === 'completed') ? (
                  <div className="grid grid-cols-12 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={downtimeForm.downtime_hours}
                      onChange={(e) => setDowntimeForm({ ...downtimeForm, downtime_hours: e.target.value })}
                      placeholder="Hours"
                      className="col-span-2 px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                    <select
                      value={downtimeForm.category}
                      onChange={(e) => setDowntimeForm({ ...downtimeForm, category: e.target.value })}
                      className="col-span-3 px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                    >
                      {['Mechanical','Electrical','Power Outage','Waiting - Materials','Waiting - Maintenance','Other'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                      type="text"
                      value={downtimeForm.reason}
                      onChange={(e) => setDowntimeForm({ ...downtimeForm, reason: e.target.value })}
                      placeholder="Reason"
                      className="col-span-5 px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                    <button
                      onClick={async () => {
                        if (!downtimeForm.downtime_hours || !downtimeForm.reason) return;
                        const { data: { user } } = await supabase.auth.getUser();
                        const { error } = await supabase.from('production_order_downtime').insert({
                          production_order_id: selected.id,
                          downtime_hours: Number(downtimeForm.downtime_hours),
                          category: downtimeForm.category,
                          reason: downtimeForm.reason,
                          created_by: user?.id || null,
                        });
                        if (error) { alert('Failed to save downtime: ' + error.message); return; }
                        const { data } = await supabase.from('production_order_downtime').select('*').eq('production_order_id', selected.id).order('created_at', { ascending: true });
                        setDowntimeEntries(data || []);
                        setDowntimeForm({ downtime_hours: '', category: 'Mechanical', reason: '' });
                      }}
                      className="col-span-2 px-3 py-1.5 text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white rounded transition-colors"
                    >
                      + Add
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">Downtime can only be added once production is In Progress or Completed.</p>
                )}

                {downtimeEntries.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Clock className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm">No downtime recorded for this order</p>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-slate-600">Hours</th>
                          <th className="text-left px-3 py-2 font-medium text-slate-600">Category</th>
                          <th className="text-left px-3 py-2 font-medium text-slate-600">Reason</th>
                          <th className="text-left px-3 py-2 font-medium text-slate-600">Logged</th>
                          <th className="text-center px-3 py-2 font-medium text-slate-600"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {downtimeEntries.map((d) => (
                          <tr key={d.id}>
                            <td className="px-3 py-2 font-medium text-slate-800">{Number(d.downtime_hours).toFixed(2)}</td>
                            <td className="px-3 py-2 text-slate-700">{d.category}</td>
                            <td className="px-3 py-2 text-slate-600">{d.reason}</td>
                            <td className="px-3 py-2 text-slate-500 text-xs">{format(new Date(d.created_at), 'dd MMM HH:mm')}</td>
                            <td className="px-3 py-2 text-center">
                              {(selected.status === 'in_progress' || selected.status === 'completed') && (
                                <button
                                  onClick={() => {
                                    openConfirmDialog({
                                      title: 'Delete Downtime Entry',
                                      message: 'Delete this downtime entry?',
                                      confirmLabel: 'Delete Entry',
                                      destructive: true,
                                      onConfirm: async () => {
                                        await supabase.from('production_order_downtime').delete().eq('id', d.id);
                                        setDowntimeEntries(prev => prev.filter(x => x.id !== d.id));
                                      },
                                    });
                                  }}
                                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Logs Tab */}
            {detailTab === 'logs' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-800">Production Logs</h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Type</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Description</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Start Time</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {logs.map((log) => (
                        <tr key={log.id}>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                              log.log_type === 'start' ? 'bg-blue-100 text-blue-700' :
                              log.log_type === 'stop' ? 'bg-red-100 text-red-700' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {log.log_type}
                            </span>
                          </td>
                          <td className="px-3 py-2">{log.description}</td>
                          <td className="px-3 py-2">{log.started_at ? format(new Date(log.started_at), 'dd MMM yyyy HH:mm') : '-'}</td>
                          <td className="px-3 py-2">{log.duration_minutes ? `${log.duration_minutes} min` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Packaging Declaration Modal */}
      <Dialog open={showPkgModal} onOpenChange={(open) => setShowPkgModal(open)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden border-none bg-transparent">
          <div className="p-6 bg-white rounded-2xl shadow-2xl">
            {selected && (
              <PackagingDeclaration
                actualOutputQty={
                  selected.unit === 'tonnes'
                    ? (output.actual_qty || selected.actual_qty || 0)
                    : (output.actual_qty || selected.actual_qty || 0) / 1000
                }
                formulationId={selected.formulation_id}
                unitSize={selected.unit_size}
                formulationName={getOrderFormulationName(selected)}
                onSave={handlePkgConfirm}
                disabled={saving}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDialog.open} onOpenChange={(open) => { if (!open) closeConfirmDialog(); }}>
        <DialogContent className="max-w-md p-0">
          <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white rounded-t-lg">
            <h3 className="text-lg font-semibold text-slate-800">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mt-1">{confirmDialog.message}</p>
          </div>
          <div className="p-4 flex justify-end gap-2">
            <button
              onClick={closeConfirmDialog}
              disabled={confirmingAction}
              className="px-3 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDialog}
              disabled={confirmingAction}
              className={`px-3 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 ${
                confirmDialog.destructive
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-teal-600 hover:bg-teal-700'
              }`}
            >
              {confirmingAction ? 'Processing...' : confirmDialog.confirmLabel}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
