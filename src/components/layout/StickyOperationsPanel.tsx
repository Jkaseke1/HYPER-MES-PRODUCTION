import type { ReactNode } from 'react';

interface StickyOperationsPanelProps {
  children: ReactNode;
}

export default function StickyOperationsPanel({ children }: StickyOperationsPanelProps) {
  return (
    <div className="sticky top-16 z-20 bg-slate-50 pb-3">
      {children}
    </div>
  );
}
