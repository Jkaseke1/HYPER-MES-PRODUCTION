import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  RefreshCw, AlertTriangle, CheckCircle, TrendingUp,
  Package, ArrowRight, DollarSign, ChevronDown, ChevronUp,
  Scale, AlertOctagon
} from 'lucide-react';

interface ReconRow {
  branch_code: string;
  po_number: string;
  dnote_number: string;
  resolved_sage_dn: string;
  delivery_type: string;
  chick_type: string;
  ordered_qty: number;
  allocated_qty: number;
  received_qty: number;
  variance: number;
  sage_grv_number: string;
  sage_dn_number: string;
  sage_grv_status: string;
  sage_grv_value_usd: number;
  variance_ordered_vs_received: number;
  status: string;
  reconciled_at: string;
}

interface UnprocessedGRV {
  delivery_note_id: string;
  branch_code: string;
  dnote_number: string;
  sage_dn_number: string;
  sage_grv_number: string;
  sage_grv_status: string;
  sage_grv_value_usd: number;
  quantity_received: number;
  declared_at: string;
  age_days: number;
  supplier: string;
  po_number: string;
}

interface UnmatchedSale {
  branch_code: string;
  invoice_date: string;
  invoice_number: string;
  item_code: string;
  chicks_sold: number;
  revenue_usd: number;
  unit_cost_usd: number;
  is_unmatched: boolean;
}

interface MarginRow {
  branch_code: string;
  item_code: string;
  total_chicks_sold: number;
  total_revenue_usd: number;
  total_cost_usd: number;
  avg_sell_price: number;
  avg_cost: number;
  profit_per_chick: number;
  margin_pct: number;
}

type TabKey = 'reconciliation' | 'unprocessed' | 'unmatched' | 'margin';

const STATUS_STYLES: Record<string, string> = {
  MATCHED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SHORT_DELIVERY: 'bg-amber-50 text-amber-700 border-amber-200',
  OVER_DELIVERY: 'bg-sky-50 text-sky-700 border-sky-200',
  GRV_MISSING: 'bg-red-50 text-red-700 border-red-200',
  GRV_UNPROCESSED: 'bg-orange-50 text-orange-700 border-orange-200',
  UNKNOWN: 'bg-slate-50 text-slate-600 border-slate-200',
};

