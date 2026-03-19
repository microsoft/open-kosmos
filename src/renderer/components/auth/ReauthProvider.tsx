// src/renderer/components/auth/ReauthProvider.tsx - V2.0
// Listen for tokenMonitor require_reauth event and display full-screen re-authentication dialog
import React, { useEffect, useState } from 'react';
import { useAuthContext } from './AuthProvider';
import { ReauthDialog } from './ReauthDialog';

interface ReauthState {
  isOpen: boolean;
  reason?: string;
  userMessage?: string;
}

export const ReauthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [reauthState, setReauthState] = useState<ReauthState>({
    isOpen: false
  });

  useEffect(() => {
    
    // Only listen for tokenMonitor:require_reauth event
    const handleRequireReauth = (event: CustomEvent) => {
      
      const { reason, userMessage } = event.detail;
      
      setReauthState({
        isOpen: true,
        reason: reason || 'token_expired',
        userMessage: userMessage || 'Authentication has expired. Please sign in again'
      });
    };

    window.addEventListener('tokenMonitor:require_reauth', handleRequireReauth as EventListener);

    return () => {
      window.removeEventListener('tokenMonitor:require_reauth', handleRequireReauth as EventListener);
    };
  }, []);

  const { signOut } = useAuthContext();

  const handleGitHubCopilotLogin = async () => {
    
    try {
      
      // Step 1: Use AuthContext's signOut to clean current auth - main process handles complete cleanup flow
      const cleanupStart = Date.now();
      await signOut();
      const cleanupDuration = Date.now() - cleanupStart;
      
      // Close dialog
      setReauthState({
        isOpen: false
      });
      
      // Dispatch sign-out event to let app re-render to sign-in page
      window.dispatchEvent(new CustomEvent('auth:signOut', {
        detail: {
          reason: 'reauth_initiated',
          source: 'ReauthProvider',
          comprehensiveCleanup: true // Flag that comprehensive cleanup has been performed
        }
      }));
      
      
    } catch (error) {
      
      // Try to clean up state even if an error occurs
      setReauthState({
        isOpen: false
      });
      
      // Force dispatch sign-out event
      window.dispatchEvent(new CustomEvent('auth:signOut', {
        detail: {
          reason: 'reauth_error',
          error: error instanceof Error ? error.message : String(error),
          source: 'ReauthProvider'
        }
      }));
    }
  };

  return (
    <>
      {children}
      <ReauthDialog
        isOpen={reauthState.isOpen}
        reason={reauthState.reason}
        userMessage={reauthState.userMessage}
        onGitHubCopilotLogin={handleGitHubCopilotLogin}
      />
    </>
  );
};

export default ReauthProvider;