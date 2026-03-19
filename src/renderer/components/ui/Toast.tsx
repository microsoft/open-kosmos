import React, { useEffect, useState, useRef } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export interface ToastMessage {
  id: string;
  message: string | React.ReactNode;
  type: 'success' | 'error' | 'warning' | 'info' | 'update';
  duration?: number;
  persistent?: boolean; // Whether to display persistently, don't auto-dismiss
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
      onClose(toast.id);
    }, 200); // Wait for exit animation to complete
  };

  const getTypeStyles = (type: ToastMessage['type']) => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-green-50/95',
          border: 'border-green-200/50',
          text: 'text-green-800',
          icon: CheckCircle,
          iconColor: 'text-green-600',
          progressBg: 'bg-green-500'
        };
      case 'error':
        return {
          bg: 'bg-red-50/95',
          border: 'border-red-200/50',
          text: 'text-red-800',
          icon: AlertCircle,
          iconColor: 'text-red-600',
          progressBg: 'bg-red-500'
        };
      case 'warning':
        return {
          bg: 'bg-amber-50/95',
          border: 'border-amber-200/50',
          text: 'text-amber-800',
          icon: AlertTriangle,
          iconColor: 'text-amber-600',
          progressBg: 'bg-amber-500'
        };
      case 'update':
        return {
          bg: 'bg-violet-50/95',
          border: 'border-violet-200/50',
          text: 'text-violet-800',
          icon: Info,
          iconColor: 'text-violet-600',
          progressBg: 'bg-violet-500'
        };
      case 'info':
      default:
        return {
          bg: 'bg-blue-50/95',
          border: 'border-blue-200/50',
          text: 'text-blue-800',
          icon: Info,
          iconColor: 'text-blue-600',
          progressBg: 'bg-blue-500'
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
        min-w-[300px] max-w-[450px] p-4
        flex flex-col space-y-3
        relative overflow-hidden
        transform transition-all duration-200 ease-out
        ${isVisible && !isClosing
          ? 'translate-x-0 opacity-100 scale-100'
          : 'translate-x-full opacity-0 scale-95'
        }
      `}
      style={{
        marginTop: index * 8, // Stack offset
        zIndex: 1000 - index // Later ones on top
      }}
    >

      {/* Top content area */}
      <div className="flex items-start space-x-3">
        {/* Icon */}
        <div className={`${styles.iconColor} flex-shrink-0 mt-0.5`}>
          <Icon size={18} />
        </div>

        {/* Message content */}
        <div className="flex-1 text-sm font-medium leading-relaxed whitespace-pre-line">
          {typeof toast.message === 'string' ? toast.message : toast.message}
        </div>

        {/* Close button */}
        <div className="flex items-center flex-shrink-0">
          <button
            onClick={handleClose}
            className={`
              ${styles.iconColor} hover:opacity-70
              p-1 rounded-md
              transition-opacity duration-150
            `}
            aria-label="Close notification"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Action buttons area */}
      {toast.actions && toast.actions.length > 0 && (
        <div className="flex items-center justify-end space-x-2 pt-2 border-t border-current/10">
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
                  ? `text-white bg-blue-600 hover:bg-blue-700`
                  : `${styles.text} hover:bg-current/5`
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
    <div className="fixed top-4 right-4 z-[9999] space-y-2 pointer-events-none">
      <div className="space-y-2 pointer-events-auto">
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