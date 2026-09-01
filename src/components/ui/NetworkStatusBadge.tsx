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
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-extrabold tracking-wide transition-all shadow-xs border ${
        isOnline
          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
          : 'bg-rose-50 text-rose-800 border-rose-300'
      }`}
      title={isOnline ? 'System is Online — Supabase & Sage Connected' : 'System is Offline — Actions queued in IndexedDB'}
    >
      <span className="relative flex h-2.5 w-2.5">
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
            isOnline ? 'bg-emerald-400' : 'bg-rose-400'
          }`}
        />
        <span
          className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
            isOnline ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
        />
      </span>

      {isOnline ? (
        <span className="flex items-center gap-1">
          <Wifi className="w-3.5 h-3.5 text-emerald-600" />
          <span>ONLINE</span>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <WifiOff className="w-3.5 h-3.5 text-rose-600" />
          <span>OFFLINE</span>
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
