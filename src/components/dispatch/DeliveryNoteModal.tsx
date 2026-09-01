import React from 'react';
import { X, Printer, Truck, CheckCircle2, ShieldCheck, AlertCircle, Building, User, Calendar, FileText } from 'lucide-react';
import { format } from 'date-fns';
import type { DispatchOrder, DispatchItem } from '../../types/database';
import { bagSizeKg, bagsFromKg } from '../../lib/bagUnits';

interface DeliveryNoteModalProps {
  order: DispatchOrder | null;
  items: DispatchItem[];
  isOpen: boolean;
  onClose: () => void;
}

export default function DeliveryNoteModal({ order, items, isOpen, onClose }: DeliveryNoteModalProps) {
  if (!isOpen || !order) return null;

  const handlePrint = () => {
    window.print();
  };

  const formattedDate = order.dispatch_date 
    ? format(new Date(order.dispatch_date), 'dd / MM / yyyy')
    : format(new Date(), 'dd / MM / yyyy');

  const totalBags = items.reduce((sum, item) => sum + Number(item.quantity_bags ?? bagsFromKg(item.quantity, item.bag_size_kg)), 0);

  // Fill up to 10 lines for the paper-styled D-note grid
  const MAX_ROWS = 10;
  const emptyRowsCount = Math.max(0, MAX_ROWS - items.length);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-auto border border-slate-200">
        
        {/* Modal Top Control Bar (Hidden when printing) */}
        <div className="print:hidden bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 rounded-xl border border-emerald-500/30">
              <FileText className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">Official Delivery Note (D-Note)</h3>
              <p className="text-xs text-slate-400">Ref: {order.dispatch_number} {order.physical_dnote_number ? `| Book #: ${order.physical_dnote_number}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all active:scale-95"
            >
              <Printer className="w-4 h-4" />
              Print D-Note
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* PRINTABLE D-NOTE CONTAINER */}
        <div className="p-6 md:p-10 overflow-y-auto font-sans bg-white print:p-0 print:overflow-visible print:w-full text-slate-900">
          
          {/* Outer Border Box matching physical pad */}
          <div className="border-2 border-blue-900 rounded-lg p-6 relative bg-white shadow-sm print:shadow-none print:border-blue-900">
            
            {/* TOP HEADER SECTION */}
            <div className="flex flex-col md:flex-row justify-between items-start border-b-2 border-blue-900 pb-4 mb-4 gap-4">
              
              {/* Logo & Company Information */}
              <div className="flex items-start gap-4">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1">
                    <span className="text-3xl font-extrabold italic tracking-tight text-blue-900">
                      hyper<span className="text-amber-500">feeds</span>
                    </span>
                  </div>
                  <span className="text-[10px] text-amber-600 font-bold uppercase tracking-wider italic -mt-1">
                    "Exceeding your expectation"
                  </span>
                  
                  <div className="mt-2 text-[11px] text-slate-800 leading-tight font-medium">
                    <p className="font-bold text-blue-950 text-xs">HYPERFEEDS ANIMAL NUTRITION (PVT) LTD</p>
                    <p>584 Margolis Road, Derbyshire, Waterfalls, Harare</p>
                    <p className="font-semibold text-slate-700">Tel: +263 778 882 849 / 46 / 48</p>
                  </div>
                </div>
              </div>

              {/* Delivery Note Badge & Ref Numbers */}
              <div className="flex flex-col items-end text-right">
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-blue-900 text-white font-extrabold px-3 py-1 rounded text-xs tracking-wider uppercase">
                    DELIVERY NOTE
                  </span>
                  {order.hfdn_reference && (
                    <span className="text-xs font-bold text-blue-900 border border-blue-900 px-2 py-0.5 rounded">
                      HFDN: {order.hfdn_reference}
                    </span>
                  )}
                </div>

                {/* Red Physical Book Serial # */}
                <div className="text-right">
                  <span className="text-2xl font-black text-rose-600 tracking-wider">
                    {order.physical_dnote_number || order.dispatch_number.replace('DSP-', '')}
                  </span>
                </div>

                {/* Dispatch Type Badge */}
                <div className="mt-1">
                  <span className={`inline-block text-[11px] font-bold uppercase px-2 py-0.5 rounded ${
                    order.dispatch_type === 'customer_direct' 
                      ? 'bg-amber-100 text-amber-800 border border-amber-300' 
                      : 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                  }`}>
                    {order.dispatch_type === 'customer_direct' ? '• Customer Direct Dispatch' : '• Branch Transfer (IBT)'}
                  </span>
                </div>
              </div>
            </div>

            {/* LOGISTICS & ROUTING METADATA GRID */}
            <div className="grid grid-cols-2 gap-4 text-xs mb-4 pb-4 border-b border-blue-900/40 font-semibold">
              <div className="space-y-1.5 border-r border-blue-900/30 pr-4">
                <div className="flex">
                  <span className="w-16 font-bold text-blue-900">FROM:</span>
                  <span className="font-extrabold text-slate-900 uppercase">
                    {(order.warehouses as any)?.name || 'Derbyshire Warehouse / Plant'}
                  </span>
                </div>
                <div className="flex">
                  <span className="w-16 font-bold text-blue-900">TO:</span>
                  <span className="font-extrabold text-slate-900 uppercase">
                    {order.dispatch_type === 'customer_direct' 
                      ? (order.customer_name || 'Direct Customer')
                      : ((order.branches as any)?.name || 'Branch Store')}
                  </span>
                </div>
                <div className="flex">
                  <span className="w-16 font-bold text-blue-900">DRIVER:</span>
                  <span className="font-bold text-slate-900">
                    {order.driver_name || 'N/A'} {order.driver_phone ? `(${order.driver_phone})` : ''}
                  </span>
                </div>
                <div className="flex">
                  <span className="w-16 font-bold text-blue-900">TRUCK:</span>
                  <span className="font-bold text-slate-900 uppercase">
                    {order.vehicle_number || 'N/A'} {order.trailer_number ? ` / Trailer: ${order.trailer_number}` : ''}
                  </span>
                </div>
                {order.is_hired_truck && (
                  <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 p-1 rounded border border-amber-200">
                    <Truck className="w-3.5 h-3.5" />
                    <span className="font-extrabold text-[10px]">HIRED TRANSPORTER: {order.transporter_name || 'Third Party Haulier'}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 pl-2">
                <div className="flex">
                  <span className="w-20 font-bold text-blue-900">DATE:</span>
                  <span className="font-bold text-slate-900">{formattedDate}</span>
                </div>
                <div className="flex">
                  <span className="w-20 font-bold text-blue-900">SYSTEM REF:</span>
                  <span className="font-mono font-bold text-slate-900">{order.dispatch_number}</span>
                </div>
                <div className="flex">
                  <span className="w-20 font-bold text-blue-900">ORDER:</span>
                  <span className="font-bold text-slate-900">{order.order_number || 'N/A'}</span>
                </div>
                <div className="flex">
                  <span className="w-20 font-bold text-blue-900">VAT No:</span>
                  <span className="font-bold text-slate-900">{order.vat_number || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* RECEIPT CLAUSE */}
            <div className="text-xs font-bold text-blue-950 mb-3 bg-blue-50/70 p-2 rounded border border-blue-200/80 flex items-center justify-between">
              <span>Please receive the following in good order and condition:</span>
              <span className="italic text-slate-600 font-normal">Driver / Rep: {order.driver_name || '________________'}</span>
            </div>

            {/* ITEMS TABLE GRID (REPLICATING PHYSICAL PAD WITH DIAGONAL Z-LINE FOR EMPTY ROWS) */}
            <div className="relative border-2 border-blue-900 rounded overflow-hidden mb-6 bg-white">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-blue-900 text-white font-bold border-b-2 border-blue-900 text-xs uppercase">
                    <th className="py-2 px-3 border-r border-blue-800 w-24 text-center">BAGS</th>
                    <th className="py-2 px-3 border-r border-blue-800 w-24 text-center">UNIT</th>
                    <th className="py-2 px-3 border-r border-blue-800">DESCRIPTION / PRODUCT</th>
                    <th className="py-2 px-3 w-32 text-center">BATCH #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-900/30 text-slate-900 font-medium">
                  {items.map((item, idx) => (
                    <tr key={item.id || idx} className="h-9 hover:bg-slate-50">
                      <td className="py-1.5 px-3 border-r border-blue-900/30 text-center font-extrabold text-sm text-blue-950">
                        {Number(item.quantity_bags ?? bagsFromKg(item.quantity, item.bag_size_kg)).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-1.5 px-3 border-r border-blue-900/30 text-center text-xs font-semibold text-slate-700">
                        bags ({bagSizeKg(item.bag_size_kg)} kg)
                      </td>
                      <td className="py-1.5 px-3 border-r border-blue-900/30 font-bold text-slate-900">
                        {(item.formulations as any)?.name || (item.formulations as any)?.code || 'Finished Feed'}
                      </td>
                      <td className="py-1.5 px-3 text-center font-mono text-xs text-slate-800">
                        {item.batch_number || '-'}
                      </td>
                    </tr>
                  ))}

                  {/* Empty rows to maintain pad height */}
                  {Array.from({ length: emptyRowsCount }).map((_, idx) => (
                    <tr key={`empty-${idx}`} className="h-9">
                      <td className="py-1.5 px-3 border-r border-blue-900/30"></td>
                      <td className="py-1.5 px-3 border-r border-blue-900/30"></td>
                      <td className="py-1.5 px-3 border-r border-blue-900/30"></td>
                      <td className="py-1.5 px-3"></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 font-extrabold border-t-2 border-blue-900 text-xs">
                    <td className="py-2 px-3 border-r border-blue-900/30 text-center text-blue-950 text-sm">
                      {totalBags.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    </td>
                    <td className="py-2 px-3 border-r border-blue-900/30 text-center text-slate-600">
                      TOTAL BAGS
                    </td>
                    <td className="py-2 px-3 border-r border-blue-900/30 text-blue-950" colSpan={2}>
                      Total Load Weight: {order.total_weight || 0} kg
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Diagonal Z-line overlay on empty space if items < MAX_ROWS */}
              {emptyRowsCount > 2 && (
                <div className="absolute inset-0 pointer-events-none opacity-25">
                  <svg className="w-full h-full">
                    <line x1="5%" y1="65%" x2="95%" y2="85%" stroke="#1e3a8a" strokeWidth="2" strokeDasharray="4" />
                  </svg>
                </div>
              )}
            </div>

            {/* SPECIAL NOTES */}
            {order.delivery_notes && (
              <div className="text-xs mb-6 p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="font-bold text-blue-900">Notes / Remarks: </span>
                <span className="text-slate-700">{order.delivery_notes}</span>
              </div>
            )}

            {/* FOOTER SIGNATURE BLOCKS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t-2 border-blue-900 text-xs font-semibold">
              
              {/* Issued By Signature */}
              <div className="space-y-3 p-3 bg-slate-50 rounded border border-slate-200">
                <p className="font-bold text-blue-950 uppercase border-b border-slate-300 pb-1">1. Issued By (Warehouse)</p>
                <div className="space-y-1.5 text-[11px]">
                  <p><span className="text-slate-500">Name:</span> <span className="font-bold">{order.prepared_by || 'Warehouse Dispatcher'}</span></p>
                  <p><span className="text-slate-500">Date:</span> {formattedDate}</p>
                  <div className="pt-4 border-b border-dashed border-slate-400"></div>
                  <p className="text-[10px] text-slate-400 text-right italic">Signature</p>
                </div>
              </div>

              {/* Transporter / Driver Signature */}
              <div className="space-y-3 p-3 bg-slate-50 rounded border border-slate-200">
                <p className="font-bold text-blue-950 uppercase border-b border-slate-300 pb-1">2. Driver / Transporter</p>
                <div className="space-y-1.5 text-[11px]">
                  <p><span className="text-slate-500">Name:</span> <span className="font-bold">{order.driver_name || 'Driver'}</span></p>
                  <p><span className="text-slate-500">Reg:</span> {order.vehicle_number || '-'}</p>
                  <div className="pt-4 border-b border-dashed border-slate-400"></div>
                  <p className="text-[10px] text-slate-400 text-right italic">Signature</p>
                </div>
              </div>

              {/* Goods Received Signature (Branch/Customer) */}
              <div className="space-y-3 p-3 bg-slate-50 rounded border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-300 pb-1">
                  <p className="font-bold text-blue-950 uppercase">3. Goods Received In Good Order</p>
                  {order.branch_confirmation_status === 'confirmed' && (
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">CONFIRMED</span>
                  )}
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <p><span className="text-slate-500">Name:</span> <span className="font-bold">{order.branch_confirmed_by ? 'Branch Receiver' : '______________________'}</span></p>
                  <p><span className="text-slate-500">Date:</span> {order.branch_confirmed_at ? format(new Date(order.branch_confirmed_at), 'dd/MM/yyyy HH:mm') : '____ / ____ / 20__'}</p>
                  <div className="pt-4 border-b border-dashed border-slate-400"></div>
                  <p className="text-[10px] text-slate-400 text-right italic">Signature</p>
                </div>
              </div>

            </div>

            {/* ACCOUNTS APPROVAL BANNER (FOOTER) */}
            <div className="mt-4 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between text-[11px] text-slate-600">
              <div className="flex items-center gap-2">
                <span className="font-bold text-blue-900">Accounts Action:</span>
                {order.dispatch_type === 'customer_direct' ? (
                  <span className="text-amber-800 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Direct Customer Invoice Raising
                  </span>
                ) : (
                  <span className="text-indigo-800 font-semibold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    IBT Stock Transfer & Posting Approval
                  </span>
                )}
              </div>
              <div>
                <span className="font-semibold">Accounts Status: </span>
                <span className={`font-bold ${
                  order.accounts_posting_status === 'approved' ? 'text-emerald-700' : 'text-amber-600'
                }`}>
                  {order.accounts_posting_status === 'approved' ? 'APPROVED & POSTED' : 'PENDING ACCOUNTS APPROVAL'}
                </span>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
