interface VarianceCellProps {
  value: number;
  format?: 'number' | 'percentage';
}

export default function VarianceCell({ value, format = 'number' }: VarianceCellProps) {
  const isNegative = value < 0;
  const isZero = value === 0;
  const absVal = Math.abs(value);

  const thresholds = format === 'percentage'
    ? [1, 3, 5, 10]
    : [5, 20, 50, 100];

  let bgClass = 'bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-800';
  if (isNegative) bgClass = 'bg-gradient-to-r from-rose-50 to-rose-100 text-rose-700';
  if (isZero) bgClass = 'bg-slate-100 text-slate-600';

  thresholds.forEach((threshold, idx) => {
    if (absVal >= threshold) {
      if (isNegative) {
        bgClass = ['bg-rose-50 text-rose-600', 'bg-rose-100 text-rose-700', 'bg-rose-200 text-rose-800', 'bg-rose-300 text-rose-900'][Math.min(idx, 3)];
      } else {
        bgClass = ['bg-emerald-50 text-emerald-600', 'bg-amber-50 text-amber-600', 'bg-amber-100 text-amber-700', 'bg-amber-200 text-amber-900'][Math.min(idx, 3)];
      }
    }
  });

  const indicator = isZero ? '■' : isNegative ? '▼' : '▲';

  const display = format === 'percentage'
    ? `${value.toFixed(2)}%`
    : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${bgClass}`}>
      <span>{indicator}</span>
      <span>{display}</span>
    </span>
  );
}
