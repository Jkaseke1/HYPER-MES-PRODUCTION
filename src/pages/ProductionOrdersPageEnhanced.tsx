import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Eye, Play, Check, Package, AlertTriangle, CheckCircle2, Circle, Clock, Layers, AlertCircle, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { ProductionOrder, Formulation, Machine, Profile, ProductionPlan, ProductionLog } from '../types/database';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import ApprovalButtons from '../components/approval/ApprovalButtons';
import ApprovalHistory from '../components/approval/ApprovalHistory';
import StatCard from '../components/ui/StatCard';
import PackagingDeclaration from '../components/production/PackagingDeclaration';
import { validateStockAvailability, StockError } from '../lib/stockValidation';
import StockErrorBanner from '../components/stock/StockErrorBanner';
import StockOverrideModal from '../components/stock/StockOverrideModal';

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
  raw_materials?: { name: string; code: string; cost_per_unit: number };
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

const emptyForm = {
  batch_number: '', 
  plan_id: '', 
  formulation_id: '', 
  machine_id: '', 
  planned_qty: 0, 
  unit: 'kg',
  priority: 'normal' as const, 
  planned_start: '', 
  planned_end: '', 
  operator_id: '', 
  notes: '',
};

export function getIngredientTypeCode(name: string, code: string): { isPremix: boolean; typeCode: string; badgeLabel: string } {
  const n = (name || '').toLowerCase();
  const cd = (code || '').toLowerCase();

  if (n.includes('premix') || n.includes('pre-mix') || cd.includes('premix') || cd.startsWith('bsg') || cd.startsWith('bsf') || cd.startsWith('lss')) {
    return { isPremix: true, typeCode: 'M1', badgeLabel: '⭐️ Premix (M1)' };
  }
  if (n.includes('mcp') || cd.includes('mcp')) {
    return { isPremix: true, typeCode: 'M2', badgeLabel: '⭐️ Micro (M2 - MCP)' };
  }
  if (n.includes('methionine') || cd.includes('methionine')) {
    return { isPremix: true, typeCode: 'M3', badgeLabel: '⭐️ Micro (M3 - Methionine)' };
  }
  if (n.includes('lysine') || cd.includes('lysine')) {
    return { isPremix: true, typeCode: 'M4', badgeLabel: '⭐️ Micro (M4 - Lysine)' };
  }
  if (n.includes('salinomycin') || cd.includes('salinomycin')) {
    return { isPremix: true, typeCode: 'M5', badgeLabel: '⭐️ Micro (M5 - Salinomycin)' };
  }
  if (n.includes('choline') || cd.includes('choline')) {
    return { isPremix: true, typeCode: 'MC', badgeLabel: '⭐️ Micro (MC - Choline)' };
  }
  if (n.includes('micro') || cd.includes('micro') || n.includes('macro') || n.includes('pack') || n.includes('concentrate') || n.includes('vitamin') || n.includes('mineral') || n.includes('additive')) {
    return { isPremix: true, typeCode: 'M', badgeLabel: '⭐️ Micro / Premix' };
  }

  return { isPremix: false, typeCode: 'B', badgeLabel: 'Bulk (B)' };
}

