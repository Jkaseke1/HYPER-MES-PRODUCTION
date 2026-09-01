import { useState, useEffect, useMemo, useCallback } from 'react';
import { Download, Send, CheckCircle, RefreshCw, Package, AlertTriangle, Clock } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/ui/StatCard';

interface ReconRow {
  id?: string;
  period_start: string;
  period_end: string;
  warehouse: string;
  material_type: string;
  material_id: string | null;
  material_name: string;
  opening_stock_kg: number;
  receipts_kg: number;
  issues_kg: number;
  expected_closing_kg: number;
  physical_count_kg: number | null;
  system_stock_kg: number;
  variance_kg: number | null;
  variance_pct: number | null;
  variance_reason_code: string;
  variance_comment: string;
  reconciliation_status: string;
  submitted_by?: string | null;
  submitted_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
}

interface VarianceCode {
  code: string;
  description: string;
  category: string | null;
}

interface RawMaterial {
  id: string;
  code: string;
  name: string;
  category: string;
  current_stock: number;
}

const TABS = ['Bulk RM', 'Minivits', 'Packaging', 'Finished Goods'] as const;
type TabType = typeof TABS[number];

const TAB_MATERIAL_TYPES: Record<TabType, string> = {
  'Bulk RM': 'bulk_rm',
  'Minivits': 'minivits',
  'Packaging': 'packaging',
  'Finished Goods': 'finished_goods',
};

const CATEGORY_TO_TAB: Record<string, string> = {
  grain: 'bulk_rm',
  protein: 'bulk_rm',
  mineral: 'minivits',
  vitamin: 'minivits',
  additive: 'minivits',
  other: 'bulk_rm',
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  OPEN: { color: 'amber', label: 'Open' },
  REVIEWED: { color: 'blue', label: 'Under Review' },
  APPROVED: { color: 'emerald', label: 'Approved' },
};

function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = subMonths(now, i);
    options.push({
      label: format(d, 'MMMM yyyy'),
      start: format(startOfMonth(d), 'yyyy-MM-dd'),
      end: format(endOfMonth(d), 'yyyy-MM-dd'),
    });
  }
  return options;
}

