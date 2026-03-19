// src/main/lib/auth/ghcAuth.ts - Main process GitHub Copilot auth manager V2.0
import { AuthData } from './types/authTypes';
import { RefreshTokenAnalyzer } from './refreshTokenAnalyzer';
import { RefreshTokenErrorType, HttpErrorInfo } from './types/refreshTokenTypes';
import { createLogger } from '../unifiedLogger';
import { GHC_CONFIG } from './ghcConfig';

const logger = createLogger();

// OAuth App configuration
const OAUTH_CONFIG = {
  CLIENT_ID: GHC_CONFIG.CLIENT_ID,
  SCOPE: 'read:user user:email'
};

// Local configuration constants
const LOCAL_CONFIG = {
  USER_AGENT: 'GitHubCopilotChat/0.26.7',
  EDITOR_VERSION: 'vscode/1.99.3',
  EDITOR_PLUGIN_VERSION: 'copilot-chat/0.26.7',
  OPENAI_ORGANIZATION: '',
};

// Device Flow related types
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface DeviceFlowAuthResult {
  success: boolean;
  authData?: AuthData;
  error?: string;
  newInterval?: number; // New polling interval for slow_down errors
}


/**
 * Main process GitHub Copilot auth manager V2.0
 *
 * Focused on:
 * - Copilot Token refresh (using GitHub Token)
 * - GitHub API interaction
 * - Auth state management
 * - Device Code Flow authentication process
 */
export class GhcAuthManager {
  private static instance: GhcAuthManager;

  constructor() {
  }

  /**
   * Refresh Copilot token using GitHub token - V3.0 (directly returns raw API data)
   */
  async refreshCopilotToken(gitHubToken: string, retryCount = 0): Promise<AuthData['ghcAuth']['copilotTokens']> {
    const maxRetries = 3;
    
    try {
      // Build request headers using GitHub token
      const headers = this.getCopilotTokenHeaders(gitHubToken);
      
      // Send API request
      const response = await fetch(GHC_CONFIG.COPILOT_TOKEN_URL, {
        method: 'GET',
        headers
      });
      
      if (!response.ok) {
        // Use intelligent error analyzer to analyze HTTP errors
        const httpError: HttpErrorInfo = {
          status: response.status,
          message: response.statusText,
          code: null
        };
        
        const analysis = RefreshTokenAnalyzer.analyzeHttpError(httpError);
        const userMessage = RefreshTokenAnalyzer.getUserFriendlyMessage(analysis);
        
        logger.error(`[GhcAuthManager] ❌ Copilot Token refresh HTTP error (possibly expired GitHub token)`, 'GhcAuthManager', {
          status: response.status,
          statusText: response.statusText,
          errorType: analysis.errorType,
          isRecoverable: analysis.isRecoverable,
          shouldClearSession: analysis.shouldClearSession,
          userMessage
        });
        
        // Check if we should retry
        if (analysis.isRecoverable && !RefreshTokenAnalyzer.shouldStopRetrying(analysis, retryCount)) {
          const delay = RefreshTokenAnalyzer.calculateBackoffDelay(analysis, retryCount);
          
          
          // Wait then retry
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.refreshCopilotToken(gitHubToken, retryCount + 1);
        }
        
        // Build detailed error message
        const errorMessage = `Copilot Token refresh failed: ${response.status} ${response.statusText} (${analysis.errorType})`;
        const error = new Error(errorMessage) as any;
        error.analysis = analysis;
        error.httpStatus = response.status;
        error.shouldClearSession = analysis.shouldClearSession;
        
        throw error;
      }
      
      const data = await response.json();
      
      if (!data.token || !data.expires_at) {
        throw new Error('Missing required fields in token refresh response');
      }
      
      
      // Directly return raw API data, timestamp records API response received time
      return {
        timestamp: data.timestamp || new Date().toISOString(), // API-returned or record the reception time
        api_url: data.api_url || GHC_CONFIG.COPILOT_TOKEN_URL,
        expires_at: data.expires_at,
        token: data.token
      };
      
    } catch (error: any) {
      // Handle non-HTTP errors such as network errors
      if (!error.analysis) {
        const httpError: HttpErrorInfo = {
          status: 0,
          message: error.message,
          code: error.code || null
        };
        
        const analysis = RefreshTokenAnalyzer.analyzeHttpError(httpError);
        const userMessage = RefreshTokenAnalyzer.getUserFriendlyMessage(analysis);
        
        logger.error(`[GhcAuthManager] ❌ Token refresh network error`, 'GhcAuthManager', {
          error: error.message,
          errorType: analysis.errorType,
          isRecoverable: analysis.isRecoverable,
          userMessage
        });
        
        // Check if network error should be retried
        if (analysis.isRecoverable && !RefreshTokenAnalyzer.shouldStopRetrying(analysis, retryCount)) {
          const delay = RefreshTokenAnalyzer.calculateBackoffDelay(analysis, retryCount);
          
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.refreshCopilotToken(gitHubToken, retryCount + 1);
        }
        
        error.analysis = analysis;
        error.shouldClearSession = analysis.shouldClearSession;
      }
      
      logger.error(`[GhcAuthManager] ❌ Token refresh failed`, 'GhcAuthManager', {
        error: error.message,
        errorType: error.analysis?.errorType || 'UNKNOWN_ERROR',
        shouldClearSession: error.shouldClearSession || false
      });
      
      throw error;
    }
  }

