import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type ExceptionRow = {
  exception_type: string; severity: 'high' | 'review'; grn_number: string | null; ticket_no: string | null;
  transporter_name: string | null; claim_number: string | null; expected_amount: number | null;
  sage_charge_amount: number | null; sage_paid_amount: number | null; detail: string; action: string;
};

const number = (value: number | null) => value == null ? '—' : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TransportExceptionsPanel() {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    const { data, error: queryError } = await supabase.from('v_inbound_transport_exceptions').select('*').limit(250);
    if (queryError) { setError('Transport exception monitoring is unavailable until its migration is applied.'); setRows([]); }
    else { setRows((data || []) as ExceptionRow[]); setError(''); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const high = useMemo(() => rows.filter((row) => row.severity === 'high').length, [rows]);

  return <section className="overflow-hidden border border-slate-200 bg-white" aria-label="Transport exceptions">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4"><div><h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><ShieldAlert className="h-4 w-4 text-amber-700" />Transport exceptions</h2><p className="mt-1 text-xs text-slate-500">Control signals from signed weighbridge evidence, GRNs, expected freight, imported Sage charges and payments. They require review; they do not prove misconduct.</p></div><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button></div>
    {error ? <p role="alert" className="m-4 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : loading ? <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /></div> : <>
      <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-3"><div className="bg-white px-4 py-3"><p className="text-xs text-slate-500">Items requiring review</p><p className="mt-1 text-xl font-semibold text-slate-900">{rows.length}</p></div><div className="bg-white px-4 py-3"><p className="text-xs text-slate-500">High-priority control gaps</p><p className="mt-1 text-xl font-semibold text-rose-700">{high}</p></div><div className="bg-white px-4 py-3"><p className="text-xs text-slate-500">Control owner</p><p className="mt-1 text-sm font-semibold text-slate-900">Raw Materials + Admin</p></div></div>
      {rows.length === 0 ? <div className="flex items-center justify-center gap-2 py-14 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" />No active transport exceptions.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Priority</th><th className="px-3 py-3">Delivery evidence</th><th className="px-3 py-3">Transporter</th><th className="px-3 py-3 text-right">Expected</th><th className="px-3 py-3 text-right">Sage charge</th><th className="px-3 py-3 text-right">Sage paid</th><th className="px-3 py-3">Required review</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.exception_type}-${row.claim_number || row.ticket_no || index}`} className="border-t border-slate-100 align-top"><td className="px-3 py-3"><span className={`inline-flex items-center gap-1 border px-2 py-1 text-xs font-semibold ${row.severity === 'high' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><AlertTriangle className="h-3.5 w-3.5" />{row.severity === 'high' ? 'High' : 'Review'}</span></td><td className="px-3 py-3"><p className="font-mono text-xs font-semibold text-slate-800">{row.claim_number || 'No claim'} </p><p className="mt-1 text-xs text-slate-500">{row.ticket_no || 'No ticket'} · {row.grn_number || 'No GRN'}</p></td><td className="px-3 py-3 text-slate-700">{row.transporter_name || 'Not recorded'}</td><td className="px-3 py-3 text-right font-mono">{number(row.expected_amount)}</td><td className="px-3 py-3 text-right font-mono">{number(row.sage_charge_amount)}</td><td className="px-3 py-3 text-right font-mono">{number(row.sage_paid_amount)}</td><td className="min-w-80 px-3 py-3"><p className="text-xs text-slate-700">{row.detail}</p><p className="mt-1 text-xs font-semibold text-teal-800">{row.action}</p></td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
