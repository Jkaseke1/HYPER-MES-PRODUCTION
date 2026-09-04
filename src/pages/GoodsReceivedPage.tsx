import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Eye, Package, Calendar, FileText, Hash, DollarSign, Scale, X, ChevronDown, ChevronUp, CheckCircle, AlertCircle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import GRNApprovalButtons from '../components/approval/GRNApprovalButtons';
import ApprovalHistory from '../components/approval/ApprovalHistory';
import GRNAttachments from '../components/grn/GRNAttachments';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { GoodsReceivedNote, Supplier, RawMaterial } from '../types/database';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { cacheData, getCachedData, queueOfflineAction } from '../lib/offlineSync';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import StockTakeFrozenBanner from '../components/stock/StockTakeFrozenBanner';
import StickyOperationsPanel from '../components/layout/StickyOperationsPanel';
import toast from 'react-hot-toast';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

interface GRNItem {
  raw_material_id: string;
  ordered_qty: number | '';
  received_qty: number | '';
  unit_cost: number | '';
  batch_number: string;
  expiry_date: string;
}

interface SageSyncStatus {
  id: string;
  status: string;
  message?: string | null;
  sage_response?: any;
  error_details?: any;
  updated_at?: string | null;
}

const emptyItem: GRNItem = {
  raw_material_id: '',
  ordered_qty: '',
  received_qty: '',
  unit_cost: '',
  batch_number: '',
  expiry_date: '',
};

const localDateInputValue = () => format(new Date(), 'yyyy-MM-dd');

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0);
  const roundedToCents = Math.round(amount * 100) / 100;
  return Math.abs(amount - roundedToCents) < 0.000001
    ? amount.toFixed(2)
    : amount.toFixed(4);
}

