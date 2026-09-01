import { Badge } from './badge';
import { cn } from '../../lib/utils';

const statusStyles: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  draft: 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100',
  pending: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  rejected: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  inspecting: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  in_progress: 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100',
  materials_issued: 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100',
  loading: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  dispatched: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  in_transit: 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100',
  in_buffer: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  received: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  passed: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  failed: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  conditional: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  operational: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  maintenance: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  breakdown: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  decommissioned: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100',
  archived: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100',
  in_stock: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  low_stock: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  out_of_stock: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  low: 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100',
  normal: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  high: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  urgent: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  open: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  closed: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100',
  overdue: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const style = statusStyles[status] || 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100';
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Badge variant="outline" className={cn('border', style, className)}>
      {label}
    </Badge>
  );
}
