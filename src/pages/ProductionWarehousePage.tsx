import { useState, useEffect, useMemo, useRef } from 'react';
import { Boxes, Search, RefreshCw, AlertTriangle, Package, Calendar, CheckCircle2, Loader2, Truck, UserRound, X, SlidersHorizontal, Radio, Activity, BarChart3, ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { transferSyncStatus } from '../lib/transferSyncStatus';
import { incomingIstDate } from '../lib/incomingIstDate';
import { incomingReceiptBlockReason } from '../lib/incomingReceiptSafety';
import { transferQuantitySummary } from '../lib/transferQuantitySummary';
import SageTransferHistory from '../components/SageTransferHistory';
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
  raw_material_id: string;
  quantity: number;
  unit: string;
  status: string;
  transfer_batch_key?: string | null;
  created_at: string;
  transfer_date?: string | null;
  purpose?: string;
  notes?: string;
  requester?: { full_name?: string | null } | null;
  receiver?: { full_name?: string | null } | null;
  production_approved_at?: string | null;
  raw_materials?: { name: string; code: string; unit?: string };
}


interface SageTransferStatus extends PendingTransfer {
  sync_log_id: string;
  sync_status: 'success' | 'failed' | 'pending' | 'processing' | 'retry';
  sync_message?: string | null;
  sync_updated_at: string;
}

interface IncomingStage {
  label: string;
  detail: string;
  tone: 'amber' | 'blue' | 'emerald' | 'orange' | 'rose' | 'slate';
  canReceive: boolean;
}

interface IncomingSyncStage {
  sync_error_details?: { postingOutcomeUnknown?: boolean };
  sync_created_at?: string;
  sage_environment?: string;
  sync_status: SageTransferStatus['sync_status'];
  sync_message?: string | null;
  sync_updated_at: string;
  sdk_posted_at?: string | null;
}

interface LineSageStage {
  label: string;
  detail: string;
  className: string;
}

interface MaterialTransferReversal {
  original_transfer_id: string;
  reversal_number: string;
  status: 'pending' | 'processing' | 'posted' | 'failed' | 'cancelled';
  sage_reference?: string | null;
  failure_message?: string | null;
}

