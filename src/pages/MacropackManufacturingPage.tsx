import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Eye, Play, CheckCircle, AlertTriangle, Package, Clock, Factory, Send, ThumbsUp, XCircle, RotateCcw, Loader2, Award, Sparkles, SlidersHorizontal, ShieldCheck, ChevronRight, Save } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';
import { validateStockAvailability, StockError } from '../lib/stockValidation';
import StockErrorBanner from '../components/stock/StockErrorBanner';
import StockOverrideModal from '../components/stock/StockOverrideModal';
import PackagingDeclarationModal from '../components/production/PackagingDeclarationModal';
import type { PackagingActual } from '../components/production/PackagingDeclarationModal';
import ApprovalHistory from '../components/approval/ApprovalHistory';

/* ── Types ── */
interface MacropackBom {
  id: string;
  macropack_code: string;
  macropack_name: string;
  version: number;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  ingredientCount?: number;
}

interface BomIngredient {
  id: string;
  macropack_bom_id: string;
  raw_material_id: string;
  grams_per_unit: number;
  raw_materials?: { id: string; code: string; name: string };
}

interface ManufactureOrder {
  id: string;
  macropack_bom_id: string;
  planned_units: number;
  actual_units: number | null;
  manufacture_date: string;
  manufactured_by: string | null;
  status: string;
  created_at: string;
  submitted_by?: string | null;
  submitted_at?: string | null;
  rm_approved_by?: string | null;
  rm_approved_at?: string | null;
  supervisor_approved_by?: string | null;
  supervisor_approved_at?: string | null;
  rejection_reason?: string | null;
  macropack_boms?: { macropack_code: string; macropack_name: string };
}

interface IssueRow {
  id?: string;
  raw_material_id: string;
  ingredient_name: string;
  ingredient_code: string;
  expected_grams: number;
  actual_grams_dispensed: number | string;
  variance_grams: number | null;
  variance_pct: number | null;
}

interface RawMaterial {
  id: string;
  code: string;
  name: string;
}

/* ── Constants ── */
const TABS = ['Manufacturing Orders', 'Macropack BOMs'] as const;
type TabType = typeof TABS[number];

const STATUS_STYLES: Record<string, { cls: string; label: string; icon: any }> = {
  DRAFT: { cls: 'bg-slate-100 text-slate-700 border-slate-300', label: 'Draft Order', icon: Clock },
  PENDING_RM: { cls: 'bg-amber-50 text-amber-800 border-amber-300', label: 'Pending RM Approval', icon: AlertTriangle },
  PENDING_SUPERVISOR: { cls: 'bg-amber-50 text-amber-800 border-amber-300', label: 'Pending Supervisor', icon: Clock },
  APPROVED: { cls: 'bg-blue-50 text-blue-800 border-blue-300', label: 'Approved', icon: CheckCircle },
  PLANNED: { cls: 'bg-blue-50 text-blue-800 border-blue-300', label: 'Planned', icon: CheckCircle },
  IN_PROGRESS: { cls: 'bg-emerald-50 text-emerald-800 border-emerald-300 animate-pulse', label: 'In Progress', icon: Factory },
  COMPLETED: { cls: 'bg-teal-100 text-teal-900 border-teal-300', label: 'Completed', icon: CheckCircle },
  CANCELLED: { cls: 'bg-red-50 text-red-800 border-red-300', label: 'Cancelled', icon: XCircle },
  REJECTED: { cls: 'bg-red-50 text-red-800 border-red-300', label: 'Rejected', icon: XCircle },
};

const emptyBomForm = {
  macropack_code: '',
  macropack_name: '',
  version: 1,
  effective_from: '',
  effective_to: '',
};

const emptyOrderForm = {
  macropack_bom_id: '',
  planned_units: '',
  manufacture_date: new Date().toISOString().split('T')[0],
};

