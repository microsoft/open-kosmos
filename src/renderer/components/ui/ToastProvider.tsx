import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { ToastContainer, ToastMessage } from './Toast';

interface ToastContextType {
  showToast: (message: string | React.ReactNode, type?: ToastMessage['type'], duration?: number, options?: Partial<Pick<ToastMessage, 'persistent' | 'actions'>>) => string;
  showSuccess: (message: string | React.ReactNode, duration?: number) => void;
  showError: (message: string | React.ReactNode, duration?: number) => void;
  showWarning: (message: string | React.ReactNode, duration?: number) => void;
  showInfo: (message: string | React.ReactNode, duration?: number) => void;
  showUpdateToast: (message: string | React.ReactNode, actions: ToastMessage['actions'], persistent?: boolean) => void;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: ReactNode;
  maxToasts?: number; // Maximum number of notifications to display simultaneously
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ 
  children, 
  maxToasts = 5 
}) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: ToastMessage) => {
    setToasts(prev => {
      // Check if a toast with the same message and type already exists
      const isDuplicate = prev.some(existingToast => {
        // For same type toasts
        if (existingToast.type !== toast.type) return false;
        
        // For string messages, compare directly
        if (typeof existingToast.message === 'string' && typeof toast.message === 'string') {
          return existingToast.message === toast.message;
        }
        
        // For React nodes, convert to string and compare
        if (typeof existingToast.message === 'object' && typeof toast.message === 'object') {
          // Try to extract text content for comparison
          const existingText = getTextContent(existingToast.message);
          const newText = getTextContent(toast.message);
          return existingText === newText && existingText.length > 0;
        }
        
        return false;
      });
      
      // If duplicate exists, don't add the new toast
      if (isDuplicate) {
        return prev;
      }
      
      // If exceeding maximum count, remove the oldest
      const newToasts = prev.length >= maxToasts
        ? prev.slice(1)
        : prev;
      
      return [...newToasts, toast];
    });
  }, [maxToasts]);

  // Helper function to extract text content from React nodes
  const getTextContent = (node: any): string => {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (!node) return '';
    
    if (React.isValidElement(node)) {
      // If it has children, recursively get text from children
      const props = node.props as any;
      if (props && props.children) {
        if (Array.isArray(props.children)) {
          return props.children.map(getTextContent).join('');
        }
        return getTextContent(props.children);
      }
    }
    
    if (Array.isArray(node)) {
      return node.map(getTextContent).join('');
    }
    
    return '';
  };

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  const showToast = useCallback((
    message: string | React.ReactNode,
    type: ToastMessage['type'] = 'info',
    duration: number = 2000,
    options?: Partial<Pick<ToastMessage, 'persistent' | 'actions'>>
  ): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast: ToastMessage = {
      id,
      message,
      type,
      duration,
      persistent: options?.persistent || false,
      actions: options?.actions
    };
    addToast(newToast);
    return id;
  }, [addToast]);

  const showSuccess = useCallback((message: string | React.ReactNode, duration: number = 2000) => {
    showToast(message, 'success', duration);
  }, [showToast]);

  const showError = useCallback((message: string | React.ReactNode, duration: number = 2000) => {
    showToast(message, 'error', duration);
  }, [showToast]);

  const showWarning = useCallback((message: string | React.ReactNode, duration: number = 2000) => {
    showToast(message, 'warning', duration);
  }, [showToast]);

  const showInfo = useCallback((message: string | React.ReactNode, duration: number = 2000) => {
    showToast(message, 'info', duration);
  }, [showToast]);

  const showUpdateToast = useCallback((
    message: string | React.ReactNode,
    actions: ToastMessage['actions'],
    persistent: boolean = true
  ) => {
    showToast(message, 'update', undefined, { persistent, actions });
  }, [showToast]);

  const contextValue: ToastContextType = {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showUpdateToast,
    removeToast,
    clearAll
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </ToastContext.Provider>
  );
};

// Convenient functional call methods (optional)
export class ToastManager {
  private static toastContext: ToastContextType | null = null;

  static setContext(context: ToastContextType) {
    this.toastContext = context;
  }

  static success(message: string | React.ReactNode, duration?: number) {
    if (this.toastContext) {
      this.toastContext.showSuccess(message, duration);
    } else {
    }
  }

  static error(message: string | React.ReactNode, duration?: number) {
    if (this.toastContext) {
      this.toastContext.showError(message, duration);
    } else {
    }
  }

  static warning(message: string | React.ReactNode, duration?: number) {
    if (this.toastContext) {
      this.toastContext.showWarning(message, duration);
    } else {
    }
  }

  static info(message: string | React.ReactNode, duration?: number) {
    if (this.toastContext) {
      this.toastContext.showInfo(message, duration);
    } else {
    }
  }
}

// Used to automatically set context inside ToastProvider
export const ToastContextSetter: React.FC = () => {
  const toastContext = useToast();
  
  React.useEffect(() => {
    ToastManager.setContext(toastContext);
    return () => {
      ToastManager.setContext(null as any);
    };
  }, [toastContext]);

  return null;
};