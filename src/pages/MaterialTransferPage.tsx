import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Factory, Calendar, Eye, CheckCircle, CheckCircle2, ArrowRight, Package, Truck, Trash2, X, Loader2, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { Dialog, DialogContent } from '../components/ui/dialog';
import StatusBadge from '../components/ui/StatusBadge';
import ApprovalHistory from '../components/approval/ApprovalHistory';
import StockTakeFrozenBanner from '../components/stock/StockTakeFrozenBanner';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

interface MaterialTransfer {
  id: string;
  transfer_number: string;
  raw_material_id: string;
  from_warehouse_id: string;
  to_location: string;
  quantity: number;
  unit: string;
  transfer_date: string;
  requested_by: string;
  approved_by?: string;
  buffer_approved_by?: string;
  buffer_approved_at?: string;
  production_approved_by?: string;
  production_approved_at?: string;
  status: 'pending' | 'in_buffer' | 'approved' | 'in_transit' | 'received' | 'rejected';
  purpose: string;
  production_order_id?: string;
  notes: string;
  rejection_reason?: string;
  created_at: string;
  raw_materials?: { name: string; code: string; unit: string };
  warehouses?: { name: string };
}

interface SageTransferSyncLog {
  id: string;
  reference_id: string;
  status: 'success' | 'failed' | 'pending' | 'processing' | 'pending_finance_review' | 'retry';
  message?: string | null;
  error_details?: any;
  sage_response?: any;
  updated_at: string;
  created_at: string;
}

function getSageSyncText(log?: SageTransferSyncLog) {
  if (!log) return 'Not queued';
  if (log.status === 'success') return 'Posted to Sage';
  if (log.status === 'failed') return 'Sage failed';
  if (log.status === 'processing') return 'Posting to Sage';
  if (log.status === 'pending') return 'Sage pending';
  return log.status.replace(/_/g, ' ');
}

function SageSyncBadge({ log }: { log?: SageTransferSyncLog }) {
  const base = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold whitespace-nowrap';

  if (!log) {
    return (
      <span className={`${base} bg-slate-50 text-slate-500 border-slate-200`}>
        <Clock className="w-3 h-3" /> Not queued
      </span>
    );
  }

  if (log.status === 'success') {
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>
        <CheckCircle2 className="w-3 h-3" /> Posted to Sage
      </span>
    );
  }

  if (log.status === 'failed') {
    return (
      <span className={`${base} bg-red-50 text-red-700 border-red-200`}>
        <AlertTriangle className="w-3 h-3" /> Sage failed
      </span>
    );
  }

  if (log.status === 'processing') {
    return (
      <span className={`${base} bg-blue-50 text-blue-700 border-blue-200`}>
        <Loader2 className="w-3 h-3 animate-spin" /> Posting
      </span>
    );
  }

  return (
    <span className={`${base} bg-amber-50 text-amber-700 border-amber-200`}>
      <Clock className="w-3 h-3" /> Pending Sage
    </span>
  );
}