  /**
   * Validate GitHub token and get Copilot token (V2.0)
   * Validates GitHub token by attempting to get a Copilot token
   */
  async validateGitHubToken(gitHubToken: string): Promise<{valid: boolean, expired: boolean, error?: string}> {
    try {
      const headers = this.getCopilotTokenHeaders(gitHubToken);
      
      const response = await fetch(GHC_CONFIG.COPILOT_TOKEN_URL, {
        method: 'GET',
        headers
      });
      
      if (response.ok) {
        const data = await response.json();
        return { valid: !!data.token, expired: false };
      } else if (response.status === 401) {
        return { valid: false, expired: true, error: 'GitHub access token expired' };
      } else if (response.status === 403) {
        return { valid: false, expired: true, error: 'GitHub access token lacks Copilot permissions' };
      } else {
        return { valid: false, expired: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }
      
    } catch (error: any) {
      logger.error('[GhcAuthManager] GitHub Token validation failed:', error.message);
      return {
        valid: false,
        expired: false,
        error: error.message || 'Network error during token validation'
      };
    }
  }

  /**
   * Build Copilot Token API request headers
   */
  private getCopilotTokenHeaders(token: string): Record<string, string> {
    return {
      'Authorization': `token ${token}`,
      'Accept': 'application/json',
      'User-Agent': LOCAL_CONFIG.USER_AGENT,
      'Editor-Version': LOCAL_CONFIG.EDITOR_VERSION,
      'Editor-Plugin-Version': LOCAL_CONFIG.EDITOR_PLUGIN_VERSION,
      'Openai-Organization': LOCAL_CONFIG.OPENAI_ORGANIZATION,
      'Openai-Intent': 'conversation-panel',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Clear session data
   */
  async clearSession(userAlias: string): Promise<{success: boolean, error?: string}> {
    try {
      
      // Additional cleanup logic can be added here
      // For example: clearing cache, notifying other components, etc.
      
      return { success: true };
      
    } catch (error: any) {
      logger.error('[GhcAuthManager] ❌ Failed to clean up session data:', error.message);
      return { 
        success: false, 
        error: error.message || 'Unknown error during session cleanup' 
      };
    }
  }

  /**
   * Get user info
   */
  async getUserInfo(accessToken: string): Promise<AuthData['ghcAuth']['user'] | null> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': LOCAL_CONFIG.USER_AGENT
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get user info: ${response.status}`);
      }
      
      const userData = await response.json();
      
      return {
        id: userData.id?.toString() || '',
        login: userData.login || '',
        name: userData.name || userData.login || '',
        email: userData.email || '',
        avatarUrl: userData.avatar_url || '',
        copilotPlan: 'individual' // Default to individual plan; needs additional API call for accurate info
      };
      
    } catch (error) {
      logger.error('[GhcAuthManager] Failed to get user info', 'GhcAuthManager', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Start OAuth Device Flow
   */
  async startDeviceFlow(): Promise<DeviceCodeResponse> {
    
    try {
      const response = await fetch(GHC_CONFIG.DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': LOCAL_CONFIG.USER_AGENT
        },
        body: new URLSearchParams({
          client_id: OAUTH_CONFIG.CLIENT_ID,
          scope: OAUTH_CONFIG.SCOPE
        })
      });

      if (!response.ok) {
        throw new Error(`Device code request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.device_code || !data.user_code || !data.verification_uri) {
        throw new Error('Invalid device code response: missing required fields');
      }


      return {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        expires_in: data.expires_in || 900, // Default 15 minutes
        interval: data.interval || 5 // Default 5-second polling interval
      };

    } catch (error: any) {
      logger.error('[GhcAuthManager] ❌ Device flow startup failed', 'GhcAuthManager', { error: error.message });
      throw error;
    }
  }

