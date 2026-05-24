// src/renderer/components/auth/ReauthProvider.tsx - V2.0
// Listens to tokenMonitor's require_reauth event and shows a full-screen re-authentication Dialog
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

    // Only listen for the tokenMonitor:require_reauth event
    const handleRequireReauth = (event: CustomEvent) => {

      const { reason, userMessage } = event.detail;

      setReauthState({
        isOpen: true,
        reason: reason || 'token_expired',
        userMessage: userMessage || 'Authentication credentials have expired, please sign in again'
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

      // Step 1: Use AuthContext's signOut to clean up current auth - main process will handle the full cleanup flow
      const cleanupStart = Date.now();
      await signOut();
      const cleanupDuration = Date.now() - cleanupStart;

      // Close Dialog
      setReauthState({
        isOpen: false
      });

      // Dispatch sign-out event to re-render the app to the login page
      window.dispatchEvent(new CustomEvent('auth:signOut', {
        detail: {
          reason: 'reauth_initiated',
          source: 'ReauthProvider',
          comprehensiveCleanup: true // Flag that full cleanup has been performed
        }
      }));


    } catch (error) {

      // Try to clean up state even on error
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