import { useState, useEffect, useMemo } from 'react';
import { Boxes, Search, RefreshCw, AlertTriangle, Package, Calendar, CheckCircle2, Loader2, Truck, UserRound, X, SlidersHorizontal, Radio, Activity, BarChart3, ArrowUpRight, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import './ProductionWarehousePage.css';

interface TransferRow {
  id: string;
  raw_material_id: string;
  quantity: number;
  unit: string;
  movement_date: string;
  batch_number: string;
  notes: string;
  created_at: string;
  raw_materials?: { name: string; code: string; unit: string };
}

interface AggregatedMaterial {
  raw_material_id: string;
  name: string;
  code: string;
  unit: string;
  mes_ledger_quantity: number;
  sage_pd_quantity: number | null;
  sage_pd_synced_at: string | null;
  last_transfer: string;
  transfer_count: number;
  transfers: TransferRow[];
  production_reorder_level: number;
}

interface ProductionMaterialSetting { id: string; name: string; code: string; unit: string; reorder_level: number; production_reorder_level?: number; }

import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface PendingTransfer {
  id: string;
  transfer_number: string;
  quantity: number;
  unit: string;
  status: string;
  transfer_batch_key?: string | null;
  created_at: string;
  purpose?: string;
  notes?: string;
  requester?: { full_name?: string | null } | null;
  raw_materials?: { name: string; code: string; unit?: string };
}

interface SageRetryTransfer extends PendingTransfer {
  sync_log_id: string;
  sync_status: 'failed' | 'pending' | 'processing' | 'retry';
  sync_message?: string | null;
  sync_updated_at: string;
}

interface SageTransferStatus extends PendingTransfer {
  sync_log_id: string;
  sync_status: 'success' | 'failed' | 'pending' | 'processing' | 'retry';
  sync_message?: string | null;
  sync_updated_at: string;
}

interface IncomingBundle {
  key: string;
  transfers: PendingTransfer[];
  pendingTransfers: PendingTransfer[];
  purpose: string;
  requester: string;
  createdAt: string;
  totalQuantity: number;
}

type ReceiptNotice = { tone: 'success' | 'error'; message: string } | null;

const formatWarehouseQuantity = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export default function ProductionWarehousePage() {
  const { profile } = useAuth();
  const isProductionReceiver = profile?.role === 'production_receiver';
  // Keep the UI aligned with approve_material_transfer_to_production on the API.
  const canApproveMaterialTransfer = [
    'admin',
    'production_manager',
    'supervisor',
    'logistics',
    'finance',
    'accountant',
    'production_receiver',
  ].includes(profile?.role || '');
  const canRetrySage = ['admin', 'finance', 'accountant', 'production_manager', 'warehouse_manager', 'raw_material_manager', 'rm_manager'].includes(profile?.role || '');
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [sageProductionBalances, setSageProductionBalances] = useState<Record<string, { quantity: number; syncedAt: string | null }>>({});
  const [pendingAcceptanceTransfers, setPendingAcceptanceTransfers] = useState<PendingTransfer[]>([]);
  const [incomingTransfers, setIncomingTransfers] = useState<PendingTransfer[]>([]);
  const [failedSageTransfers, setFailedSageTransfers] = useState<SageRetryTransfer[]>([]);
  const [recentSageTransfers, setRecentSageTransfers] = useState<SageTransferStatus[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [receivingBundleKey, setReceivingBundleKey] = useState<string | null>(null);
  const [selectedIncomingBundleKey, setSelectedIncomingBundleKey] = useState<string | null>(null);
  const [hasProcessedIncomingIst, setHasProcessedIncomingIst] = useState(false);
  const [expandedIncomingBundle, setExpandedIncomingBundle] = useState<string | null>(null);
  const [receiptToConfirm, setReceiptToConfirm] = useState<PendingTransfer | null>(null);
  const [receiptNotice, setReceiptNotice] = useState<ReceiptNotice>(null);
  const [loading, setLoading] = useState(true);
  const [pageView, setPageView] = useState<'receiving' | 'stock' | 'sage'>('receiving');
  const [incomingFilter, setIncomingFilter] = useState<'all' | 'awaiting' | 'processed'>('awaiting');
  const [sageActivityFilter, setSageActivityFilter] = useState<'all' | 'attention' | 'processed'>('all');
  const [expandedSageIst, setExpandedSageIst] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [materialSettings, setMaterialSettings] = useState<ProductionMaterialSetting[]>([]);
  const [thresholdDraft, setThresholdDraft] = useState<Record<string, string>>({});
  const [lastAlertSignature, setLastAlertSignature] = useState('');
  const [retryingSageId, setRetryingSageId] = useState<string | null>(null);

  async function fetchTransfers(silent = false) {
    if (!silent) setLoading(true);
    const [
      { data: smData, error: smError },
      { data: wbData, error: wbError },
      { data: sagePdData, error: sagePdError },
      { data: incomingData, error: pendingError },
      { data: settingsData, error: settingsError }
    ] = await Promise.all([
      supabase
        .from('stock_movements')
        .select('id, raw_material_id, quantity, unit, movement_date, batch_number, notes, created_at, raw_materials(name, code, unit)')
        .eq('movement_type', 'production_input')
        .order('created_at', { ascending: false }),
      supabase
        .from('warehouse_stock_balances')
        .select('raw_material_id, quantity, warehouses!inner(code)')
        .eq('warehouses.code', 'PRODUCTION'),
      supabase
        .from('sage_stock_balances')
        .select('raw_material_id, quantity, last_synced_at')
        .eq('warehouse_id', 19),
      supabase
        .from('material_transfers')
        .select('id, transfer_number, quantity, unit, status, transfer_batch_key, purpose, notes, created_at, requester:profiles!requested_by(full_name), raw_materials(name, code, unit)')
        .in('status', ['in_buffer', 'received'])
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
    ]);
    if (smError) console.error('Failed to load production movements:', smError);
    if (wbError) console.error('Failed to load production balances:', wbError);
    if (sagePdError) console.error('Failed to load Sage Production balances:', sagePdError);
    if (pendingError) console.error('Failed to load incoming production transfers:', pendingError);
    if (settingsError) console.error('Failed to load production stock thresholds:', settingsError);

    setTransfers((smData as any) || []);
    const nextIncomingTransfers = (incomingData as any) || [];
    setIncomingTransfers(nextIncomingTransfers);
    setPendingAcceptanceTransfers(nextIncomingTransfers.filter((transfer: PendingTransfer) => transfer.status === 'in_buffer'));

    const { data: sageSyncRows, error: failedSyncError } = await supabase
      .from('sync_log')
      .select('id, reference_id, status, message, updated_at')
      .eq('event_type', 'material_transfer_to_production')
      .eq('reference_type', 'material_transfer')
      .in('status', ['success', 'failed', 'pending', 'processing', 'retry'])
      .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('updated_at', { ascending: false });
    if (failedSyncError) console.error('Failed to load Sage retry queue:', failedSyncError);
    const sageIds = [...new Set((sageSyncRows || []).map((row: any) => row.reference_id).filter(Boolean))];
    if (sageIds.length > 0) {
      const { data: sageTransfersData, error: failedTransfersError } = await supabase
        .from('material_transfers')
        .select('id, transfer_number, quantity, unit, status, purpose, notes, created_at, reversed_by, reversed_at, requester:profiles!requested_by(full_name), raw_materials(name, code, unit)')
        .in('id', sageIds)
        .is('reversed_by', null)
        .is('reversed_at', null);
      if (failedTransfersError) console.error('Failed to load received Sage failures:', failedTransfersError);
      const byId = new Map((sageTransfersData || []).map((transfer: any) => [transfer.id, transfer]));
      const statuses = (sageSyncRows || []).flatMap((row: any) => {
        const transfer = byId.get(row.reference_id);
        return transfer ? [{ ...transfer, sync_log_id: row.id, sync_status: row.status, sync_message: row.message, sync_updated_at: row.updated_at }] : [];
      });
      setRecentSageTransfers(statuses as SageTransferStatus[]);
      setFailedSageTransfers(statuses.filter((row: SageTransferStatus) => row.sync_status === 'failed') as SageRetryTransfer[]);
    } else {
      setRecentSageTransfers([]);
      setFailedSageTransfers([]);
    }
    setMaterialSettings((settingsData as ProductionMaterialSetting[]) || []);
    const balMap: Record<string, number> = {};
    (wbData as any || []).forEach((b: any) => {
      balMap[b.raw_material_id] = Number(b.quantity || 0);
    });
    setBalances(balMap);
    const sagePdMap: Record<string, { quantity: number; syncedAt: string | null }> = {};
    (sagePdData as any || []).forEach((balance: any) => {
      sagePdMap[balance.raw_material_id] = {
        quantity: Number(balance.quantity || 0),
        syncedAt: balance.last_synced_at || null,
      };
    });
    setSageProductionBalances(sagePdMap);
    setLastRefresh(new Date());
    if (!silent) setLoading(false);
  }

  async function handleAcceptToProduction(transfer: PendingTransfer) {
    setAcceptingId(transfer.id);
    setReceiptNotice(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');

      const { error } = await supabase.rpc('approve_material_transfer_to_production', {
        p_transfer_id: transfer.id,
        p_approved_by: user.id,
      });

      if (error) throw error;

      setReceiptToConfirm(null);
      setReceiptNotice({
        tone: 'success',
        message: `${transfer.raw_materials?.name || 'Material'} received into Production Warehouse.`,
      });
      await fetchTransfers(true);
    } catch (err: any) {
      setReceiptNotice({
        tone: 'error',
        message: err?.message || 'The transfer could not be received. Please try again.',
      });
    } finally {
      setAcceptingId(null);
    }
  }

  useEffect(() => { fetchTransfers(); }, []);

  useEffect(() => {
    const channel = supabase
      .channel('production-warehouse-live-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, () => {
        fetchTransfers(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sage_stock_balances' }, () => {
        fetchTransfers(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_stock_balances' }, () => {
        fetchTransfers(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_transfers' }, () => {
        fetchTransfers(true);
      })
      .subscribe();

    const intervalId = window.setInterval(() => {
      fetchTransfers(true);
    }, 12000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, []);

  const aggregated = useMemo<AggregatedMaterial[]>(() => {
    const map: Record<string, AggregatedMaterial> = {};
    for (const t of transfers) {
      const id = t.raw_material_id;
      if (!map[id]) {
        map[id] = {
          raw_material_id: id,
          name: (t.raw_materials as any)?.name || 'Unknown',
          code: (t.raw_materials as any)?.code || '',
          unit: (t.raw_materials as any)?.unit || t.unit,
          mes_ledger_quantity: 0,
          sage_pd_quantity: null,
          sage_pd_synced_at: null,
          last_transfer: t.movement_date || t.created_at,
          transfer_count: 0,
          transfers: [],
          production_reorder_level: 0,
        };
      }
      map[id].mes_ledger_quantity += Number(t.quantity || 0);
      map[id].transfer_count += 1;
      map[id].transfers.push(t);
      if ((t.movement_date || t.created_at) > map[id].last_transfer) {
        map[id].last_transfer = t.movement_date || t.created_at;
      }
    }
    for (const setting of materialSettings) {
      const threshold = Number(setting.production_reorder_level ?? setting.reorder_level ?? 0);
      if (!map[setting.id]) {
        map[setting.id] = { raw_material_id: setting.id, name: setting.name, code: setting.code, unit: setting.unit, mes_ledger_quantity: 0, sage_pd_quantity: 0, sage_pd_synced_at: null, last_transfer: new Date(0).toISOString(), transfer_count: 0, transfers: [], production_reorder_level: threshold };
      } else {
        map[setting.id].production_reorder_level = threshold;
      }
    }
    for (const id of Object.keys(map)) {
      if (balances[id] !== undefined) {
        map[id].mes_ledger_quantity = balances[id];
      }
      if (sageProductionBalances[id] !== undefined) {
        map[id].sage_pd_quantity = sageProductionBalances[id].quantity;
        map[id].sage_pd_synced_at = sageProductionBalances[id].syncedAt;
      }
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [transfers, balances, sageProductionBalances, materialSettings]);

  const filtered = useMemo(() => {
    if (!search.trim()) return aggregated;
    const q = search.toLowerCase();
    return aggregated.filter(m => m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
  }, [aggregated, search]);

  const totalMaterials = aggregated.length;
  const totalSagePdQty = aggregated.reduce((sum, material) => sum + Math.max(0, material.sage_pd_quantity || 0), 0);
  const lastSagePdSync = aggregated.reduce<string | null>((latest, material) => {
    if (!material.sage_pd_synced_at) return latest;
    if (!latest || new Date(material.sage_pd_synced_at) > new Date(latest)) return material.sage_pd_synced_at;
    return latest;
  }, null);
  const recentCount = aggregated.filter(m => {
    const d = new Date(m.last_transfer);
    const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 7;
  }).length;
  const pendingReceiptQuantity = pendingAcceptanceTransfers.reduce((sum, transfer) => sum + Number(transfer.quantity || 0), 0);
  const incomingBundles = useMemo<IncomingBundle[]>(() => {
    const groups = new Map<string, PendingTransfer[]>();
    incomingTransfers.forEach((transfer) => {
      const dateKey = format(new Date(transfer.created_at), 'yyyy-MM-dd');
      const requesterKey = transfer.requester?.full_name || 'Unknown requester';
      const key = transfer.transfer_batch_key || `${dateKey}|${transfer.purpose || 'Unspecified'}|${requesterKey}`;
      groups.set(key, [...(groups.get(key) || []), transfer]);
    });
    return [...groups.entries()].map(([key, group]) => ({
      key,
      transfers: group,
      pendingTransfers: group.filter((transfer) => transfer.status === 'in_buffer'),
      purpose: group[0].purpose || 'Unspecified transfer',
      requester: group[0].requester?.full_name || 'Unknown requester',
      createdAt: group[0].created_at,
      totalQuantity: group.reduce((sum, transfer) => sum + Number(transfer.quantity || 0), 0),
    }));
  }, [incomingTransfers]);
  const visibleIncomingBundles = useMemo(() => incomingBundles.filter((bundle) => {
    if (incomingFilter === 'awaiting') return bundle.pendingTransfers.length > 0;
    if (incomingFilter === 'processed') return bundle.pendingTransfers.length === 0;
    return true;
  }), [incomingBundles, incomingFilter]);
  const sageActivityGroups = useMemo(() => {
    const groups = new Map<string, SageTransferStatus[]>();
    recentSageTransfers.forEach((transfer) => {
      const key = transfer.purpose || transfer.transfer_number || transfer.id;
      groups.set(key, [...(groups.get(key) || []), transfer]);
    });
    return [...groups.entries()].map(([key, lines]) => {
      const hasFailed = lines.some((line) => line.sync_status === 'failed');
      const hasProcessing = lines.some((line) => line.sync_status === 'processing');
      const hasPending = lines.some((line) => ['pending', 'retry'].includes(line.sync_status));
      const status: SageTransferStatus['sync_status'] = hasFailed ? 'failed' : hasProcessing ? 'processing' : hasPending ? (lines.some((line) => line.sync_status === 'retry') ? 'retry' : 'pending') : 'success';
      return {
        key,
        lines,
        status,
        totalQuantity: lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
        unit: new Set(lines.map((line) => line.unit)).size === 1 ? lines[0].unit : 'mixed units',
        first: lines[0],
      };
    });
  }, [recentSageTransfers]);
  const visibleSageActivityGroups = sageActivityGroups.filter((group) => {
    if (sageActivityFilter === 'processed') return group.status === 'success';
    if (sageActivityFilter === 'attention') return group.status !== 'success';
    return true;
  });
  const stockHealth = useMemo(() => {
    const critical = aggregated.filter((m) => m.production_reorder_level > 0 && Number(m.sage_pd_quantity || 0) === 0);
    const low = aggregated.filter((m) => m.production_reorder_level > 0 && Number(m.sage_pd_quantity || 0) > 0 && Number(m.sage_pd_quantity || 0) <= m.production_reorder_level);
    return { critical, low, healthy: aggregated.length - critical.length - low.length };
  }, [aggregated]);
  const floorReadiness = totalMaterials ? Math.round((stockHealth.healthy / totalMaterials) * 100) : 100;
  const movedThisWeek = transfers
    .filter((transfer) => Date.now() - new Date(transfer.movement_date || transfer.created_at).getTime() <= 7 * 24 * 60 * 60 * 1000)
    .reduce((sum, transfer) => sum + Number(transfer.quantity || 0), 0);
  const topFloorMaterials = [...aggregated]
    .filter((material) => Number(material.sage_pd_quantity || 0) > 0)
    .sort((a, b) => Number(b.sage_pd_quantity || 0) - Number(a.sage_pd_quantity || 0))
    .slice(0, 5);
  const largestFloorBalance = Math.max(1, ...topFloorMaterials.map((material) => Number(material.sage_pd_quantity || 0)));
  const recentFloorActivity = transfers.slice(0, 5);

  useEffect(() => {
    const signature = [...stockHealth.critical, ...stockHealth.low].map((m) => `${m.raw_material_id}:${m.sage_pd_quantity}`).join('|');
    if (signature && signature !== lastAlertSignature) {
      const total = stockHealth.critical.length + stockHealth.low.length;
      toast.custom((notification) => (
        <div className="flex w-[360px] items-start gap-3 border border-amber-200 bg-white p-4 shadow-xl" role="status">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">Production stock needs attention</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-600">
              {stockHealth.critical.length > 0 ? `${stockHealth.critical.length} critical` : `${total} below minimum`} in Production Warehouse.
            </p>
          </div>
          <button type="button" onClick={() => toast.dismiss(notification.id)} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Dismiss stock alert">
            <X className="h-4 w-4" />
          </button>
        </div>
      ), { duration: 8000, position: 'top-right' });
    }
    setLastAlertSignature(signature);
  }, [stockHealth, lastAlertSignature]);

  async function saveProductionThreshold(materialId: string, value: string) {
    const threshold = Math.max(0, Number(value || 0));
    const { error } = await supabase.from('raw_materials').update({ production_reorder_level: threshold }).eq('id', materialId);
    if (error) {
      // Older databases may not yet have the separate Production threshold
      // column. Keep the control usable by persisting the established shared
      // reorder level until that additive migration is applied.
      const missingProductionThresholdColumn = error.code === 'PGRST204'
        || /production_reorder_level|column/i.test(error.message || '');
      if (!missingProductionThresholdColumn) return toast.error('Could not save the Production threshold. Please try again.');

      const { error: fallbackError } = await supabase
        .from('raw_materials')
        .update({ reorder_level: threshold })
        .eq('id', materialId);
      if (fallbackError) return toast.error('Could not save the stock threshold. Please try again.');

      setMaterialSettings((items) => items.map((item) => item.id === materialId
        ? { ...item, reorder_level: threshold, production_reorder_level: threshold }
        : item));
      toast.success('Production minimum saved using the current shared reorder level.');
      return;
    }
    setMaterialSettings((items) => items.map((item) => item.id === materialId ? { ...item, production_reorder_level: threshold } : item));
    toast.success('Production threshold saved.');
  }

  async function retryFailedSageLine(transfer: SageRetryTransfer) {
    setRetryingSageId(transfer.sync_log_id);
    setReceiptNotice(null);
    try {
      const { error } = await supabase.rpc('request_sync_retry', { p_log_id: transfer.sync_log_id });
      if (error) throw error;
      setReceiptNotice({ tone: 'success', message: `${transfer.raw_materials?.name || 'Material'} from ${transfer.purpose || 'the IST'} was queued for Sage retry. Other posted lines were left untouched.` });
      await fetchTransfers(true);
    } catch (err: any) {
      setReceiptNotice({ tone: 'error', message: err?.message || 'The Sage line could not be queued for retry.' });
    } finally {
      setRetryingSageId(null);
    }
  }

  async function handleReceiveBundle(bundle: IncomingBundle) {
    setReceivingBundleKey(bundle.key);
    setReceiptNotice(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('User not authenticated');
      const failures: string[] = [];
      for (const transfer of bundle.pendingTransfers) {
        const { error } = await supabase.rpc('approve_material_transfer_to_production', { p_transfer_id: transfer.id, p_approved_by: user.id });
        if (error) failures.push(`${transfer.raw_materials?.name || transfer.transfer_number}: ${error.message}`);
      }
      await fetchTransfers(true);
      setReceiptNotice(failures.length
        ? { tone: 'error', message: `${bundle.pendingTransfers.length - failures.length} of ${bundle.pendingTransfers.length} lines received. ${failures.join(' | ')}` }
        : { tone: 'success', message: `${bundle.pendingTransfers.length} materials received into Production Warehouse.` });
      setSelectedIncomingBundleKey(null);
      setHasProcessedIncomingIst(true);
    } catch (err: any) {
      setReceiptNotice({ tone: 'error', message: err?.message || 'The transfer bundle could not be received.' });
    } finally {
      setReceivingBundleKey(null);
    }
  }

  const sageStageIndex = (status: SageTransferStatus['sync_status']) => {
    if (status === 'success') return 3;
    if (status === 'processing') return 2;
    if (status === 'pending' || status === 'retry') return 1;
    return 0;
  };

  const sageStageLabel = (status: SageTransferStatus['sync_status']) => {
    if (status === 'success') return 'Posted to Sage';
    if (status === 'processing') return 'Posting to Sage';
    if (status === 'retry') return 'Retry queued';
    if (status === 'pending') return 'Queued for Sage';
    return 'Sage posting failed';
  };

  return (
    <div className="production-workspace mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
      <section className="warehouse-heading flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-teal-700">HYPERFEEDS / PRODUCTION</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Production Warehouse</h1>
          <p className="mt-1 text-xs text-slate-500">Warehouse 19 · {totalMaterials} materials</p>
        </div>
        <button
          onClick={() => fetchTransfers()}
          className="warehouse-refresh flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </section>

      <nav className="warehouse-tabs flex flex-wrap items-center gap-1" aria-label="Production warehouse views">
        <button type="button" onClick={() => setPageView('receiving')} className={`inline-flex min-h-10 items-center gap-2 px-4 py-2 text-sm font-bold transition-colors ${pageView === 'receiving' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Truck className="h-4 w-4" /> Receiving <span className={`text-xs ${pageView === 'receiving' ? 'text-teal-100' : 'text-slate-400'}`}>{pendingAcceptanceTransfers.length}</span>
        </button>
        <button type="button" onClick={() => setPageView('stock')} className={`inline-flex min-h-10 items-center gap-2 px-4 py-2 text-sm font-bold transition-colors ${pageView === 'stock' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Package className="h-4 w-4" /> Floor stock
        </button>
        <button type="button" onClick={() => setPageView('sage')} className={`inline-flex min-h-10 items-center gap-2 px-4 py-2 text-sm font-bold transition-colors ${pageView === 'sage' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Radio className="h-4 w-4" /> Sage activity {failedSageTransfers.length > 0 && <span className={`text-xs ${pageView === 'sage' ? 'text-rose-100' : 'text-rose-600'}`}>{failedSageTransfers.length} issue{failedSageTransfers.length === 1 ? '' : 's'}</span>}
        </button>
        <span className="ml-auto hidden px-3 text-xs font-medium text-slate-400 md:inline">Last refresh {format(lastRefresh, 'HH:mm:ss')}</span>
      </nav>

      {receiptNotice && (
        <div className={`flex items-start justify-between gap-4 border-l-4 px-4 py-3 text-sm shadow-sm ${receiptNotice.tone === 'success' ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-rose-500 bg-rose-50 text-rose-900'}`}>
          <div className="flex items-start gap-2">
            {receiptNotice.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
            <span className="font-medium">{receiptNotice.message}</span>
          </div>
          <button type="button" onClick={() => setReceiptNotice(null)} className="text-current/60 hover:text-current" aria-label="Dismiss notification"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Live RM inbox for Production receiving */}
      {pageView === 'receiving' && (
      <section className="warehouse-receiving border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-teal-100 bg-teal-50/70 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border border-teal-200 bg-teal-100 text-teal-700">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">Incoming transfers</h2>
                  <span className="border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-700">{pendingAcceptanceTransfers.length} ready</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="incoming-status-filter" className="sr-only">Show incoming ISTs</label>
                <select id="incoming-status-filter" value={incomingFilter} onChange={(event) => setIncomingFilter(event.target.value as typeof incomingFilter)} className="border border-teal-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 focus:border-teal-500 focus:outline-none">
                  <option value="awaiting">Awaiting receipt</option>
                  <option value="processed">Processed</option>
                  <option value="all">All ISTs</option>
                </select>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-bold text-slate-900">{pendingReceiptQuantity.toLocaleString()} kg</p>
                <p className="text-xs font-medium text-slate-500">awaiting receipt</p>
              </div>
            {!isProductionReceiver && (
              <Link
                to="/material-transfer"
                className="text-sm font-semibold text-teal-700 hover:text-teal-900"
              >
                Transfer history
              </Link>
            )}
          </div>
          </div>

          <div className="divide-y divide-teal-100 px-5">
            {visibleIncomingBundles.map((bundle) => {
              const isOpen = expandedIncomingBundle === bundle.key;
              const isReceiving = receivingBundleKey === bundle.key;
              return (
                <div key={bundle.key} className={`py-3 ${selectedIncomingBundleKey && selectedIncomingBundleKey !== bundle.key ? 'opacity-60' : ''}`}>
                  <div className="warehouse-ist-row grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
                    <button type="button" onClick={() => setExpandedIncomingBundle(isOpen ? null : bundle.key)} className="flex min-w-0 items-start gap-3 text-left">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-teal-200 bg-teal-50 text-teal-700">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{bundle.purpose || 'Raw Materials to Production'}</p>
                          <span className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{bundle.transfers.length} materials</span>
                          <span className={`border px-2 py-0.5 text-xs font-semibold ${bundle.pendingTransfers.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{bundle.pendingTransfers.length ? 'Awaiting receipt' : 'Received'}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {format(new Date(bundle.createdAt), 'dd MMM yyyy, HH:mm')}</span>
                          <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> {bundle.requester}</span>
                        </div>
                      </div>
                    </button>
                    <div className="border-l border-teal-200 pl-4 text-right">
                      <p className="font-mono text-lg font-bold text-slate-900">{bundle.totalQuantity.toLocaleString()} kg</p>
                    </div>
                    {canApproveMaterialTransfer && bundle.pendingTransfers.length > 0 && (
                      selectedIncomingBundleKey === bundle.key ? (
                        <button type="button" disabled={isReceiving} onClick={() => handleReceiveBundle(bundle)} className="inline-flex min-h-10 items-center justify-center gap-2 bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-60">
                          {isReceiving ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing approval</> : <><CheckCircle2 className="h-4 w-4" /> Approve selected IST</>}
                        </button>
                      ) : (
                      <button type="button" disabled={Boolean(selectedIncomingBundleKey)} onClick={() => setSelectedIncomingBundleKey(bundle.key)} className="inline-flex min-h-10 items-center justify-center gap-2 border border-teal-300 bg-white px-4 py-2 text-sm font-semibold text-teal-800 transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50">
                          <CheckCircle2 className="h-4 w-4" /> {hasProcessedIncomingIst ? 'Next IST' : 'Select IST'}
                        </button>
                      )
                    )}
                  </div>
                  {isOpen && (
                    <div className="mt-3 overflow-hidden border border-slate-200 bg-slate-50">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-slate-200 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>Material</span><span>Transfer</span><span>Quantity</span></div>
                      {bundle.transfers.map((pt) => (
                        <div key={pt.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0">
                          <div><p className="font-semibold text-slate-900">{pt.raw_materials?.name || 'Raw material'} <span className="ml-1 font-mono text-xs font-normal text-slate-500">{pt.raw_materials?.code}</span></p><p className="text-xs text-slate-500">{pt.status === 'received' ? 'Received into Production Warehouse 19' : 'Holding Bay · ready for Production Warehouse 19'}</p></div>
                          <span className="font-mono text-xs text-slate-500">{pt.transfer_number}</span>
                          <span className="font-mono text-sm font-bold text-slate-900">{Number(pt.quantity).toLocaleString()} {pt.unit}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {visibleIncomingBundles.length === 0 && (
            <div className="border-t border-teal-100 px-5 py-10 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-2 text-sm font-bold text-slate-800">No ISTs in this view</p>
            </div>
          )}
        </section>
      )}

      {pageView === 'sage' && recentSageTransfers.length > 0 && (
        <section className="warehouse-sage border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Sage posting status</h2>
              <p className="mt-0.5 text-xs text-slate-500">Last 24 hours · {sageActivityGroups.length} ISTs</p>
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="sage-activity-filter" className="text-xs font-bold uppercase tracking-wide text-slate-500">Show</label>
              <select id="sage-activity-filter" value={sageActivityFilter} onChange={(event) => setSageActivityFilter(event.target.value as typeof sageActivityFilter)} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 focus:border-teal-500 focus:outline-none">
                <option value="all">All ISTs</option>
                <option value="attention">Needs attention</option>
                <option value="processed">Processed</option>
              </select>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {visibleSageActivityGroups.slice(0, 20).map((group) => {
              const stage = sageStageIndex(group.status);
              const failed = group.status === 'failed';
              const expanded = expandedSageIst === group.key;
              return (
                <div key={group.key} className="px-5 py-3">
                  <button type="button" onClick={() => setExpandedSageIst(expanded ? null : group.key)} className="flex w-full flex-wrap items-center justify-between gap-3 text-left">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 bg-slate-50 text-slate-500">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-slate-900">{group.key}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{group.lines.length} material{group.lines.length === 1 ? '' : 's'} · {group.totalQuantity.toLocaleString()} {group.unit}</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${failed ? 'text-rose-700' : group.status === 'success' ? 'text-emerald-700' : 'text-blue-700'}`}>
                      {failed ? <AlertTriangle className="h-3.5 w-3.5" /> : group.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {sageStageLabel(group.status)}
                    </span>
                  </button>
                  <div className="mt-2 flex items-center gap-2 pl-11 text-[11px] font-semibold" aria-label={`Sage status: ${sageStageLabel(group.status)}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${failed ? 'bg-rose-500' : group.status === 'success' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-slate-500">Stage {stage + 1}/4</span>
                  </div>
                  {expanded && <div className="mt-3 ml-11 divide-y divide-slate-100 border border-slate-200 bg-slate-50">
                    {group.lines.map((line) => <div key={line.sync_log_id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><span className="font-semibold text-slate-800">{line.raw_materials?.name || 'Raw material'} <span className="ml-1 font-mono font-normal text-slate-500">{line.raw_materials?.code}</span><span className="ml-2 font-mono font-normal text-slate-400">{line.transfer_number}</span></span><span className="font-mono text-slate-600">{Number(line.quantity).toLocaleString()} {line.unit}</span></div>)}
                  </div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pageView === 'sage' && failedSageTransfers.length > 0 && (
        <section className="border border-rose-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-100 bg-rose-50/70 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border border-rose-200 bg-rose-100 text-rose-700"><AlertTriangle className="h-5 w-5" /></div>
              <div><h2 className="text-base font-bold text-slate-900">Sage posting status</h2><p className="mt-0.5 text-sm text-slate-600">Each received line is tracked until Sage confirms it is posted.</p></div>
            </div>
            <span className="border border-rose-200 bg-white px-2 py-1 text-xs font-bold text-rose-700">{failedSageTransfers.length} Sage line{failedSageTransfers.length === 1 ? '' : 's'} in queue</span>
          </div>
          <div className="divide-y divide-slate-100">
            {failedSageTransfers.map((transfer) => (
              <div key={transfer.sync_log_id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0"><p className="font-semibold text-slate-900">{transfer.raw_materials?.name || 'Raw material'} <span className="ml-1 font-mono text-xs font-normal text-slate-500">{transfer.raw_materials?.code}</span></p><p className="mt-1 text-xs text-slate-500"><span className="font-bold text-slate-700">{transfer.purpose || 'IST'}</span> · {transfer.transfer_number} · {Number(transfer.quantity).toLocaleString()} {transfer.unit}</p><p className={`mt-1 text-xs font-semibold ${transfer.sync_status === 'failed' ? 'text-rose-700' : 'text-blue-700'}`}>{transfer.sync_status === 'failed' ? (transfer.sync_message || 'Sage posting failed') : transfer.sync_status === 'processing' ? 'Posting to Sage now...' : 'Retry queued; waiting for the Sage bridge...'}</p></div>
                {canRetrySage && transfer.sync_status === 'failed' && <button type="button" onClick={() => retryFailedSageLine(transfer)} disabled={retryingSageId === transfer.sync_log_id} className="inline-flex items-center gap-2 border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60"><RotateCcw className={`h-4 w-4 ${retryingSageId === transfer.sync_log_id ? 'animate-spin' : ''}`} />{retryingSageId === transfer.sync_log_id ? 'Queueing...' : 'Retry Sage line'}</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      {receiptToConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="receive-transfer-title">
          <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase text-teal-700">Production receipt</p>
                <h2 id="receive-transfer-title" className="mt-1 text-lg font-bold text-slate-900">Receive material into Production?</h2>
              </div>
              <button type="button" onClick={() => setReceiptToConfirm(null)} disabled={acceptingId === receiptToConfirm.id} className="text-slate-400 hover:text-slate-700" aria-label="Close receipt confirmation"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5 text-sm">
              <div className="flex items-center justify-between gap-4 border-l-4 border-teal-600 bg-teal-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-slate-900">{receiptToConfirm.raw_materials?.name}</p>
                  <p className="font-mono text-xs text-slate-500">{receiptToConfirm.transfer_number} · {receiptToConfirm.raw_materials?.code}</p>
                </div>
                <p className="font-mono text-lg font-bold text-teal-800">{Number(receiptToConfirm.quantity).toLocaleString()} {receiptToConfirm.unit}</p>
              </div>
              <p className="leading-6 text-slate-600">This confirms the physical handover from the Holding Bay and makes the material available in Production Warehouse 19.</p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setReceiptToConfirm(null)} disabled={acceptingId === receiptToConfirm.id} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => handleAcceptToProduction(receiptToConfirm)} disabled={acceptingId === receiptToConfirm.id} className="inline-flex items-center gap-2 bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
                {acceptingId === receiptToConfirm.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {pageView === 'stock' && <>
      <section className="grid gap-px overflow-hidden border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Floor readiness</p><Activity className="h-4 w-4 text-emerald-600" /></div><p className="mt-2 text-2xl font-bold text-slate-900">{floorReadiness}%</p><p className="mt-1 text-xs text-slate-500">{stockHealth.healthy} of {totalMaterials} materials above minimum</p></div>
        <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Sage production available</p><Package className="h-4 w-4 text-emerald-600" /></div><p className="mt-2 text-2xl font-bold text-emerald-700">{formatWarehouseQuantity(totalSagePdQty)} <span className="text-sm">kg</span></p><p className="mt-1 text-xs text-slate-500">Warehouse 19 live balance</p></div>
        <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Moved this week</p><ArrowUpRight className="h-4 w-4 text-teal-600" /></div><p className="mt-2 text-2xl font-bold text-slate-900">{movedThisWeek.toLocaleString()} <span className="text-sm">kg</span></p><p className="mt-1 text-xs text-slate-500">{recentCount} materials received on floor</p></div>
        <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Inbound queue</p><Truck className="h-4 w-4 text-amber-600" /></div><p className="mt-2 text-2xl font-bold text-slate-900">{pendingReceiptQuantity.toLocaleString()} <span className="text-sm">kg</span></p><p className="mt-1 text-xs text-slate-500">{pendingAcceptanceTransfers.length} transfer{pendingAcceptanceTransfers.length === 1 ? '' : 's'} awaiting receipt</p></div>
      </section>

      <section className={`flex flex-wrap items-center justify-between gap-3 border-l-4 px-4 py-3 ${stockHealth.critical.length ? 'border-rose-500 bg-rose-50' : stockHealth.low.length ? 'border-amber-500 bg-amber-50' : 'border-emerald-500 bg-emerald-50'}`}>
        <div className="flex items-center gap-3"><AlertTriangle className={`h-5 w-5 ${stockHealth.critical.length ? 'text-rose-600' : stockHealth.low.length ? 'text-amber-600' : 'text-emerald-600'}`} /><div><p className="text-sm font-bold text-slate-900">{stockHealth.critical.length ? 'Production stock requires attention' : stockHealth.low.length ? 'Production stock is below minimum' : 'Production stock position healthy'}</p><p className="text-xs text-slate-600">Sage Production 19 last synced {lastSagePdSync ? format(new Date(lastSagePdSync), 'dd MMM, HH:mm:ss') : 'awaiting first sync'}.</p></div></div>
        {(stockHealth.critical.length || stockHealth.low.length) > 0 && <div className="flex flex-wrap gap-2">{[...stockHealth.critical, ...stockHealth.low].slice(0, 3).map((m) => <span key={m.raw_material_id} className="border border-white bg-white px-2 py-1 text-xs font-semibold text-slate-700">{m.name}: {formatWarehouseQuantity(Number(m.sage_pd_quantity || 0))} / {formatWarehouseQuantity(m.production_reorder_level)} {m.unit}</span>)}</div>}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Floor availability</p><h2 className="mt-1 text-base font-bold text-slate-900">Largest Sage Production balances</h2></div><BarChart3 className="h-5 w-5 text-teal-600" /></div>
          <div className="divide-y divide-slate-100 px-5">
            {topFloorMaterials.length ? topFloorMaterials.map((material) => {
              const quantity = Number(material.sage_pd_quantity || 0);
              const width = Math.max(3, Math.round((quantity / largestFloorBalance) * 100));
              return <div key={material.raw_material_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-5 py-3"><div className="min-w-0"><div className="flex items-baseline justify-between gap-3"><p className="truncate text-sm font-semibold text-slate-800">{material.name}</p><span className="font-mono text-xs text-slate-500">{material.code}</span></div><div className="mt-2 h-1.5 overflow-hidden bg-slate-100"><div className="h-full bg-teal-600" style={{ width: `${width}%` }} /></div></div><p className="self-center text-right font-mono text-sm font-bold text-emerald-700">{formatWarehouseQuantity(quantity)} <span className="text-xs font-medium text-slate-500">{material.unit}</span></p></div>;
            }) : <p className="py-8 text-sm text-slate-500">Awaiting Production Warehouse 19 stock data.</p>}
          </div>
        </div>
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recent activity</p><h2 className="mt-1 text-base font-bold text-slate-900">Latest floor receipts</h2></div><Calendar className="h-5 w-5 text-slate-500" /></div>
          <div className="divide-y divide-slate-100 px-5">
            {recentFloorActivity.length ? recentFloorActivity.map((transfer) => <div key={transfer.id} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{transfer.raw_materials?.name || 'Raw material'}</p><p className="mt-0.5 font-mono text-xs text-slate-500">{transfer.batch_number || 'No batch'} · {format(new Date(transfer.movement_date || transfer.created_at), 'dd MMM, HH:mm')}</p></div><p className="shrink-0 text-right font-mono text-sm font-bold text-slate-800">{Number(transfer.quantity).toLocaleString()}<span className="ml-1 text-xs font-medium text-slate-500">{transfer.unit}</span></p></div>) : <p className="py-8 text-sm text-slate-500">No floor receipts recorded yet.</p>}
          </div>
        </div>
      </section>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search material..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            />
          </div>
          <p className="text-xs text-slate-400 ml-4">Live view refreshed: {format(lastRefresh, 'HH:mm:ss')}</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Boxes className="w-12 h-12 mb-3" />
            <p className="text-sm font-medium">No materials found on production floor</p>
            <p className="text-xs mt-1">Create a Material Transfer to move stock from RM warehouse to production</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(m => (
              <div key={m.raw_material_id}>
                <button
                  className="w-full flex items-center px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                  onClick={() => setExpanded(expanded === m.raw_material_id ? null : m.raw_material_id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-teal-50 border border-teal-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Package className="w-4 h-4 text-teal-600" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{m.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{m.code}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm mr-4">
                    <div className="text-right">
                      <p className="font-semibold text-emerald-700">{m.sage_pd_quantity === null ? 'Not synced' : `${formatWarehouseQuantity(m.sage_pd_quantity)} ${m.unit}`}</p>
                      <p className="text-xs text-slate-400">Sage PD {m.sage_pd_synced_at ? format(new Date(m.sage_pd_synced_at), 'dd MMM HH:mm:ss') : ''}</p>
                    </div>
                    <div className="text-right hidden md:block">
                      <p className="font-semibold text-slate-800">{formatWarehouseQuantity(Math.max(0, m.mes_ledger_quantity))} <span className="text-xs font-normal text-slate-400">{m.unit}</span></p>
                      <p className="text-xs text-slate-400">MES floor ledger</p>
                    </div>
                    {!isProductionReceiver && <div className="hidden lg:block" onClick={(event) => event.stopPropagation()}>
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Floor minimum</label>
                      <div className="mt-1 flex items-center gap-1"><SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" /><input type="number" min="0" step="0.01" value={thresholdDraft[m.raw_material_id] ?? String(m.production_reorder_level || '')} onChange={(event) => setThresholdDraft((draft) => ({ ...draft, [m.raw_material_id]: event.target.value }))} onBlur={(event) => saveProductionThreshold(m.raw_material_id, event.target.value)} className="w-20 border border-slate-200 bg-white px-1.5 py-1 text-right font-mono text-xs text-slate-700 focus:border-teal-500 focus:outline-none" /><span className="text-[10px] text-slate-400">{m.unit}</span></div>
                    </div>}
                    <div className="text-right hidden sm:block">
                      <p className="text-slate-600 flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(m.last_transfer), 'dd MMM yyyy')}</p>
                      <p className="text-xs text-slate-400">Last transfer</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="font-medium text-slate-600">{m.transfer_count}</p>
                      <p className="text-xs text-slate-400">Transfers</p>
                    </div>
                  </div>
                  <span className={`text-slate-300 text-lg transition-transform ${expanded === m.raw_material_id ? 'rotate-90' : ''}`}>›</span>
                </button>

                {expanded === m.raw_material_id && (
                  <div className="px-4 pb-4 bg-slate-50/50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-left">
                          <th className="py-2 px-3 font-semibold text-slate-500">Date</th>
                          <th className="py-2 px-3 font-semibold text-slate-500">Batch</th>
                          <th className="py-2 px-3 font-semibold text-slate-500 text-right">Qty</th>
                          <th className="py-2 px-3 font-semibold text-slate-500">Purpose / Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {m.transfers.map(t => (
                          <tr key={t.id} className="hover:bg-white">
                            <td className="py-2 px-3 text-slate-600">{t.movement_date ? format(new Date(t.movement_date), 'dd MMM yyyy') : '-'}</td>
                            <td className="py-2 px-3 font-mono text-slate-600">{t.batch_number || '-'}</td>
                            <td className="py-2 px-3 text-right font-medium text-slate-700">{Number(t.quantity).toLocaleString()} {t.unit}</td>
                            <td className="py-2 px-3 text-slate-500 truncate max-w-xs">{t.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-slate-500">{filtered.length} material{filtered.length !== 1 ? 's' : ''} on production floor</p>
        </div>
      </div>
      </>}
    </div>
  );
}