export default function GoodsReceivedPage() {
  const { profile } = useAuth();
  const [grns, setGrns] = useState<GoodsReceivedNote[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewing, setViewing] = useState<GoodsReceivedNote | null>(null);
  const [viewItems, setViewItems] = useState<any[]>([]);
  const [syncByGrnId, setSyncByGrnId] = useState<Record<string, SageSyncStatus>>({});
  const notifiedSyncRef = useRef<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [retryingSagePost, setRetryingSagePost] = useState(false);
  const [showRetrySageDialog, setShowRetrySageDialog] = useState(false);
  
  // Form state
  const [supplierId, setSupplierId] = useState('');
  const [receivedDate, setReceivedDate] = useState(localDateInputValue);
  const [notes, setNotes] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [supplierDeliveryNoteNo, setSupplierDeliveryNoteNo] = useState('');
  const [supplierOrderNo, setSupplierOrderNo] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [weighBridgeTicketId, setWeighBridgeTicketId] = useState('');
  const [wbTickets, setWbTickets] = useState<any[]>([]);
  const [wbExpanded, setWbExpanded] = useState(false);
  const [items, setItems] = useState<GRNItem[]>([emptyItem]);

  // Weigh bridge inline form fields
  const [wbForm, setWbForm] = useState({
    transaction_no: '',
    vehicle_reg: '',
    haulier_code: 'HYPER',
    product_code: '',
    comment: '',
    trailer_number: '',
    driver_name: '',
    driver_id: '',
    time_in: '',
    first_mass: '',
    time_out: '',
    second_mass: '',
    nett_mass: '',
    driver_signed: false,
  });

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const [grnsRes, suppliersRes, materialsRes, wbRes] = await Promise.all([
        supabase.from('goods_received_notes').select('*, receiver:profiles!received_by(full_name, email), approver:profiles!approved_by(full_name), suppliers(name, code, sage_code), warehouses(name)').order('created_at', { ascending: false }),
        supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
        supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
        supabase.from('weigh_bridge_tickets').select('*, suppliers(name, code)').eq('status', 'open').order('created_at', { ascending: false }),
      ]);

      if (grnsRes.data) {
        setGrns(grnsRes.data as any);
        cacheData('goods_received_notes', grnsRes.data);
        await fetchSageSyncStatuses(grnsRes.data as any[], false);
      }
      if (suppliersRes.data) {
        setSuppliers(suppliersRes.data as any);
        cacheData('suppliers', suppliersRes.data);
      }
      if (materialsRes.data) {
        setMaterials(materialsRes.data as any);
        cacheData('raw_materials', materialsRes.data);
      }
      if (wbRes.data) {
        setWbTickets(wbRes.data as any);
        cacheData('weigh_bridge_tickets', wbRes.data);
      }

      if (!navigator.onLine || grnsRes.error) {
        const cachedGrns = await getCachedData('goods_received_notes');
        const cachedSuppliers = await getCachedData('suppliers');
        const cachedMaterials = await getCachedData('raw_materials');
        const cachedWb = await getCachedData('weigh_bridge_tickets');

        if (cachedGrns) {
          setGrns(cachedGrns);
          await fetchSageSyncStatuses(cachedGrns as any[], false);
        }
        if (cachedSuppliers) setSuppliers(cachedSuppliers);
        if (cachedMaterials) setMaterials(cachedMaterials);
        if (cachedWb) setWbTickets(cachedWb);
      }
    } catch {
      const cachedGrns = await getCachedData('goods_received_notes');
      const cachedSuppliers = await getCachedData('suppliers');
      const cachedMaterials = await getCachedData('raw_materials');
      const cachedWb = await getCachedData('weigh_bridge_tickets');

      if (cachedGrns) {
        setGrns(cachedGrns);
        await fetchSageSyncStatuses(cachedGrns as any[], false);
      }
      if (cachedSuppliers) setSuppliers(cachedSuppliers);
      if (cachedMaterials) setMaterials(cachedMaterials);
      if (cachedWb) setWbTickets(cachedWb);
    }
    if (showLoading) setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, []);

  useRealtimeRefresh(
    'goods-received-live',
    ['goods_received_notes', 'grn_items', 'weigh_bridge_tickets', 'sync_log'],
    () => {
      // Do not replace an operator's active capture or review with live data.
      if (modalOpen || viewModalOpen) return;
      return fetchData(false);
    },
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && grns.length > 0) {
        fetchSageSyncStatuses(grns as any[]);
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [grns]);

  async function fetchSageSyncStatuses(grnRows: any[], notify = true) {
    const grnIds = (grnRows || []).map((grn) => grn.id).filter(Boolean);
    if (grnIds.length === 0) {
      setSyncByGrnId({});
      return;
    }

    const { data, error } = await supabase
      .from('sync_log')
      .select('id, reference_id, status, message, sage_response, error_details, updated_at')
      .eq('event_type', 'grn_confirmed')
      .in('reference_id', grnIds)
      .order('updated_at', { ascending: false });

    if (error) {
      console.warn('Failed to load GRN Sage sync statuses:', error.message);
      return;
    }

    const latestByGrn: Record<string, SageSyncStatus> = {};
    (data || []).forEach((row: any) => {
      if (!latestByGrn[row.reference_id]) {
        latestByGrn[row.reference_id] = row;
      }
    });

    setSyncByGrnId(latestByGrn);

    if (!notify) {
      Object.entries(latestByGrn).forEach(([grnId, sync]) => {
        if (['success', 'failed'].includes(sync.status)) {
          notifiedSyncRef.current[grnId] = `${sync.status}:${sync.updated_at || ''}`;
        }
      });
      return;
    }
    Object.entries(latestByGrn).forEach(([grnId, sync]) => {
      if (!['success', 'failed'].includes(sync.status)) return;
      const notificationKey = `${sync.status}:${sync.updated_at || ''}`;
      if (notifiedSyncRef.current[grnId] === notificationKey) return;
      notifiedSyncRef.current[grnId] = notificationKey;

      const grn = grnRows.find((row) => row.id === grnId);
      const grnNumber = grn?.grn_number || 'GRN';

      if (sync.status === 'success') {
        const grvNumber = getSageGrvNumber(sync);
        const purchaseOrderNumber = getSagePurchaseOrderNumber(sync);
        const documentLabel = [purchaseOrderNumber, grvNumber].filter(Boolean).join(' / ');
        toast.success(documentLabel ? `${grnNumber} posted to Sage as ${documentLabel}` : `${grnNumber} posted to Sage`);
      } else {
        toast.error(`${grnNumber} Sage posting failed`);
      }
    });
  }

  const generateGRNNumber = async () => {
    const year = new Date().getFullYear();
    const { data: sequence, error } = await supabase.rpc('reserve_next_sage_grv_sequence');

    if (error || !Number.isInteger(sequence)) {
      throw error || new Error('Sage GRV sequence did not return a number.');
    }

    return `GRN-${year}-${String(sequence).padStart(6, '0')}`;
  };

  const handleSaveGRN = async () => {
    if (!supplierId || items.length === 0 || !items[0].raw_material_id) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (weighBridgeTicketId) {
      const ticket = wbTickets.find((candidate: any) => candidate.id === weighBridgeTicketId);
      const linkedMaterial = materials.find((material: any) =>
        material.id === items[0].raw_material_id
        && (material.code === ticket?.product_code || material.sage_code === ticket?.product_code),
      );

      if (!ticket || ticket.status !== 'open') {
        toast.error('Select an open weighbridge ticket. A linked or cancelled ticket cannot be reused.');
        return;
      }
      if (ticket.supplier_id !== supplierId) {
        toast.error('The weighbridge ticket supplier must match the GRN supplier.');
        return;
      }
      if (!linkedMaterial) {
        toast.error('The weighbridge ticket material must match the GRN material.');
        return;
      }
      if (!(Number(ticket.nett_mass) > 0) || !ticket.driver_signed) {
        toast.error('The linked weighbridge ticket needs a positive nett mass and driver sign-off.');
        return;
      }
    }

    setSaving(true);
    try {
      const grnNumber = await generateGRNNumber();
      
      // Get warehouse ID
      const { data: warehouse } = await supabase
        .from('warehouses')
        .select('id')
        .eq('code', 'RM')
        .single();

      // Create GRN header
      const grnData: any = {
        grn_number: grnNumber,
        supplier_id: supplierId,
        warehouse_id: warehouse?.id,
        received_date: receivedDate,
        status: 'pending',
        notes: notes || null,
        supplier_invoice_no: supplierInvoiceNo.trim() || null,
        supplier_delivery_note_no: supplierDeliveryNoteNo.trim() || null,
        supplier_order_no: supplierOrderNo.trim() || null,
        external_reference: externalReference.trim() || null,
        received_by: profile?.id,
      };

      if (weighBridgeTicketId) {
        grnData.weigh_bridge_ticket_id = weighBridgeTicketId;
      }

      const { data: grn, error: grnError } = await supabase
        .from('goods_received_notes')
        .insert(grnData)
        .select()
        .single();

      if (grnError) throw grnError;

      // Create GRN items
      const grnItems = items.map(item => ({
        grn_id: grn.id,
        raw_material_id: item.raw_material_id,
        ordered_qty: Number(item.ordered_qty) || 0,
        received_qty: Number(item.received_qty) || 0,
        unit_cost: Number(item.unit_cost) || 0,
        batch_number: item.batch_number || null,
        expiry_date: item.expiry_date || null,
      }));

      const { error: itemsError } = await supabase
        .from('grn_items')
        .insert(grnItems);

      if (itemsError) throw itemsError;

      toast.success('GRN created successfully');
      setModalOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Error creating GRN:', error);
      toast.error(`Failed to create GRN: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSupplierId('');
    setReceivedDate(localDateInputValue());
    setNotes('');
    setSupplierInvoiceNo('');
    setSupplierDeliveryNoteNo('');
    setSupplierOrderNo('');
    setExternalReference('');
    setWeighBridgeTicketId('');
    setItems([emptyItem]);
    setWbForm({
      transaction_no: '', vehicle_reg: '', haulier_code: 'HYPER', product_code: '',
      comment: '', trailer_number: '', driver_name: '', driver_id: '',
      time_in: '', first_mass: '', time_out: '', second_mass: '', nett_mass: '', driver_signed: false,
    });
  };

  const handleViewGRN = async (grn: GoodsReceivedNote) => {
    setViewing(grn);
    const { data } = await supabase
      .from('grn_items')
      .select('*, raw_materials(code, name)')
      .eq('grn_id', grn.id);
    setViewItems(data || []);
    setViewModalOpen(true);
  };

  const addItem = () => {
    setItems([...items, { ...emptyItem }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof GRNItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const parseLineItemNumber = (value: string): number | '' => {
    if (value === '') return '';
    const parsed = Number(value);
    return Number.isNaN(parsed) ? '' : parsed;
  };

  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 font-semibold">Approved</Badge>;
      case 'pending':
        return <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 font-semibold">Pending</Badge>;
      case 'rejected':
        return <Badge className="bg-rose-500/15 text-rose-700 hover:bg-rose-500/20 border border-rose-500/30 px-2.5 py-0.5 font-semibold">Rejected</Badge>;
      default:
        return <Badge variant="outline" className="font-semibold">{status}</Badge>;
    }
  };

  const getSageGrvNumber = (sync?: SageSyncStatus) => {
    if (!sync?.sage_response) return '';
    return sync.sage_response.grvNumber ||
      sync.sage_response.documentNumber ||
      sync.sage_response.goodsReceipt?.grvNumber ||
      sync.sage_response.goodsReceipt?.documentNumber ||
      '';
  };

  const getSagePurchaseOrderNumber = (sync?: SageSyncStatus) => {
    if (!sync?.sage_response) return '';
    return sync.sage_response.purchaseOrderNumber ||
      sync.sage_response.goodsReceipt?.purchaseOrderNumber ||
      '';
  };

  const getSageErrorMessage = (sync?: SageSyncStatus) => {
    return sync?.error_details?.response?.exceptionMessage ||
      sync?.error_details?.response?.message ||
      sync?.error_details?.message ||
      sync?.message ||
      'Sage posting failed';
  };

  const canRetrySagePosting = ['admin', 'finance', 'accountant'].includes(profile?.role || '');

  const retryFailedSagePosting = async () => {
    if (!viewing || !selectedSync || selectedSync.status !== 'failed' || !canRetrySagePosting) return;

    setRetryingSagePost(true);
    try {
      const { data, error } = await supabase
        .from('sync_log')
        .update({
          status: 'pending',
          message: `Manual retry requested for GRN ${viewing.grn_number}`,
          error_details: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedSync.id)
        .eq('status', 'failed')
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('This Sage posting is no longer failed and cannot be retried. Refresh the GRN status.');

      notifiedSyncRef.current[viewing.id] = '';
      setShowRetrySageDialog(false);
      await fetchSageSyncStatuses(grns, false);
      toast.success(`${viewing.grn_number} requeued for Sage posting`);
    } catch (error: any) {
      console.error('Failed to retry Sage GRV posting:', error);
      toast.error(`Could not requeue ${viewing.grn_number}: ${error.message}`);
    } finally {
      setRetryingSagePost(false);
    }
  };

  const getSageBadge = (grnId: string) => {
    const sync = syncByGrnId[grnId];

    if (!sync) {
      return <Badge variant="outline" className="bg-white text-slate-500 border-slate-200 font-semibold">Not queued</Badge>;
    }

    if (sync.status === 'success') {
      const grvNumber = getSageGrvNumber(sync);
      const purchaseOrderNumber = getSagePurchaseOrderNumber(sync);
      const documentLabel = [purchaseOrderNumber, grvNumber].filter(Boolean).join(' / ');
      return (
        <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border border-emerald-200 font-semibold" title={documentLabel || undefined}>
          <CheckCircle className="h-3 w-3 mr-1" />
          {documentLabel ? `Posted ${documentLabel}` : 'Posted to Sage'}
        </Badge>
      );
    }

    if (sync.status === 'failed') {
      return (
        <Badge className="bg-rose-50 text-rose-700 hover:bg-rose-50 border border-rose-200 font-semibold" title={getSageErrorMessage(sync)}>
          <AlertCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    }

    if (sync.status === 'pending' || sync.status === 'processing') {
      const isProcessing = sync.status === 'processing';
      return (
        <Badge className={isProcessing ? 'bg-blue-50 text-blue-700 hover:bg-blue-50 border border-blue-200 font-semibold max-w-full' : 'bg-amber-50 text-amber-700 hover:bg-amber-50 border border-amber-200 font-semibold'} title={sync.message || undefined}>
          {isProcessing ? <Loader2 className="h-3 w-3 mr-1 animate-spin shrink-0" /> : <span className="w-1.5 h-1.5 mr-1 rounded-full bg-amber-500 shrink-0" />}
          <span className="truncate">{isProcessing ? (sync.message || 'Processing Sage GRV') : 'Queued'}</span>
        </Badge>
      );
    }

    return <Badge variant="outline" className="font-semibold capitalize">{sync.status}</Badge>;
  };

  const supplierLabel = (supplier?: Supplier | null) => {
    if (!supplier) return '';
    const code = supplier.sage_code || supplier.code;
    return code ? `${code} - ${supplier.name}` : supplier.name;
  };

  const filteredGRNs = grns.filter(grn => {
    const matchesSearch = grn.grn_number.toLowerCase().includes(search.toLowerCase()) ||
      grn.suppliers?.name.toLowerCase().includes(search.toLowerCase()) ||
      grn.suppliers?.code?.toLowerCase().includes(search.toLowerCase()) ||
      grn.suppliers?.sage_code?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || grn.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: grns.length,
    pending: grns.filter(g => g.status === 'pending').length,
    approved: grns.filter(g => g.status === 'approved').length,
    thisMonth: grns.filter(g => {
      const grnDate = new Date(g.created_at);
      const now = new Date();
      return grnDate.getMonth() === now.getMonth() && grnDate.getFullYear() === now.getFullYear();
    }).length,
  };

  const sageActivity = Object.values(syncByGrnId).reduce(
    (totals, sync) => {
      if (sync.status === 'pending') totals.queued += 1;
      if (sync.status === 'processing') totals.processing += 1;
      if (sync.status === 'success') totals.posted += 1;
      if (sync.status === 'failed') totals.failed += 1;
      return totals;
    },
    { queued: 0, processing: 0, posted: 0, failed: 0 },
  );

  const totalOrderedQty = items.reduce((sum, item) => sum + (Number(item.ordered_qty) || 0), 0);
  const totalReceivedQty = items.reduce((sum, item) => sum + (Number(item.received_qty) || 0), 0);
  const totalReceivedValue = items.reduce(
    (sum, item) => sum + (Number(item.received_qty) || 0) * (Number(item.unit_cost) || 0),
    0
  );
  const wbNettMassValue = Number(wbForm.nett_mass || 0);
  const wbVariancePct = wbNettMassValue > 0 ? Math.abs((totalReceivedQty - wbNettMassValue) / wbNettMassValue) * 100 : 0;
  const selectedSync = viewing ? syncByGrnId[viewing.id] : undefined;
  const selectedGrvNumber = getSageGrvNumber(selectedSync);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 font-medium animate-pulse">Loading Goods Received Notes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-5 max-w-[1600px] mx-auto">
      <StockTakeFrozenBanner />
      
      <StickyOperationsPanel>
        <section className="overflow-hidden rounded-lg border border-[#0d2036] bg-[#0d2036] text-white shadow-lg shadow-slate-900/20">
          <div className="flex flex-col gap-5 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="border border-[#f39200]/70 bg-[#f39200]/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#ffc36b]">Inbound receiving</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Sage connected</span>
              </div>
              <h1 className="mt-3 text-2xl font-bold">Goods Received Notes</h1>
              <p className="mt-1 text-sm text-slate-300">Live receiving control for raw-material deliveries and Sage GRV posting.</p>
            </div>
            <Button onClick={() => setModalOpen(true)} size="lg" className="h-auto shrink-0 rounded-none bg-[#f39200] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-black/20 hover:bg-[#dc8500]">
              <Plus className="mr-2 h-5 w-5" />
              New GRN Delivery
            </Button>
          </div>

          <div className="grid border-t border-white/10 sm:grid-cols-2 xl:grid-cols-5">
            <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Register</p><p className="mt-2 text-3xl font-bold">{stats.total}</p><p className="mt-1 text-xs text-slate-400">Received notes</p></div>
            <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Awaiting Finance</p><p className="mt-2 text-3xl font-bold text-[#ffc36b]">{stats.pending}</p><p className="mt-1 text-xs text-slate-400">Ready for VAT review</p></div>
            <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Sage Posted</p><p className="mt-2 text-3xl font-bold text-emerald-300">{stats.approved}</p><p className="mt-1 text-xs text-slate-400">GRVs confirmed</p></div>
            <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">This Month</p><p className="mt-2 text-3xl font-bold text-cyan-300">{stats.thisMonth}</p><p className="mt-1 text-xs text-slate-400">Current receipts</p></div>
            <div className="px-5 py-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Live Sage activity</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="inline-flex items-center gap-1.5 text-[#ffc36b]"><span className="h-1.5 w-1.5 rounded-full bg-[#f39200]" />Queued {sageActivity.queued}</span><span className="inline-flex items-center gap-1.5 text-cyan-300"><Loader2 className={`h-3.5 w-3.5 ${sageActivity.processing > 0 ? 'animate-spin' : ''}`} />Processing {sageActivity.processing}</span><span className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircle className="h-3.5 w-3.5" />Posted {sageActivity.posted}</span>{sageActivity.failed > 0 && <span className="inline-flex items-center gap-1.5 text-rose-300"><AlertCircle className="h-3.5 w-3.5" />Failed {sageActivity.failed}</span>}</div><p className="mt-2 text-xs text-slate-400">Current bridge queue</p></div>
            </div>
        </section>
      </StickyOperationsPanel>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by GRN number, supplier, or Sage code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-slate-50/50 border-slate-200 focus:bg-white"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all shrink-0 ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* GRNs View: Desktop Table + Mobile Card Grid */}
      <Card className="border border-slate-200 shadow-md overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 py-3 px-5">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-bold text-slate-900">Delivery Register</CardTitle>
              <CardDescription className="text-xs text-slate-500">View, inspect, and approve incoming goods notes</CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs text-slate-600 bg-white">
              {filteredGRNs.length} record(s)
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow className="bg-slate-100/70 hover:bg-slate-100/70">
                  <TableHead className="w-[155px] font-bold text-slate-700">GRN Number</TableHead>
                  <TableHead className="font-bold text-slate-700">Supplier</TableHead>
                  <TableHead className="hidden xl:table-cell w-[105px] font-bold text-slate-700">Weigh Bridge</TableHead>
                  <TableHead className="w-[118px] font-bold text-slate-700">Received</TableHead>
                  <TableHead className="w-[104px] font-bold text-slate-700">Status</TableHead>
                  <TableHead className="w-[180px] font-bold text-slate-700">Sage Live Status</TableHead>
                  <TableHead className="w-[100px] text-right font-bold text-slate-700 pr-5">Inspect</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGRNs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-400 py-12">
                      No Goods Received Notes found matching criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGRNs.map((grn) => (
                    <TableRow key={grn.id} className="hover:bg-slate-50/80 transition-colors">
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-2">
                          {(grn as any).wb_transaction_no && (
                            <span title="Weigh Bridge data captured"><Scale className="w-4 h-4 text-emerald-600 shrink-0" /></span>
                          )}
                          <span className="font-mono text-xs bg-slate-100 text-slate-800 px-2 py-1 rounded border border-slate-200">{grn.grn_number}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-slate-900 truncate" title={supplierLabel(grn.suppliers)}>{supplierLabel(grn.suppliers)}</TableCell>
                      <TableCell className="hidden xl:table-cell text-slate-600 font-mono text-xs truncate">{(grn as any).wb_transaction_no || (grn as any).weigh_bridge_ticket_no || '-'}</TableCell>
                      <TableCell className="text-slate-700">{format(new Date(grn.received_date), 'MMM d, yyyy')}</TableCell>
                      <TableCell>{getStatusBadge(grn.status)}</TableCell>
                      <TableCell>{getSageBadge(grn.id)}</TableCell>
                      <TableCell className="text-right pr-5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewGRN(grn)}
                          className="hover:bg-orange-50 hover:text-orange-700 border-slate-300 font-semibold"
                        >
                          <Eye className="h-4 w-4" />
                          <span className="sr-only">Inspect {grn.grn_number}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card List View (Phones & Tablets) */}
          <div className="block md:hidden divide-y divide-slate-100">
            {filteredGRNs.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No Goods Received Notes found matching criteria
              </div>
            ) : (
              filteredGRNs.map((grn) => (
                <div key={grn.id} className="p-4 space-y-3 bg-white hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold bg-slate-900 text-white px-2 py-1 rounded">
                        {grn.grn_number}
                      </span>
                      {(grn as any).wb_transaction_no && (
                        <Badge variant="outline" className="text-[10px] text-teal-700 border-teal-300 bg-teal-50">
                          <Scale className="w-3 h-3 mr-1 text-teal-600 inline" /> WB Ticket
                        </Badge>
                      )}
                    </div>
                    {getStatusBadge(grn.status)}
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Sage</span>
                    {getSageBadge(grn.id)}
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-900 text-base">{supplierLabel(grn.suppliers)}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Received: {format(new Date(grn.received_date), 'PPP')}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-[11px] text-slate-400">
                      {format(new Date(grn.created_at), 'MMM d, HH:mm')}
                    </span>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleViewGRN(grn)}
                      className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      View Details
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create GRN Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[1440px] w-[calc(100vw-24px)] h-[94vh] max-h-[94vh] p-0 sm:!max-w-[1440px] flex flex-col overflow-hidden rounded-lg border border-slate-200 shadow-2xl [&>button.absolute]:hidden">
          <DialogHeader className="shrink-0 bg-[#0b0b30] text-white px-5 py-3.5 relative border-b border-[#ff9100]/30">
            <div className="flex items-center justify-between pr-10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#ff9100]/15 border border-[#ff9100]/35 rounded-lg flex items-center justify-center">
                  <Package className="w-5 h-5 text-orange-200" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <DialogTitle className="text-lg font-extrabold tracking-tight text-white">Create GRN Delivery</DialogTitle>
                    <span className="text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Draft</span>
                  </div>
                  <DialogDescription className="text-slate-400 text-xs font-medium mt-0.5">
                    Capture supplier receipt, weighbridge evidence, raw material lines and Sage approval value.
                  </DialogDescription>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 bg-[#ff9100]/10 border border-[#ff9100]/25 px-3 py-1.5 rounded-lg text-orange-200 font-semibold">
                  <div className="w-2 h-2 rounded-full bg-[#ff9100]" />
                  Finance review enabled
                </div>
              </div>
            </div>
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 border border-white/20 flex items-center justify-center transition-colors text-white"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-[#f3f6f9]" style={{ scrollbarWidth: 'thin' }}>
            <div className="border-b border-slate-200 bg-white px-4 py-2.5">
              <div className="mx-auto grid max-w-[1380px] grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  ['01', 'Receipt details', Boolean(supplierId && receivedDate)],
                  ['02', 'Finance references', Boolean(supplierInvoiceNo || supplierDeliveryNoteNo || supplierOrderNo || externalReference)],
                  ['03', 'Weighbridge', Boolean(weighBridgeTicketId)],
                  ['04', 'Material lines', items.every((item) => Boolean(item.raw_material_id && Number(item.received_qty) > 0))],
                ].map(([step, label, complete]) => (
                  <div key={String(step)} className={`flex min-h-9 items-center gap-2 border px-3 py-1.5 ${complete ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                    <span className={`font-mono text-[10px] font-bold ${complete ? 'text-emerald-700' : 'text-slate-400'}`}>{step}</span>
                    <span className={`truncate text-xs font-bold ${complete ? 'text-emerald-900' : 'text-slate-600'}`}>{label}</span>
                    {complete && <CheckCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 p-4 [&_input]:h-10 [&_[role='combobox']]:h-10">
              <div className="space-y-4">

                {/* GRN Header Panel */}
                <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 min-w-8 items-center justify-center rounded-md bg-[#0b0b30] px-2 text-[10px] font-black text-orange-300">
                        01
                      </div>
                      <div>
                        <p className="text-sm font-extrabold text-slate-900">Receipt Details</p>
                        <p className="text-[11px] text-slate-500">Supplier, receipt date and delivery notes</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold bg-orange-50 text-orange-800 border border-orange-200 px-2.5 py-1 rounded-full uppercase tracking-wider">Required</span>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(320px,1.35fr)_220px_minmax(260px,1fr)]">
                      <div className="space-y-1.5">
                        <Label htmlFor="supplier" className="text-xs font-bold text-slate-700 uppercase tracking-wide">Supplier *</Label>
                        <Select value={supplierId} onValueChange={setSupplierId}>
                          <SelectTrigger className="bg-white border-slate-300 font-medium focus:border-orange-500 focus:ring-orange-500/20">
                            <SelectValue placeholder="Select supplier..." />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers.map((supplier) => (
                              <SelectItem key={supplier.id} value={supplier.id}>
                                {supplierLabel(supplier)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="received_date" className="text-xs font-bold text-slate-700 uppercase tracking-wide">Received Date *</Label>
                        <Input
                          id="received_date"
                          type="date"
                          value={receivedDate}
                          onChange={(e) => setReceivedDate(e.target.value)}
                          className="bg-white border-slate-300 font-medium focus:border-orange-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="notes" className="text-xs font-bold text-slate-700 uppercase tracking-wide">Delivery Notes</Label>
                        <Textarea
                          id="notes"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Optional delivery note..."
                          rows={1}
                          className="h-10 min-h-10 resize-none bg-white border-slate-300 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

              {/* Sage Reference Controls */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 min-w-8 items-center justify-center rounded-md bg-[#0b0b30] px-2 text-[10px] font-black text-orange-300">
                      02
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">Sage & Finance References</p>
                      <p className="text-[11px] text-slate-500 font-medium">Document references for matching and audit traceability</p>
                    </div>
                  </div>
                  <span className="hidden text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:inline">Optional at capture</span>
                </div>
                <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Supplier Invoice No</Label>
                    <Input
                      value={supplierInvoiceNo}
                      onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                      placeholder="e.g. INV27539"
                      className="bg-white border-slate-300 font-mono focus:border-orange-500 focus:ring-orange-500/20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Supplier Delivery Note No</Label>
                    <Input
                      value={supplierDeliveryNoteNo}
                      onChange={(e) => setSupplierDeliveryNoteNo(e.target.value)}
                      placeholder="e.g. DN-4567"
                      className="bg-white border-slate-300 font-mono focus:border-orange-500 focus:ring-orange-500/20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Supplier Order / PO No</Label>
                    <Input
                      value={supplierOrderNo}
                      onChange={(e) => setSupplierOrderNo(e.target.value)}
                      placeholder="e.g. PO61092"
                      className="bg-white border-slate-300 font-mono focus:border-orange-500 focus:ring-orange-500/20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">External / Weighbridge Ref</Label>
                    <Input
                      value={externalReference}
                      onChange={(e) => setExternalReference(e.target.value)}
                      placeholder="Defaults to WB ticket if left blank"
                      className="bg-white border-slate-300 font-mono focus:border-orange-500 focus:ring-orange-500/20"
                    />
                  </div>
                </div>
              </div>

              {/* Weigh Bridge Ticket Section */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setWbExpanded(!wbExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-200 text-left hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center text-orange-700 border border-orange-100">
                      <Scale className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">Weighbridge Evidence</p>
                      <p className="text-[11px] text-slate-500 font-medium">Link a matching PlantControl weighbridge ticket</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {weighBridgeTicketId && <span className="text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200 px-2 py-1 rounded-full uppercase tracking-wider">Linked</span>}
                    {wbExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                  </div>
                </button>

                {wbExpanded && (
                  <div className="p-5 space-y-5">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                        <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Link Existing Ticket</Label>
                        <p className="text-xs text-slate-500">This screen cannot create or edit weighbridge tickets. Select a matching open ticket captured in PlantControl.</p>
                      <div className="flex flex-col md:flex-row md:items-center gap-2">
                        <Select
                          value={weighBridgeTicketId}
                          onValueChange={(val) => {
                            setWeighBridgeTicketId(val);
                            const ticket = wbTickets.find((t: any) => t.id === val);
                            if (ticket) {
                              const matchedMaterial = materials.find((m) => m.code === ticket.product_code || (m as any).sage_code === ticket.product_code);
                              if (ticket.supplier_id) {
                                setSupplierId(ticket.supplier_id);
                              }
                              if (ticket.ticket_no && !externalReference) {
                                setExternalReference(ticket.ticket_no);
                              }
                              if (matchedMaterial) {
                                setItems((prev) => {
                                  const next = prev.length > 0 ? [...prev] : [{ ...emptyItem }];
                                  next[0] = {
                                    ...next[0],
                                    raw_material_id: matchedMaterial.id,
                                    received_qty: ticket.nett_mass != null && !next[0].received_qty ? Number(ticket.nett_mass) : next[0].received_qty,
                                    ordered_qty: ticket.nett_mass != null && !next[0].ordered_qty ? Number(ticket.nett_mass) : next[0].ordered_qty,
                                  };
                                  return next;
                                });
                              }
                              setWbForm({
                                transaction_no: ticket.ticket_no || '',
                                vehicle_reg: ticket.vehicle_reg || '',
                                haulier_code: ticket.haulier_code || 'HYPER',
                                product_code: ticket.product_code || '',
                                comment: ticket.comment || '',
                                trailer_number: ticket.trailer_number || '',
                                driver_name: ticket.driver_name || '',
                                driver_id: ticket.driver_id || '',
                                time_in: ticket.time_in ? ticket.time_in.slice(0, 16) : '',
                                first_mass: ticket.first_mass != null ? String(ticket.first_mass) : '',
                                time_out: ticket.time_out ? ticket.time_out.slice(0, 16) : '',
                                second_mass: ticket.second_mass != null ? String(ticket.second_mass) : '',
                                nett_mass: ticket.nett_mass != null ? String(ticket.nett_mass) : '',
                                driver_signed: ticket.driver_signed || false,
                              });
                            }
                          }}
                        >
                          <SelectTrigger className="md:flex-1 bg-white border-slate-300">
                            <SelectValue placeholder="Select an existing ticket..." />
                          </SelectTrigger>
                          <SelectContent>
                            {wbTickets.map((t: any) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.ticket_no} | {t.product_name || t.product_code || 'No product'} | {t.suppliers?.name || 'No supplier'} | {t.vehicle_reg || 'No reg'} | {t.nett_mass != null ? `${Number(t.nett_mass).toLocaleString()} kg` : 'No mass'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {weighBridgeTicketId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setWeighBridgeTicketId('');
                              setWbForm({
                                transaction_no: '', vehicle_reg: '', haulier_code: 'HYPER', product_code: '',
                                comment: '', trailer_number: '', driver_name: '', driver_id: '',
                                time_in: '', first_mass: '', time_out: '', second_mass: '', nett_mass: '', driver_signed: false,
                              });
                            }}
                            className="text-slate-600 hover:text-red-600 shrink-0"
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                      {wbTickets.length === 0 && (
                        <p className="text-xs text-slate-500">No open WB tickets. Go to <strong>Weigh Bridge</strong> to create one first.</p>
                      )}
                    </div>

                    <fieldset disabled className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {/* Vehicle & Driver */}
                      <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                        <div className="bg-white border-b border-slate-200 px-4 py-3">
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Vehicle & Driver</p>
                        </div>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Ticket No</Label>
                            <Input value={wbForm.transaction_no} onChange={(e) => setWbForm({ ...wbForm, transaction_no: e.target.value })} placeholder="WB-001" className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Vehicle Reg</Label>
                            <Input value={wbForm.vehicle_reg} onChange={(e) => setWbForm({ ...wbForm, vehicle_reg: e.target.value })} placeholder="ABC-1234" className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Haulier</Label>
                            <Input value={wbForm.haulier_code} onChange={(e) => setWbForm({ ...wbForm, haulier_code: e.target.value })} className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Trailer No</Label>
                            <Input value={wbForm.trailer_number} onChange={(e) => setWbForm({ ...wbForm, trailer_number: e.target.value })} className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Driver Name</Label>
                            <Input value={wbForm.driver_name} onChange={(e) => setWbForm({ ...wbForm, driver_name: e.target.value })} className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Driver ID</Label>
                            <Input value={wbForm.driver_id} onChange={(e) => setWbForm({ ...wbForm, driver_id: e.target.value })} className="bg-white" />
                          </div>
                        </div>
                      </div>

                      {/* Weighing Data */}
                      <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                        <div className="bg-white border-b border-slate-200 px-4 py-3">
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Weighing Data</p>
                        </div>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Product Code</Label>
                            <Input value={wbForm.product_code} onChange={(e) => setWbForm({ ...wbForm, product_code: e.target.value })} className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Comment</Label>
                            <Input value={wbForm.comment} onChange={(e) => setWbForm({ ...wbForm, comment: e.target.value })} placeholder="Optional..." className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Time In</Label>
                            <Input type="datetime-local" value={wbForm.time_in} onChange={(e) => setWbForm({ ...wbForm, time_in: e.target.value })} className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Time Out</Label>
                            <Input type="datetime-local" value={wbForm.time_out} onChange={(e) => setWbForm({ ...wbForm, time_out: e.target.value })} className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">First Mass (kg)</Label>
                            <Input type="number" value={wbForm.first_mass} onChange={(e) => setWbForm({ ...wbForm, first_mass: e.target.value })} className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Second Mass (kg)</Label>
                            <Input type="number" value={wbForm.second_mass} onChange={(e) => setWbForm({ ...wbForm, second_mass: e.target.value })} className="bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Nett Mass (kg)</Label>
                            <Input type="number" value={wbForm.nett_mass} onChange={(e) => setWbForm({ ...wbForm, nett_mass: e.target.value })} className="bg-white font-bold" />
                          </div>
                          <div className="flex items-end">
                            <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-200 bg-white w-full cursor-pointer">
                              <input
                                type="checkbox"
                                id="wb_driver_signed"
                                checked={wbForm.driver_signed}
                                onChange={(e) => setWbForm({ ...wbForm, driver_signed: e.target.checked })}
                                className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                              />
                              <Label htmlFor="wb_driver_signed" className="text-xs font-semibold cursor-pointer">Driver Signed</Label>
                            </div>
                          </div>
                        </div>
                      </div>
                    </fieldset>
                  </div>
                )}
              </div>

              {/* Line Items Section */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 min-w-8 items-center justify-center rounded-md bg-[#0b0b30] px-2 text-[10px] font-black text-orange-300">
                      04
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">Raw Material Lines</p>
                      <p className="text-[11px] text-slate-500">{items.length} receipt line{items.length !== 1 ? 's' : ''} captured</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={addItem}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Item
                  </button>
                </div>

                <div className="space-y-3 p-4">
                  {items.map((item, index) => (
                    <div key={index} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                      {/* Item header */}
                      <div className="flex items-center justify-between border-b border-slate-200 bg-[#0b0b30] px-3.5 py-2.5 text-white">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded bg-orange-500 text-[10px] font-black text-white">{index + 1}</span>
                          <span className="text-xs font-bold uppercase tracking-wide text-white">Material line {index + 1}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex gap-2 text-xs">
                            <span className="rounded border border-white/15 bg-white/10 px-2 py-0.5 font-mono font-bold text-slate-200">{Number(item.received_qty || 0).toLocaleString()} kg</span>
                            <span className="rounded border border-orange-400/25 bg-orange-500/15 px-2 py-0.5 font-mono font-bold text-orange-200">${formatMoney((Number(item.received_qty) || 0) * (Number(item.unit_cost) || 0))}</span>
                          </div>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeItem(index)}
                              className="rounded border border-rose-300/30 px-2.5 py-1 text-xs font-bold text-rose-200 transition-colors hover:bg-rose-500/15 hover:text-white"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Compact material entry row */}
                      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-7">
                        <div className="col-span-2 space-y-1.5 xl:col-span-2">
                          <Label className="text-xs font-bold uppercase tracking-wide text-slate-700">Raw Material *</Label>
                          <Select
                            value={item.raw_material_id}
                            onValueChange={(value) => updateItem(index, 'raw_material_id', value)}
                          >
                            <SelectTrigger className="bg-white border-slate-300 font-medium focus:border-orange-500">
                              <SelectValue placeholder="Select material" />
                            </SelectTrigger>
                            <SelectContent>
                              {materials.map((material) => (
                                <SelectItem key={material.id} value={material.id}>
                                  {material.code} — {material.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-500">Ordered Qty</Label>
                          <Input
                            type="number"
                            value={item.ordered_qty}
                            onChange={(e) => updateItem(index, 'ordered_qty', parseLineItemNumber(e.target.value))}
                            step="0.01"
                            className="bg-white border-slate-200"
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-bold text-orange-600">Received Qty *</Label>
                          <Input
                            type="number"
                            value={item.received_qty}
                            onChange={(e) => updateItem(index, 'received_qty', parseLineItemNumber(e.target.value))}
                            step="0.01"
                            className="bg-white border-orange-300 focus:border-orange-500 font-extrabold text-slate-900"
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-500">Unit Cost ($)</Label>
                          <Input
                            type="number"
                            value={item.unit_cost}
                            onChange={(e) => updateItem(index, 'unit_cost', parseLineItemNumber(e.target.value))}
                            step="0.0001"
                            className="bg-white border-slate-200 font-medium"
                            placeholder="0.0000"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-500">Batch Number</Label>
                          <Input
                            value={item.batch_number}
                            onChange={(e) => updateItem(index, 'batch_number', e.target.value)}
                            className="bg-white border-slate-200 font-mono"
                            placeholder="e.g. BTH-001"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-500">Expiry Date</Label>
                          <Input
                            type="date"
                            value={item.expiry_date}
                            onChange={(e) => updateItem(index, 'expiry_date', e.target.value)}
                            className="bg-white border-slate-200"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                </div>
              </div>

              </div>

              {/* Receipt Overview Panel */}
              <aside className="lg:sticky lg:top-4 h-fit rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center border border-white/15 text-orange-300">
                      <Hash className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-white">Receipt Summary</p>
                      <p className="text-[11px] text-slate-400">Live quantity and value controls</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  <div className="border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total Ordered</p>
                    <p className="font-extrabold text-slate-900 text-lg mt-0.5 font-mono">{totalOrderedQty.toLocaleString()} <span className="text-[10px] font-medium text-slate-500">kg</span></p>
                  </div>
                  <div className="border border-orange-200 bg-orange-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-orange-800">Total Received</p>
                    <p className="font-extrabold text-slate-900 text-lg mt-0.5 font-mono">{totalReceivedQty.toLocaleString()} <span className="text-[10px] font-medium text-orange-800">kg</span></p>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Weighbridge Nett</p>
                    <p className="font-extrabold text-slate-900 text-lg mt-0.5 font-mono">{wbNettMassValue ? wbNettMassValue.toLocaleString() : 0} <span className="text-[10px] font-medium text-slate-500">kg</span></p>
                  </div>
                  <div className="border border-orange-200 bg-orange-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-orange-800">Estimated Value</p>
                    <p className="font-extrabold text-slate-900 text-lg mt-0.5 font-mono">${totalReceivedValue.toFixed(2)}</p>
                  </div>

                  <div className={`col-span-2 px-3 py-2.5 text-[11px] font-medium flex items-start gap-2 ${wbNettMassValue > 0 && wbVariancePct > 2 ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
                    <div className={`w-2 h-2 rounded-full mt-1 ${wbNettMassValue > 0 && wbVariancePct > 2 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <span>
                      {wbNettMassValue > 0
                        ? `Variance: ${wbVariancePct.toFixed(1)}% between GRN received quantity and weighbridge nett mass.`
                        : 'Variance check will appear once a weighbridge nett mass is captured.'}
                    </span>
                  </div>
                </div>
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-slate-500">Supplier</span>
                    <span className={`font-bold ${supplierId ? 'text-emerald-700' : 'text-amber-700'}`}>{supplierId ? 'Selected' : 'Required'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-slate-500">Material lines</span>
                    <span className={`font-bold ${items.every((item) => Boolean(item.raw_material_id && Number(item.received_qty) > 0)) ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {items.every((item) => Boolean(item.raw_material_id && Number(item.received_qty) > 0)) ? 'Complete' : 'Incomplete'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-slate-500">Weighbridge evidence</span>
                    <span className={`font-bold ${weighBridgeTicketId ? 'text-emerald-700' : 'text-slate-500'}`}>{weighBridgeTicketId ? 'Linked' : 'Optional'}</span>
                  </div>
                </div>
              </aside>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
            <div className="hidden items-center gap-2 sm:flex">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <p className="text-xs text-slate-500 font-medium">Approval posts this GRN to Sage 200 Evolution</p>
            </div>
            <div className="flex gap-3 ml-auto">
              <button
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="px-5 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveGRN}
                disabled={saving}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-[#ff9100] hover:bg-[#e67f00] rounded-lg shadow-sm transition-all disabled:opacity-50"
              >
                {saving ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating...</>
                ) : (
                  <><Package className="w-4 h-4" /> Create GRN</>
                )}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRetrySageDialog} onOpenChange={setShowRetrySageDialog}>
        <DialogContent className="max-w-md overflow-hidden p-0">
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900">Retry Sage GRV posting</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-slate-600">
                  Requeue this approved GRN after reviewing the Sage error.
                </DialogDescription>
              </div>
            </div>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">GRN</p>
              <p className="mt-1 font-mono text-sm font-bold text-slate-900">{viewing?.grn_number}</p>
            </div>
            <p className="text-sm leading-6 text-slate-700">
              The bridge checks Sage for this MES GRN reference before posting. If a GRV already exists, it returns that document instead of creating another one.
            </p>
            <div className="flex justify-end gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowRetrySageDialog(false)}
                disabled={retryingSagePost}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={retryFailedSagePosting}
                disabled={retryingSagePost}
                className="bg-rose-700 text-white hover:bg-rose-800"
              >
                {retryingSagePost ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                {retryingSagePost ? 'Requeuing...' : 'Confirm Retry'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View GRN Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="max-w-[1320px] w-[98vw] h-[94vh] max-h-[94vh] p-0 sm:!max-w-[1320px] flex flex-col [&>button.absolute]:hidden">
          {/* Header Banner */}
          <div className="bg-slate-900 text-white px-5 py-3 rounded-t-lg flex-shrink-0 relative">
            <div className="flex items-center justify-between pr-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">{viewing?.grn_number}</h2>
                  <p className="text-slate-400 text-xs">
                    <Calendar className="w-3 h-3 inline mr-1" />
                    Received {viewing && format(new Date(viewing.received_date), 'PPP')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {viewing && getSageBadge(viewing.id)}
                {viewing && (
                  <Badge
                    variant={viewing.status === 'approved' ? 'default' : viewing.status === 'rejected' ? 'destructive' : 'secondary'}
                    className="text-sm px-3 py-1 capitalize"
                  >
                    {viewing.status}
                  </Badge>
                )}
              </div>
            </div>
            {/* Close Button */}
            <button
              onClick={() => setViewModalOpen(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Approval Actions */}
          {viewing && viewing.status === 'pending' && (
            <div className="flex-shrink-0 px-5 py-2 bg-white border-b border-slate-200">
              <GRNApprovalButtons
                grnId={viewing.id}
                currentStatus={viewing.status}
                vatMode={(viewing as any).vat_mode}
                vatReviewedAt={(viewing as any).vat_reviewed_at}
                onApproved={() => { setViewModalOpen(false); fetchData(); }}
                onRejected={() => { setViewModalOpen(false); fetchData(); }}
                onTaxReviewed={(vatMode) => {
                  setViewing((current) => current ? {
                    ...current,
                    vat_mode: vatMode,
                    vat_reviewed_at: new Date().toISOString(),
                  } as any : current);
                  fetchData();
                }}
              />
            </div>
          )}

          {/* Rejection Reason */}
          {viewing && (viewing as any).rejection_reason && (
            <div className="flex-shrink-0 mx-5 mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-red-800">Rejection: <span className="font-normal text-red-700">{(viewing as any).rejection_reason}</span></p>
            </div>
          )}

          {viewing && (
            <div className={`flex-shrink-0 mx-5 mt-2 rounded-lg px-3 py-2 border ${
              selectedSync?.status === 'success'
                ? 'bg-emerald-50 border-emerald-200'
                : selectedSync?.status === 'failed'
                  ? 'bg-rose-50 border-rose-200'
                  : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {getSageBadge(viewing.id)}
                  <span className="text-xs font-semibold text-slate-700">
                    {selectedSync?.message || (viewing.status === 'approved' ? 'Waiting for Sage bridge posting result' : 'Sage posting starts after approval')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 font-semibold uppercase tracking-wide">Sage GRV</span>
                  <span className="font-mono font-bold text-slate-900">{selectedGrvNumber || '-'}</span>
                </div>
              </div>
              {selectedSync?.status === 'failed' && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-rose-700">{getSageErrorMessage(selectedSync)}</p>
                  {canRetrySagePosting && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShowRetrySageDialog(true)}
                      disabled={retryingSagePost}
                      className="bg-rose-700 text-white hover:bg-rose-800"
                    >
                      {retryingSagePost ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                      {retryingSagePost ? 'Requeuing...' : 'Retry Sage GRV'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Main Content - Two Column */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 h-full">
              {/* Left Column: Info + Weigh Bridge */}
              <div className="xl:col-span-4 space-y-2">
                {/* Supplier / Warehouse / Created - compact inline */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="border-l-3 border-l-blue-500 bg-white rounded-lg border border-slate-200 p-2.5">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Supplier</p>
                    <p className="text-xs font-semibold text-slate-800 mt-0.5">{supplierLabel(viewing?.suppliers) || 'N/A'}</p>
                  </div>
                  <div className="border-l-3 border-l-amber-500 bg-white rounded-lg border border-slate-200 p-2.5">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Warehouse</p>
                    <p className="text-xs font-semibold text-slate-800 mt-0.5">{viewing?.warehouses?.name || 'N/A'}</p>
                  </div>
                </div>
                <div className="border-l-3 border-l-emerald-500 bg-white rounded-lg border border-slate-200 p-2.5">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Created</p>
                  <p className="text-xs font-semibold text-slate-800 mt-0.5">{viewing && format(new Date(viewing.created_at), 'PPP')}</p>
                </div>
                <div className="border-l-3 border-l-purple-500 bg-white rounded-lg border border-slate-200 p-2.5">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Initiated By</p>
                  <p className="text-xs font-semibold text-slate-800 mt-0.5">{(viewing as any)?.receiver?.full_name || (viewing as any)?.receiver?.email || 'System'}</p>
                </div>
                <div className="border-l-3 border-l-teal-500 bg-white rounded-lg border border-slate-200 p-2.5">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Sage GRV Number</p>
                  <p className="text-xs font-mono font-bold text-slate-800 mt-0.5">{selectedGrvNumber || '-'}</p>
                </div>

                {(viewing as any)?.supplier_invoice_no || (viewing as any)?.supplier_delivery_note_no || (viewing as any)?.supplier_order_no || (viewing as any)?.external_reference ? (
                  <div className="bg-blue-50/70 rounded-lg border border-blue-200 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                      <h3 className="text-xs font-semibold text-slate-700">Sage / Finance References</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-y-1 text-xs">
                      <div><span className="text-slate-400">Supplier Invoice:</span> <span className="font-mono text-slate-800">{(viewing as any).supplier_invoice_no || '-'}</span></div>
                      <div><span className="text-slate-400">Delivery Note:</span> <span className="font-mono text-slate-800">{(viewing as any).supplier_delivery_note_no || '-'}</span></div>
                      <div><span className="text-slate-400">Order / PO:</span> <span className="font-mono text-slate-800">{(viewing as any).supplier_order_no || '-'}</span></div>
                      <div><span className="text-slate-400">External Ref:</span> <span className="font-mono text-slate-800">{(viewing as any).external_reference || '-'}</span></div>
                    </div>
                  </div>
                ) : null}

                {/* Weigh Bridge Ticket */}
                {viewing && (viewing as any).wb_transaction_no && (
                  <div className="bg-white rounded-lg border border-teal-200 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Scale className="w-3.5 h-3.5 text-teal-600" />
                      <h3 className="text-xs font-semibold text-slate-700">Weigh Bridge Ticket</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div><span className="text-slate-400">Ticket:</span> <span className="font-mono text-slate-800">{(viewing as any).wb_transaction_no}</span></div>
                      <div><span className="text-slate-400">Vehicle:</span> <span className="text-slate-800">{(viewing as any).wb_vehicle_reg || '-'}</span></div>
                      <div><span className="text-slate-400">Haulier:</span> <span className="text-slate-800">{(viewing as any).wb_haulier_code || '-'}</span></div>
                      <div><span className="text-slate-400">Driver:</span> <span className="text-slate-800">{(viewing as any).wb_driver_name || '-'}</span></div>
                      <div><span className="text-slate-400">1st Mass:</span> <span className="text-slate-800">{(viewing as any).wb_first_mass != null ? `${(viewing as any).wb_first_mass} kg` : '-'}</span></div>
                      <div><span className="text-slate-400">2nd Mass:</span> <span className="text-slate-800">{(viewing as any).wb_second_mass != null ? `${(viewing as any).wb_second_mass} kg` : '-'}</span></div>
                      <div><span className="text-slate-400">Nett:</span> <span className="font-semibold text-teal-700">{(viewing as any).wb_nett_mass != null ? `${(viewing as any).wb_nett_mass} kg` : '-'}</span></div>
                      <div><span className="text-slate-400">Signed:</span> <span className="text-slate-800">{(viewing as any).wb_driver_signed ? 'Yes' : 'No'}</span></div>
                    </div>
                    {(viewing as any).wb_comment && (
                      <p className="text-[10px] text-slate-500 mt-1.5 italic">{(viewing as any).wb_comment}</p>
                    )}
                  </div>
                )}

                {/* Notes */}
                {viewing?.notes && (
                  <div className="bg-amber-50/60 rounded-lg border border-amber-200 p-2.5">
                    <div className="flex items-start gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-slate-700">{viewing.notes}</p>
                    </div>
                  </div>
                )}

                {/* Approval History & Attachments - compact */}
                {viewing && (
                  <div className="space-y-1.5 pt-1">
                    <details className="bg-white rounded-lg border border-slate-200">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600 px-2.5 py-1.5">Approval History</summary>
                      <div className="px-2.5 pb-2">
                        <ApprovalHistory entityType="grn" entityId={viewing.id} />
                      </div>
                    </details>
                    <details className="bg-white rounded-lg border border-slate-200">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600 px-2.5 py-1.5">Attachments</summary>
                      <div className="px-2.5 pb-2">
                        <GRNAttachments grnId={viewing.id} />
                      </div>
                    </details>
                  </div>
                )}
              </div>

              {/* Right Column: Line Items + Totals */}
              <div className="xl:col-span-8 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <Scale className="w-4 h-4 text-slate-600" />
                  <h3 className="text-sm font-bold text-slate-800">Line Items</h3>
                  <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">{viewItems.length} item{viewItems.length !== 1 ? 's' : ''}</span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm flex-1 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 hover:bg-slate-50">
                        <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider py-2 px-3">Material</TableHead>
                        <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right py-2 px-3 w-[80px]">Ordered</TableHead>
                        <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right py-2 px-3 w-[80px]">Received</TableHead>
                        <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right py-2 px-3 w-[80px]">Unit Cost</TableHead>
                        <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right py-2 px-3 w-[90px]">Line Total</TableHead>
                        <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider py-2 px-3 w-[100px]">Batch</TableHead>
                        <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider py-2 px-3 w-[90px]">Expiry</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewItems.map((item, index) => (
                        <TableRow key={index} className="hover:bg-slate-50/50">
                          <TableCell className="py-2 px-3">
                            <div>
                              <p className="text-xs font-semibold text-slate-800">{item.raw_materials?.name}</p>
                              <p className="text-[10px] text-slate-500 font-mono">{item.raw_materials?.code}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-right text-slate-600 py-2 px-3">{item.ordered_qty.toLocaleString()} kg</TableCell>
                          <TableCell className="text-xs text-right text-slate-800 py-2 px-3 font-semibold">{item.received_qty.toLocaleString()} kg</TableCell>
                          <TableCell className="text-xs text-right text-slate-600 py-2 px-3">${Number(item.unit_cost || 0).toFixed(4)}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-emerald-700 py-2 px-3">${formatMoney(item.received_qty * item.unit_cost)}</TableCell>
                          <TableCell className="text-xs text-slate-600 py-2 px-3">
                            {item.batch_number ? (
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-mono">{item.batch_number}</span>
                            ) : (
                              <span className="text-slate-400 text-[10px]">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600 py-2 px-3">
                            {item.expiry_date ? format(new Date(item.expiry_date), 'PP') : <span className="text-slate-400 text-[10px]">-</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Totals Footer */}
                <div className="mt-2 bg-slate-900 text-white rounded-xl p-3 flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-300">
                      Ordered: <strong className="text-white">{viewItems.reduce((s, i) => s + (i.ordered_qty || 0), 0).toLocaleString()} kg</strong>
                    </span>
                    <div className="w-px h-4 bg-slate-700" />
                    <span className="text-xs text-slate-300">
                      Received: <strong className="text-white">{viewItems.reduce((s, i) => s + (i.received_qty || 0), 0).toLocaleString()} kg</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 bg-emerald-500 px-3 py-1.5 rounded-lg">
                    <DollarSign className="w-4 h-4 text-white" />
                    <div>
                      <p className="text-[10px] text-emerald-100 font-medium">Total Value</p>
                      <p className="text-sm font-bold text-white">${viewItems.reduce((s, i) => s + (i.received_qty || 0) * (i.unit_cost || 0), 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
