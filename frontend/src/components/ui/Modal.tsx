import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
}

export function Modal({ open, onClose, title, children, size = 'lg', footer }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 md:p-6">
      <div
        className="fixed inset-0 bg-[#0a0b14]/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'relative panel-surface shadow-float w-full max-h-[92vh] sm:max-h-[90vh] flex flex-col animate-fade-in min-w-0 min-h-0 rounded-t-xl sm:rounded-xl outline-none',
          {
            'max-w-lg': size === 'md',
            'max-w-2xl': size === 'lg',
            'max-w-4xl': size === 'xl',
          }
        )}
      >
        <div className="panel-header flex shrink-0 items-center justify-between gap-2 px-4 sm:px-5 py-4 min-w-0">
          <h2 id={titleId} className="text-sm font-semibold text-primary-950 truncate min-w-0 flex-1">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-2 rounded-xl hover:bg-primary-100/80 text-primary-600 hover:text-primary-800 transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-primary-100 bg-white px-4 sm:px-6 py-4 rounded-b-xl sm:rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Scrollable form body + sticky footer inside modal scroll area */
export function ModalFormBody({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-0 max-h-[calc(92vh-5.5rem)] sm:max-h-[calc(90vh-5.5rem)]">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 space-y-4">{children}</div>
      <div className="shrink-0 pt-4 mt-4 border-t border-primary-100 bg-white">{footer}</div>
    </div>
  );
}
