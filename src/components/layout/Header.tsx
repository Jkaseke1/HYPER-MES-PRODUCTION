import { useEffect, useRef, useState } from 'react';
import { Bell, Loader2, Search, Menu, Sparkles, RefreshCw, AlertTriangle, CheckCircle2, Radio, Info, Clock, ArrowRightLeft, PackageCheck, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import NetworkStatusBadge from '../ui/NetworkStatusBadge';
import { UPDATE_CHANNEL_NAME, UPDATE_EVENT_NAME, SystemUpdatePayload, fetchRecentSystemUpdates, fetchPendingUpdates, SystemUpdateLogRecord } from '../../lib/updateManager';
import { APP_VERSION } from '../../config/version';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface NotificationItem {
  id: string;
  section: string;
  observation: string;
  severity: 'info' | 'warning' | 'critical';
  created_at: string;
}

interface SageQueueItem {
  id: string;
  event_type: string;
  reference_id: string | null;
  status: 'pending' | 'processing' | 'failed' | 'success';
  message: string | null;
  updated_at: string;
  last_failure_message?: string | null;
  retried_at?: string | null;
  resolved_at?: string | null;
}

interface IncomingProductionTransfer {
  id: string;
  transfer_number: string;
  quantity: number;
  unit: string;
  created_at: string;
  raw_materials?: { name?: string | null; code?: string | null } | null;
}

const sageEventLabels: Record<string, string> = {
  grn_confirmed: 'Goods receipt / GRV',
  material_transfer_to_production: 'Material transfer to Production',
  materials_issued: 'Material issue to Production',
  production_completed: 'Production completion',
  finished_goods_transfer_to_dispatch: 'Finished-goods transfer to Dispatch',
  dispatch_delivered: 'Dispatch delivery',
};

interface HeaderProps {
  title: string;
  onMobileMenuToggle?: () => void;
}

export default function Header({ title, onMobileMenuToggle }: HeaderProps) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const [sageQueue, setSageQueue] = useState<SageQueueItem[]>([]);
  const [loadingSageQueue, setLoadingSageQueue] = useState(true);
  const [incomingProductionTransfers, setIncomingProductionTransfers] = useState<IncomingProductionTransfer[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<HTMLDivElement>(null);
  const incomingTransfersLoadedRef = useRef(false);
  const knownIncomingTransferIdsRef = useRef<Set<string>>(new Set());
  const sageQueueLoadedRef = useRef(false);
  const knownSageStagesRef = useRef<Map<string, string>>(new Map());

  // System Update state
  const [softUpdate, setSoftUpdate] = useState<SystemUpdatePayload | null>(null);
  const [pendingUpdates, setPendingUpdates] = useState<SystemUpdateLogRecord[]>([]);
  const [forceUpdateModal, setForceUpdateModal] = useState<SystemUpdatePayload | null>(null);
  const [countdown, setCountdown] = useState<number>(5);
  const [updateMenuOpen, setUpdateMenuOpen] = useState(false);

  async function handleApplyAllUpdates() {
    try {
      toast.success('Installing latest MES update & refreshing application...');
    } catch (e) {}

    try {
      pendingUpdates.forEach((up) => {
        const cleanVer = (up.version || '').trim().toLowerCase().replace('v', '');
        localStorage.setItem(`hyper_mes_applied_${cleanVer}`, 'true');
        if (up.id) {
          localStorage.setItem(`hyper_mes_applied_${up.id}`, 'true');
          localStorage.setItem('hyper_mes_installed_sha', up.id);
        }
        if (up.version && up.version.includes('-')) {
          const shaPart = up.version.split('-').pop();
          if (shaPart) {
            localStorage.setItem(`hyper_mes_applied_${shaPart}`, 'true');
          }
        }
      });
      if (softUpdate) {
        const cleanVer = (softUpdate.version || '').trim().toLowerCase().replace('v', '');
        localStorage.setItem(`hyper_mes_applied_${cleanVer}`, 'true');
        if (softUpdate.version && softUpdate.version.includes('-')) {
          const shaPart = softUpdate.version.split('-').pop();
          if (shaPart) {
            localStorage.setItem(`hyper_mes_applied_${shaPart}`, 'true');
          }
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (e) {
      console.warn('Error clearing caches on update apply:', e);
    } finally {
      const cleanUrl = window.location.origin + window.location.pathname;
      window.location.href = `${cleanUrl}?v=${Date.now()}${window.location.hash}`;
    }
  }

  function showSageActivityToast(item: SageQueueItem) {
    const label = sageEventLabels[item.event_type] || item.event_type.replace(/_/g, ' ');
    const isFailed = item.status === 'failed';
    const isPosted = item.status === 'success';
    const isProcessing = item.status === 'processing';
    const title = isFailed ? 'Sage posting needs attention' : isPosted ? 'Posted to Sage' : isProcessing ? 'Processing in Sage' : 'Queued for Sage';
    const detail = isFailed
      ? item.message || item.last_failure_message || 'The Sage bridge could not complete this transaction.'
      : isPosted
        ? item.message || 'The Sage document is ready.'
        : item.message || 'Waiting for the Sage bridge.';
    const tone = isFailed ? 'bg-rose-500' : isPosted ? 'bg-emerald-500' : isProcessing ? 'bg-blue-500' : 'bg-amber-500';
    const iconTone = isFailed ? 'bg-rose-50 text-rose-700' : isPosted ? 'bg-emerald-50 text-emerald-700' : isProcessing ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700';

    toast.custom((notification) => (
      <div className="w-[390px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className={`h-1 ${tone}`} />
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${iconTone}`}>
              {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : isPosted ? <CheckCircle2 className="h-5 w-5" /> : isFailed ? <AlertTriangle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</p>
                <button type="button" onClick={() => toast.dismiss(notification.id)} className="text-xs font-medium text-slate-400 hover:text-slate-700">Dismiss</button>
              </div>
              <p className="mt-1 text-sm font-bold text-slate-900">{label}</p>
              <p className="mt-0.5 text-xs text-slate-600">{detail}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(notification.id);
              navigate('/sync-log');
            }}
            className="mt-3 flex w-full items-center justify-between rounded-md bg-[#0b0b30] px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#171750]"
          >
            View Sage activity <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    ), { duration: isProcessing ? 5500 : 7500 });
  }

  useEffect(() => {
    async function checkForUpdates() {
      try {
        const pending = await fetchPendingUpdates();
        setPendingUpdates(pending);
        if (pending && pending.length > 0) {
          const latest = pending[0];
          setSoftUpdate({
            type: 'soft_update',
            version: latest.version,
            message: latest.message,
            timestamp: latest.timestamp,
            admin_email: latest.admin_email,
          });
        } else {
          setSoftUpdate(null);
        }
      } catch (e) {
        console.warn('Error checking initial updates in Header:', e);
      }
    }

    checkForUpdates();

    const channel = supabase
      .channel(UPDATE_CHANNEL_NAME)
      .on('broadcast', { event: UPDATE_EVENT_NAME }, (response) => {
        const payload: SystemUpdatePayload = response.payload;
        if (payload.type === 'soft_update') {
          checkForUpdates();
        } else if (payload.type === 'force_update') {
          setForceUpdateModal(payload);
          setCountdown(5);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const receivingRoles = ['admin', 'production_manager', 'supervisor', 'operator', 'logistics', 'finance', 'accountant'];
    if (!receivingRoles.includes(profile?.role || '')) {
      setIncomingProductionTransfers([]);
      return;
    }

    let isMounted = true;
    async function loadIncomingTransfers() {
      const { data, error } = await supabase
        .from('material_transfers')
        .select('id, transfer_number, quantity, unit, created_at, raw_materials(name, code)')
        .eq('status', 'in_buffer')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Unable to load incoming Production transfers:', error.message);
        return;
      }
      if (!isMounted) return;

      const nextTransfers = (data || []) as IncomingProductionTransfer[];
      const nextIds = new Set(nextTransfers.map((transfer) => transfer.id));
      const newTransfers = nextTransfers.filter((transfer) => !knownIncomingTransferIdsRef.current.has(transfer.id));
      const isInitialLoad = !incomingTransfersLoadedRef.current;
      knownIncomingTransferIdsRef.current = nextIds;
      incomingTransfersLoadedRef.current = true;
      setIncomingProductionTransfers(nextTransfers);

      if (!isInitialLoad && newTransfers.length > 0) {
        const transfer = newTransfers[0];
        toast.custom((notification) => (
          <div className="w-[390px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="h-1 bg-teal-500" />
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200">
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-teal-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Incoming to Production
                    </p>
                    <button type="button" onClick={() => toast.dismiss(notification.id)} className="text-xs font-medium text-slate-400 hover:text-slate-700">Dismiss</button>
                  </div>
                  <p className="mt-1 truncate text-sm font-bold text-slate-900">{transfer.raw_materials?.name || 'Raw material ready'}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">{transfer.transfer_number}{transfer.raw_materials?.code ? ` · ${transfer.raw_materials.code}` : ''}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">From</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-700">Raw Materials</p>
                </div>
                <ArrowRightLeft className="h-4 w-4 text-teal-600" />
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ready to receive</p>
                  <p className="mt-0.5 font-mono text-sm font-bold text-slate-900">{Number(transfer.quantity).toLocaleString()} {transfer.unit}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  toast.dismiss(notification.id);
                  navigate('/production-warehouse');
                }}
                className="mt-3 flex w-full items-center justify-between rounded-md bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                Open receiving <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ), { duration: 9000 });
      }
    }

    loadIncomingTransfers();
    const channel = supabase
      .channel('header-production-incoming-transfers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_transfers' }, loadIncomingTransfers)
      .subscribe();

    return () => {
      isMounted = false;
      incomingTransfersLoadedRef.current = false;
      knownIncomingTransferIdsRef.current = new Set();
      supabase.removeChannel(channel);
    };
  }, [navigate, profile?.role]);

  useEffect(() => {
    let isMounted = true;

    async function loadSageQueue() {
      const { data, error } = await supabase
        .from('sync_log')
        .select('id, event_type, reference_id, status, message, updated_at, last_failure_message, retried_at, resolved_at')
        .in('status', ['pending', 'processing', 'failed', 'success'])
        .order('updated_at', { ascending: false })
        .limit(60);

      if (error) {
        console.warn('Unable to load Sage posting queue:', error.message);
        return;
      }
      if (!isMounted) return;
      const recentSuccessCutoff = Date.now() - 24 * 60 * 60 * 1000;
      const visibleQueue = (data || [])
        .filter((item: SageQueueItem) =>
          item.status !== 'success' ||
          new Date(item.updated_at).getTime() >= recentSuccessCutoff
        )
        .slice(0, 12) as SageQueueItem[];

      const nextStages = new Map(visibleQueue.map((item) => [item.id, `${item.status}:${item.message || ''}`]));
      if (sageQueueLoadedRef.current) {
        visibleQueue.forEach((item) => {
          const stage = nextStages.get(item.id);
          if (!stage || knownSageStagesRef.current.get(item.id) === stage) return;

          showSageActivityToast(item);
        });
      }
      knownSageStagesRef.current = nextStages;
      sageQueueLoadedRef.current = true;
      setSageQueue(visibleQueue);
      setLoadingSageQueue(false);
    }

    loadSageQueue();
    const channel = supabase
      .channel('header-sage-posting-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_log' }, (payload) => {
        // Use the event payload immediately. A GRN can move from queued to
        // posted in only a few seconds, before a follow-up query would see the
        // intermediate validation and posting stages.
        const item = payload.new as SageQueueItem | undefined;
        if (sageQueueLoadedRef.current && item?.id && ['pending', 'processing', 'success', 'failed'].includes(item.status)) {
          const stage = `${item.status}:${item.message || ''}`;
          if (knownSageStagesRef.current.get(item.id) !== stage) {
            knownSageStagesRef.current.set(item.id, stage);
            showSageActivityToast(item);
          }
        }
        loadSageQueue();
      })
      .subscribe();

    return () => {
      isMounted = false;
      sageQueueLoadedRef.current = false;
      knownSageStagesRef.current = new Map();
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!forceUpdateModal) return;
    if (countdown <= 0) {
      handleApplyAllUpdates();
      return;
    }
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [forceUpdateModal, countdown]);

  const roleLabels: Record<string, string> = {
    admin: 'Administrator',
    md: 'Managing Director',
    production_manager: 'Production Manager',
    supervisor: 'Supervisor',
    warehouse_manager: 'Warehouse Manager',
    raw_material_manager: 'Raw Material Manager',
    weighbridge: 'Weighbridge Operator',
    logistics: 'Logistics Officer',
    operator: 'Operator',
    finance: 'Finance / Accountant',
    accountant: 'Accountant',
  };

  useEffect(() => {
    let isMounted = true;
    async function loadNotifications() {
      setLoadingNotifications(true);
      const { data } = await supabase
        .from('recon_observations')
        .select('id, section, observation, severity, created_at')
        .order('created_at', { ascending: false })
        .limit(8);
      if (!isMounted) return;
      setNotifications(data ?? []);
      setLoadingNotifications(false);
    }
    loadNotifications();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (open && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
      if (updateMenuOpen && updateRef.current && !updateRef.current.contains(event.target as Node)) {
        setUpdateMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, updateMenuOpen]);

  function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const severityStyles: Record<string, string> = {
    critical: 'text-red-600 bg-red-50',
    warning: 'text-amber-600 bg-amber-50',
    info: 'text-slate-600 bg-slate-50',
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6">
      {/* Mobile menu button */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden p-2 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Toggle menu"
        >
          <Menu className="w-6 h-6 text-slate-600" />
        </button>
        <h2 className="text-base sm:text-lg font-semibold text-slate-800 truncate">{title}</h2>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {/* User System Version & Update Status Tab */}
        <div className="relative" ref={updateRef}>
          <button
            onClick={() => setUpdateMenuOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-extrabold rounded-full transition-all border shadow-xs ${
              pendingUpdates.length > 0
                ? 'bg-gradient-to-r from-amber-500 via-teal-600 to-emerald-600 text-white border-amber-300 animate-pulse hover:scale-105'
                : 'bg-teal-50/80 text-teal-800 border-teal-200 hover:bg-teal-100'
            }`}
          >
            {pendingUpdates.length > 0 ? (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {pendingUpdates.length === 1
                    ? `Update Available (${pendingUpdates[0].version})`
                    : `${pendingUpdates.length} Updates Available`}
                </span>
                <span className="ml-1 px-1.5 py-0.5 bg-white text-teal-900 rounded text-[10px] font-black uppercase shadow-xs">
                  {pendingUpdates.length === 1 ? 'Apply' : 'Apply All'}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>MES {APP_VERSION}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </>
            )}
          </button>

          {/* System Update Details Popover Card */}
          {updateMenuOpen && (
            <div className="absolute right-0 mt-2 w-84 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 p-4 animate-in fade-in zoom-in-95 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">PlantControl Version Control</h4>
                    <p className="text-[10px] text-slate-400 font-mono">Installed Build: {APP_VERSION}</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Online
                </span>
              </div>

              {pendingUpdates.length > 0 ? (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-amber-800 font-extrabold text-xs">
                        <Sparkles className="w-4 h-4 text-amber-600" />
                        <span>
                          {pendingUpdates.length === 1
                            ? `New Update Ready (${pendingUpdates[0].version})`
                            : `${pendingUpdates.length} New System Updates Pending`}
                        </span>
                      </div>
                    </div>

                    <div className="max-h-48 overflow-y-auto divide-y divide-amber-100 space-y-2 pt-1">
                      {pendingUpdates.map((up) => (
                        <div key={up.id || up.version} className="pt-2 first:pt-0">
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-800">
                            <span className="font-mono bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded text-[10px]">
                              {up.version}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {up.timestamp ? new Date(up.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                            {up.message || 'New system feature enhancement and performance update.'}
                          </p>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={handleApplyAllUpdates}
                      className="w-full mt-2 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-black rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-2 hover:scale-[1.01]"
                    >
                      <RefreshCw className="w-4 h-4 animate-spin-slow" />
                      {pendingUpdates.length === 1 ? 'Apply Update & Refresh Now' : `Apply All ${pendingUpdates.length} Updates & Refresh`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-700 font-extrabold text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>System Up to Date</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    You are running the latest production build of PlantControl ({APP_VERSION}). System operating at optimal performance.
                  </p>
                  <button
                    onClick={handleApplyAllUpdates}
                    className="w-full py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3 text-slate-500" /> Check for Updates / Refresh
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* LIVE ONLINE/OFFLINE STATUS LIGHT BADGE */}
        <NetworkStatusBadge />

        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search..."
            className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 w-56 lg:w-64"
          />
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors"
            onClick={() => setOpen((prev) => !prev)}
            aria-label="View notifications"
          >
            <Bell className="w-5 h-5 text-slate-500" />
            {(notifications.length > 0 || sageQueue.length > 0 || incomingProductionTransfers.length > 0) && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-500 rounded-full" />
            )}
          </button>
          {open && (
            <div className="absolute right-0 z-50 mt-2 w-[380px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Notifications</p>
                  <p className="text-xs text-slate-500">Operational activity requiring attention</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{notifications.length + sageQueue.length + incomingProductionTransfers.length}</span>
              </div>
              <div className="max-h-[420px] space-y-2 overflow-y-auto p-3">
                {incomingProductionTransfers.map((transfer) => (
                  <button
                    key={transfer.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate('/production-warehouse');
                    }}
                    className="w-full rounded-md border border-teal-200 bg-teal-50 p-3 text-left transition-colors hover:border-teal-300 hover:bg-teal-100"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-teal-700 ring-1 ring-inset ring-teal-200"><PackageCheck className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-teal-800"><span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Ready to receive</span>
                          <span className="font-mono text-[11px] text-teal-700">{transfer.transfer_number}</span>
                        </div>
                        <p className="mt-1 truncate text-sm font-semibold text-slate-900">{transfer.raw_materials?.name || 'Raw material'}</p>
                        <div className="mt-2 flex items-end justify-between gap-3">
                          <p className="text-xs text-slate-600">Raw Materials <ArrowRightLeft className="mx-1 inline h-3.5 w-3.5 text-teal-600" /> Holding Bay</p>
                          <p className="font-mono text-sm font-bold text-slate-900">{Number(transfer.quantity).toLocaleString()} {transfer.unit}</p>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {loadingSageQueue && (
                  <div className="flex items-center justify-center py-2 text-slate-400 text-xs">
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" /> Checking Sage queue...
                  </div>
                )}
                {sageQueue.map((item) => {
                  const isPosting = item.status === 'processing';
                  const isFailed = item.status === 'failed';
                  const isResolvedRetry = item.status === 'success' && !!item.retried_at && !!item.resolved_at;
                  const isPosted = item.status === 'success';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate('/sync-log');
                      }}
                      className={`w-full rounded-lg border p-2 text-left transition-colors ${
                        isFailed ? 'border-rose-200 bg-rose-50 hover:bg-rose-100' : isPosted ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100' : isPosting ? 'border-blue-200 bg-blue-50 hover:bg-blue-100' : 'border-amber-200 bg-amber-50 hover:bg-amber-100'
                      }`}>
                      <div className="flex items-center justify-between gap-2 text-xs mb-1">
                        <span className={`inline-flex items-center gap-1 font-semibold ${
                          isFailed ? 'text-rose-700' : isPosted ? 'text-emerald-700' : isPosting ? 'text-blue-700' : 'text-amber-700'
                        }`}>
                          {isPosting ? <Loader2 className="h-3 w-3 animate-spin" /> : isFailed ? <AlertTriangle className="h-3 w-3" /> : isPosted ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                          {isPosting ? 'PROCESSING IN SAGE' : isFailed ? 'SAGE FAILED' : isResolvedRetry ? 'RETRY SUCCEEDED' : isPosted ? 'POSTED TO SAGE' : 'QUEUED FOR SAGE'}
                        </span>
                        <span className="text-slate-400">{formatDate(item.updated_at)}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-700">{sageEventLabels[item.event_type] || item.event_type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-slate-600 line-clamp-2">{isResolvedRetry ? `Resolved after retry. Previous issue: ${item.last_failure_message || 'Sage failure recorded.'}` : item.message || 'Waiting for Sage bridge.'}</p>
                    </button>
                  );
                })}
                {loadingNotifications && (
                  <div className="flex items-center justify-center py-6 text-slate-400 text-sm">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading alerts...
                  </div>
                )}
                {!loadingNotifications && !loadingSageQueue && notifications.length === 0 && sageQueue.length === 0 && incomingProductionTransfers.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4">No alerts logged yet.</p>
                )}
                {notifications.map((notification) => (
                  <div key={notification.id} className="border border-slate-100 rounded-lg p-2 hover:border-slate-200">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={`px-2 py-0.5 rounded-full font-medium ${severityStyles[notification.severity] || severityStyles.info}`}>
                        {notification.severity.toUpperCase()}
                      </span>
                      <span className="text-slate-400">{formatDate(notification.created_at)}</span>
                    </div>
                    <p className="text-sm font-medium text-slate-700">{notification.section}</p>
                    <p className="text-xs text-slate-500 line-clamp-2">{notification.observation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pl-3 sm:pl-4 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-sm font-semibold">
            {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium text-slate-700">{profile?.full_name || 'User'}</p>
            <p className="text-xs text-slate-400">{roleLabels[profile?.role || ''] || profile?.role}</p>
          </div>
        </div>
      </div>

      {/* FORCE UPDATE MODAL OVERLAY */}
      {forceUpdateModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center border-2 border-red-500 animate-in zoom-in-95">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-600">
              <AlertTriangle className="w-8 h-8 animate-bounce" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">Critical System Update Pushed</h3>
            <p className="text-sm text-slate-600 mb-4">
              An administrator has pushed a critical system update ({forceUpdateModal.version}). Your active session will automatically refresh in:
            </p>
            
            <div className="w-20 h-20 bg-red-50 text-red-600 font-mono font-black text-3xl rounded-full flex items-center justify-center mx-auto mb-6 border-4 border-red-200 shadow-inner">
              {countdown}s
            </div>

            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4 animate-spin" /> Refresh Now
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
