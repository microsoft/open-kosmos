// src/renderer/components/ui/dialog.tsx
import React from 'react';
import { cn } from '../../lib/utilities/utils';
import { useI18n } from '../../lib/i18n/useI18n';

const DialogCloseContext = React.createContext<(() => void) | null>(null);

/**
 * Wiring so the modal container can advertise its accessible name/description.
 * Each DialogTitle/DialogDescription owns its own id (caller-supplied or auto) and
 * reports it up; DialogContent points `aria-labelledby`/`aria-describedby` at exactly
 * that id, and only when the element is actually mounted (no dangling references).
 */
interface DialogA11yContextValue {
  setTitleId: (id: string | null) => void;
  setDescriptionId: (id: string | null) => void;
}
const DialogA11yContext = React.createContext<DialogA11yContextValue | null>(null);

let dialogIdCounter = 0;

interface DialogRegistryEntry {
  close: () => void;
  contentRef: React.RefObject<HTMLDivElement>;
}
const dialogRegistry = new Map<number, DialogRegistryEntry>();

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Shared key handler for every open Dialog. Only the topmost dialog (highest id)
 * reacts, so nested dialogs behave correctly. Escape closes the topmost; Tab is
 * trapped inside the topmost content so keyboard focus can never reach the inert
 * background behind the modal.
 */
function handleGlobalKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' && e.key !== 'Tab') return;
  let maxId = -1;
  let top: DialogRegistryEntry | null = null;
  for (const [id, entry] of dialogRegistry) {
    if (id > maxId) {
      maxId = id;
      top = entry;
    }
  }
  if (!top) return;

  if (e.key === 'Escape') {
    e.stopPropagation();
    top.close();
    return;
  }

  const contentEl = top.contentRef.current;
  if (!contentEl) return;
  const focusable = getFocusableElements(contentEl);
  const active = document.activeElement;
  if (focusable.length === 0) {
    e.preventDefault();
    contentEl.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const inside = contentEl.contains(active);
  if (e.shiftKey) {
    if (!inside || active === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
  }
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children, className }) => {
  const handleClose = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const idRef = React.useRef<number | null>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  if (open && idRef.current === null) {
    idRef.current = ++dialogIdCounter;
  }

  React.useEffect(() => {
    if (!open) return;
    const id = idRef.current!;
    if (dialogRegistry.size === 0) {
      document.addEventListener('keydown', handleGlobalKeyDown);
    }
    dialogRegistry.set(id, { close: handleClose, contentRef });

    // Move focus into the dialog, remembering where to send it back on close.
    const previouslyFocused = document.activeElement;
    const contentEl = contentRef.current;
    if (contentEl) {
      const focusable = getFocusableElements(contentEl);
      (focusable[0] ?? contentEl).focus();
    }

    return () => {
      dialogRegistry.delete(id);
      idRef.current = null;
      if (dialogRegistry.size === 0) {
        document.removeEventListener('keydown', handleGlobalKeyDown);
      }
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <DialogCloseContext.Provider value={handleClose}>
      <div className={cn("fixed inset-0 z-50 flex items-center justify-center", className)}>
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-[6px] dialog-overlay-animate"
          onClick={handleClose}
        />
        <div
          ref={contentRef}
          tabIndex={-1}
          className="relative z-10 dialog-content-animate focus:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </DialogCloseContext.Provider>
  );
};

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, ...props }, ref) => {
    const [titleId, setTitleId] = React.useState<string | null>(null);
    const [descriptionId, setDescriptionId] = React.useState<string | null>(null);
    const a11y = React.useMemo<DialogA11yContextValue>(
      () => ({ setTitleId, setDescriptionId }),
      []
    );
    return (
      <DialogA11yContext.Provider value={a11y}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId ?? undefined}
          aria-describedby={descriptionId ?? undefined}
          className={cn(
            'bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6',
            className
          )}
          {...props}
        >
          {children}
        </div>
      </DialogA11yContext.Provider>
    );
  }
);

DialogContent.displayName = 'DialogContent';

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  hideCloseButton?: boolean;
}

export const DialogHeader = React.forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ className, children, hideCloseButton, ...props }, ref) => {
    const { t } = useI18n();
    const handleClose = React.useContext(DialogCloseContext);
    const showClose = handleClose && !hideCloseButton;

    return (
      <div
        ref={ref}
        className={cn('flex flex-col space-y-1.5 text-center sm:text-left relative', showClose && 'pr-8', className)}
        {...props}
      >
        {children}
        {showClose && (
          <button
            type="button"
            onClick={handleClose}
            className="absolute -right-1 -top-1 p-1.5 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2"
            aria-label={t('common.close')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    );
  }
);

DialogHeader.displayName = 'DialogHeader';

export interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  className?: string;
}

export const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(
  ({ className, id, ...props }, ref) => {
    const a11y = React.useContext(DialogA11yContext);
    const autoId = React.useId();
    const resolvedId = id ?? autoId;
    React.useEffect(() => {
      if (!a11y) return;
      a11y.setTitleId(resolvedId);
      return () => a11y.setTitleId(null);
    }, [a11y, resolvedId]);
    return (
      <h2
        ref={ref}
        id={resolvedId}
        className={cn('text-lg font-semibold leading-none tracking-tight', className)}
        {...props}
      />
    );
  }
);

DialogTitle.displayName = 'DialogTitle';

export interface DialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  className?: string;
}

export const DialogDescription = React.forwardRef<HTMLParagraphElement, DialogDescriptionProps>(
  ({ className, id, ...props }, ref) => {
    const a11y = React.useContext(DialogA11yContext);
    const autoId = React.useId();
    const resolvedId = id ?? autoId;
    React.useEffect(() => {
      if (!a11y) return;
      a11y.setDescriptionId(resolvedId);
      return () => a11y.setDescriptionId(null);
    }, [a11y, resolvedId]);
    return (
      <p
        ref={ref}
        id={resolvedId}
        className={cn('text-sm text-neutral-500', className)}
        {...props}
      />
    );
  }
);

DialogDescription.displayName = 'DialogDescription';

export interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const DialogFooter = React.forwardRef<HTMLDivElement, DialogFooterProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
        {...props}
      />
    );
  }
);

DialogFooter.displayName = 'DialogFooter';
