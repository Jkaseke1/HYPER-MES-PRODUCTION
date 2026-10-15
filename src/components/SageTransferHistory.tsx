import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, RefreshCw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sageHistoryStatus, harareDay, historyCsvCell, groupHistoryByIst } from '../lib/sageHistory';

type Fields = Record<string, any>;
type HistoryRow = Fields & { id: string; status: string };
const time = (value?: string) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid recorded date' : date.toLocaleString('en-GB', { timeZone: 'Africa/Harare' });
};
const tone: Record<string, string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

const stage = (row: Fields) => sageHistoryStatus({ ...row, status: row.status });

export default function SageTransferHistory() {
  const [rows, setRows] = useState<Fields[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [direction, setDirection] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedIst, setExpandedIst] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const logs: Fields[] = [];
        const snapshotAt = new Date().toISOString();
        // Page through the full retained history rather than relying on the API row cap.
        let offset = 0;
        for (;;) {
          const { data, error } = await supabase.from('sync_log')
            .select('id, event_type, reference_id, status, message, details, sage_response, error_details, retry_count, created_at, updated_at')
            .in('event_type', ['material_transfer_to_production', 'material_transfer_return_to_rm'])
            .lte('created_at', snapshotAt)
            .order('created_at', { ascending: false }).order('id', { ascending: false })
            .range(offset, offset + 499);
          if (error) throw error;
          if (cancelled) return;
          if (!data?.length) break;
          logs.push(...data);
          offset += data.length;
        }
        const records = new Map<string, Fields>();
        for (const eventType of ['material_transfer_to_production', 'material_transfer_return_to_rm']) {
          const ids = [...new Set(logs.filter(row => row.event_type === eventType).map(row => row.reference_id).filter(Boolean))];
          for (let i = 0; i < ids.length; i += 100) {
            const isReturn = eventType === 'material_transfer_return_to_rm';
            const { data, error } = await supabase.from(isReturn ? 'material_transfer_reversals' : 'material_transfers')
              .select(isReturn
                ? 'id, original_transfer_id, reversal_number, quantity, unit, status, sage_reference, raw_materials(name, code)'
                : 'id, transfer_number, purpose, transfer_date, quantity, unit, status, reversed_at, raw_materials(name, code)')
              .in('id', ids.slice(i, i + 100)).returns<Fields[]>();
            if (error) throw error;
            if (cancelled) return;
            for (const record of data || []) records.set(record.id, record);
          }
        }
        // Include original IST metadata for returns, even when their forward log is absent.
        const originals = [...new Set([...records.values()].map(row => row.original_transfer_id).filter(Boolean))];
        for (let i = 0; i < originals.length; i += 100) {
          const { data, error } = await supabase.from('material_transfers')
            .select('id, transfer_number, purpose, transfer_date').in('id', originals.slice(i, i + 100));
          if (error) throw error;
          if (cancelled) return;
          for (const record of data || []) records.set(record.id, { ...records.get(record.id), ...record });
        }
        const unique = [...new Map(logs.map(row => [row.id, row])).values()];
        setRows(unique.map(row => {
          const record = records.get(row.reference_id);
          const original = record?.original_transfer_id ? records.get(record.original_transfer_id) : record;
          return { ...row, record, original };
        }));
        setLoadedAt(new Date().toISOString());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : (err as Fields)?.message || 'Could not load Sage history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [version]);

  useEffect(() => { setPage(0); }, [search, status, direction, from, to]);
  const filtered = useMemo(() => rows.filter(row => {
    const result = stage(row);
    const isReturn = row.event_type === 'material_transfer_return_to_rm';
    const day = harareDay(row.created_at);
    if ((from && day < from) || (to && day > to)) return false;
    if (direction !== 'all' && (direction === 'return') !== isReturn) return false;
    if (status === 'confirmed' && !result.confirmed) return false;
    if (status === 'attention' && result.confirmed) return false;
    if (!['all', 'confirmed', 'attention'].includes(status) && row.status !== status) return false;
    const text = [row.id, row.reference_id, row.message, row.original?.purpose, row.original?.transfer_number,
      row.record?.reversal_number, row.record?.raw_materials?.name, row.record?.raw_materials?.code,
      row.details?.sdkTransfer?.reference, row.details?.sdkTransfer?.reference2, row.details?.sdkTransfer?.itemCode,
      row.sage_response?.environment, row.sage_response?.companyDatabase].join(' ').toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }), [rows, search, status, direction, from, to]);
  const groups = useMemo(() => groupHistoryByIst(rows as HistoryRow[]), [rows]);
  const matchingIds = useMemo(() => new Set(filtered.map(row => row.id)), [filtered]);
  const visibleGroups = groups.filter(group => group.rows.some(row => matchingIds.has(row.id)));
  const pages = Math.max(1, Math.ceil(visibleGroups.length / 25));
  const currentPage = Math.min(page, pages - 1);

  function exportCsv() {
    const header = ['Sync ID', 'IST', 'Transfer / return', 'Direction', 'Item', 'Quantity', 'Unit', 'Recorded status', 'Assessment', 'RM date', 'Queued (Harare)', 'Last updated (Harare)', 'SDK posted (Harare)', 'Sage reference', 'Environment', 'Company', 'Message'];
    const values = filtered.map(row => [row.id, row.original?.purpose, row.record?.reversal_number || row.record?.transfer_number,
      row.event_type === 'material_transfer_return_to_rm' ? 'PD to RM' : 'RM to PD',
      row.details?.sdkTransfer?.itemCode || row.record?.raw_materials?.code, row.details?.sdkTransfer?.quantity ?? row.record?.quantity,
      row.record?.unit, row.status, stage(row).label, row.original?.transfer_date, time(row.created_at), time(row.updated_at),
      time(row.sage_response?.postedAtUtc), row.details?.sdkTransfer?.reference || row.record?.sage_reference,
      row.sage_response?.environment, row.sage_response?.companyDatabase, row.message]);
    const csv = [header, ...values].map(cells => cells.map(historyCsvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sage-transfer-history.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <section className="min-w-0 border border-slate-200 bg-white" aria-label="Sage transfer history">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-200 bg-[#09072c] px-5 py-4 text-white">
      <div><h2 className="text-lg font-bold">Sage sync history</h2><p className="mt-1 text-xs text-slate-300">{groups.length} IST groups · {rows.length} recorded events · Harare time{loadedAt ? ` · Loaded ${time(loadedAt)}` : ''}</p></div>
      <div className="flex gap-2">
        <button type="button" title="Export filtered history" aria-label="Export filtered history" disabled={loading || !!error} onClick={exportCsv} className="rounded border border-white/30 p-2 disabled:opacity-50"><Download className="h-5 w-5" /></button>
        <button type="button" title="Refresh history" aria-label="Refresh history" disabled={loading} onClick={() => setVersion(value => value + 1)} className="rounded border border-white/30 p-2 disabled:opacity-50"><RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
    </header>
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
      <label className="relative min-w-0 flex-[2_1_240px]"><span className="mb-1 block text-xs font-semibold text-slate-600">Search history</span><Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="IST, transfer, return, item or Sage reference" className="h-10 w-full rounded border border-slate-300 pl-9 pr-3 text-sm" /></label>
      <label className="text-xs font-semibold text-slate-600">Status<select value={status} onChange={e => setStatus(e.target.value)} className="mt-1 block h-10 max-w-full rounded border border-slate-300 bg-white px-2 text-sm font-normal"><option value="all">All statuses</option><option value="confirmed">Production confirmed</option><option value="attention">Needs review / unconfirmed</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="failed">Failed</option><option value="retry">Retry</option></select></label>
      <label className="text-xs font-semibold text-slate-600">Direction<select value={direction} onChange={e => setDirection(e.target.value)} className="mt-1 block h-10 rounded border border-slate-300 bg-white px-2 text-sm font-normal"><option value="all">Both directions</option><option value="forward">RM to PD</option><option value="return">PD to RM</option></select></label>
      <label className="text-xs font-semibold text-slate-600">Queued from<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 block h-10 rounded border border-slate-300 px-2 font-normal" /></label>
      <label className="text-xs font-semibold text-slate-600">Queued to<input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 block h-10 rounded border border-slate-300 px-2 font-normal" /></label>
    </div>
    {error ? <div role="alert" className="flex items-center gap-2 p-6 text-sm text-rose-800"><AlertTriangle className="h-5 w-5 shrink-0" />History could not be loaded: {error}</div>
      : loading ? <p role="status" className="p-10 text-center text-sm text-slate-600">Loading recorded Sage history...</p>
        : <>
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr>{['IST', 'RM transfer date', 'Recorded events', 'Overall Sage status', 'Last updated'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
            <tbody>{visibleGroups.slice(currentPage * 25, currentPage * 25 + 25).map(group => {
              const open = expandedIst === group.key;
              const dates = [...new Set(group.rows.map(row => row.original?.transfer_date).filter(Boolean))];
              const matches = group.rows.filter(row => matchingIds.has(row.id)).length;
              return <Fragment key={group.key}>
                <tr className={`border-t border-slate-200 ${open ? 'bg-orange-50/60' : 'hover:bg-slate-50'}`}>
                  <td className="px-4 py-3"><button type="button" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${group.label}`} onClick={() => { setExpandedIst(open ? null : group.key); setExpanded(null); }} className="flex min-h-8 items-center gap-2 whitespace-nowrap font-mono font-semibold text-slate-900"><ChevronRight className={`h-4 w-4 shrink-0 text-orange-600 ${open ? 'rotate-90' : ''}`} />{group.label}</button></td>
                  <td className="px-4 py-3 text-xs text-slate-600" title={dates.join(', ')}>{dates.length === 1 ? dates[0] : dates.length ? `${dates.length} dates` : 'Not recorded'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600"><span className="font-semibold text-slate-800">{group.rows.length - group.returns} RM to PD</span>{group.returns > 0 && <span className="ml-2 font-semibold text-orange-800">{group.returns} PD to RM</span>}{matches < group.rows.length && <p className="mt-1">{matches} matching / {group.rows.length} total</p>}</td>
                  <td className="px-4 py-3"><span className={`inline-block rounded border px-2 py-1 text-xs font-semibold ${tone[group.tone]}`}>{group.labelStatus}</span><span className="ml-2 whitespace-nowrap text-xs text-slate-500">{group.confirmed}/{group.rows.length} confirmed</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{time(group.latest)}</td>
                </tr>
                {open && <tr><td colSpan={5} className="border-t border-orange-200 bg-slate-50 p-3">
                  <table className="w-full table-fixed text-left text-xs">
                    <thead className="text-slate-500"><tr><th className="w-[29%] px-3 py-2">Material / record</th><th className="w-[12%] px-3 py-2">Direction</th><th className="w-[12%] px-3 py-2">Quantity</th><th className="w-[27%] px-3 py-2">Sage status</th><th className="w-[20%] px-3 py-2">Queued / updated</th></tr></thead>
                    <tbody>{group.rows.map(row => {
                      const result = stage(row);
                      const payload = row.details?.sdkTransfer || {};
                      const lineOpen = expanded === row.id;
                      return <Fragment key={row.id}>
                        <tr className="border-t border-slate-200 bg-white align-top">
                          <td className="px-3 py-3"><button type="button" aria-expanded={lineOpen} aria-label={`${lineOpen ? 'Collapse' : 'Expand'} audit ${row.record?.reversal_number || row.record?.transfer_number || row.id}`} onClick={() => setExpanded(lineOpen ? null : row.id)} className="flex items-start gap-2 text-left font-semibold text-slate-900"><ChevronRight className={`h-4 w-4 shrink-0 ${lineOpen ? 'rotate-90' : ''}`} /><span className="min-w-0 break-words">{row.record?.raw_materials?.name || payload.itemCode || 'Item not recorded'}</span></button><p className="mt-1 break-words pl-6 font-mono text-slate-500">{row.record?.raw_materials?.code || payload.itemCode}</p><p className="mt-1 break-words pl-6 font-mono text-slate-500">{row.record?.reversal_number || row.record?.transfer_number || row.reference_id}</p>{!matchingIds.has(row.id) && <p className="mt-1 pl-6 text-slate-400">Outside current filter</p>}</td>
                          <td className="px-3 py-3 font-semibold">{row.event_type === 'material_transfer_return_to_rm' ? 'PD to RM' : 'RM to PD'}</td>
                          <td className="break-words px-3 py-3 font-mono">{payload.quantity ?? row.record?.quantity ?? 'Not recorded'} {row.record?.unit}</td>
                          <td className="px-3 py-3"><span className={`inline-block rounded border px-2 py-1 font-semibold ${tone[result.tone] || tone.slate}`}>{result.label}</span>{row.original?.reversed_at && <p className="mt-2 text-orange-800">Return recorded against original transfer</p>}</td>
                          <td className="px-3 py-3 text-slate-600"><p>{time(row.created_at)}</p><p className="mt-1">{time(row.updated_at)}</p></td>
                        </tr>
                        {lineOpen && <tr><td colSpan={5} className="border-t border-slate-100 bg-white px-5 py-4">
                          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 break-words text-xs text-slate-600 lg:grid-cols-3">
                            {Object.entries({ 'Recorded status': row.status, 'RM transfer date': row.original?.transfer_date,
                              'Requested Sage date': payload.transactionDate, 'SDK posted (Harare)': time(row.sage_response?.postedAtUtc),
                              'SDK requested quantity': payload.quantity, 'PlantControl recorded quantity': row.record?.quantity,
                              'Bridge started (Harare)': time(row.details?.bridgeStartedAt),
                              'Bridge confirmation (Harare)': time(row.details?.sageConfirmedAt),
                              'Sage reference': payload.reference || row.record?.sage_reference, 'Line reference': payload.reference2,
                              Environment: row.sage_response?.environment, Company: row.sage_response?.companyDatabase,
                              'Retry count': row.retry_count, 'Sync ID': row.id, 'Original transfer ID': row.record?.original_transfer_id,
                              'Message': row.message }).map(([key, value]) => <div key={key} className="min-w-0"><dt className="font-semibold text-slate-800">{key}</dt><dd className="mt-1">{String(value ?? 'Not recorded')}</dd></div>)}
                          </dl>
                        </td></tr>}
                      </Fragment>;
                    })}</tbody>
                  </table>
                </td></tr>}
              </Fragment>;
            })}</tbody>
          </table></div>
          {!filtered.length && <p className="p-10 text-center text-sm text-slate-600">{rows.length ? 'No records match these filters.' : 'No recorded transfer sync events are available.'}</p>}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600"><span>{visibleGroups.length} matching IST groups · {filtered.length} matching events · Page {currentPage + 1} of {pages}</span><div className="flex gap-2"><button type="button" title="Previous page" aria-label="Previous page" disabled={!currentPage} onClick={() => setPage(currentPage - 1)} className="rounded border p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><button type="button" title="Next page" aria-label="Next page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} className="rounded border p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div></footer>
        </>}
  </section>;
}
