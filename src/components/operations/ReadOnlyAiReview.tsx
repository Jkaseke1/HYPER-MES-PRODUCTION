import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BrainCircuit, CheckCircle2, Clock3, RefreshCw, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

type FindingTone = 'red' | 'amber' | 'teal';
interface Finding { tone: FindingTone; title: string; detail: string; href: string; label: string; }

const toneClasses: Record<FindingTone, { icon: typeof AlertTriangle; iconClass: string; bg: string; label: string; labelClass: string }> = {
  red: { icon: AlertTriangle, iconClass: 'text-rose-600', bg: 'bg-rose-50/70 border-rose-100', label: 'Attention', labelClass: 'bg-rose-100 text-rose-700' },
  amber: { icon: Clock3, iconClass: 'text-amber-600', bg: 'bg-amber-50/70 border-amber-100', label: 'Review', labelClass: 'bg-amber-100 text-amber-700' },
  teal: { icon: CheckCircle2, iconClass: 'text-teal-600', bg: 'bg-teal-50/70 border-teal-100', label: 'Clear', labelClass: 'bg-teal-100 text-teal-700' },
};

export default function ReadOnlyAiReview() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ticketsRes, grnsRes, transfersRes, syncRes, sageRes, warehousesRes, balancesRes] = await Promise.all([
        supabase.from('weigh_bridge_tickets').select('id, status, nett_mass, driver_signed').limit(1000),
        supabase.from('goods_received_notes').select('id, status, weigh_bridge_ticket_id').limit(1000),
        supabase.from('material_transfers').select('id, status').limit(1000),
        supabase.from('sync_log').select('id, status').eq('status', 'failed').limit(1000),
        supabase.from('sage_stock_balances').select('raw_material_id, quantity').eq('warehouse_id', 18),
        supabase.from('warehouses').select('id, code').eq('is_active', true),
        supabase.from('warehouse_stock_balances').select('raw_material_id, warehouse_id, quantity'),
      ]);
      const firstError = [ticketsRes, grnsRes, transfersRes, syncRes, sageRes, warehousesRes, balancesRes].find((result) => result.error)?.error;
      if (firstError) throw firstError;

      const tickets = ticketsRes.data || [];
      const grns = grnsRes.data || [];
      const transfers = transfersRes.data || [];
      const openTickets = tickets.filter((ticket: any) => ticket.status === 'open');
      const unsignedTickets = openTickets.filter((ticket: any) => !ticket.driver_signed);
      const missingGrnLinks = grns.filter((grn: any) => grn.status !== 'rejected' && !grn.weigh_bridge_ticket_id);
      const buffered = transfers.filter((transfer: any) => transfer.status === 'in_buffer');
      const failedSyncs = syncRes.data || [];

      const warehouseCodes = Object.fromEntries((warehousesRes.data || []).map((warehouse: any) => [warehouse.id, String(warehouse.code || '').toUpperCase()]));
      const mesTotals: Record<string, number> = {};
      (balancesRes.data || []).forEach((row: any) => {
        if (warehouseCodes[row.warehouse_id] === 'RM' || warehouseCodes[row.warehouse_id] === 'BUFFER') {
          mesTotals[row.raw_material_id] = (mesTotals[row.raw_material_id] || 0) + Number(row.quantity || 0);
        }
      });
      const stockVariances = (sageRes.data || []).filter((row: any) => {
        const sage = Number(row.quantity || 0);
        const mes = mesTotals[row.raw_material_id] || 0;
        return sage > 0 && Math.abs(((mes - sage) / sage) * 100) > 1;
      });

      const next: Finding[] = [];
      if (failedSyncs.length) next.push({ tone: 'red', title: `${failedSyncs.length} Sage sync failure${failedSyncs.length === 1 ? '' : 's'}`, detail: 'Posting or integration errors need investigation.', href: '/admin/sync-log', label: 'Open sync log' });
      if (stockVariances.length) next.push({ tone: 'red', title: `${stockVariances.length} stock variance${stockVariances.length === 1 ? '' : 's'} above 1%`, detail: 'Sage RM does not agree with MES RM plus Buffer.', href: '/reconciliation', label: 'Review variance' });
      if (unsignedTickets.length) next.push({ tone: 'amber', title: `${unsignedTickets.length} open weighbridge ticket${unsignedTickets.length === 1 ? '' : 's'} without sign-off`, detail: 'A driver signature is required before GRN linking.', href: '/weigh-bridge', label: 'Review weighbridge' });
      if (missingGrnLinks.length) next.push({ tone: 'amber', title: `${missingGrnLinks.length} GRN${missingGrnLinks.length === 1 ? '' : 's'} without a weighbridge link`, detail: 'Check whether the receipt has supporting weight evidence.', href: '/goods-received', label: 'Review GRNs' });
      if (buffered.length) next.push({ tone: 'amber', title: `${buffered.length} transfer${buffered.length === 1 ? '' : 's'} awaiting production receipt`, detail: 'Material is still recorded in the Production Buffer.', href: '/material-transfer', label: 'Review transfers' });
      if (!next.length) next.push({ tone: 'teal', title: 'No exceptions detected', detail: 'The latest read-only checks are within the configured rules.', href: '/reconciliation', label: 'View checks' });

      setFindings(next);
      setRefreshedAt(new Date());
    } catch (reviewError: any) {
      setError(reviewError?.message || 'The read-only review could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { review(); }, [review]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 bg-[#0d2036] px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-teal-400/15 p-2 text-teal-300"><BrainCircuit className="h-5 w-5" /></div>
          <div><div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-300">Operations intelligence</p><span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200">Read-only</span></div><h2 className="mt-1 text-base font-extrabold tracking-tight">AI Review</h2><p className="mt-0.5 text-xs text-slate-300">Evidence checks across weighbridge, GRN, transfers, Buffer and Sage.</p></div>
        </div>
        <button type="button" onClick={review} disabled={loading} className="inline-flex h-9 w-9 items-center justify-center self-start border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-50" title="Refresh read-only review" aria-label="Refresh read-only review"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5"><div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Live review scope <span className="text-slate-300">|</span> Latest operational records</div></div>
      <div className="p-3 sm:p-4">
        {error ? <div className="flex items-center gap-2 border border-rose-200 bg-rose-50 px-3 py-3 text-xs font-semibold text-rose-800"><AlertTriangle className="h-4 w-4" />{error}</div> : loading ? <div className="flex items-center gap-2 px-2 py-7 text-xs text-slate-500"><RefreshCw className="h-4 w-4 animate-spin text-teal-600" />Reviewing the latest records...</div> : <div className="grid gap-2.5 lg:grid-cols-2">{findings.map((finding) => { const tone = toneClasses[finding.tone]; const Icon = tone.icon; return <div key={finding.title} className={`flex min-h-[92px] flex-col justify-between gap-3 rounded-lg border p-3 ${tone.bg}`}><div className="flex items-start gap-2.5"><div className="rounded-md bg-white/80 p-1.5"><Icon className={`h-4 w-4 ${tone.iconClass}`} /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-bold text-slate-800">{finding.title}</p><span className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${tone.labelClass}`}>{tone.label}</span></div><p className="mt-1 text-xs leading-5 text-slate-600">{finding.detail}</p></div></div><Link to={finding.href} className="inline-flex items-center gap-1 self-end text-[11px] font-bold text-teal-700 hover:text-teal-900">{finding.label}<ArrowUpRight className="h-3.5 w-3.5" /></Link></div>; })}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-[10px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-teal-600" />Read-only review. No records are changed.{refreshedAt ? ` Last checked ${refreshedAt.toLocaleTimeString()}.` : ''}</div>
    </section>
  );
}
