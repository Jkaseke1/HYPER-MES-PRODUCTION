import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Eye, Package, Calendar, FileText, Hash, DollarSign, Scale, X, ChevronDown, ChevronUp, CheckCircle, AlertCircle, Loader2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import GRNApprovalButtons from '../components/approval/GRNApprovalButtons';
import ApprovalHistory from '../components/approval/ApprovalHistory';
import GRNAttachments from '../components/grn/GRNAttachments';
import ReturnToSupplierModal from '../components/grn/ReturnToSupplierModal';
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

function manualGrvDigits(value: string | null | undefined) {
  return String(value || '').replace(/^HFGRV/i, '').replace(/\D/g, '');
}

function manualGrvReference(value: string) {
  const digits = manualGrvDigits(value);
  return digits ? `HFGRV${digits}` : '';
}

function materialUnitLabel(material: Partial<RawMaterial> | null | undefined) {
  const code = String(material?.code || '').trim().toUpperCase();
  const name = String(material?.name || '').trim().toLowerCase();
  const storedUnit = String(material?.unit || '').trim().toLowerCase();

  if (['unit', 'units', 'each', 'ea', 'piece', 'pieces', 'pcs'].includes(storedUnit)) return 'units';
  if (name.includes('packaging') || code.startsWith('PA')) return 'units';
  return storedUnit || 'kg';
}