export default function MonthlyRMReconciliationPage() {
  const { profile } = useAuth();
  const monthOptions = useMemo(() => getMonthOptions(), []);

  const [selectedMonth, setSelectedMonth] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>('Bulk RM');
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [varianceCodes, setVarianceCodes] = useState<VarianceCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const period = monthOptions[selectedMonth];
  const isWarehouseManager = profile?.role === 'warehouse_manager' || profile?.role === 'admin';
  const isFinance = profile?.role === 'finance' || profile?.role === 'accountant' || profile?.role === 'admin';

  const currentTabType = TAB_MATERIAL_TYPES[activeTab];
  const tabRows = useMemo(() => rows.filter(r => r.material_type === currentTabType), [rows, currentTabType]);

  const tabStatus = useMemo(() => {
    if (tabRows.length === 0) return 'OPEN';
    const statuses = tabRows.map(r => r.reconciliation_status);
    if (statuses.every(s => s === 'APPROVED')) return 'APPROVED';
    if (statuses.every(s => s === 'REVIEWED' || s === 'APPROVED')) return 'REVIEWED';
    return 'OPEN';
  }, [tabRows]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [reconRes, codesRes] = await Promise.all([
      supabase
        .from('monthly_rm_reconciliation')
        .select('*')
        .eq('period_start', period.start)
        .eq('period_end', period.end)
        .order('material_name'),
      supabase.from('variance_reason_codes').select('*').order('code'),
    ]);
    setRows(reconRes.data || []);
    setVarianceCodes(codesRes.data || []);
    setLoading(false);
  }, [period.start, period.end]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Generate reconciliation data from MES for the selected period
  async function handleGenerate() {
    if (rows.length > 0) {
      if (!confirm('Reconciliation data already exists for this period. Re-generating will overwrite unsaved changes. Continue?')) return;
    }
    setGenerating(true);
    try {
      // Delete existing rows for this period
      if (rows.length > 0) {
        await supabase
          .from('monthly_rm_reconciliation')
          .delete()
          .eq('period_start', period.start)
          .eq('period_end', period.end)
          .eq('reconciliation_status', 'OPEN');
      }

      // Fetch raw materials
      const { data: materials } = await supabase
        .from('raw_materials')
        .select('id, code, name, category, current_stock')
        .eq('is_active', true)
        .order('name');

      if (!materials || materials.length === 0) {
        alert('No active raw materials found.');
        setGenerating(false);
        return;
      }

      // Fetch stock movements for the period
      const { data: movements } = await supabase
        .from('stock_movements')
        .select('raw_material_id, movement_type, quantity')
        .gte('created_at', period.start)
        .lte('created_at', period.end + 'T23:59:59');

      const movementMap: Record<string, { receipts: number; issues: number }> = {};
      (movements || []).forEach((m: any) => {
        if (!movementMap[m.raw_material_id]) {
          movementMap[m.raw_material_id] = { receipts: 0, issues: 0 };
        }
        if (m.movement_type === 'receipt' || m.movement_type === 'grn_receipt') {
          movementMap[m.raw_material_id].receipts += Number(m.quantity) || 0;
        } else if (m.movement_type === 'issue' || m.movement_type === 'production_issue') {
          movementMap[m.raw_material_id].issues += Math.abs(Number(m.quantity) || 0);
        }
      });

      // Build reconciliation rows
      const newRows = materials.map((mat: RawMaterial) => {
        const mv = movementMap[mat.id] || { receipts: 0, issues: 0 };
        const materialType = CATEGORY_TO_TAB[mat.category] || 'bulk_rm';
        const systemStock = mat.current_stock || 0;
        // Opening = system stock - receipts + issues (reverse calculation)
        const opening = systemStock - mv.receipts + mv.issues;
        const expectedClosing = opening + mv.receipts - mv.issues;

        return {
          period_start: period.start,
          period_end: period.end,
          warehouse: 'Raw Materials Warehouse',
          material_type: materialType,
          material_id: mat.id,
          material_name: `${mat.code} — ${mat.name}`,
          opening_stock_kg: Math.max(0, parseFloat(opening.toFixed(4))),
          receipts_kg: parseFloat(mv.receipts.toFixed(4)),
          issues_kg: parseFloat(mv.issues.toFixed(4)),
          expected_closing_kg: parseFloat(expectedClosing.toFixed(4)),
          physical_count_kg: null,
          system_stock_kg: parseFloat(systemStock.toFixed(4)),
          variance_pct: null,
          variance_reason_code: '',
          variance_comment: '',
          reconciliation_status: 'OPEN',
        };
      });

      if (newRows.length > 0) {
        const { error } = await supabase.from('monthly_rm_reconciliation').insert(newRows);
        if (error) throw error;
      }

      await fetchData();
    } catch (error: any) {
      console.error('Error generating reconciliation:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  }

  // Update a single row field
  async function handleRowUpdate(rowId: string, field: string, value: any) {
    const row = rows.find(r => r.id === rowId);
    if (!row || row.reconciliation_status === 'APPROVED') return;

    const updates: any = { [field]: value };

    // Auto-calculate variance_pct when physical_count changes
    if (field === 'physical_count_kg' && value !== null && value !== '') {
      const physicalCount = parseFloat(value);
      const systemStock = row.system_stock_kg || 0;
      if (systemStock !== 0) {
        updates.variance_pct = parseFloat((((physicalCount - systemStock) / systemStock) * 100).toFixed(4));
      }
    }

    const { error } = await supabase
      .from('monthly_rm_reconciliation')
      .update(updates)
      .eq('id', rowId);

    if (error) {
      console.error('Error updating row:', error);
      return;
    }

    // Update local state
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const updated = { ...r, ...updates };
      if (field === 'physical_count_kg' && value !== null && value !== '') {
        updated.variance_kg = parseFloat(value) - r.system_stock_kg;
      }
      return updated;
    }));
  }

  // Submit for Review (Step 1 — Warehouse Manager)
  async function handleSubmitForReview() {
    if (!confirm('Submit this tab for finance review? Data will be locked for editing.')) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ids = tabRows.map(r => r.id).filter(Boolean);
      const { error } = await supabase
        .from('monthly_rm_reconciliation')
        .update({
          reconciliation_status: 'REVIEWED',
          submitted_by: user?.id,
          submitted_at: new Date().toISOString(),
        })
        .in('id', ids);
      if (error) throw error;
      await fetchData();
    } catch (error: any) {
      console.error('Error submitting:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Approve (Step 2 — Finance/Accountant)
  async function handleApprove() {
    if (!confirm('Approve this reconciliation? This action is final.')) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ids = tabRows.map(r => r.id).filter(Boolean);
      const { error } = await supabase
        .from('monthly_rm_reconciliation')
        .update({
          reconciliation_status: 'APPROVED',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .in('id', ids);
      if (error) throw error;
      await fetchData();
    } catch (error: any) {
      console.error('Error approving:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Export to Excel (CSV)
  function handleExport() {
    const exportRows = tabRows.length > 0 ? tabRows : rows;
    if (exportRows.length === 0) {
      alert('No data to export.');
      return;
    }

    const headers = [
      'Material', 'Opening Stock (kg)', 'Receipts (kg)', 'Total (kg)',
      'Issues (kg)', 'Expected Closing (kg)', 'Physical Count (kg)',
      'System Stock (kg)', 'Variance (kg)', 'Variance %', 'Reason Code', 'Comment', 'Status',
    ];
    const csvRows = exportRows.map(r => [
      r.material_name,
      r.opening_stock_kg?.toFixed(2) || '0',
      r.receipts_kg?.toFixed(2) || '0',
      ((r.opening_stock_kg || 0) + (r.receipts_kg || 0)).toFixed(2),
      r.issues_kg?.toFixed(2) || '0',
      r.expected_closing_kg?.toFixed(2) || '0',
      r.physical_count_kg?.toFixed(2) || '',
      r.system_stock_kg?.toFixed(2) || '0',
      r.variance_kg?.toFixed(2) || '',
      r.variance_pct?.toFixed(2) || '',
      r.variance_reason_code || '',
      r.variance_comment || '',
      r.reconciliation_status,
    ]);

    const csv = [headers, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RM_Reconciliation_${activeTab.replace(/\s+/g, '_')}_${period.start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Stats
  const totalItems = tabRows.length;
  const itemsWithVariance = tabRows.filter(r => r.variance_kg !== null && Math.abs(r.variance_kg) > 0.01).length;
  const totalVarianceKg = tabRows.reduce((sum, r) => sum + Math.abs(r.variance_kg || 0), 0);
  const itemsCounted = tabRows.filter(r => r.physical_count_kg !== null).length;

  const isEditable = tabStatus === 'OPEN';
  const canSubmit = isWarehouseManager && tabStatus === 'OPEN' && tabRows.length > 0;
  const canApprove = isFinance && tabStatus === 'REVIEWED';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Monthly RM Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-1">Physical stock count vs MES system stock</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating...' : 'Generate from MES'}
          </button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-slate-600">Period:</label>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
        >
          {monthOptions.map((opt, i) => (
            <option key={i} value={i}>{opt.label}</option>
          ))}
        </select>
        <span className="text-xs text-slate-400">
          {period.start} — {period.end}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Materials" value={totalItems} icon={Package} />
        <StatCard title="Counted" value={`${itemsCounted}/${totalItems}`} icon={CheckCircle} color="emerald" />
        <StatCard title="With Variance" value={itemsWithVariance} icon={AlertTriangle} color="amber" />
        <StatCard title="Total Variance" value={`${totalVarianceKg.toFixed(0)} kg`} icon={Clock} color="red" />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
            <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
              {rows.filter(r => r.material_type === TAB_MATERIAL_TYPES[tab]).length}
            </span>
          </button>
        ))}
      </div>

      {/* Status & Actions Bar */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Status:</span>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${
            tabStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            tabStatus === 'REVIEWED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
            'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            {STATUS_CONFIG[tabStatus]?.label || tabStatus}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {canSubmit && (
            <button
              onClick={handleSubmitForReview}
              disabled={saving}
              className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors shadow-md"
            >
              <Send className="w-4 h-4" />
              {saving ? 'Submitting...' : 'Submit for Review'}
            </button>
          )}
          {canApprove && (
            <button
              onClick={handleApprove}
              disabled={saving}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              {saving ? 'Approving...' : 'Approve'}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
        </div>
      ) : tabRows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No reconciliation data for this period and tab.</p>
          <p className="text-slate-400 text-xs mt-1">Click "Generate from MES" to create reconciliation rows.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600 sticky left-0 bg-slate-50 min-w-[200px]">Material</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600 min-w-[90px]">Opening (kg)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600 min-w-[90px]">Receipts (kg)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600 min-w-[90px]">Total (kg)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600 min-w-[90px]">Issues (kg)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600 min-w-[100px]">Exp. Closing (kg)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-teal-700 min-w-[110px]">Physical Count (kg)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600 min-w-[100px]">System Stock (kg)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600 min-w-[90px]">Variance (kg)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600 min-w-[70px]">Var %</th>
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600 min-w-[180px]">Reason Code</th>
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600 min-w-[150px]">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tabRows.map(row => {
                  const total = (row.opening_stock_kg || 0) + (row.receipts_kg || 0);
                  const varianceKg = row.variance_kg;
                  const hasVariance = varianceKg !== null && Math.abs(varianceKg) > 0.01;
                  const varianceColor = hasVariance
                    ? (varianceKg! < 0 ? 'text-red-600' : 'text-amber-600')
                    : 'text-slate-400';

                  return (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 font-medium text-slate-800 sticky left-0 bg-white">
                        {row.material_name}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                        {(row.opening_stock_kg || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                        {(row.receipts_kg || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700 tabular-nums">
                        {total.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                        {(row.issues_kg || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                        {(row.expected_closing_kg || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isEditable ? (
                          <input
                            type="number"
                            step="0.01"
                            value={row.physical_count_kg ?? ''}
                            onChange={(e) => handleRowUpdate(row.id!, 'physical_count_kg', e.target.value === '' ? null : e.target.value)}
                            className="w-full text-right border border-teal-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-teal-500 outline-none bg-teal-50"
                            placeholder="Enter count"
                          />
                        ) : (
                          <span className="tabular-nums">
                            {row.physical_count_kg !== null ? row.physical_count_kg.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                        {(row.system_stock_kg || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${varianceColor}`}>
                        {varianceKg !== null ? varianceKg.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${varianceColor}`}>
                        {row.variance_pct !== null ? `${row.variance_pct.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {isEditable ? (
                          <select
                            value={row.variance_reason_code || ''}
                            onChange={(e) => handleRowUpdate(row.id!, 'variance_reason_code', e.target.value)}
                            className="w-full border border-slate-300 rounded px-1 py-1 text-xs focus:ring-1 focus:ring-teal-500 outline-none"
                          >
                            <option value="">—</option>
                            {varianceCodes.map(vc => (
                              <option key={vc.code} value={vc.code}>{vc.code.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-600">{row.variance_reason_code?.replace(/_/g, ' ') || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditable ? (
                          <input
                            type="text"
                            value={row.variance_comment || ''}
                            onChange={(e) => handleRowUpdate(row.id!, 'variance_comment', e.target.value)}
                            className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-teal-500 outline-none"
                            placeholder="Comment"
                          />
                        ) : (
                          <span className="text-xs text-slate-600">{row.variance_comment || '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* Summary Row */}
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-300">
                  <td className="px-3 py-2.5 text-slate-700 sticky left-0 bg-slate-50">Totals</td>
                  <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                    {tabRows.reduce((s, r) => s + (r.opening_stock_kg || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                    {tabRows.reduce((s, r) => s + (r.receipts_kg || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                    {tabRows.reduce((s, r) => s + (r.opening_stock_kg || 0) + (r.receipts_kg || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                    {tabRows.reduce((s, r) => s + (r.issues_kg || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                    {tabRows.reduce((s, r) => s + (r.expected_closing_kg || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                    {tabRows.reduce((s, r) => s + (r.physical_count_kg || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                    {tabRows.reduce((s, r) => s + (r.system_stock_kg || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-red-600 tabular-nums">
                    {tabRows.reduce((s, r) => s + (r.variance_kg || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td colSpan={3} className="px-3 py-2.5"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
