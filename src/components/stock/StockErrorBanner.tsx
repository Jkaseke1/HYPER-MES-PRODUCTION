import { AlertTriangle } from 'lucide-react';
import { StockError } from '../../lib/stockValidation';

interface StockErrorBannerProps {
  errors: StockError[];
  onDismiss?: () => void;
}

export default function StockErrorBanner({ errors, onDismiss }: StockErrorBannerProps) {
  if (!errors || errors.length === 0) return null;

  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-800 mb-2">Insufficient Stock</p>
          <div className="space-y-1">
            {errors.map((error, idx) => (
              <p key={idx} className="text-sm text-red-700">
                <span className="font-medium">{error.materialName}:</span> {error.available.toFixed(2)}kg available,{' '}
                {error.requested.toFixed(2)}kg required (short by{' '}
                <span className="font-semibold">{error.shortfall.toFixed(2)}kg</span>)
              </p>
            ))}
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-red-600 hover:text-red-700 font-medium text-sm"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
