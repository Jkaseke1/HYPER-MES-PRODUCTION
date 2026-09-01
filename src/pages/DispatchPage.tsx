import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Eye, Truck, MapPin, Package, AlertTriangle, FileText, X, Scale,
  Warehouse as WarehouseIcon, Calendar, User, Route, Clock, CheckCircle2, Box, ArrowRight,
  Pencil, Sparkles, Printer, RefreshCw, Building, ShieldCheck, DollarSign, Check, Phone, FileCheck, ChevronRight
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { generateDispatchNumber } from '../lib/batchNumberGenerator';
import type { DispatchOrder, DispatchItem, Branch, Warehouse, Formulation } from '../types/database';
import Modal from '../components/ui/Modal';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import StatusBadge from '../components/ui/StatusBadge';
import ApprovalButtons from '../components/approval/ApprovalButtons';
import ApprovalHistory from '../components/approval/ApprovalHistory';
import { validateFGStockAvailability, StockError } from '../lib/stockValidation';
import StockOverrideModal from '../components/stock/StockOverrideModal';
import DeliveryNoteModal from '../components/dispatch/DeliveryNoteModal';
import { bagSizeKg, bagsFromKg, kgFromBags } from '../lib/bagUnits';

type Tab = 'all' | 'pending' | 'loading' | 'dispatched' | 'in_transit' | 'delivered';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All Dispatches' },
  { key: 'pending', label: 'Pending' },
  { key: 'loading', label: 'Loading' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
];

type DispatchDraftItem = { formulation_id: string; batch_number: string; quantity: number; quantity_bags: number; bag_size_kg: number; unit: string };
const EMPTY_ITEM: DispatchDraftItem = { formulation_id: '', batch_number: '', quantity: 0, quantity_bags: 0, bag_size_kg: 50, unit: 'kg' };

// Preset drivers and fleet for fast entry
const FLEET_TRUCKS = ['ABG 1234', 'AES 5678', 'AFG 9012', 'AHL 3456', 'AGE 7890'];
const FLEET_DRIVERS = ['P. Tembo', 'S. Mujele', 'J. Kaseke', 'M. Moyo', 'T. Ndlovu'];

