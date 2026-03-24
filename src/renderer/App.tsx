import React, { useEffect, useState } from 'react';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './components/auth/AuthProvider';
import { ReauthProvider } from './components/auth/ReauthProvider';
import { ProfileDataProvider } from './components/userData/userDataProvider';
import {
  ToastProvider,
  ToastContextSetter,
} from './components/ui/ToastProvider';
import { AppRoutes } from './routes/AppRoutes';
import WindowsTitleBar from './components/layout/WindowsTitleBar';
import { useMcpConnectionFailureToast } from './lib/mcp/useMcpConnectionFailureToast';
import { createLogger } from './lib/utilities/logger';

const logger = createLogger('[App]');

logger.debug('App component loaded');

/**
 * MCP Connection Failure Toast listener component
 * Must be used inside ToastProvider
 */
const McpConnectionFailureToastListener: React.FC = () => {
  useMcpConnectionFailureToast();
  return null;
};

const AppContent: React.FC = () => {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {/* McpConnectionFailureToastListener must be inside HashRouter because it uses useNavigate */}
      <McpConnectionFailureToastListener />
      <div className="h-screen flex flex-col overflow-hidden">
        <WindowsTitleBar />
        <div className="flex-1 min-h-0">
          <AppRoutes />
        </div>
      </div>
    </HashRouter>
  );
};

const App: React.FC = () => {
  logger.debug('Main App component rendering');

  // State to track if this is debug window
  const [isDebugWindow, setIsDebugWindow] = useState(
    (window as any).isDebugWindow || false,
  );
  // State to track token check status
  const [tokenCheckCompleted, setTokenCheckCompleted] = useState(false);
  // 🚀 State to track app readiness (backend services)
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    // Check initial readiness
    const checkReadiness = async () => {
      try {
        if ((window as any).electronAPI?.isReady) {
          const result = await (window as any).electronAPI.isReady();
          if (result.success && result.data) {
            setIsAppReady(true);
          }
        } else {
          setIsAppReady(true); // Fallback
        }
      } catch (e) {
        console.error('Readiness check failed', e);
        setIsAppReady(true); // Fail open
      }
    };
    checkReadiness();

    // Listen for ready event
    if ((window as any).electronAPI?.onAppReady) {
      return (window as any).electronAPI.onAppReady((ready: boolean) => {
        if (ready) setIsAppReady(true);
      });
    }
  }, []);

  useEffect(() => {
    // Listen for debug window ready event
    const handleDebugWindowReady = () => {
      setIsDebugWindow(true);
    };

    window.addEventListener('debugWindowReady', handleDebugWindowReady);

    // Also check periodically in case the flag was set before our listener
    const checkDebugFlag = () => {
      const debugFlag = (window as any).isDebugWindow;
      if (debugFlag && !isDebugWindow) {
        setIsDebugWindow(true);
      }
    };

    const interval = setInterval(checkDebugFlag, 100);

    // Clear after 5 seconds to avoid infinite checking
    setTimeout(() => {
      clearInterval(interval);
    }, 5000);

    return () => {
      window.removeEventListener('debugWindowReady', handleDebugWindowReady);
      clearInterval(interval);
    };
  }, [isDebugWindow]);

  // 🔧 Token monitoring is automatically managed by the main process's setCurrentAuth()
  useEffect(() => {
    setTokenCheckCompleted(true);
  }, [isDebugWindow]);

  // 🔧 Add token monitor event listeners for debugging and verification
  useEffect(() => {
    const handleTokenMonitorEvent = (event: CustomEvent) => {
      // logger.debug(`[TokenMonitor] Event received: ${event.type}`, event.detail);
    };

    // Listen for various token monitor events
    window.addEventListener(
      'tokenMonitor:monitor_started',
      handleTokenMonitorEvent as EventListener,
    );
    window.addEventListener(
      'tokenMonitor:monitor_stopped',
      handleTokenMonitorEvent as EventListener,
    );
    window.addEventListener(
      'tokenMonitor:refresh_success',
      handleTokenMonitorEvent as EventListener,
    );
    window.addEventListener(
      'tokenMonitor:refresh_failed_recoverable',
      handleTokenMonitorEvent as EventListener,
    );
    window.addEventListener(
      'tokenMonitor:require_reauth',
      handleTokenMonitorEvent as EventListener,
    );

    // General auth:monitor event
    window.addEventListener(
      'auth:monitor',
      handleTokenMonitorEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'tokenMonitor:monitor_started',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'tokenMonitor:monitor_stopped',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'tokenMonitor:refresh_success',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'tokenMonitor:refresh_failed_recoverable',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'tokenMonitor:require_reauth',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'auth:monitor',
        handleTokenMonitorEvent as EventListener,
      );
    };
  }, []);

  if (isDebugWindow) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Debug Mode Unavailable</h2>
          <p className="text-neutral-600">
            Debug window functionality has been removed.
          </p>
        </div>
      </div>
    );
  }

  // 🚀 Loading Screen (Wait for Backend Services)
  if (!isAppReady) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#1c1c1c] text-white gap-6 select-none app-drag-region">
        {/* Logo/Icon Area */}
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 animate-pulse flex items-center justify-center shadow-lg shadow-purple-500/20">
             <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
             </svg>
          </div>
        </div>
        
        {/* Loading Text */}
        <div className="flex flex-col items-center gap-2">
          <div className="text-neutral-200 font-medium text-lg tracking-wide">OpenKosmos</div>
          <div className="flex items-center gap-2 text-neutral-500 text-sm">
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Initializing Core Services...</span>
          </div>
        </div>
      </div>
    );
  }

  // Render main application with AuthProvider V2.0
  return (
    <ToastProvider>
      <ToastContextSetter />
      <AuthProvider>
        <ReauthProvider>
          <ProfileDataProvider>
            <AppContent />
          </ProfileDataProvider>
        </ReauthProvider>
      </AuthProvider>
    </ToastProvider>
  );
};

export default App;