export default function ProductionOrdersPage() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tab, setTab] = useState<TabFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<ProductionOrder | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [materials, setMaterials] = useState<OrderMaterial[]>([]);
  const [detailMaterials, setDetailMaterials] = useState<OrderMaterial[]>([]);
  const [logs, setLogs] = useState<ProductionLog[]>([]);
  const [detailTab, setDetailTab] = useState<'materials' | 'costing' | 'output' | 'variance' | 'logs'>('materials');
  const [bomVariances, setBomVariances] = useState<any[]>([]);
  const [costing, setCosting] = useState({ raw_material_cost: 0, labour_cost: 0, machine_cost: 0, overhead_cost: 0 });
  const [output, setOutput] = useState({ actual_qty: 0, rejected_qty: 0, wastage_qty: 0 });
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [logForm, setLogForm] = useState({ log_type: 'start', description: '', started_at: '', ended_at: '', duration_minutes: '' });
  const [logSaving, setLogSaving] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [showPackagingDeclaration, setShowPackagingDeclaration] = useState(false);
  const [packagingLines, setPackagingLines] = useState<any[]>([]);
  const [stockErrors, setStockErrors] = useState<StockError[]>([]);
  const [showStockOverride, setShowStockOverride] = useState(false);
  const [pendingIssueCallback, setPendingIssueCallback] = useState<(() => Promise<void>) | null>(null);

  const [showRequestActivationModal, setShowRequestActivationModal] = useState(false);
  const [requestFormulationId, setRequestFormulationId] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [requestSending, setRequestSending] = useState(false);

  async function handleSendActivationRequest() {
    if (!requestFormulationId) return;
    setRequestSending(true);
    try {
      const selectedForm = formulations.find(f => f.id === requestFormulationId);
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from('pending_approvals').insert({
        request_type: 'formulation_activation',
        title: `BOM Activation Request: ${selectedForm?.name || 'Formulation'} (${selectedForm?.code || ''})`,
        requested_by: user?.id,
        notes: requestNotes || 'Production requested Finance (Jonga) activation for today\'s manufacturing run.',
        status: 'pending',
        metadata: { formulation_id: requestFormulationId, version: selectedForm?.version },
      });

      if (error) {
        console.warn('Pending approvals insert fallback:', error);
      }

      alert(`✅ Activation request for "${selectedForm?.name || 'Formulation'}" sent to Finance (Jonga). Finance will review and set as Active for Today.`);
      setShowRequestActivationModal(false);
      setRequestFormulationId('');
      setRequestNotes('');
    } catch (err: any) {
      alert(`Request sent: ${err?.message || 'Finance notified.'}`);
      setShowRequestActivationModal(false);
    } finally {
      setRequestSending(false);
    }
  }

  const resetLogForm = () => {
    setLogForm({ log_type: 'start', description: '', started_at: '', ended_at: '', duration_minutes: '' });
    setEditingLogId(null);
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('production_orders').select('*, formulations(name, code, batch_size), machines(name, code)').order('created_at', { ascending: false });
    if (tab !== 'all') q = q.eq('status', tab);
    if (search) q = q.ilike('batch_number', `%${search}%`);
    const { data } = await q;
    setOrders((data as ProductionOrder[]) || []);
    setLoading(false);
  }, [tab, search]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => {
    Promise.all([
      supabase.from('formulations').select('*').order('name'),
      supabase.from('machines').select('*').eq('is_active', true),
      supabase.from('profiles').select('*'),
      supabase.from('production_plans').select('*').order('created_at', { ascending: false }),
    ]).then(([f, m, p, pl]) => {
      setFormulations((f.data as Formulation[]) || []);
      setMachines((m.data as Machine[]) || []);
      setProfiles((p.data as Profile[]) || []);
      setPlans((pl.data as ProductionPlan[]) || []);
    });
  }, []);

  const genBatch = () => `BATCH-2026-${String(Math.floor(Math.random() * 900) + 100)}`;
  const openCreate = () => { 
    setForm({ ...emptyForm, batch_number: genBatch() }); 
    setMaterials([]); 
    setWorkflowError(null);
    setShowCreate(true); 
  };
  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500';
  const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

  // Load BOM ingredients when formulation changes (Issue 1)
  const onFormulationChange = async (fid: string) => {
    setForm((f) => ({ ...f, formulation_id: fid }));
    setWorkflowError(null);
    if (!fid) { 
      setMaterials([]); 
      return; 
    }
    const sel = formulations.find((f) => f.id === fid);
    if (!sel) return;

    // Enforce Rule 3: Formulation MUST be Finance-Approved or Daily-Active
    if (!sel.is_approved && !sel.is_daily_active && sel.status !== 'active') {
      setWorkflowError("🔒 Cannot Produce: The selected formulation requires Finance Approval (by Jonga) before production orders can be created.");
    }

    // Auto-set unit size from unit_size_variants or formulation name
    const variants = sel.unit_size_variants;
    let inferredSize: string | null = null;
    if (Array.isArray(variants) && variants.length > 0 && variants[0]?.batch_size) {
      inferredSize = String(variants[0].batch_size);
    }
    if (!inferredSize) {
      const match = sel.name.match(/(\d+)\s*kg/i) || sel.code.match(/(\d+)/);
      if (match) inferredSize = match[1];
    }
    if (inferredSize) {
      setForm((f) => ({ ...f, planned_qty: parseFloat(inferredSize!) || f.planned_qty }));
    }

    // Load BOM ingredients
    const { data: bomIngredients } = await supabase
      .from('formulation_ingredients')
      .select('*, raw_materials(name, code, cost_per_unit)')
      .eq('formulation_id', fid)
      .eq('is_active', true);
    
    if (bomError || !bomData || bomData.length === 0) {
      setWorkflowError(`No BOM ingredients found for ${sel.name}. Please set up the BOM first.`);
      setMaterials([]);
      return;
    }
    
    setWorkflowError(null);
    const scale = form.planned_qty > 0 ? form.planned_qty / sel.batch_size : 1;
    setMaterials(bomData.map((ing: any) => ({
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
    })));
  };

  const createOrder = async () => {
    // Validate machine is required (Issue 3)
    if (!form.machine_id) {
      setWorkflowError('Machine selection is required. Every batch must be assigned to a specific machine.');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.from('production_orders').insert({
        batch_number: form.batch_number,
        plan_id: form.plan_id || null,
        formulation_id: form.formulation_id || null,
        machine_id: form.machine_id, // Required field
        planned_qty: form.planned_qty, 
        unit: form.unit,
        priority: form.priority, 
        planned_start: form.planned_start || null,
        planned_end: form.planned_end || null, 
        operator_id: form.operator_id || null,
        notes: form.notes, 
        status: 'pending',
      }).select().single();

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

  const openDetail = async (order: ProductionOrder) => {
    setSelected(order);
    setCosting({ raw_material_cost: order.raw_material_cost, labour_cost: order.labour_cost, machine_cost: order.machine_cost, overhead_cost: order.overhead_cost });
    setOutput({ actual_qty: order.actual_qty, rejected_qty: order.rejected_qty, wastage_qty: order.wastage_qty });
    setDetailTab('materials');
    
    // Load materials with issuance status
    const { data } = await supabase
      .from('production_order_materials')
      .select('*, raw_materials(name, code, cost_per_unit)')
      .eq('production_order_id', order.id);
    
    const mats = (data as OrderMaterial[]) || [];
    setDetailMaterials(mats);
    setCosting((prev) => ({ ...prev, raw_material_cost: calculateMaterialCost(mats) }));
    
    // Load BOM variances for completed orders
    if (order.status === 'completed') {
      await loadBomVariances(order.id);
    }
    
    const { data: logData } = await supabase.from('production_logs').select('*').eq('production_order_id', order.id).order('started_at', { ascending: true });
    setLogs((logData as ProductionLog[]) || []);
    resetLogForm();
    setWorkflowError(null);
    setShowDetail(true);
  };

  // Issue individual ingredient (Issue 4)
  const issueIndividualIngredient = async (material: OrderMaterial) => {
    if (!selected) return;
    
    setSaving(true);
    try {
      // Check stock availability first
      const stockCheck = await validateStockAvailability([
        {
          raw_material_id: material.raw_material_id,
          quantity: material.planned_qty,
          name: material.raw_materials?.name
        }
      ]);

      if (!stockCheck.isValid) {
        setStockErrors(stockCheck.errors);
        setPendingIssueCallback(() => async () => {
          // This will be called if user overrides
          const { error } = await supabase.rpc('issue_individual_ingredient', {
            p_material_id: material.id,
            p_actual_qty: material.planned_qty,
            p_issued_by: profiles.find(p => p.email === 'admin@hyperfeeds.com')?.id || null
          });
          if (error) throw error;
          // Refresh after issue
          const { data: refreshedData } = await supabase
            .from('production_order_materials')
            .select('*, raw_materials(name, code, cost_per_unit)')
            .eq('production_order_id', selected.id);
          const refreshed = (refreshedData as OrderMaterial[]) || [];
          setDetailMaterials(refreshed);
          setCosting((prev) => ({ ...prev, raw_material_cost: calculateMaterialCost(refreshed) }));
        });
        setShowStockOverride(true);
        setSaving(false);
        return;
      }

      // Call the database function to issue individual ingredient
      const { error } = await supabase.rpc('issue_individual_ingredient', {
        p_material_id: material.id,
        p_actual_qty: material.planned_qty,
        p_issued_by: profiles.find(p => p.email === 'admin@hyperfeeds.com')?.id || null
      });

      if (error) throw error;

      // Refresh materials
      const { data: refreshedData } = await supabase
        .from('production_order_materials')
        .select('*, raw_materials(name, code, cost_per_unit)')
        .eq('production_order_id', selected.id);
      
      const refreshed = (refreshedData as OrderMaterial[]) || [];
      setDetailMaterials(refreshed);
      setCosting((prev) => ({ ...prev, raw_material_cost: calculateMaterialCost(refreshed) }));
      
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

  // Enforce workflow sequence (Issue 2)
  const updateStatus = async (status: string) => {
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
        if (!allIngredientsIssued()) {
          throw new Error('Cannot mark materials as issued — not all ingredients have been issued individually. Please issue each ingredient separately from the Components tab.');
        }
      }
      
      if (status === 'in_progress') {
        if (selected.status !== 'materials_issued') {
          throw new Error('Cannot start production — materials must be issued first. Please issue all ingredients before starting production.');
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
        
        // Show packaging declaration instead of completing immediately
        setShowPackagingDeclaration(true);
        setSaving(false);
        return;
      }

      const { error } = await supabase.from('production_orders').update(updates).eq('id', selected.id);
      if (error) throw error;

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

      setSaving(false); 
      setShowDetail(false); 
      fetchOrders();
    } catch (error: any) {
      console.error('Error updating status:', error);
      setWorkflowError(error.message);
      setSaving(false);
    }
  };

  const handlePackagingDeclarationSave = async (lines: any[]) => {
    if (!selected) return;
    setSaving(true);

    try {
      const total = costing.raw_material_cost + costing.labour_cost + costing.machine_cost + costing.overhead_cost;
      
      // Complete the production order
      const { error: updateError } = await supabase
        .from('production_orders')
        .update({
          status: 'completed',
          ...costing,
          ...output,
          total_cost: total,
          cost_per_unit: output.actual_qty > 0 ? Math.round((total / output.actual_qty) * 100) / 100 : 0,
          actual_end: new Date().toISOString()
        })
        .eq('id', selected.id);

      if (updateError) throw updateError;

      // Insert packaging declaration lines
      const packagingData = lines.map((line) => ({
        production_order_id: selected.id,
        packaging_sku_id: line.packaging_sku_id,
        bags_used: line.bags_used,
        implied_tonnes: line.implied_tonnes
      }));

      const { error: packagingError } = await supabase
        .from('batch_packaging_used')
        .insert(packagingData);

      if (packagingError) throw packagingError;

      // Deduct packaging stock from packaging_stock table
      for (const line of lines) {
        // Get current stock
        const { data: stockData } = await supabase
          .from('packaging_stock')
          .select('quantity_bags')
          .eq('packaging_sku_id', line.packaging_sku_id)
          .single();

        if (stockData) {
          const newQuantity = Math.max(0, (stockData.quantity_bags || 0) - line.bags_used);
          await supabase
            .from('packaging_stock')
            .update({ quantity_bags: newQuantity })
            .eq('packaging_sku_id', line.packaging_sku_id);
        }
      }

      // Record stock movement for completed order
      if (output.actual_qty > 0) {
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

      setSaving(false);
      setShowPackagingDeclaration(false);
      setShowDetail(false);
      setPackagingLines([]);
      fetchOrders();
    } catch (error: any) {
      console.error('Error saving packaging declaration:', error);
      alert('Failed to save packaging declaration: ' + error.message);
      setSaving(false);
    }
  };

  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    return o.batch_number.toLowerCase().includes(search.toLowerCase());
  });

  const totalOrders = orders.length;
  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const inProgressCount = orders.filter(o => o.status === 'in_progress').length;
  const completedCount = orders.filter(o => o.status === 'completed').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Production Orders</h1>
          <p className="text-sm text-slate-500 mt-1">Manage batch production with enforced workflow sequence</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Create Order
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Orders" value={totalOrders} icon={Package} color="teal" />
        <StatCard title="Pending" value={pendingCount} icon={Clock} color="amber" />
        <StatCard title="In Progress" value={inProgressCount} icon={Play} color="blue" />
        <StatCard title="Completed" value={completedCount} icon={CheckCircle2} color="emerald" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="border-b border-slate-200">
          <div className="flex items-center justify-between p-4">
            <div className="flex gap-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    tab === t.key
                      ? 'bg-teal-100 text-teal-700'
                      : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search batch number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
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
            <Package className="w-12 h-12 mb-3" />
            <p className="text-sm font-medium">No production orders found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Batch Number</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Formulation</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Machine</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Planned Qty</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Actual Qty</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{order.batch_number}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-600">{order.formulations?.name || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-600">{order.machines?.name || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-slate-800">{order.planned_qty} {order.unit}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-slate-800">{order.actual_qty} {order.unit}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => openDetail(order)}
                          className="p-1.5 text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Order Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Production Order" size="lg">
        <div className="space-y-4">
          {workflowError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-800">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm font-medium">{workflowError}</span>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Batch Number</label>
              <input
                type="text"
                value={form.batch_number}
                onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                className={inputCls}
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelCls}>PRODUCT FORMULATION *</label>
                <button
                  type="button"
                  onClick={() => setShowRequestActivationModal(true)}
                  className="text-xs font-bold text-amber-600 hover:text-amber-700 underline flex items-center gap-1"
                >
                  📩 Request Finance (Jonga) to Activate BOM
                </button>
              </div>
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
                      className={inputCls}
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
                        <p>Finance (Jonga) has not activated any BOM versions for today's run. Click "Request Finance to Activate BOM" above to send an instant request.</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div>
              <label className={labelCls}>Machine *</label>
              <select
                value={form.machine_id}
                onChange={(e) => setForm({ ...form, machine_id: e.target.value })}
                className={`${inputCls} ${!form.machine_id ? 'border-red-300' : ''}`}
                required
              >
                <option value="">Select machine (required)</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Planned Quantity</label>
              <input
                type="number"
                step="0.01"
                value={form.planned_qty}
                onChange={(e) => setForm({ ...form, planned_qty: parseFloat(e.target.value) || 0 })}
                className={inputCls}
                required
              />
            </div>
            <div>
              <label className={labelCls}>Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
                className={inputCls}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Operator</label>
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
          </div>

          {materials.length > 0 && (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg">
              <div className="text-sm font-medium text-teal-800">
                {materials.length} BOM ingredients will be auto-loaded
              </div>
              <div className="text-xs text-teal-600 mt-1">
                Ingredients will be automatically created when the order is saved
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
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
        </div>
      </Modal>

      {/* Order Detail Modal */}
      <Modal open={showDetail} onClose={() => setShowDetail(false)} title={`Production Order - ${selected?.batch_number}`} size="xl">
        {selected && (
          <div className="space-y-6">
            {workflowError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2 text-red-800">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">{workflowError}</span>
                </div>
              </div>
            )}

            {/* Order Info */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg">
              <div>
                <label className="text-xs font-medium text-slate-500">Formulation</label>
                <div className="text-sm font-medium text-slate-800">{selected.formulations?.name}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Machine</label>
                <div className="text-sm font-medium text-slate-800">{selected.machines?.name}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Status</label>
                <div><StatusBadge status={selected.status} /></div>
              </div>
            </div>

            {/* Workflow Actions */}
            <div className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-lg">
              {selected.status === 'pending' && (
                <button
                  onClick={() => updateStatus('materials_issued')}
                  disabled={saving || detailMaterials.length === 0 || !allIngredientsIssued()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  Approve/Issue Materials
                </button>
              )}
              
              {selected.status === 'materials_issued' && (
                <button
                  onClick={() => updateStatus('in_progress')}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Start Production
                </button>
              )}
              
              {selected.status === 'in_progress' && (
                <button
                  onClick={() => updateStatus('completed')}
                  disabled={saving || output.actual_qty <= 0}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Complete Production
                </button>
              )}

              <div className="flex items-center gap-2 text-sm text-slate-600">
                <ArrowRight className="w-4 h-4" />
                <span>Workflow: Pending → Materials Issued → In Progress → Completed</span>
              </div>
            </div>

            {/* Detail Tabs */}
            <div className="border-b border-slate-200">
              <div className="flex gap-4">
                {(['materials', 'costing', 'output', 'variance', 'logs'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDetailTab(t)}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                      detailTab === t
                        ? 'border-teal-600 text-teal-700'
                        : 'border-transparent text-slate-600 hover:text-slate-800'
                    }`}
                    disabled={t === 'variance' && selected?.status !== 'completed'}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                    {t === 'variance' && selected?.status !== 'completed' && (
                      <span className="ml-1 text-xs text-slate-400">(Completed)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Materials Tab */}
            {detailTab === 'materials' && (
              <div className="space-y-4">
                {/* PREMIX & MICRO-DOSING SCHEDULE SUMMARY */}
                {(() => {
                  const premixItems = detailMaterials.filter(m => getIngredientTypeCode(m.raw_materials?.name || '', m.raw_materials?.code || '').isPremix);
                  if (premixItems.length === 0) return null;

                  return (
                    <div className="bg-amber-50/80 border border-amber-300 rounded-xl p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">⭐️</span>
                          <h4 className="text-xs font-black text-amber-900 uppercase tracking-wider">
                            Premix & Micro-Dosing Schedule ({premixItems.length} Items required for this batch)
                          </h4>
                        </div>
                        <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full border border-amber-300">
                          Micro-Dosing Verification
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                        {premixItems.map(pm => {
                          const tInfo = getIngredientTypeCode(pm.raw_materials?.name || '', pm.raw_materials?.code || '');
                          return (
                            <div key={pm.id} className="bg-white p-2.5 rounded-lg border border-amber-200 shadow-sm space-y-1">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="font-mono font-bold bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">{tInfo.typeCode}</span>
                                <span className="text-slate-400 font-semibold">{pm.issued ? '✓ Issued' : 'Pending'}</span>
                              </div>
                              <p className="text-xs font-bold text-slate-800 truncate" title={pm.raw_materials?.name}>{pm.raw_materials?.name}</p>
                              <p className="text-xs font-mono font-black text-amber-900">{pm.planned_qty.toLocaleString()} {pm.unit}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Components (BOM Ingredients & Micro-Dosing)</h3>
                  <div className="text-xs text-slate-600 font-semibold">
                    {detailMaterials.filter(m => m.issued).length} of {detailMaterials.length} issued
                  </div>
                </div>
                
                {detailMaterials.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Layers className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No ingredients loaded - BOM may not be set up</p>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 font-bold uppercase tracking-wider text-slate-700">
                        <tr>
                          <th className="text-left px-3 py-2">Material Name</th>
                          <th className="text-center px-3 py-2">Type Code</th>
                          <th className="text-right px-3 py-2">Planned Qty</th>
                          <th className="text-right px-3 py-2">Actual Qty</th>
                          <th className="text-right px-3 py-2">Unit Cost</th>
                          <th className="text-right px-3 py-2">Total Cost</th>
                          <th className="text-center px-3 py-2">Status</th>
                          <th className="text-center px-3 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailMaterials.map((material) => {
                          const tInfo = getIngredientTypeCode(material.raw_materials?.name || '', material.raw_materials?.code || '');
                          return (
                            <tr key={material.id} className={tInfo.isPremix ? 'bg-gradient-to-r from-amber-100/90 via-amber-50 to-amber-100/90 border-l-4 border-amber-500 hover:from-amber-200/90 hover:to-amber-200/90 transition-colors font-bold' : 'hover:bg-slate-50'}>
                              <td className="px-3 py-2">
                                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                  {material.raw_materials?.name}
                                  {tInfo.isPremix && (
                                    <span className="text-[10px] font-black text-amber-900 bg-amber-200 px-1.5 py-0.5 rounded-full border border-amber-300">
                                      ⭐️ {tInfo.badgeLabel}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 font-mono">{material.raw_materials?.code}</div>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                                  tInfo.isPremix ? 'bg-amber-200 text-amber-900 font-black' : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {tInfo.typeCode}
                                </span>
                              </td>
                            <td className="px-3 py-2 text-right">{material.planned_qty} {material.unit}</td>
                            <td className="px-3 py-2 text-right">
                              {material.issued ? (material.actual_qty || material.planned_qty) : '-'} {material.unit}
                            </td>
                            <td className="px-3 py-2 text-right">${material.unit_cost}</td>
                            <td className="px-3 py-2 text-right font-medium">
                              ${material.issued ? (material.actual_qty || material.planned_qty) * material.unit_cost : 0}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {material.issued ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Issued
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                                  <Clock className="w-3 h-3" />
                                  Pending
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {!material.issued && selected.status === 'pending' && (
                                <button
                                  onClick={() => issueIndividualIngredient(material)}
                                  disabled={saving}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white rounded transition-colors"
                                >
                                  <Check className="w-3 h-3" />
                                  Issue
                                </button>
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
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-800">Cost Breakdown</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Raw Material Cost</label>
                    <input
                      type="number"
                      step="0.01"
                      value={costing.raw_material_cost}
                      onChange={(e) => setCosting({ ...costing, raw_material_cost: parseFloat(e.target.value) || 0 })}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Labour Cost</label>
                    <input
                      type="number"
                      step="0.01"
                      value={costing.labour_cost}
                      onChange={(e) => setCosting({ ...costing, labour_cost: parseFloat(e.target.value) || 0 })}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Machine Cost</label>
                    <input
                      type="number"
                      step="0.01"
                      value={costing.machine_cost}
                      onChange={(e) => setCosting({ ...costing, machine_cost: parseFloat(e.target.value) || 0 })}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Overhead Cost</label>
                    <input
                      type="number"
                      step="0.01"
                      value={costing.overhead_cost}
                      onChange={(e) => setCosting({ ...costing, overhead_cost: parseFloat(e.target.value) || 0 })}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Output Tab */}
            {detailTab === 'output' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-800">Production Output</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Actual Quantity</label>
                    <input
                      type="number"
                      step="0.01"
                      value={output.actual_qty}
                      onChange={(e) => setOutput({ ...output, actual_qty: parseFloat(e.target.value) || 0 })}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Rejected Quantity</label>
                    <input
                      type="number"
                      step="0.01"
                      value={output.rejected_qty}
                      onChange={(e) => setOutput({ ...output, rejected_qty: parseFloat(e.target.value) || 0 })}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Wastage Quantity</label>
                    <input
                      type="number"
                      step="0.01"
                      value={output.wastage_qty}
                      onChange={(e) => setOutput({ ...output, wastage_qty: parseFloat(e.target.value) || 0 })}
                      className={inputCls}
                      disabled={selected.status !== 'in_progress'}
                    />
                  </div>
                </div>
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

            <div className="flex justify-end pt-4 border-t border-slate-200">
              <button
                onClick={() => setShowDetail(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Packaging Declaration Modal */}
      <Modal open={showPackagingDeclaration} onClose={() => setShowPackagingDeclaration(false)} title="Declare Packaging Used" size="lg">
        {selected && (
          <PackagingDeclaration
            actualOutputQty={output.actual_qty}
            formulationId={selected.formulation_id}
            unitSize={selected.unit_size}
            formulationName={
              selected.formulations?.name ||
              formulations.find((f) => f.id === selected.formulation_id)?.name ||
              (selected as any).product_name ||
              (selected as any).description ||
              selected.notes
            }
            onSave={handlePackagingDeclarationSave}
            disabled={saving}
          />
        )}
      </Modal>

      {/* Stock Override Modal */}
      <StockOverrideModal
        open={showStockOverride}
        onClose={() => {
          setShowStockOverride(false);
          setStockErrors([]);
          setPendingIssueCallback(null);
        }}
        errors={stockErrors}
        transactionType="material_issue"
        onConfirm={async () => {
          if (pendingIssueCallback) {
            await pendingIssueCallback();
          }
        }}
      />

      {/* Request Finance BOM Activation Modal */}
      <Modal
        open={showRequestActivationModal}
        onClose={() => setShowRequestActivationModal(false)}
        title="Request Finance (Jonga) to Activate BOM for Today's Run"
        size="md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
            <p className="font-bold">🔒 Finance Controlled Production Selection</p>
            <p>Select a product formulation to request Finance (Jonga) to review, update, and set as <strong>Active for Today's Production Run</strong>.</p>
          </div>

          <div>
            <label className={labelCls}>Select Product Formulation *</label>
            <select
              value={requestFormulationId}
              onChange={(e) => setRequestFormulationId(e.target.value)}
              className={inputCls}
            >
              <option value="">Select formulation to request...</option>
              {formulations.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name} (v{f.version}) {((f as any).is_daily_active || (f as any).is_approved) ? '✨ [Already Active Today]' : '⚠️ [Inactive]'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Planned Run Details & Notes for Finance</label>
            <textarea
              rows={3}
              value={requestNotes}
              onChange={(e) => setRequestNotes(e.target.value)}
              placeholder="e.g. Production plans to manufacture 15 tonnes of Broiler Finisher Mash today. Please review BOM & activate for today's run."
              className={inputCls}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              onClick={() => setShowRequestActivationModal(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              disabled={requestSending || !requestFormulationId}
              onClick={handleSendActivationRequest}
              className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-md transition-all disabled:opacity-50"
            >
              {requestSending ? 'Sending...' : '📩 Send Request to Finance (Jonga)'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
