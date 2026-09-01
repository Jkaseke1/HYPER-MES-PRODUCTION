import { ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { cn } from '../../lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  className?: string;
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl',
  '4xl': 'max-w-7xl',
};

export default function Modal({ open, onClose, title, children, footer, size = 'md', className }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={cn(sizeClasses[size], 'max-h-[92vh] flex flex-col p-0 overflow-hidden', className)}>
        <DialogHeader className="shrink-0 bg-gradient-to-r from-[#06061c] via-[#0b0c36] to-[#080829] text-white px-6 py-4 border-b border-orange-500/30">
          <DialogTitle className="text-white font-black text-xl tracking-tight">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">{children}</div>
        {footer && (
          <DialogFooter className="shrink-0 bg-white border-t border-slate-200 px-6 py-3.5 flex justify-end gap-3">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
