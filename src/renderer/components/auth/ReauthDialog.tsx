// src/renderer/components/auth/ReauthDialog.tsx
// Full-screen re-authentication dialog - based on UpdateDialog implementation
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';

export interface ReauthDialogProps {
  isOpen: boolean;
  reason?: string;
  userMessage?: string;
  onGitHubCopilotLogin: () => void;
}

export const ReauthDialog: React.FC<ReauthDialogProps> = ({
  isOpen,
  reason,
  userMessage,
  onGitHubCopilotLogin
}) => {
  // Prevent dialog from closing - cannot dismiss
  const handleOpenChange = (open: boolean) => {
    // Force stay open, do not allow user to close
    if (open === false) {
      return; // Prevent closing
    }
  };

  const handleGitHubLogin = () => {
    onGitHubCopilotLogin();
  };

  const getReasonText = () => {
    switch (reason) {
      case 'missing_access_token':
        return 'Access token missing';
      case 'missing_refresh_token':
        return 'Refresh token missing';
      case 'token_refresh_failed_should_clear_session':
        return 'Token refresh failed, session has expired';
      default:
        return 'Authentication has expired';
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm w-screen h-screen max-w-none">
        <div className="bg-white rounded-lg shadow-2xl w-full max-w-md mx-4 p-8 border border-gray-200">
          <DialogHeader className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-3xl">🔐</span>
              </div>
            </div>
            <DialogTitle className="text-xl font-semibold text-gray-900">
              Re-authentication Required
            </DialogTitle>
            <DialogDescription className="text-gray-600 mt-2">
              {getReasonText()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Authentication expired info */}
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                  <span className="text-red-600 text-xl">⚠️</span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-red-800 mb-1">
                    Authentication Session Expired
                  </h4>
                  <p className="text-sm text-red-700">
                    {userMessage || 'Your authentication token has expired or is invalid. Please sign in again to continue using the app.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Explanation info */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                  <span className="text-blue-600 text-xl">ℹ️</span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-blue-800 mb-1">
                    Why is re-authentication needed?
                  </h4>
                  <p className="text-sm text-blue-700">
                    To protect your account security, authentication tokens expire periodically. Please sign in again via GitHub Copilot to continue using all features.
                  </p>
                </div>
              </div>
            </div>

            {/* Login button */}
            <div className="space-y-4">
              <Button
                onClick={handleGitHubLogin}
                className="w-full bg-gray-900 hover:bg-gray-800 text-white py-3 px-4 rounded-md transition-colors font-medium"
                size="lg"
              >
                <div className="flex items-center justify-center gap-3">
                  <svg 
                    className="w-5 h-5" 
                    fill="currentColor" 
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Sign in with GitHub Copilot</span>
                </div>
              </Button>

              {/* Hint text */}
              <div className="text-center">
                <p className="text-xs text-gray-500">
                  Clicking the button above will open the GitHub Copilot authentication flow
                </p>
              </div>
            </div>
          </div>

          {/* Bottom notice */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="bg-yellow-50 p-3 rounded-lg">
              <p className="text-xs text-yellow-700 text-center">
                💡 This dialog cannot be closed. You must complete re-authentication to continue using the app
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReauthDialog;