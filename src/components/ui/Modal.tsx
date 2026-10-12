import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: Size;
  closeOnBackdrop?: boolean;
}

const sizes: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Focus trap: keep Tab cycling inside the dialog.
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Initial focus into the dialog.
    const t = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
      if (prevFocus.current instanceof HTMLElement) prevFocus.current.focus();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeOnBackdrop ? onClose : undefined}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            className={cn(
              'relative w-full rounded-2xl border border-border bg-surface-overlay shadow-card',
              sizes[size],
            )}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                {title && <h3 id={titleId} className="text-lg font-semibold text-white">{title}</h3>}
                {description && <p id={descId} className="mt-1 text-sm text-muted-foreground">{description}</p>}
              </div>
              <button
                onClick={onClose}
                type="button"
                className="rounded-lg p-1 text-muted transition-colors hover:bg-white/5 hover:text-white"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-border p-5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
