import React, { useState, useEffect } from 'react';
import { Search, RefreshCw, AlertCircle, CheckCircle, Clock, XCircle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SyncLog {
  id: string;
  event_type: string;
  reference_type: string;
  reference_id: string;
  status: 'success' | 'failed' | 'pending' | 'processing' | 'pending_finance_review' | 'retry';
  description?: string;
  message?: string;
  details?: any;
  sage_response?: any;
  error_details?: any;
  last_failed_at?: string | null;
  last_failure_message?: string | null;
  last_failure_details?: any;
  retried_at?: string | null;
  retry_requested_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

const EVENT_TYPES = [
  'grn_confirmed',
  'materials_issued',
  'production_completed',
  'dispatch_delivered',
  'material_variance_alert',
  'macropack_manufactured',
  'reconciliation_variance_approved',
  'rm_cost_updated',
  'reconciliation_completed',
  'material_transfer_to_production',
];
const STATUS_FILTERS = ['all', 'success', 'failed', 'pending', 'processing', 'pending_finance_review', 'retry'];

const statusConfig: Record<string, { color: string; icon: any; label: string }> = {
  success: { color: 'emerald', icon: CheckCircle, label: 'Success' },
  failed: { color: 'red', icon: XCircle, label: 'Failed' },
  pending: { color: 'amber', icon: Clock, label: 'Pending' },
  processing: { color: 'blue', icon: RefreshCw, label: 'Processing' },
  pending_finance_review: { color: 'purple', icon: Clock, label: 'Finance Review' },
  retry: { color: 'amber', icon: RotateCcw, label: 'Retry' }
};

function logMessage(log: SyncLog) {
  return log.message || log.description || '';
}

function formatJson(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export default function SyncLogPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState(new Date());

  async function fetchLogs() {
    setLoading(true);
    try {
      let query = supabase
        .from('sync_log')
        .select('*')
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (eventTypeFilter !== 'all') {
        query = query.eq('event_type', eventTypeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs(data || []);
    } catch (error: any) {
      console.error('Error fetching sync logs:', error);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }

  async function retrySync(logId: string) {
    setRetrying(prev => new Set(prev).add(logId));
    try {
      const { error } = await supabase.rpc('request_sync_retry', { p_log_id: logId });

      if (error) throw error;
      
      // Refresh logs
      await fetchLogs();
    } catch (error: any) {
      console.error('Error retrying sync:', error);
      alert('Failed to retry sync: ' + error.message);
    } finally {
      setRetrying(prev => {
        const newSet = new Set(prev);
        newSet.delete(logId);
        return newSet;
      });
    }
  }

  useEffect(() => {
    fetchLogs();
  }, [statusFilter, eventTypeFilter]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs();
    }, 30000); // Auto-refresh every 30 seconds

    return () => clearInterval(interval);
  }, [statusFilter, eventTypeFilter]);

  const filteredLogs = logs.filter(log => 
    log && 
    log.status && 
    (logMessage(log).toLowerCase().includes(search.toLowerCase()) ||
     log.reference_type?.toLowerCase().includes(search.toLowerCase()) ||
     log.event_type?.toLowerCase().includes(search.toLowerCase()))
  );

  const toggleErrorExpansion = (logId: string) => {
    setExpandedErrors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sync Log</h1>
          <p className="text-sm text-slate-600 mt-1">Monitor and manage data synchronization events</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <RefreshCw className="w-3 h-3" />
          Last refresh: {lastRefresh.toLocaleTimeString()}
          <span className="text-amber-600">(Auto-refresh every 30s)</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          >
            {STATUS_FILTERS.map(status => (
              <option key={status} value={status}>
                {status === 'all' ? 'All Status' : status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700">Event Type:</label>
          <select
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          >
            <option value="all">All Events</option>
            {EVENT_TYPES.map(type => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </div>

        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          />
        </div>

        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Object.entries(statusConfig).map(([statusKey, config]) => {
          const count = logs.filter(log => log.status === statusKey).length;
          const Icon = config.icon;
          return (
            <div key={statusKey} className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-${config.color}-50`}>
                  <Icon className={`w-5 h-5 text-${config.color}-600`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{count}</p>
                  <p className="text-sm text-slate-600">{config.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Event Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Created At</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-20 text-center">
                    <div className="flex items-center justify-center">
                      <RefreshCw className="w-6 h-6 animate-spin text-teal-600" />
                    </div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-20 text-center text-slate-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium">No sync logs found</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const currentStatusConfig = statusConfig[log.status] || statusConfig.pending;
                  const StatusIcon = currentStatusConfig.icon;
                  const isExpanded = expandedErrors.has(log.id);
                  const isRetrying = retrying.has(log.id);
                  const isResolvedRetry = log.status === 'success' && !!log.retried_at && !!log.resolved_at;

                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-1 rounded">
                            {log.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-slate-700">{log.reference_type}</p>
                            <p className="text-xs text-slate-500">{log.reference_id}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <StatusIcon className={`w-4 h-4 text-${currentStatusConfig.color}-600`} />
                            <span className={`text-xs font-medium text-${currentStatusConfig.color}-700`}>
                              {isResolvedRetry ? 'Retried successfully' : currentStatusConfig.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-slate-700">{logMessage(log)}</p>
                          {isResolvedRetry && (
                            <p className="mt-1 text-xs font-semibold text-emerald-700">Resolved {new Date(log.resolved_at as string).toLocaleString()} after retry</p>
                          )}
                          {log.last_failure_message && (
                            <p className="mt-1 text-xs text-slate-500">Previous failure: {log.last_failure_message}</p>
                          )}
                          {log.event_type === 'material_transfer_to_production' && log.status === 'success' && (
                            <p className="mt-1 text-xs font-semibold text-emerald-700">
                              Sage warehouse transfer confirmed
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-700">
                            {new Date(log.created_at).toLocaleString()}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {log.status === 'failed' && (
                              <button
                                onClick={() => retrySync(log.id)}
                                disabled={isRetrying}
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors disabled:opacity-50"
                              >
                                <RotateCcw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                                Retry
                              </button>
                            )}
                            {(log.error_details || log.last_failure_details || log.sage_response || log.details) && (
                              <button
                                onClick={() => toggleErrorExpansion(log.id)}
                                className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                title="View sync details"
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (log.error_details || log.last_failure_details || log.sage_response || log.details) && (
                        <tr className={log.status === 'failed' ? 'bg-red-50' : 'bg-emerald-50'}>
                          <td colSpan={6} className="px-4 py-3">
                            <div className="space-y-2">
                              {log.error_details && (
                                <>
                                  <p className="text-xs font-semibold text-red-700">Error Details:</p>
                                  <pre className="text-xs text-red-600 bg-red-100 p-2 rounded overflow-x-auto">{formatJson(log.error_details)}</pre>
                                </>
                              )}
                              {log.last_failure_details && (
                                <>
                                  <p className="text-xs font-semibold text-amber-700">Previous Failure:</p>
                                  <pre className="text-xs text-amber-700 bg-amber-100 p-2 rounded overflow-x-auto">{formatJson(log.last_failure_details)}</pre>
                                </>
                              )}
                              {log.sage_response && (
                                <>
                                  <p className="text-xs font-semibold text-emerald-700">Sage Response:</p>
                                  <pre className="text-xs text-emerald-700 bg-emerald-100 p-2 rounded overflow-x-auto">{formatJson(log.sage_response)}</pre>
                                </>
                              )}
                              {log.details && (
                                <>
                                  <p className="text-xs font-semibold text-slate-700">Sync Details:</p>
                                  <pre className="text-xs text-slate-700 bg-white p-2 rounded overflow-x-auto">{formatJson(log.details)}</pre>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