export default function MaterialTransferPage() {
  const { profile } = useAuth();
  const [transfers, setTransfers] = useState<MaterialTransfer[]>([]);
  const [sageSyncLogs, setSageSyncLogs] = useState<Record<string, SageTransferSyncLog>>({});
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [rmWarehouseBalances, setRmWarehouseBalances] = useState<Record<string, number>>({});
  const [bufferWarehouseBalances, setBufferWarehouseBalances] = useState<Record<string, number>>({});
  const [productionOrders, setProductionOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [viewTransfer, setViewTransfer] = useState<MaterialTransfer | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const fetchInProgress = useRef(false);

  // Multi-line transfer state
  const [transferLines, setTransferLines] = useState<Array<{
    id: string;
    raw_material_id: string;
    quantity: number;
    source_lot_id: string;
  }>>([{ id: crypto.randomUUID(), raw_material_id: '', quantity: 0, source_lot_id: '' }]);

  const [sharedForm, setSharedForm] = useState({
    transfer_date: format(new Date(), 'yyyy-MM-dd'),
    purpose: '',
    production_order_id: '',
    notes: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('material-transfer-live-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_transfers' }, () => {
        fetchData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_stock_balances' }, () => {
        fetchData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sage_stock_balances' }, () => {
        fetchData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, () => {
        fetchData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_log' }, () => {
        fetchData(true);
      })
      .subscribe();

    const intervalId = window.setInterval(() => {
      fetchData(true);
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, []);

  const addTransferLine = () => {
    setTransferLines([...transferLines, { id: crypto.randomUUID(), raw_material_id: '', quantity: 0, source_lot_id: '' }]);
  };

  const removeTransferLine = (id: string) => {
    if (transferLines.length === 1) return;
    setTransferLines(transferLines.filter(line => line.id !== id));
  };

  const updateTransferLine = (id: string, field: string, value: any) => {
    setTransferLines(transferLines.map(line =>
      line.id === id ? { ...line, [field]: value } : line
    ));
  };

  async function fetchData(silent = false) {
    if (fetchInProgress.current) return;
    fetchInProgress.current = true;
    if (!silent) setLoading(true);
    try {
    const [transfersRes, materialsRes, warehousesRes, ordersRes, rmBalancesRes, bufferBalancesRes] = await Promise.all([
      supabase
        .from('material_transfers')
        .select('*, requester:profiles!requested_by(full_name, email), raw_materials(name, code, unit), warehouses:from_warehouse_id(name)')
        .order('created_at', { ascending: false }),
      supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
      supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
      supabase
        .from('production_orders')
        .select('id, batch_number, status')
        .in('status', ['pending', 'materials_issued', 'in_progress'])
        .order('created_at', { ascending: false }),
      supabase
        .from('sage_stock_balances')
        .select('raw_material_id, quantity, last_synced_at')
        .eq('warehouse_id', 18),
      supabase
        .from('warehouse_stock_balances')
        .select('raw_material_id, quantity, warehouses!inner(code)')
        .eq('warehouses.code', 'BUFFER'),
    ]);

    if (transfersRes.data) {
      const nextTransfers = transfersRes.data as any;
      const transferIds = nextTransfers.map((transfer: MaterialTransfer) => transfer.id);
      if (transferIds.length > 0) {
        const { data: syncRows, error: syncError } = await supabase
          .from('sync_log')
          .select('id, reference_id, status, message, error_details, sage_response, created_at, updated_at')
          .eq('event_type', 'material_transfer_to_production')
          .in('reference_id', transferIds)
          .order('created_at', { ascending: false });

        if (syncError) {
          console.warn('Failed to load material transfer Sage sync logs:', syncError);
        } else {
          const nextLogs: Record<string, SageTransferSyncLog> = {};
          (syncRows || []).forEach((row: SageTransferSyncLog) => {
            if (!nextLogs[row.reference_id]) nextLogs[row.reference_id] = row;
          });
          setSageSyncLogs(nextLogs);
        }
      } else {
        setSageSyncLogs({});
      }
      setTransfers(nextTransfers);
    }
    if (materialsRes.data) setRawMaterials(materialsRes.data);
    if (warehousesRes.data) setWarehouses(warehousesRes.data);
    if (ordersRes.data) setProductionOrders(ordersRes.data);
    if (rmBalancesRes.data) {
      const balances: Record<string, number> = {};
      rmBalancesRes.data.forEach((b: any) => {
        balances[b.raw_material_id] = Number(b.quantity || 0);
      });
      setRmWarehouseBalances(balances);
    }
    if (bufferBalancesRes.data) {
      const balances: Record<string, number> = {};
      bufferBalancesRes.data.forEach((b: any) => {
        balances[b.raw_material_id] = Number(b.quantity || 0);
      });
      setBufferWarehouseBalances(balances);
    }
    } catch (error) {
      console.error('Failed to refresh material transfers:', error);
    } finally {
      fetchInProgress.current = false;
      if (!silent) setLoading(false);
    }
  }

  async function createTransfers() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        alert('User not authenticated');
        setSaving(false);
        return;
      }

      const rmWarehouse = warehouses.find((w) => w.code === 'RM');
      const fromWarehouseId = rmWarehouse?.id;

      if (!fromWarehouseId) {
        alert('Raw Materials Warehouse not found. Please contact admin.');
        setSaving(false);
        return;
      }

      // Validate all lines
      const validLines = transferLines.filter(line => line.raw_material_id && line.quantity > 0);
      if (validLines.length === 0) {
        alert('Please add at least one material with quantity > 0');
        setSaving(false);
        return;
      }

      // Sage is the stock authority for RM transfers. The bridge refreshes this
      // balance from the configured Sage company and verifies it again when posting.
      for (const line of validLines) {
        const rmBalance = rmWarehouseBalances[line.raw_material_id] || 0;
        const material = rawMaterials.find(m => m.id === line.raw_material_id);
        if (line.quantity > rmBalance) {
          alert(`Insufficient Sage RM stock for ${material?.name || 'material'}. Available: ${rmBalance.toLocaleString()} kg, Requested: ${line.quantity.toLocaleString()} kg`);
          setSaving(false);
          return;
        }
      }

      // Create all transfers
      const errors: string[] = [];
      for (const line of validLines) {
        const material = rawMaterials.find(m => m.id === line.raw_material_id);
        const { error } = await supabase.rpc('create_material_transfer_to_buffer', {
          p_raw_material_id: line.raw_material_id,
          p_from_warehouse_id: fromWarehouseId,
          p_quantity: line.quantity,
          p_unit: material?.unit || 'kg',
          p_transfer_date: sharedForm.transfer_date,
          p_purpose: sharedForm.purpose,
          p_notes: sharedForm.notes || null,
          p_production_order_id: sharedForm.production_order_id || null,
          p_requested_by: user.id,
        });

        if (error) {
          errors.push(`${material?.name || line.raw_material_id}: ${error.message}`);
        }
      }

      if (errors.length > 0) {
        alert(`Some transfers failed:\n${errors.join('\n')}`);
        setSaving(false);
        return;
      }

      setShowCreate(false);
      setTransferLines([{ id: crypto.randomUUID(), raw_material_id: '', quantity: 0, source_lot_id: '' }]);
      setSharedForm({
        transfer_date: format(new Date(), 'yyyy-MM-dd'),
        purpose: '',
        production_order_id: '',
        notes: '',
      });
      setSuccessMessage(`${validLines.length} transfer(s) created successfully!`);
      setTimeout(() => setSuccessMessage(''), 3000);
      fetchData();
    } catch (err: any) {
      console.error('Unexpected error:', err);
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const filteredTransfers = transfers.filter((transfer) => {
    const matchesSearch =
      !searchTerm ||
      transfer.raw_materials?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      transfer.raw_materials?.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      transfer.to_location?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || transfer.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: transfers.length,
    in_buffer: transfers.filter(t => t.status === 'in_buffer').length,
    received: transfers.filter(t => t.status === 'received').length,
    rejected: transfers.filter(t => t.status === 'rejected').length,
  };
  const canReceiveInProduction = ['admin', 'md', 'production_manager', 'supervisor', 'operator', 'finance', 'accountant'].includes(profile?.role || '');
  const activeSagePosts = transfers.filter((transfer) => {
    const status = sageSyncLogs[transfer.id]?.status;
    return status === 'pending' || status === 'processing' || status === 'retry';
  });
  const thisMonthCount = transfers.filter((transfer) => {
    const transferDate = new Date(transfer.transfer_date || transfer.created_at);
    const now = new Date();
    return transferDate.getFullYear() === now.getFullYear() && transferDate.getMonth() === now.getMonth();
  }).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <StockTakeFrozenBanner />

      <section className="overflow-hidden rounded-lg border border-[#0d2036] bg-[#0d2036] text-white shadow-lg">
        <div className="flex flex-col gap-6 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="border border-[#f39200] px-2 py-1 uppercase tracking-wide text-[#ffc36b]">Warehouse movement</span>
              <span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Sage transfer status live</span>
            </div>
            <h1 className="mt-4 text-3xl font-bold">Material Transfer</h1>
            <p className="mt-1 text-slate-300">Move approved raw materials from RM through the production buffer.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => fetchData(true)}
              className="inline-flex items-center gap-2 border border-white/20 px-3 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
              title="Refresh transfer data"
            >
              <RefreshCw className="h-4 w-4" /> Updates automatically
            </button>
            {canReceiveInProduction && statusCounts.in_buffer > 0 && (
              <Link
                to="/production-warehouse"
                className="inline-flex items-center gap-2 border border-cyan-300/50 bg-cyan-400/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20"
              >
                <CheckCircle2 className="h-4 w-4" /> Production Receiving ({statusCounts.in_buffer})
              </Link>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 bg-[#f39200] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#d98100]"
            >
              <Plus className="h-4 w-4" /> New Transfer
            </button>
          </div>
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-2 xl:grid-cols-5">
          <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Register</p><p className="mt-2 text-3xl font-bold">{statusCounts.all}</p><p className="mt-1 text-xs text-slate-400">Transfer requests</p></div>
          <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">In buffer</p><p className="mt-2 text-3xl font-bold text-[#ffc36b]">{statusCounts.in_buffer}</p><p className="mt-1 text-xs text-slate-400">Awaiting production</p></div>
          <div className="border-b border-white/10 px-5 py-4 sm:border-r xl:border-b-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Received</p><p className="mt-2 text-3xl font-bold text-emerald-300">{statusCounts.received}</p><p className="mt-1 text-xs text-slate-400">Production confirmed</p></div>
          <div className="border-b border-white/10 px-5 py-4 xl:border-b-0 xl:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">This month</p><p className="mt-2 text-3xl font-bold text-cyan-300">{thisMonthCount}</p><p className="mt-1 text-xs text-slate-400">Materials moved</p></div>
          <div className="px-5 py-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Live Sage activity</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="inline-flex items-center gap-1.5 text-[#ffc36b]"><span className="h-1.5 w-1.5 rounded-full bg-[#f39200]" />Queued {activeSagePosts.length}</span><span className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircle className="h-3.5 w-3.5" />Received {statusCounts.received}</span></div><p className="mt-2 text-xs text-slate-400">Rejected {statusCounts.rejected}</p></div>
        </div>
      </section>

      {activeSagePosts.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center gap-3 text-blue-900">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
          </div>
          <div>
            <p className="text-sm font-bold">Sage transfer posting in progress</p>
            <p className="text-xs text-blue-700 mt-0.5">
              {activeSagePosts.length} transfer{activeSagePosts.length === 1 ? '' : 's'} queued or posting. The Sage status updates automatically when the bridge finishes.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-300/70 bg-slate-50/95 shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-teal-600" />
            <h3 className="text-sm font-semibold text-slate-800">Material Transfers</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search by material name, code, or destination..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white w-64"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
            >
              <option value="all">All Status ({statusCounts.all})</option>
              <option value="in_buffer">In Buffer ({statusCounts.in_buffer})</option>
              <option value="received">Received ({statusCounts.received})</option>
              <option value="rejected">Rejected ({statusCounts.rejected})</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                {['Date', 'Material', 'From Warehouse', 'To Location', 'Quantity', 'Initiated By', 'RM Balance', 'Buffer Balance', 'Purpose', 'Status', 'Sage', 'Actions'].map((header) => (
                  <th key={header} className={`px-3 py-2 font-semibold text-slate-600 text-xs ${['Quantity', 'RM Balance', 'Buffer Balance'].includes(header) ? 'text-right' : 'text-left'}`}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                    No material transfers found
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((transfer) => {
                  const transferDate = transfer.transfer_date || transfer.created_at;
                  const quantity = Math.abs(transfer.quantity || 0);
                  const rmBalance = rmWarehouseBalances[transfer.raw_material_id] ?? 0;
                  const bufferBalance = bufferWarehouseBalances[transfer.raw_material_id] ?? 0;
                  const sageSyncLog = sageSyncLogs[transfer.id];
                  return (
                    <tr
                      key={transfer.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setViewTransfer(transfer)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 text-sm text-slate-600">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {transferDate ? format(new Date(transferDate), 'dd MMM yyyy') : '-'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-sm font-medium text-slate-800">{transfer.raw_materials?.name || '-'}</p>
                        <p className="text-xs text-slate-500">{transfer.raw_materials?.code || ''}</p>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-600">{transfer.warehouses?.name || '-'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 text-sm text-slate-700">
                          <Factory className="w-3.5 h-3.5 text-slate-400" />
                          {transfer.to_location || 'Production Floor'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm text-right font-medium text-slate-700">
                        {quantity.toLocaleString()} {transfer.unit || 'kg'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700 font-medium">
                        {(transfer as any).requester?.full_name || (transfer as any).requester?.email || '—'}
                      </td>
                      <td className="px-3 py-2 text-sm text-right font-medium text-slate-700">
                        {rmBalance.toLocaleString()} {transfer.unit || 'kg'}
                      </td>
                      <td className="px-3 py-2 text-sm text-right font-medium text-emerald-700">
                        {bufferBalance.toLocaleString()} {transfer.unit || 'kg'}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-600">{transfer.purpose || '-'}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={transfer.status || 'pending'} />
                      </td>
                      <td className="px-3 py-2">
                        <SageSyncBadge log={sageSyncLog} />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setViewTransfer(transfer); }}
                          className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye className="w-4 h-4 text-slate-500" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Transfer Modal */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="w-[94vw] max-w-5xl p-0 max-h-[85vh] flex flex-col overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-200">
          <div className="shrink-0 border-b bg-slate-900 text-white px-6 py-4 rounded-t-2xl flex items-center justify-between sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-teal-500 rounded-xl flex items-center justify-center shadow-md">
                <Truck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">New Material Transfer Request</h2>
                <p className="text-slate-400 text-xs">Transfer raw materials from warehouse into production buffer</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">
                Draft Transfer
              </span>
              <button
                onClick={() => setShowCreate(false)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-400 hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50">
            {/* Shared Header Fields */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-teal-600" />
                    <p className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Transfer Details & Purpose</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Transfer Date *</label>
                    <input
                      type="date"
                      value={sharedForm.transfer_date}
                      onChange={(e) => setSharedForm({ ...sharedForm, transfer_date: e.target.value })}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-teal-500 outline-none bg-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Purpose / Reason *</label>
                    <input
                      type="text"
                      value={sharedForm.purpose}
                      onChange={(e) => setSharedForm({ ...sharedForm, purpose: e.target.value })}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-teal-500 outline-none bg-white"
                      placeholder="e.g., For Batch BATCH-2026-000003"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Production Order (Optional)</label>
                    <select
                      value={sharedForm.production_order_id}
                      onChange={(e) => setSharedForm({ ...sharedForm, production_order_id: e.target.value })}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-teal-500 outline-none bg-white"
                    >
                      <option value="">Select order (optional)</option>
                      {productionOrders.map((order) => (
                        <option key={order.id} value={order.id}>
                          {order.batch_number} - {order.status}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Notes</label>
                    <input
                      type="text"
                      value={sharedForm.notes}
                      onChange={(e) => setSharedForm({ ...sharedForm, notes: e.target.value })}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-teal-500 outline-none bg-white"
                      placeholder="Additional notes..."
                    />
                  </div>
                </div>
              </div>

              {/* Transfer Route Visual Card */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-teal-600" />
                    <p className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Transfer Route</p>
                  </div>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">Auto Route</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold">From Source</p>
                    <p className="text-xs font-bold text-slate-900 mt-0.5">Raw Materials Warehouse (RM - 18)</p>
                  </div>
                  <div className="flex justify-center">
                    <ArrowRight className="w-4 h-4 text-teal-600" />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold">To Destination</p>
                    <p className="text-xs font-bold text-slate-900 mt-0.5">Production Floor (via Buffer)</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Transfer Line Items */}
            <div className="rounded-2xl border border-teal-200/80 bg-white p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-teal-600" />
                  <p className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Materials to Transfer</p>
                </div>
                <button
                  onClick={addTransferLine}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  Add Material Line
                </button>
              </div>

              <div className="space-y-2.5">
                {transferLines.map((line, index) => {
                  const material = rawMaterials.find(m => m.id === line.raw_material_id);
                  const rmBalance = rmWarehouseBalances[line.raw_material_id] || 0;
                  const insufficient = line.quantity > rmBalance;
                  return (
                    <div key={line.id} className="grid grid-cols-12 gap-3 items-center p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                      <div className="col-span-1 flex items-center justify-center">
                        <span className="text-xs font-extrabold text-slate-400">#{index + 1}</span>
                      </div>
                      <div className="col-span-6 space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Raw Material *</label>
                        <select
                          value={line.raw_material_id}
                          onChange={(e) => updateTransferLine(line.id, 'raw_material_id', e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-teal-500 bg-white outline-none"
                        >
                          <option value="">Select raw material</option>
                          {rawMaterials.map((mat) => {
                            const bal = rmWarehouseBalances[mat.id] ?? 0;
                            return (
                              <option key={mat.id} value={mat.id}>
                                {mat.name} ({mat.code}) — Sage RM available now: {bal.toLocaleString()} {mat.unit}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="col-span-4 space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Transfer Qty (kg) *</label>
                        <input
                          type="number"
                          value={line.quantity || ''}
                          onChange={(e) => updateTransferLine(line.id, 'quantity', e.target.value ? parseFloat(e.target.value) : 0)}
                          className={`w-full px-3 py-2 border rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-teal-500 outline-none bg-white ${
                            insufficient ? 'border-red-400 bg-red-50 text-red-900' : 'border-slate-300'
                          }`}
                          placeholder="0.00"
                          step="0.01"
                        />
                        {line.raw_material_id && insufficient && (
                          <p className="text-[10px] text-red-600 font-bold mt-0.5">⚠ Exceeds RM Stock ({rmBalance.toLocaleString()} {material?.unit})</p>
                        )}
                        {line.raw_material_id && !insufficient && (
                          <p className="mt-1 text-[10px] font-semibold text-slate-500">
                            Sage RM now {rmBalance.toLocaleString()} {material?.unit}; after receipt: {(rmBalance - Number(line.quantity || 0)).toLocaleString()} {material?.unit}
                          </p>
                        )}
                      </div>
                      <div className="col-span-1 flex items-center justify-center pt-4">
                        <button
                          onClick={() => removeTransferLine(line.id)}
                          disabled={transferLines.length === 1}
                          className="p-2 hover:bg-red-100 text-red-600 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Remove line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 z-30 bg-white border-t border-slate-200 px-6 py-3.5 flex items-center justify-between rounded-b-2xl shadow-lg">
            <span className="text-xs text-slate-500 font-medium">
              {transferLines.filter(l => l.raw_material_id && l.quantity > 0).length} Material Line(s) Ready
            </span>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="px-5 py-2.5 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createTransfers}
                disabled={
                  saving ||
                  !sharedForm.purpose ||
                  transferLines.filter(l => l.raw_material_id && l.quantity > 0).length === 0
                }
                className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-xs transition-all shadow-md disabled:opacity-50"
              >
                {saving ? 'Creating Transfers...' : `Create ${transferLines.filter(l => l.raw_material_id && l.quantity > 0).length} Transfer(s)`}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Success Message Banner */}
      {successMessage && (
        <div className="fixed top-4 right-4 bg-emerald-500 text-slate-950 font-bold border border-emerald-400 rounded-2xl p-4 flex items-center gap-3 shadow-2xl z-50">
          <CheckCircle className="w-5 h-5 text-slate-950" />
          <p className="text-xs">{successMessage}</p>
        </div>
      )}

      {/* View Transfer Details & Approval Modal */}
      <Dialog open={viewTransfer !== null} onOpenChange={() => setViewTransfer(null)}>
        <DialogContent className="w-[94vw] max-w-5xl p-0 max-h-[85vh] flex flex-col overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-200">
          <div className="shrink-0 border-b bg-slate-900 text-white px-6 py-4 rounded-t-2xl flex items-center justify-between sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md">
                <Eye className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">Material Transfer Audit</h2>
                <p className="text-slate-400 text-xs">Verify transfer parameters, buffer status, and handover history</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={viewTransfer?.status || 'pending'} />
              <button
                onClick={() => setViewTransfer(null)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-400 hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
            {viewTransfer && (
              <>
                {/* Top Stat Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Material Name</p>
                    <p className="mt-1 text-base font-black text-slate-900">{viewTransfer.raw_materials?.name || '-'}</p>
                    <p className="text-xs font-mono font-bold text-teal-700">{viewTransfer.raw_materials?.code || ''}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Transfer Quantity</p>
                    <p className="mt-1 text-2xl font-black text-slate-900 font-mono">
                      {Math.abs(viewTransfer.quantity || 0).toLocaleString()} <span className="text-xs font-semibold text-slate-600">{viewTransfer.unit || 'kg'}</span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Current Status</p>
                    <div className="mt-1.5">
                      <StatusBadge status={viewTransfer.status || 'pending'} />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Sage Posting</p>
                    <div className="mt-1.5">
                      <SageSyncBadge log={sageSyncLogs[viewTransfer.id]} />
                    </div>
                    <p className="mt-2 text-[11px] font-medium text-slate-500 leading-snug">
                      {sageSyncLogs[viewTransfer.id]?.message || getSageSyncText(sageSyncLogs[viewTransfer.id])}
                    </p>
                  </div>
                </div>

                {/* 2-Column Main Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Column: Route & Info */}
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3.5 shadow-sm">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                        <ArrowRight className="w-4 h-4 text-teal-600" />
                        <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Transfer Route</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-slate-400 block font-medium">From Warehouse:</span>
                          <span className="font-bold text-slate-900">{viewTransfer.warehouses?.name || 'Raw Materials Warehouse'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">To Location:</span>
                          <span className="font-bold text-slate-900">{viewTransfer.to_location || 'Production Floor'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">Transfer Date:</span>
                          <span className="font-bold text-slate-900">
                            {viewTransfer.transfer_date || viewTransfer.created_at ? format(new Date(viewTransfer.transfer_date || viewTransfer.created_at), 'dd MMM yyyy') : '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">Purpose:</span>
                          <span className="font-bold text-slate-900">{viewTransfer.purpose || '-'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3.5 shadow-sm">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                        <Factory className="w-4 h-4 text-indigo-600" />
                        <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Notes & Remarks</h3>
                      </div>
                      <p className="text-xs text-slate-800 font-medium">{viewTransfer.notes || 'No additional notes recorded.'}</p>
                      {viewTransfer.rejection_reason && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 mt-2">
                          <p className="text-xs font-bold text-red-800 mb-1">Rejection Reason</p>
                          <p className="text-xs text-red-700 font-medium">{viewTransfer.rejection_reason}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Approval history is visible to RM; Production receives the action in its own workspace. */}
                  <div className="space-y-4">
                    {viewTransfer.status === 'in_buffer' && canReceiveInProduction && (
                      <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
                        <p className="text-xs font-bold uppercase tracking-wide text-teal-800">Production receipt pending</p>
                        <p className="mt-1 text-sm text-slate-700">This transfer is ready in the Holding Bay. Receipt approval is performed in Production Warehouse.</p>
                        <Link to="/production-warehouse" onClick={() => setViewTransfer(null)} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-teal-800 hover:text-teal-950">
                          Open Production Receiving <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    )}
                    {/* Approval Timeline Card */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                        <Calendar className="w-4 h-4 text-slate-600" />
                        <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Approval Audit History</h3>
                      </div>
                      <ApprovalHistory entityType="material_transfer" entityId={viewTransfer.id} />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="sticky bottom-0 z-30 bg-white border-t border-slate-200 px-6 py-3.5 flex justify-end rounded-b-2xl shadow-lg">
            <button
              onClick={() => setViewTransfer(null)}
              className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors"
            >
              Close Window
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
