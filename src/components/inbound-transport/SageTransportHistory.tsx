import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type HistoryRow = {
  id: string; supplier_account: string; transaction_date: string;
  transaction_type: 'APTx' | 'CBAP'; description: string; reference: string;
  batch_reference: string; audit_number: string; debit: number; credit: number;
  outstanding_at_extract: number; sage_currency_id: number; posting_user: string;
  extracted_at: string;
};
type SyncRun = { status: 'running' | 'success' | 'failed'; finished_at: string | null; entry_count: number; message: string | null };
type ReconciliationException = { exception_type: string; severity: string; detail: string };

const suppliers: Record<string, string> = {
  DUMB0001: 'Dumbarimwe Transport', LUBL0001: 'Lubline', LUL0001: 'Lulo Transport',
  PAR0001: 'Paraclete Investments', SEAR0001: 'Searchcraft Trading',
};
const amount = (value: number) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SageTransportHistory() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [account, setAccount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [latestRun, setLatestRun] = useState<SyncRun | null>(null);
  const [exceptions, setExceptions] = useState<ReconciliationException[]>([]);

  const load = async () => {
    setLoading(true);
    const [result, runResult, exceptionResult] = await Promise.all([
      supabase.from('inbound_transport_sage_history').select('*').eq('company_database', 'Hyperfeeds 2024')
        .gte('transaction_date', '2026-09-01').order('transaction_date', { ascending: false }).order('audit_number').range(0, 999),
      supabase.from('inbound_transport_sage_sync_runs').select('status, finished_at, entry_count, message')
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('v_inbound_transport_sage_exceptions').select('exception_type, severity, detail').limit(100),
    ]);
    if (result.error) {
      setError('Sage history unavailable. Apply the verified transporter history migration and refresh.');
    } else {
      setRows(result.data || []);
      setLatestRun(runResult.error ? null : runResult.data);
      setExceptions(exceptionResult.error ? [] : exceptionResult.data || []);
      setError('');
    }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter((row) => !account || row.supplier_account === account), [rows, account]);
  const summaries = useMemo(() => {
    const currencies = new Map<number, { charges: number; payments: number; outstanding: number }>();
    filtered.forEach((row) => {
      const summary = currencies.get(row.sage_currency_id) || { charges: 0, payments: 0, outstanding: 0 };
      if (row.transaction_type === 'APTx') summary.charges += Number(row.credit) - Number(row.debit);
      if (row.transaction_type === 'CBAP') summary.payments += Number(row.debit) - Number(row.credit);
      summary.outstanding += Number(row.outstanding_at_extract);
      currencies.set(row.sage_currency_id, summary);
    });
    return [...currencies.entries()];
  }, [filtered]);
  const referenceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const key = `${row.supplier_account}|${row.transaction_type}|${row.reference.trim().toUpperCase()}`;
      if (row.reference.trim()) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [rows]);
  const extractedAt = rows[0]?.extracted_at;

  return <section className="min-w-0 border-t border-slate-200 bg-white" aria-label="Sage transporter history">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div><h2 className="text-base font-semibold text-slate-900">Sage transport history</h2><p className="mt-1 text-xs text-slate-500">From September 2026 · Hyperfeeds 2024 · Read-only PostAP reconciliation</p></div>
      <div className="flex items-center gap-2"><select aria-label="Filter Sage transporter history" value={account} onChange={(event) => setAccount(event.target.value)} className="max-w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All transporters</option>{Object.entries(suppliers).map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}</select><button type="button" onClick={() => void load()} disabled={loading} title="Refresh imported history" aria-label="Refresh imported history" className="rounded border border-slate-300 p-2 text-slate-600 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
    </div>
    {error ? <p role="alert" className="px-4 pb-4 text-sm text-rose-700">{error}</p> : loading ? <div role="status" className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /><span className="sr-only">Loading Sage history</span></div> : <>
      <div className={`border-y px-4 py-3 text-xs ${latestRun?.status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-800' : latestRun?.status === 'success' ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
        {latestRun?.status === 'success' ? `Automatic read-only sync completed ${latestRun.finished_at ? new Date(latestRun.finished_at).toLocaleString() : ''}: ${latestRun.entry_count} Sage entry/entries checked.` : latestRun?.status === 'failed' ? `Automatic Sage sync needs attention: ${latestRun.message || 'Review the bridge sync log.'}` : 'Automatic Sage sync is awaiting the controlled bridge rollout. The history below is the verified import already stored in PlantControl.'}
      </div>
      {exceptions.length > 0 && <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><strong>{exceptions.length} reconciliation item{exceptions.length === 1 ? '' : 's'} need review.</strong> Payments are not treated as matched until the supplier, payment reference, audit number and amount all agree.</div>}
      {summaries.map(([currency, summary]) => <div key={currency} className="border-b border-slate-200 bg-slate-50 px-4 py-3"><p className="mb-2 text-xs text-slate-500">Sage currency ID {currency} · Currency name unverified</p><dl className="grid gap-3 sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Imported charges</dt><dd className="mt-1 font-mono font-semibold">{amount(summary.charges)}</dd></div><div><dt className="text-xs text-slate-500">Imported payments</dt><dd className="mt-1 font-mono font-semibold text-teal-700">{amount(summary.payments)}</dd></div><div><dt className="text-xs text-slate-500">Open amount on extracted entries</dt><dd className="mt-1 font-mono font-semibold">{amount(summary.outstanding)}</dd></div></dl></div>)}
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Date', 'Transporter', 'Entry / description', 'Reference', 'Audit / batch', 'Charges', 'Payments', 'Open at extract', 'Sage user'].map((label) => <th key={label} className="whitespace-nowrap px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{filtered.length === 0 ? <tr><td colSpan={9} className="py-8 text-center text-slate-400">No imported September entries.</td></tr> : filtered.map((row) => {
        const repeated = (referenceCounts.get(`${row.supplier_account}|${row.transaction_type}|${row.reference.trim().toUpperCase()}`) || 0) > 1;
        return <tr key={row.id} className="border-t border-slate-100"><td className="whitespace-nowrap px-3 py-3">{row.transaction_date}</td><td className="px-3 py-3"><p className="font-semibold">{suppliers[row.supplier_account] || row.supplier_account}</p><p className="mt-1 font-mono text-slate-500">{row.supplier_account}</p></td><td className="min-w-52 px-3 py-3"><p className="font-semibold">{row.transaction_type === 'APTx' ? 'Charge' : 'Payment'}</p><p className="mt-1 text-slate-600">{row.description}</p></td><td className="px-3 py-3"><p className="font-mono">{row.reference}</p>{repeated && <span className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-amber-700" title="Reference appears on multiple entries. Check supporting documents; this does not confirm duplication."><AlertTriangle className="h-3.5 w-3.5" />Repeated reference</span>}</td><td className="whitespace-nowrap px-3 py-3 font-mono">{row.audit_number}<p className="mt-1 text-slate-500">{row.batch_reference}</p></td><td className="px-3 py-3 text-right font-mono">{row.transaction_type === 'APTx' ? amount(Number(row.credit) - Number(row.debit)) : '—'}</td><td className="px-3 py-3 text-right font-mono">{row.transaction_type === 'CBAP' ? amount(Number(row.debit) - Number(row.credit)) : '—'}</td><td className="px-3 py-3 text-right font-mono">{amount(row.outstanding_at_extract)}</td><td className="px-3 py-3">{row.posting_user}</td></tr>;
      })}</tbody></table></div>
      <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">Latest source read {extractedAt ? new Date(extractedAt).toLocaleString() : 'date unavailable'}. Open amounts are a snapshot of these entries, not a complete account balance or a closing balance.</p>
    </>}
  </section>;
}
