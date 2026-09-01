import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, Plus, Eye, AlertTriangle, CheckCircle, Clock, Loader2, Database, ShieldCheck, Users, ArrowRight, ClipboardCheck, CircleDot } from 'lucide-react';
import StockTakeDetailPage from './StockTakeDetailPage';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';

interface StockTake {
  id: string;
  take_number: string;
  status: 'OPEN' | 'FROZEN' | 'CLOSED';
  started_by: string;
  started_at: string;
  frozen_at?: string;
  closed_at?: string;
  title?: string;
  person_name?: string;
  notes?: string;
  blind_mode: boolean;
  started_by_profile?: {
    full_name: string;
  };
  total_lines?: number;
  counted_lines?: number;
  total_variance?: number;
  baseline_source?: 'sage_sdk' | 'legacy_mes';
  baseline_snapshot_at?: string;
  baseline_sync_status?: 'SYNCING' | 'READY' | 'FAILED';
  baseline_sync_message?: string;
}

interface RawMaterial {
  id: string;
  code: string;
  name: string;
  sage_code: string;
}

export default function StockTakePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  
  // If ID is present, show detail page
  if (id) {
    return <StockTakeDetailPage />;
  }
  
  const [loading, setLoading] = useState(true);
  const [activeStockTake, setActiveStockTake] = useState<StockTake | null>(null);
  const [stockTakeHistory, setStockTakeHistory] = useState<StockTake[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTakeTitle, setNewTakeTitle] = useState('');
  const [newTakePersonName, setNewTakePersonName] = useState('');
  const [newTakeNotes, setNewTakeNotes] = useState('');
  const [blindMode, setBlindMode] = useState(false);
  const [mandatoryItems, setMandatoryItems] = useState<string[]>([]);
  const [allRawMaterials, setAllRawMaterials] = useState<RawMaterial[]>([]);
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch active stock take (OPEN or FROZEN)
      const { data: active } = await supabase
        .from('stock_takes')
        .select(`
          *,
          started_by_profile:started_by(full_name)
        `)
        .in('status', ['OPEN', 'FROZEN'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (active) {
        // Get progress stats
        const { data: lines } = await supabase
          .from('stock_take_lines')
          .select('id, counted_qty, variance')
          .eq('stock_take_id', active.id);

        const countedLines = lines?.filter(l => l.counted_qty !== null).length || 0;
        const totalVariance = lines?.reduce((sum, l) => sum + (l.variance || 0), 0) || 0;

        setActiveStockTake({
          ...active,
          total_lines: lines?.length || 0,
          counted_lines: countedLines,
          total_variance: totalVariance
        });
      } else {
        setActiveStockTake(null);
      }

      // Fetch history (CLOSED only)
      const { data: history } = await supabase
        .from('stock_takes')
        .select(`
          *,
          started_by_profile:started_by(full_name)
        `)
        .eq('status', 'CLOSED')
        .order('closed_at', { ascending: false })
        .limit(20);

      if (history) {
        // Get stats for each
        const historyWithStats = await Promise.all(
          history.map(async (take) => {
            const { data: lines } = await supabase
              .from('stock_take_lines')
              .select('id, counted_qty, variance')
              .eq('stock_take_id', take.id);

            const countedLines = lines?.filter(l => l.counted_qty !== null).length || 0;
            const totalVariance = lines?.reduce((sum, l) => sum + Math.abs(l.variance || 0), 0) || 0;

            return {
              ...take,
              total_lines: lines?.length || 0,
              counted_lines: countedLines,
              total_variance: totalVariance
            };
          })
        );
        setStockTakeHistory(historyWithStats);
      }

      // Fetch all raw materials for mandatory selection
      const { data: rms } = await supabase
        .from('raw_materials')
        .select('id, code, name, sage_code')
        .eq('is_active', true)
        .order('name');

      if (rms) {
        setAllRawMaterials(rms);
        // Pre-select mandatory items
        const defaultMandatory = rms
          .filter(rm => 
            rm.sage_code === 'MAY0001' || // Maize Yellow
            rm.sage_code === 'FFS0001' || // Full Fat Soya
            rm.sage_code === 'SOS0001' || // Soya Solvent
            rm.sage_code === 'MAB0001'    // Maize Bran
          )
          .map(rm => rm.id);
        setMandatoryItems(defaultMandatory);
      }
    } catch (error) {
      console.error('Error fetching stock takes:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateTakeNumber = async () => {
    const year = new Date().getFullYear();
    const { data: existing } = await supabase
      .from('stock_takes')
      .select('take_number')
      .like('take_number', `ST-${year}-%`)
      .order('take_number', { ascending: false })
      .limit(1);

    let nextNum = 1;
    if (existing && existing.length > 0) {
      const lastNum = parseInt(existing[0].take_number.split('-')[2]);
      nextNum = lastNum + 1;
    }

    return `ST-${year}-${String(nextNum).padStart(3, '0')}`;
  };

  const handleStartNewStockTake = async () => {
    if (!profile) return;
    setCreating(true);

    try {
      const takeNumber = await generateTakeNumber();

      // Create stock take header
      const { data: stockTake, error: takeError } = await supabase
        .from('stock_takes')
        .insert({
          take_number: takeNumber,
          status: 'OPEN',
          started_by: profile.id,
          title: newTakeTitle || null,
          person_name: newTakePersonName || null,
          notes: newTakeNotes || null,
          blind_mode: blindMode
        })
        .select()
        .single();

      if (takeError) throw takeError;

      const { error: snapshotError } = await supabase
        .from('stock_takes')
        .update({
          baseline_source: 'sage_sdk',
          baseline_sync_status: 'SYNCING',
          baseline_sync_message: 'Waiting for the bridge to read live Sage RM stock.',
        })
        .eq('id', stockTake.id);

      if (snapshotError) throw snapshotError;

      const { error: eventError } = await supabase
        .from('sync_log')
        .insert({
          event_type: 'stock_take_sage_snapshot',
          reference_id: stockTake.id,
          reference_type: 'stock_take',
          status: 'pending',
          message: 'Queued to read live Sage RM stock for stock take.',
          details: {
            requestedBy: profile.id,
            mandatoryItemIds: mandatoryItems,
            warehouse: 'RM',
          },
        });

      if (eventError) throw eventError;

      // Navigate to detail view
      navigate(`/stock-take/${stockTake.id}`);
    } catch (error: any) {
      console.error('Error creating stock take:', error);
      alert(`Failed to create stock take: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, string> = {
      'OPEN': 'in_progress',
      'FROZEN': 'pending',
      'CLOSED': 'completed'
    };
    return <StatusBadge status={statusMap[status] || status.toLowerCase()} className={status === 'FROZEN' ? 'animate-pulse' : ''} />;
  };

  const getProgressPercent = (counted: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((counted / total) * 100);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading stock takes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <section className="overflow-hidden rounded-lg border border-[#0d2036] bg-[#0d2036] text-white shadow-lg">
        <div className="flex flex-col gap-6 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-teal-500 text-white shadow-sm"><ClipboardList className="h-7 w-7" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="border border-[#f39200] px-2 py-1 uppercase tracking-wide text-[#ffc36b]">Inventory control</span>
                <span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Live Sage baseline required</span>
              </div>
              <h1 className="mt-3 text-3xl font-bold">Stock Take</h1>
              <p className="mt-1 text-slate-300">Physical counts with live Sage comparison, recount control, and Finance sign-off.</p>
            </div>
          </div>
          {!activeStockTake && (
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center justify-center gap-2 bg-[#f39200] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#d98100]"
            >
              <Plus className="h-4 w-4" /> Start Stock Take
            </button>
          )}
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-3">
          <div className="border-b border-white/10 px-5 py-4 sm:border-b-0 sm:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Sage baseline</p><p className="mt-2 text-xl font-bold text-emerald-300">SDK live read</p><p className="mt-1 text-xs text-slate-400">RM warehouse snapshot</p></div>
          <div className="border-b border-white/10 px-5 py-4 sm:border-b-0 sm:border-r"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Active count</p><p className="mt-2 text-xl font-bold">{activeStockTake ? activeStockTake.take_number : 'None'}</p><p className="mt-1 text-xs text-slate-400">{activeStockTake ? `${activeStockTake.counted_lines || 0} lines counted` : 'Ready to start'}</p></div>
          <div className="px-5 py-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Controlled close</p><p className="mt-2 text-xl font-bold text-[#ffc36b]">Finance review</p><p className="mt-1 text-xs text-slate-400">Variances need reasons</p></div>
        </div>
      </section>

      {/* Active Stock Take Banner */}
      {activeStockTake ? (
        <div className={`rounded-lg border p-6 shadow-sm ${activeStockTake.status === 'FROZEN' ? 'border-amber-200 bg-amber-50' : 'border-teal-200 bg-white'}`}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current stock take</p>
                  <h3 className="mt-1 font-mono text-lg font-bold text-[#0B0B34]">{activeStockTake.title || activeStockTake.take_number}</h3>
                </div>
                {getStatusBadge(activeStockTake.status)}
                {activeStockTake.baseline_sync_status === 'SYNCING' && (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-cyan-700"><Loader2 className="h-4 w-4 animate-spin" /> Syncing live Sage stock</div>
                )}
                {activeStockTake.baseline_sync_status === 'FAILED' && (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-red-700"><AlertTriangle className="h-4 w-4" /> Sage snapshot needs retry</div>
                )}
                {activeStockTake.status === 'FROZEN' && (
                  <div className="flex items-center text-amber-700 text-sm">
                    <AlertTriangle className="h-4 w-4 mr-1" />
                    Stock movements should pause
                  </div>
                )}
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                <p>Started by {activeStockTake.started_by_profile?.full_name} on {format(new Date(activeStockTake.started_at), 'PPp')}</p>
                {activeStockTake.baseline_snapshot_at ? (
                  <p className="flex items-center gap-1.5 font-medium text-emerald-700"><Database className="h-4 w-4" /> Sage SDK snapshot: {format(new Date(activeStockTake.baseline_snapshot_at), 'PPp')}</p>
                ) : (
                  <p className="text-slate-500">{activeStockTake.baseline_sync_message || 'Preparing the Sage stock snapshot.'}</p>
                )}
                {activeStockTake.notes && <p className="italic">"{activeStockTake.notes}"</p>}
              </div>
              
              {/* Progress Bar */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                  <span>Progress: {activeStockTake.counted_lines} of {activeStockTake.total_lines} counted</span>
                  <span>{getProgressPercent(activeStockTake.counted_lines || 0, activeStockTake.total_lines || 0)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white">
                  <div 
                    className="h-full rounded-full bg-teal-500 transition-all duration-300"
                    style={{ width: `${getProgressPercent(activeStockTake.counted_lines || 0, activeStockTake.total_lines || 0)}%` }}
                  />
                </div>
              </div>

              {/* Variance Summary */}
              {activeStockTake.total_variance !== undefined && (
                <div className="mt-3 text-sm">
                  <span className="text-gray-600">Total Variance: </span>
                  <span className={`font-semibold ${
                    activeStockTake.total_variance === 0 ? 'text-green-600' :
                    activeStockTake.total_variance > 0 ? 'text-amber-600' : 'text-red-600'
                  }`}>
                    {activeStockTake.total_variance > 0 ? '+' : ''}{activeStockTake.total_variance.toFixed(2)} kg
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => navigate(`/stock-take/${activeStockTake.id}`)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0d2036] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#162f4d]"
            >
              <Eye className="h-4 w-4" />
              Open Count <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <section className="border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.45fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Count readiness</p>
              <h2 className="mt-2 text-2xl font-bold text-[#0d2036]">Ready for a controlled count</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Start once the physical count team is ready. PlantControl reads a fresh Sage RM snapshot first, then locks that baseline for the count.</p>
              <button onClick={() => setShowNewModal(true)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-teal-700"><Plus className="h-4 w-4" /> Set up stock take</button>
            </div>
            <div className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-3">
              <div className="bg-slate-50 px-4 py-4"><Database className="h-5 w-5 text-teal-600" /><p className="mt-3 text-sm font-bold text-slate-800">1. Read Sage</p><p className="mt-1 text-xs leading-5 text-slate-500">A live RM baseline is captured through the SDK.</p></div>
              <div className="bg-slate-50 px-4 py-4"><ClipboardCheck className="h-5 w-5 text-cyan-600" /><p className="mt-3 text-sm font-bold text-slate-800">2. Count stock</p><p className="mt-1 text-xs leading-5 text-slate-500">Enter physical counts or import the approved count file.</p></div>
              <div className="bg-slate-50 px-4 py-4"><ShieldCheck className="h-5 w-5 text-amber-600" /><p className="mt-3 text-sm font-bold text-slate-800">3. Review variance</p><p className="mt-1 text-xs leading-5 text-slate-500">Resolve recounts and obtain Finance approval.</p></div>
            </div>
          </div>
        </section>
      )}

      {/* Stock Take History */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Stock Take History</h2>
        </div>
        
        {stockTakeHistory.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Clock className="h-12 w-12 mx-auto mb-3 text-gray-400" />
            <p>No completed stock takes yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Take Number</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Started By</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Variance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stockTakeHistory.map((take) => (
                  <tr key={take.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/stock-take/${take.id}`)}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{take.take_number}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(take.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {format(new Date(take.started_at), 'PPp')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {take.started_by_profile?.full_name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {take.counted_lines} / {take.total_lines} ({getProgressPercent(take.counted_lines || 0, take.total_lines || 0)}%)
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm font-medium ${
                        take.total_variance === 0 ? 'text-green-600' :
                        (take.total_variance || 0) > 0 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {(take.total_variance || 0) > 0 ? '+' : ''}{(take.total_variance || 0).toFixed(2)} kg
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/stock-take/${take.id}`);
                        }}
                        className="text-indigo-600 hover:text-indigo-900 flex items-center space-x-1"
                      >
                        <Eye className="h-4 w-4" />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Stock Take Modal */}
      {showNewModal && (
        <Modal
          open={showNewModal}
          onClose={() => setShowNewModal(false)}
          title="Set Up Stock Take"
          size="xl"
          footer={
            <>
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                onClick={handleStartNewStockTake}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-lg bg-[#f39200] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#d98100] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {creating ? 'Requesting Sage snapshot...' : 'Start and read live Sage stock'}
              </button>
            </>
          }
        >
          <div className="space-y-6">
            <div className="flex items-start gap-3 border border-teal-200 bg-teal-50 px-4 py-3">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
              <div><p className="text-sm font-bold text-teal-900">Live Sage baseline</p><p className="mt-1 text-sm text-teal-800">Starting this count first requests every RM quantity from Sage. Counting opens only after the complete snapshot is saved.</p></div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block"><span className="text-sm font-bold text-slate-800">Count name</span><span className="mt-1 block text-xs text-slate-500">Use a clear period or purpose.</span><input type="text" value={newTakeTitle} onChange={(e) => setNewTakeTitle(e.target.value)} className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15" placeholder="e.g. RM opening balance - Sep 2026" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-800">Count lead</span><span className="mt-1 block text-xs text-slate-500">Person responsible for the physical count.</span><input type="text" value={newTakePersonName} onChange={(e) => setNewTakePersonName(e.target.value)} className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15" placeholder="Name of responsible person" /></label>
            </div>

            <label className="block"><span className="text-sm font-bold text-slate-800">Notes <span className="font-normal text-slate-400">optional</span></span><textarea value={newTakeNotes} onChange={(e) => setNewTakeNotes(e.target.value)} rows={3} className="mt-2 w-full resize-none border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15" placeholder="Count cut-off, team members, or observations" /></label>

            <label htmlFor="blindMode" className={`flex cursor-pointer items-start gap-3 border p-4 transition-colors ${blindMode ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <input type="checkbox" id="blindMode" checked={blindMode} onChange={(e) => setBlindMode(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
              <div className="flex-1"><div className="flex items-center gap-2"><Eye className="h-4 w-4 text-amber-600" /><p className="text-sm font-bold text-slate-800">Blind count mode</p></div><p className="mt-1 text-sm text-slate-600">Counters enter physical quantities without seeing the Sage baseline. Use this for an independent count.</p></div>
              <span className={`text-xs font-bold ${blindMode ? 'text-amber-700' : 'text-slate-400'}`}>{blindMode ? 'ON' : 'OFF'}</span>
            </label>

            <details className="border border-slate-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-slate-800"><span className="inline-flex items-center gap-2"><CircleDot className="h-4 w-4 text-teal-600" /> Mandatory control items</span><span className="text-xs font-semibold text-teal-700">{mandatoryItems.length} selected</span></summary>
              <div className="border-t border-slate-200 p-4">
                <p className="text-sm text-slate-600">These items must be counted before the take can close. All active RM materials will still load from the live Sage snapshot.</p>
                <div className="mt-3 flex flex-wrap gap-2">{mandatoryItems.map(id => { const rm = allRawMaterials.find(r => r.id === id); return rm ? <button type="button" key={id} onClick={() => setMandatoryItems(mandatoryItems.filter(i => i !== id))} className="inline-flex items-center gap-1 border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100">{rm.code} <span aria-hidden="true">×</span></button> : null; })}</div>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.5fr]"><input type="search" placeholder="Find a material to make mandatory..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15" /><div className="max-h-44 overflow-y-auto border border-slate-200 divide-y divide-slate-100">{allRawMaterials.filter(rm => searchTerm === '' || rm.code.toLowerCase().includes(searchTerm.toLowerCase()) || rm.name.toLowerCase().includes(searchTerm.toLowerCase())).map((rm) => <label key={rm.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={mandatoryItems.includes(rm.id)} onChange={(e) => setMandatoryItems(e.target.checked ? [...mandatoryItems, rm.id] : mandatoryItems.filter(id => id !== rm.id))} className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" /><span><span className="font-semibold text-slate-800">{rm.code}</span><span className="text-slate-500"> · {rm.name}</span></span></label>)}</div></div>
              </div>
            </details>
          </div>
        </Modal>
      )}
    </div>
  );
}