interface IncomingBundle {
  key: string;
  transfers: PendingTransfer[];
  pendingTransfers: PendingTransfer[];
  purpose: string;
  requester: string;
  createdAt: string;
  istDate: ReturnType<typeof incomingIstDate>;
  totalQuantity: string;
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
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [sageProductionBalances, setSageProductionBalances] = useState<Record<string, { quantity: number; syncedAt: string | null }>>({});
  const [pendingAcceptanceTransfers, setPendingAcceptanceTransfers] = useState<PendingTransfer[]>([]);
  const [incomingTransfers, setIncomingTransfers] = useState<PendingTransfer[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [receivingBundleKey, setReceivingBundleKey] = useState<string | null>(null);
  const [selectedIncomingBundleKey, setSelectedIncomingBundleKey] = useState<string | null>(null);
  const [hasProcessedIncomingIst, setHasProcessedIncomingIst] = useState(false);
  const [expandedIncomingBundle, setExpandedIncomingBundle] = useState<string | null>(null);
  const [receiptToConfirm, setReceiptToConfirm] = useState<PendingTransfer | null>(null);
  const [receiptNotice, setReceiptNotice] = useState<ReceiptNotice>(null);
  const [loading, setLoading] = useState(true);
  const [pageView, setPageView] = useState<'receiving' | 'stock' | 'sage'>('receiving');
  const [incomingFilter, setIncomingFilter] = useState<'all' | 'awaiting' | 'processed'>('all');
  const [incomingSearch, setIncomingSearch] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [materialSettings, setMaterialSettings] = useState<ProductionMaterialSetting[]>([]);
  const [thresholdDraft, setThresholdDraft] = useState<Record<string, string>>({});
  const [lastAlertSignature, setLastAlertSignature] = useState('');
  const [incomingSyncByTransferId, setIncomingSyncByTransferId] = useState<Record<string, IncomingSyncStage>>({});
  const [incomingReversalsByTransferId, setIncomingReversalsByTransferId] = useState<Record<string, MaterialTransferReversal>>({});
  const [receiptChecksReady, setReceiptChecksReady] = useState(false);
  const [receiptChecksError, setReceiptChecksError] = useState<string | null>(null);
  const [receiptChecksRefreshing, setReceiptChecksRefreshing] = useState(false);
  const refreshInFlight = useRef(false);

  async function fetchTransfers(silent = false) {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setReceiptChecksRefreshing(true);
    if (!silent) setLoading(true);
    try {
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
        .select('id, transfer_number, raw_material_id, quantity, unit, status, transfer_batch_key, purpose, notes, transfer_date, created_at, production_approved_at, receiver:profiles!production_approved_by(full_name), requester:profiles!requested_by(full_name), raw_materials(name, code, unit)')
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
    if (pendingError) throw new Error('Incoming transfer checks failed. Refresh before receiving.');

    setTransfers((smData as any) || []);
    const nextIncomingTransfers = (incomingData as any) || [];
    setIncomingTransfers(nextIncomingTransfers);
    setPendingAcceptanceTransfers(nextIncomingTransfers.filter((transfer: PendingTransfer) => transfer.status === 'in_buffer'));

    const incomingTransferIds = nextIncomingTransfers.map((transfer: PendingTransfer) => transfer.id);
    if (incomingTransferIds.length > 0) {
      const [
        { data: incomingSyncRows, error: incomingSyncError },
        { data: incomingReversalRows, error: incomingReversalsError },
      ] = await Promise.all([
        supabase
          .from('sync_log')
          .select('id, reference_id, status, message, created_at, updated_at, sage_response, error_details')
          .eq('event_type', 'material_transfer_to_production')
          .in('reference_id', incomingTransferIds)
          .in('status', ['success', 'failed', 'pending', 'processing', 'retry'])
          .order('updated_at', { ascending: false }),
        supabase
          .from('material_transfer_reversals')
          .select('original_transfer_id, reversal_number, status, sage_reference, failure_message')
          .in('original_transfer_id', incomingTransferIds)
          .order('requested_at', { ascending: false }),
      ]);
      if (incomingSyncError) {
        console.error('Failed to load incoming transfer stages:', incomingSyncError);
      } else {
        const nextIncomingSync: Record<string, IncomingSyncStage> = {};
        (incomingSyncRows || []).forEach((row: any) => {
          if (!nextIncomingSync[row.reference_id]) {
            nextIncomingSync[row.reference_id] = {
              sync_created_at: row.created_at,
              sync_error_details: row.error_details,
              sage_environment: row.sage_response?.environment,
              sync_status: row.status,
              sync_message: row.message,
              sync_updated_at: row.updated_at,
              sdk_posted_at: row.sage_response?.postedAtUtc || null,
            };
          }
        });
        setIncomingSyncByTransferId(nextIncomingSync);
      }
      if (incomingReversalsError) {
        console.error('Failed to load incoming transfer returns:', incomingReversalsError);
      } else {
        const nextIncomingReversals: Record<string, MaterialTransferReversal> = {};
        (incomingReversalRows || []).forEach((row: MaterialTransferReversal) => {
          if (!nextIncomingReversals[row.original_transfer_id]) {
            nextIncomingReversals[row.original_transfer_id] = row;
          }
        });
        setIncomingReversalsByTransferId(nextIncomingReversals);
      }
      setReceiptChecksReady(!pendingError && !incomingSyncError && !incomingReversalsError);
      setReceiptChecksError(incomingSyncError || incomingReversalsError ? 'Sage queue or return checks failed. Refresh before receiving.' : null);
    } else {
      setIncomingSyncByTransferId({});
      setIncomingReversalsByTransferId({});
      setReceiptChecksReady(!pendingError);
      setReceiptChecksError(null);
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
    } catch (error: any) {
      setReceiptChecksReady(false);
      setReceiptChecksError(error?.message || 'Receipt checks failed. Refresh before receiving.');
    } finally {
      refreshInFlight.current = false;
      setReceiptChecksRefreshing(false);
      if (!silent) setLoading(false);
    }
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
        message: `${transfer.raw_materials?.name || 'Material'} received locally in PD. Sage posting is queued and not yet confirmed.`,
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_transfer_reversals' }, () => {
        fetchTransfers(true);
      })
      .subscribe();

    const intervalId = window.setInterval(() => {
      fetchTransfers(true);
    }, 60000);

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
  const totalSagePdQty = transferQuantitySummary(aggregated.map(material => ({ quantity: Math.max(0, material.sage_pd_quantity || 0), unit: material.unit })));
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
  const pendingReceiptQuantity = transferQuantitySummary(pendingAcceptanceTransfers);
  const incomingBundles = useMemo<IncomingBundle[]>(() => {
    const groups = new Map<string, PendingTransfer[]>();
    incomingTransfers.forEach((transfer) => {
      const dateKey = incomingIstDate([transfer]).value || 'missing-ist-date';
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
      istDate: incomingIstDate(group),
      totalQuantity: transferQuantitySummary(group),
    }));
  }, [incomingTransfers]);
  const visibleIncomingBundles = useMemo(() => incomingBundles.filter((bundle) => {
    if (incomingFilter === 'awaiting' && bundle.pendingTransfers.length === 0) return false;
    if (incomingFilter === 'processed' && bundle.pendingTransfers.length > 0) return false;
    const query = incomingSearch.trim().toLowerCase();
    if (!query) return true;
    return [bundle.purpose, ...bundle.transfers.flatMap((transfer) => [
      transfer.transfer_number,
      incomingReversalsByTransferId[transfer.id]?.sage_reference || '',
    ])].some((reference) => reference.toLowerCase().includes(query));
  }), [incomingBundles, incomingFilter, incomingSearch, incomingReversalsByTransferId]);
  const expandedIncomingBundleData = useMemo(
    () => incomingBundles.find((bundle) => bundle.key === expandedIncomingBundle) || null,
    [incomingBundles, expandedIncomingBundle],
  );
  const getIncomingStage = (bundle: IncomingBundle): IncomingStage => {
    const waitingLines = bundle.pendingTransfers;
    if (waitingLines.length > 0) {
      if (!receiptChecksReady) return receiptChecksError
        ? { label: 'Receipt checks unavailable', detail: receiptChecksError, tone: 'rose', canReceive: false }
        : { label: 'Checking receipt', detail: 'Loading transfer, Sage queue and return checks.', tone: 'slate', canReceive: false };
      const blockReason = incomingReceiptBlockReason(waitingLines, incomingSyncByTransferId, incomingReversalsByTransferId);
      if (blockReason) return { label: 'Verify outstanding lines', detail: blockReason, tone: 'rose', canReceive: false };
      if (waitingLines.length !== bundle.transfers.length) {
        return { label: 'Partly received', detail: `${waitingLines.length} line${waitingLines.length === 1 ? '' : 's'} remain in Buffer. Resume receives only these lines; already received lines are excluded.`, tone: 'amber', canReceive: true };
      }
      return { label: 'Ready for production receipt', detail: 'All lines are allocated in Buffer and can now be received into Production Warehouse 19.', tone: 'amber', canReceive: true };
    }

    const returnLines = bundle.transfers
      .map((transfer) => incomingReversalsByTransferId[transfer.id])
      .filter(Boolean) as MaterialTransferReversal[];
    const completedReturns = returnLines.filter((reversal) => reversal.status === 'posted');
    if (completedReturns.length > 0) {
      const isWholeBundleReturned = completedReturns.length === bundle.transfers.length;
      return {
        label: isWholeBundleReturned ? 'Returned to RM' : 'Contains return to RM',
        detail: `${completedReturns.length} material${completedReturns.length === 1 ? '' : 's'} in this IST ${completedReturns.length === 1 ? 'was' : 'were'} Sage-confirmed as returned from Production to RM.`,
        tone: 'orange',
        canReceive: false,
      };
    }

    const syncLines = bundle.transfers.map((transfer) => incomingSyncByTransferId[transfer.id]).filter(Boolean);
    if (syncLines.some((sync) => sync.sync_status === 'failed' && sync.sync_error_details?.postingOutcomeUnknown)) {
      return { label: 'Sage outcome unknown: verify', detail: 'A posting response was lost or could not be recorded. Check Sage before retrying; the movement may already exist.', tone: 'rose', canReceive: false };
    }
    if (syncLines.some((sync) => sync.sync_status === 'failed')) {
      const failed = syncLines.find((sync) => sync.sync_status === 'failed');
      return { label: 'Sage posting failed', detail: failed?.sync_message || 'The RM to PD Sage posting failed and needs review.', tone: 'rose', canReceive: false };
    }
    const stages = syncLines.map((sync) => transferSyncStatus({ status: sync.sync_status, created_at: sync.sync_created_at, updated_at: sync.sync_updated_at, sage_response: { environment: sync.sage_environment } }));
    const delayed = stages.find((stage) => stage.delayed);
    const confirmedCount = stages.filter((stage) => stage.confirmed).length;
    if (delayed) return { label: delayed.label, detail: `PD received locally. ${confirmedCount}/${bundle.transfers.length} lines have Sage confirmation. Queue age exceeds five minutes; check bridge status before retrying.`, tone: 'rose', canReceive: false };
    if (syncLines.some((sync) => sync.sage_environment && sync.sage_environment.toLowerCase() !== 'production')) {
      return { label: 'Verify Production posting', detail: 'A response identifies a different Sage environment. Do not assume Production is posted or replay the transfer.', tone: 'amber', canReceive: false };
    }
    if (syncLines.some((sync) => sync.sync_status === 'processing')) {
      return { label: 'Processing: Sage not confirmed', detail: `PD received locally. ${confirmedCount}/${bundle.transfers.length} lines have Sage confirmation.`, tone: 'blue', canReceive: false };
    }
    if (syncLines.some((sync) => ['pending', 'retry'].includes(sync.sync_status))) {
      return { label: 'Queued: Sage not confirmed', detail: `PD received locally. ${confirmedCount}/${bundle.transfers.length} lines have Sage confirmation.`, tone: 'amber', canReceive: false };
    }
    if (syncLines.length === bundle.transfers.length && syncLines.every((sync) => sync.sync_status === 'success')) {
      return { label: 'Posted RM to PD', detail: 'Production receipt and the Sage RM to PD warehouse transfer are complete.', tone: 'emerald', canReceive: false };
    }
    return { label: 'Received: awaiting Sage queue', detail: 'Production receipt is complete; waiting for the Sage posting event to be created.', tone: 'slate', canReceive: false };
  };
  const stockHealth = useMemo(() => {
    const critical = aggregated.filter((m) => m.production_reorder_level > 0 && Number(m.sage_pd_quantity || 0) === 0);
    const low = aggregated.filter((m) => m.production_reorder_level > 0 && Number(m.sage_pd_quantity || 0) > 0 && Number(m.sage_pd_quantity || 0) <= m.production_reorder_level);
    return { critical, low, healthy: aggregated.length - critical.length - low.length };
  }, [aggregated]);
  const floorReadiness = totalMaterials ? Math.round((stockHealth.healthy / totalMaterials) * 100) : 100;
  const movedThisWeek = transferQuantitySummary(transfers
    .filter((transfer) => Date.now() - new Date(transfer.movement_date || transfer.created_at).getTime() <= 7 * 24 * 60 * 60 * 1000));
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


