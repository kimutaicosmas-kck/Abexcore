import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

export function Modal({ open, onClose, title, children, size = 'lg' }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 md:p-6">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className={clsx(
          'relative bg-white rounded-t-2xl sm:rounded-2xl shadow-float w-full max-h-[92vh] sm:max-h-[90vh] overflow-hidden flex flex-col ring-1 ring-border animate-fade-in min-w-0',
          {
            'max-w-lg': size === 'md',
            'max-w-2xl': size === 'lg',
            'max-w-4xl': size === 'xl',
          }
        )}
      >
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-border bg-surface-muted/40 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-slate-900 truncate min-w-0 flex-1">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-surface-subtle text-slate-500 hover:text-slate-700 transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto overflow-x-hidden p-4 sm:p-6 min-w-0">{children}</div>
      </div>
    </div>
  );
}
