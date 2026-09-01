import { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, FileText, Database } from 'lucide-react';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/ui/StatusBadge';

interface SageReconciliationItem {
  id: string;
  item_name: string;
  mes_quantity: number;
  sage_quantity: number;
  variance: number;
  variance_percentage: number;
  status: 'OK' | 'HIGH_VARIANCE' | 'MISSING_IN_SAGE' | 'MISSING_IN_MES';
  last_updated: string;
  category: 'raw_material' | 'finished_good';
}

interface SyncLog {
  id: string;
  event_type: string;
  status: 'pending' | 'success' | 'failed' | 'retry';
  message: string;
  created_at: string;
  retry_count: number;
}

export default function SageReconciliationPage() {
  const [reconciliationData, setReconciliationData] = useState<SageReconciliationItem[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'raw_material' | 'finished_good'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'OK' | 'HIGH_VARIANCE' | 'MISSING_IN_SAGE' | 'MISSING_IN_MES'>('all');

  async function fetchReconciliationData() {
    setLoading(true);
    try {
      // Fetch reconciliation data from recon_raw_materials table
      const { data: rawData, error: rawError } = await supabase
        .from('recon_raw_materials')
        .select('*')
        .order('material_variance', { ascending: false });

      if (rawError) throw rawError;

      // Transform to Sage reconciliation format
      const transformedData: SageReconciliationItem[] = (rawData || []).map(item => ({
        id: item.id,
        item_name: item.material_name,
        mes_quantity: item.system_stock,
        sage_quantity: item.physical_stock, // Assuming physical_stock represents Sage quantity
        variance: item.material_variance,
        variance_percentage: item.variance_pct,
        status: getVarianceStatus(item.variance_pct),
        last_updated: item.updated_at,
        category: 'raw_material'
      }));

      setReconciliationData(transformedData);
    } catch (error) {
      console.error('Error fetching reconciliation data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSyncLogs() {
    try {
      const { data, error } = await supabase
        .from('sync_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setSyncLogs(data || []);
    } catch (error) {
      console.error('Error fetching sync logs:', error);
    }
  }

  function getVarianceStatus(variancePct: number): SageReconciliationItem['status'] {
    if (Math.abs(variancePct) > 10) return 'HIGH_VARIANCE';
    if (Math.abs(variancePct) <= 2) return 'OK';
    return 'HIGH_VARIANCE';
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchReconciliationData(), fetchSyncLogs()]);
    setRefreshing(false);
  }

  useEffect(() => {
    fetchReconciliationData();
    fetchSyncLogs();
  }, []);

  // Filter data based on selections
  const filteredData = reconciliationData.filter(item => {
    const categoryMatch = selectedCategory === 'all' || item.category === selectedCategory;
    const statusMatch = selectedStatus === 'all' || item.status === selectedStatus;
    return categoryMatch && statusMatch;
  });

  // Calculate statistics
  const totalItems = filteredData.length;
  const okItems = filteredData.filter(item => item.status === 'OK').length;
  const highVarianceItems = filteredData.filter(item => item.status === 'HIGH_VARIANCE').length;
  const totalVariance = filteredData.reduce((sum, item) => sum + Math.abs(item.variance), 0);

  const getStatusIcon = (status: SageReconciliationItem['status']) => {
    switch (status) {
      case 'OK':
        return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'HIGH_VARIANCE':
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'MISSING_IN_SAGE':
      case 'MISSING_IN_MES':
        return <Clock className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  const getSyncStatusIcon = (status: SyncLog['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'failed':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'retry':
        return <RefreshCw className="w-4 h-4 text-amber-500" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Sage Pastel Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-1">Daily reconciliation between MES and Sage Pastel systems</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Statistics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Total Items</p>
              <p className="text-2xl font-bold text-slate-800">{totalItems}</p>
            </div>
            <Database className="w-8 h-8 text-slate-400" />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Reconciled</p>
              <p className="text-2xl font-bold text-emerald-600">{okItems}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">High Variance</p>
              <p className="text-2xl font-bold text-amber-600">{highVarianceItems}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Total Variance</p>
              <p className="text-2xl font-bold text-slate-800">{totalVariance.toFixed(1)}</p>
            </div>
            <FileText className="w-8 h-8 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as any)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            >
              <option value="all">All Categories</option>
              <option value="raw_material">Raw Materials</option>
              <option value="finished_good">Finished Goods</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            >
              <option value="all">All Statuses</option>
              <option value="OK">OK</option>
              <option value="HIGH_VARIANCE">High Variance</option>
              <option value="MISSING_IN_SAGE">Missing in Sage</option>
              <option value="MISSING_IN_MES">Missing in MES</option>
            </select>
          </div>
        </div>
      </div>

      {/* Reconciliation Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Reconciliation Results</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Item Name</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">MES Quantity</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Sage Quantity</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Variance</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Variance %</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredData.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-slate-800">{item.item_name}</div>
                      <div className="text-xs text-slate-500">{item.category.replace('_', ' ')}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className="text-sm font-medium text-slate-800">{item.mes_quantity.toLocaleString()}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className="text-sm font-medium text-slate-800">{item.sage_quantity.toLocaleString()}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className={`text-sm font-semibold ${
                        item.variance > 0 ? 'text-emerald-600' : item.variance < 0 ? 'text-red-600' : 'text-slate-600'
                      }`}>
                        {item.variance > 0 ? '+' : ''}{item.variance.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className={`text-sm font-semibold ${
                        Math.abs(item.variance_percentage) <= 2 ? 'text-emerald-600' : 
                        Math.abs(item.variance_percentage) <= 10 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {item.variance_percentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(item.status)}
                        <span className="text-sm font-medium text-slate-800">{item.status.replace('_', ' ')}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {new Date(item.last_updated).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Sync Activity */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Recent Sync Activity</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {syncLogs.map((log) => (
            <div key={log.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                {getSyncStatusIcon(log.status)}
                <div>
                  <div className="text-sm font-medium text-slate-800">{log.event_type.replace('_', ' ')}</div>
                  <div className="text-xs text-slate-500">{log.message}</div>
                </div>
              </div>
              <div className="text-right">
                <StatusBadge status={log.status} />
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(log.created_at).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
