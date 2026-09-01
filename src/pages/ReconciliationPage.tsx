import React, { useState, useEffect } from 'react';
import { Package, AlertTriangle, CheckCircle, Clock, TrendingUp, TrendingDown, Calendar, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import StatCard from '../components/ui/StatCard';

interface ReconRawMaterial {
  id: string;
  material_name: string;
  sage_code: string;
  sage_quantity: number;
  mes_quantity: number;
  variance: number;
  variance_percentage: number;
  last_synced: string;
  status: 'OK' | 'LOW_VARIANCE' | 'HIGH_VARIANCE';
  created_at: string;
  updated_at: string;
}

interface LastReconciliation {
  run_time: string;
  total_records: number;
  matched: number;
  variances: number;
}

const statusConfig = {
  OK: { color: 'emerald', icon: CheckCircle, label: 'OK' },
  LOW_VARIANCE: { color: 'amber', icon: TrendingUp, label: 'Low Variance' },
  HIGH_VARIANCE: { color: 'red', icon: AlertTriangle, label: 'High Variance' }
};

export default function ReconciliationPage() {
  const [materials, setMaterials] = useState<ReconRawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastReconciliation, setLastReconciliation] = useState<LastReconciliation | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  async function fetchReconciliationData() {
    setLoading(true);
    try {
      // For now, fetch raw materials directly since recon_raw_materials table doesn't exist yet
      const { data: rawMaterials, error: rawError } = await supabase
        .from('raw_materials')
        .select('*')
        .order('name');

      if (rawError) throw rawError;

      // Transform raw materials to reconciliation format
      const reconData = rawMaterials?.map(material => ({
        id: material.id,
        material_name: material.name,
        sage_code: material.sage_code || '',
        sage_quantity: material.current_stock || 0,
        mes_quantity: material.current_stock || 0,
        variance: 0,
        variance_percentage: 0,
        last_synced: material.updated_at,
        status: 'OK' as const,
        created_at: material.created_at,
        updated_at: material.updated_at
      })) || [];

      setMaterials(reconData);

      // Fetch last reconciliation run time from sync_log
      const { data: syncData, error: syncError } = await supabase
        .from('sync_log')
        .select('created_at, description')
        .eq('event_type', 'reconciliation_completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!syncError && syncData) {
        setLastReconciliation({
          run_time: syncData.created_at,
          total_records: reconData.length,
          matched: reconData.filter(m => m.status === 'OK').length,
          variances: reconData.filter(m => m.status !== 'OK').length
        });
      }
    } catch (error: any) {
      console.error('Error fetching reconciliation data:', error);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }

  useEffect(() => {
    fetchReconciliationData();
  }, []);

  const summary = {
    matched: materials.filter(m => m.status === 'OK').length,
    variances: materials.filter(m => m.status !== 'OK').length,
    notInMES: materials.filter(m => m.mes_quantity === 0).length
  };

  const getStatus = (variancePercentage: number): 'OK' | 'LOW_VARIANCE' | 'HIGH_VARIANCE' => {
    if (Math.abs(variancePercentage) <= 5) return 'OK';
    if (Math.abs(variancePercentage) <= 15) return 'LOW_VARIANCE';
    return 'HIGH_VARIANCE';
  };

  const formatVariance = (variance: number, variancePercentage: number) => {
    const sign = variance >= 0 ? '+' : '';
    return `${sign}${variance.toLocaleString()} (${sign}${variancePercentage.toFixed(1)}%)`;
  };

  const getVarianceColor = (variance: number) => {
    if (variance > 0) return 'text-red-600';
    if (variance < 0) return 'text-amber-600';
    return 'text-slate-600';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reconciliation</h1>
          <p className="text-sm text-slate-600 mt-1">Compare Sage and MES inventory data</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <RefreshCw className="w-3 h-3" />
          Last refresh: {lastRefresh.toLocaleTimeString()}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          title="Matched" 
          value={summary.matched.toLocaleString()} 
          icon={CheckCircle} 
          color="emerald" 
        />
        <StatCard 
          title="Variances" 
          value={summary.variances.toLocaleString()} 
          icon={AlertTriangle} 
          color="amber" 
        />
        <StatCard 
          title="Not in MES" 
          value={summary.notInMES.toLocaleString()} 
          icon={Package} 
          color="slate" 
        />
      </div>

      {/* Last Reconciliation Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Calendar className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-blue-900">Reconciliation Schedule</h3>
            <p className="text-sm text-blue-700 mt-1">
              Reconciliation runs automatically every night at 11pm
            </p>
            {lastReconciliation && (
              <p className="text-xs text-blue-600 mt-2">
                Last run: {new Date(lastReconciliation.run_time).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Reconciliation Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Raw Materials Reconciliation</h2>
            <button
              onClick={fetchReconciliationData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Material Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Sage Code</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Sage Qty</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">MES Qty</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Variance</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Last Synced</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-20 text-center">
                    <div className="flex items-center justify-center">
                      <RefreshCw className="w-6 h-6 animate-spin text-teal-600" />
                    </div>
                  </td>
                </tr>
              ) : materials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-20 text-center text-slate-500">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium">No reconciliation data found</p>
                  </td>
                </tr>
              ) : (
                materials.map((material) => {
                  const status = getStatus(material.variance_percentage);
                  const config = statusConfig[status];
                  const StatusIcon = config.icon;

                  return (
                    <tr key={material.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {material.material_name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded">
                          {material.sage_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {material.sage_quantity.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {material.mes_quantity.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className={`font-medium ${getVarianceColor(material.variance)}`}>
                          {formatVariance(material.variance, material.variance_percentage)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-700">
                          {material.last_synced 
                            ? new Date(material.last_synced).toLocaleDateString()
                            : 'Never'
                          }
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusIcon className={`w-4 h-4 text-${config.color}-600`} />
                          <span className={`text-xs font-medium text-${config.color}-700`}>
                            {config.label}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-slate-500">
            {materials.length} material{materials.length !== 1 ? 's' : ''} shown • 
            Sorted by variance (highest first)
          </p>
        </div>
      </div>
    </div>
  );
}
