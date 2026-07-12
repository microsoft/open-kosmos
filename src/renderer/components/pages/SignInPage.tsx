// src/renderer/components/pages/SignInPage.tsx (Enhanced version)
// Strictly implemented according to design document lines 648-855
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../ui/ToastProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { StartupValidationResult } from '../../types/startupValidationTypes';
import '../../styles/SignInPage.css';
import { APP_NAME } from '@shared/constants/branding';
import { AuthManagerProxy } from "../../lib/auth/authManagerProxy";
import { useI18n } from '../../lib/i18n/useI18n';

interface SignInPageProps {
  // SignInPage can optionally receive pre-scanned startup results
  startupResult?: StartupValidationResult;
}

export const SignInPage: React.FC<SignInPageProps> = ({ startupResult }) => {
  const componentStartTime = Date.now();

  // Optimization: remove sessionStorage reads to avoid blocking rendering
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

  // New architecture: receive pre-processed results from StartupPage
  useEffect(() => {
    const effectStartTime = Date.now();

    if (isInitialized.current) {
      return;
    }
    isInitialized.current = true;

    const processStartupResults = async () => {
      setIsScanning(true);

      try {

        // New: detailed debug of the entire startupResult object

        // Check if we have startupResult from StartupPage validation
        if (startupResult?.stage2) {

          // Prioritize AuthManager pre-processed results
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

            // Use results in legacy format
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


  // Optimization: sessionStorage persistence removed to avoid frequent write blocking
  // SignInPage is a temporary page, state persistence is not needed
  // useEffect(() => {
  //   sessionStorage.setItem('signin-isLoading', JSON.stringify(isLoading));
  // }, [isLoading]);

  // ... other sessionStorage operations have been removed

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

  const { showError } = useToast();
  const { t } = useI18n();
  // Auth functionality is now handled through main process

  // Use AuthData directly, without any mapping or rebuilding
  const handleProfileSelect = async (profile: any) => {
    try {
      setIsLoading(true);


      const authManager = new AuthManagerProxy();

      // Use AuthData directly
      const authData = profile.authData;

      if (!authData) {
        throw new Error('Profile is missing AuthData');
      }

      // Detailed debug of authData structure

      // Validate authData structure integrity
      if (!authData.ghcAuth) {
        throw new Error('AuthData is missing the ghcAuth field');
      }
      if (!authData.ghcAuth.user) {
        throw new Error('AuthData.ghcAuth is missing the user field');
      }
      if (!authData.ghcAuth.user.login) {
        throw new Error('AuthData.ghcAuth.user is missing the login field');
      }


      // Fix: check if this is a validated Profile (has a valid GitHub token)
      if (profile.isValid) {

        // Use the new AuthData API - setCurrentAuth internally calls handlePostAuthentication to complete initialization
        await authManager.setCurrentAuth(authData);


        // Trigger auth success event to notify App.tsx for route navigation
        const authSuccessEvent = new CustomEvent('ghc:authSuccess', {
          detail: {
            authData: authData,
            provider: 'ghc',
            source: 'signin_page_valid_profile'
          }
        });

        window.dispatchEvent(authSuccessEvent);


      } else if (profile.isRecoverable) {

        // Set AuthData first, then refresh token
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
      showError(t('auth.signInFailed', { error: error instanceof Error ? error.message : t('common.unknownError') }));
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
      showError(t('auth.reauthFailed', { error: error instanceof Error ? error.message : t('common.unknownError') }));
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

    // Automatically open the GitHub authorization page.
    if (deviceCodeData.verification_uri) {
      window.open(deviceCodeData.verification_uri, '_blank');
    }

    // Directly show device code interface
    setTimeout(() => {
      setShowGeneratingCode(false);
      setShowGhcDeviceFlow(true);
    }, 800);
  }, []);

  const clearSessionState = () => {
    // Optimization: sessionStorage operations removed, keeping this function for backward compatibility
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
        showError(t('auth.completedWithoutData'));
      }, 100);

    } catch (error) {

      // Authentication failed, reset state and show error
      setDeviceCode(null);
      setIsLoading(false);
      setShowGeneratingCode(false);
      clearSessionState();

      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('auth.authenticationFailed', { error: errorMessage }));
    }
  }, [showError, t]);

  const handleAuthError = useCallback((event: CustomEvent) => {
    setShowGhcDeviceFlow(false);
    // Reset state
    setDeviceCode(null);
    setTimeLeft(0);
    setIsLoading(false);
    setShowGeneratingCode(false);
    clearSessionState();
    showError(t('auth.ghcAuthenticationFailed', { error: event.detail.message || t('common.unknownError') }));
  }, [showError, t]);

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

      // Call the main process to start the full Device Flow
      const result = await (window as any).electronAPI.auth.startGhcDeviceFlow();

      if (!result.success) {
        throw new Error(result.error || 'Failed to start device flow');
      }


    } catch (error) {
      setShowGeneratingCode(false);
      showError(t('auth.ghcLoginFailed', { error: error instanceof Error ? error.message : t('common.unknownError') }));
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
      window.open(deviceCode.verification_uri, '_blank');
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
              <CardTitle className="signin-card-title">{t('auth.chooseProfileTitle')}</CardTitle>
              <CardDescription className="signin-card-description">
                {t('auth.chooseProfileDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Valid Users Section */}
                {profilesWithAuth.filter(profile => !profile.isExpired).length > 0 && (
                  <div className="space-y-3">
                    <h5 className="text-sm font-medium text-success-700 flex items-center">
                      <div className="w-2 h-2 bg-success-500 rounded-full mr-2"></div>
                      {t('auth.availableAccounts', { count: profilesWithAuth.filter(profile => !profile.isExpired).length })}
                    </h5>
                    {profilesWithAuth.filter(profile => !profile.isExpired).map((profile, index) => (
                      <div
                        key={profile.alias}
                        className="p-4 border border-success-200 bg-success-50 rounded-lg hover:border-success-300 hover:bg-success-100 cursor-pointer transition-colors"
                        onClick={() => !isLoading && handleProfileSelect(profile)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-success-100 rounded-full flex items-center justify-center">
                            {profile.authData?.ghcAuth?.user?.avatarUrl ? (
                              <img
                                src={profile.authData.ghcAuth.user.avatarUrl}
                                alt={profile.authData.ghcAuth.user.name}
                                className="w-10 h-10 rounded-full"
                              />
                            ) : (
                              <span className="text-success-600 font-medium">
                                {profile.authData?.ghcAuth?.user?.name?.charAt(0)?.toUpperCase() || profile.alias.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium text-neutral-900">
                              {profile.authData?.ghcAuth?.user?.name || profile.alias}
                            </h4>
                            <p className="text-sm text-neutral-500">
                              @{profile.authData?.ghcAuth?.user?.login || profile.alias}
                            </p>
                            {profile.authData?.ghcAuth?.user?.email && (
                              <p className="text-xs text-neutral-400">
                                {profile.authData.ghcAuth.user.email}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-success-600 font-medium">✓ {t('auth.verified')}</div>
                            <div className="text-xs text-neutral-400">
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
                    <h5 className="text-sm font-medium text-warning-700 flex items-center">
                      <div className="w-2 h-2 bg-warning-500 rounded-full mr-2"></div>
                      {t('auth.tokenRefreshNeeded', { count: profilesWithAuth.filter(profile => profile.isExpired).length })}
                    </h5>
                    {profilesWithAuth.filter(profile => profile.isExpired).map((profile, index) => (
                      <div
                        key={profile.alias}
                        className="p-4 border border-warning-200 bg-warning-50 rounded-lg hover:border-warning-300 hover:bg-warning-100 cursor-pointer transition-colors"
                        onClick={() => !isLoading && handleProfileSelect(profile)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-warning-100 rounded-full flex items-center justify-center">
                            {profile.authData?.ghcAuth?.user?.avatarUrl ? (
                              <img
                                src={profile.authData.ghcAuth.user.avatarUrl}
                                alt={profile.authData.ghcAuth.user.name}
                                className="w-10 h-10 rounded-full opacity-75"
                              />
                            ) : (
                              <span className="text-warning-600 font-medium">
                                {profile.authData?.ghcAuth?.user?.name?.charAt(0)?.toUpperCase() || profile.alias.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium text-neutral-900">
                              {profile.authData?.ghcAuth?.user?.name || profile.alias}
                            </h4>
                            <p className="text-sm text-neutral-500">
                              @{profile.authData?.ghcAuth?.user?.login || profile.alias}
                            </p>
                            <p className="text-xs text-warning-600">{t('auth.tokenExpiredClickToRefresh')}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-warning-600 font-medium">⚠ {t('auth.expired')}</div>
                            <div className="text-xs text-neutral-400">
                              {t('auth.clickToRefreshToken')}
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
                    <div className="w-full border-t border-neutral-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-neutral-500">{t('auth.or')}</span>
                  </div>
                </div>

                {/* GitHub Auth Option */}
                <button
                  onClick={handleUseGitHubAuth}
                  className="btn-secondary w-full"
                  disabled={isLoading}
                >
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  {t('auth.signInWithNewGitHubAccount')}
                </button>
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
            <CardTitle className="signin-card-title">{t('auth.welcomeToApp', { appName: APP_NAME })}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* GitHub Copilot Authentication */}
            <div className="space-y-4">
              <div className="text-center p-4 bg-primary-50 border border-primary-200 rounded-lg">
                <div className="w-12 h-12 mx-auto mb-3 bg-primary-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-primary-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                </div>
                <h4 className="font-medium text-primary-900 mb-2">{t('auth.ghcAuthenticationTitle')}</h4>
                <p className="text-sm text-primary-700 mb-4">
                  {t('auth.ghcAuthenticationDescription')}
                </p>
              </div>

              <button
                onClick={handleGhcSignIn}
                className="btn-primary w-full"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t('auth.connectingToGitHub')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    {t('auth.signInWithGitHubCopilot')}
                  </>
                )}
              </button>
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
            <CardTitle className="signin-card-title">{t('auth.generatingDeviceCodeTitle')}</CardTitle>
            <CardDescription className="signin-card-description">
              {t('auth.generatingDeviceCodeDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-center p-4 bg-primary-50 border border-primary-200 rounded-lg">
                <div className="w-12 h-12 mx-auto mb-3 bg-primary-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-primary-600 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                </div>
                <h4 className="font-medium text-primary-900 mb-2">{t('auth.connectToGitHub')}</h4>
                <p className="text-sm text-primary-700 mb-4">
                  {t('auth.generatingAuthenticationCode')}
                </p>
                <div className="flex items-center justify-center space-x-1">
                  <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                  <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
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
            <div className="w-16 h-16 mx-auto mb-4 bg-linear-to-r from-primary-500 to-primary-600 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </div>
            <CardTitle className="text-xl font-bold text-neutral-900">
              {t('auth.ghcAuthorizationTitle')}
            </CardTitle>
            <CardDescription className="text-neutral-600">
              {t('auth.ghcAuthorizationDescription')}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Step instructions */}
            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 bg-success-500 text-white rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
                  ✓
                </div>
                <div>
                  <p className="font-medium text-neutral-900">{t('auth.githubPageOpened')}</p>
                  <p className="text-sm text-neutral-600 mt-1">{t('auth.githubPageOpenFallback')}</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 bg-primary-500 text-white rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
                  2
                </div>
                <div className="flex-1">
                  <p className="font-medium text-neutral-900">{t('auth.enterDeviceCode')}</p>
                  <p className="text-sm text-neutral-600 mt-1">{t('auth.enterCodeOnOpenedPage')}</p>
                  <div className="mt-2 flex items-center space-x-2">
                    <code className="bg-neutral-100 px-3 py-2 rounded-md text-lg font-mono font-bold text-primary-600 border border-neutral-200">
                      {deviceCode?.user_code || ''}
                    </code>
                    <button
                      onClick={handleCopyCode}
                      className="btn-secondary"
                    >
                      {copied ? t('auth.copied') : t('auth.copy')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 bg-primary-500 text-white rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <p className="font-medium text-neutral-900">{t('auth.authorizeApplication')}</p>
                  <p className="text-sm text-neutral-600 mt-1">{t('auth.confirmAppAuthorization', { appName: APP_NAME })}</p>
                </div>
              </div>
            </div>

            {/* Time countdown */}
            <div className={`rounded-lg p-3 transition-colors duration-300 ${
              timeLeft <= 60 ? 'bg-danger-50 border border-danger-200' : 'bg-warning-50 border border-warning-200'
            }`}>
              <div className="flex items-center space-x-2">
                <svg className={`w-4 h-4 transition-colors duration-300 ${
                  timeLeft <= 60 ? 'text-danger-600' : 'text-warning-600'
                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className={`text-sm font-medium transition-colors duration-300 ${
                  timeLeft <= 60 ? 'text-danger-800' : 'text-warning-800'
                }`}>
                  {t('auth.codeWillExpireIn', { time: formatTime(timeLeft) })}
                  {timeLeft <= 60 && t('auth.expiringSoon')}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <button
                onClick={handleOpenGitHub}
                className="btn-secondary w-full"
              >
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {t('auth.openGitHubAuthorizationPage')}
              </button>

              <div className="text-center">
                <p className="text-sm text-neutral-500 mb-2">
                  {t('auth.redirectAfterAuthorization')}
                </p>
                <button
                  onClick={handleDeviceCodeCancel}
                  className="btn-secondary w-fit mx-auto"
                >
                  {t('auth.cancelAuthorization')}
                </button>
              </div>
            </div>

            {/* Bottom tips */}
            <div className="bg-primary-50 border border-primary-200 rounded-lg p-3">
              <div className="flex items-start space-x-2">
                <svg className="w-4 h-4 text-primary-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-primary-800">
                  <p className="font-medium mb-1">{t('auth.copilotSubscriptionRequired')}</p>
                  <p>{t('auth.copilotSubscriptionDescription')}</p>
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