export default function GoodsReceivedPage() {
  const { profile } = useAuth();
  const canCompleteGrnCosting = ['admin', 'finance', 'production_receiver', 'supervisor', 'production_manager', 'raw_material_manager'].includes(profile?.role || '');
  const canManageGrnCorrections = ['admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'].includes(profile?.role || '');
  const [grns, setGrns] = useState<GoodsReceivedNote[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [materialSearch, setMaterialSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewing, setViewing] = useState<GoodsReceivedNote | null>(null);
  const [viewItems, setViewItems] = useState<any[]>([]);
  const [viewRts, setViewRts] = useState<any | null>(null);
  const canEditFinanceCosts = ['admin', 'finance', 'accountant'].includes(profile?.role || '');
  const [editingFinanceCosts, setEditingFinanceCosts] = useState(false);
  const [savingFinanceCosts, setSavingFinanceCosts] = useState(false);
  const [originalFinanceItems, setOriginalFinanceItems] = useState<any[]>([]);
  const [grnEditOpen, setGrnEditOpen] = useState(false);
  const [editingGrn, setEditingGrn] = useState<GoodsReceivedNote | null>(null);
  const [editSupplierId, setEditSupplierId] = useState('');
  const [editUnregisteredSupplierName, setEditUnregisteredSupplierName] = useState('');
  const [editWeighBridgeTicketId, setEditWeighBridgeTicketId] = useState('none');
  const [editManualGrvNumber, setEditManualGrvNumber] = useState('');
  const [editReceivedDate, setEditReceivedDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editItems, setEditItems] = useState<any[]>([]);
  const [savingGrnEdit, setSavingGrnEdit] = useState(false);
  const [missingGrvReference, setMissingGrvReference] = useState('');
  const [savingReference, setSavingReference] = useState(false);
  const [referenceFeedback, setReferenceFeedback] = useState('');
  const [missingSupplierCode, setMissingSupplierCode] = useState('');
  const [savingSupplierCode, setSavingSupplierCode] = useState(false);
  const [supplierCodeFeedback, setSupplierCodeFeedback] = useState('');
  const [adminSupplierCorrectionOpen, setAdminSupplierCorrectionOpen] = useState(false);
  const [adminSupplierId, setAdminSupplierId] = useState('');
  const [adminSupplierReason, setAdminSupplierReason] = useState('');
  const [savingAdminSupplierCorrection, setSavingAdminSupplierCorrection] = useState(false);
  const [showReturnToSupplierModal, setShowReturnToSupplierModal] = useState(false);
  const canManageReturns = ['admin', 'finance'].includes(profile?.role || '');
  useEffect(() => {
    setMissingGrvReference('');
    setReferenceFeedback('');
    setMissingSupplierCode('');
    setSupplierCodeFeedback('');
  }, [viewing?.id]);

  async function saveMissingGrvReference() {
    if (!viewing || savingReference) return;
    const grnId = viewing.id;
    setSavingReference(true);
    setReferenceFeedback('');
    try {
      const { data, error } = await supabase.rpc('complete_missing_manual_grv', {
        p_grn_id: grnId,
        p_manual_grv: missingGrvReference.trim(),
      });
      if (error) throw error;
      setViewing(current => current?.id === grnId ? { ...current, manual_grv_number: data } : current);
      setReferenceFeedback('Reference saved. You can now retry Sage GRV.');
      await fetchData();
    } catch (error: any) {
      setReferenceFeedback(error.message || 'Could not save the manual GRV reference.');
    } finally {
      setSavingReference(false);
    }
  }

  async function saveMissingSupplierCode() {
    if (!viewing || savingSupplierCode) return;
    const grnId = viewing.id;
    setSavingSupplierCode(true);
    setSupplierCodeFeedback('');
    try {
      const { data, error } = await supabase.rpc('complete_missing_supplier_sage_code', {
        p_grn_id: grnId,
        p_supplier_code: missingSupplierCode.trim(),
      });
      if (error) throw error;
      setSupplierCodeFeedback(`Sage supplier code ${data} saved. You can now retry Sage GRV.`);
      await fetchData();
    } catch (error: any) {
      setSupplierCodeFeedback(error.message || 'Could not save the Sage supplier code.');
    } finally {
      setSavingSupplierCode(false);
    }
  }

  const openAdminSupplierCorrection = () => {
    if (!viewing || profile?.role !== 'admin') return;
    setAdminSupplierId(viewing.supplier_id || '');
    setAdminSupplierReason('');
    setAdminSupplierCorrectionOpen(true);
  };

  const saveAdminSupplierCorrection = async () => {
    if (!viewing || !adminSupplierId || !adminSupplierReason.trim() || savingAdminSupplierCorrection) return;
    setSavingAdminSupplierCorrection(true);
    try {
      const { error } = await supabase.rpc('correct_failed_grn_supplier', {
        p_grn_id: viewing.id,
        p_supplier_id: adminSupplierId,
        p_reason: adminSupplierReason.trim(),
      });
      if (error) throw error;
      setAdminSupplierCorrectionOpen(false);
      await fetchData();
      toast.success(`${viewing.grn_number} supplier corrected. Review this GRN, then retry Sage.`);
    } catch (error: any) {
      toast.error(error.message || 'Could not correct the GRN supplier.');
    } finally {
      setSavingAdminSupplierCorrection(false);
    }
  };

  const [tonnageByGrnId, setTonnageByGrnId] = useState<Record<string, number>>({});
  const [syncByGrnId, setSyncByGrnId] = useState<Record<string, SageSyncStatus>>({});
  const notifiedSyncRef = useRef<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [retryingSagePost, setRetryingSagePost] = useState(false);
  const [showRetrySageDialog, setShowRetrySageDialog] = useState(false);
  const [submittingCosting, setSubmittingCosting] = useState(false);
  
  // Form state
  const [supplierId, setSupplierId] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const supplierPickerRef = useRef<HTMLDivElement>(null);
  const [unregisteredSupplierName, setUnregisteredSupplierName] = useState('');
  const [receivedDate, setReceivedDate] = useState(localDateInputValue);
  const [notes, setNotes] = useState('');
  const [manualGrvNumber, setManualGrvNumber] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [supplierDeliveryNoteNo, setSupplierDeliveryNoteNo] = useState('');
  const [supplierOrderNo, setSupplierOrderNo] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [weighBridgeTicketId, setWeighBridgeTicketId] = useState('');
  const [wbTickets, setWbTickets] = useState<any[]>([]);
  const [correctionWbTickets, setCorrectionWbTickets] = useState<any[]>([]);
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
      const [grnsRes, suppliersRes, materialsRes, wbRes, correctionWbRes] = await Promise.all([
        supabase.from('goods_received_notes').select('*, receiver:profiles!received_by(full_name, email), approver:profiles!approved_by(full_name), suppliers(name, code, sage_code), warehouses(name), weigh_bridge_tickets(ticket_no, status, vehicle_reg, nett_mass)').order('created_at', { ascending: false }),
        supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
        supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
        supabase.from('weigh_bridge_tickets').select('*, suppliers(name, code)').eq('status', 'open').order('created_at', { ascending: false }),
        supabase.from('weigh_bridge_tickets').select('*, suppliers(name, code, sage_code)').in('status', ['open', 'in_grn', 'linked']).order('created_at', { ascending: false }),
      ]);

      if (grnsRes.data) {
        setGrns(grnsRes.data as any);
        cacheData('goods_received_notes', grnsRes.data);
        await fetchSageSyncStatuses(grnsRes.data as any[], false);
        const grnIds = grnsRes.data.map((row: any) => row.id);
        const { data: grnItems } = grnIds.length
          ? await supabase.from('grn_items').select('grn_id, received_qty').in('grn_id', grnIds)
          : { data: [] };
        const totals: Record<string, number> = {};
        (grnItems || []).forEach((row: any) => {
          totals[row.grn_id] = (totals[row.grn_id] || 0) + Number(row.received_qty || 0);
        });
        setTonnageByGrnId(totals);
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
      if (correctionWbRes.data) setCorrectionWbTickets(correctionWbRes.data as any);

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
        if (cachedWb) setCorrectionWbTickets(cachedWb);
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
      if (cachedWb) setCorrectionWbTickets(cachedWb);
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
    if ((!supplierId || (supplierId === 'other' && !unregisteredSupplierName.trim())) || !manualGrvNumber.trim() || items.length === 0 || !items[0].raw_material_id) {
      toast.error('Please fill in all required fields');
      return;
    }

    const selectedSupplierId = supplierId === 'other' ? null : supplierId;

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
      if (ticket.supplier_id !== selectedSupplierId) {
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
        supplier_id: selectedSupplierId,
        unregistered_supplier_name: supplierId === 'other' ? unregisteredSupplierName.trim() : null,
        warehouse_id: warehouse?.id,
        received_date: receivedDate,
        manual_grv_number: manualGrvNumber.trim(),
        status: 'pending_costing',
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

      if (weighBridgeTicketId) {
        const { error: ticketError } = await supabase
          .from('weigh_bridge_tickets')
          .update({ status: 'in_grn', updated_at: new Date().toISOString() })
          .eq('id', weighBridgeTicketId)
          .eq('status', 'open');
        if (ticketError) throw ticketError;
      }

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
    setSupplierSearch('');
    setSupplierPickerOpen(false);
    setUnregisteredSupplierName('');
    setReceivedDate(localDateInputValue());
    setNotes('');
    setManualGrvNumber('');
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
    setEditingFinanceCosts(false);
    setViewing(grn);
    const [{ data: itemData }, { data: rtsData }] = await Promise.all([
      supabase
        .from('grn_items')
        .select('*, raw_materials(code, name, unit)')
        .eq('grn_id', grn.id),
      supabase
        .from('return_to_supplier_requests')
        .select('id, rts_number, status, reason, sage_rts_number, created_at, approved_at, posted_at')
        .eq('original_grn_id', grn.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setViewItems(itemData || []);
    setViewRts(rtsData || null);
    setViewModalOpen(true);
  };

  const openGrnCorrection = () => {
    if (!viewing || !canManageGrnCorrections) return;
    if (!['pending', 'pending_costing', 'pending_finance'].includes(viewing.status)) {
      toast.error('Approved or rejected GRNs are locked. Correct the GRN before final approval.');
      return;
    }
    setEditingGrn(viewing);
    setEditSupplierId(viewing.supplier_id || 'other');
    setEditUnregisteredSupplierName(viewing.unregistered_supplier_name || '');
    setEditWeighBridgeTicketId((viewing as any).weigh_bridge_ticket_id || 'none');
    setEditManualGrvNumber((viewing as any).manual_grv_number || '');
    setEditReceivedDate(viewing.received_date || localDateInputValue());
    setEditNotes(viewing.notes || '');
    setEditItems(viewItems.map((item) => ({ ...item })));
    setGrnEditOpen(true);
  };

  const saveGrnCorrection = async () => {
    if (!editingGrn || !editManualGrvNumber.trim() || (!editSupplierId || (editSupplierId === 'other' && !editUnregisteredSupplierName.trim()))) {
      toast.error('Manual GRV number and supplier are required.');
      return;
    }
    setSavingGrnEdit(true);
    try {
      const oldTicketId = (editingGrn as any).weigh_bridge_ticket_id || null;
      const newTicketId = editWeighBridgeTicketId === 'none' ? null : editWeighBridgeTicketId;
      const ticketSupplierId = editSupplierId === 'other' ? null : editSupplierId;
      const ticketSupplierName = editSupplierId === 'other' ? editUnregisteredSupplierName.trim() : null;
      const selectedTicket = newTicketId
        ? correctionWbTickets.find((ticket) => ticket.id === newTicketId)
        : null;

      if (newTicketId && (!selectedTicket || !['open', 'in_grn', 'linked'].includes(selectedTicket.status))) {
        throw new Error('The selected weighbridge ticket is no longer available for correction. Refresh and try again.');
      }

      // Keep the source ticket and GRN aligned. A replaced ticket is released,
      // while the selected ticket is reserved for this GRN until approval.
      if (oldTicketId && oldTicketId !== newTicketId) {
        const { error } = await supabase
          .from('weigh_bridge_tickets')
          .update({ status: 'open', updated_at: new Date().toISOString() })
          .eq('id', oldTicketId)
          .in('status', ['in_grn', 'linked']);
        if (error) throw error;
      }

      if (newTicketId) {
        const { error } = await supabase
          .from('weigh_bridge_tickets')
          .update({
            status: 'in_grn',
            supplier_id: ticketSupplierId,
            unregistered_supplier_name: ticketSupplierName,
            updated_at: new Date().toISOString(),
          })
          .eq('id', newTicketId)
          .in('status', ['open', 'in_grn', 'linked']);
        if (error) throw error;
      }

      const { error: headerError } = await supabase
        .from('goods_received_notes')
        .update({
          supplier_id: editSupplierId === 'other' ? null : editSupplierId,
          unregistered_supplier_name: editSupplierId === 'other' ? editUnregisteredSupplierName.trim() : null,
          weigh_bridge_ticket_id: newTicketId,
          manual_grv_number: editManualGrvNumber.trim(),
          received_date: editReceivedDate,
          notes: editNotes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingGrn.id);
      if (headerError) throw headerError;

      const updates = editItems.map((item) => supabase
        .from('grn_items')
        .update({
          received_qty: Number(item.received_qty) || 0,
          unit_cost: Number(item.unit_cost) || 0,
          batch_number: item.batch_number || null,
          expiry_date: item.expiry_date || null,
        })
        .eq('id', item.id)
        .eq('grn_id', editingGrn.id));
      const results = await Promise.all(updates);
      const itemError = results.find((result) => result.error)?.error;
      if (itemError) throw itemError;

      toast.success(`${editingGrn.grn_number} corrected successfully.`);
      setGrnEditOpen(false);
      setViewModalOpen(false);
      setEditingGrn(null);
      await fetchData();
    } catch (error: any) {
      toast.error(`Could not save GRN correction: ${error.message}`);
    } finally {
      setSavingGrnEdit(false);
    }
  };

  const submitGrnCosting = async () => {
    if (!viewing || !canCompleteGrnCosting || viewing.status !== 'pending_costing') return;
    const missingCost = viewItems.some((item) => Number(item.unit_cost) <= 0);
    if (missingCost) {
      toast.error('Enter a positive unit cost for every GRN line before sending it to Finance.');
      return;
    }

    setSubmittingCosting(true);
    try {
      const updates = viewItems.map((item) => supabase
        .from('grn_items')
        .update({ unit_cost: Number(item.unit_cost) })
        .eq('id', item.id)
        .eq('grn_id', viewing.id));
      const results = await Promise.all(updates);
      const updateError = results.find((result) => result.error)?.error;
      if (updateError) throw updateError;

      const { error } = await supabase.rpc('submit_grn_for_finance', { p_grn_id: viewing.id });
      if (error) throw error;

      toast.success(`${viewing.grn_number} sent to Finance for approval.`);
      setViewModalOpen(false);
      await fetchData();
    } catch (error: any) {
      toast.error(error?.message || 'Could not submit GRN costing.');
    } finally {
      setSubmittingCosting(false);
    }
  };

  const saveFinanceUnitCosts = async () => {
    if (!viewing || !canEditFinanceCosts || savingFinanceCosts) return;
    if (!viewItems.length || viewItems.some(item => !Number.isFinite(Number(item.unit_cost)) || Number(item.unit_cost) <= 0)) {
      toast.error('Enter a positive unit cost for every line.');
      return;
    }
    setSavingFinanceCosts(true);
    try {
      const { error } = await supabase.rpc('save_grn_finance_unit_costs', {
        p_grn_id: viewing.id,
        p_lines: viewItems.map(item => ({ id: item.id, unit_cost: Number(item.unit_cost) })),
      });
      if (error) throw error;
      setEditingFinanceCosts(false);
      toast.success('Unit costs saved.');
      await fetchData();
    } catch (error: any) {
      toast.error(error?.message || 'Could not save unit costs.');
    } finally {
      setSavingFinanceCosts(false);
    }
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

  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_costing' | 'pending_finance' | 'pending' | 'approved' | 'rejected'>('all');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 font-semibold">Approved</Badge>;
      case 'pending_costing':
        return <Badge className="bg-orange-500/15 text-orange-700 hover:bg-orange-500/20 border border-orange-500/30 px-2.5 py-0.5 font-semibold">Awaiting Costing</Badge>;
      case 'pending_finance':
        return <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 font-semibold">Awaiting Finance</Badge>;
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

  const matchingSuppliers = suppliers
    .filter((supplier) => supplierLabel(supplier).toLowerCase().includes(supplierSearch.trim().toLowerCase()));

  useEffect(() => {
    if (!supplierPickerOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!supplierPickerRef.current?.contains(event.target as Node)) {
        setSupplierPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSupplierPickerOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [supplierPickerOpen]);

  const grnSupplierLabel = (grn: any) =>
    supplierLabel(grn?.suppliers) || grn?.unregistered_supplier_name || 'N/A';

  const grnWeighbridgeLabel = (grn: any) => {
    const linkedTicket = Array.isArray(grn?.weigh_bridge_tickets)
      ? grn.weigh_bridge_tickets[0]
      : grn?.weigh_bridge_tickets;
    return grn?.wb_transaction_no || grn?.weigh_bridge_ticket_no || linkedTicket?.ticket_no || '';
  };

  const getGrnQueuePriority = (grn: any) => {
    const sync = syncByGrnId[grn.id];

    // Keep work requiring attention above completed receipts. An approved GRN
    // remains visible near the top while Sage is queued, processing, or failed.
    if (grn.status === 'pending_costing') return 0;
    if (grn.status === 'pending_finance' || grn.status === 'pending') return 1;
    if (grn.status === 'approved' && sync?.status !== 'success') return 2;
    if (grn.status === 'rejected') return 3;
    return 4;
  };

  const filteredGRNs = grns.filter(grn => {
    const matchesSearch = grn.grn_number.toLowerCase().includes(search.toLowerCase()) ||
      grn.suppliers?.name.toLowerCase().includes(search.toLowerCase()) ||
      grn.suppliers?.code?.toLowerCase().includes(search.toLowerCase()) ||
      grn.suppliers?.sage_code?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || grn.status === statusFilter;
    return matchesSearch && matchesStatus;
  }).sort((a, b) => {
    const priorityDifference = getGrnQueuePriority(a) - getGrnQueuePriority(b);
    if (priorityDifference !== 0) return priorityDifference;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const stats = {
    total: grns.length,
    pending: grns.filter(g => g.status === 'pending' || g.status === 'pending_finance').length,
    approved: grns.filter(g => g.status === 'approved').length,
    thisMonth: grns.filter(g => {
      const grnDate = new Date(g.created_at);
      const now = new Date();
      return grnDate.getMonth() === now.getMonth() && grnDate.getFullYear() === now.getFullYear();
    }).length,
  };

  const statusCounts = {
    all: grns.length,
    pending_costing: grns.filter(g => g.status === 'pending_costing').length,
    pending_finance: grns.filter(g => g.status === 'pending_finance').length,
    approved: grns.filter(g => g.status === 'approved').length,
    rejected: grns.filter(g => g.status === 'rejected').length,
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
  const receiptUnits = Array.from(new Set(items.map((item) => materialUnitLabel(materials.find((material) => material.id === item.raw_material_id)))));
  const receiptUnitLabel = receiptUnits.length === 1 ? receiptUnits[0] : 'mixed units';
  const totalReceivedValue = items.reduce(
    (sum, item) => sum + (Number(item.received_qty) || 0) * (Number(item.unit_cost) || 0),
    0
  );
  const wbNettMassValue = Number(wbForm.nett_mass || 0);
  const wbVariancePct = wbNettMassValue > 0 ? Math.abs((totalReceivedQty - wbNettMassValue) / wbNettMassValue) * 100 : 0;
  const selectedSync = viewing ? syncByGrnId[viewing.id] : undefined;
  const selectedGrvNumber = getSageGrvNumber(selectedSync);
  const viewedGrossTotal = viewItems.reduce((sum, item) => sum + Number(item.received_qty || 0) * Number(item.unit_cost || 0), 0);
  const viewedVatMode = (viewing as any)?.vat_mode || 'pending_finance';
  const viewedVatTreatment = (viewing as any)?.vat_treatment || null;
  const viewedVatRate = Number((viewing as any)?.vat_rate || 0);
  const viewedIsInclusive = viewedVatMode === 'inclusive';
  const viewedIsZeroTax = viewedVatTreatment === 'zero_rated' || viewedVatTreatment === 'exempt' || viewedVatMode === 'no_vat';
  const viewedNetTotal = viewedIsInclusive && viewedVatRate > 0
    ? viewedGrossTotal / (1 + viewedVatRate / 100)
    : viewedGrossTotal;
  const viewedVatAmount = viewedIsZeroTax
    ? 0
    : viewedIsInclusive
      ? viewedGrossTotal - viewedNetTotal
      : viewedGrossTotal * (viewedVatRate / 100);
  const viewedInvoiceTotal = viewedIsInclusive ? viewedGrossTotal : viewedGrossTotal + viewedVatAmount;
  const viewedVatLabel = viewedVatTreatment === 'zero_rated'
    ? 'Zero Rated'
    : viewedVatTreatment === 'exempt' || viewedVatMode === 'no_vat'
      ? 'Exempt / No VAT'
      : viewedVatMode === 'inclusive'
        ? 'Tax Inclusive'
        : viewedVatMode === 'exclusive'
          ? 'Tax Exclusive'
          : 'Finance review pending';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 font-medium animate-pulse">Loading Goods Received Notes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-5 max-w-[1600px] mx-auto">
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
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search GRN, supplier, Sage code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 border-slate-200 bg-slate-50/70 pl-10 text-sm focus:bg-white"
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>Showing <strong className="text-slate-900">{filteredGRNs.length}</strong> of {grns.length}</span>
            {(search || statusFilter !== 'all') && (
              <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="font-semibold text-teal-700 hover:text-teal-900">
                Clear filters
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 py-2.5">
          {(['all', 'pending_costing', 'pending_finance', 'approved', 'rejected'] as const).map((st) => {
            const labels = { all: 'All GRNs', pending_costing: 'Costing', pending_finance: 'Finance', approved: 'Approved', rejected: 'Rejected' };
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all ${statusFilter === st ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100'}`}
              >
                {labels[st]}
                <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${statusFilter === st ? 'bg-white/15 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
                  {statusCounts[st]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* GRNs View: Desktop Table + Mobile Card Grid */}
      <Card className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-extrabold tracking-tight text-slate-900">Delivery Register</CardTitle>
                <span className="h-2 w-2 rounded-full bg-emerald-500" title="Live register" />
              </div>
              <CardDescription className="mt-1 text-xs text-slate-500">Inspect receipts, follow approval progress, and confirm Sage posting.</CardDescription>
            </div>
            <Badge variant="outline" className="bg-slate-50 font-mono text-xs text-slate-600">
              {filteredGRNs.length} shown
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <Table className="table-fixed w-full min-w-0">
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="w-[135px] px-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">GRN</TableHead>
                  <TableHead className="w-[105px] px-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Manual GRV</TableHead>
                  <TableHead className="w-[230px] px-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Supplier</TableHead>
                  <TableHead className="w-[105px] px-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Weighbridge</TableHead>
                  <TableHead className="w-[108px] px-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Received</TableHead>
                  <TableHead className="w-[100px] px-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Tonnage</TableHead>
                  <TableHead className="w-[130px] px-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Workflow</TableHead>
                  <TableHead className="w-[190px] px-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Sage posting</TableHead>
                  <TableHead className="w-[60px] px-3 text-right text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGRNs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-slate-400 py-12">
                      No Goods Received Notes found matching criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGRNs.map((grn) => (
                    <TableRow key={grn.id} className={`transition-colors hover:bg-slate-50/80 ${grn.status === 'approved' ? 'border-l-2 border-l-emerald-400' : grn.status === 'rejected' ? 'border-l-2 border-l-rose-400' : 'border-l-2 border-l-amber-300'}`}>
                      <TableCell className="px-3 py-3 font-semibold">
                        <div className="flex items-center gap-2">
                          {grnWeighbridgeLabel(grn) && (
                            <span title="Weigh Bridge data captured"><Scale className="w-4 h-4 text-emerald-600 shrink-0" /></span>
                          )}
                          <div>
                            <span className="font-mono text-xs font-bold text-slate-900">{grn.grn_number}</span>
                            <p className="mt-1 text-[10px] font-medium text-slate-400">Receipt register</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="w-[105px] max-w-[105px] overflow-hidden px-3 py-3" title={(grn as any).manual_grv_number || 'No manual GRV reference'}>
                        <p className="font-mono text-xs font-bold text-slate-900">{(grn as any).manual_grv_number || '—'}</p>
                        <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">Manual reference</p>
                      </TableCell>
                      <TableCell className="w-[230px] max-w-[230px] overflow-hidden px-3 py-3" title={grnSupplierLabel(grn)}>
                        <p className="line-clamp-2 whitespace-normal break-words font-bold leading-4 text-slate-900">{grnSupplierLabel(grn)}</p>
                        <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">Supplier receipt</p>
                      </TableCell>
                      <TableCell className="px-3 py-3 font-mono text-xs text-slate-600">{grnWeighbridgeLabel(grn) || <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-3 py-3 text-xs font-semibold text-slate-700">{format(new Date(grn.received_date), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold text-slate-800">{(tonnageByGrnId[grn.id] || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="font-normal text-slate-400">kg</span></TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3">{getStatusBadge(grn.status)}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3">{getSageBadge(grn.id)}</TableCell>
                      <TableCell className="px-3 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewGRN(grn)}
                          className="h-9 w-9 border-slate-300 p-0 font-semibold hover:bg-orange-50 hover:text-orange-700"
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
                      {grnWeighbridgeLabel(grn) && (
                        <Badge variant="outline" className="text-[10px] text-teal-700 border-teal-300 bg-teal-50">
                          <Scale className="w-3 h-3 mr-1 text-teal-600 inline" /> {grnWeighbridgeLabel(grn)}
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
                    <h4 className="font-bold text-slate-900 text-base">{grnSupplierLabel(grn)}</h4>
                    <p className="text-xs font-mono font-semibold text-slate-600 mt-1">Manual GRV: {(grn as any).manual_grv_number || '—'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Received: {format(new Date(grn.received_date), 'PPP')} · Tonnage: {(tonnageByGrnId[grn.id] || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg
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
                  ['01', 'Receipt details', Boolean(supplierId && receivedDate && manualGrvNumber.trim())],
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
                <div className="relative z-20 overflow-visible rounded-lg border border-slate-200 bg-white shadow-sm">
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
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(300px,1.2fr)_200px_minmax(240px,1fr)]">
                      <div className="space-y-1.5">
                        <Label htmlFor="supplier" className="text-xs font-bold text-slate-700 uppercase tracking-wide">Supplier *</Label>
                        <div
                          ref={supplierPickerRef}
                          className="relative"
                          onMouseLeave={() => setSupplierPickerOpen(false)}
                        >
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            id="supplier"
                            value={supplierSearch}
                            onFocus={() => setSupplierPickerOpen(true)}
                            onChange={(event) => {
                              setSupplierSearch(event.target.value);
                              setSupplierId('');
                              setUnregisteredSupplierName('');
                              setSupplierPickerOpen(true);
                            }}
                            placeholder="Search supplier name or code..."
                            autoComplete="off"
                            className="h-10 border-slate-300 bg-white pl-9 pr-9 font-medium focus:border-orange-500"
                          />
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          {supplierPickerOpen && (
                            <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                              <button
                                type="button"
                                className="flex w-full items-center rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                                onClick={() => {
                                  setSupplierId('other');
                                  setSupplierSearch('Other - supplier not in system');
                                  setUnregisteredSupplierName('');
                                  setSupplierPickerOpen(false);
                                }}
                              >
                                Other - supplier not in system
                              </button>
                              {matchingSuppliers.length > 0 ? matchingSuppliers.map((supplier) => (
                                <button
                                  key={supplier.id}
                                  type="button"
                                  className="flex w-full items-center rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-800"
                                  onClick={() => {
                                    setSupplierId(supplier.id);
                                    setSupplierSearch(supplierLabel(supplier));
                                    setUnregisteredSupplierName('');
                                    setSupplierPickerOpen(false);
                                  }}
                                >
                                  {supplierLabel(supplier)}
                                </button>
                              )) : (
                                <p className="px-3 py-3 text-sm text-slate-500">No active supplier matches this search.</p>
                              )}
                            </div>
                          )}
                        </div>
                        {supplierId === 'other' && (
                          <Input
                            value={unregisteredSupplierName}
                            onChange={(e) => setUnregisteredSupplierName(e.target.value)}
                            placeholder="Enter supplier name"
                            className="mt-2 bg-white border-slate-300 font-medium focus:border-orange-500"
                          />
                        )}
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
                        <Label htmlFor="manual_grv_number" className="text-xs font-bold uppercase tracking-wide text-slate-700">Manual GRV Number *</Label>
                        <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white focus-within:border-orange-500">
                          <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 font-mono font-bold text-slate-500">HFGRV</span>
                          <Input
                            id="manual_grv_number"
                            value={manualGrvDigits(manualGrvNumber)}
                            onChange={(e) => setManualGrvNumber(manualGrvReference(e.target.value))}
                            placeholder="e.g. 10346"
                            inputMode="numeric"
                            pattern="[0-9]+"
                            required
                            className="border-0 bg-white font-mono font-semibold placeholder:text-slate-300 focus-visible:ring-0"
                          />
                        </div>
                        <p className="text-[10px] text-slate-400">Enter the numeric GRV number only</p>
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
                                setSupplierId(ticket.supplier_id || 'other');
                                const ticketSupplier = suppliers.find((supplier) => supplier.id === ticket.supplier_id);
                                setSupplierSearch(ticketSupplier ? supplierLabel(ticketSupplier) : '');
                                setUnregisteredSupplierName(ticket.supplier_id ? '' : (ticket.unregistered_supplier_name || ''));
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
                            <span className="rounded border border-white/15 bg-white/10 px-2 py-0.5 font-mono font-bold text-slate-200">{Number(item.received_qty || 0).toLocaleString()} {materialUnitLabel(materials.find((material) => material.id === item.raw_material_id))}</span>
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
                            onOpenChange={(open) => { if (open) setMaterialSearch(''); }}
                            onValueChange={(value) => updateItem(index, 'raw_material_id', value)}
                          >
                            <SelectTrigger className="bg-white border-slate-300 font-medium focus:border-orange-500">
                              <SelectValue placeholder="Select material" />
                            </SelectTrigger>
                            <SelectContent>
                              <div
                                className="sticky top-0 z-10 border-b border-slate-200 bg-white p-2"
                                onPointerDown={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                <div className="relative">
                                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                  <input
                                    value={materialSearch}
                                    onChange={(event) => setMaterialSearch(event.target.value)}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    placeholder="Search code or material..."
                                    autoFocus
                                    className="h-8 w-full rounded border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-orange-400 focus:bg-white"
                                  />
                                </div>
                              </div>
                              {materials
                                .filter((material) => {
                                  const query = materialSearch.trim().toLowerCase();
                                  if (!query) return true;
                                  return material.code.toLowerCase().includes(query) || material.name.toLowerCase().includes(query);
                                })
                                .map((material) => (
                                <SelectItem key={material.id} value={material.id}>
                                  {material.code} — {material.name}
                                </SelectItem>
                                ))}
                              {materials.length > 0 && !materials.some((material) => {
                                const query = materialSearch.trim().toLowerCase();
                                return !query || material.code.toLowerCase().includes(query) || material.name.toLowerCase().includes(query);
                              }) && (
                                <div className="px-2 py-3 text-center text-xs text-slate-500">No matching materials</div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-500">Ordered Qty ({materialUnitLabel(materials.find((material) => material.id === item.raw_material_id))})</Label>
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
                          <Label className="text-xs font-bold text-orange-600">Received Qty * ({materialUnitLabel(materials.find((material) => material.id === item.raw_material_id))})</Label>
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
                            placeholder={canCompleteGrnCosting ? '0.0000' : 'Completed by Production'}
                            disabled={!canCompleteGrnCosting}
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
                    <p className="font-extrabold text-slate-900 text-lg mt-0.5 font-mono">{totalOrderedQty.toLocaleString()} <span className="text-[10px] font-medium text-slate-500">{receiptUnitLabel}</span></p>
                  </div>
                  <div className="border border-orange-200 bg-orange-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-orange-800">Total Received</p>
                    <p className="font-extrabold text-slate-900 text-lg mt-0.5 font-mono">{totalReceivedQty.toLocaleString()} <span className="text-[10px] font-medium text-orange-800">{receiptUnitLabel}</span></p>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Weighbridge Nett</p>
                    <p className="font-extrabold text-slate-900 text-lg mt-0.5 font-mono">{wbNettMassValue ? wbNettMassValue.toLocaleString() : 0} <span className="text-[10px] font-medium text-slate-500">kg</span></p>
                  </div>
                  <div className="border border-orange-200 bg-orange-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-orange-800">Estimated Total Before VAT</p>
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
                {viewRts && (
                  <Badge className={`text-xs px-3 py-1 capitalize ${
                    viewRts.status === 'posted'
                      ? 'bg-emerald-100 text-emerald-800'
                      : viewRts.status === 'failed'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                  }`}>
                    RTS: {viewRts.status.replaceAll('_', ' ')}
                  </Badge>
                )}
                {viewing && profile?.role === 'admin' && viewing.status === 'approved' && syncByGrnId[viewing.id]?.status === 'failed' && (
                  <Button type="button" size="sm" onClick={openAdminSupplierCorrection} className="bg-amber-400 text-slate-950 hover:bg-amber-300">
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Admin edit supplier
                  </Button>
                )}
                {viewing && canManageReturns && viewing.status === 'approved' && selectedSync?.status === 'success' && !viewRts && (
                  <Button type="button" size="sm" onClick={() => setShowReturnToSupplierModal(true)} className="bg-rose-700 text-white hover:bg-rose-800" title="Create a Finance-controlled return to supplier">
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Return to Supplier
                  </Button>
                )}
                {canManageReturns && viewRts && (
                  <Button
                    type="button"
                    size="sm"
                    disabled
                    className="border border-amber-300 bg-amber-50 text-amber-800 opacity-100"
                    title="This GRN already has an RTS request and cannot be processed twice"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> RTS {viewRts.status.replaceAll('_', ' ')}
                  </Button>
                )}
                {viewing && canManageGrnCorrections && ['pending', 'pending_costing', 'pending_finance'].includes(viewing.status) && (
                  <Button type="button" size="sm" onClick={openGrnCorrection} className="bg-orange-500 text-white hover:bg-orange-600">
                    Edit GRV
                  </Button>
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
          {viewing && canEditFinanceCosts && ['pending', 'pending_costing', 'pending_finance'].includes(viewing.status) && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-teal-100 bg-teal-50 px-5 py-3">
              <p className="text-sm font-semibold text-teal-900">Finance unit costs</p>
              {editingFinanceCosts ? <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={savingFinanceCosts} onClick={() => { setViewItems(originalFinanceItems); setEditingFinanceCosts(false); }}>Cancel</Button>
                <Button type="button" disabled={savingFinanceCosts} onClick={saveFinanceUnitCosts} className="bg-teal-700 text-white hover:bg-teal-800">
                  {savingFinanceCosts && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Unit Costs
                </Button>
              </div> : <Button type="button" onClick={() => { setOriginalFinanceItems(viewItems.map(item => ({ ...item }))); setEditingFinanceCosts(true); }} className="bg-teal-700 text-white hover:bg-teal-800">Edit Unit Costs</Button>}
            </div>
          )}

          {viewRts && (
            <div className="mx-5 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Return to Supplier</p>
                <p className="text-xs font-semibold text-amber-900">{viewRts.rts_number} · {viewRts.status.replaceAll('_', ' ')}</p>
              </div>
              <p className="text-[11px] text-amber-800">
                {viewRts.status === 'pending_finance'
                  ? 'Waiting for Finance approval. No Sage reversal has been posted.'
                  : viewRts.status === 'posted'
                    ? 'Posted successfully. This GRN cannot be processed again.'
                    : 'Finance-controlled reversal in progress.'}
              </p>
            </div>
          )}
          {viewing && !editingFinanceCosts && viewing.status === 'pending_costing' && canCompleteGrnCosting && (
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-5 py-3">
              <div>
                <p className="text-sm font-bold text-orange-900">Production costing required</p>
                <p className="text-xs text-orange-800">Enter the unit cost for each line, then submit this GRN to Finance.</p>
              </div>
              <Button type="button" onClick={submitGrnCosting} disabled={submittingCosting} className="shrink-0 bg-orange-600 text-white hover:bg-orange-700">
                {submittingCosting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                {submittingCosting ? 'Saving...' : profile?.role === 'finance' ? 'Save Unit Costs' : 'Save Costing & Send to Finance'}
              </Button>
            </div>
          )}
          {viewing && !editingFinanceCosts && (viewing.status === 'pending_finance' || viewing.status === 'pending') && (
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
                    <p className="text-xs font-semibold text-slate-800 mt-0.5">{grnSupplierLabel(viewing)}</p>
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
                <div className="border-l-3 border-l-orange-500 bg-white rounded-lg border border-slate-200 p-2.5">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Manual GRV Number</p>
                  <p className="text-xs font-mono font-bold text-slate-800 mt-0.5">{(viewing as any)?.manual_grv_number || '-'}</p>
                  {viewing?.status === 'approved' && !viewing.manual_grv_number?.trim() &&
                    selectedSync?.status === 'failed' &&
                    selectedSync.message?.includes('has no manual HFGRV reference') &&
                    ['admin', 'finance'].includes(profile?.role || '') && (
                    <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void saveMissingGrvReference(); }}>
                      <Label htmlFor="missing-manual-grv">Manual GRV reference</Label>
                      <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white">
                        <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 font-mono font-bold text-slate-500">HFGRV</span>
                        <Input id="missing-manual-grv" value={manualGrvDigits(missingGrvReference)}
                          onChange={event => setMissingGrvReference(manualGrvReference(event.target.value))}
                          placeholder="e.g. 10346" inputMode="numeric" pattern="[0-9]+" required maxLength={50}
                          disabled={savingReference} className="border-0 font-mono placeholder:text-slate-300 focus-visible:ring-0" />
                      </div>
                      <Button type="submit" disabled={savingReference} size="sm">
                        {savingReference ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                        {savingReference ? 'Saving...' : 'Save manual GRV'}
                      </Button>
                    </form>
                  )}
                  {referenceFeedback && <p role="status" className="mt-2 text-xs text-slate-700">{referenceFeedback}</p>}
                </div>

                {viewing?.status === 'approved' &&
                  selectedSync?.status === 'failed' &&
                  (selectedSync.message || '').toLowerCase().includes('no sage supplier code') &&
                  ['admin', 'finance'].includes(profile?.role || '') && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-700">Finance correction</p>
                    <p className="mt-1 text-xs text-slate-700">The supplier is missing its Sage account code. Enter the code from Sage, then retry posting.</p>
                    <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void saveMissingSupplierCode(); }}>
                      <Label htmlFor="missing-sage-supplier-code">Sage supplier code</Label>
                      <Input id="missing-sage-supplier-code" value={missingSupplierCode}
                        onChange={event => setMissingSupplierCode(event.target.value.toUpperCase())}
                        placeholder="e.g. SUP0001" required maxLength={50} disabled={savingSupplierCode} />
                      <Button type="submit" disabled={savingSupplierCode} size="sm" className="bg-rose-700 text-white hover:bg-rose-800">
                        {savingSupplierCode ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                        {savingSupplierCode ? 'Saving...' : 'Save supplier code'}
                      </Button>
                    </form>
                    {supplierCodeFeedback && <p role="status" className="mt-2 text-xs text-slate-700">{supplierCodeFeedback}</p>}
                  </div>
                )}

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
                {viewing && grnWeighbridgeLabel(viewing) && (
                  <div className="bg-white rounded-lg border border-teal-200 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Scale className="w-3.5 h-3.5 text-teal-600" />
                      <h3 className="text-xs font-semibold text-slate-700">Weigh Bridge Ticket</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div><span className="text-slate-400">Ticket:</span> <span className="font-mono text-slate-800">{grnWeighbridgeLabel(viewing)}</span></div>
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

                <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-teal-200 bg-teal-50/50 p-3 md:grid-cols-6">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">VAT Treatment</p>
                    <p className="mt-1 text-xs font-bold text-slate-900">{viewedVatLabel}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">Sage Tax</p>
                    <p className="mt-1 font-mono text-xs font-bold text-slate-900">{(viewing as any)?.vat_code || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">Rate</p>
                    <p className="mt-1 text-xs font-bold text-slate-900">{viewedVatRate.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">Exclusive Total</p>
                    <p className="mt-1 text-xs font-bold text-slate-900">${formatMoney(viewedNetTotal)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">VAT Amount</p>
                    <p className="mt-1 text-xs font-bold text-slate-900">${formatMoney(viewedVatAmount)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">Inclusive Total</p>
                    <p className="mt-1 text-xs font-bold text-slate-900">${formatMoney(viewedInvoiceTotal)}</p>
                  </div>
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
                          <TableCell className="text-xs text-right text-slate-600 py-2 px-3">{item.ordered_qty.toLocaleString()} {materialUnitLabel(item.raw_materials)}</TableCell>
                          <TableCell className="text-xs text-right text-slate-800 py-2 px-3 font-semibold">{item.received_qty.toLocaleString()} {materialUnitLabel(item.raw_materials)}</TableCell>
                          <TableCell className="text-xs text-right text-slate-600 py-2 px-3">
                            {editingFinanceCosts || (viewing?.status === 'pending_costing' && canCompleteGrnCosting) ? (
                              <Input
                                type="number"
                                min="0.0001"
                                step="0.0001"
                                disabled={savingFinanceCosts}
                                value={item.unit_cost ?? ''}
                                onChange={(event) => setViewItems((current) => current.map((line) => line.id === item.id ? { ...line, unit_cost: event.target.value === '' ? '' : Number(event.target.value) } : line))}
                                className="h-8 w-24 text-right text-xs"
                              />
                            ) : `$${Number(item.unit_cost || 0).toFixed(4)}`}
                          </TableCell>
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
                      Ordered: <strong className="text-white">{viewItems.reduce((s, i) => s + (i.ordered_qty || 0), 0).toLocaleString()} {viewItems.length === 1 ? materialUnitLabel(viewItems[0]?.raw_materials) : 'mixed units'}</strong>
                    </span>
                    <div className="w-px h-4 bg-slate-700" />
                    <span className="text-xs text-slate-300">
                      Received: <strong className="text-white">{viewItems.reduce((s, i) => s + (i.received_qty || 0), 0).toLocaleString()} {viewItems.length === 1 ? materialUnitLabel(viewItems[0]?.raw_materials) : 'mixed units'}</strong>
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

      <ReturnToSupplierModal
        open={showReturnToSupplierModal}
        onOpenChange={setShowReturnToSupplierModal}
        grn={viewing}
        items={viewItems}
        sageGrvNumber={selectedGrvNumber}
        onCreated={async () => {
          await fetchData(false);
          if (viewing?.id) {
            const { data } = await supabase
              .from('return_to_supplier_requests')
              .select('id, rts_number, status, reason, sage_rts_number, created_at, approved_at, posted_at')
              .eq('original_grn_id', viewing.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            setViewRts(data || null);
          }
        }}
      />

      <Dialog open={adminSupplierCorrectionOpen} onOpenChange={setAdminSupplierCorrectionOpen}>
        <DialogContent className="max-w-2xl overflow-hidden p-0">
          <DialogHeader className="border-b border-slate-200 bg-slate-50 px-6 py-5">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div>
                <DialogTitle className="text-xl text-slate-900">Correct supplier on this GRN</DialogTitle>
                <DialogDescription className="mt-1">
                  Select the correct Sage supplier, record the reason, then return to the same GRN to retry posting.
                </DialogDescription>
              </div>
              <Badge variant="destructive" className="shrink-0">Sage failed</Badge>
            </div>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">GRN</p>
                <p className="mt-1 font-mono text-sm font-bold text-slate-900">{viewing?.grn_number || 'Unknown'}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current supplier</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{viewing ? grnSupplierLabel(viewing) : 'Not mapped'}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Sage message</p>
                <p className="mt-1 text-sm text-rose-700">{syncByGrnId[viewing?.id || '']?.message || 'Sage could not post this GRN.'}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wide text-slate-600">Correct Sage supplier *</Label>
              <Select value={adminSupplierId} onValueChange={setAdminSupplierId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Choose the supplier from Sage" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>{supplierLabel(supplier)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wide text-slate-600">Audit reason *</Label>
              <Textarea value={adminSupplierReason} onChange={(event) => setAdminSupplierReason(event.target.value)} placeholder="Example: selected the supplier shown on the original invoice" rows={3} />
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="outline" onClick={() => setAdminSupplierCorrectionOpen(false)} disabled={savingAdminSupplierCorrection}>Back to GRN</Button>
              <Button type="button" onClick={saveAdminSupplierCorrection} disabled={savingAdminSupplierCorrection || !adminSupplierId || !adminSupplierReason.trim()} className="bg-amber-500 text-slate-950 hover:bg-amber-600">
                {savingAdminSupplierCorrection ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1.5 h-4 w-4" />}
                Save and return to GRN
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manager GRV correction modal */}
      <Dialog open={grnEditOpen} onOpenChange={setGrnEditOpen}>
        <DialogContent className="max-w-[1100px] w-[96vw] max-h-[92vh] overflow-hidden p-0 [&>button.absolute]:hidden">
          <DialogHeader className="shrink-0 bg-slate-900 px-5 py-4 text-white">
            <div className="flex items-center justify-between pr-10">
              <div>
                <DialogTitle className="text-lg font-extrabold text-white">Correct GRV {editingGrn?.grn_number}</DialogTitle>
                <DialogDescription className="mt-1 text-xs text-slate-300">Manager correction window before Finance approval. The original initiator remains unchanged.</DialogDescription>
              </div>
              <Badge className="border border-orange-300/30 bg-orange-500/15 text-orange-200">Manager only</Badge>
            </div>
            <button onClick={() => setGrnEditOpen(false)} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          <div className="max-h-[calc(92vh-74px)] overflow-y-auto bg-slate-50 p-5">
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-600">Supplier *</Label>
                <Select value={editSupplierId} onValueChange={(value) => { setEditSupplierId(value); if (value !== 'other') setEditUnregisteredSupplierName(''); }}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="other">Other - supplier not in system</SelectItem>
                    {suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplierLabel(supplier)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {editSupplierId === 'other' && <Input value={editUnregisteredSupplierName} onChange={(e) => setEditUnregisteredSupplierName(e.target.value)} placeholder="Supplier name" />}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-600">Manual GRV Number *</Label>
                <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white">
                  <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 font-mono font-bold text-slate-500">HFGRV</span>
                  <Input value={manualGrvDigits(editManualGrvNumber)} onChange={(e) => setEditManualGrvNumber(manualGrvReference(e.target.value))} placeholder="e.g. 10346" inputMode="numeric" pattern="[0-9]+" className="border-0 font-mono font-semibold placeholder:text-slate-300 focus-visible:ring-0" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-600">Linked weighbridge</Label>
                <Select value={editWeighBridgeTicketId} onValueChange={setEditWeighBridgeTicketId}>
                  <SelectTrigger><SelectValue placeholder="Select ticket" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No weighbridge ticket</SelectItem>
                    {correctionWbTickets.map((ticket) => (
                      <SelectItem key={ticket.id} value={ticket.id}>
                        {ticket.ticket_no} {ticket.product_code ? `- ${ticket.product_code}` : ''} ({ticket.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500">Changing this also releases the old ticket and reserves the new one.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-600">Received Date *</Label>
                <Input type="date" value={editReceivedDate} onChange={(e) => setEditReceivedDate(e.target.value)} />
              </div>
              <div className="md:col-span-3 space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-600">Correction note</Label>
                <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Explain the correction for the audit trail" rows={2} />
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-extrabold text-slate-900">GRV line corrections</p>
                <p className="mt-1 text-xs text-slate-500">Correct received quantity, unit cost, batch, or expiry. Material identity remains fixed.</p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow className="bg-white"><TableHead>Material</TableHead><TableHead className="w-28 text-right">Received kg</TableHead><TableHead className="w-28 text-right">Unit cost</TableHead><TableHead className="w-36">Batch</TableHead><TableHead className="w-40">Expiry</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {editItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell><p className="text-xs font-bold text-slate-900">{item.raw_materials?.name || 'Material'}</p><p className="font-mono text-[10px] text-slate-500">{item.raw_materials?.code || '-'}</p></TableCell>
                        <TableCell><Input type="number" min="0" step="0.001" value={item.received_qty ?? ''} onChange={(e) => setEditItems((current) => current.map((line) => line.id === item.id ? { ...line, received_qty: e.target.value === '' ? '' : Number(e.target.value) } : line))} className="h-8 text-right text-xs" /></TableCell>
                        <TableCell><Input type="number" min="0" step="0.0001" value={item.unit_cost ?? ''} onChange={(e) => setEditItems((current) => current.map((line) => line.id === item.id ? { ...line, unit_cost: e.target.value === '' ? '' : Number(e.target.value) } : line))} className="h-8 text-right text-xs" /></TableCell>
                        <TableCell><Input value={item.batch_number || ''} onChange={(e) => setEditItems((current) => current.map((line) => line.id === item.id ? { ...line, batch_number: e.target.value } : line))} className="h-8 text-xs" /></TableCell>
                        <TableCell><Input type="date" value={item.expiry_date || ''} onChange={(e) => setEditItems((current) => current.map((line) => line.id === item.id ? { ...line, expiry_date: e.target.value } : line))} className="h-8 text-xs" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setGrnEditOpen(false)} disabled={savingGrnEdit}>Cancel</Button>
              <Button type="button" onClick={saveGrnCorrection} disabled={savingGrnEdit} className="bg-orange-600 text-white hover:bg-orange-700">
                {savingGrnEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                {savingGrnEdit ? 'Saving correction...' : 'Save GRV correction'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
