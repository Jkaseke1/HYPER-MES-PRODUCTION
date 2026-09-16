import { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { setupNetworkListeners } from '../../lib/offlineSync';

export default function NetworkStatusBadge() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [outboxCount, setOutboxCount] = useState(0);

  useEffect(() => {
    const cleanup = setupNetworkListeners((onlineStatus, count) => {
      setIsOnline(onlineStatus);
      setOutboxCount(count);
    });
    return cleanup;
  }, []);

  return (
    <div
      role="status"
      className={`inline-flex h-9 shrink-0 items-center gap-2 border-l border-slate-200 pl-3 text-xs font-medium ${
        isOnline
          ? 'text-slate-600'
          : 'text-red-700'
      }`}
      title={isOnline ? 'Browser network connection available' : `Browser offline. ${outboxCount} queued actions.`}
    >
      {isOnline ? (
        <span className="flex items-center gap-1">
          <Wifi className="w-3.5 h-3.5 text-emerald-600" />
          <span className="hidden sm:inline">Online</span>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <WifiOff className="w-3.5 h-3.5 text-rose-600" />
          <span className="hidden sm:inline">Offline</span>
          {outboxCount > 0 && (
            <span className="ml-1 bg-rose-200 text-rose-900 px-1.5 py-0.2 rounded-full font-mono text-[10px]">
              {outboxCount} Q
            </span>
          )}
        </span>
      )}
    </div>
  );
}
