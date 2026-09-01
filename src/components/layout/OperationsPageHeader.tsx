import type { ComponentType, ReactNode } from 'react';
import { Database, RefreshCw } from 'lucide-react';

interface OperationsPageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  liveLabel: string;
  refreshLabel: string;
  onRefresh: () => void;
  actions?: ReactNode;
}

export default function OperationsPageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  liveLabel,
  refreshLabel,
  onRefresh,
  actions,
}: OperationsPageHeaderProps) {
  return (
    <section className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{eyebrow}</p>
          <h1 className="mt-0.5 text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <span className="inline-flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {liveLabel}
        </span>
        <span className="inline-flex items-center gap-2 border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
          <Database className="h-3.5 w-3.5 text-slate-400" />
          {refreshLabel}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-8 w-8 items-center justify-center border border-slate-300 bg-white text-slate-600 transition-colors hover:border-teal-500 hover:text-teal-700"
          title="Refresh page data"
          aria-label="Refresh page data"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        {actions}
      </div>
    </section>
  );
}
