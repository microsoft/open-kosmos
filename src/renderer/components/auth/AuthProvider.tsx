// src/renderer/components/auth/AuthProvider.tsx - V2.0 Auth Context Provider
// Uses AuthData as core data structure, provides unified auth state management

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
 * 4. Provide Token access methods
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [loading, setLoading] = useState(true);
  const authManager = new AuthManagerProxy();

  /**
   * Initialize auth state
   */
  const initializeAuth = useCallback(async () => {
    try {
      const currentAuth = await authManager.getCurrentAuthAsync();
      
      if (currentAuth && isAuthDataValid(currentAuth)) {
        setAuthData(currentAuth);
      } else {
        setAuthData(null);
      }
    } catch (error) {
      setAuthData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Sign-in method (called by SignInPage)
   */
  const signIn = useCallback(async () => {
    // Actual sign-in flow is handled by SignInPage
    // After successful sign-in, auth:authChanged event is triggered to automatically update state
  }, []);

  /**
   * Sign-out method - calls the unified signOut interface
   */
  const signOut = useCallback(async () => {
    try {
      console.log('[AuthProvider] 🔄 SignOut called, cleaning up frontend caches...');
      
      // 🔧 Critical fix: Clean frontend caches before calling main process sign-out
      // This ensures caches are cleaned even if IPC events are delayed
      try {
        profileDataManager.cleanup();
        console.log('[AuthProvider] ✅ ProfileDataManager cache cleaned');
      } catch (error) {
        console.error('[AuthProvider] ❌ Failed to clean ProfileDataManager cache:', error);
      }
      
      try {
        agentChatSessionCacheManager.cleanup();
        console.log('[AuthProvider] ✅ AgentChatSessionCacheManager cache cleaned');
      } catch (error) {
        console.error('[AuthProvider] ❌ Failed to clean AgentChatSessionCacheManager cache:', error);
      }
      
      try {
        mcpClientCacheManager.cleanup();
        console.log('[AuthProvider] ✅ MCPClientCacheManager cache cleaned');
      } catch (error) {
        console.error('[AuthProvider] ❌ Failed to clean MCPClientCacheManager cache:', error);
      }
      
      // Call the main process unified signOut interface
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

    // Listen for GitHub auth success event (compatible with SignInPage)
    const handleAuthSuccess = () => {
      initializeAuth();
    };

    // Listen for sign-out event
    const handleSignOut = () => {
      console.log('[AuthProvider] 🔄 SignOut event received, cleaning up frontend caches...');
      
      // 🔧 Critical fix: Clean frontend caches on sign-out to prevent new users from seeing stale data
      try {
        // Clean ProfileDataManager cache
        profileDataManager.cleanup();
        console.log('[AuthProvider] ✅ ProfileDataManager cache cleaned');
      } catch (error) {
        console.error('[AuthProvider] ❌ Failed to clean ProfileDataManager cache:', error);
      }
      
      try {
        // Clean AgentChatSessionCacheManager cache
        agentChatSessionCacheManager.cleanup();
        console.log('[AuthProvider] ✅ AgentChatSessionCacheManager cache cleaned');
      } catch (error) {
        console.error('[AuthProvider] ❌ Failed to clean AgentChatSessionCacheManager cache:', error);
      }
      
      try {
        // Clean MCPClientCacheManager cache
        mcpClientCacheManager.cleanup();
        console.log('[AuthProvider] ✅ MCPClientCacheManager cache cleaned');
      } catch (error) {
        console.error('[AuthProvider] ❌ Failed to clean MCPClientCacheManager cache:', error);
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
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return context;
};

export default AuthProvider;