export default function DispatchPage() {
  const { profile } = useAuth();
  const isFinance = profile?.role === 'finance' || profile?.role === 'accountant' || profile?.role === 'admin';

  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [viewOrder, setViewOrder] = useState<DispatchOrder | null>(null);
  const [viewItems, setViewItems] = useState<DispatchItem[]>([]);

  // D-Note Modal State
  const [showDNote, setShowDNote] = useState(false);
  const [dnoteOrder, setDNoteOrder] = useState<DispatchOrder | null>(null);
  const [dnoteItems, setDNoteItems] = useState<DispatchItem[]>([]);



  // Accounts Approval Modal State
  const [showAccountsApproveModal, setShowAccountsApproveModal] = useState(false);
  const [accountsApproveOrder, setAccountsApproveOrder] = useState<DispatchOrder | null>(null);
  const [accountsApproveItems, setAccountsApproveItems] = useState<DispatchItem[]>([]);
  const [accountsNotes, setAccountsNotes] = useState('');

  const initForm = {
    dispatch_type: 'branch_transfer' as 'branch_transfer' | 'customer_direct',
    customer_name: '',
    customer_code: '',
    branch_id: '',
    warehouse_id: '',
    dispatch_date: format(new Date(), 'yyyy-MM-dd'),
    vehicle_number: '',
    driver_name: '',
    driver_phone: '',
    is_hired_truck: false,
    transporter_name: '',
    trailer_number: '',
    physical_dnote_number: '',
    hfdn_reference: '',
    order_number: '',
    vat_number: '',
    delivery_notes: '',
  };

  const [form, setForm] = useState(initForm);
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);
  const [dispatchNumber, setDispatchNumber] = useState<string>('');
  const [stockErrors, setStockErrors] = useState<StockError[]>([]);
  const [showStockOverride, setShowStockOverride] = useState(false);
  const [pendingDeliverCallback, setPendingDeliverCallback] = useState<(() => Promise<void>) | null>(null);
  const [batchNumbers, setBatchNumbers] = useState<{ [key: string]: string[] }>({});
  const [stockBalances, setStockBalances] = useState<Record<string, number>>({});
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const getFormulationBagSize = (formulationId: string) => {
    const formulation = formulations.find((f) => f.id === formulationId);
    const variantSize = formulation?.unit_size_variants?.[0]?.size;
    const namedSize = formulation?.name?.match(/(\d+)\s*kg/i)?.[1];
    return bagSizeKg(variantSize || namedSize || 50);
  };

  const fetchOrders = useCallback(async () => {
    // Some live databases retain dispatch_orders.created_by without a foreign
    // key to profiles. Do not embed that optional relationship: PostgREST
    // rejects the entire dispatch query when the FK is absent.
    let q = supabase.from('dispatch_orders').select('*, branches(name, code, sage_code), warehouses(name, code)').order('created_at', { ascending: false });
    if (tab !== 'all') q = q.eq('status', tab);
    const { data } = await q;
    if (data) setOrders(data as DispatchOrder[]);
  }, [tab]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    const load = async () => {
      const [b, w, f] = await Promise.all([
        supabase.from('branches').select('*').eq('is_active', true).order('name'),
        supabase.from('warehouses').select('*').eq('is_active', true).eq('type', 'finished_goods').is('branch_id', null).order('name'),
        supabase.from('formulations').select('*').eq('status', 'active').order('name'),
      ]);
      if (b.data) setBranches(b.data);
      if (w.data) {
        setWarehouses(w.data);
        const defaultWarehouse = w.data.find(wh => wh.code === 'DEB') || w.data.find(wh => wh.code === 'DSP');
        if (defaultWarehouse) {
          setForm(prev => ({ ...prev, warehouse_id: defaultWarehouse.id }));
        }
      }
      if (f.data) setFormulations(f.data);
    };
    load();
  }, []);

  const updateItem = (idx: number, key: string, value: any) => {
    const newItems = [...items];
    newItems[idx] = { ...newItems[idx], [key]: value };
    if (key === 'formulation_id') {
      const size = getFormulationBagSize(value);
      newItems[idx].batch_number = '';
      newItems[idx].bag_size_kg = size;
      newItems[idx].quantity = kgFromBags(newItems[idx].quantity_bags, size);
    }
    if (key === 'quantity_bags') {
      newItems[idx].quantity = kgFromBags(value, newItems[idx].bag_size_kg);
      newItems[idx].unit = 'kg';
    }
    if (key === 'bag_size_kg') {
      newItems[idx].quantity = kgFromBags(newItems[idx].quantity_bags, value);
    }
    setItems(newItems);
    if (key === 'formulation_id' && value) {
      fetchBatchNumbers(value);
      fetchFGStock(value);
    }
  };

  const totalWeight = items
    .filter((item) => item.formulation_id && Number(item.quantity) > 0)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      o.dispatch_number.toLowerCase().includes(s) ||
      o.driver_name?.toLowerCase().includes(s) ||
      o.vehicle_number?.toLowerCase().includes(s) ||
      o.physical_dnote_number?.toLowerCase().includes(s) ||
      o.customer_name?.toLowerCase().includes(s) ||
      (o.branches as any)?.name?.toLowerCase().includes(s)
    );
  });

  const stats = {
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    inTransit: orders.filter(o => o.status === 'in_transit' || o.status === 'dispatched' || o.status === 'loading').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
    totalWeight: orders.reduce((s, o) => s + (o.total_weight || 0), 0),
  };

  const handleCreate = async () => {
    const dispatchItems = items.filter((item) => item.formulation_id && Number(item.quantity_bags) > 0);
    if (!form.warehouse_id) {
      toast.error('Select the source warehouse before saving the dispatch.');
      return;
    }
    if (form.dispatch_type === 'branch_transfer' && !form.branch_id) {
      toast.error('Select the destination branch before saving the dispatch.');
      return;
    }
    if (form.dispatch_type === 'customer_direct' && !form.customer_name.trim()) {
      toast.error('Enter the customer name before saving the dispatch.');
      return;
    }
    if (dispatchItems.length === 0) {
      toast.error('Add at least one product with a quantity greater than zero.');
      return;
    }

    setSaving(true);
    try {
      if (editingOrderId) {
        const { error: updateError } = await supabase.from('dispatch_orders').update({ 
          ...form, 
          branch_id: form.dispatch_type === 'branch_transfer' ? form.branch_id : null,
          total_weight: totalWeight 
        }).eq('id', editingOrderId);
        if (updateError) throw updateError;
        await supabase.from('dispatch_items').delete().eq('dispatch_order_id', editingOrderId);
        const rows = dispatchItems.map((i) => ({ dispatch_order_id: editingOrderId, formulation_id: i.formulation_id, batch_number: i.batch_number, quantity: i.quantity, quantity_bags: i.quantity_bags, bag_size_kg: i.bag_size_kg, unit: 'kg', unit_price: 0, line_total: 0 }));
        if (rows.length) await supabase.from('dispatch_items').insert(rows);
        toast.success('Dispatch order updated!');
      } else {
        const generatedNumber = await generateDispatchNumber();
        const { data, error } = await supabase.from('dispatch_orders').insert({ 
          ...form, 
          branch_id: form.dispatch_type === 'branch_transfer' ? form.branch_id : null,
          dispatch_number: generatedNumber, 
          status: 'pending', 
          total_weight: totalWeight, 
          total_value: 0,
          prepared_by: profile?.id || null,
        }).select().single();
        if (!error && data) {
          const rows = dispatchItems.map((i) => ({ dispatch_order_id: data.id, formulation_id: i.formulation_id, batch_number: i.batch_number, quantity: i.quantity, quantity_bags: i.quantity_bags, bag_size_kg: i.bag_size_kg, unit: 'kg', unit_price: 0, line_total: 0 }));
          if (rows.length) await supabase.from('dispatch_items').insert(rows);
          toast.success('Dispatch order created & D-Note generated!');
        }
        if (error) throw error;
      }
    } catch (error: any) {
      console.error('Error saving dispatch order:', error);
      toast.error(`Failed to save dispatch order: ${error.message}`);
    } finally {
      setSaving(false);
      setShowCreate(false);
      setEditingOrderId(null);
      resetForm();
      setDispatchNumber('');
      fetchOrders();
    }
  };

  const resetForm = () => {
    setForm(initForm);
    setItems([{ ...EMPTY_ITEM }]);
    const defaultWarehouse = warehouses.find(wh => wh.code === 'DEB') || warehouses.find(wh => wh.code === 'DSP');
    if (defaultWarehouse) {
      setForm(prev => ({ ...prev, warehouse_id: defaultWarehouse.id }));
    }
  };

  const fetchBatchNumbers = async (formulationId: string) => {
    if (!formulationId) return;
    if (batchNumbers[formulationId]) return;
    const { data } = await supabase
      .from('production_orders')
      .select('batch_number')
      .eq('formulation_id', formulationId)
      .eq('status', 'completed')
      .order('batch_number', { ascending: false });
    if (data) setBatchNumbers(prev => ({ ...prev, [formulationId]: data.map(d => d.batch_number) }));
  };

  const fetchFGStock = async (formulationId: string) => {
    if (!formulationId) return;
    const { data: formulation } = await supabase
      .from('formulations')
      .select('sage_code')
      .eq('id', formulationId)
      .single();
    if (!formulation?.sage_code) return;
    const DEB_SAGE_WAREHOUSE_ID = 17;
    const { data: sageStock } = await supabase
      .from('sage_stock_balances')
      .select('quantity')
      .eq('sage_code', formulation.sage_code)
      .eq('warehouse_id', DEB_SAGE_WAREHOUSE_ID)
      .single();
    setStockBalances(prev => ({ ...prev, [formulationId]: Number(sageStock?.quantity || 0) }));
  };

  const openView = async (order: DispatchOrder) => {
    setViewOrder(order);
    const { data } = await supabase.from('dispatch_items').select('*, formulations(name, code, sage_code)').eq('dispatch_order_id', order.id);
    if (data) setViewItems(data as DispatchItem[]);
  };

  const openDNoteModal = async (order: DispatchOrder) => {
    setDNoteOrder(order);
    if (viewOrder?.id === order.id && viewItems.length > 0) {
      setDNoteItems(viewItems);
      setShowDNote(true);
    } else {
      setShowDNote(true);
      const { data } = await supabase.from('dispatch_items').select('*, formulations(name, code, sage_code)').eq('dispatch_order_id', order.id);
      if (data) setDNoteItems(data as DispatchItem[]);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    if (status === 'delivered' && viewOrder?.id === id) {
      const itemsToCheck = viewItems
        .filter(item => item.formulation_id)
        .map(item => ({
          formulation_id: item.formulation_id!,
          quantity: item.quantity,
          name: (item.formulations as any)?.name || 'Unknown'
        }));

      const stockCheck = await validateFGStockAvailability(itemsToCheck);
      if (!stockCheck.isValid) {
        setStockErrors(stockCheck.errors);
        setPendingDeliverCallback(() => async () => {
          await performStatusUpdate(id, status);
        });
        setShowStockOverride(true);
        return;
      }
    }

    await performStatusUpdate(id, status);
  };

  const performStatusUpdate = async (id: string, status: string) => {
    const updates: any = { status };
    if (status === 'delivered') updates.delivered_at = new Date().toISOString();
    await supabase.from('dispatch_orders').update(updates).eq('id', id);

    if (status === 'delivered') {
      const itemsForMovement = viewOrder?.id === id ? viewItems : [];
      const movements = itemsForMovement
        .filter((item) => item.formulation_id)
        .map((item) => ({
          movement_type: 'dispatch_out',
          formulation_id: item.formulation_id,
          quantity: item.quantity,
          unit: item.unit,
          notes: `Dispatched — ${viewOrder?.dispatch_number || id}`,
          reference_type: 'dispatch_order',
          reference_id: id,
          batch_number: item.batch_number || null,
          movement_date: new Date().toISOString(),
        }));
      if (movements.length) await supabase.from('stock_movements').insert(movements);
    }

    if (viewOrder?.id === id) setViewOrder({ ...viewOrder, ...updates });
    fetchOrders();
  };

  // Branch Confirmation & Variance Modal State
  const [showBranchConfirmModal, setShowBranchConfirmModal] = useState(false);
  const [branchConfirmOrder, setBranchConfirmOrder] = useState<DispatchOrder | null>(null);
  const [branchConfirmItems, setBranchConfirmItems] = useState<Array<{
    id: string;
    formulation_id: string | null;
    product_name: string;
    product_code: string;
    batch_number: string;
    dispatched_qty: number;
    dispatched_bags: number;
    bag_size_kg: number;
    unit: string;
    received_qty: number;
    received_bags: number;
    damaged_qty: number;
    variance_reason: string;
    line_notes: string;
  }>>([]);
  const [receiverName, setReceiverName] = useState('');
  const [driverSigned, setDriverSigned] = useState(true);
  const [branchNotes, setBranchNotes] = useState('');

  const openBranchConfirmModal = async (order: DispatchOrder) => {
    if (order.status !== 'delivered') {
      toast.error('Branch receipt can only be confirmed after the dispatch has been delivered.');
      return;
    }

    setBranchConfirmOrder(order);
    setBranchNotes(order.branch_confirmation_notes || '');
    setReceiverName(profile?.full_name || '');
    setDriverSigned(true);

    const { data: itemsData } = await supabase
      .from('dispatch_items')
      .select('*, formulations(id, name, code, sage_code)')
      .eq('dispatch_order_id', order.id);

    const mapped = (itemsData || []).map((it: any) => ({
      id: it.id,
      formulation_id: it.formulation_id || it.formulations?.id || null,
      product_name: it.formulations?.name || 'Finished Product',
      product_code: it.formulations?.code || it.formulations?.sage_code || 'FG-PROD',
      batch_number: it.batch_number || 'N/A',
      dispatched_qty: Number(it.quantity || 0),
      dispatched_bags: Number(it.quantity_bags ?? bagsFromKg(Number(it.quantity || 0), it.bag_size_kg)),
      bag_size_kg: bagSizeKg(it.bag_size_kg),
      unit: it.unit || 'kg',
      received_qty: Number(it.quantity || 0),
      received_bags: Number(it.quantity_bags ?? bagsFromKg(Number(it.quantity || 0), it.bag_size_kg)),
      damaged_qty: 0,
      variance_reason: 'Full Delivery - Intact',
      line_notes: '',
    }));

    setBranchConfirmItems(mapped);
    setShowBranchConfirmModal(true);
  };

  const updateBranchItem = (idx: number, field: string, value: any) => {
    setBranchConfirmItems(prev => {
      const updated = [...prev];
      const current = { ...updated[idx], [field]: value };
      if (field === 'received_bags') {
        current.received_qty = kgFromBags(Number(value || 0), current.bag_size_kg);
      }
      updated[idx] = current;
      return updated;
    });
  };

  const openAccountsApproveModal = async (order: DispatchOrder) => {
    setAccountsApproveOrder(order);
    setAccountsNotes(order.accounts_approval_notes || '');
    setShowAccountsApproveModal(true);

    if (viewOrder?.id === order.id && viewItems.length > 0) {
      setAccountsApproveItems(viewItems);
      return;
    }

    const { data } = await supabase
      .from('dispatch_items')
      .select('*, formulations(id, name, code, sage_code)')
      .eq('dispatch_order_id', order.id);

    setAccountsApproveItems((data || []) as DispatchItem[]);
  };

  // Branch Confirm Delivery Action with Variance Declaration
  const handleConfirmBranchDelivery = async () => {
    if (!branchConfirmOrder) return;
    if (branchConfirmOrder.branch_confirmation_status === 'confirmed') {
      toast.error('This branch receipt has already been confirmed.');
      return;
    }
    setSaving(true);
    try {
      const totalDispatched = branchConfirmItems.reduce((s, i) => s + i.dispatched_qty, 0);
      const totalReceived = branchConfirmItems.reduce((s, i) => s + i.received_qty, 0);
      const totalDamaged = branchConfirmItems.reduce((s, i) => s + i.damaged_qty, 0);
      const totalVariance = totalReceived - totalDispatched;
      const totalDispatchedBags = branchConfirmItems.reduce((s, i) => s + i.dispatched_bags, 0);
      const totalReceivedBags = branchConfirmItems.reduce((s, i) => s + i.received_bags, 0);
      const totalVarianceBags = totalReceivedBags - totalDispatchedBags;

      const lineBreakdown = branchConfirmItems.map(i => {
        const lineVar = i.received_qty - i.dispatched_qty;
        const lineBagVar = i.received_bags - i.dispatched_bags;
        return `${i.product_name} (${i.product_code}): Sent ${i.dispatched_bags} bags (${i.dispatched_qty} ${i.unit}), Recv ${i.received_bags} bags (${i.received_qty} ${i.unit})${lineVar !== 0 ? ` [Var: ${lineBagVar > 0 ? '+' : ''}${lineBagVar} bags / ${lineVar > 0 ? '+' : ''}${lineVar} ${i.unit}]` : ''}${i.damaged_qty > 0 ? ` [Damaged: ${i.damaged_qty} bags]` : ''}${i.variance_reason !== 'Full Delivery - Intact' ? ` Reason: ${i.variance_reason}` : ''}`;
      }).join('; ');

      const formattedNotes = `Receiver: ${receiverName || profile?.full_name || 'Branch Manager'}. Driver Signed: ${driverSigned ? 'Yes' : 'No'}. ${
        totalVariance !== 0 ? `[VARIANCE: ${totalVarianceBags > 0 ? '+' : ''}${totalVarianceBags} bags / ${totalVariance > 0 ? '+' : ''}${totalVariance} kg] ` : '[FULL RECEIPT] '
      }${totalDamaged > 0 ? `[DAMAGED: ${totalDamaged} bags/units] ` : ''}${branchNotes ? `Remarks: ${branchNotes}. ` : ''}Details: ${lineBreakdown}`;

      const updates: Pick<DispatchOrder, 'status' | 'delivered_at' | 'branch_confirmation_status' | 'branch_confirmed_by' | 'branch_confirmed_at' | 'branch_confirmation_notes'> = {
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        branch_confirmation_status: 'confirmed',
        branch_confirmed_by: profile?.id || null,
        branch_confirmed_at: new Date().toISOString(),
        branch_confirmation_notes: formattedNotes,
      };

      const { error } = await supabase.rpc('confirm_branch_dispatch_receipt', {
        p_dispatch_id: branchConfirmOrder.id,
        p_confirmation_notes: formattedNotes,
        p_confirmed_by: profile?.id || null,
        p_lines: branchConfirmItems.map(item => ({
          formulation_id: item.formulation_id,
          quantity: item.received_qty,
          unit: item.unit,
          batch_number: item.batch_number || null,
        })),
      });
      if (error) throw error;

      if (totalVariance < 0 || totalDamaged > 0) {
        toast.error(`Branch Receipt Confirmed with Variance: ${Math.abs(totalVariance)} kg shortfall, ${totalDamaged} damaged!`, { duration: 6000 });
      } else {
        toast.success(`Branch Goods Receipt confirmed for ${branchConfirmOrder.dispatch_number}!`);
      }

      setShowBranchConfirmModal(false);
      if (viewOrder?.id === branchConfirmOrder.id) {
        setViewOrder({ ...viewOrder, ...updates });
      }

      setBranchConfirmOrder(null);
      setBranchNotes('');
      fetchOrders();
    } catch (err: any) {
      toast.error(`Failed to confirm branch delivery: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Accounts Approve & Post Action (FINANCE & ADMIN ONLY)
  const handleAccountsApprovePosting = async () => {
    if (!accountsApproveOrder) return;

    if (!isFinance) {
      toast.error('Access restricted: Step 4 posting is reserved for Finance and Admin users.');
      return;
    }
    if (accountsApproveOrder.dispatch_type === 'branch_transfer' && accountsApproveOrder.branch_confirmation_status !== 'confirmed') {
      toast.error('The receiving branch must confirm receipt before Finance releases a branch transfer to Sage.');
      return;
    }

    setSaving(true);
    try {
      const updates: Pick<DispatchOrder, 'accounts_posting_status' | 'accounts_approved_at' | 'accounts_approval_notes'> = {
        accounts_posting_status: 'approved',
        accounts_approved_at: new Date().toISOString(),
        accounts_approval_notes: accountsNotes,
      };
      const { error } = await supabase.from('dispatch_orders').update(updates).eq('id', accountsApproveOrder.id);
      if (error) throw error;

      // Approve the actual Sage review rows prepared by the bridge. The old
      // placeholder WHT/INV row was not a supported bridge transaction and
      // could never be posted safely.
      const { data: syncEvents, error: syncEventError } = await supabase
        .from('sync_log')
        .select('id, status')
        .eq('reference_id', accountsApproveOrder.id)
        .eq('event_type', 'dispatch_delivered')
        .order('created_at', { ascending: false })
        .limit(1);

      if (syncEventError) throw syncEventError;
      let dispatchEvent = syncEvents?.[0];
      if (!dispatchEvent) {
        const { data: createdEvent, error: createEventError } = await supabase
          .from('sync_log')
          .insert({
            event_type: 'dispatch_delivered',
            reference_id: accountsApproveOrder.id,
            reference_type: 'dispatch_orders',
            status: 'pending',
            message: 'Dispatch order delivered',
            details: {
              dispatch_number: accountsApproveOrder.dispatch_number,
              branch_id: accountsApproveOrder.branch_id,
              dispatch_type: accountsApproveOrder.dispatch_type,
              accounts_posting_status: 'approved',
              total_weight: accountsApproveOrder.total_weight,
              total_value: accountsApproveOrder.total_value,
              delivered_at: accountsApproveOrder.delivered_at,
            },
          })
          .select('id, status')
          .single();

        if (createEventError) throw createEventError;
        dispatchEvent = createdEvent;
      }
      if (dispatchEvent.status === 'success') {
        throw new Error('This dispatch has already been posted to Sage.');
      }

      const { data: pendingReviews, error: reviewsError } = await supabase
        .from('sage_posting_reviews')
        .select('id')
        .eq('sync_event_id', dispatchEvent.id)
        .eq('status', 'pending');

      if (reviewsError) throw reviewsError;

      if (pendingReviews && pendingReviews.length > 0) {
        const { error: approveError } = await supabase
          .from('sage_posting_reviews')
          .update({
            status: 'approved',
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('sync_event_id', dispatchEvent.id)
          .eq('status', 'pending');
        if (approveError) throw approveError;
      } else {
        // If the bridge has not prepared its rows yet, resume the event. The
        // bridge sees accounts_posting_status=approved and creates real rows
        // as approved, ready for immediate Sage posting.
        const { error: resumeError } = await supabase
          .from('sync_log')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', dispatchEvent.id);
        if (resumeError) throw resumeError;
      }

      toast.success(`Accounts approval completed for ${accountsApproveOrder.dispatch_number}. Sage posting has been released.`);
      setShowAccountsApproveModal(false);

      if (viewOrder?.id === accountsApproveOrder.id) {
        setViewOrder({ ...viewOrder, ...updates });
      }

      setAccountsApproveOrder(null);
      setAccountsNotes('');
      fetchOrders();
    } catch (err: any) {
      toast.error(`Failed to approve accounts posting: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const STATUS_FLOW: Record<string, { label: string; next: string; icon: any }> = {
    pending: { label: 'Start Loading', next: 'loading', icon: Box },
    loading: { label: 'Mark Dispatched', next: 'dispatched', icon: Truck },
    dispatched: { label: 'In Transit', next: 'in_transit', icon: Route },
    in_transit: { label: 'Confirm Delivery', next: 'delivered', icon: CheckCircle2 },
  };
  const nextStatus = (s: string) => STATUS_FLOW[s] || null;

  // Compute 4-step workflow status stage for any order
  const getOrderStep = (o: DispatchOrder) => {
    let currentStep = 1;
    let step1Done = true;
    let step2Done = false;
    let step3Done = false;
    let step4Done = false;

    if (o.status === 'dispatched' || o.status === 'in_transit' || o.status === 'delivered') {
      step2Done = true;
      currentStep = 2;
    }
    if (o.status === 'delivered' || o.branch_confirmation_status === 'confirmed') {
      currentStep = 3;
    }
    if (o.branch_confirmation_status === 'confirmed') {
      step3Done = true;
    }
    if (o.accounts_posting_status === 'approved') {
      step4Done = true;
      currentStep = 4;
    }

    return { currentStep, step1Done, step2Done, step3Done, step4Done };
  };

  const getDispatchStage = (o: DispatchOrder) => {
    if (o.accounts_posting_status === 'approved') {
      return { label: 'Step 4: Posted to Sage', tone: 'bg-purple-50 text-purple-700 border-purple-200', icon: DollarSign };
    }
    if (o.branch_confirmation_status === 'confirmed') {
      return { label: 'Step 3: Branch Receipt Confirmed', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Check };
    }
    if (o.status === 'delivered') {
      return { label: 'Step 3: Awaiting Branch Receipt', tone: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock };
    }
    if (o.status === 'in_transit') {
      return { label: 'Step 2: In Transit / On Road', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Route };
    }
    if (o.status === 'dispatched') {
      return { label: 'Step 2: Dispatched', tone: 'bg-blue-50 text-blue-700 border-blue-200', icon: Truck };
    }
    if (o.status === 'loading') {
      return { label: 'Step 1: Loading', tone: 'bg-cyan-50 text-cyan-700 border-cyan-200', icon: Box };
    }
    return { label: 'Step 1: Pending Loading', tone: 'bg-slate-50 text-slate-600 border-slate-200', icon: Clock };
  };

  return (
    <div className="h-[calc(100vh-2rem)] flex flex-col bg-slate-50/60 p-4 md:p-6 overflow-hidden">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col h-full space-y-4">

        {/* CLEAN EXECUTIVE HEADER BANNER */}
        <div className="shrink-0 space-y-3">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 p-4 md:p-5 rounded-2xl text-white shadow-xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 relative z-10">
              <div className="w-11 h-11 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center shadow-lg shrink-0">
                <Truck className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">Dispatch Logistics & D-Note Hub</h1>
                  <span className="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                    <Sparkles className="w-3 h-3" /> Sage Integrated
                  </span>
                </div>
                <p className="text-slate-300 text-xs mt-0.5">
                  Manage Fleet, Hired Transporters, Official D-Notes, Branch Receipt & Accounts Invoicing.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={fetchOrders}
                className="p-2.5 bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl transition-all text-white"
                title="Refresh Dispatches"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => { resetForm(); setEditingOrderId(null); setShowCreate(true); }}
                className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95 text-xs"
              >
                <Plus className="w-4 h-4" />
                New Dispatch Order
              </button>
            </div>
          </div>

          {/* STREAMLINED KPI CARDS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
                <Truck className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Orders</span>
                <span className="text-lg font-extrabold text-slate-900">{stats.total.toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-amber-200 bg-amber-50/20 p-3 shadow-sm flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Pending Queue</span>
                <span className="text-lg font-extrabold text-amber-900">{stats.pending.toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-purple-200 bg-purple-50/20 p-3 shadow-sm flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center text-purple-700 shrink-0">
                <Route className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">In-Transit / Road</span>
                <span className="text-lg font-extrabold text-purple-900">{stats.inTransit.toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-emerald-200 bg-emerald-50/20 p-3 shadow-sm flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Delivered Volume</span>
                <span className="text-lg font-extrabold text-emerald-900">{(stats.totalWeight / 1000).toFixed(2)} <span className="text-xs font-normal text-emerald-600">t</span></span>
              </div>
            </div>
          </div>

          {/* TAB FILTERS & SEARCH TOOLBAR */}
          <div className="bg-white rounded-2xl border border-slate-200 p-2.5 shadow-sm">
            <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
              <div className="flex flex-wrap gap-1 bg-slate-100/80 p-1 rounded-xl">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      tab === t.key
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search dispatch #, D-Note #, driver, truck..."
                  className="w-full pl-9 pr-4 py-1.5 border border-slate-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-slate-50/50"
                />
              </div>
            </div>
          </div>
        </div>

        {/* CARD-BASED DISPATCH LIST */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm relative">

          {/* Sticky Column Header */}
          <div className="sticky top-0 z-10 bg-slate-950 px-5 py-2.5 flex items-center gap-4 shadow-md">
            <div className="w-1 h-5 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest w-[160px]">Dispatch Ref</span>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest w-[160px]">Type & Destination</span>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest w-[140px]">Logistics & Driver</span>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest w-[80px]">Weight</span>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex-1">Workflow & Actions</span>
          </div>

          {/* Card List */}
          <div className="p-4 space-y-3">
            {filtered.map((o) => {
                  const stepInfo = getOrderStep(o);
                  const isBranchConfirmed = o.branch_confirmation_status === 'confirmed';
                  const isAccountsApproved = o.accounts_posting_status === 'approved';
                  const stage = getDispatchStage(o);
                  const StageIcon = stage.icon;

                  // Derive accent color per status
                  const accentClass = isAccountsApproved
                    ? 'bg-emerald-500'
                    : o.dispatch_type === 'branch_transfer' && isBranchConfirmed
                      ? 'bg-teal-400'
                      : stepInfo.step2Done
                        ? 'bg-purple-500'
                        : 'bg-blue-500';

                  return (
                    /* ═══════════ DISPATCH CARD ═══════════ */
                    <div
                      key={o.id}
                      className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden"
                    >
                      {/* Single Row: Info + Actions */}
                      <div className="flex items-center gap-0 min-h-[60px]">

                        {/* Colored Status Accent Bar */}
                        <div className={`w-1 self-stretch shrink-0 ${accentClass}`} />

                        {/* Dispatch Ref */}
                        <div className="flex items-center gap-3 px-4 py-3 w-[168px] shrink-0">
                          <div className="w-9 h-9 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center font-black font-mono text-xs border border-slate-700 shrink-0">
                            {o.dispatch_number.split('-').pop()?.slice(0, 3)}
                          </div>
                          <div>
                            <p className="font-extrabold text-slate-900 font-mono text-xs leading-tight">{o.dispatch_number}</p>
                            <div className="mt-0.5">
                              {o.physical_dnote_number ? (
                                <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded font-mono">D-Note #{o.physical_dnote_number}</span>
                              ) : (
                                <span className="text-[9px] text-slate-400">{format(new Date(o.dispatch_date), 'dd MMM yyyy')}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="w-px bg-slate-100 self-stretch shrink-0" />

                        {/* Type & Destination */}
                        <div className="flex items-center px-4 py-3 w-[155px] shrink-0">
                          <div className="space-y-1">
                            <span className={`inline-block text-[8.5px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              o.dispatch_type === 'customer_direct'
                                ? 'bg-amber-100 text-amber-900 border border-amber-200'
                                : 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                            }`}>
                              {o.dispatch_type === 'customer_direct' ? 'Customer Direct' : 'Branch Transfer'}
                            </span>
                            <p className="font-bold text-slate-800 text-xs leading-tight mt-0.5">
                              {o.dispatch_type === 'customer_direct'
                                ? (o.customer_name || 'Direct Customer')
                                : ((o.branches as any)?.name || '-')}
                            </p>
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="w-px bg-slate-100 self-stretch shrink-0" />

                        {/* Logistics & Driver */}
                        <div className="flex items-center px-4 py-3 w-[140px] shrink-0">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-slate-900 font-bold text-xs">
                              <Truck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{o.vehicle_number || 'Unassigned'}</span>
                              {o.is_hired_truck && (
                                <span className="text-[8px] font-extrabold text-amber-800 bg-amber-100 border border-amber-200 px-1 rounded-sm">HIRED</span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 flex items-center gap-1">
                              <User className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>{o.driver_name || 'No driver'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="w-px bg-slate-100 self-stretch shrink-0" />

                        {/* Initiated By */}
                        <div className="flex items-center px-4 py-3 w-[130px] shrink-0">
                          <div className="space-y-0.5">
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Initiated By</p>
                            <p className="text-xs font-semibold text-slate-800 truncate">{(o as any).creator?.full_name || (o as any).creator?.email || '—'}</p>
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="w-px bg-slate-100 self-stretch shrink-0" />

                        {/* Weight */}
                        <div className="flex items-center px-4 py-3 w-[90px] shrink-0">
                          <div>
                            <p className="font-extrabold text-slate-900 font-mono text-sm leading-tight">{o.total_weight.toLocaleString()}</p>
                            <p className="text-[9px] text-slate-400 font-medium">{(o.total_weight / 1000).toFixed(2)} t</p>
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="w-px bg-slate-100 self-stretch shrink-0" />

                        {/* ── ACTION BUTTONS (flex-1 fills remaining space) ── */}
                        <div className="flex items-center justify-between flex-1 px-4 py-3 gap-2">

                          {/* Left: action buttons */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-extrabold text-[10px] shrink-0 ${stage.tone}`}>
                              <StageIcon className="w-3 h-3" /> {stage.label}
                            </span>

                            <button
                              onClick={() => openDNoteModal(o)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-[10px] shadow-sm transition-all shrink-0"
                              title="Official Delivery Note"
                            >
                              <FileText className="w-3 h-3 text-amber-400" /> D-Note
                            </button>

                            {o.dispatch_type === 'branch_transfer' && (
                              isBranchConfirmed ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] shrink-0">
                                  <Check className="w-3 h-3" /> Branch Confirmed
                                </span>
                              ) : o.status !== 'delivered' ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500 border border-slate-200 font-bold text-[10px] shrink-0" title="Available after the dispatch is delivered">
                                  <Clock className="w-3 h-3" /> Receipt After Delivery
                                </span>
                              ) : (
                                <button
                                  onClick={() => openBranchConfirmModal(o)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-[10px] shadow-sm active:scale-95 transition-all shrink-0"
                                >
                                  <Check className="w-3 h-3" /> Confirm Receipt
                                </button>
                              )
                            )}

                            {isAccountsApproved ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 font-bold text-[10px] shrink-0">
                                <DollarSign className="w-3 h-3" /> Posted to Sage
                              </span>
                            ) : (
                              isFinance ? (
                                (o.dispatch_type === 'customer_direct' || isBranchConfirmed) && (
                                  <button
                                    onClick={() => openAccountsApproveModal(o)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-[10px] shadow-sm active:scale-95 transition-all shrink-0"
                                  >
                                    <DollarSign className="w-3 h-3" /> Finance Review & Post
                                  </button>
                                )
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[10px] shrink-0" title="Finance & Admin access required">
                                  <Clock className="w-3 h-3" /> Awaiting Finance
                                </span>
                              )
                            )}
                          </div>

                          {/* Right: View Details */}
                          <button
                            onClick={() => openView(o)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] transition-colors shrink-0"
                            title="View full dispatch details & workflow status"
                          >
                            <Eye className="w-3 h-3" /> View Details
                          </button>

                        </div>

                      </div>
                    </div>
                  );
                })}

            {/* Empty State */}
            {!filtered.length && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Truck className="w-14 h-14 mb-4 text-slate-300 animate-pulse" />
                <p className="text-base font-bold text-slate-700">No dispatch orders found</p>
                <p className="text-xs mt-1 text-slate-400">Try adjusting your tab filter or create a new dispatch order.</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* CREATE / EDIT DISPATCH MODAL */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-5xl w-[98vw] h-[92vh] max-h-[92vh] p-0 sm:!max-w-5xl flex flex-col border-0 shadow-2xl rounded-3xl overflow-hidden [&>button.absolute]:hidden">
          
          {/* Header Banner */}
          <div className="shrink-0 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white px-6 py-4 relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                  <Truck className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight">
                    {editingOrderId ? `Edit Dispatch Order (${dispatchNumber})` : 'New Dispatch Order (Step 1)'}
                  </h2>
                  <p className="text-slate-300 text-xs">Assign Driver, Hired Transporter, Vehicle & Generate D-Note</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 bg-slate-50/80 space-y-5">
            
            {/* DISPATCH DESTINATION TYPE SELECTOR */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <label className="text-xs font-extrabold text-slate-900 uppercase tracking-wider block">
                1. Select Dispatch Type & Destination
              </label>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, dispatch_type: 'branch_transfer' })}
                  className={`p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 ${
                    form.dispatch_type === 'branch_transfer'
                      ? 'bg-indigo-50/80 border-indigo-500 text-indigo-950 ring-2 ring-indigo-500/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    form.dispatch_type === 'branch_transfer' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Building className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-extrabold text-xs">Branch Transfer (IBT)</p>
                    <p className="text-[10px] text-slate-500">Inter-branch inventory transfer requiring receiving confirmation</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setForm({ ...form, dispatch_type: 'customer_direct' })}
                  className={`p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 ${
                    form.dispatch_type === 'customer_direct'
                      ? 'bg-amber-50/80 border-amber-500 text-amber-950 ring-2 ring-amber-500/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    form.dispatch_type === 'customer_direct' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-extrabold text-xs">Customer Direct Sales</p>
                    <p className="text-[10px] text-slate-500">Direct delivery to client; D-Note triggers Accounts Customer Invoice</p>
                  </div>
                </button>
              </div>

              {/* Destination inputs based on type */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
                {form.dispatch_type === 'branch_transfer' ? (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[11px] font-bold text-slate-600 uppercase">Destination Branch *</label>
                    <select
                      value={form.branch_id}
                      onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-emerald-500/20 bg-white"
                    >
                      <option value="">Select destination branch...</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name} ({b.sage_code || 'No Code'})</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[11px] font-bold text-slate-600 uppercase">Customer Name *</label>
                      <input
                        type="text"
                        value={form.customer_name}
                        onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                        placeholder="e.g. Farmer Direct Ltd"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold bg-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600 uppercase">Customer Code</label>
                      <input
                        type="text"
                        value={form.customer_code}
                        onChange={(e) => setForm({ ...form, customer_code: e.target.value })}
                        placeholder="e.g. CUST-091"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold bg-white"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Source Warehouse</label>
                  <select
                    value={form.warehouse_id}
                    onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-emerald-500/20 bg-white"
                  >
                    <option value="">Select warehouse...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Dispatch Date</label>
                  <input
                    type="date"
                    value={form.dispatch_date}
                    onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-emerald-500/20 bg-white"
                  />
                </div>
              </div>
            </div>

            {/* DRIVER, TRUCK & HIRED TRANSPORTER LOGISTICS */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-600" />
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">2. Transporter, Driver & Truck Info</h3>
                </div>

                {/* Hired Truck Toggle */}
                <label className="inline-flex items-center gap-2 cursor-pointer bg-amber-50 px-3 py-1 rounded-xl border border-amber-200 text-amber-900 font-bold text-xs">
                  <input
                    type="checkbox"
                    checked={form.is_hired_truck}
                    onChange={(e) => setForm({ ...form, is_hired_truck: e.target.checked })}
                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                  />
                  Hired / Third-Party Truck?
                </label>
              </div>

              {form.is_hired_truck && (
                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs space-y-2">
                  <span className="font-extrabold text-amber-800 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-amber-700" /> Hired Transporter Details
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-amber-900 uppercase">Transporter Company Name *</label>
                      <input
                        type="text"
                        value={form.transporter_name}
                        onChange={(e) => setForm({ ...form, transporter_name: e.target.value })}
                        placeholder="e.g. Swift Freight Logistics / Bolloré"
                        className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-amber-900 uppercase">Driver Contact / Phone</label>
                      <input
                        type="text"
                        value={form.driver_phone}
                        onChange={(e) => setForm({ ...form, driver_phone: e.target.value })}
                        placeholder="e.g. +263 77 123 4567"
                        className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Vehicle Reg Number *</label>
                  <input
                    type="text"
                    list="truck-list"
                    value={form.vehicle_number}
                    onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })}
                    placeholder="e.g. ABG 1234"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold bg-white"
                  />
                  <datalist id="truck-list">
                    {FLEET_TRUCKS.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Trailer Reg Number</label>
                  <input
                    type="text"
                    value={form.trailer_number}
                    onChange={(e) => setForm({ ...form, trailer_number: e.target.value })}
                    placeholder="e.g. TR-9021"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium bg-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Driver Name *</label>
                  <input
                    type="text"
                    list="driver-list"
                    value={form.driver_name}
                    onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
                    placeholder="e.g. P. Tembo / S. Mujele"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold bg-white"
                  />
                  <datalist id="driver-list">
                    {FLEET_DRIVERS.map(d => <option key={d} value={d} />)}
                  </datalist>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Physical D-Note Serial # (Book)</label>
                  <input
                    type="text"
                    value={form.physical_dnote_number}
                    onChange={(e) => setForm({ ...form, physical_dnote_number: e.target.value })}
                    placeholder="e.g. 35877"
                    className="w-full border border-rose-300 rounded-xl px-3 py-2 text-xs font-bold text-rose-700 font-mono bg-rose-50/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">HFDN Ref Number</label>
                  <input
                    type="text"
                    value={form.hfdn_reference}
                    onChange={(e) => setForm({ ...form, hfdn_reference: e.target.value })}
                    placeholder="e.g. 16+0947.5"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Order / Invoice Ref</label>
                  <input
                    type="text"
                    value={form.order_number}
                    onChange={(e) => setForm({ ...form, order_number: e.target.value })}
                    placeholder="e.g. ORD-2026-90"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Delivery Notes / Remarks</label>
                  <input
                    value={form.delivery_notes}
                    onChange={(e) => setForm({ ...form, delivery_notes: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white"
                    placeholder="Special instructions..."
                  />
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">3. Dispatch Products & Quantities</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setItems([...items, { ...EMPTY_ITEM }])}
                  className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-3 py-1 rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Product
                </button>
              </div>

              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    <div className="md:col-span-5 space-y-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">Product Formulation</label>
                      <select
                        value={item.formulation_id}
                        onChange={(e) => updateItem(idx, 'formulation_id', e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-white"
                      >
                        <option value="">Select product...</option>
                        {formulations.map((f) => (
                          <option key={f.id} value={f.id}>{f.sage_code} — {f.name}</option>
                        ))}
                      </select>
                      {item.formulation_id && (
                        <p className={`text-[10px] font-bold ${stockBalances[item.formulation_id] > 0 ? 'text-emerald-700' : 'text-amber-600'}`}>
                          Sage DEB Stock: {stockBalances[item.formulation_id] !== undefined ? `${stockBalances[item.formulation_id].toLocaleString()} kg` : '…'}
                        </p>
                      )}
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">Batch Number</label>
                      {batchNumbers[item.formulation_id]?.length ? (
                        <select
                          value={item.batch_number}
                          onChange={(e) => updateItem(idx, 'batch_number', e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono bg-white"
                        >
                          <option value="">Select batch...</option>
                          {batchNumbers[item.formulation_id].map((bn) => (
                            <option key={bn} value={bn}>{bn}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={item.batch_number}
                          onChange={(e) => updateItem(idx, 'batch_number', e.target.value)}
                          placeholder="e.g. BATCH-2026-001"
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono bg-white"
                        />
                      )}
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="block text-[10px] font-bold text-emerald-700 uppercase">Bags</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity_bags || ''}
                        onChange={(e) => updateItem(idx, 'quantity_bags', +e.target.value)}
                        className="w-full border border-emerald-300 rounded-lg px-2.5 py-1.5 text-xs font-extrabold bg-emerald-50/50 text-emerald-900"
                        placeholder="0"
                      />
                      <p className="text-[10px] text-slate-500">{Number(item.quantity || 0).toLocaleString()} kg</p>
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">Bag Size</label>
                      <div className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-semibold text-slate-700">
                        {bagSizeKg(item.bag_size_kg)} kg / bag
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Total: <strong className="text-emerald-700 font-mono text-sm">{items.reduce((sum, item) => sum + Number(item.quantity_bags || 0), 0).toLocaleString()} bags</strong> <span className="text-slate-400">({totalWeight.toLocaleString()} kg)</span></span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving || (form.dispatch_type === 'branch_transfer' && !form.branch_id) || (form.dispatch_type === 'customer_direct' && !form.customer_name)}
                className="px-5 py-2.5 text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl hover:from-emerald-600 hover:to-teal-700 shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                <Truck className="w-4 h-4" />
                {saving ? 'Saving...' : editingOrderId ? 'Update Dispatch' : 'Save & Generate D-Note'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* VIEW DETAIL MODAL */}
      <Dialog open={!!viewOrder} onOpenChange={(v) => { if (!v) setViewOrder(null); }}>
        <DialogContent className="max-w-6xl w-[98vw] h-[92vh] max-h-[92vh] p-0 sm:!max-w-6xl flex flex-col border-0 shadow-2xl rounded-3xl overflow-hidden [&>button.absolute]:hidden">
          {viewOrder && (
            <>
              {/* Header */}
              <div className="shrink-0 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white px-6 py-4 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                      <Truck className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-black font-mono tracking-tight">{viewOrder.dispatch_number}</h2>
                        {viewOrder.physical_dnote_number && (
                          <span className="bg-rose-500/20 text-rose-300 text-xs font-extrabold px-2 py-0.5 rounded border border-rose-500/30 font-mono">
                            D-Note Book #{viewOrder.physical_dnote_number}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Date: {format(new Date(viewOrder.dispatch_date), 'dd MMM yyyy')} • Driver: {viewOrder.driver_name || 'N/A'} • Vehicle: {viewOrder.vehicle_number || 'N/A'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setViewOrder(null)}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto px-6 py-6 bg-slate-50/80 space-y-6">
                
                {/* Action Bar with Official D-Note Printer & Status-Aware Next Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openDNoteModal(viewOrder)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-blue-900 text-white hover:bg-blue-950 shadow-md"
                    >
                      <FileText className="w-4 h-4 text-amber-400" /> Print Official D-Note
                    </button>

                    {/* Step 3: Branch Confirm (Disabled if already confirmed) */}
                    {viewOrder.dispatch_type === 'branch_transfer' && (
                      viewOrder.branch_confirmation_status === 'confirmed' ? (
                        <span className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 cursor-default">
                          <Check className="w-4 h-4 text-emerald-600" /> Step 3: Branch Confirmed
                        </span>
                      ) : viewOrder.status !== 'delivered' ? (
                        <span className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 text-slate-500 border border-slate-200 cursor-not-allowed">
                          <Clock className="w-4 h-4" /> Step 3: Available After Delivery
                        </span>
                      ) : (
                        <button
                          onClick={() => openBranchConfirmModal(viewOrder)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white shadow-md"
                        >
                          <Check className="w-4 h-4" /> Step 3: Confirm Branch Receipt
                        </button>
                      )
                    )}

                    {/* Step 4: Accounts Post (FINANCE & ADMIN ONLY) */}
                    {viewOrder.accounts_posting_status === 'approved' ? (
                      <span className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold rounded-xl bg-purple-50 text-purple-900 border border-purple-300 cursor-default">
                        <DollarSign className="w-4 h-4 text-purple-600" /> Step 4: Posted to Sage
                      </span>
                    ) : (
                      isFinance ? (
                        (viewOrder.dispatch_type === 'customer_direct' || viewOrder.branch_confirmation_status === 'confirmed') && (
                          <button
                            onClick={() => openAccountsApproveModal(viewOrder)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-md"
                          >
                            <DollarSign className="w-4 h-4" /> Step 4: Finance Review & Post
                          </button>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-amber-50 text-amber-800 border border-amber-200 cursor-default">
                          <Clock className="w-4 h-4 text-amber-600" /> Step 4: Finance Only
                        </span>
                      )
                    )}
                  </div>

                  {nextStatus(viewOrder.status) && (
                    <button
                      onClick={() => updateStatus(viewOrder.id, nextStatus(viewOrder.status)!.next)}
                      className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg"
                    >
                      <ArrowRight className="w-4 h-4" />
                      Advance to {nextStatus(viewOrder.status)!.label}
                    </button>
                  )}
                </div>

                {/* ══════════════════════════════════════════════════════════════ */}
                {/* WORKFLOW STATUS BREAKDOWN */}
                {/* ══════════════════════════════════════════════════════════════ */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
                    <Route className="w-4 h-4 text-indigo-500" />
                    <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Dispatch Workflow Status</h3>
                  </div>

                  {/* Step blocks */}
                  <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100">

                    {/* STAGE 1: LOADED */}
                    <div className="p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-teal-600 text-white text-[10px] font-black flex items-center justify-center shrink-0">1</div>
                        <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">Loaded & Dispatched</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                        <span className="text-xs font-bold text-teal-700">Complete</span>
                      </div>
                      <p className="text-[10px] text-slate-500">Dispatched on {format(new Date(viewOrder.dispatch_date), 'dd MMM yyyy')}</p>
                      {viewOrder.physical_dnote_number && (
                        <p className="text-[10px] font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded inline-block">D-Note #{viewOrder.physical_dnote_number}</p>
                      )}
                    </div>

                    {/* STAGE 2: IN-TRANSIT */}
                    <div className={`p-4 space-y-2 ${
                      ['dispatched','in_transit','delivered'].includes(viewOrder.status) ? '' : 'opacity-50'
                    }`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full text-white text-[10px] font-black flex items-center justify-center shrink-0 ${
                          ['dispatched','in_transit','delivered'].includes(viewOrder.status) ? 'bg-purple-600' : 'bg-slate-300'
                        }`}>2</div>
                        <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">In-Transit / On Road</span>
                      </div>
                      {['dispatched','in_transit','delivered'].includes(viewOrder.status) ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-purple-500 shrink-0" />
                          <span className="text-xs font-bold text-purple-700">Vehicle Dispatched</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-bold text-slate-400">Not yet dispatched</span>
                        </div>
                      )}
                      <p className="text-[10px] text-slate-500">Vehicle: {viewOrder.vehicle_number || 'Unassigned'}</p>
                      <p className="text-[10px] text-slate-500">Driver: {viewOrder.driver_name || 'N/A'}</p>
                    </div>

                    {/* STAGE 3: BRANCH RECEIPT (IBT only) */}
                    <div className={`p-4 space-y-2 ${
                      viewOrder.dispatch_type === 'branch_transfer' ? '' : 'bg-slate-50/50'
                    }`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full text-white text-[10px] font-black flex items-center justify-center shrink-0 ${
                          viewOrder.branch_confirmation_status === 'confirmed' ? 'bg-emerald-500' :
                          viewOrder.dispatch_type === 'branch_transfer' ? 'bg-amber-400' : 'bg-slate-200'
                        }`}>3</div>
                        <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">Branch Receipt</span>
                      </div>
                      {viewOrder.dispatch_type !== 'branch_transfer' ? (
                        <p className="text-[10px] text-slate-400 italic">N/A — Customer Direct</p>
                      ) : viewOrder.branch_confirmation_status === 'confirmed' ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span className="text-xs font-bold text-emerald-700">Confirmed Received</span>
                          </div>
                          {viewOrder.branch_confirmation_notes && (
                            <p className="text-[10px] text-slate-500 italic">&ldquo;{viewOrder.branch_confirmation_notes}&rdquo;</p>
                          )}
                          <p className="text-[10px] text-slate-500">Branch: {(viewOrder.branches as any)?.name || '-'}</p>
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="text-xs font-bold text-amber-700">Awaiting branch confirmation</span>
                        </div>
                      )}
                    </div>

                    {/* STAGE 4: ACCOUNTS POSTING */}
                    <div className={`p-4 space-y-2 ${
                      viewOrder.accounts_posting_status === 'approved' ? '' : 'opacity-60'
                    }`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full text-white text-[10px] font-black flex items-center justify-center shrink-0 ${
                          viewOrder.accounts_posting_status === 'approved' ? 'bg-emerald-700' : 'bg-slate-300'
                        }`}>4</div>
                        <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">Accounts & Posting</span>
                      </div>
                      {viewOrder.accounts_posting_status === 'approved' ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-xs font-bold text-emerald-700">Posted to Sage</span>
                          </div>
                          {viewOrder.accounts_approval_notes && (
                            <p className="text-[10px] text-slate-500 italic">&ldquo;{viewOrder.accounts_approval_notes}&rdquo;</p>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-bold text-slate-400">Pending finance approval</span>
                        </div>
                      )}
                      <p className="text-[10px] text-slate-500">
                        {viewOrder.dispatch_type === 'customer_direct' ? 'Customer Invoice' : 'Sage IBT Stock Transfer'}
                      </p>
                    </div>

                  </div>
                </div>

                {/* Line Items Table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-3 p-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Dispatched Line Items ({viewItems.length})</h3>
                    <span className="text-xs font-mono font-bold text-emerald-700">Total: {viewOrder.total_weight.toLocaleString()} kg</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900 text-white uppercase tracking-wider font-semibold">
                        <tr>
                          <th className="text-left px-4 py-2.5">Product Formulation</th>
                          <th className="text-left px-4 py-2.5">Sage Code</th>
                          <th className="text-left px-4 py-2.5">Batch #</th>
                          <th className="text-right px-4 py-2.5">Bags</th>
                          <th className="text-left px-4 py-2.5">Weight</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {viewItems.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-3 font-bold text-slate-900">{item.formulations?.name || '-'}</td>
                            <td className="px-4 py-3 font-mono font-bold text-blue-700">{item.formulations?.sage_code || '-'}</td>
                            <td className="px-4 py-3 font-mono text-slate-600">{item.batch_number || 'Unassigned'}</td>
                            <td className="px-4 py-3 text-right font-extrabold text-slate-900 font-mono">{Number(item.quantity_bags ?? bagsFromKg(item.quantity, item.bag_size_kg)).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                            <td className="px-4 py-3 text-slate-600">{item.quantity.toLocaleString()} kg <span className="text-[10px] text-slate-400">({bagSizeKg(item.bag_size_kg)} kg/bag)</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* OFFICIAL D-NOTE PRINTABLE MODAL */}
      <DeliveryNoteModal
        isOpen={showDNote}
        onClose={() => setShowDNote(false)}
        order={dnoteOrder}
        items={dnoteItems}
      />

      {/* BRANCH CONFIRM DELIVERY & VARIANCE DECLARATION MODAL */}
      <Dialog open={showBranchConfirmModal} onOpenChange={setShowBranchConfirmModal}>
        <DialogContent className="max-w-4xl w-full p-6 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-y-auto max-h-[90vh]">
          {branchConfirmOrder && (
            <div className="space-y-4">
              {/* Header Banner */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-600 text-white rounded-2xl shadow-sm">
                    <Building className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-slate-900 text-lg">Branch Delivery Receiving & Declaration</h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-300 font-mono">
                        {branchConfirmOrder.dispatch_number}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-medium">
                      Receiving Branch: <strong className="text-slate-800">{(branchConfirmOrder.branches as any)?.name || 'Branch'}</strong> | Vehicle: <strong className="text-slate-800">{branchConfirmOrder.vehicle_number || 'Unassigned'}</strong> (Driver: {branchConfirmOrder.driver_name || 'N/A'})
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              {(() => {
                const totalSent = branchConfirmItems.reduce((s, i) => s + i.dispatched_qty, 0);
                const totalRecv = branchConfirmItems.reduce((s, i) => s + i.received_qty, 0);
                const totalDamaged = branchConfirmItems.reduce((s, i) => s + i.damaged_qty, 0);
                const variance = totalRecv - totalSent;
                const totalSentBags = branchConfirmItems.reduce((s, i) => s + i.dispatched_bags, 0);
                const totalRecvBags = branchConfirmItems.reduce((s, i) => s + i.received_bags, 0);
                const varianceBags = totalRecvBags - totalSentBags;

                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase font-bold block">Sent / Dispatched</span>
                      <span className="text-base font-black text-slate-900 font-mono">{totalSentBags.toLocaleString()} bags</span>
                      <span className="block text-[10px] text-slate-500 font-mono">{totalSent.toLocaleString()} kg</span>
                    </div>
                    <div className="bg-teal-50 p-3 rounded-xl border border-teal-200">
                      <span className="text-[10px] text-teal-700 uppercase font-bold block">Branch Received</span>
                      <span className="text-base font-black text-teal-900 font-mono">{totalRecvBags.toLocaleString()} bags</span>
                      <span className="block text-[10px] text-teal-700/70 font-mono">{totalRecv.toLocaleString()} kg</span>
                    </div>
                    <div className={`p-3 rounded-xl border ${variance < 0 ? 'bg-red-50 border-red-200 text-red-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
                      <span className="text-[10px] uppercase font-bold block opacity-75">Net Variance</span>
                      <span className="text-base font-black font-mono">
                        {varianceBags > 0 ? `+${varianceBags}` : varianceBags < 0 ? `${varianceBags}` : '0 (Intact)'} bags
                      </span>
                      <span className="block text-[10px] font-mono opacity-70">{variance > 0 ? `+${variance}` : variance < 0 ? `${variance}` : '0'} kg</span>
                    </div>
                    <div className={`p-3 rounded-xl border ${totalDamaged > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                      <span className="text-[10px] uppercase font-bold block opacity-75">Damaged / Wet</span>
                      <span className="text-base font-black font-mono">{totalDamaged} bags/units</span>
                    </div>
                  </div>
                );
              })()}

              {/* Line-by-Line Receipt Declaration Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm bg-white">
                <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                  <span className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <Package className="w-4 h-4 text-teal-600" /> Line-by-Line Receipt Declaration ({branchConfirmItems.length} Products)
                  </span>
                  <span className="text-xs text-slate-500 font-medium">Specify actual offloaded quantities & discrepancy reason</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-bold">
                      <tr>
                        <th className="px-3.5 py-2.5 text-left">Product / Code</th>
                        <th className="px-3.5 py-2.5 text-left">Batch #</th>
                        <th className="px-3.5 py-2.5 text-right">Dispatched</th>
                        <th className="px-3.5 py-2.5 text-right text-teal-800">Received Bags</th>
                        <th className="px-3.5 py-2.5 text-right text-amber-800">Damaged Bags</th>
                        <th className="px-3.5 py-2.5 text-left">Discrepancy Reason</th>
                        <th className="px-3.5 py-2.5 text-left">Line Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-medium">
                      {branchConfirmItems.map((item, idx) => {
                        const lineVariance = item.received_qty - item.dispatched_qty;
                        const lineBagVariance = item.received_bags - item.dispatched_bags;
                        return (
                          <tr key={item.id} className={lineVariance < 0 || item.damaged_qty > 0 ? 'bg-amber-50/40' : 'hover:bg-slate-50'}>
                            <td className="px-3.5 py-2.5">
                              <div className="font-bold text-slate-900">{item.product_name}</div>
                              <div className="font-mono text-[10px] text-teal-700">{item.product_code}</div>
                            </td>
                            <td className="px-3.5 py-2.5 font-mono text-slate-600">{item.batch_number}</td>
                            <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-700">
                              <span className="block">{item.dispatched_bags.toLocaleString()} bags</span>
                              <span className="block text-[10px] text-slate-400">{item.dispatched_qty.toLocaleString()} {item.unit} • {item.bag_size_kg}kg/bag</span>
                            </td>
                            <td className="px-3.5 py-2.5 text-right">
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={item.received_bags}
                                onChange={(e) => updateBranchItem(idx, 'received_bags', Number(e.target.value))}
                                className="w-24 text-right border border-teal-300 rounded-lg px-2 py-1 font-mono font-extrabold focus:ring-2 focus:ring-teal-500 outline-none bg-teal-50"
                              />
                              <span className="block text-[10px] text-teal-700/70 font-mono">
                                {item.received_qty.toLocaleString()} {item.unit}
                              </span>
                              {lineVariance !== 0 && (
                                <span className={`block text-[10px] font-mono font-bold ${lineVariance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                  {lineBagVariance > 0 ? `+${lineBagVariance}` : `${lineBagVariance}`} bags / {lineVariance > 0 ? `+${lineVariance}` : `${lineVariance}`} {item.unit}
                                </span>
                              )}
                            </td>
                            <td className="px-3.5 py-2.5 text-right">
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={item.damaged_qty}
                                onChange={(e) => updateBranchItem(idx, 'damaged_qty', Number(e.target.value))}
                                className="w-20 text-right border border-amber-300 rounded-lg px-2 py-1 font-mono font-bold focus:ring-2 focus:ring-amber-500 outline-none bg-amber-50"
                              />
                            </td>
                            <td className="px-3.5 py-2.5">
                              <select
                                value={item.variance_reason}
                                onChange={(e) => updateBranchItem(idx, 'variance_reason', e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-1 text-[11px] font-medium outline-none focus:ring-1 focus:ring-teal-500"
                              >
                                <option value="Full Delivery - Intact">Full Delivery - Intact</option>
                                <option value="Short-Landed / Truck Offloaded Less">Short-Landed / Truck Offloaded Less</option>
                                <option value="Wet / Moisture Damage">Wet / Moisture Damage</option>
                                <option value="Torn / Open Bags">Torn / Open Bags</option>
                                <option value="Spillage in Transit">Spillage in Transit</option>
                                <option value="Driver Discrepancy / Broken Seal">Driver Discrepancy / Broken Seal</option>
                              </select>
                            </td>
                            <td className="px-3.5 py-2.5">
                              <input
                                type="text"
                                placeholder="e.g. 2 bags wet"
                                value={item.line_notes}
                                onChange={(e) => updateBranchItem(idx, 'line_notes', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[11px]"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Receiver Information & Remarks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700 uppercase">Received By (Branch Staff Name) *</label>
                    <input
                      type="text"
                      value={receiverName}
                      onChange={(e) => setReceiverName(e.target.value)}
                      placeholder="Enter branch staff receiver name..."
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold bg-white"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={driverSigned}
                      onChange={(e) => setDriverSigned(e.target.checked)}
                      className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 border-slate-300"
                    />
                    <span>Driver Acknowledged & Signed Delivery Note Remarks</span>
                  </label>
                </div>

                <div className="space-y-1 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  <label className="text-[11px] font-bold text-slate-700 uppercase">General Receiving Inspection Remarks</label>
                  <textarea
                    value={branchNotes}
                    onChange={(e) => setBranchNotes(e.target.value)}
                    placeholder="e.g. Offloaded 18 good bags, 2 bags short. Driver signed physical delivery note with short-landed remark."
                    rows={3}
                    className="w-full border border-slate-300 rounded-xl p-2 text-xs bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowBranchConfirmModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmBranchDelivery}
                  disabled={saving}
                  className="px-5 py-2.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md flex items-center gap-2 hover:scale-[1.01] transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" /> {saving ? 'Submitting Receipt...' : 'Confirm Branch Receipt & Submit Declaration'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ACCOUNTS APPROVE POSTING MODAL (FINANCE & ADMIN ONLY) */}
      <Dialog open={showAccountsApproveModal} onOpenChange={setShowAccountsApproveModal}>
        <DialogContent className="max-w-3xl w-full p-6 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-y-auto max-h-[90vh]">
          <div className="space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="p-2.5 bg-purple-100 rounded-xl text-purple-800">
                <DollarSign className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">Step 4: Finance Review & Sage Post</h3>
                <p className="text-xs text-slate-500">Review dispatch evidence, bags, kg and Sage posting legs before release.</p>
              </div>
            </div>

            {accountsApproveOrder && (
              <>
                {(() => {
                  const totalBags = accountsApproveItems.reduce((sum, item) => sum + Number(item.quantity_bags ?? bagsFromKg(item.quantity, item.bag_size_kg)), 0);
                  const totalKg = accountsApproveItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
                  const sourceWarehouse = `${(accountsApproveOrder as any).warehouses?.name || 'Source warehouse'}${(accountsApproveOrder as any).warehouses?.code ? ` (${(accountsApproveOrder as any).warehouses.code})` : ''}`;
                  const destination = accountsApproveOrder.dispatch_type === 'customer_direct'
                    ? (accountsApproveOrder.customer_name || 'Direct customer')
                    : `${(accountsApproveOrder.branches as any)?.name || 'Branch'}${(accountsApproveOrder.branches as any)?.sage_code ? ` (${(accountsApproveOrder.branches as any).sage_code})` : ''}`;

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Dispatch</span>
                        <p className="font-mono font-black text-slate-900 mt-1">{accountsApproveOrder.dispatch_number}</p>
                        <p className="text-slate-500 mt-0.5">D-Note #{accountsApproveOrder.physical_dnote_number || 'N/A'}</p>
                      </div>
                      <div className="rounded-2xl border border-purple-200 bg-purple-50 p-3">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-700">Posting Route</span>
                        <p className="font-bold text-purple-950 mt-1">{sourceWarehouse}</p>
                        <p className="text-purple-700">→ {destination}</p>
                      </div>
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Quantity to Post</span>
                        <p className="font-mono font-black text-emerald-950 mt-1">{totalBags.toLocaleString()} bags</p>
                        <p className="text-emerald-700">{totalKg.toLocaleString()} kg / {(totalKg / 1000).toFixed(2)} t</p>
                      </div>
                    </div>
                  );
                })()}

                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider">Dispatch Products Being Released to Sage</span>
                    <span className="text-[10px] text-slate-300">Finance verification summary</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-extrabold">
                        <tr>
                          <th className="px-3 py-2 text-left">Product</th>
                          <th className="px-3 py-2 text-left">Sage Code</th>
                          <th className="px-3 py-2 text-left">Batch #</th>
                          <th className="px-3 py-2 text-right">Bags</th>
                          <th className="px-3 py-2 text-right">Kg</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {accountsApproveItems.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-5 text-center text-slate-500 font-medium">Loading dispatch items...</td>
                          </tr>
                        ) : accountsApproveItems.map((item) => {
                          const bags = Number(item.quantity_bags ?? bagsFromKg(item.quantity, item.bag_size_kg));
                          const size = bagSizeKg(item.bag_size_kg);
                          return (
                            <tr key={item.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-bold text-slate-900">{(item.formulations as any)?.name || 'Product'}</td>
                              <td className="px-3 py-2 font-mono font-bold text-blue-700">{(item.formulations as any)?.sage_code || (item.formulations as any)?.code || '-'}</td>
                              <td className="px-3 py-2 font-mono text-slate-600">{item.batch_number || 'N/A'}</td>
                              <td className="px-3 py-2 text-right font-mono font-black text-slate-900">{bags.toLocaleString()} bags</td>
                              <td className="px-3 py-2 text-right font-mono text-slate-600">{Number(item.quantity || 0).toLocaleString()} kg <span className="text-[10px] text-slate-400">({size}kg/bag)</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-extrabold uppercase tracking-wider text-[10px] mb-1">Sage posting that will be released</p>
                  {accountsApproveOrder.dispatch_type === 'branch_transfer' ? (
                    <ul className="list-disc pl-4 space-y-1 font-medium">
                      <li>Stock OUT from source warehouse using Sage dispatch issue leg.</li>
                      <li>Stock IN to destination branch warehouse using Sage dispatch receipt leg.</li>
                      <li>The bridge worker posts after this finance approval; this button replaces separate manual approval on Sage Posting Review for dispatch.</li>
                    </ul>
                  ) : (
                    <ul className="list-disc pl-4 space-y-1 font-medium">
                      <li>Customer direct dispatch will be released for invoice/posting workflow.</li>
                      <li>Finance should verify customer, D-Note and quantities before approving.</li>
                    </ul>
                  )}
                </div>
              </>
            )}

            {!isFinance && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-rose-600 shrink-0" />
                Finance or Admin access required to approve postings.
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-600 uppercase">Finance Approval Remarks</label>
              <textarea
                value={accountsNotes}
                onChange={(e) => setAccountsNotes(e.target.value)}
                placeholder="e.g. Verified against D-Note #35877. Approved for posting."
                rows={3}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAccountsApproveModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAccountsApprovePosting}
                disabled={saving || !isFinance}
                className="px-4 py-2 text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white rounded-xl shadow-md disabled:opacity-50"
              >
                {saving ? 'Releasing...' : 'Approve & Release Sage Posting'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock Override Modal */}
      <StockOverrideModal
        open={showStockOverride}
        onClose={() => {
          setShowStockOverride(false);
          setStockErrors([]);
          setPendingDeliverCallback(null);
        }}
        errors={stockErrors}
        transactionType="dispatch_delivery"
        onConfirm={async () => {
          if (pendingDeliverCallback) {
            await pendingDeliverCallback();
          }
        }}
      />
    </div>
  );
}
