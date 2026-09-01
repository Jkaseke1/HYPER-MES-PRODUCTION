import { useState, useEffect } from 'react';
import { Package, CheckCircle2, XCircle, FileText, Scale } from 'lucide-react';
import Modal from '../ui/Modal';

export interface PackagingItem {
  item_code: string;
  description: string;
  unit: string;
  expected_qty: number;
}

export interface PackagingActual {
  item_code: string;
  description: string;
  unit: string;
  expected_qty: number;
  actual_qty: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (actuals: PackagingActual[], notes: string) => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  bomPackagingItems?: PackagingItem[];
  items?: PackagingItem[];
  plannedQty?: number;
  rateLabel?: string;
  saving?: boolean;
  title?: string;
  productName?: string;
  productCode?: string;
  totalIngredientKg?: number;
}

export default function PackagingDeclarationModal({
  open,
  onClose,
  onConfirm,
  onReject,
  bomPackagingItems,
  items,
  plannedQty = 0,
  rateLabel,
  saving = false,
  title = "Macropack Packaging & Final Production Approval",
  productName,
  productCode,
  totalIngredientKg = 0,
}: Props) {
  const [actuals, setActuals] = useState<PackagingActual[]>([]);
  const [notes, setNotes] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const defaultPackaging: PackagingItem[] = [
    { item_code: 'PKG-BAG-25', description: '25kg Woven Polypropylene Macropack Bags', unit: 'bags', expected_qty: plannedQty || 1 },
    { item_code: 'PKG-THREAD', description: 'Industrial Bag Sewing Thread (spools)', unit: 'spool', expected_qty: Math.ceil((plannedQty || 1) / 500) },
    { item_code: 'PKG-TAG', description: 'QC Batch Quality & Expiry Tags', unit: 'tags', expected_qty: plannedQty || 1 },
  ];

  const packagingList = (bomPackagingItems && bomPackagingItems.length > 0)
    ? bomPackagingItems
    : (items && items.length > 0)
      ? items
      : defaultPackaging;

  useEffect(() => {
    if (open) {
      setActuals(packagingList.map(item => ({
        ...item,
        actual_qty: String(item.expected_qty || 0),
      })));
      setNotes('');
      setShowRejectForm(false);
      setRejectReason('');
    }
  }, [open, bomPackagingItems, items, plannedQty]);

  function updateActual(idx: number, value: string) {
    const updated = [...actuals];
    updated[idx] = { ...updated[idx], actual_qty: value };
    setActuals(updated);
  }

  async function handleRejectSubmit() {
    if (!rejectReason.trim()) {
      alert('Please enter a reason for rejecting or returning this batch.');
      return;
    }
    if (onReject) {
      await onReject(rejectReason);
    } else {
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-4 p-1">
        {/* Manufactured Product Header Card */}
        <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-md space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-teal-400">Manufactured Product Details</span>
              <h3 className="text-base font-black text-white mt-0.5">{productName || 'Broiler Grower Macropack'}</h3>
              {productCode && <div className="text-xs font-mono text-teal-300 font-bold">{productCode}</div>}
            </div>
            <span className="px-3 py-1 bg-teal-500/20 text-teal-300 border border-teal-500/40 text-xs font-extrabold rounded-full">
              Final Approval
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800 text-xs">
            <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Planned Output</span>
              <span className="text-sm font-black text-white font-mono">{plannedQty.toLocaleString()} units</span>
            </div>
            <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
              <span className="text-slate-400 block text-[10px] uppercase font-bold flex items-center gap-1">
                <Scale className="w-3 h-3 text-teal-400" /> Total Dispensed
              </span>
              <span className="text-sm font-black text-teal-300 font-mono">
                {totalIngredientKg ? totalIngredientKg.toFixed(3) : '—'} kg
              </span>
            </div>
            <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700 col-span-2 sm:col-span-1">
              <span className="text-slate-400 block text-[10px] uppercase font-bold flex items-center gap-1">
                <Package className="w-3 h-3 text-emerald-400" /> Package Unit Size
              </span>
              <span className="text-sm font-black text-emerald-400 font-mono">Standard 25kg Bags</span>
            </div>
          </div>
        </div>

        {/* Packaging Items Table */}
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
          <div className="bg-slate-100 px-3.5 py-2.5 border-b border-slate-200 flex justify-between items-center">
            <span className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Package className="w-4 h-4 text-teal-600" /> Declared Packaging Consumption ({actuals.length} Items)
            </span>
            <span className="text-[11px] text-slate-500 font-medium">BOM Expected vs Actual</span>
          </div>

          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right text-teal-700">Actual Used</th>
                <th className="px-3 py-2 text-right">Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {actuals.map((item, idx) => {
                const actualNum = parseFloat(item.actual_qty);
                const variance = !isNaN(actualNum) ? actualNum - item.expected_qty : null;
                const hasVariance = variance !== null && Math.abs(variance) > 0;
                return (
                  <tr key={item.item_code} className={hasVariance ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-teal-800">{item.item_code}</td>
                    <td className="px-3 py-2 text-slate-800 font-bold">{item.description}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-600">
                      {item.expected_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.actual_qty}
                        onChange={e => updateActual(idx, e.target.value)}
                        className="w-24 text-right border border-teal-300 rounded-lg px-2 py-1 text-xs font-mono font-bold focus:ring-2 focus:ring-teal-500 outline-none bg-teal-50"
                      />
                      {hasVariance && (
                        <span className={`ml-1 text-[11px] font-bold ${variance! > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                          {variance! > 0 ? '+' : ''}{variance!.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{item.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Packaging Notes */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
            <FileText className="w-3.5 h-3.5 text-slate-500" /> Packaging & Quality Notes (optional)
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
            placeholder="Record any packaging batch notes, bag serial numbers, or supervisor comments..."
          />
        </div>

        {/* Rejection Form (if triggered) */}
        {showRejectForm && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-2">
            <label className="block text-xs font-bold text-red-800">Reason for Rejecting / Returning Batch *</label>
            <textarea
              rows={2}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className="w-full border border-red-300 rounded-lg px-3 py-2 text-xs text-red-900 focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Explain why this batch is rejected or requires revision..."
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRejectForm(false)}
                className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-lg"
              >
                Cancel Rejection
              </button>
              <button
                type="button"
                onClick={handleRejectSubmit}
                className="px-3 py-1.5 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 shadow-sm"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        )}

        {/* Modal Action Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
          >
            ← Back
          </button>

          <div className="flex items-center gap-2">
            {!showRejectForm && (
              <button
                type="button"
                onClick={() => setShowRejectForm(true)}
                className="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <XCircle className="w-4 h-4 text-red-600" /> Decline / Reject Batch
              </button>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={() => onConfirm(actuals, notes)}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50 hover:scale-[1.01]"
            >
              <CheckCircle2 className="w-4 h-4" /> {saving ? 'Completing...' : 'Approve & Complete Order'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
