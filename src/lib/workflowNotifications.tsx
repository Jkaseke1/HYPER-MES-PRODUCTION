import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import toast from 'react-hot-toast';

type NoticeTone = 'success' | 'error';

export function notifyWorkflow(title: string, message: string, tone: NoticeTone = 'success') {
  toast.custom((notice) => (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border bg-white p-4 shadow-xl shadow-slate-900/10 ${tone === 'error' ? 'border-rose-200' : 'border-emerald-200'}`}
    >
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone === 'error' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
        {tone === 'error' ? <AlertCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-1 break-words text-sm leading-5 text-slate-600">{message}</p>
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(notice.id)}
        className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ), { duration: tone === 'error' ? 7000 : 4000 });
}