export default function MacropackManufacturingPage() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('Manufacturing Orders');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Data
  const [boms, setBoms] = useState<MacropackBom[]>([]);
  const [orders, setOrders] = useState<ManufactureOrder[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);

  // Modals
  const [newOrderModalOpen, setNewOrderModalOpen] = useState(false);
  const [orderDetailModalOpen, setOrderDetailModalOpen] = useState(false);
  const [newBomModalOpen, setNewBomModalOpen] = useState(false);
  const [viewBomModalOpen, setViewBomModalOpen] = useState(false);

  // Forms
  const [orderForm, setOrderForm] = useState(emptyOrderForm);
  const [bomForm, setBomForm] = useState(emptyBomForm);
  const [bomIngredients, setBomIngredients] = useState<{ raw_material_id: string; grams_per_unit: string }[]>([]);

  // Detail view
  const [selectedOrder, setSelectedOrder] = useState<ManufactureOrder | null>(null);
  const [issueRows, setIssueRows] = useState<IssueRow[]>([]);
  const [declaredPackaging, setDeclaredPackaging] = useState<any[]>([]);
  const [orderDetailTab, setOrderDetailTab] = useState<'ingredients' | 'output' | 'audit'>('ingredients');
  const [selectedBom, setSelectedBom] = useState<MacropackBom | null>(null);
  const [selectedBomIngredients, setSelectedBomIngredients] = useState<BomIngredient[]>([]);

  // Preview for new order
  const [previewIngredients, setPreviewIngredients] = useState<{ name: string; code: string; expected_grams: number }[]>([]);

  // Stock validation
  const [stockErrors, setStockErrors] = useState<StockError[]>([]);
  const [showStockOverride, setShowStockOverride] = useState(false);
  const [pendingCompleteCallback, setPendingCompleteCallback] = useState<(() => Promise<void>) | null>(null);

  // Approval
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [approvalSaving, setApprovalSaving] = useState(false);

  // Packaging declaration
  const [showPackagingModal, setShowPackagingModal] = useState(false);
  const [bomPackagingItems, setBomPackagingItems] = useState<any[]>([]);

  // BOM packaging items edit
  const [bomPackagingRows, setBomPackagingRows] = useState<{ item_code: string; description: string; unit: string; expected_qty_per_unit: string }[]>([]);
  const [bomPackagingTab, setBomPackagingTab] = useState<'ingredients' | 'packaging'>('ingredients');

  async function fetchData() {
    setLoading(true);
    const [bomsRes, ordersRes, materialsRes] = await Promise.all([
      supabase.from('macropack_boms').select('*').order('macropack_name'),
      supabase.from('macropack_manufacture_orders').select('*, macropack_boms(macropack_code, macropack_name)').order('created_at', { ascending: false }),
      supabase.from('raw_materials').select('id, code, name').eq('is_active', true).order('name'),
    ]);

    // Count ingredients per BOM
    const bomData = bomsRes.data || [];
    if (bomData.length > 0) {
      const { data: ingCounts } = await supabase
        .from('macropack_bom_ingredients')
        .select('macropack_bom_id');
      const countMap: Record<string, number> = {};
      (ingCounts || []).forEach((i: any) => {
        countMap[i.macropack_bom_id] = (countMap[i.macropack_bom_id] || 0) + 1;
      });
      bomData.forEach(b => { b.ingredientCount = countMap[b.id] || 0; });
    }

    setBoms(bomData);
    setOrders(ordersRes.data || []);
    setMaterials(materialsRes.data || []);
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  /* ── Tab 1: Manufacturing Orders ── */
  const filteredOrders = useMemo(() => {
    if (!search) return orders;
    const q = search.toLowerCase();
    return orders.filter(o =>
      o.macropack_boms?.macropack_name?.toLowerCase().includes(q) ||
      o.macropack_boms?.macropack_code?.toLowerCase().includes(q) ||
      o.status.toLowerCase().includes(q)
    );
  }, [orders, search]);

  const filteredBoms = useMemo(() => {
    if (!search) return boms;
    const q = search.toLowerCase();
    return boms.filter(b =>
      b.macropack_name.toLowerCase().includes(q) ||
      b.macropack_code.toLowerCase().includes(q)
    );
  }, [boms, search]);

  const orderStats = useMemo(() => ({
    total: orders.length,
    pendingApproval: orders.filter(o => o.status === 'PENDING_RM' || o.status === 'PENDING_SUPERVISOR').length,
    inProgress: orders.filter(o => o.status === 'IN_PROGRESS').length,
    completed: orders.filter(o => o.status === 'COMPLETED').length,
  }), [orders]);

  async function updatePreview(bomId: string, units: string) {
    if (!bomId || !units || parseInt(units) <= 0) {
      setPreviewIngredients([]);
      return;
    }
    const { data: ings } = await supabase
      .from('macropack_bom_ingredients')
      .select('grams_per_unit, raw_materials(code, name)')
      .eq('macropack_bom_id', bomId);

    const plannedUnits = parseInt(units);
    setPreviewIngredients((ings || []).map((i: any) => ({
      name: i.raw_materials?.name || 'Unknown',
      code: i.raw_materials?.code || '',
      expected_grams: i.grams_per_unit * plannedUnits,
    })));
  }

  async function handleCreateOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!orderForm.macropack_bom_id || !orderForm.planned_units) {
      toast.error('Please fill in all required fields.');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('macropack_manufacture_orders').insert({
        macropack_bom_id: orderForm.macropack_bom_id,
        planned_units: parseInt(orderForm.planned_units),
        manufacture_date: orderForm.manufacture_date,
        manufactured_by: user?.id || null,
        status: 'DRAFT',
      });
      if (error) throw error;
      setNewOrderModalOpen(false);
      setOrderForm(emptyOrderForm);
      setPreviewIngredients([]);
      fetchData();
      toast.success('Macropack order created successfully!');
    } catch (error: any) {
      console.error('Error creating order:', error);
      toast.error(`Error: ${error.message || 'Failed to create order'}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprovalAction(action: 'submit' | 'approve_rm' | 'approve_supervisor' | 'reject' | 'revise') {
    if (!selectedOrder) return;
    setApprovalSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      let updatePayload: any = {};

      if (action === 'submit') {
        updatePayload = { status: 'PENDING_RM', submitted_by: user?.id, submitted_at: now };
      } else if (action === 'approve_rm') {
        // Enforce strict Raw Material stock availability check before approving RM allocation
        const ingredientsToCheck = issueRows.map(r => ({
          raw_material_id: r.raw_material_id,
          quantity: r.expected_grams / 1000,
          name: r.ingredient_name
        }));
        if (ingredientsToCheck.length > 0) {
          const stockCheck = await validateStockAvailability(ingredientsToCheck);
          if (!stockCheck.isValid) {
            setStockErrors(stockCheck.errors);
            setShowStockOverride(true);
            toast.error(`RM Allocation blocked: ${stockCheck.errors.length} raw material(s) out of stock!`);
            setApprovalSaving(false);
            return;
          }
        }
        updatePayload = { status: 'PENDING_SUPERVISOR', rm_approved_by: user?.id, rm_approved_at: now };
      } else if (action === 'approve_supervisor') {
        updatePayload = { status: 'APPROVED', supervisor_approved_by: user?.id, supervisor_approved_at: now };
      } else if (action === 'reject') {
        updatePayload = { status: 'REJECTED', rejection_reason: rejectionReason || 'Rejected by approver' };
      } else if (action === 'revise') {
        updatePayload = { status: 'DRAFT', rejection_reason: null };
      }

      const { error } = await supabase
        .from('macropack_manufacture_orders')
        .update(updatePayload)
        .eq('id', selectedOrder.id);

      if (error) throw error;

      setSelectedOrder({ ...selectedOrder, ...updatePayload });
      setShowRejectModal(false);
      setRejectionReason('');
      fetchData();
      toast.success(`Order ${action.replace('_', ' ')} updated successfully!`);
    } catch (error: any) {
      toast.error(`Error: ${error.message || 'Approval action failed'}`);
    } finally {
      setApprovalSaving(false);
    }
  }

  async function openOrderDetail(order: ManufactureOrder) {
    setSelectedOrder(order);
    setOrderDetailTab('ingredients');
    setOrderDetailModalOpen(true);

    const [ingsRes, issuesRes, pkgIssuesRes] = await Promise.all([
      supabase
        .from('macropack_bom_ingredients')
        .select('raw_material_id, grams_per_unit, raw_materials(id, code, name)')
        .eq('macropack_bom_id', order.macropack_bom_id),
      supabase
        .from('macropack_manufacture_issues')
        .select('*')
        .eq('manufacture_order_id', order.id),
      supabase
        .from('macropack_packaging_issues')
        .select('*')
        .eq('order_id', order.id),
    ]);

    const ings = ingsRes.data || [];
    const issues = issuesRes.data || [];
    setDeclaredPackaging(pkgIssuesRes.data || []);

    const issueMap: Record<string, any> = {};
    (issues || []).forEach((iss: any) => { issueMap[iss.raw_material_id] = iss; });

    const planned = order.planned_units;
    const rows: IssueRow[] = (ings || []).map((i: any) => {
      const expectedGrams = i.grams_per_unit * planned;
      const expectedKg = expectedGrams / 1000;
      const existing = issueMap[i.raw_material_id];
      const actual = existing?.actual_grams_dispensed != null ? existing.actual_grams_dispensed / 1000 : '';
      const actualNum = typeof actual === 'number' ? actual : parseFloat(actual as string);
      const variance = !isNaN(actualNum) && actual !== '' ? actualNum - expectedKg : null;
      const variancePct = variance !== null && expectedKg > 0 ? (variance / expectedKg) * 100 : null;

      return {
        id: existing?.id,
        raw_material_id: i.raw_material_id,
        ingredient_name: i.raw_materials?.name || 'Unknown',
        ingredient_code: i.raw_materials?.code || '',
        expected_grams: expectedGrams,
        actual_grams_dispensed: actual,
        variance_grams: variance,
        variance_pct: variancePct,
      };
    });

    setIssueRows(rows);
  }

  function handleIssueChange(rmId: string, value: string) {
    setIssueRows(prev => prev.map(r => {
      if (r.raw_material_id !== rmId) return r;
      const actual = value === '' ? '' : value;
      const actualNum = parseFloat(value);
      const expectedKg = r.expected_grams / 1000;
      const variance = !isNaN(actualNum) && value !== '' ? actualNum - expectedKg : null;
      const variancePct = variance !== null && expectedKg > 0 ? (variance / expectedKg) * 100 : null;
      return { ...r, actual_grams_dispensed: actual, variance_grams: variance, variance_pct: variancePct };
    }));
  }

  async function handleStartOrder() {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      // Validate raw material stock availability before starting run
      const ingredientsToCheck = issueRows.map(r => ({
        raw_material_id: r.raw_material_id,
        quantity: r.expected_grams / 1000,
        name: r.ingredient_name
      }));

      if (ingredientsToCheck.length > 0) {
        const stockCheck = await validateStockAvailability(ingredientsToCheck);
        if (!stockCheck.isValid) {
          setStockErrors(stockCheck.errors);
          setPendingCompleteCallback(() => async () => {
            await executeStartOrder();
          });
          setShowStockOverride(true);
          toast.error(`Cannot start run: ${stockCheck.errors.length} raw material(s) out of stock!`);
          setSaving(false);
          return;
        }
      }

      await executeStartOrder();
    } catch (error: any) {
      toast.error(`Error: ${error.message || 'Failed to start order'}`);
      setSaving(false);
    }
  }

  async function executeStartOrder() {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('macropack_manufacture_orders')
        .update({ status: 'IN_PROGRESS' })
        .eq('id', selectedOrder.id);
      if (error) throw error;
      setSelectedOrder({ ...selectedOrder, status: 'IN_PROGRESS' });
      fetchData();
      toast.success('Manufacturing run started!');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDispenseProgress(silent = false) {
    if (!selectedOrder) return false;
    setSaving(true);
    try {
      const issueData = issueRows
        .filter(r => r.actual_grams_dispensed !== '' && r.actual_grams_dispensed !== null && !isNaN(parseFloat(String(r.actual_grams_dispensed))))
        .map(r => ({
          manufacture_order_id: selectedOrder.id,
          raw_material_id: r.raw_material_id,
          expected_grams: r.expected_grams,
          actual_grams_dispensed: parseFloat(String(r.actual_grams_dispensed)) * 1000,
          dispensed_at: new Date().toISOString(),
        }));

      if (issueData.length > 0) {
        const { error } = await supabase
          .from('macropack_manufacture_issues')
          .upsert(issueData, { onConflict: 'manufacture_order_id, raw_material_id' });

        if (error) throw error;
        if (!silent) {
          toast.success(`Saved ${issueData.length} micro-ingredient dispense record(s) successfully!`);
        }
        return true;
      } else {
        if (!silent) toast.error('No valid dispensed quantities entered to save.');
        return false;
      }
    } catch (error: any) {
      console.error('Error saving dispense progress:', error);
      toast.error(`Failed to save dispense progress: ${error.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleCompleteOrder() {
    if (!selectedOrder) return;

    // Mandatory Validation: Block declare packaging modal if ANY micro-ingredient actual dispensed (kg) is empty or blank
    const missingDispensed = issueRows.filter(
      r => r.actual_grams_dispensed === '' || r.actual_grams_dispensed === null || isNaN(parseFloat(String(r.actual_grams_dispensed)))
    );

    if (missingDispensed.length > 0) {
      toast.error(`Please enter the Actual Dispensed (kg) for all ${missingDispensed.length} micro-ingredients before declaring packaging!`, { duration: 5000 });
      setOrderDetailTab('ingredients');
      return;
    }

    // Auto-save dispensed progress before proceeding to declare packaging
    const saved = await handleSaveDispenseProgress(true);
    if (!saved) return;

    const ingredientsToCheck = issueRows.map(r => ({
      raw_material_id: r.raw_material_id,
      quantity: r.expected_grams / 1000,
      name: r.ingredient_name
    }));

    const stockCheck = await validateStockAvailability(ingredientsToCheck);
    if (!stockCheck.isValid) {
      setStockErrors(stockCheck.errors);
      setPendingCompleteCallback(() => async () => {
        await completeOrderTransaction();
      });
      setShowStockOverride(true);
      toast.error(`Cannot complete order: ${stockCheck.errors.length} raw material(s) out of stock!`);
      return;
    }

    const { data: pkgItems } = await supabase
      .from('macropack_bom_packaging')
      .select('item_code, description, unit, expected_qty_per_unit')
      .eq('bom_id', selectedOrder.macropack_bom_id);

    const planned = selectedOrder.planned_units;
    const mapped = (pkgItems || []).map((p: any) => ({
      item_code: p.item_code,
      description: p.description,
      unit: p.unit,
      expected_qty: p.expected_qty_per_unit * planned,
    }));
    setBomPackagingItems(mapped);
    setShowPackagingModal(true);
  }

  async function handlePackagingConfirm(actuals: PackagingActual[], notes: string) {
    setShowPackagingModal(false);
    setSaving(true);
    await completeOrderTransaction(actuals, notes);
  }

  async function completeOrderTransaction(packagingActuals: PackagingActual[] = [], packagingNotes: string = '') {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const issueData = issueRows
        .filter(r => r.actual_grams_dispensed !== '' && r.actual_grams_dispensed !== null)
        .map(r => ({
          manufacture_order_id: selectedOrder.id,
          raw_material_id: r.raw_material_id,
          expected_grams: r.expected_grams,
          actual_grams_dispensed: parseFloat(String(r.actual_grams_dispensed)) * 1000,
          dispensed_at: new Date().toISOString(),
        }));

      if (issueData.length > 0) {
        await supabase
          .from('macropack_manufacture_issues')
          .delete()
          .eq('manufacture_order_id', selectedOrder.id);

        const { error: issueError } = await supabase
          .from('macropack_manufacture_issues')
          .insert(issueData);
        if (issueError) throw issueError;
      }

      if (packagingActuals.length > 0 || packagingNotes) {
        const pkgData = packagingActuals
          .filter(a => a.actual_qty !== '')
          .map(a => ({
            order_id: selectedOrder.id,
            item_code: a.item_code,
            description: a.description,
            expected_qty: a.expected_qty,
            actual_qty: parseFloat(String(a.actual_qty)) || 0,
            notes: packagingNotes || null,
          }));
        if (pkgData.length > 0) {
          await supabase.from('macropack_packaging_issues').insert(pkgData);
        }
      }

      // ── Integration Step 1: Calculate Ingredient Cost & Prepare Sage Reviews ──
      const rmIds = issueRows.map(r => r.raw_material_id);
      const { data: rawMaterials } = await supabase
        .from('raw_materials')
        .select('id, code, name, cost_per_unit_usd, cost_per_unit, current_stock')
        .in('id', rmIds);

      const rmMap = new Map((rawMaterials || []).map((rm: any) => [rm.id, rm]));
      let totalIngredientCostUSD = 0;
      const sageReviewRows: any[] = [];
      const trDate = format(new Date(), 'yyyy-MM-dd');
      const macroCode = selectedOrder.macropack_boms?.macropack_code || 'MP';

      for (const row of issueRows) {
        const rm = rmMap.get(row.raw_material_id);
        const actualKg = typeof row.actual_grams_dispensed === 'number'
          ? row.actual_grams_dispensed
          : parseFloat(String(row.actual_grams_dispensed || 0));

        if (actualKg > 0) {
          const unitCost = rm?.cost_per_unit_usd || rm?.cost_per_unit || 0;
          const lineCost = actualKg * unitCost;
          totalIngredientCostUSD += lineCost;

          // Deduct MES raw material stock
          if (rm && typeof rm.current_stock === 'number') {
            const newStock = Math.max(0, rm.current_stock - actualKg);
            await supabase
              .from('raw_materials')
              .update({ current_stock: newStock, updated_at: new Date().toISOString() })
              .eq('id', rm.id);
          }

          // Build Sage posting review for ingredient issue from RM Warehouse (WhseID 18)
          sageReviewRows.push({
            sync_event_id: selectedOrder.id,
            event_type: 'macropack_completed',
            event_description: `Macropack micro-ingredient issue: ${rm?.name || row.ingredient_name}`,
            sage_code: rm?.code || row.ingredient_code,
            transaction_type: 'issue',
            sage_tx_code: 'MFDR',
            quantity: -actualKg,
            unit_cost: unitCost,
            total_value: lineCost,
            warehouse_id: 18,
            warehouse_code: 'RAW',
            reference: `MP-${macroCode}`.substring(0, 20),
            description: `Macropack issue ${rm?.name || row.ingredient_name}`.substring(0, 40),
            transaction_date: trDate,
            status: 'pending',
          });
        }
      }

      const actualUnits = selectedOrder.planned_units || 1;
      const costPerUnit = actualUnits > 0 ? Number((totalIngredientCostUSD / actualUnits).toFixed(4)) : 0;

      // Build Sage posting review for manufactured Macropack WIP receipt into Production Warehouse (WhseID 19)
      if (selectedOrder.macropack_boms?.macropack_code) {
        sageReviewRows.push({
          sync_event_id: selectedOrder.id,
          event_type: 'macropack_completed',
          event_description: `Macropack WIP manufactured receipt: ${selectedOrder.macropack_boms?.macropack_name}`,
          sage_code: selectedOrder.macropack_boms?.macropack_code,
          transaction_type: 'production',
          sage_tx_code: 'MFMF',
          quantity: actualUnits,
          unit_cost: costPerUnit,
          total_value: totalIngredientCostUSD,
          warehouse_id: 19,
          warehouse_code: 'PROD',
          reference: `MP-${macroCode}`.substring(0, 20),
          description: `Macropack WIP ${selectedOrder.macropack_boms?.macropack_name}`.substring(0, 40),
          transaction_date: trDate,
          status: 'pending',
        });
      }

      // ── Integration Step 2: Insert Sage Review Records ──
      if (sageReviewRows.length > 0) {
        try {
          const { error: revErr } = await supabase.from('sage_posting_reviews').insert(sageReviewRows);
          if (revErr) console.warn('Sage posting review insert notice:', revErr.message);
        } catch (e) {
          console.warn('Sage posting review insert error skipped:', e);
        }
      }

      // ── Integration Step 3: Insert Sync Log Entry for Background Worker ──
      try {
        const { error: syncErr } = await supabase.from('sync_log').insert({
          event_type: 'macropack_manufactured',
          reference_type: 'macropack_manufacture_order',
          reference_id: selectedOrder.id,
          status: 'pending',
          description: `Macropack ${macroCode} manufactured (${actualUnits} units) - Sage SSMS review entries created`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (syncErr) console.warn('Sync log insert notice:', syncErr.message);
      } catch (e) {
        console.warn('Sync log insert error skipped:', e);
      }

      // ── Integration Step 4: Record Approval Audit Trail ──
      if (user?.id) {
        try {
          await supabase.from('approval_history').insert({
            entity_type: 'macropack_order',
            entity_id: selectedOrder.id,
            action: 'approved',
            new_status: 'COMPLETED',
            approved_by: user.id,
            comments: `Macropack manufacturing completed. Ingredients issued from RM Whse 18 & Macropack WIP received into Production Whse 19. Total cost: $${totalIngredientCostUSD.toFixed(2)}`,
            created_at: new Date().toISOString(),
          });
        } catch (e) {
          console.warn('Approval history insert notice:', e);
        }
      }

      // ── Integration Step 5: Update Order Status & Cost ──
      const { error: updateError } = await supabase
        .from('macropack_manufacture_orders')
        .update({
          status: 'COMPLETED',
          actual_units: actualUnits,
          cost_per_unit: costPerUnit,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedOrder.id);

      if (updateError) throw updateError;

      setSelectedOrder({ ...selectedOrder, status: 'COMPLETED', actual_units: actualUnits, cost_per_unit: costPerUnit });
      fetchData();
      toast.success(`Macropack order completed successfully! ${sageReviewRows.length} Sage SSMS integration records generated.`, { duration: 5000 });
    } catch (error: any) {
      console.error('Error completing order:', error);
      toast.error(`Error: ${error.message || 'Failed to complete order'}`);
    } finally {
      setSaving(false);
    }
  }

  async function openViewBom(bom: MacropackBom) {
    setSelectedBom(bom);
    setBomPackagingTab('ingredients');
    const [ingsRes, pkgRes] = await Promise.all([
      supabase.from('macropack_bom_ingredients').select('*, raw_materials(id, code, name)').eq('macropack_bom_id', bom.id).order('created_at'),
      supabase.from('macropack_bom_packaging').select('*').eq('bom_id', bom.id),
    ]);
    setSelectedBomIngredients(ingsRes.data || []);
    setBomPackagingRows((pkgRes.data || []).map((p: any) => ({
      item_code: p.item_code,
      description: p.description,
      unit: p.unit,
      expected_qty_per_unit: String(p.expected_qty_per_unit),
    })));
    setViewBomModalOpen(true);
  }

  function openNewBom() {
    setBomForm(emptyBomForm);
    setBomIngredients([{ raw_material_id: '', grams_per_unit: '' }]);
    setNewBomModalOpen(true);
  }

  function addBomIngredientRow() {
    setBomIngredients(prev => [...prev, { raw_material_id: '', grams_per_unit: '' }]);
  }

  function removeBomIngredientRow(idx: number) {
    setBomIngredients(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleCreateBom(e: React.FormEvent) {
    e.preventDefault();
    if (!bomForm.macropack_code || !bomForm.macropack_name) {
      toast.error('Please fill in BOM code and name.');
      return;
    }
    const validIngs = bomIngredients.filter(i => i.raw_material_id && i.grams_per_unit);
    if (validIngs.length === 0) {
      toast.error('Please add at least one ingredient.');
      return;
    }
    setSaving(true);
    try {
      const { data: bomData, error: bomError } = await supabase
        .from('macropack_boms')
        .insert({
          macropack_code: bomForm.macropack_code,
          macropack_name: bomForm.macropack_name,
          version: bomForm.version,
          effective_from: bomForm.effective_from || null,
          effective_to: bomForm.effective_to || null,
        })
        .select('id')
        .single();
      if (bomError) throw bomError;

      const ingData = validIngs.map(i => ({
        macropack_bom_id: bomData.id,
        raw_material_id: i.raw_material_id,
        grams_per_unit: parseFloat(i.grams_per_unit),
      }));
      const { error: ingError } = await supabase.from('macropack_bom_ingredients').insert(ingData);
      if (ingError) throw ingError;

      setNewBomModalOpen(false);
      fetchData();
      toast.success('Macropack BOM created successfully!');
    } catch (error: any) {
      console.error('Error creating BOM:', error);
      toast.error(`Error: ${error.message || 'Failed to create BOM'}`);
    } finally {
      setSaving(false);
    }
  }

  const labelCls = 'block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider';
  const inputCls = 'w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all bg-white shadow-sm';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-6">
      {/* Macropack workspace header */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 px-6 py-7 text-white shadow-xl sm:px-8">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(45,212,191,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,0.12)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full bg-teal-400/15 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-1 w-2/3 bg-gradient-to-r from-teal-400 via-cyan-300 to-transparent" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-2 rounded-full border border-teal-300/25 bg-teal-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-200">
                <Sparkles className="h-3.5 w-3.5" /> Production workspace
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" /> System connected</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Macropack manufacturing</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
              Manage micro-ingredient formulation, premix batching, approval controls, and stock synchronization from one production workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:block">
              <span className="block font-bold text-teal-300">{orderStats.completed} completed</span>
              <span className="text-slate-400">orders this workspace</span>
            </div>
            {activeTab === 'Manufacturing Orders' && (
              <button
                onClick={() => { setOrderForm(emptyOrderForm); setPreviewIngredients([]); setNewOrderModalOpen(true); }}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-teal-400 px-4 text-sm font-black text-slate-950 shadow-lg shadow-teal-950/30 transition hover:bg-teal-300"
              >
                <Plus className="w-4 h-4 stroke-[3]" /> + New Order
              </button>
            )}
            {activeTab === 'Macropack BOMs' && (
              <button
                onClick={openNewBom}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-teal-400 px-4 text-sm font-black text-slate-950 shadow-lg shadow-teal-950/30 transition hover:bg-teal-300"
              >
                <Plus className="w-4 h-4 stroke-[3]" /> + Add New BOM
              </button>
           )}
         </div>
        </div>
      </section>

      {/* KPI Stats Strip */}
      {activeTab === 'Manufacturing Orders' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Macropack Orders" value={orderStats.total} icon={Package} color="teal" />
          <StatCard title="Pending Approvals" value={orderStats.pendingApproval} icon={Clock} color="amber" />
          <StatCard title="Orders In Progress" value={orderStats.inProgress} icon={Factory} color="blue" />
          <StatCard title="Completed Orders" value={orderStats.completed} icon={CheckCircle} color="emerald" />
        </div>
      )}

      {/* Tabs Navigation Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSearch(''); }}
              className={`rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${
                activeTab === tab
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Search Bar (Orders & BOMs tabs) */}
        <div className="relative w-full lg:mr-1 lg:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={activeTab === 'Manufacturing Orders' ? 'Search macropack orders...' : 'Search BOM formulas...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 pl-10 text-xs font-medium outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
            />
        </div>
      </div>

      {/* ── Tab 1: Manufacturing Orders Table ── */}
      {activeTab === 'Manufacturing Orders' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Factory className="w-4 h-4 text-teal-600" /> Active Manufacturing Orders Queue ({filteredOrders.length})
            </h2>
            <span className="text-xs text-slate-500 font-medium">Real-time status updates</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-4 py-3">Macropack Product</th>
                  <th className="px-4 py-3 text-right">Planned Quantity</th>
                  <th className="px-4 py-3 text-left">Manufacture Date</th>
                  <th className="px-4 py-3 text-left">Workflow Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {filteredOrders.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No manufacturing orders found</td></tr>
                ) : filteredOrders.map(o => {
                  const style = STATUS_STYLES[o.status] || { cls: 'bg-slate-100 text-slate-700 border-slate-300', label: o.status, icon: Clock };
                  const StatusIcon = style.icon;
                  return (
                    <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900 text-sm">{o.macropack_boms?.macropack_name}</div>
                        <div className="text-xs font-mono text-teal-700">{o.macropack_boms?.macropack_code}</div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-slate-900 text-sm">
                        {o.planned_units?.toLocaleString()} <span className="text-xs font-normal text-slate-500">kg</span>
                      </td>
                      <td className="px-4 py-3.5 font-medium text-slate-600">
                        {o.manufacture_date ? format(new Date(o.manufacture_date), 'dd MMM yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${style.cls}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {style.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          onClick={() => openOrderDetail(o)}
                          className="inline-flex items-center gap-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold px-3 py-1.5 rounded-lg border border-teal-200 text-xs transition-colors shadow-sm"
                        >
                          <Eye className="w-3.5 h-3.5" /> View Details & Dispense
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 2: Macropack BOMs List ── */}
      {activeTab === 'Macropack BOMs' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Package className="w-4 h-4 text-teal-600" /> Active Macropack Formulations & BOMs ({filteredBoms.length})
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-4 py-3">BOM Code</th>
                  <th className="px-4 py-3">Macropack Name</th>
                  <th className="px-4 py-3 text-center">Version</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Ingredients</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {filteredBoms.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No macropack BOMs found</td></tr>
                ) : filteredBoms.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3.5 font-mono text-xs font-bold text-teal-800">{b.macropack_code}</td>
                    <td className="px-4 py-3.5 font-bold text-slate-900 text-sm">{b.macropack_name}</td>
                    <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-700">v{b.version}</td>
                    <td className="px-4 py-3.5 text-center">
                      {b.is_active ? (
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Active</span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-300">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800">{b.ingredientCount} ingredients</td>
                    <td className="px-4 py-3.5 text-center">
                      <button
                        onClick={() => openViewBom(b)}
                        className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-xs transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Recipe
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── New Order Modal ── */}
      <Modal open={newOrderModalOpen} onClose={() => setNewOrderModalOpen(false)} title="Create New Macropack Order">
        <form onSubmit={handleCreateOrder} className="space-y-4 p-1">
          <div>
            <label className={labelCls}>Macropack Formulation *</label>
            <select
              value={orderForm.macropack_bom_id}
              onChange={(e) => { setOrderForm({ ...orderForm, macropack_bom_id: e.target.value }); updatePreview(e.target.value, orderForm.planned_units); }}
              className={inputCls}
              required
            >
              <option value="">Select macropack formulation</option>
              {boms.filter(b => b.is_active).map(b => (
                <option key={b.id} value={b.id}>{b.macropack_code} — {b.macropack_name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Planned Batch Quantity (kg) *</label>
              <input
                type="number"
                min="1"
                value={orderForm.planned_units}
                onChange={(e) => { setOrderForm({ ...orderForm, planned_units: e.target.value }); updatePreview(orderForm.macropack_bom_id, e.target.value); }}
                className={inputCls}
                placeholder="e.g. 500"
                required
              />
            </div>
            <div>
              <label className={labelCls}>Manufacture Date *</label>
              <input
                type="date"
                value={orderForm.manufacture_date}
                onChange={(e) => setOrderForm({ ...orderForm, manufacture_date: e.target.value })}
                className={inputCls}
                required
              />
            </div>
          </div>

          {/* Ingredient Dosage Preview */}
          {previewIngredients.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
              <div className="bg-slate-100 px-3.5 py-2.5 text-xs font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 flex items-center justify-between">
                <span>Expected Micro-Ingredients</span>
                <span className="text-teal-700 font-mono">{previewIngredients.length} Items</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-3.5 py-2 text-left">Code</th>
                    <th className="px-3.5 py-2 text-left">Ingredient</th>
                    <th className="px-3.5 py-2 text-right">Dosage (kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-medium">
                  {previewIngredients.map((p, i) => (
                    <tr key={i}>
                      <td className="px-3.5 py-2 font-mono text-teal-800 font-bold">{p.code}</td>
                      <td className="px-3.5 py-2 text-slate-800">{p.name}</td>
                      <td className="px-3.5 py-2 text-right font-mono font-bold text-slate-900">
                        {(p.expected_grams / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} kg
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setNewOrderModalOpen(false)}
              className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-800 border border-slate-300 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold transition-all shadow-md disabled:opacity-50"
            >
              {saving ? 'Creating Order...' : 'Create Order'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Order Details & Dispensing Modal ── */}
      <Modal open={orderDetailModalOpen} onClose={() => setOrderDetailModalOpen(false)} title="Macropack Order Execution & Audit">
        {selectedOrder && (
          <div className="space-y-5 p-1">
            {/* Dark Top Header */}
            <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs font-bold text-teal-400 uppercase tracking-widest">Macropack Premix Order</div>
                  <h3 className="text-xl font-black text-white">{selectedOrder.macropack_boms?.macropack_name}</h3>
                  <div className="text-xs font-mono text-teal-300 mt-0.5">{selectedOrder.macropack_boms?.macropack_code}</div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold border ${STATUS_STYLES[selectedOrder.status]?.cls || ''}`}>
                  {selectedOrder.status.replace('_', ' ')}
                </span>
              </div>

              {/* Quick KPI Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800">
                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Planned Units</span>
                  <div className="font-extrabold text-white text-base font-mono mt-0.5">{selectedOrder.planned_units?.toLocaleString()} units</div>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Actual Units Output</span>
                  <div className="font-extrabold text-emerald-400 text-base font-mono mt-0.5">{(selectedOrder.actual_units || selectedOrder.planned_units || 0).toLocaleString()} units</div>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Production Yield</span>
                  <div className="font-extrabold text-teal-300 text-base font-mono mt-0.5">
                    {selectedOrder.planned_units > 0
                      ? Math.round(((selectedOrder.actual_units || selectedOrder.planned_units || 0) / selectedOrder.planned_units) * 100)
                      : 100}%
                  </div>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Manufacture Date</span>
                  <div className="font-extrabold text-white text-base mt-0.5">{selectedOrder.manufacture_date}</div>
                </div>
              </div>
            </div>

            {/* Workflow Control Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-100 rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                {selectedOrder.status === 'DRAFT' && (
                  <button
                    onClick={() => handleApprovalAction('submit')}
                    disabled={approvalSaving}
                    className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-md"
                  >
                    <Send className="w-3.5 h-3.5" /> Submit for RM Allocation
                  </button>
                )}
                {selectedOrder.status === 'PENDING_RM' && (
                  <button
                    onClick={() => handleApprovalAction('approve_rm')}
                    disabled={approvalSaving}
                    className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-md"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" /> Approve RM Allocation
                  </button>
                )}
                {selectedOrder.status === 'PENDING_SUPERVISOR' && (
                  <button
                    onClick={() => handleApprovalAction('approve_supervisor')}
                    disabled={approvalSaving}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-md"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Supervisor Sign-off
                  </button>
                )}
                {(selectedOrder.status === 'APPROVED' || selectedOrder.status === 'PLANNED') && (
                  <button
                    onClick={handleStartOrder}
                    disabled={saving}
                    className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-md"
                  >
                    <Play className="w-3.5 h-3.5" /> Start Manufacturing Run
                  </button>
                )}
                {selectedOrder.status === 'IN_PROGRESS' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSaveDispenseProgress(false)}
                      disabled={saving}
                      className="flex items-center gap-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold px-3.5 py-2 rounded-xl text-xs transition-all border border-teal-300 shadow-sm"
                    >
                      <Save className="w-3.5 h-3.5 text-teal-600" /> Save Progress
                    </button>
                    <button
                      onClick={handleCompleteOrder}
                      disabled={saving}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-md"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Declare Packaging & Complete Order
                    </button>
                  </div>
                )}
                {selectedOrder.status === 'COMPLETED' && (
                  <button
                    onClick={() => completeOrderTransaction([], '')}
                    disabled={saving}
                    className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-md"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Re-trigger Sage SSMS Integration Sync
                  </button>
                )}
                {['PENDING_RM', 'PENDING_SUPERVISOR'].includes(selectedOrder.status) && (
                  <button
                    onClick={() => handleApprovalAction('reject')}
                    disabled={approvalSaving}
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs transition-all shadow-md"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject Order
                  </button>
                )}
              </div>

              {/* Detail Navigation Tabs */}
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200">
                {(['ingredients', 'output', 'audit'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setOrderDetailTab(tab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      orderDetailTab === tab ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {tab === 'ingredients' ? 'Ingredients & Dispensing' : tab === 'output' ? 'Output & Packaging' : 'Approval Audit'}
                  </button>
                ))}
              </div>
            </div>

            {/* TAB 1: Ingredients & Dispensing Table */}
            {orderDetailTab === 'ingredients' && (
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm bg-white">
                <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                  <span className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <Package className="w-4 h-4 text-teal-600" /> Micro-Ingredient Dispensing Table
                  </span>
                  <div className="flex items-center gap-3">
                    {selectedOrder.status === 'IN_PROGRESS' && (
                      <button
                        onClick={() => handleSaveDispenseProgress(false)}
                        disabled={saving}
                        className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" /> Save Progress
                      </button>
                    )}
                    <span className="text-xs font-bold text-teal-700 font-mono">{issueRows.length} Items</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3.5 py-2.5 text-left">Code</th>
                        <th className="px-3.5 py-2.5 text-left">Ingredient</th>
                        <th className="px-3.5 py-2.5 text-right">Expected (kg)</th>
                        <th className="px-3.5 py-2.5 text-right">Actual Dispensed (kg)</th>
                        <th className="px-3.5 py-2.5 text-right">Variance %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-medium">
                      {issueRows.map((row) => (
                        <tr key={row.raw_material_id}>
                          <td className="px-3.5 py-2.5 font-mono text-teal-800 font-bold">{row.ingredient_code}</td>
                          <td className="px-3.5 py-2.5 text-slate-800 font-bold">{row.ingredient_name}</td>
                          <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-900">
                            {(row.expected_grams / 1000).toFixed(3)} kg
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            {selectedOrder.status === 'IN_PROGRESS' ? (
                              <input
                                type="number"
                                step="0.001"
                                placeholder="0.000"
                                value={row.actual_grams_dispensed}
                                onChange={(e) => handleIssueChange(row.raw_material_id, e.target.value)}
                                className={`w-28 text-right border rounded-lg px-2.5 py-1 text-xs font-mono font-bold outline-none transition-all ${
                                  row.actual_grams_dispensed === '' || row.actual_grams_dispensed === null
                                    ? 'border-amber-400 bg-amber-50/60 text-amber-900 placeholder:text-amber-400 focus:ring-2 focus:ring-amber-500 font-extrabold'
                                    : 'border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-teal-500'
                                }`}
                              />
                            ) : (
                              <span className="font-mono font-bold text-slate-900">
                                {typeof row.actual_grams_dispensed === 'number' ? row.actual_grams_dispensed.toFixed(3) : '—'} kg
                              </span>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono font-bold">
                            {row.variance_pct !== null ? (
                              <span className={Math.abs(row.variance_pct) > 2 ? 'text-red-600' : 'text-emerald-600'}>
                                {row.variance_pct.toFixed(1)}%
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 2: Output & Packaging */}
            {orderDetailTab === 'output' && (
              <div className="space-y-4">
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm bg-white p-4 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-xs text-slate-800 uppercase tracking-wider border-b pb-2">
                    <Package className="w-4 h-4 text-teal-600" />
                    Declared Packaging Consumption
                  </div>

                  {declaredPackaging.length > 0 ? (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left">Item Code</th>
                          <th className="px-3 py-2 text-left">Description</th>
                          <th className="px-3 py-2 text-right">Expected</th>
                          <th className="px-3 py-2 text-right">Actual Used</th>
                          <th className="px-3 py-2 text-right">Variance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {declaredPackaging.map((pkg, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono font-bold text-slate-800">{pkg.item_code}</td>
                            <td className="px-3 py-2 text-slate-800 font-medium">{pkg.description}</td>
                            <td className="px-3 py-2 text-right font-mono text-slate-600">{pkg.expected_qty}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{pkg.actual_qty}</td>
                            <td className="px-3 py-2 text-right font-mono text-slate-600">{pkg.variance_qty || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-xl text-xs text-slate-500 text-center">
                      No packaging declared yet for this order. When completing production, declared packaging will be recorded here.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: Approval Audit */}
            {orderDetailTab === 'audit' && (
              <div className="border border-slate-200 rounded-2xl bg-white p-5 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                  <ShieldCheck className="w-4 h-4 text-teal-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Macropack Approval & Audit Trail</h3>
                </div>
                <ApprovalHistory entityType="macropack_order" entityId={selectedOrder.id} />
              </div>
            )}

            <div className="flex justify-end pt-3">
              <button
                onClick={() => setOrderDetailModalOpen(false)}
                className="px-5 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-700"
              >
                Close Window
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── View BOM Modal ── */}
      <Modal open={viewBomModalOpen} onClose={() => setViewBomModalOpen(false)} title="Macropack BOM Recipe">
        {selectedBom && (
          <div className="space-y-4 p-1">
            <div className="bg-slate-900 text-white p-4 rounded-2xl flex justify-between items-center">
              <div>
                <h3 className="text-lg font-black">{selectedBom.macropack_name}</h3>
                <div className="text-xs font-mono text-teal-400">{selectedBom.macropack_code}</div>
              </div>
              <span className="px-3 py-1 bg-teal-500/20 text-teal-300 border border-teal-500/40 text-xs font-bold rounded-full">
                Version v{selectedBom.version}
              </span>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Code</th>
                    <th className="px-4 py-2.5 text-left">Ingredient</th>
                    <th className="px-4 py-2.5 text-right">Grams Per Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-medium">
                  {selectedBomIngredients.map(ing => (
                    <tr key={ing.id}>
                      <td className="px-4 py-2.5 font-mono font-bold text-teal-800">{ing.raw_materials?.code}</td>
                      <td className="px-4 py-2.5 font-bold text-slate-900">{ing.raw_materials?.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">{ing.grams_per_unit} g</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setViewBomModalOpen(false)} className="px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl">
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Stock Override Modal */}
      {showStockOverride && (
        <StockOverrideModal
          open={showStockOverride}
          onClose={() => { setShowStockOverride(false); setPendingCompleteCallback(null); }}
          onConfirm={async () => {
            setShowStockOverride(false);
            if (pendingCompleteCallback) await pendingCompleteCallback();
            setPendingCompleteCallback(null);
          }}
          errors={stockErrors}
          context="Macropack Order Completion"
        />
      )}

      {/* Packaging Declaration Modal */}
      {showPackagingModal && selectedOrder && (
        <PackagingDeclarationModal
          open={showPackagingModal}
          onClose={() => setShowPackagingModal(false)}
          onConfirm={handlePackagingConfirm}
          onReject={async (reason) => {
            setRejectionReason(reason);
            setShowPackagingModal(false);
            await handleApprovalAction('reject');
          }}
          bomPackagingItems={bomPackagingItems}
          items={bomPackagingItems}
          plannedQty={selectedOrder.planned_units || 0}
          rateLabel={`${selectedOrder.planned_units || 0} units`}
          title="Macropack Packaging & Final Production Approval"
          productName={selectedOrder.macropack_boms?.macropack_name}
          productCode={selectedOrder.macropack_boms?.macropack_code}
          totalIngredientKg={issueRows.reduce((sum, r) => sum + (parseFloat(String(r.actual_grams_dispensed || 0))), 0)}
        />
      )}
    </div>
  );
}
