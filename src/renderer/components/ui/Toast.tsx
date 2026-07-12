import React, { useEffect, useState, useRef } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';

export interface ToastMessage {
  id: string;
  message: string | React.ReactNode;
  type: 'success' | 'error' | 'warning' | 'info' | 'update';
  duration?: number;
  persistent?: boolean; // Whether to display persistently, don't auto-dismiss
  onDismiss?: () => void;
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  }>;
}

interface ToastItemProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
  index: number;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose, index }) => {
  const { t } = useI18n();
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Enter animation
    const showTimer = setTimeout(() => setIsVisible(true), 10);

    // If it's a persistent toast, don't set auto-dismiss
    if (toast.persistent) {
      return () => {
        clearTimeout(showTimer);
        if (closeRef.current) clearTimeout(closeRef.current);
      };
    }

    // All non-persistent toasts auto-dismiss after 2 seconds
    const duration = toast.duration || 2000;

    // Auto-dismiss after duration
    const autoCloseTimer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(autoCloseTimer);
      if (closeRef.current) clearTimeout(closeRef.current);
    };
  }, [toast]);

  const handleClose = () => {
    if (isClosing) return;

    setIsClosing(true);

    closeRef.current = setTimeout(() => {
      toast.onDismiss?.();
      onClose(toast.id);
    }, 200); // Wait for exit animation to complete
  };

  const getTypeStyles = (type: ToastMessage['type']) => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-success-50/95',
          border: 'border-success-200/50',
          text: 'text-success-800',
          icon: CheckCircle,
          iconColor: 'text-success-600',
          progressBg: 'bg-success-500'
        };
      case 'error':
        return {
          bg: 'bg-danger-50/95',
          border: 'border-danger-200/50',
          text: 'text-danger-800',
          icon: AlertCircle,
          iconColor: 'text-danger-600',
          progressBg: 'bg-danger-500'
        };
      case 'warning':
        return {
          bg: 'bg-warning-50/95',
          border: 'border-warning-200/50',
          text: 'text-warning-800',
          icon: AlertTriangle,
          iconColor: 'text-warning-600',
          progressBg: 'bg-warning-500'
        };
      case 'update':
        return {
          bg: 'bg-primary-50/95',
          border: 'border-primary-200/50',
          text: 'text-primary-800',
          icon: Info,
          iconColor: 'text-primary-600',
          progressBg: 'bg-primary-500'
        };
      case 'info':
      default:
        return {
          bg: 'bg-primary-50/95',
          border: 'border-primary-200/50',
          text: 'text-primary-800',
          icon: Info,
          iconColor: 'text-primary-600',
          progressBg: 'bg-primary-500'
        };
    }
  };

  const styles = getTypeStyles(toast.type);
  const Icon = styles.icon;

  return (
    <div
      className={`
        ${styles.bg} ${styles.border} ${styles.text}
        backdrop-blur-md border rounded-lg shadow-lg
        p-4
        flex flex-col gap-3
        relative overflow-hidden
        transform transition-all duration-200 ease-out
        ${isVisible && !isClosing
          ? 'translate-x-0 opacity-100 scale-100'
          : 'translate-x-full opacity-0 scale-95'
        }
      `}
      style={{
        marginTop: index * 8, // Stack offset
        zIndex: 1000 - index, // Later ones on top
        width: 'min(28rem, calc(100vw - 2rem))',
        maxHeight: 'min(70vh, calc(100vh - 2rem))'
      }}
    >

      {/* Top content area */}
      <div className="flex items-start gap-3 min-w-0">
        {/* Icon */}
        <div className={`${styles.iconColor} shrink-0 mt-0.5`}>
          <Icon size={18} />
        </div>

        {/* Message content */}
        <div className="flex-1 min-w-0 max-h-[42vh] overflow-y-auto pr-1 text-sm font-medium leading-relaxed whitespace-pre-line wrap-anywhere">
          {typeof toast.message === 'string' ? toast.message : toast.message}
        </div>

        {/* Close button */}
        <div className="flex items-start shrink-0">
          <button
            onClick={handleClose}
            className={`
              ${styles.iconColor} hover:opacity-70
              p-1 rounded-md
              transition-opacity duration-150
            `}
            aria-label={t('common.closeNotification')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Action buttons area */}
      {toast.actions && toast.actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-current/10 shrink-0">
          {toast.actions.map((action, actionIndex) => (
            <button
              key={actionIndex}
              onClick={() => {
                action.onClick();
                // Always close toast when clicking action button
                handleClose();
              }}
              className={`
                px-3 py-1.5 text-xs font-medium rounded-md
                transition-colors duration-150
                ${action.variant === 'primary'
                  ? `toast-action-primary text-white bg-primary-600 hover:bg-primary-700`
                  : `toast-action-secondary ${styles.text} hover:bg-current/5`
                }
              `}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onClose: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onClose }) => {
  return (
    <div className="fixed top-4 right-4 left-4 sm:left-auto z-9999 pointer-events-none flex flex-col items-end max-h-[calc(100vh-2rem)]">
      <div className="space-y-2 pointer-events-auto overflow-y-auto max-h-[calc(100vh-2rem)] pr-1">
        {toasts.map((toast, index) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onClose={onClose}
            index={index}
          />
        ))}
      </div>
    </div>
  );
};