// src/renderer/components/pages/SignInPage.tsx (Enhanced version)
// Strictly implemented according to design document lines 648-855
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../ui/ToastProvider';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { StartupValidationResult } from '../../types/startupValidationTypes';
import '../../styles/SignInPage.css';
import { APP_NAME } from '@shared/constants/branding';

interface SignInPageProps {
  // SignInPage can optionally receive pre-scanned startup results
  startupResult?: StartupValidationResult;
}

export const SignInPage: React.FC<SignInPageProps> = ({ startupResult }) => {
  const componentStartTime = Date.now();
  
  // 🔥 Optimization: Remove sessionStorage read to avoid blocking render
  // sessionStorage operations may block due to browser security policies or storage quota checks
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null);
  const [profilesWithAuth, setProfilesWithAuth] = useState<any[]>([]);
  const [showProfileSelection, setShowProfileSelection] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [showGhcDeviceFlow, setShowGhcDeviceFlow] = useState(false);
  const [deviceCode, setDeviceCode] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [showGeneratingCode, setShowGeneratingCode] = useState(false);
  
  
  // Use ref to prevent state loss on component remount
  const isInitialized = useRef(false);

  // 🔥 New architecture: Receive pre-processed results from StartupPage
  useEffect(() => {
    const effectStartTime = Date.now();
    
    if (isInitialized.current) {
      return;
    }
    isInitialized.current = true;

    const processStartupResults = async () => {
      setIsScanning(true);
      
      try {
        
        // 🔥 New: Debug the entire startupResult object in detail
        
        // Check if we have startupResult from StartupPage validation
        if (startupResult?.stage2) {
          
          // 🔥 Prioritize using AuthManager pre-processed results
          if (startupResult.stage2.authManagerInitialized && startupResult.stage2.authManagerProfiles?.length > 0) {
            
            const allProfilesWithAuth = startupResult.stage2.authManagerProfiles.map((profile: any) => ({
              ...profile,
              isValid: profile.type === 'valid',
              isExpired: profile.type === 'recoverable',
              isRecoverable: profile.type === 'recoverable'
            }));
            
            setProfilesWithAuth(allProfilesWithAuth);
            setShowProfileSelection(allProfilesWithAuth.length > 0);
            
          } else {
            
            // Use results in traditional format
            const allProfilesWithAuth = [
              ...(startupResult.stage2.validUsers || []),
              ...(startupResult.stage2.expiredUsers || []).map((expired: any) => ({
                ...expired,
                isExpired: true
              }))
            ];
            
            setProfilesWithAuth(allProfilesWithAuth);
            setShowProfileSelection(allProfilesWithAuth.length > 0);
          }
          
        } else {
          setProfilesWithAuth([]);
          setShowProfileSelection(false);
        }

      } catch (error) {
        setProfilesWithAuth([]);
        setShowProfileSelection(false);
      } finally {
        setIsScanning(false);
      }
    };

    processStartupResults();
  }, [startupResult]);
  

  // 🔥 Optimization: Remove sessionStorage persistence to avoid blocking from frequent writes
  // SignInPage is a temporary page, no need to persist state
  // useEffect(() => {
  //   sessionStorage.setItem('signin-isLoading', JSON.stringify(isLoading));
  // }, [isLoading]);
  
  // ... other sessionStorage operations removed

  // Device code countdown
  useEffect(() => {
    if (deviceCode && showGhcDeviceFlow && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [deviceCode, showGhcDeviceFlow, timeLeft]);
  
  const { showError, showSuccess } = useToast();
  // Auth functionality is now handled through main process

  // 🔥 Directly use AuthData without any mapping or rebuilding
  const handleProfileSelect = async (profile: any) => {
    try {
      setIsLoading(true);
      
      
      const { AuthManagerProxy } = await import('../../lib/auth/authManagerProxy');
      const authManager = new AuthManagerProxy();
      
      // 🔥 Directly use AuthData
      const authData = profile.authData;
      
      if (!authData) {
        throw new Error('Profile missing AuthData');
      }
      
      // 🔥 Debug authData structure in detail
      
      // Validate authData structure completeness
      if (!authData.ghcAuth) {
        throw new Error('AuthData missing ghcAuth field');
      }
      if (!authData.ghcAuth.user) {
        throw new Error('AuthData.ghcAuth missing user field');
      }
      if (!authData.ghcAuth.user.login) {
        throw new Error('AuthData.ghcAuth.user missing login field');
      }
      
      
      // 🔥 Fix: Check if this is a verified Profile (has valid GitHub token)
      if (profile.isValid) {
        
        // Use new AuthData API - setCurrentAuth internally calls handlePostAuthentication to complete initialization
        await authManager.setCurrentAuth(authData);
        
          
        // Trigger auth success event, notify App.tsx for route navigation
        const authSuccessEvent = new CustomEvent('ghc:authSuccess', {
          detail: {
            authData: authData,
            provider: 'ghc',
            source: 'signin_page_valid_profile'
          }
        });
        
        window.dispatchEvent(authSuccessEvent);
        
        
      } else if (profile.isRecoverable) {
        
        // Set AuthData first, then refresh Token
        await authManager.setCurrentAuth(authData);
        
        const refreshResult = await authManager.refreshCopilotToken();
        
        if (refreshResult.success && refreshResult.authData) {
          
          // Trigger auth success event
          const authSuccessEvent = new CustomEvent('ghc:authSuccess', {
            detail: {
              authData: refreshResult.authData,
              sessionId: profile.sessionId,
              provider: 'ghc',
              source: 'signin_page_recovered_profile'
            }
          });
          
          window.dispatchEvent(authSuccessEvent);
          
        } else {
          await handleExpiredProfileReauth(profile);
          return;
        }
        
      } else {
        await handleExpiredProfileReauth(profile);
        return;
      }
      
      // Reset loading state, wait for App.tsx to handle navigation
      setTimeout(() => {
        setIsLoading(false);
      }, 100);
      
    } catch (error) {
      showError('Login failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsLoading(false);
    }
  };

  // Handle expired profile re-authentication
  const handleExpiredProfileReauth = async (expiredProfile: any) => {
    try {
      setIsLoading(true);
      
      
      // Clear the expired auth data first
      if ((window as any).electronAPI?.authOps) {
        try {
          await (window as any).electronAPI.authOps.clearAuthData(expiredProfile.alias);
        } catch (clearError) {
        }
      }
      
      // Start new GitHub OAuth flow
      setShowProfileSelection(false);
      await handleGhcSignIn();
      
    } catch (error) {
      showError('Re-authentication failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsLoading(false);
    }
  };

  const handleUseGitHubAuth = () => {
    setShowProfileSelection(false);
  };

  // Define callback functions
  const handleDeviceCode = useCallback((event: CustomEvent) => {
    if (process.env.NODE_ENV === 'development') {
    }
    const deviceCodeData = event.detail;
    setDeviceCode(deviceCodeData);
    
    // Set countdown
    setTimeLeft(deviceCodeData.expires_in);
    
    // Automatically copy device code to clipboard
    if (deviceCodeData.user_code) {
      navigator.clipboard.writeText(deviceCodeData.user_code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        // Clipboard copy failed, user can still manually copy
      });
    }
    
    // Automatically open GitHub authorization page (via Microsoft SSO)
    if (deviceCodeData.verification_uri) {
      const ssoUrl = "https://github.com/enterprises/microsoft/sso?return_to=" + deviceCodeData.verification_uri;
      window.open(ssoUrl, '_blank');
    }
    
    // Directly show device code interface
    setTimeout(() => {
      setShowGeneratingCode(false);
      setShowGhcDeviceFlow(true);
    }, 800);
  }, []);

  const clearSessionState = () => {
    // 🔥 Optimization: sessionStorage operations removed, this function kept for compatibility
    // sessionStorage.removeItem('signin-isLoading');
    // sessionStorage.removeItem('signin-showGhcDeviceFlow');
    // sessionStorage.removeItem('signin-deviceCode');
    // sessionStorage.removeItem('signin-showGeneratingCode');
  };

  const handleAuthSuccess = useCallback(async (event: Event) => {
    const customEvent = event as CustomEvent;
    if (process.env.NODE_ENV === 'development') {
    }
    
    try {
      setShowGhcDeviceFlow(false);
      
      // 🔥 Fix: Check event source to distinguish between existing user and new user authentication
      const authData = customEvent.detail?.authData; // For existing users (from handleProfileSelect)
      const authInfo = customEvent.detail?.authInfo; // For new users (from Device Flow)
      const eventSource = customEvent.detail?.source || 'unknown';
      
      
      // UI cleanup
      setTimeout(async () => {
        setDeviceCode(null);
        setIsLoading(false);
        setShowGeneratingCode(false);
        clearSessionState();
        
        // 🔥 Case 1: Existing user authentication (from handleProfileSelect with authData)
        if (eventSource.includes('profile') || authData) {
          return;
        }
        
        // 🔥 Case 2: New user authentication (from Device Flow with authInfo)
        if (eventSource === 'device_flow' && authInfo) {
          
          // Main process has already called setCurrentAuth and handlePostAuth
          // Just wait for the route navigation handled by App.tsx
          return;
        }
        
        // 🔥 Case 3: Unexpected scenario - no valid auth data
        showError('Authentication completed but no data received');
      }, 100);
      
    } catch (error) {
      
      // Authentication failed, reset state and show error
      setDeviceCode(null);
      setIsLoading(false);
      setShowGeneratingCode(false);
      clearSessionState();
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown authentication error';
      showError(`Authentication failed: ${errorMessage}`);
    }
  }, [showSuccess, showError]);

  const handleAuthError = useCallback((event: CustomEvent) => {
    setShowGhcDeviceFlow(false);
    // Reset state
    setDeviceCode(null);
    setTimeLeft(0);
    setIsLoading(false);
    setShowGeneratingCode(false);
    clearSessionState();
    showError('GitHub Copilot authentication failed: ' + (event.detail.message || 'Unknown error'));
  }, [showError]);

  // Listen to GitHub Copilot device code events
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
    }
    
    // GitHub Copilot is the only auth provider now

    window.addEventListener('ghc:deviceCode', handleDeviceCode as EventListener);
    window.addEventListener('ghc:authSuccess', handleAuthSuccess as EventListener);
    window.addEventListener('ghc:authError', handleAuthError as EventListener);

    return () => {
      if (process.env.NODE_ENV === 'development') {
      }
      window.removeEventListener('ghc:deviceCode', handleDeviceCode as EventListener);
      window.removeEventListener('ghc:authSuccess', handleAuthSuccess as EventListener);
      window.removeEventListener('ghc:authError', handleAuthError as EventListener);
    };
  }, [handleDeviceCode, handleAuthSuccess, handleAuthError]);

  const handleGhcSignIn = async () => {
    if (process.env.NODE_ENV === 'development') {
    }
    
    // Set state (sessionStorage operations removed for performance)
    setIsLoading(true);
    setShowGeneratingCode(true);
    
    try {
      
      // Set up event listeners
      (window as any).electronAPI.auth.onDeviceCodeGenerated((deviceCode: any) => {
        
        // Trigger device code event
        const deviceCodeEvent = new CustomEvent('ghc:deviceCode', {
          detail: deviceCode
        });
        window.dispatchEvent(deviceCodeEvent);
      });
      
      (window as any).electronAPI.auth.onDeviceFlowSuccess((data: any) => {
        
        // Clean up event listeners
        (window as any).electronAPI.auth.removeDeviceFlowListeners();
        
        // Trigger auth success event
        const authSuccessEvent = new CustomEvent('ghc:authSuccess', {
          detail: {
            authInfo: data.authInfo,
            source: 'device_flow',
            provider: 'ghc'
          }
        });
        window.dispatchEvent(authSuccessEvent);
      });
      
      (window as any).electronAPI.auth.onDeviceFlowError((data: any) => {
        
        // Clean up event listeners
        (window as any).electronAPI.auth.removeDeviceFlowListeners();
        
        // Trigger auth error event
        const errorEvent = new CustomEvent('ghc:authError', {
          detail: { message: data.error }
        });
        window.dispatchEvent(errorEvent);
      });
      
      // Call main process to start the complete Device Flow
      const result = await (window as any).electronAPI.auth.startGhcDeviceFlow();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to start device flow');
      }
      
      
    } catch (error) {
      setShowGeneratingCode(false);
      showError('GitHub Copilot login failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsLoading(false);
      clearSessionState();
      
      // Clean up event listeners
      (window as any).electronAPI.auth.removeDeviceFlowListeners();
    }
  };

  const handleDeviceCodeCancel = () => {
    setShowGhcDeviceFlow(false);
    // Reset state
    setDeviceCode(null);
    setTimeLeft(0);
    setIsLoading(false);
    setShowGeneratingCode(false);
    clearSessionState();
  };

  const handleCopyCode = async () => {
    if (deviceCode?.user_code) {
      try {
        await navigator.clipboard.writeText(deviceCode.user_code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
      }
    }
  };

  const handleOpenGitHub = () => {
    if (deviceCode?.verification_uri) {
      const ssoUrl = "https://github.com/enterprises/microsoft/sso?return_to=" + deviceCode.verification_uri;
      window.open(ssoUrl, '_blank');
    }
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Debug code can be removed in production environment
  if (process.env.NODE_ENV === 'development') {
  }

  return (
    <div className="signin-page">
      {/* Profile Selection Card */}
      {showProfileSelection && (
        <div className="signin-card-container">
          <Card className="signin-card">
            <CardHeader className="signin-card-header">
              <div className="signin-icon-container">
                <div className="signin-icon-wrapper">
                  <svg className="signin-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              <CardTitle className="signin-card-title">Choose Your Profile</CardTitle>
              <CardDescription className="signin-card-description">
                Select an existing GitHub Copilot profile or create a new one
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Valid Users Section */}
                {profilesWithAuth.filter(profile => !profile.isExpired).length > 0 && (
                  <div className="space-y-3">
                    <h5 className="text-sm font-medium text-green-700 flex items-center">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                      Available accounts ({profilesWithAuth.filter(profile => !profile.isExpired).length})
                    </h5>
                    {profilesWithAuth.filter(profile => !profile.isExpired).map((profile, index) => (
                      <div
                        key={profile.alias}
                        className="p-4 border border-green-200 bg-green-50 rounded-lg hover:border-green-300 hover:bg-green-100 cursor-pointer transition-colors"
                        onClick={() => !isLoading && handleProfileSelect(profile)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                            {profile.authData?.ghcAuth?.user?.avatarUrl ? (
                              <img
                                src={profile.authData.ghcAuth.user.avatarUrl}
                                alt={profile.authData.ghcAuth.user.name}
                                className="w-10 h-10 rounded-full"
                              />
                            ) : (
                              <span className="text-green-600 font-medium">
                                {profile.authData?.ghcAuth?.user?.name?.charAt(0)?.toUpperCase() || profile.alias.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900">
                              {profile.authData?.ghcAuth?.user?.name || profile.alias}
                            </h4>
                            <p className="text-sm text-gray-500">
                              @{profile.authData?.ghcAuth?.user?.login || profile.alias}
                            </p>
                            {profile.authData?.ghcAuth?.user?.email && (
                              <p className="text-xs text-gray-400">
                                {profile.authData.ghcAuth.user.email}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-green-600 font-medium">✓ Verified</div>
                            <div className="text-xs text-gray-400">
                              {profile.authData?.ghcAuth?.user?.copilotPlan || 'individual'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Expired Users Section */}
                {profilesWithAuth.filter(profile => profile.isExpired).length > 0 && (
                  <div className="space-y-3">
                    <h5 className="text-sm font-medium text-yellow-700 flex items-center">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></div>
                      Token refresh needed ({profilesWithAuth.filter(profile => profile.isExpired).length})
                    </h5>
                    {profilesWithAuth.filter(profile => profile.isExpired).map((profile, index) => (
                      <div
                        key={profile.alias}
                        className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg hover:border-yellow-300 hover:bg-yellow-100 cursor-pointer transition-colors"
                        onClick={() => !isLoading && handleProfileSelect(profile)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                            {profile.authData?.ghcAuth?.user?.avatarUrl ? (
                              <img
                                src={profile.authData.ghcAuth.user.avatarUrl}
                                alt={profile.authData.ghcAuth.user.name}
                                className="w-10 h-10 rounded-full opacity-75"
                              />
                            ) : (
                              <span className="text-yellow-600 font-medium">
                                {profile.authData?.ghcAuth?.user?.name?.charAt(0)?.toUpperCase() || profile.alias.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900">
                              {profile.authData?.ghcAuth?.user?.name || profile.alias}
                            </h4>
                            <p className="text-sm text-gray-500">
                              @{profile.authData?.ghcAuth?.user?.login || profile.alias}
                            </p>
                            <p className="text-xs text-yellow-600">Token expired, click to refresh</p>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-yellow-600 font-medium">⚠ Expired</div>
                            <div className="text-xs text-gray-400">
                              Click to refresh token
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Separator */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">or</span>
                  </div>
                </div>
                
                {/* GitHub Auth Option */}
                <Button
                  onClick={handleUseGitHubAuth}
                  variant="outline"
                  className="w-full"
                  disabled={isLoading}
                >
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  Sign In with New GitHub Account
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sign-in Card */}
      {!showProfileSelection && !showGeneratingCode && !showGhcDeviceFlow && (
        <div className="signin-card-container">
        <Card className="signin-card">
          <CardHeader className="signin-card-header">
            <div className="signin-icon-container">
              <div className="signin-icon-wrapper">
                <svg className="signin-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
            </div>
            <CardTitle className="signin-card-title">Welcome to {APP_NAME}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* GitHub Copilot Authentication */}
            <div className="space-y-4">
              <div className="text-center p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="w-12 h-12 mx-auto mb-3 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                </div>
                <h4 className="font-medium text-blue-900 mb-2">GitHub Copilot Authentication</h4>
                <p className="text-sm text-blue-700 mb-4">
                  Sign in with your Microsoft Internal GitHub account (alias_microsoft) to access GitHub Copilot AI models
                </p>
              </div>
              
              <Button
                onClick={handleGhcSignIn}
                className="w-full bg-gray-900 hover:bg-gray-800"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Connecting to GitHub...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    Sign In with GitHub Copilot
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {/* Generating Device Code Loading State */}
      {showGeneratingCode && !showGhcDeviceFlow && (
        <div className="signin-card-container">
        <Card className="signin-card">
          <CardHeader className="signin-card-header">
            <div className="signin-icon-container">
              <div className="signin-icon-wrapper">
                <svg className="signin-loading-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            </div>
            <CardTitle className="signin-card-title">Generating Device Code</CardTitle>
            <CardDescription className="signin-card-description">
              Generating GitHub Copilot device authentication code for you, please wait...
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-center p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="w-12 h-12 mx-auto mb-3 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                </div>
                <h4 className="font-medium text-blue-900 mb-2">Connect to GitHub</h4>
                <p className="text-sm text-blue-700 mb-4">
                  Establishing connection with GitHub servers and generating authentication code
                </p>
                <div className="flex items-center justify-center space-x-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {/* GitHub Copilot Device Code Page */}
      {showGhcDeviceFlow && (
        <div className="signin-card-container">
        <Card className="signin-card">
          <CardHeader className="text-center pb-4">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </div>
            <CardTitle className="text-xl font-bold text-gray-900">
              GitHub Copilot Authorization
            </CardTitle>
            <CardDescription className="text-gray-600">
              Please complete authorization on GitHub to continue
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Step instructions */}
            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  ✓
                </div>
                <div>
                  <p className="font-medium text-gray-900">GitHub authorization page opened automatically</p>
                  <p className="text-sm text-gray-600 mt-1">If the page didn't open, please click the button below to open manually</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  2
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Enter Device Code</p>
                  <p className="text-sm text-gray-600 mt-1">Enter the following code on the opened page:</p>
                  <div className="mt-2 flex items-center space-x-2">
                    <code className="bg-gray-100 px-3 py-2 rounded-md text-lg font-mono font-bold text-blue-600 border border-gray-200">
                      {deviceCode?.user_code || ''}
                    </code>
                    <Button
                      onClick={handleCopyCode}
                      variant="outline"
                      size="sm"
                      className="text-xs px-2 py-1"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <p className="font-medium text-gray-900">Authorize Application</p>
                  <p className="text-sm text-gray-600 mt-1">Confirm authorization for {APP_NAME} to access GitHub Copilot</p>
                </div>
              </div>
            </div>

            {/* Time countdown */}
            <div className={`rounded-lg p-3 transition-colors duration-300 ${
              timeLeft <= 60 ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'
            }`}>
              <div className="flex items-center space-x-2">
                <svg className={`w-4 h-4 transition-colors duration-300 ${
                  timeLeft <= 60 ? 'text-red-600' : 'text-yellow-600'
                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className={`text-sm font-medium transition-colors duration-300 ${
                  timeLeft <= 60 ? 'text-red-800' : 'text-yellow-800'
                }`}>
                  Code will expire in {formatTime(timeLeft)}
                  {timeLeft <= 60 && ' - Expiring soon!'}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <Button
                onClick={handleOpenGitHub}
                variant="outline"
                className="w-full py-3"
              >
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Manually open GitHub authorization page
              </Button>

              <div className="text-center">
                <p className="text-sm text-gray-500 mb-2">
                  This page will automatically redirect after authorization is complete
                </p>
                <Button
                  onClick={handleDeviceCodeCancel}
                  variant="outline"
                  className="text-sm px-4 py-2"
                >
                  Cancel Authorization
                </Button>
              </div>
            </div>

            {/* Bottom tips */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start space-x-2">
                <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">GitHub Copilot subscription required</p>
                  <p>Ensure your GitHub account has subscribed to Copilot service to complete authorization.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </div>
      )}
    </div>
  );
};