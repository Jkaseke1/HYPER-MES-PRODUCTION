import { ArrowRight } from 'lucide-react';
import type { ReconciliationPeriod } from '../../types/reconciliation';

interface StatisticsOverviewProps {
  period: ReconciliationPeriod;
}

interface FlowStep {
  label: string;
  value: number;
}

export default function StatisticsOverview({ period }: StatisticsOverviewProps) {
  const steps: FlowStep[] = [
    { label: 'Received Raw Materials', value: period.received_raw_materials_t },
    { label: 'Transferred Bulks RM to Prod', value: period.transferred_rm_to_prod_t },
    { label: 'Exp Production via Bulks', value: period.exp_production_via_bulks_t },
    { label: 'Exp Production via Macropacks', value: period.exp_production_via_macropacks_t },
    { label: 'Exp Production via Packaging', value: period.exp_production_via_packaging_t },
    { label: 'Actual Declared Production', value: period.actual_declared_production_t },
    { label: 'Transferred Prod to Dispatch', value: period.transferred_prod_to_dispatch_t },
    { label: 'Expected Dispatched', value: period.expected_dispatched_t },
    { label: 'Actual Dispatched', value: period.actual_dispatched_t },
  ];

  const maxVal = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">Monthly Production Flow</h3>
      <div className="space-y-3">
        {steps.map((step, i) => {
          const widthPct = Math.max((step.value / maxVal) * 100, 2);
          const prevValue = i > 0 ? steps[i - 1].value : null;
          const delta = prevValue !== null ? step.value - prevValue : 0;
          const deltaPct = prevValue ? (delta / prevValue) * 100 : 0;
          const isLoss = delta < 0;
          const severityClass = isLoss
            ? Math.abs(deltaPct) >= 5
              ? 'bg-red-100 text-red-700'
              : 'bg-amber-100 text-amber-700'
            : Math.abs(deltaPct) >= 5
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-100 text-slate-600';
          return (
            <div key={step.label} className="group">
              {i > 0 && (
                <div className="flex items-center gap-2 py-1 pl-4 text-xs">
                  <ArrowRight className="w-3 h-3 text-slate-300" />
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${severityClass}`}>
                    {isLoss ? '▼' : '▲'}
                    {Math.abs(delta).toFixed(0)} T ({deltaPct.toFixed(1)}%)
                  </span>
                </div>
              )}
              <div className="flex items-center gap-4">
                <div className="w-64 text-sm text-slate-600 text-right flex-shrink-0 font-medium">
                  {step.label}
                </div>
                <div className="flex-1 h-9 bg-slate-100 rounded-lg overflow-hidden relative">
                  <div
                    className="h-full rounded-lg transition-all duration-500 flex items-center px-3"
                    style={{
                      width: `${widthPct}%`,
                      background: i <= 1
                        ? 'linear-gradient(90deg, #0d9488, #14b8a6)'
                        : i <= 5
                        ? 'linear-gradient(90deg, #0284c7, #38bdf8)'
                        : 'linear-gradient(90deg, #059669, #34d399)',
                    }}
                  >
                    <span className="text-white text-sm font-bold whitespace-nowrap">
                      {step.value.toLocaleString()} T
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
