import React, { useEffect } from 'react';
import { StartupValidationResult } from '../../types/startupValidationTypes';
import { createLogger } from '../../lib/utilities/logger';

const logger = createLogger('[AutoLoginSingleUser]');

interface AutoLoginSingleUserProps {
  startupValidationResult: StartupValidationResult;
  onSuccess?: () => void;
  onFailure?: (error: Error) => void;
}

export const AutoLoginSingleUser: React.FC<AutoLoginSingleUserProps> = ({ 
  startupValidationResult,
  onSuccess,
  onFailure
}) => {
  useEffect(() => {
    const autoLoginSingleUser = async () => {
      try {
        // Get the only valid user
        const validUser = startupValidationResult.stage2.validUsers[0];
        if (validUser && validUser.authData) {
          
          // Set current auth via AuthManager
          const { AuthManagerProxy } = await import('../../lib/auth/authManagerProxy');
          const authManager = new AuthManagerProxy();
          await authManager.setCurrentAuth(validUser.authData);
          
          // Trigger auth success event to let app enter normal data loading flow
          window.dispatchEvent(new CustomEvent('ghc:authSuccess', {
            detail: {
              authData: validUser.authData,
              autoLogin: true
            }
          }));

          if (onSuccess) onSuccess();
        } else {
            throw new Error('No valid user found for auto-login');
        }
      } catch (error) {
        logger.error('[AutoLoginSingleUser] Auto-login failed:', error);
        // If auto-login fails, trigger error event
        window.dispatchEvent(new CustomEvent('autoLogin:failed', {
          detail: { error: error instanceof Error ? error.message : 'Auto login failed' }
        }));
        if (onFailure) onFailure(error instanceof Error ? error : new Error(String(error)));
      }
    };
    
    autoLoginSingleUser();
  }, [startupValidationResult, onSuccess, onFailure]);

  // Show loading state while waiting for auto-login to complete
  return (
    <div className="h-full flex flex-col glass-container">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center glass-card p-12 max-w-sm mx-auto">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-primary-500/30 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <h2 className="text-xl font-semibold text-neutral-700 mb-2">Signing In...</h2>
          <p className="text-neutral-500 text-sm">Loading your profile...</p>
        </div>
      </div>
    </div>
  );
};
