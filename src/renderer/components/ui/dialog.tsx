// src/renderer/components/ui/dialog.tsx
import React from 'react';
import { cn } from '../../lib/utilities/utils';

const DialogCloseContext = React.createContext<(() => void) | null>(null);

let dialogIdCounter = 0;
const dialogRegistry = new Map<number, () => void>();

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && dialogRegistry.size > 0) {
    e.stopPropagation();
    let maxId = -1;
    let topHandler: (() => void) | undefined;
    for (const [id, handler] of dialogRegistry) {
      if (id > maxId) {
        maxId = id;
        topHandler = handler;
      }
    }
    topHandler?.();
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
  if (open && idRef.current === null) {
    idRef.current = ++dialogIdCounter;
  }

  React.useEffect(() => {
    if (!open) {
      if (idRef.current !== null) {
        dialogRegistry.delete(idRef.current);
        idRef.current = null;
        if (dialogRegistry.size === 0) {
          document.removeEventListener('keydown', handleGlobalKeyDown);
        }
      }
      return;
    }
    const id = idRef.current!;
    if (dialogRegistry.size === 0) {
      document.addEventListener('keydown', handleGlobalKeyDown);
    }
    dialogRegistry.set(id, handleClose);
    return () => {
      dialogRegistry.delete(id);
      idRef.current = null;
      if (dialogRegistry.size === 0) {
        document.removeEventListener('keydown', handleGlobalKeyDown);
      }
    };
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <DialogCloseContext.Provider value={handleClose}>
      <div className={cn("fixed inset-0 z-50 flex items-center justify-center", className)}>
        <div
          className="fixed inset-0 bg-black/50"
          onClick={handleClose}
        />
        <div className="relative z-10" onClick={(e) => e.stopPropagation()}>
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
    return (
      <div
        ref={ref}
        className={cn(
          'bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

DialogContent.displayName = 'DialogContent';

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const DialogHeader = React.forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ className, children, ...props }, ref) => {
    const handleClose = React.useContext(DialogCloseContext);

    return (
      <div
        ref={ref}
        className={cn('flex flex-col space-y-1.5 text-center sm:text-left relative', handleClose && 'pr-8', className)}
        {...props}
      >
        {children}
        {handleClose && (
          <button
            type="button"
            onClick={handleClose}
            className="absolute right-0 top-0 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
            aria-label="Close"
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
  ({ className, ...props }, ref) => {
    return (
      <h2
        ref={ref}
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
  ({ className, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn('text-sm text-gray-500', className)}
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
