import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { StockError, logStockException } from '../../lib/stockValidation';

interface StockOverrideModalProps {
  open: boolean;
  onClose: () => void;
  errors: StockError[];
  transactionType: string;
  onConfirm: () => Promise<void>;
}

export default function StockOverrideModal({
  open,
  onClose,
  errors,
  transactionType,
  onConfirm,
}: StockOverrideModalProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOverride() {
    if (!reason.trim()) {
      setError('Please provide a reason for the override');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Log all exceptions
      for (const err of errors) {
        await logStockException(
          transactionType,
          err.materialName,
          err.available,
          err.requested,
          reason
        );
      }

      // Execute the transaction
      await onConfirm();

      // Reset and close
      setReason('');
      onClose();
    } catch (err: any) {
      console.error('Override failed:', err);
      setError(err.message || 'Failed to process override');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Stock Override Required" size="sm">
      <div className="space-y-4">
        {/* Warning */}
        <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800 mb-1">Insufficient Stock</p>
            <p className="text-xs text-red-700">
              This transaction would result in negative stock. A supervisor override is required.
            </p>
          </div>
        </div>

        {/* Stock Details */}
        <div className="space-y-2 p-3 bg-slate-50 rounded border border-slate-200">
          {errors.map((err, idx) => (
            <div key={idx} className="text-xs">
              <p className="font-medium text-slate-700">{err.materialName}</p>
              <p className="text-slate-600">
                Available: {err.available.toFixed(2)}kg | Requested: {err.requested.toFixed(2)}kg | Shortfall:{' '}
                <span className="font-semibold text-red-600">{err.shortfall.toFixed(2)}kg</span>
              </p>
            </div>
          ))}
        </div>

        {/* Reason Input */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Override Reason *
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 disabled:bg-slate-100"
            placeholder="Explain why this stock shortage must be overridden..."
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-200">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleOverride}
            disabled={saving || !reason.trim()}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Processing...' : 'Override & Proceed'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