export default function ChickReconciliationPage() {
  const { profile } = useAuth();
  const userName = profile?.full_name || 'User';
  const [activeTab, setActiveTab] = useState<TabKey>('reconciliation');
  const [reconData, setReconData] = useState<ReconRow[]>([]);
  const [unprocessedData, setUnprocessedData] = useState<UnprocessedGRV[]>([]);
  const [unmatchedData, setUnmatchedData] = useState<UnmatchedSale[]>([]);
  const [marginData, setMarginData] = useState<MarginRow[]>([]);
  const [showLayerChicks, setShowLayerChicks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());

  // Branch filtering: add 'branch_manager' role + branch_code to Profile type when ready
  const branchFilter: string | null = null;

  async function loadAll() {
    setLoading(true);
    try {
      // 1. Reconciliation
      let reconQ = supabase.from('v_chick_reconciliation').select('*');
      if (branchFilter) reconQ = reconQ.eq('branch_code', branchFilter);
      const { data: recon } = await reconQ;
      setReconData(recon || []);

      // 2. Unprocessed GRVs
      let unprocQ = supabase.from('v_chick_grv_unprocessed').select('*');
      if (branchFilter) unprocQ = unprocQ.eq('branch_code', branchFilter);
      const { data: unproc } = await unprocQ;
      setUnprocessedData(unproc || []);

      // 3. Unmatched sales
      let unmatchedQ = supabase.from('v_chick_sales_unmatched').select('*');
      if (branchFilter) unmatchedQ = unmatchedQ.eq('branch_code', branchFilter);
      const { data: unmatched } = await unmatchedQ;
      setUnmatchedData(unmatched || []);

      // 4. Margins
      let marginQ = supabase.from('v_chick_margin').select('*');
      if (!showLayerChicks) marginQ = marginQ.eq('item_code', 'DOC');
      if (branchFilter) marginQ = marginQ.eq('branch_code', branchFilter);
      const { data: margins } = await marginQ;
      setMarginData(margins || []);
    } catch (err) {
      console.error('Error loading reconciliation data:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [showLayerChicks]);

  function toggleBranch(branch: string) {
    const next = new Set(expandedBranches);
    if (next.has(branch)) next.delete(branch); else next.add(branch);
    setExpandedBranches(next);
  }

  // Group reconciliation by branch
  const groupedRecon = reconData.reduce<Record<string, ReconRow[]>>((acc, row) => {
    (acc[row.branch_code] = acc[row.branch_code] || []).push(row);
    return acc;
  }, {});

  const tabs: { key: TabKey; label: string; icon: any; count: number; color: string }[] = [
    { key: 'reconciliation', label: 'Ordered vs Received', icon: Scale, count: reconData.length, color: 'bg-blue-500' },
    { key: 'unprocessed', label: 'Unprocessed GRVs', icon: AlertTriangle, count: unprocessedData.length, color: 'bg-amber-500' },
    { key: 'unmatched', label: 'Unmatched Sales', icon: AlertOctagon, count: unmatchedData.length, color: 'bg-red-500' },
    { key: 'margin', label: 'Margins', icon: TrendingUp, count: marginData.length, color: 'bg-emerald-500' },
  ];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Chick Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-1">
            Order → Receive → Sage GRV → Sales. READ-ONLY toward Sage. Logged in as {userName}.
          </p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Tab Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative overflow-hidden rounded-xl border-2 transition-all text-left ${
                isActive
                  ? 'border-teal-500 bg-teal-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className={`absolute top-0 left-0 w-1 h-full ${tab.color}`} />
              <div className="p-4 pl-5">
                <div className="flex items-center justify-between mb-2">
                  <Icon className={`w-5 h-5 ${isActive ? 'text-teal-600' : 'text-slate-400'}`} />
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    tab.count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {tab.count}
                  </span>
                </div>
                <p className={`text-sm font-semibold ${isActive ? 'text-teal-800' : 'text-slate-700'}`}>
                  {tab.label}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── RECONCILIATION TAB ── */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-4">
          {Object.entries(groupedRecon).length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <CheckCircle className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No reconciliation data yet</p>
            </div>
          ) : (
            Object.entries(groupedRecon).map(([branch, rows]) => {
              const isOpen = expandedBranches.has(branch);
              const orderedTotal = rows.reduce((s, r) => s + (r.ordered_qty || 0), 0);
              const receivedTotal = rows.reduce((s, r) => s + (r.received_qty || 0), 0);
              const varianceTotal = receivedTotal - orderedTotal;
              const grvTotal = rows.reduce((s, r) => s + (r.sage_grv_value_usd || 0), 0);
              const hasIssues = rows.some(r => r.status !== 'MATCHED');

              return (
                <div key={branch} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  {/* Branch header */}
                  <button
                    onClick={() => toggleBranch(branch)}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${hasIssues ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">{branch}</h3>
                        <p className="text-xs text-slate-500">
                          Ordered: {orderedTotal.toLocaleString()} | Received: {receivedTotal.toLocaleString()} | GRV Value: ${grvTotal.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {varianceTotal !== 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          varianceTotal < 0 ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'
                        }`}>
                          {varianceTotal > 0 ? '+' : ''}{varianceTotal.toLocaleString()} variance
                        </span>
                      )}
                      {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>

                  {/* Detail rows */}
                  {isOpen && (
                    <div className="border-t border-slate-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-xs text-slate-500">
                            <th className="px-4 py-2 text-left font-medium">PO / DNOTE</th>
                            <th className="px-4 py-2 text-right font-medium">Ordered</th>
                            <th className="px-4 py-2 text-right font-medium">Received</th>
                            <th className="px-4 py-2 text-right font-medium">Variance</th>
                            <th className="px-4 py-2 text-left font-medium">Sage GRV</th>
                            <th className="px-4 py-2 text-right font-medium">GRV Value</th>
                            <th className="px-4 py-2 text-left font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {rows.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50/50">
                              <td className="px-4 py-2.5">
                                <div className="text-xs font-mono text-slate-600">{row.po_number}</div>
                                <div className="text-xs text-slate-400">{row.dnote_number || row.resolved_sage_dn || '—'}</div>
                                <div className="text-[10px] text-slate-300">{row.delivery_type} · {row.chick_type}</div>
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                                {row.ordered_qty?.toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                                {row.received_qty?.toLocaleString()}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-semibold ${
                                (row.variance_ordered_vs_received || 0) < 0 ? 'text-red-600' : (row.variance_ordered_vs_received || 0) > 0 ? 'text-sky-600' : 'text-slate-400'
                              }`}>
                                {(row.variance_ordered_vs_received || 0) > 0 ? '+' : ''}{row.variance_ordered_vs_received?.toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="text-xs font-mono text-slate-600">{row.sage_grv_number || '—'}</div>
                                {row.sage_dn_number && row.sage_dn_number !== row.dnote_number && (
                                  <div className="text-[10px] text-slate-400">DN: {row.sage_dn_number}</div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-600">
                                {row.sage_grv_value_usd ? `$${Number(row.sage_grv_value_usd).toLocaleString()}` : '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                  STATUS_STYLES[row.status] || STATUS_STYLES.UNKNOWN
                                }`}>
                                  {row.status?.replace(/_/g, ' ')}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── UNPROCESSED GRV TAB ── */}
      {activeTab === 'unprocessed' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Operational Nudge for Owen</p>
              <p className="text-xs text-amber-700 mt-0.5">
                These deliveries have been received in MES but the Sage GRV is still 'Unprocessed' or missing.
                This is a timing lag — not an error. Follow up with Owen if age exceeds 3 days.
              </p>
            </div>
          </div>

          {unprocessedData.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">All GRVs are processed. No timing lags.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="px-4 py-3 text-left font-medium">Branch</th>
                    <th className="px-4 py-3 text-left font-medium">DNOTE / GRV</th>
                    <th className="px-4 py-3 text-left font-medium">Supplier</th>
                    <th className="px-4 py-3 text-right font-medium">Qty Received</th>
                    <th className="px-4 py-3 text-right font-medium">GRV Value</th>
                    <th className="px-4 py-3 text-right font-medium">Age (days)</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {unprocessedData.map((row) => (
                    <tr key={row.delivery_note_id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-700">{row.branch_code}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-mono text-slate-600">{row.dnote_number}</div>
                        <div className="text-[10px] text-slate-400">GRV: {row.sage_grv_number || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{row.supplier}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {row.quantity_received?.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-mono text-slate-600">
                        {row.sage_grv_value_usd ? `$${Number(row.sage_grv_value_usd).toLocaleString()}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-bold ${
                          (row.age_days || 0) > 3 ? 'text-red-600' : 'text-amber-600'
                        }`}>
                          {Math.round(row.age_days || 0)}d
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          row.sage_grv_status === 'Unprocessed'
                            ? 'bg-orange-50 text-orange-700 border-orange-200'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}>
                          {row.sage_grv_status || 'GRV MISSING'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── UNMATCHED SALES TAB ── */}
      {activeTab === 'unmatched' && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3">
            <AlertOctagon className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Leakage Control</p>
              <p className="text-xs text-red-700 mt-0.5">
                Chick sales from Sage that cannot be tied to a received delivery note / PO.
                This is the chick twin of the unmatched-Sales-Orders report.
              </p>
            </div>
          </div>

          {unmatchedData.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">All chick sales match an inbound delivery. No leakage.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="px-4 py-3 text-left font-medium">Branch</th>
                    <th className="px-4 py-3 text-left font-medium">Invoice</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Item</th>
                    <th className="px-4 py-3 text-right font-medium">Chicks Sold</th>
                    <th className="px-4 py-3 text-right font-medium">Revenue</th>
                    <th className="px-4 py-3 text-right font-medium">Unit Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {unmatchedData.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-700">{row.branch_code}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">{row.invoice_number || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {row.invoice_date ? new Date(row.invoice_date).toLocaleDateString('en-GB') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          row.item_code === 'DOC'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-purple-50 text-purple-700 border-purple-200'
                        }`}>
                          {row.item_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-red-700">
                        {row.chicks_sold?.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-mono text-slate-600">
                        ${Number(row.revenue_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-mono text-slate-500">
                        ${Number(row.unit_cost_usd || 0).toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MARGIN TAB ── */}
      {activeTab === 'margin' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-3 flex-1 mr-4">
              <TrendingUp className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Per-Branch Margin</p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  {showLayerChicks ? 'Showing DOC (broiler) + LDOC001 (layer) separately' : 'Showing DOC (broiler) only. Layer chicks are hidden to avoid contaminating the broiler margin.'}
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors shrink-0">
              <input
                type="checkbox"
                checked={showLayerChicks}
                onChange={(e) => setShowLayerChicks(e.target.checked)}
                className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
              />
              <span className="text-sm text-slate-700">Show Layer Chicks</span>
            </label>
          </div>

          {marginData.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <DollarSign className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No margin data yet. Import Sage sales feed first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {marginData.map((row) => (
                <div key={`${row.branch_code}-${row.item_code}`} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        row.item_code === 'DOC' ? 'bg-emerald-100' : 'bg-purple-100'
                      }`}>
                        <Package className={`w-4 h-4 ${row.item_code === 'DOC' ? 'text-emerald-600' : 'text-purple-600'}`} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">{row.branch_code}</h3>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                          row.item_code === 'DOC'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-purple-50 text-purple-700 border-purple-200'
                        }`}>
                          {row.item_code}
                        </span>
                      </div>
                    </div>
                    <span className={`text-lg font-bold ${
                      (row.margin_pct || 0) >= 5 ? 'text-emerald-600' : (row.margin_pct || 0) > 0 ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {row.margin_pct?.toFixed(1)}%
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-400">Chicks Sold</p>
                      <p className="font-semibold text-slate-700">{row.total_chicks_sold?.toLocaleString()}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-400">Revenue</p>
                      <p className="font-semibold text-slate-700">${Number(row.total_revenue_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-400">Avg Sell Price</p>
                      <p className="font-semibold text-slate-700">${Number(row.avg_sell_price).toFixed(4)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-400">Avg Cost</p>
                      <p className="font-semibold text-slate-700">${Number(row.avg_cost).toFixed(4)}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                    <div>
                      <p className="text-xs text-emerald-600">Profit / Chick</p>
                      <p className="text-lg font-bold text-emerald-700">${Number(row.profit_per_chick).toFixed(4)}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-emerald-400" />
                    <div className="text-right">
                      <p className="text-xs text-emerald-600">Total Cost</p>
                      <p className="text-sm font-semibold text-emerald-700">${Number(row.total_cost_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
