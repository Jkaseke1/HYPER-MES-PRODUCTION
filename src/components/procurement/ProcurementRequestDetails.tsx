import type { ProcurementDetails } from '../../lib/procurementDetails';

type Props = {
  reference: string; title: string; details: ProcurementDetails | null;
  loading: boolean; error: string; onRetry: () => void; onClose: () => void;
};

export default function ProcurementRequestDetails({ reference, title, details, loading, error, onRetry, onClose }: Props) {
  return <section id="procurement-request-details" aria-label="Request details" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-lg font-bold text-slate-900">{reference}</h2><p className="text-sm text-slate-600">{title}</p></div>
      <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-semibold text-slate-600">Close details</button>
    </div>
    {loading && <p role="status" className="mt-4 text-sm text-slate-500">Loading request details…</p>}
    {error && <div role="alert" className="mt-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      {error} <button type="button" onClick={onRetry} className="ml-2 font-bold underline">Retry details</button>
    </div>}
    {!loading && !error && details && <div className="mt-5 space-y-5">
      <div><h3 className="font-semibold text-slate-800">Requested items</h3>
        {details.items.length === 0 ? <p className="mt-2 text-sm text-amber-800">No item records found. This request needs review before it progresses.</p>
          : <ul className="mt-2 divide-y divide-slate-100">{details.items.map(item => <li key={item.id} className="py-2 text-sm text-slate-700">
            <p><span className="font-semibold">{item.line_number}. {item.description}</span> — {item.quantity} {item.unit}</p>
            {item.specification && <p className="mt-1 text-slate-500">{item.specification}</p>}
          </li>)}</ul>}
      </div>
      <div><h3 className="font-semibold text-slate-800">Quote records</h3>
        {details.quotes.length === 0 ? <p className="mt-2 text-sm text-slate-500">No quote records found.</p>
          : <ul className="mt-2 divide-y divide-slate-100">{details.quotes.map(quote => <li key={quote.id} className="py-2 text-sm text-slate-700">
            <p className="font-semibold">{quote.quote_reference} · {quote.supplier_name}</p>
            <p>{quote.currency_code || 'Currency not recorded'} {quote.quote_total ?? 'Amount not recorded'} · Quote date: {quote.quote_date || 'Not recorded'} · Valid until: {quote.valid_until || 'Not recorded'}</p>
          </li>)}</ul>}
        <p className="mt-2 text-xs text-slate-500">Quote records do not confirm that an original document was uploaded or verified.</p>
      </div>
      <div><h3 className="font-semibold text-slate-800">Imported Sage records</h3>
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Imported accounting records do not confirm bank settlement or supplier receipt.</p>
        {details.history.length === 0 ? <p className="mt-2 text-sm text-slate-500">No imported Sage records found for this request.</p>
          : <ul className="mt-2 divide-y divide-slate-100">{details.history.map(row => <li key={row.id} className="py-2 text-sm text-slate-700">
            <p className="font-semibold">{row.reference || 'Reference not recorded'} · {row.transaction_type}</p>
            <p>Transaction date: {row.transaction_date} · Sage audit: {row.audit_number}</p>
            <p className="text-xs text-slate-500">Imported: {row.imported_at}</p>
          </li>)}</ul>}
      </div>
    </div>}
  </section>;
}
