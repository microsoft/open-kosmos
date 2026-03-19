import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Layout state interface
export interface LayoutState {
  leftPanelCollapsed: boolean;
  isMinimalMode: boolean;
  isAlwaysOnTop: boolean;
}

// Layout context interface
export interface LayoutContextValue extends LayoutState {
  toggleLeftPanel: () => void;
  toggleMinimalMode: () => void;
  setMinimalMode: (enabled: boolean) => void;
  toggleAlwaysOnTop: () => void;
  setAlwaysOnTop: (enabled: boolean) => void;
}

// Create the context
const LayoutContext = createContext<LayoutContextValue | undefined>(undefined);

// Hook to use the layout context
export const useLayout = (): LayoutContextValue => {
  const context = useContext(LayoutContext);
  if (context === undefined) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
};

// Layout provider props
interface LayoutProviderProps {
  children: ReactNode;
}

// Layout provider component
export const LayoutProvider: React.FC<LayoutProviderProps> = ({ children }) => {
  // State management
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [isMinimalMode, setIsMinimalMode] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTopState] = useState(false);

  // Toggle left panel collapsed state
  const toggleLeftPanel = () => {
    setLeftPanelCollapsed((prev) => !prev);
  };

  // Toggle minimal mode
  const toggleMinimalMode = () => {
    setIsMinimalMode((prev) => {
      const newMinimalMode = !prev;
      // When enabling minimal mode, automatically enable always-on-top
      // When exiting minimal mode, automatically disable always-on-top
      if (newMinimalMode) {
        setAlwaysOnTop(true);
      } else {
        setAlwaysOnTop(false);
      }
      return newMinimalMode;
    });
  };

  // Set minimal mode explicitly
  const setMinimalMode = (enabled: boolean) => {
    setIsMinimalMode(enabled);
    // When enabling minimal mode, automatically enable always-on-top
    // When exiting minimal mode, automatically disable always-on-top
    if (enabled) {
      setAlwaysOnTop(true);
    } else {
      setAlwaysOnTop(false);
    }
  };

  // Toggle always on top
  const toggleAlwaysOnTop = () => {
    setAlwaysOnTop(!isAlwaysOnTop);
  };

  // Set always on top explicitly
  const setAlwaysOnTop = async (enabled: boolean) => {
    try {
      if ((window as any).electronAPI?.window?.setAlwaysOnTop) {
        const success = await (window as any).electronAPI.window.setAlwaysOnTop(
          enabled,
        );
        if (success) {
          setIsAlwaysOnTopState(enabled);
        } else {
        }
      } else {
      }
    } catch (error) {}
  };

  // Initialize always on top state from electron
  useEffect(() => {
    const initAlwaysOnTopState = async () => {
      try {
        if ((window as any).electronAPI?.window?.isAlwaysOnTop) {
          const currentState = await (
            window as any
          ).electronAPI.window.isAlwaysOnTop();
          setIsAlwaysOnTopState(currentState);
        }
      } catch (error) {}
    };

    initAlwaysOnTopState();
  }, []);

  // Context value
  const value: LayoutContextValue = {
    leftPanelCollapsed,
    isMinimalMode,
    isAlwaysOnTop,
    toggleLeftPanel,
    toggleMinimalMode,
    setMinimalMode,
    toggleAlwaysOnTop,
    setAlwaysOnTop,
  };

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
};

export default LayoutProvider;