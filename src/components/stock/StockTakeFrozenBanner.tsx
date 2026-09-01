import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';

interface FrozenStockTake {
  take_number: string;
  frozen_at: string;
}

export default function StockTakeFrozenBanner() {
  const [frozenTake, setFrozenTake] = useState<FrozenStockTake | null>(null);

  useEffect(() => {
    fetchFrozenStockTake();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchFrozenStockTake, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchFrozenStockTake = async () => {
    try {
      const { data, error } = await supabase
        .from('stock_takes')
        .select('take_number, frozen_at')
        .eq('status', 'FROZEN')
        .order('frozen_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        setFrozenTake(null);
        return;
      }

      setFrozenTake(data);
    } catch (error) {
      // Silently handle - no frozen stock take
      setFrozenTake(null);
    }
  };

  if (!frozenTake) return null;

  return (
    <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-6 animate-pulse">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
        </div>
        <div className="ml-3">
          <p className="text-sm text-amber-800 font-medium">
            ⚠️ Stock Take {frozenTake.take_number} in progress since{' '}
            {format(new Date(frozenTake.frozen_at), 'PPp')} — please pause receipts and issues until complete
          </p>
        </div>
      </div>
    </div>
  );
}