  async function handleReceiveBundle(bundle: IncomingBundle) {
    if (receivingBundleKey) return;
    if (refreshInFlight.current) {
      setReceiptNotice({ tone: 'error', message: 'Receipt checks are refreshing. Wait for them to finish before receiving.' });
      return;
    }
    const stage = getIncomingStage(bundle);
    if (!stage.canReceive) {
      setReceiptNotice({ tone: 'error', message: stage.detail });
      return;
    }
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


  const getLineSageStage = (transfer: PendingTransfer): LineSageStage => {
    const reversal = incomingReversalsByTransferId[transfer.id];
    if (reversal?.status === 'posted') {
      return { label: 'Returned to RM', detail: `Sage confirmed the PD to RM return${reversal.sage_reference ? ` as ${reversal.sage_reference}` : ''}.`, className: 'border-orange-200 bg-orange-50 text-orange-700' };
    }
    if (reversal?.status === 'failed') {
      return { label: 'Return failed', detail: reversal.failure_message || 'The PD to RM return needs attention.', className: 'border-rose-200 bg-rose-50 text-rose-700' };
    }
    if (reversal?.status === 'processing') {
      return { label: 'Returning to RM', detail: 'The Sage bridge is posting this PD to RM return now.', className: 'border-sky-200 bg-sky-50 text-sky-700' };
    }
    if (reversal?.status === 'pending') {
      return { label: 'Return queued', detail: 'This PD to RM return is queued for Sage posting.', className: 'border-amber-200 bg-amber-50 text-amber-800' };
    }
    if (transfer.status !== 'received') {
      return { label: 'Awaiting receipt', detail: 'This line has not yet been received into Production Warehouse.', className: 'border-amber-200 bg-amber-50 text-amber-800' };
    }
    const sync = incomingSyncByTransferId[transfer.id];
    if (!sync) {
      return { label: 'Awaiting Sage queue', detail: 'Production receipt is complete; waiting for the Sage posting event.', className: 'border-slate-200 bg-slate-50 text-slate-700' };
    }
    const stage = transferSyncStatus({ status: sync.sync_status, created_at: sync.sync_created_at, updated_at: sync.sync_updated_at, sage_response: { environment: sync.sage_environment }, error_details: sync.sync_error_details });
    if (stage.delayed || sync.sync_error_details?.postingOutcomeUnknown || (sync.sync_status === 'success' && !stage.confirmed)) {
      return { label: stage.label, detail: 'PD receipt is recorded locally. Production Sage posting requires verification; do not blindly retry.', className: 'border-rose-200 bg-rose-50 text-rose-700' };
    }
    if (sync.sync_status === 'success') {
      return { label: 'Posted to Sage', detail: sync.sync_message || 'This RM to PD transfer was posted to Sage.', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
    }
    if (sync.sync_status === 'failed') {
      return { label: 'Sage failed', detail: sync.sync_message || 'Sage posting failed for this material.', className: 'border-rose-200 bg-rose-50 text-rose-700' };
    }
    if (sync.sync_status === 'processing') {
      return { label: 'Posting to Sage', detail: sync.sync_message || 'The Sage bridge is posting this material now.', className: 'border-sky-200 bg-sky-50 text-sky-700' };
    }
    return { label: sync.sync_status === 'retry' ? 'Retry queued' : 'Queued for Sage', detail: sync.sync_message || 'This material is queued for Sage posting.', className: 'border-amber-200 bg-amber-50 text-amber-800' };
  };

  const getLineSageReference = (transfer: PendingTransfer) => {
    const reversal = incomingReversalsByTransferId[transfer.id];
    return reversal?.sage_reference || transfer.transfer_number || 'Awaiting Sage reference';
  };

  return (
    <div className="production-workspace mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
      <section className="warehouse-heading flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="warehouse-heading-tag">Hyperfeeds Production</span>
            <span className="warehouse-heading-live"><Radio className="h-3 w-3" /> Live Sage</span>
          </div>
          <h1 className="mt-3 text-2xl font-bold">Production Warehouse</h1>
          <p className="mt-1 text-sm text-slate-300">Warehouse 19 · {totalMaterials} materials available for production</p>
        </div>
        <button
          onClick={() => fetchTransfers()}
          className="warehouse-refresh flex items-center gap-2 px-4 py-2.5 text-sm font-semibold"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </section>

      <nav className="warehouse-tabs" aria-label="Production warehouse views">
        <button type="button" onClick={() => setPageView('receiving')} className={`warehouse-tab ${pageView === 'receiving' ? 'is-active' : ''}`}>
          <span className="warehouse-tab-icon"><Truck className="h-4 w-4" /></span>
          <span><strong>Receiving</strong><small>{pendingAcceptanceTransfers.length} awaiting receipt</small></span>
        </button>
        <button type="button" onClick={() => setPageView('stock')} className={`warehouse-tab ${pageView === 'stock' ? 'is-active' : ''}`}>
          <span className="warehouse-tab-icon"><Package className="h-4 w-4" /></span>
          <span><strong>Floor stock</strong><small>Warehouse 19 balances</small></span>
        </button>
        <button type="button" onClick={() => setPageView('sage')} className={`warehouse-tab ${pageView === 'sage' ? 'is-active' : ''}`}>
          <span className="warehouse-tab-icon"><Radio className="h-4 w-4" /></span>
          <span><strong>Sage activity</strong><small>Posting and transfer audit</small></span>
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
          <div className="incoming-table-tools flex flex-wrap items-center justify-between gap-3 border-b border-teal-100 px-5 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <Truck className="h-4 w-4 text-teal-700" />
              <span className="font-bold text-slate-800">Incoming ISTs</span>
              <span className="border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-700">{pendingAcceptanceTransfers.length} ready</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div className="relative w-full sm:w-64">
                <label htmlFor="incoming-ist-search" className="sr-only">Search loaded ISTs by Sage IST or line reference</label>
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input id="incoming-ist-search" type="search" value={incomingSearch} onChange={(event) => setIncomingSearch(event.target.value)} placeholder="Search Sage IST number..." className="w-full rounded-md border border-teal-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="incoming-status-filter" className="sr-only">Show incoming ISTs</label>
                <select id="incoming-status-filter" value={incomingFilter} onChange={(event) => setIncomingFilter(event.target.value as typeof incomingFilter)} className="border border-teal-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 focus:border-teal-500 focus:outline-none">
                  <option value="awaiting">Awaiting receipt</option>
                  <option value="processed">Processed</option>
                  <option value="all">All ISTs</option>
                </select>
              </div>
              <div className="incoming-queue-total text-right">
                <p className="font-mono text-lg font-bold text-slate-900">{pendingReceiptQuantity}</p>
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
          <div className="incoming-column-header hidden border-b border-slate-200 bg-slate-50 px-5 py-2 xl:grid xl:grid-cols-[40px_minmax(96px,.8fr)_104px_180px_minmax(100px,.8fr)_154px_118px_92px_112px] xl:items-center xl:gap-3">
            <span />
            <span>IST</span>
            <span>Materials</span>
            <span>Status</span>
            <span>Requested by</span>
            <span>IST date</span>
            <span className="text-right">Transfer total</span>
            <span>Sage refs</span>
            <span className="text-right">Action</span>
          </div>
          </div>

          <div className="divide-y divide-teal-100 px-5">
            {visibleIncomingBundles.map((bundle) => {
              const isOpen = expandedIncomingBundle === bundle.key;
              const isReceiving = receivingBundleKey === bundle.key;
              const stage = getIncomingStage(bundle);
              const stageClassName = stage.tone === 'rose'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : stage.tone === 'blue'
                  ? 'border-sky-200 bg-sky-50 text-sky-700'
                  : stage.tone === 'orange'
                    ? 'border-orange-200 bg-orange-50 text-orange-700'
                  : stage.tone === 'emerald'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : stage.tone === 'slate'
                      ? 'border-slate-200 bg-slate-50 text-slate-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800';
              return (
                <div key={bundle.key} className={`incoming-bundle py-3 ${selectedIncomingBundleKey && selectedIncomingBundleKey !== bundle.key ? 'opacity-60' : ''}`}>
                  <div className="warehouse-ist-row incoming-bundle-summary grid gap-3 xl:grid-cols-[40px_minmax(96px,.8fr)_104px_180px_minmax(100px,.8fr)_154px_118px_92px_112px] xl:items-center">
                    <button type="button" onClick={() => setExpandedIncomingBundle(isOpen ? null : bundle.key)} className="incoming-expand-button flex h-8 w-8 items-center justify-center border border-teal-200 bg-teal-50 text-teal-700" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${bundle.purpose || 'incoming IST'}`}>
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                        <button type="button" onClick={() => setExpandedIncomingBundle(isOpen ? null : bundle.key)} className="min-w-0 text-left" title="Show full IST details">
                      <p className="truncate font-mono text-sm font-bold text-slate-900">{bundle.purpose || 'Raw Materials to Production'}</p>
                    </button>
                    <span className="incoming-material-count border border-amber-200 bg-amber-50 px-2 py-0.5 text-center text-xs font-semibold text-amber-800">{bundle.transfers.length} materials</span>
                    <span title={stage.detail} className={`incoming-status min-w-0 whitespace-normal border px-2 py-0.5 text-center text-xs font-semibold leading-4 ${stageClassName}`}>{stage.label}</span>
                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600"><UserRound className="h-3.5 w-3.5 text-slate-400" />{bundle.requester}</span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><Calendar className="h-3.5 w-3.5 text-slate-400" />{bundle.istDate.label}</span>
                    <div className="incoming-bundle-quantity text-right">
                      <p className="font-mono text-sm font-bold text-slate-900">{bundle.totalQuantity}</p>
                    </div>
                    <span className="font-mono text-[11px] text-slate-600" title={bundle.transfers.map(getLineSageReference).join('\n')}>
                      {bundle.transfers.length === 1 ? getLineSageReference(bundle.transfers[0]) : `${bundle.transfers.length} line refs`}
                    </span>
                    <div className="incoming-action flex justify-end">
                    {canApproveMaterialTransfer && stage.canReceive && (
                      selectedIncomingBundleKey === bundle.key ? (
                        <button type="button" title={`Receive only ${bundle.pendingTransfers.length} outstanding lines into Production`} disabled={Boolean(receivingBundleKey) || receiptChecksRefreshing} onClick={() => handleReceiveBundle(bundle)} className="inline-flex min-h-10 items-center justify-center gap-2 bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-wait">
                          {isReceiving ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing</> : <><CheckCircle2 className="h-4 w-4" />{bundle.pendingTransfers.length < bundle.transfers.length ? `Receive ${bundle.pendingTransfers.length}` : 'Approve'}</>}
                        </button>
                      ) : (
                      <button type="button" title={hasProcessedIncomingIst ? 'Select the next IST to approve' : 'Select this IST for approval'} disabled={Boolean(selectedIncomingBundleKey) || receiptChecksRefreshing} onClick={() => setSelectedIncomingBundleKey(bundle.key)} className="inline-flex min-h-10 items-center justify-center gap-2 border border-teal-300 bg-white px-3 py-2 text-sm font-semibold text-teal-800 transition-colors hover:bg-teal-50 disabled:cursor-not-allowed">
                          <CheckCircle2 className="h-4 w-4" /> {bundle.pendingTransfers.length < bundle.transfers.length ? `Resume ${bundle.pendingTransfers.length}` : hasProcessedIncomingIst ? 'Next' : 'Select'}
                        </button>
                      )
                    )}
                    {stage.tone === 'rose' && (
                      <span title={stage.detail} className="text-right text-xs font-semibold text-rose-700">Blocked</span>
                    )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {visibleIncomingBundles.length === 0 && (
            <div className="border-t border-teal-100 px-5 py-10 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-2 text-sm font-bold text-slate-800">{incomingSearch.trim() ? 'No matching ISTs in the loaded records' : 'No ISTs in this view'}</p>
            </div>
          )}
        </section>
      )}

      {pageView === 'sage' && <SageTransferHistory />}

      {expandedIncomingBundleData && (() => {
        const stage = getIncomingStage(expandedIncomingBundleData);
        const stageClassName = stage.tone === 'rose'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : stage.tone === 'blue'
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : stage.tone === 'orange'
              ? 'border-orange-200 bg-orange-50 text-orange-700'
            : stage.tone === 'emerald'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : stage.tone === 'slate'
                ? 'border-slate-200 bg-slate-50 text-slate-700'
                : 'border-amber-200 bg-amber-50 text-amber-800';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="ist-detail-title">
            <section className="flex h-[calc(100vh-1.5rem)] w-full max-w-[1500px] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:h-[calc(100vh-2.5rem)]">
              <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-950 px-5 py-3 text-white sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-teal-400/30 bg-teal-400/10 text-teal-300"><Truck className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-teal-300">Internal stock transfer</p>
                    <h2 id="ist-detail-title" className="mt-0.5 truncate font-mono text-lg font-bold">{expandedIncomingBundleData.purpose || 'Raw Materials to Production'}</h2>
                  </div>
                </div>
                <button type="button" onClick={() => setExpandedIncomingBundle(null)} className="flex h-9 w-9 shrink-0 items-center justify-center border border-slate-600 text-slate-200 hover:bg-slate-800" aria-label="Close IST details"><X className="h-5 w-5" /></button>
              </header>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs text-slate-600">
                <span><strong className="mr-1 text-slate-900">Requested by:</strong>{expandedIncomingBundleData.requester}</span>
                <span><strong className="mr-1 text-slate-900">IST date:</strong>{expandedIncomingBundleData.istDate.label}</span>
                <span><strong className="mr-1 text-slate-900">Created:</strong>{format(new Date(expandedIncomingBundleData.createdAt), 'dd MMM yyyy, HH:mm')}</span>
                <span><strong className="mr-1 text-slate-900">Total:</strong><span className="font-mono font-bold text-slate-900">{expandedIncomingBundleData.transfers.length} lines | {expandedIncomingBundleData.totalQuantity}</span></span>
                <span title={stage.detail} className={`inline-flex border px-2 py-1 text-[11px] font-semibold ${stageClassName}`}>{stage.label}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-4">
                <div className="overflow-hidden border border-slate-200 bg-slate-200">
                  <div className="grid gap-px xl:grid-cols-2">
                    {expandedIncomingBundleData.transfers.map((transfer) => {
                      const lineStage = getLineSageStage(transfer);
                      const sync = incomingSyncByTransferId[transfer.id];
                      const postingTime = sync?.sdk_posted_at || sync?.sync_updated_at;
                      return (
                        <div key={transfer.id} className="min-w-0 bg-white px-4 py-3">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">{transfer.raw_materials?.name || 'Raw material'}</p>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500"><span className="text-teal-700">{transfer.raw_materials?.code || 'No Sage code'}</span><span className="mx-1 text-slate-300">|</span>{transfer.transfer_number}</p>
                          </div>
                          <p className="truncate font-mono text-[11px] text-slate-600" title={getLineSageReference(transfer)}>{getLineSageReference(transfer)}</p>
                          <div className="flex shrink-0 items-center gap-2">
                            <span title={lineStage.detail} className={`inline-flex max-w-[118px] truncate border px-2 py-1 text-[10px] font-semibold ${lineStage.className}`}>{lineStage.label}</span>
                            <span className="whitespace-nowrap text-right font-mono text-xs font-bold text-slate-900">{Number(transfer.quantity).toLocaleString()} {transfer.unit}</span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
                          <span><strong>PD received by:</strong> {transfer.status === 'in_buffer' ? 'Awaiting receipt' : transfer.receiver?.full_name || 'Not recorded / unavailable'}</span>
                          {transfer.production_approved_at && !Number.isNaN(Date.parse(transfer.production_approved_at)) && <span><strong>PD received:</strong> {format(new Date(transfer.production_approved_at), 'dd MMM yyyy, HH:mm:ss')}</span>}
                          {sync && postingTime && !Number.isNaN(Date.parse(postingTime)) && <span><strong>{sync.sync_status === 'success' ? (sync.sdk_posted_at ? 'SDK posting completed:' : 'Bridge confirmed Sage posting:') : 'Sage status updated:'}</strong> {format(new Date(postingTime), 'dd MMM yyyy, HH:mm:ss')}</span>}
                          {!sync && <span><strong>Sage:</strong> {transfer.status === 'in_buffer' ? 'Not queued until PD receipt' : 'No posting confirmation available'}</span>}
                        </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          </div>
        );
      })()}

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
      <section className="floor-summary-grid grid gap-px overflow-hidden border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Floor readiness</p><Activity className="h-4 w-4 text-emerald-600" /></div><p className="mt-2 text-2xl font-bold text-slate-900">{floorReadiness}%</p><p className="mt-1 text-xs text-slate-500">{stockHealth.healthy} of {totalMaterials} materials above minimum</p></div>
        <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Sage production available</p><Package className="h-4 w-4 text-emerald-600" /></div><p className="mt-2 text-2xl font-bold text-emerald-700">{totalSagePdQty}</p><p className="mt-1 text-xs text-slate-500">Warehouse 19 live balance</p></div>
        <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Moved this week</p><ArrowUpRight className="h-4 w-4 text-teal-600" /></div><p className="mt-2 text-2xl font-bold text-slate-900">{movedThisWeek}</p><p className="mt-1 text-xs text-slate-500">{recentCount} materials received on floor</p></div>
        <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Inbound queue</p><Truck className="h-4 w-4 text-amber-600" /></div><p className="mt-2 text-2xl font-bold text-slate-900">{pendingReceiptQuantity}</p><p className="mt-1 text-xs text-slate-500">{pendingAcceptanceTransfers.length} transfer{pendingAcceptanceTransfers.length === 1 ? '' : 's'} awaiting receipt</p></div>
      </section>

      <section className={`floor-health-banner flex flex-wrap items-center justify-between gap-3 border-l-4 px-4 py-3 ${stockHealth.critical.length ? 'border-rose-500 bg-rose-50' : stockHealth.low.length ? 'border-amber-500 bg-amber-50' : 'border-emerald-500 bg-emerald-50'}`}>
        <div className="flex items-center gap-3"><AlertTriangle className={`h-5 w-5 ${stockHealth.critical.length ? 'text-rose-600' : stockHealth.low.length ? 'text-amber-600' : 'text-emerald-600'}`} /><div><p className="text-sm font-bold text-slate-900">{stockHealth.critical.length ? 'Production stock requires attention' : stockHealth.low.length ? 'Production stock is below minimum' : 'Production stock position healthy'}</p><p className="text-xs text-slate-600">Sage Production 19 last synced {lastSagePdSync ? format(new Date(lastSagePdSync), 'dd MMM, HH:mm:ss') : 'awaiting first sync'}.</p></div></div>
        {(stockHealth.critical.length || stockHealth.low.length) > 0 && <div className="flex flex-wrap gap-2">{[...stockHealth.critical, ...stockHealth.low].slice(0, 3).map((m) => <span key={m.raw_material_id} className="border border-white bg-white px-2 py-1 text-xs font-semibold text-slate-700">{m.name}: {formatWarehouseQuantity(Number(m.sage_pd_quantity || 0))} / {formatWarehouseQuantity(m.production_reorder_level)} {m.unit}</span>)}</div>}
      </section>

      <section className="floor-overview-grid grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="floor-panel border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Floor availability</p><h2 className="mt-1 text-base font-bold text-slate-900">Largest Sage Production balances</h2></div><BarChart3 className="h-5 w-5 text-teal-600" /></div>
          <div className="divide-y divide-slate-100 px-5">
            {topFloorMaterials.length ? topFloorMaterials.map((material) => {
              const quantity = Number(material.sage_pd_quantity || 0);
              const width = Math.max(3, Math.round((quantity / largestFloorBalance) * 100));
              return <div key={material.raw_material_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-5 py-3"><div className="min-w-0"><div className="flex items-baseline justify-between gap-3"><p className="truncate text-sm font-semibold text-slate-800">{material.name}</p><span className="font-mono text-xs text-slate-500">{material.code}</span></div><div className="mt-2 h-1.5 overflow-hidden bg-slate-100"><div className="h-full bg-teal-600" style={{ width: `${width}%` }} /></div></div><p className="self-center text-right font-mono text-sm font-bold text-emerald-700">{formatWarehouseQuantity(quantity)} <span className="text-xs font-medium text-slate-500">{material.unit}</span></p></div>;
            }) : <p className="py-8 text-sm text-slate-500">Awaiting Production Warehouse 19 stock data.</p>}
          </div>
        </div>
        <div className="floor-panel border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recent activity</p><h2 className="mt-1 text-base font-bold text-slate-900">Latest floor receipts</h2></div><Calendar className="h-5 w-5 text-slate-500" /></div>
          <div className="divide-y divide-slate-100 px-5">
            {recentFloorActivity.length ? recentFloorActivity.map((transfer) => <div key={transfer.id} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{transfer.raw_materials?.name || 'Raw material'}</p><p className="mt-0.5 font-mono text-xs text-slate-500">{transfer.batch_number || 'No batch'} · {format(new Date(transfer.movement_date || transfer.created_at), 'dd MMM, HH:mm')}</p></div><p className="shrink-0 text-right font-mono text-sm font-bold text-slate-800">{Number(transfer.quantity).toLocaleString()}<span className="ml-1 text-xs font-medium text-slate-500">{transfer.unit}</span></p></div>) : <p className="py-8 text-sm text-slate-500">No floor receipts recorded yet.</p>}
          </div>
        </div>
      </section>

      <div className="floor-inventory-panel bg-white rounded-xl border border-slate-200 shadow-sm">
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
