import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Save, CheckCircle, BarChart3, Package, Factory,
  Layers, Truck, FileText, Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  ReconciliationPeriod, ReconRawMaterial, ReconProduction,
  ReconMacropack, ReconFinishedGood, ReconObservation, ReconSection,
  ReconMacropackUsage,
} from '../types/reconciliation';
import { MONTH_NAMES } from '../types/reconciliation';
import StatusBadge from '../components/ui/StatusBadge';
import StatisticsOverview from '../components/reconciliation/StatisticsOverview';
import RawMaterialsReconTable from '../components/reconciliation/RawMaterialsReconTable';
import ProductionReconTable from '../components/reconciliation/ProductionReconTable';
import MacropacksReconTable from '../components/reconciliation/MacropacksReconTable';
import MacropackUsageTable from '../components/reconciliation/MacropackUsageTable';
import FinishedGoodsReconTable from '../components/reconciliation/FinishedGoodsReconTable';
import ObservationsPanel from '../components/reconciliation/ObservationsPanel';

interface Props {
  period: ReconciliationPeriod;
  onBack: () => void;
  onUpdate: (updated: ReconciliationPeriod) => void;
}

const tabs: { key: ReconSection; label: string; icon: typeof BarChart3 }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'minivits', label: 'Minivits RM', icon: Package },
  { key: 'bulk_rm', label: 'Bulk RM', icon: Package },
  { key: 'bulk_production', label: 'Bulk Production', icon: Factory },
  { key: 'packaging', label: 'Packaging', icon: Factory },
  { key: 'macropacks', label: 'Macropacks', icon: Layers },
  { key: 'finished_goods', label: 'Finished Goods', icon: Truck },
];

