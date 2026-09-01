import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, WifiOff, Home, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

function recoveryUrl(returnTo = window.location.hash || '#/') {
  return `${import.meta.env.BASE_URL}reset.html?returnTo=${encodeURIComponent(returnTo)}`;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    const isStaleModule = /dynamically imported module|failed to fetch dynamically imported module|importing a module script failed/i.test(error.message || '');
    const refreshKey = 'plantcontrol_cache_recovery_attempted';
    if (isStaleModule && navigator.onLine && !sessionStorage.getItem(refreshKey)) {
      // GitHub Pages deploys versioned chunks. Clear the retired browser cache once,
      // then return to the route the user was already working in.
      sessionStorage.setItem(refreshKey, 'true');
      window.location.replace(recoveryUrl());
    }
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorMessage = this.state.error?.message || '';
      const isStaleModule = /dynamically imported module|failed to fetch dynamically imported module|importing a module script failed/i.test(errorMessage);
      const isOffline = !navigator.onLine;

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="text-center p-8 max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl space-y-4">
            {isOffline || isStaleModule ? (
              <WifiOff className="h-14 w-14 text-amber-500 mx-auto" />
            ) : (
              <AlertTriangle className="h-14 w-14 text-rose-500 mx-auto" />
            )}

            <h1 className="text-xl font-bold text-slate-900">
              {isOffline ? 'Page Not Cached Offline' : isStaleModule ? 'Refreshing PlantControl' : 'Something went wrong'}
            </h1>

            <p className="text-xs text-slate-600 leading-relaxed">
              {isOffline
                ? 'This page is unavailable while offline. Reconnect and retry, or return to Dashboard.'
                : isStaleModule
                  ? 'A new PlantControl release was detected. Retry to load the current version.'
                : (this.state.error?.message || 'An unexpected error occurred')}
            </p>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => {
                  window.location.replace(recoveryUrl());
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>

              <button
                onClick={() => {
                  window.location.replace(recoveryUrl('#/'));
                }}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Home className="w-3.5 h-3.5" /> Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
