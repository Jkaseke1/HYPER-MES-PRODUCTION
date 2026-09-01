import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CheckCircle, Database } from 'lucide-react';
import { setupNetworkListeners, processOfflineOutbox, getOutboxCount } from '../../lib/offlineSync';

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [outboxCount, setOutboxCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncedSuccess, setSyncedSuccess] = useState(false);

  useEffect(() => {
    const cleanup = setupNetworkListeners((onlineStatus, count) => {
      setIsOnline(onlineStatus);
      setOutboxCount(count);
    });
    return cleanup;
  }, []);

  const handleManualSync = async () => {
    if (syncing || !isOnline) return;
    setSyncing(true);
    setSyncedSuccess(false);

    const result = await processOfflineOutbox();
    const newCount = await getOutboxCount();
    setOutboxCount(newCount);
    setSyncing(false);

    if (result.processed > 0) {
      setSyncedSuccess(true);
      setTimeout(() => setSyncedSuccess(false), 4000);
    }
  };

  if (isOnline && outboxCount === 0 && !syncedSuccess) {
    return null;
  }

  return (
    <div className="w-full transition-all duration-300 z-50">
      {!isOnline && (
        <div className="bg-amber-600 text-white px-4 py-2 flex items-center justify-between text-xs font-semibold shadow-md">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-200 animate-pulse" />
            <span>
              <strong>Offline Mode Active:</strong> Network disconnected. Operations are queued safely offline in IndexedDB.
            </span>
          </div>
          {outboxCount > 0 && (
            <span className="bg-amber-800 text-amber-100 px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold border border-amber-500">
              {outboxCount} Queued
            </span>
          )}
        </div>
      )}

      {isOnline && outboxCount > 0 && (
        <div className="bg-teal-700 text-white px-4 py-2 flex items-center justify-between text-xs font-semibold shadow-md">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-teal-200" />
            <span>
              <strong>Connection Restored:</strong> {outboxCount} operation{outboxCount > 1 ? 's' : ''} queued offline ready to sync.
            </span>
          </div>
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="bg-white text-blue-800 hover:bg-blue-50 px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Pending Operations'}
          </button>
        </div>
      )}

      {syncedSuccess && (
        <div className="bg-emerald-600 text-white px-4 py-2 flex items-center justify-between text-xs font-semibold shadow-md animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-200" />
            <span>All offline operations successfully synchronized with Supabase & Sage!</span>
          </div>
        </div>
      )}
    </div>
  );
}