export default function ReconciliationDetail({ period, onBack, onUpdate }: Props) {
  const [activeTab, setActiveTab] = useState<ReconSection>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statsForm, setStatsForm] = useState({ ...period });
  const [loggingAlert, setLoggingAlert] = useState<string | null>(null);

  const [rawMaterials, setRawMaterials] = useState<ReconRawMaterial[]>([]);
  const [productions, setProductions] = useState<ReconProduction[]>([]);
  const [macropacks, setMacropacks] = useState<ReconMacropack[]>([]);
  const [macropackUsage, setMacropackUsage] = useState<ReconMacropackUsage[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<ReconFinishedGood[]>([]);
  const [observations, setObservations] = useState<ReconObservation[]>([]);

  const readOnly = period.status === 'approved';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [rmRes, prodRes, macroRes, usageRes, fgRes, obsRes] = await Promise.all([
      supabase.from('recon_raw_materials').select('*').eq('period_id', period.id).order('material_name'),
      supabase.from('recon_production').select('*').eq('period_id', period.id).order('product_name'),
      supabase.from('recon_macropacks').select('*').eq('period_id', period.id).order('macropack_name'),
      supabase.from('recon_macropack_usage')
        .select('*, recon_macropacks!inner(period_id)')
        .eq('recon_macropacks.period_id', period.id)
        .order('created_at'),
      supabase.from('recon_finished_goods').select('*').eq('period_id', period.id).order('product_name'),
      supabase.from('recon_observations').select('*').eq('period_id', period.id).order('created_at', { ascending: false }),
    ]);
    setRawMaterials(rmRes.data || []);
    setProductions(prodRes.data || []);
    setMacropacks(macroRes.data || []);
    setMacropackUsage((usageRes.data as ReconMacropackUsage[])?.map((row) => {
      const { recon_macropacks, ...rest } = row as ReconMacropackUsage & { recon_macropacks?: { period_id: string } };
      return rest;
    }) || []);
    setFinishedGoods(fgRes.data || []);
    setObservations(obsRes.data || []);
    setLoading(false);
  }, [period.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function saveStatistics() {
    setSaving(true);
    const { data } = await supabase
      .from('reconciliation_periods')
      .update({
        received_raw_materials_t: statsForm.received_raw_materials_t,
        transferred_rm_to_prod_t: statsForm.transferred_rm_to_prod_t,
        exp_production_via_bulks_t: statsForm.exp_production_via_bulks_t,
        exp_production_via_macropacks_t: statsForm.exp_production_via_macropacks_t,
        exp_production_via_packaging_t: statsForm.exp_production_via_packaging_t,
        actual_declared_production_t: statsForm.actual_declared_production_t,
        transferred_prod_to_dispatch_t: statsForm.transferred_prod_to_dispatch_t,
        expected_dispatched_t: statsForm.expected_dispatched_t,
        actual_dispatched_t: statsForm.actual_dispatched_t,
        notes: statsForm.notes,
      })
      .eq('id', period.id)
      .select()
      .maybeSingle();
    setSaving(false);
    if (data) onUpdate(data as ReconciliationPeriod);
  }

  async function updateStatus(status: ReconciliationPeriod['status']) {
    const { data } = await supabase
      .from('reconciliation_periods')
      .update({ status })
      .eq('id', period.id)
      .select()
      .maybeSingle();
    if (data) onUpdate(data as ReconciliationPeriod);
  }

  const minivitsRM = rawMaterials.filter((r) => r.material_type === 'minivits');
  const bulkRM = rawMaterials.filter((r) => r.material_type === 'bulk');
  const bulkProduction = productions.filter((p) => p.production_type === 'bulk');
  const packagingProduction = productions.filter((p) => p.production_type === 'packaging');

  function aggregateBagVariance<T extends { system_bags?: number; physical_bags?: number }>(rows: T[]) {
    const systemBags = rows.reduce((sum, row) => sum + (row.system_bags || 0), 0);
    const physicalBags = rows.reduce((sum, row) => sum + (row.physical_bags || 0), 0);
    const expectedBags = 'expected_bags' in (rows[0] || {})
      ? rows.reduce((sum, row: any) => sum + (row.expected_bags || 0), 0)
      : rows.reduce((sum, row: any) => sum + (row.dispatched_bags || 0), 0);
    const variance = physicalBags - systemBags;
    const variancePct = systemBags ? (variance / systemBags) * 100 : 0;
    return { systemBags, physicalBags, expectedBags, variance, variancePct };
  }

  const packagingBagStats = aggregateBagVariance(packagingProduction);
  const finishedGoodsBagStats = aggregateBagVariance(finishedGoods);

  function classifySeverity(pct: number): 'info' | 'warning' | 'critical' {
    const abs = Math.abs(pct);
    if (abs >= 10) return 'critical';
    if (abs >= 5) return 'warning';
    return 'info';
  }

  const bagAlerts = [
    {
      key: 'packaging-bags',
      label: 'Packaging Bags',
      section: 'packaging' as const,
      stats: packagingBagStats,
      severity: classifySeverity(packagingBagStats.variancePct),
    },
    {
      key: 'finished-bags',
      label: 'Finished Goods Bags',
      section: 'finished_goods' as const,
      stats: finishedGoodsBagStats,
      severity: classifySeverity(finishedGoodsBagStats.variancePct),
    },
  ];

  async function logBagObservation(alertKey: string, section: ReconObservation['section'], stats: { variance: number; variancePct: number }) {
    setLoggingAlert(alertKey);
    const varianceText = `${stats.variance.toLocaleString(undefined, { maximumFractionDigits: 0 })} bags (${stats.variancePct.toFixed(1)}%)`;
    await supabase.from('recon_observations').insert({
      period_id: period.id,
      section,
      severity: Math.abs(stats.variancePct) >= 10 ? 'critical' : 'warning',
      observation: `${section === 'packaging' ? 'Packaging' : 'Finished goods'} bag variance of ${varianceText} recorded – investigate bag counts vs system data.`,
    });
    setLoggingAlert(null);
    fetchAll();
  }

  const statFields: { key: keyof ReconciliationPeriod; label: string }[] = [
    { key: 'received_raw_materials_t', label: 'Received Raw Materials (T)' },
    { key: 'transferred_rm_to_prod_t', label: 'Transferred Bulks RM to Production (T)' },
    { key: 'exp_production_via_bulks_t', label: 'Exp Production via Bulks (T)' },
    { key: 'exp_production_via_macropacks_t', label: 'Exp Production via Macropacks (T)' },
    { key: 'exp_production_via_packaging_t', label: 'Exp Production via Packaging (T)' },
    { key: 'actual_declared_production_t', label: 'Actual Declared Production (T)' },
    { key: 'transferred_prod_to_dispatch_t', label: 'Transferred Prod to Dispatch (T)' },
    { key: 'expected_dispatched_t', label: 'Expected Dispatched (T)' },
    { key: 'actual_dispatched_t', label: 'Actual Dispatched (T)' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              {MONTH_NAMES[period.month - 1]} {period.year} Reconciliation
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <StatusBadge status={period.status} />
              {period.branches?.name && (
                <span className="text-sm text-slate-500">{period.branches.name}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {period.status === 'draft' && (
            <button onClick={() => updateStatus('in_progress')} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors">
              <FileText className="w-4 h-4" /> Start Review
            </button>
          )}
          {period.status === 'in_progress' && (
            <button onClick={() => updateStatus('completed')} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors">
              <CheckCircle className="w-4 h-4" /> Mark Complete
            </button>
          )}
          {period.status === 'completed' && (
            <button onClick={() => updateStatus('approved')} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors">
              <CheckCircle className="w-4 h-4" /> Approve
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto bg-white rounded-xl border border-slate-200 p-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.key
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <StatisticsOverview period={statsForm as ReconciliationPeriod} />

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">Bag Variance Watch</h3>
              <span className="text-xs uppercase tracking-wide text-slate-400">Excel-style alerts</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {bagAlerts.map((alert) => {
                const { stats } = alert;
                const colorMap = {
                  info: 'border-slate-200',
                  warning: 'border-amber-200 bg-amber-50',
                  critical: 'border-red-200 bg-red-50',
                } as const;
                const indicator = alert.severity === 'critical' ? 'CRITICAL' : alert.severity === 'warning' ? 'ATTENTION' : 'ON TRACK';
                return (
                  <div key={alert.key} className={`rounded-xl border px-4 py-5 space-y-3 ${colorMap[alert.severity]}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">{alert.label}</p>
                        <h4 className="text-2xl font-semibold text-slate-800">{stats.variance.toLocaleString()}</h4>
                        <p className="text-sm text-slate-500">Variance ({stats.variancePct.toFixed(1)}%)</p>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white text-slate-600 border border-slate-200">{indicator}</span>
                    </div>
                    <div className="text-sm text-slate-600 flex flex-wrap gap-3">
                      <span className="font-semibold">Physical Bags: {stats.physicalBags.toLocaleString()}</span>
                      <span>System Bags: {stats.systemBags.toLocaleString()}</span>
                      <span>Expected: {stats.expectedBags.toLocaleString()}</span>
                    </div>
                    {alert.severity !== 'info' && !readOnly && (
                      <button
                        onClick={() => logBagObservation(alert.key, alert.section, stats)}
                        disabled={loggingAlert === alert.key}
                        className="text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {loggingAlert === alert.key ? 'Logging…' : `Log ${alert.label} Observation`}
                      </button>
                    )}
                    {alert.severity === 'info' && (
                      <p className="text-xs text-slate-400">Bag counts align within ±5% threshold.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Monthly Statistics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {statFields.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                  <input
                    type="number"
                    step="0.01"
                    disabled={readOnly}
                    value={(statsForm as unknown as Record<string, number>)[key] || 0}
                    onChange={(e) => setStatsForm({ ...statsForm, [key]: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
              <textarea
                rows={3}
                disabled={readOnly}
                value={statsForm.notes}
                onChange={(e) => setStatsForm({ ...statsForm, notes: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors disabled:bg-slate-50"
                placeholder="General notes about this period..."
              />
            </div>
            {!readOnly && (
              <div className="flex justify-end mt-4">
                <button
                  onClick={saveStatistics}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save Statistics'}
                </button>
              </div>
            )}
          </div>

          <ObservationsPanel
            observations={observations}
            periodId={period.id}
            section="statistics"
            onUpdate={fetchAll}
            readOnly={readOnly}
          />
        </div>
      )}

      {activeTab === 'minivits' && (
        <div className="space-y-6">
          <RawMaterialsReconTable
            items={minivitsRM}
            periodId={period.id}
            materialType="minivits"
            title="Minivits Raw Materials"
            subtitle="Opening stock, receipts, issues, and physical vs system stock reconciliation"
            onUpdate={fetchAll}
            readOnly={readOnly}
          />
          <ObservationsPanel observations={observations} periodId={period.id} section="bulks" onUpdate={fetchAll} readOnly={readOnly} />
        </div>
      )}

      {activeTab === 'bulk_rm' && (
        <div className="space-y-6">
          <RawMaterialsReconTable
            items={bulkRM}
            periodId={period.id}
            materialType="bulk"
            title="Bulk Raw Materials"
            subtitle="Bulk raw material stock reconciliation"
            onUpdate={fetchAll}
            readOnly={readOnly}
          />
          <ObservationsPanel observations={observations} periodId={period.id} section="bulks" onUpdate={fetchAll} readOnly={readOnly} />
        </div>
      )}

      {activeTab === 'bulk_production' && (
        <div className="space-y-6">
          <ProductionReconTable
            items={bulkProduction}
            periodId={period.id}
            productionType="bulk"
            title="Bulk Production"
            subtitle="Production conversion, stock, and variance tracking for bulk products"
            onUpdate={fetchAll}
            readOnly={readOnly}
          />
          <ObservationsPanel observations={observations} periodId={period.id} section="bulks" onUpdate={fetchAll} readOnly={readOnly} />
        </div>
      )}

      {activeTab === 'packaging' && (
        <div className="space-y-6">
          <ProductionReconTable
            items={packagingProduction}
            periodId={period.id}
            productionType="packaging"
            title="Packaging Production"
            subtitle="Per-product packaging production with transfer from RM and waste tracking"
            onUpdate={fetchAll}
            readOnly={readOnly}
          />
          <ObservationsPanel observations={observations} periodId={period.id} section="packaging" onUpdate={fetchAll} readOnly={readOnly} />
        </div>
      )}

      {activeTab === 'macropacks' && (
        <div className="space-y-6">
          <MacropacksReconTable
            items={macropacks}
            periodId={period.id}
            onUpdate={fetchAll}
            readOnly={readOnly}
          />
          <MacropackUsageTable
            macropacks={macropacks}
            usage={macropackUsage}
            onUpdate={fetchAll}
            readOnly={readOnly}
          />
          <ObservationsPanel observations={observations} periodId={period.id} section="macropacks" onUpdate={fetchAll} readOnly={readOnly} />
        </div>
      )}

      {activeTab === 'finished_goods' && (
        <div className="space-y-6">
          <FinishedGoodsReconTable
            items={finishedGoods}
            periodId={period.id}
            onUpdate={fetchAll}
            readOnly={readOnly}
          />
          <ObservationsPanel observations={observations} periodId={period.id} section="finished_goods" onUpdate={fetchAll} readOnly={readOnly} />
        </div>
      )}
    </div>
  );
}
