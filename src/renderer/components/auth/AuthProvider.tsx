// src/renderer/components/auth/AuthProvider.tsx - V2.0 Auth Context Provider
// Uses AuthData as the core data structure to provide unified auth state management

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AuthData, AuthContextType } from '../../types/authTypes';
import { AuthManagerProxy } from '../../lib/auth/authManagerProxy';
import {
  extractUser,
  extractCopilotToken,
  extractGitHubToken,
  isAuthDataValid
} from '../../lib/auth/authDataAdapter';
import { profileDataManager } from '../../lib/userData';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[AuthProvider]');

/**
 * Auth Context - uses AuthData
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider component - V2.0
 *
 * Core features:
 * 1. Manage AuthData state
 * 2. Listen for auth:authChanged events
 * 3. Provide auth operations (signIn/signOut)
 * 4. Provide token accessor methods
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [loading, setLoading] = useState(true);
  const authManager = new AuthManagerProxy();

  // Track whether auth was established via ghc:authSuccess (sign-in flow)
  // vs cold cache restore. This prevents double-calling setCurrentAuth.
  const authEstablishedViaSignIn = useRef(false);

  /**
   * Initialize auth state from cache (cold start only)
   *
   * Two paths call this function:
   * 1. Cold start useEffect - needs to call setCurrentAuth to trigger main process init
   * 2. ghc:authSuccess handler - SignInPage/AutoLoginSingleUser already called setCurrentAuth
   *
   * We use authEstablishedViaSignIn ref to skip setCurrentAuth on path #2.
   */
  const initializeAuth = useCallback(async () => {
    try {
      const currentAuth = await authManager.getCurrentAuthAsync();

      if (currentAuth && isAuthDataValid(currentAuth)) {
        // Only call setCurrentAuth for cold cache restore (path #1)
        // Skip if auth was established via sign-in flow (path #2) to avoid double initialization
        if (!authEstablishedViaSignIn.current) {
          await authManager.setCurrentAuth(currentAuth);
        }
        setAuthData(currentAuth);
      } else {
        setAuthData(null);
      }
    } catch (error) {
      logger.error('[AuthProvider] initializeAuth failed:', error);
      setAuthData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Sign-in method (called by SignInPage)
   */
  const signIn = useCallback(async () => {
    // The actual sign-in flow is handled by SignInPage
    // After a successful sign-in, auth:authChanged is dispatched to auto-update state
  }, []);

  /**
   * Sign-out method - calls the unified signOut interface
   */
  const signOut = useCallback(async () => {
    try {
      logger.debug('[AuthProvider] 🔄 SignOut called, cleaning up frontend caches...');

      // 🔧 Critical fix: clean up frontend caches before calling main process sign-out
      // This ensures caches are cleared even if IPC events are delayed
      try {
        profileDataManager.cleanup();
        logger.debug('[AuthProvider] ✅ ProfileDataManager cache cleaned');
      } catch (error) {
        logger.error('[AuthProvider] ❌ Failed to clean ProfileDataManager cache:', error);
      }

      try {
        agentChatSessionCacheManager.cleanup();
        logger.debug('[AuthProvider] ✅ AgentChatSessionCacheManager cache cleaned');
      } catch (error) {
        logger.error('[AuthProvider] ❌ Failed to clean AgentChatSessionCacheManager cache:', error);
      }

      try {
        mcpClientCacheManager.cleanup();
        logger.debug('[AuthProvider] ✅ MCPClientCacheManager cache cleaned');
      } catch (error) {
        logger.error('[AuthProvider] ❌ Failed to clean MCPClientCacheManager cache:', error);
      }

      // Call the main process's unified signOut interface
      await authManager.signOut();
      setAuthData(null);

    } catch (error) {
      throw error;
    }
  }, []);

  /**
   * Get Copilot Token
   */
  const getCopilotToken = useCallback((): string | null => {
    return extractCopilotToken(authData);
  }, [authData]);

  /**
   * Get GitHub Token
   */
  const getGitHubToken = useCallback((): string | null => {
    return extractGitHubToken(authData);
  }, [authData]);

  /**
   * Listen for auth change events
   */
  useEffect(() => {

    // Listen for auth change events from the main process
    const unsubscribe = authManager.onAuthChanged((data) => {

      switch (data.type) {
        case 'auth_set':
        case 'copilot_token_refreshed':
          if (data.authData && isAuthDataValid(data.authData)) {
            setAuthData(data.authData);
          }
          break;

        case 'auth_destroyed':
          setAuthData(null);
          break;
      }
    });

    // Listen for GitHub auth success event (for compatibility with SignInPage)
    // When this fires, SignInPage/AutoLoginSingleUser already called setCurrentAuth,
    // so we mark the flag to skip redundant setCurrentAuth in initializeAuth.
    const handleAuthSuccess = () => {
      authEstablishedViaSignIn.current = true;
      initializeAuth();
    };

    // Listen for sign-out event
    const handleSignOut = () => {
      logger.debug('[AuthProvider] 🔄 SignOut event received, cleaning up frontend caches...');

      // 🔧 Critical fix: clean up frontend caches on sign-out to prevent the new user from seeing old data
      try {
        // Clean up ProfileDataManager cache
        profileDataManager.cleanup();
        logger.debug('[AuthProvider] ✅ ProfileDataManager cache cleaned');
      } catch (error) {
        logger.error('[AuthProvider] ❌ Failed to clean ProfileDataManager cache:', error);
      }

      try {
        // Clean up AgentChatSessionCacheManager cache
        agentChatSessionCacheManager.cleanup();
        logger.debug('[AuthProvider] ✅ AgentChatSessionCacheManager cache cleaned');
      } catch (error) {
        logger.error('[AuthProvider] ❌ Failed to clean AgentChatSessionCacheManager cache:', error);
      }

      try {
        // Clean up MCPClientCacheManager cache
        mcpClientCacheManager.cleanup();
        logger.debug('[AuthProvider] ✅ MCPClientCacheManager cache cleaned');
      } catch (error) {
        logger.error('[AuthProvider] ❌ Failed to clean MCPClientCacheManager cache:', error);
      }

      setAuthData(null);
    };

    window.addEventListener('ghc:authSuccess', handleAuthSuccess);
    window.addEventListener('auth:signOut', handleSignOut);

    return () => {
      unsubscribe();
      window.removeEventListener('ghc:authSuccess', handleAuthSuccess);
      window.removeEventListener('auth:signOut', handleSignOut);
    };
  }, [initializeAuth]);

  /**
   * Initialize
   */
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Context value
  const contextValue: AuthContextType = {
    authData,
    signIn,
    signOut,
    loading,
    isAuthenticated: !!authData && isAuthDataValid(authData),
    user: extractUser(authData),
    getCopilotToken,
    getGitHubToken
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * useAuth Hook - V2.0
 * Uses AuthData
 */
export const useAuthContext = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used inside AuthProvider');
  }
  return context;
};

export default AuthProvider;