  /**
   * Poll for access token
   */
  async pollForAccessToken(deviceCode: string, interval: number = 5): Promise<DeviceFlowAuthResult> {
    
    try {
      const response = await fetch(GHC_CONFIG.ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': LOCAL_CONFIG.USER_AGENT
        },
        body: new URLSearchParams({
          client_id: OAUTH_CONFIG.CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });

      const data = await response.json();
      
      // Build complete GitHub Token data (add timestamp and api_url when receiving API response)
      const githubTokenData = {
        timestamp: new Date().toISOString(), // Record reception time
        api_url: GHC_CONFIG.ACCESS_TOKEN_URL, // Record API address
        access_token: data.access_token,
        token_type: data.token_type || 'bearer',
        scope: data.scope || ''
      };
      
      // Detailed log recording of poll response

      if (data.error) {
        if (data.error === 'authorization_pending') {
          // User has not yet authorized, continue waiting
          return { success: false, error: 'authorization_pending' };
        } else if (data.error === 'slow_down') {
          // Need to extend polling interval, return server-suggested new interval
          return {
            success: false,
            error: 'slow_down',
            newInterval: data.interval || (interval + 5) // Use server-suggested interval or add 5 seconds
          };
        } else if (data.error === 'expired_token') {
          // Device code has expired
          return { success: false, error: 'expired_token' };
        } else if (data.error === 'access_denied') {
          // User denied authorization
          return { success: false, error: 'access_denied' };
        } else {
          throw new Error(`OAuth error: ${data.error} - ${data.error_description || 'Unknown error'}`);
        }
      }

      if (!data.access_token) {
        throw new Error('No access token in response');
      }

      // V3.0: Get user info and Copilot access token, pass complete GitHub Token data
      const authData = await this.getCompleteAuthData(githubTokenData);
      
      if (!authData) {
        throw new Error('Failed to get complete auth information');
      }


      return {
        success: true,
        authData
      };

    } catch (error: any) {
      logger.error('[GhcAuthManager] ❌ Failed to poll for access token', 'GhcAuthManager', { error: error.message });
      return {
        success: false,
        error: error.message || 'Unknown error during token polling'
      };
    }
  }

