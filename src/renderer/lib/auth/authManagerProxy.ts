// src/renderer/lib/auth/authManagerProxy.ts - Renderer Process Auth Proxy V2.0
import { AuthData, TokenRefreshResult } from '../../types/authTypes';

/**
 * Renderer Process Auth Manager Proxy V2.0 - Communicates with main process via IPC
 *
 * 100% uses AuthData, no compatibility layer
 */
export class AuthManagerProxy {
  private static instance: AuthManagerProxy;
  private cachedCurrentAuth: AuthData | null = null;

  constructor() {
  }

  // =========================================================================
  // New API - Using AuthData
  // =========================================================================

  /**
   * Set current auth data (New API)
   */
  async setCurrentAuth(authData: AuthData): Promise<void> {
    // Defensive check - ensure authData structure is complete
    const userLogin = authData?.ghcAuth?.user?.login || 'unknown';
    
    if (!(window as any).electronAPI?.auth?.setCurrentAuth) {
      throw new Error('Auth API not available');
    }
    
    const result = await (window as any).electronAPI.auth.setCurrentAuth(authData);
    if (!result.success) {
      throw new Error(result.error || 'Failed to set current auth');
    }
    
    this.cachedCurrentAuth = authData;
  }

  /**
   * Get current auth data (New API - synchronous)
   */
  getCurrentAuth(): AuthData | null {
    return this.cachedCurrentAuth;
  }

  /**
   * Get current auth data (New API - asynchronous)
   */
  async getCurrentAuthAsync(): Promise<AuthData | null> {
    if (!(window as any).electronAPI?.auth?.getCurrentAuth) {
      return null;
    }
    
    const result = await (window as any).electronAPI.auth.getCurrentAuth();
    if (result.success && result.data) {
      this.cachedCurrentAuth = result.data;
      return result.data;
    }
    
    return null;
  }

  /**
   * Destroy current auth (New API)
   */
  async destroyCurrentAuth(): Promise<void> {
    
    if (!(window as any).electronAPI?.auth?.destroyCurrentAuth) {
      throw new Error('Auth API not available');
    }
    
    const result = await (window as any).electronAPI.auth.destroyCurrentAuth();
    if (!result.success) {
      throw new Error(result.error || 'Failed to destroy current auth');
    }
    
    this.cachedCurrentAuth = null;
  }

  /**
   * Unified signOut method - calls the unified signOut interface in the main process
   */
  async signOut(): Promise<void> {
    
    if (!(window as any).electronAPI?.auth?.signOut) {
      throw new Error('Auth API not available');
    }
    
    const result = await (window as any).electronAPI.auth.signOut();
    if (!result.success) {
      throw new Error(result.error || 'signOut failed');
    }
    
    this.cachedCurrentAuth = null;
  }

  /**
   * Get Copilot Token (New API)
   */
  async getCopilotAccessToken(): Promise<string | null> {
    if (!(window as any).electronAPI?.auth?.getCopilotToken) {
      return null;
    }
    
    const result = await (window as any).electronAPI.auth.getCopilotToken();
    if (result.success) {
      return result.data;
    }
    
    return null;
  }

  /**
   * Get GitHub Token (New API)
   */
  async getGitHubAccessToken(): Promise<string | null> {
    if (!(window as any).electronAPI?.auth?.getGitHubToken) {
      return null;
    }
    
    const result = await (window as any).electronAPI.auth.getGitHubToken();
    if (result.success) {
      return result.data;
    }
    
    return null;
  }

  /**
   * Get local active auth list (New API)
   */
  async getLocalActiveAuths(): Promise<AuthData[]> {
    
    if (!(window as any).electronAPI?.auth?.getLocalActiveAuths) {
      throw new Error('Auth API not available');
    }
    
    const result = await (window as any).electronAPI.auth.getLocalActiveAuths();
    if (!result.success) {
      throw new Error(result.error || 'Failed to get local active auths');
    }
    
    return result.data || [];
  }

  /**
   * Refresh Copilot Token (New API)
   */
  async refreshCopilotToken(): Promise<TokenRefreshResult> {
    
    if (!(window as any).electronAPI?.auth?.refreshCopilotToken) {
      return {
        success: false,
        error: 'Auth API not available',
        requiresReauth: true
      };
    }
    
    const result = await (window as any).electronAPI.auth.refreshCopilotToken();
    if (result.success) {
      // Update cache
      if (result.data?.authData) {
        this.cachedCurrentAuth = result.data.authData;
      }
      return result.data;
    }
    
    return {
      success: false,
      error: result.error || 'Failed to refresh Token',
      requiresReauth: true
    };
  }

  /**
   * Listen for auth change events (New API)
   */
  onAuthChanged(callback: (data: { type: string; authData: AuthData | null }) => void): () => void {
    if (!(window as any).electronAPI?.auth?.onAuthChanged) {
      return () => {};
    }
    
    return (window as any).electronAPI.auth.onAuthChanged((data: any) => {
      
      // Update cache
      if (data.type === 'auth_set' || data.type === 'copilot_token_refreshed') {
        this.cachedCurrentAuth = data.authData;
      } else if (data.type === 'auth_destroyed') {
        this.cachedCurrentAuth = null;
      }
      
      callback(data);
    });
  }

  // =========================================================================
  // Token Monitoring
  // =========================================================================

  // Note: startTokenMonitoring has been removed - Token monitoring is now automatically started by setCurrentAuth()

  /**
   * Stop Token monitoring
   */
  async stopTokenMonitoring(): Promise<void> {
    
    if (!(window as any).electronAPI?.auth?.stopTokenMonitoring) {
      throw new Error('Auth API not available');
    }
    
    const result = await (window as any).electronAPI.auth.stopTokenMonitoring();
    if (!result.success) {
      throw new Error(result.error || 'Failed to stop Token monitoring');
    }
    
  }

  /**
   * Manually trigger Token check
   */
  async manualTokenCheck(): Promise<void> {
    
    if (!(window as any).electronAPI?.auth?.manualTokenCheck) {
      throw new Error('Auth API not available');
    }
    
    const result = await (window as any).electronAPI.auth.manualTokenCheck();
    if (!result.success) {
      throw new Error(result.error || 'Failed to perform manual Token check');
    }
    
  }

  /**
   * Listen for Token monitoring events
   */
  onTokenMonitor(callback: (data: any) => void): () => void {
    if (!(window as any).electronAPI?.auth?.onTokenMonitor) {
      return () => {};
    }
    
    return (window as any).electronAPI.auth.onTokenMonitor((data: any) => {
      callback(data);
    });
  }

  // =========================================================================
  // Initialization and Singleton
  // =========================================================================

  /**
   * Initialize proxy (sync cached auth state)
   */
  async initialize(): Promise<void> {
    
    try {
      // Sync current auth state
      await this.getCurrentAuthAsync();
      
    } catch (error) {
    }
  }

  // Singleton pattern
  static getInstance(): AuthManagerProxy {
    if (!AuthManagerProxy.instance) {
      AuthManagerProxy.instance = new AuthManagerProxy();
    }
    return AuthManagerProxy.instance;
  }

  static resetInstance(): void {
    AuthManagerProxy.instance = null as any;
  }
}

// Export singleton instance
export const authManager = AuthManagerProxy.getInstance();