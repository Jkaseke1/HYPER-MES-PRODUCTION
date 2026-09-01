import { FileText } from 'lucide-react';
import MacropackReconReport from '../components/reports/MacropackReconReport';

export default function MacropackReconciliationReportPage() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-3 border-b border-slate-200 pb-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700"><FileText className="h-5 w-5" /></div>
        <div><h1 className="text-2xl font-bold text-slate-900">Macropack Reconciliation</h1><p className="mt-1 text-sm text-slate-500">Premix and pack production, conversion, closing stock, and variance analysis.</p></div>
      </div>
      <MacropackReconReport />
    </div>
  );
}