  /**
   * Get complete auth data (V3.0 - fully uses raw API data)
   * @param githubTokenData - Complete GitHub Token data (including timestamp and api_url)
   */
  private async getCompleteAuthData(githubTokenData: AuthData['ghcAuth']['gitHubTokens']): Promise<AuthData | null> {
    try {
      // 1. Get user info
      const userInfo = await this.getUserInfo(githubTokenData.access_token);
      if (!userInfo) {
        throw new Error('Failed to get user information');
      }

      // 2. Get Copilot Token
      const copilotTokenResponse = await fetch(GHC_CONFIG.COPILOT_TOKEN_URL, {
        method: 'GET',
        headers: this.getCopilotTokenHeaders(githubTokenData.access_token)
      });

      if (!copilotTokenResponse.ok) {
        throw new Error(`Copilot token request failed: ${copilotTokenResponse.status}`);
      }

      const copilotData = await copilotTokenResponse.json();
      
      if (!copilotData.token || !copilotData.expires_at) {
        throw new Error('No Copilot token or expires_at in response');
      }

      // Build complete Copilot Token data (add timestamp and api_url when receiving API response)
      const copilotTokenData: AuthData['ghcAuth']['copilotTokens'] = {
        timestamp: new Date().toISOString(), // Record reception time
        api_url: GHC_CONFIG.COPILOT_TOKEN_URL, // Record API address
        expires_at: copilotData.expires_at,
        token: copilotData.token
      };

      // 3. Build AuthData (fully uses API data, no conversions)
      const now = new Date().toISOString();

      const authData: AuthData = {
        version: '3.0.0',
        createdAt: now,
        updatedAt: now,
        authProvider: 'ghc',
        ghcAuth: {
          alias: userInfo.login,
          user: userInfo,
          gitHubTokens: githubTokenData, // Use complete data directly
          copilotTokens: copilotTokenData, // Use complete data directly
          capabilities: ['chat', 'completion', 'inline_completion']
        }
      };

      return authData;

    } catch (error: any) {
      logger.error('[GhcAuthManager] ❌ Failed to get complete auth info (V3.0)', 'GhcAuthManager', { error: error.message });
      return null;
    }
  }

  /**
   * Complete Device Flow authentication process
   */
  async performDeviceFlowAuthentication(
    onDeviceCode: (deviceCode: DeviceCodeResponse) => void,
    onError: (error: string) => void,
    onSuccess: (authData: AuthData) => void
  ): Promise<void> {
    try {
      // 1. Get device code
      const deviceCodeResponse = await this.startDeviceFlow();
      
      // 2. Notify renderer process to display device code
      onDeviceCode(deviceCodeResponse);
      
      // 3. Start polling
      let interval = deviceCodeResponse.interval;
      const maxAttempts = Math.floor(deviceCodeResponse.expires_in / interval);
      let attempts = 0;
      
      let pollTimer: NodeJS.Timeout;
      
      const schedulePoll = () => {
        pollTimer = setTimeout(async () => {
          if (attempts >= maxAttempts) {
            onError('Device code expired');
            return;
          }
          
          attempts++;
          
          try {
            const result = await this.pollForAccessToken(deviceCodeResponse.device_code, interval);
            
            if (result.success && result.authData) {
              onSuccess(result.authData);
            } else if (result.error === 'slow_down') {
              // Use server-suggested new polling interval
              if (result.newInterval) {
                interval = result.newInterval;
              } else {
                interval += 5; // Fallback strategy: add 5 seconds
              }
              // Reschedule next poll with new interval
              schedulePoll();
            } else if (result.error && result.error !== 'authorization_pending') {
              onError(result.error);
            } else {
              // authorization_pending case: continue polling
              schedulePoll();
            }
            
          } catch (error: any) {
            onError(error.message || 'Polling failed');
          }
        }, interval * 1000);
      };
      
      // Start first poll
      schedulePoll();
      
    } catch (error: any) {
      logger.error('[GhcAuthManager] ❌ Device flow authentication failed', 'GhcAuthManager', { error: error.message });
      onError(error.message || 'Device flow failed');
    }
  }

  // Singleton pattern
  static getInstance(): GhcAuthManager {
    if (!GhcAuthManager.instance) {
      GhcAuthManager.instance = new GhcAuthManager();
    }
    return GhcAuthManager.instance;
  }

  static resetInstance(): void {
    GhcAuthManager.instance = null as any;
  }
}

// Export singleton instance
export const ghcAuthManager = GhcAuthManager.getInstance();