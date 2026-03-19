// src/main/lib/auth/authManager.ts - Main process auth manager V2.0
import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../unifiedLogger';
import {
  AuthData,
  TokenRefreshResult,
  IAuthManager,
  ProfileWithExpiredAuth,
  ProfileWithInvalidAuth,
  ValidAuthsForSignin,
  ProfileWithAuth
} from './types/authTypes';
import { GhcAuthManager } from './ghcAuth';
import { RefreshTokenAnalyzer } from './refreshTokenAnalyzer';

const logger = createLogger();

/**
 * Main process auth manager - responsible for unified auth session management
 * Integrates all functionality from the original SigninOps, providing complete auth and user data management
 * 
 * Core responsibilities:
 * - Manage current auth session
 * - Handle token refresh
 * - Communicate with renderer process
 * - Persist auth state
 * - Profile directory and auth.json management
 * - Post-authentication processing
 */
export class MainAuthManager implements IAuthManager {
  private static instance: MainAuthManager;
  private currentAuth: AuthData | null = null;
  private ghcAuth: GhcAuthManager;
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.ghcAuth = GhcAuthManager.getInstance();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): MainAuthManager {
    if (!MainAuthManager.instance) {
      MainAuthManager.instance = new MainAuthManager();
    }
    return MainAuthManager.instance;
  }

  // =============================================================================
  // PROFILE AND AUTH.JSON MANAGEMENT (integrated from SigninOps)
  // =============================================================================

  /**
   * Get the profiles directory path
   */
  private getProfilesDirectoryPath(): string {
    const appPath = app.getPath('userData');
    return path.join(appPath, 'profiles');
  }

  /**
   * Check if a directory contains a valid auth.json file
   */
  private async hasValidAuthJson(profilePath: string): Promise<boolean> {
    try {
      const authJsonPath = path.join(profilePath, 'auth.json');
      const stats = await fs.promises.stat(authJsonPath);
      return stats.isFile();
    } catch (error) {
      return false;
    }
  }

  /**
   * Read and parse auth.json file
   */
  private async readAuthJson(profilePath: string): Promise<AuthData | null> {
    try {
      const authJsonPath = path.join(profilePath, 'auth.json');
      const content = await fs.promises.readFile(authJsonPath, 'utf-8');
      return JSON.parse(content) as AuthData;
    } catch (error) {
      logger.error(`[MainAuthManager] Error reading auth.json from ${profilePath}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Sanitize and validate auth data structure (V3 - new token format)
   */
  private sanitizeAuthData(authData: AuthData): AuthData {
    try {
      const rawPlan = authData.ghcAuth?.user?.copilotPlan || 'individual';
      const validPlans: Array<'individual' | 'business' | 'enterprise'> = ['individual', 'business', 'enterprise'];
      const copilotPlan = validPlans.includes(rawPlan as any) ? rawPlan as 'individual' | 'business' | 'enterprise' : 'individual';
      
      const cleanUser = {
        id: String(authData.ghcAuth?.user?.id || ''),
        login: String(authData.ghcAuth?.user?.login || ''),
        email: String(authData.ghcAuth?.user?.email || ''),
        name: String(authData.ghcAuth?.user?.name || ''),
        avatarUrl: String(authData.ghcAuth?.user?.avatarUrl || ''),
        copilotPlan
      };

      const cleanGitHubTokens = {
        timestamp: String(authData.ghcAuth?.gitHubTokens?.timestamp || new Date().toISOString()),
        api_url: String(authData.ghcAuth?.gitHubTokens?.api_url || 'https://github.com/login/oauth/access_token'),
        access_token: String(authData.ghcAuth?.gitHubTokens?.access_token || ''),
        token_type: String(authData.ghcAuth?.gitHubTokens?.token_type || 'bearer'),
        scope: String(authData.ghcAuth?.gitHubTokens?.scope || '')
      };

      const cleanCopilotTokens = {
        timestamp: String(authData.ghcAuth?.copilotTokens?.timestamp || new Date().toISOString()),
        api_url: String(authData.ghcAuth?.copilotTokens?.api_url || 'https://api.github.com/copilot_internal/v2/token'),
        expires_at: typeof authData.ghcAuth?.copilotTokens?.expires_at === 'number'
          ? authData.ghcAuth.copilotTokens.expires_at
          : 0,
        token: String(authData.ghcAuth?.copilotTokens?.token || '')
      };

      const cleanCapabilities = Array.isArray(authData.ghcAuth?.capabilities)
        ? authData.ghcAuth.capabilities.filter(cap => typeof cap === 'string')
        : ['chat', 'completion', 'inline_completion'];

      const cleanGhcAuth = {
        alias: String(authData.ghcAuth?.alias || ''),
        user: cleanUser,
        gitHubTokens: cleanGitHubTokens,
        copilotTokens: cleanCopilotTokens,
        capabilities: cleanCapabilities
      };

      return {
        version: String(authData.version || '3.0.0'),
        createdAt: String(authData.createdAt || new Date().toISOString()),
        updatedAt: String(authData.updatedAt || new Date().toISOString()),
        authProvider: String(authData.authProvider || 'ghc'),
        ghcAuth: cleanGhcAuth
      };
    } catch (error) {
      logger.error('[MainAuthManager] Auth data sanitization failed, using minimal safe configuration:', error instanceof Error ? error.message : String(error));
      
      return {
        version: '3.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        authProvider: 'ghc',
        ghcAuth: {
          alias: String(authData.ghcAuth?.alias || ''),
          user: {
            id: '',
            login: '',
            email: '',
            name: '',
            avatarUrl: '',
            copilotPlan: 'individual'
          },
          gitHubTokens: {
            timestamp: new Date().toISOString(),
            api_url: 'https://github.com/login/oauth/access_token',
            access_token: '',
            token_type: 'bearer',
            scope: ''
          },
          copilotTokens: {
            timestamp: new Date().toISOString(),
            api_url: 'https://api.github.com/copilot_internal/v2/token',
            expires_at: 0,
            token: ''
          },
          capabilities: ['chat', 'completion', 'inline_completion']
        }
      };
    }
  }

  /**
   * Write auth.json file for a profile
   */
  private async writeAuthJson(profilePath: string, authData: AuthData): Promise<boolean> {
    try {
      const authJsonPath = path.join(profilePath, 'auth.json');
      
      const sanitizedAuthData = this.sanitizeAuthData(authData);
      sanitizedAuthData.updatedAt = new Date().toISOString();
      
      const content = JSON.stringify(sanitizedAuthData, null, 2);
      await fs.promises.writeFile(authJsonPath, content, 'utf-8');
      
      return true;
    } catch (error) {
      logger.error(`[MainAuthManager] Error writing auth.json to ${profilePath}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Check if auth.json has valid ghcAuth information (V3 - new token format)
   */
  private hasValidGhcAuth(authData: any): boolean {
    try {
      if (!authData || !authData.ghcAuth) {
        return false;
      }

      const ghcAuth = authData.ghcAuth;
      
      if (!ghcAuth.user) {
        return false;
      }
      
      // 🔧 Fix: email is optional, as GitHub users can choose not to make email public
      const userValid = !!(
        ghcAuth.user.id && typeof ghcAuth.user.id === 'string' && ghcAuth.user.id.trim() !== '' &&
        ghcAuth.user.login && typeof ghcAuth.user.login === 'string' && ghcAuth.user.login.trim() !== '' &&
        ghcAuth.user.name && typeof ghcAuth.user.name === 'string' && ghcAuth.user.name.trim() !== ''
        // email is optional, no longer required
      );
      
      if (!userValid) {
        return false;
      }
      
      // Validate gitHubTokens (new format)
      if (!ghcAuth.gitHubTokens) {
        return false;
      }
      
      const gitHubTokensValid = !!(
        ghcAuth.gitHubTokens.access_token && typeof ghcAuth.gitHubTokens.access_token === 'string' && ghcAuth.gitHubTokens.access_token.trim() !== '' &&
        ghcAuth.gitHubTokens.timestamp && typeof ghcAuth.gitHubTokens.timestamp === 'string'
      );
      
      if (!gitHubTokensValid) {
        return false;
      }

      // Validate copilotTokens (new format)
      if (!ghcAuth.copilotTokens) {
        return false;
      }
      
      const copilotTokensValid = !!(
        ghcAuth.copilotTokens.token && typeof ghcAuth.copilotTokens.token === 'string' && ghcAuth.copilotTokens.token.trim() !== '' &&
        typeof ghcAuth.copilotTokens.expires_at === 'number' && ghcAuth.copilotTokens.expires_at > 0
      );
      
      if (!copilotTokensValid) {
        return false;
      }
      
      if (ghcAuth.capabilities !== undefined && !Array.isArray(ghcAuth.capabilities)) {
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error('[MainAuthManager] hasValidGhcAuth: Error during validation:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Get basic valid profiles with auth.json and GitHub token validation (V3 - new token format)
   * Validity check: githubTokens exist AND getUserInfo HTTP response code is not 401
   */
  private async getBasicValidProfiles(): Promise<AuthData[]> {
    const scanId = `basicScan_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    
    const result: AuthData[] = [];
    
    try {
      const profilesDir = this.getProfilesDirectoryPath();
      
      if (!fs.existsSync(profilesDir)) {
        logger.warn(`[MainAuthManager] Profiles directory does not exist: ${profilesDir}`);
        return result;
      }

      const entries = await fs.promises.readdir(profilesDir, { withFileTypes: true });
      const profileDirectories = entries.filter(entry => entry.isDirectory());

      for (const dir of profileDirectories) {
        const alias = dir.name;
        const profilePath = path.join(profilesDir, alias);
        
        try {
          const hasAuthJson = await this.hasValidAuthJson(profilePath);
          
          if (!hasAuthJson) {
            logger.debug(`[MainAuthManager] Scanned profile: ${alias}, hasAuthJson: false`);
            continue;
          }

          logger.debug(`[MainAuthManager] 🔍 [${scanId}] Processing profile: ${alias}`);
          
          const authData = await this.readAuthJson(profilePath);
          if (!authData) {
            logger.debug(`[MainAuthManager] ❌ [${scanId}] Profile ${alias} skipped: failed to read auth.json`);
            continue;
          }

          if (!this.hasValidGhcAuth(authData)) {
            logger.debug(`[MainAuthManager] ❌ [${scanId}] Profile ${alias} skipped: incomplete ghcAuth information`);
            continue;
          }

          // V3.0 new validation logic: validate GitHub token by calling getUserInfo API
          const githubToken = authData.ghcAuth.gitHubTokens.access_token;
          
          if (!githubToken || githubToken.trim() === '') {
            logger.debug(`[MainAuthManager] ❌ [${scanId}] Profile ${alias} skipped: no GitHub token`);
            continue;
          }

          // Call getUserInfo API to validate if token is valid (check HTTP status code is not 401)
          try {
            const userInfoResponse = await fetch('https://api.github.com/user', {
              headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'GitHubCopilotChat/0.26.7'
              }
            });

            if (userInfoResponse.status === 401) {
              logger.debug(`[MainAuthManager] ❌ [${scanId}] Profile ${alias} skipped: GitHub token invalid (401 Unauthorized)`);
              continue;
            }

            if (!userInfoResponse.ok) {
              logger.debug(`[MainAuthManager] ⚠️ [${scanId}] Profile ${alias}: getUserInfo returned ${userInfoResponse.status}, but not 401 - treating as valid`);
            }

            logger.debug(`[MainAuthManager] ✅ [${scanId}] Profile ${alias}: GitHub token validated via getUserInfo (status: ${userInfoResponse.status})`);

          } catch (apiError) {
            logger.error(`[MainAuthManager] ⚠️ [${scanId}] Profile ${alias}: getUserInfo API call failed - ${apiError instanceof Error ? apiError.message : String(apiError)}`);
            // In case of network errors, handle conservatively: skip this profile
            continue;
          }

          // Use AuthData directly, set alias
          authData.ghcAuth.alias = alias;
          result.push(authData);
          logger.debug(`[MainAuthManager] ✅ [${scanId}] Profile ${alias} added: GitHub token validation passed`);
        } catch (error) {
          logger.error(`[MainAuthManager] 💥 [${scanId}] Error processing profile ${alias}:`, error instanceof Error ? error.message : String(error));
          continue;
        }
      }

      return result;

    } catch (error) {
      logger.error(`[MainAuthManager] 💥 [${scanId}] Critical error during basic profile scan:`, error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to scan basic valid profiles: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // =============================================================================
  // PUBLIC INTERFACE METHODS
  // =============================================================================

  /**
   * Set main window reference (for IPC communication)
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Set current auth - integrated with complete user initialization flow
   * 🚀 Performance optimization: added timing logs
   */
  async setCurrentAuth(authData: AuthData): Promise<void> {
    console.time('[MainAuthManager] setCurrentAuth');
    
    // Defensive check - ensure authData structure is complete
    const userLogin = authData?.ghcAuth?.user?.login || 'unknown';
    
    // Print incoming authData
    
    // Clean and validate authData
    const sanitizedAuthData = this.sanitizeAuthData(authData);
    
    // Print processed sanitizedAuthData
    
    this.currentAuth = sanitizedAuthData;
    
    // Execute complete user initialization flow
    try {
      console.time('[MainAuthManager] handlePostAuthentication');
      
      // Process complete user initialization flow
      const result = await this.handlePostAuthentication(sanitizedAuthData);
      
      console.timeEnd('[MainAuthManager] handlePostAuthentication');
      
      if (result.success) {
      } else {
        logger.error('[MainAuthManager] ❌ Post-auth initialization failed:', 'MainAuthManager', {
          user: userLogin,
          message: result.message
        });
      }
      
    } catch (error) {
      console.timeEnd('[MainAuthManager] handlePostAuthentication');
      logger.error('[MainAuthManager] ❌ Post-auth initialization error:', 'MainAuthManager', {
        user: userLogin,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Start Token monitoring - only start after currentAuth is set
    try {
      const { mainTokenMonitor } = await import('./tokenMonitor');
      mainTokenMonitor.startMonitoring();
    } catch (monitorError) {
      logger.error('[MainAuthManager] ❌ Token monitoring startup failed:', 'MainAuthManager', {
        user: userLogin,
        error: monitorError instanceof Error ? monitorError.message : String(monitorError)
      });
    }
    
    // Notify renderer process - using sanitized data
    this.notifyRendererAuthChanged('auth_set', sanitizedAuthData);
    
    console.timeEnd('[MainAuthManager] setCurrentAuth');
  }

  /**
   * Handle post-authentication with different user scenarios
   */
  async handlePostAuthentication(authData: AuthData): Promise<{
    success: boolean;
    isNewUser: boolean;
    hasUpdates: boolean;
    message?: string;
  }> {
    const alias = authData.ghcAuth.alias;
    
    try {
      // Create user directory if it doesn't exist
      const profilesDir = this.getProfilesDirectoryPath();
      const userDir = path.join(profilesDir, alias);
      
      try {
        await fs.promises.mkdir(userDir, { recursive: true });
      } catch (error) {
        logger.error(`[MainAuthManager] Failed to create directory for user ${alias}:`, error instanceof Error ? error.message : String(error));
        return {
          success: false,
          isNewUser: false,
          hasUpdates: false,
          message: `Failed to create directory for user ${alias}`
        };
      }
      
      // Check if user has valid auth.json
      const hasValidAuth = await this.hasValidAuthForProfile(alias);
      
      if (!hasValidAuth) {
        // NEW USER: Create new auth.json and initialize profile
        
        const authCreateSuccess = await this.createAuthJson(alias, authData);
        
        if (!authCreateSuccess) {
          return {
            success: false,
            isNewUser: true,
            hasUpdates: false,
            message: `Failed to create auth.json for user: ${alias}`
          };
        }
        
        // Initialize ProfileCacheManager
        const profileResult = await this.initializeProfileManager(alias);
        return {
          success: profileResult.success,
          isNewUser: true,
          hasUpdates: false,
          message: profileResult.message
        };
        
      } else {
        // EXISTING USER: Check if auth needs updating
        const existingAuthData = await this.getAuthDataForProfile(alias);
        
        if (existingAuthData && !this.authDataHasUpdates(existingAuthData, authData)) {
          // No updates needed - just load profile
          
          const profileResult = await this.initializeProfileManager(alias);
          return {
            success: profileResult.success,
            isNewUser: false,
            hasUpdates: false,
            message: profileResult.message
          };
          
        } else {
          // Updates detected - update auth.json and load profile
          
          const authUpdateSuccess = await this.createAuthJson(alias, authData);
          
          if (!authUpdateSuccess) {
            return {
              success: false,
              isNewUser: false,
              hasUpdates: true,
              message: `Failed to update auth.json for user: ${alias}`
            };
          }
          
          const profileResult = await this.initializeProfileManager(alias);
          return {
            success: profileResult.success,
            isNewUser: false,
            hasUpdates: true,
            message: profileResult.message
          };
        }
      }
      
    } catch (error) {
      logger.error(`[MainAuthManager] Error handling post-authentication for user ${alias}:`, error instanceof Error ? error.message : String(error));
      return {
        success: false,
        isNewUser: false,
        hasUpdates: false,
        message: `Error handling post-authentication: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Initialize ProfileCacheManager for a user
   */
  private async initializeProfileManager(alias: string): Promise<{ success: boolean; message: string }> {
    try {
      const { profileCacheManager } = await import('../userDataADO');
      const profileLoadSuccess = await profileCacheManager.handleProfile(alias);
      
      if (profileLoadSuccess) {
        return {
          success: true,
          message: `Successfully initialized profile for user: ${alias}`
        };
      } else {
        return {
          success: false,
          message: `Failed to initialize profile for user: ${alias}`
        };
      }
    } catch (profileError) {
      logger.error(`[MainAuthManager] Error initializing ProfileCacheManager for user ${alias}:`, profileError instanceof Error ? profileError.message : String(profileError));
      return {
        success: false,
        message: `Error initializing profile: ${profileError instanceof Error ? profileError.message : String(profileError)}`
      };
    }
  }

  // Helper methods for auth data management

  /**
   * Compare auth data to detect if there are any updates (V3 - new token format)
   */
  private authDataHasUpdates(existingAuth: AuthData, newAuthData: AuthData): boolean {
    if (!existingAuth.ghcAuth) return true;
    
    const existing = existingAuth.ghcAuth;
    const newAuth = newAuthData.ghcAuth;
    
    // Compare user info
    if (existing.user.id !== newAuth.user.id ||
        existing.user.login !== newAuth.user.login ||
        existing.user.email !== newAuth.user.email ||
        existing.user.name !== newAuth.user.name ||
        existing.user.avatarUrl !== newAuth.user.avatarUrl ||
        existing.user.copilotPlan !== newAuth.user.copilotPlan) {
      return true;
    }
    
    // Compare GitHub tokens (new format)
    if (existing.gitHubTokens.access_token !== newAuth.gitHubTokens.access_token ||
        existing.gitHubTokens.token_type !== newAuth.gitHubTokens.token_type ||
        existing.gitHubTokens.scope !== newAuth.gitHubTokens.scope) {
      return true;
    }
    
    // Compare Copilot tokens (new format)
    if (existing.copilotTokens.token !== newAuth.copilotTokens.token ||
        existing.copilotTokens.expires_at !== newAuth.copilotTokens.expires_at) {
      return true;
    }
    
    // Compare capabilities
    if (JSON.stringify(existing.capabilities?.sort()) !== JSON.stringify(newAuth.capabilities?.sort())) {
      return true;
    }
    
    return false;
  }


  /**
   * Check if a profile has valid auth.json with complete ghcAuth data
   */
  private async hasValidAuthForProfile(alias: string): Promise<boolean> {
    const profilePath = path.join(this.getProfilesDirectoryPath(), alias);
    const authData = await this.readAuthJson(profilePath);
    return authData ? this.hasValidGhcAuth(authData) : false;
  }

  /**
   * Get auth data for a specific profile
   */
  private async getAuthDataForProfile(alias: string): Promise<AuthData | null> {
    const profilePath = path.join(this.getProfilesDirectoryPath(), alias);
    return await this.readAuthJson(profilePath);
  }

  /**
   * Create auth.json file for a profile with given data
   */
  private async createAuthJson(alias: string, authData: AuthData): Promise<boolean> {
    const profilePath = path.join(this.getProfilesDirectoryPath(), alias);
    return await this.writeAuthJson(profilePath, authData);
  }

  // =============================================================================
  // REMAINING INTERFACE METHODS (keeping existing functionality)
  // =============================================================================

  /**
   * Get current auth data
   */
  getCurrentAuth(): AuthData | null {
    return this.currentAuth;
  }

  /**
   * Destroy current auth
   */
  async destroyCurrentAuth(): Promise<void> {
    if (this.currentAuth) {
      const userLogin = this.currentAuth.ghcAuth.user.login;
      
      
      // Stop Token monitoring
      try {
        const { mainTokenMonitor } = await import('./tokenMonitor');
        mainTokenMonitor.stopMonitoring();
      } catch (error) {
        logger.error('[MainAuthManager] ❌ Failed to stop Token monitoring:', 'MainAuthManager', {
          user: userLogin,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Clear local tokens
      try {
        await this.clearTokensForUser(userLogin);
      } catch (error) {
        logger.error('[MainAuthManager] ❌ Failed to clear local tokens:', 'MainAuthManager', {
          user: userLogin,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Clear auth state
      this.currentAuth = null;
      
      // Notify renderer process
      this.notifyRendererAuthChanged('auth_destroyed', null);
      
    }
  }

  /**
   * Unified user sign-out cleanup method
   * Coordinates cleanup operations across all related components, ensuring complete resource release
   */
  async signOut(): Promise<void> {
    const signOutStart = Date.now();
    const signOutId = `signOut_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    if (!this.currentAuth) {
      return;
    }

    const userLogin = this.currentAuth.ghcAuth.user.login;

    try {
      // Phase 1: Clean up auth data and tokens
      await this.destroyCurrentAuth();
      
      // Phase 2: Clean up ProfileCacheManager data cache
      try {
        const { profileCacheManager } = await import('../userDataADO/profileCacheManager');
        profileCacheManager.clearCache(userLogin);
      } catch (error) {
        logger.error(`[MainAuthManager] ❌ [${signOutId}] Failed to clear ProfileCacheManager cache:`, error instanceof Error ? error.message : String(error));
      }

      // Phase 3: Clean up MCPClient instances
      try {
        const { mcpClientManager } = await import('../mcpRuntime/mcpClientManager');
        await mcpClientManager.resetForSignOut();
      } catch (error) {
        logger.error(`[MainAuthManager] ❌ [${signOutId}] Failed to clear MCP client instances:`, error instanceof Error ? error.message : String(error));
      }

      // Phase 3.5: Clean up AgentChatManager instances
      try {
        const { agentChatManager } = await import('../chat/agentChatManager');
        agentChatManager.destroy();
        logger.info(`[MainAuthManager] ✅ [${signOutId}] AgentChatManager destroyed`);
      } catch (error) {
        logger.error(`[MainAuthManager] ❌ [${signOutId}] Failed to destroy AgentChatManager:`, error instanceof Error ? error.message : String(error));
      }

      // Phase 4: Clean up Mem0 resources
      try {
        // Reset Mem0 instance
        const { resetKosmosMemory } = await import('../mem0/kosmos-adapters');
        await resetKosmosMemory();
        
      } catch (error) {
        logger.error(`[MainAuthManager] ❌ [${signOutId}] Failed to clear mem0 resources:`, error instanceof Error ? error.message : String(error));
      }

      // Phase 5: Notify renderer process to perform cleanup
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('auth:signOut', {
            userLogin,
            timestamp: Date.now(),
            signOutId
          });
        }
      } catch (error) {
        logger.error(`[MainAuthManager] ❌ [${signOutId}] Failed to notify renderer process:`, error instanceof Error ? error.message : String(error));
      }

      const signOutDuration = Date.now() - signOutStart;
      
    } catch (error) {
      const signOutDuration = Date.now() - signOutStart;
      logger.error(`[MainAuthManager] ❌ [${signOutId}] Sign-out failed for user: ${userLogin} in ${signOutDuration}ms:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Clear tokens for a specific user (V3 - new token format)
   */
  private async clearTokensForUser(alias: string): Promise<boolean> {
    try {
      
      const profilePath = path.join(this.getProfilesDirectoryPath(), alias);
      const existingAuth = await this.readAuthJson(profilePath);
      
      if (!existingAuth) {
        logger.error(`[MainAuthManager] Cannot clear tokens for ${alias}: auth.json not found`);
        return false;
      }

      // Create cleared auth data (V3 - clear both token types with new format)
      const now = new Date().toISOString();
      const clearedAuthData: AuthData = {
        ...existingAuth,
        updatedAt: now,
        ghcAuth: {
          ...existingAuth.ghcAuth,
          gitHubTokens: {
            timestamp: now,
            api_url: 'https://github.com/login/oauth/access_token',
            access_token: '',
            token_type: 'bearer',
            scope: ''
          },
          copilotTokens: {
            timestamp: now,
            api_url: 'https://api.github.com/copilot_internal/v2/token',
            expires_at: 0,
            token: ''
          }
        }
      };
      
      const success = await this.writeAuthJson(profilePath, clearedAuthData);
      
      if (success) {
      } else {
        logger.error(`[MainAuthManager] ❌ Failed to clear tokens for user: ${alias}`);
      }
      
      return success;
    } catch (error) {
      logger.error(`[MainAuthManager] Error clearing tokens for ${alias}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Update auth data for current auth (V2 - dual token structure)
   */
  private async updateAuthDataForCurrentAuth(): Promise<void> {
    if (!this.currentAuth) {
      return;
    }
    
    try {
      const alias = this.currentAuth.ghcAuth.alias;
      const profilePath = path.join(this.getProfilesDirectoryPath(), alias);
      
      this.currentAuth.updatedAt = new Date().toISOString();
      
      await this.writeAuthJson(profilePath, this.currentAuth);
    } catch (error) {
      logger.error('[MainAuthManager] ❌ Failed to update auth data:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Get local active auth list
   */
  async getLocalActiveAuths(): Promise<AuthData[]> {
    try {
      return await this.getBasicValidProfiles();
    } catch (error) {
      logger.error('[MainAuthManager] ❌ Failed to get local active auths:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Notify renderer process of auth changes
   */
  private notifyRendererAuthChanged(eventType: string, authData: AuthData | null): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('auth:authChanged', {
          type: eventType,
          authData: authData
        });
        logger.debug(`[MainAuthManager] ✅ Notified renderer process: ${eventType}`);
      } catch (error) {
        logger.error('[MainAuthManager] ❌ Failed to notify renderer process:', error instanceof Error ? error.message : String(error));
      }
    } else {
      logger.warn('[MainAuthManager] ⚠️ Main window unavailable, cannot notify renderer process');
    }
  }

  /**
   * Get Copilot access token
   */
  getCopilotAccessToken(): string | null {
    return this.currentAuth?.ghcAuth.copilotTokens.token || null;
  }

  /**
   * Get GitHub access token
   */
  getGitHubAccessToken(): string | null {
    return this.currentAuth?.ghcAuth.gitHubTokens.access_token || null;
  }


  /**
   * Refresh Copilot Token - enhanced version with smart error analysis (V3)
   */
  async refreshCopilotToken(): Promise<TokenRefreshResult> {
    if (!this.currentAuth) {
      return {
        success: false,
        error: 'No current auth to refresh',
        requiresReauth: false
      };
    }

    try {
      const userLogin = this.currentAuth.ghcAuth.user.login;

      const gitHubToken = this.currentAuth.ghcAuth.gitHubTokens.access_token;
      const refreshResult = await this.ghcAuth.refreshCopilotToken(gitHubToken);
      
      // Update current auth data (V3 format - directly use raw data from API response)
      this.currentAuth.ghcAuth.copilotTokens = refreshResult;
      this.currentAuth.updatedAt = new Date().toISOString();
      
      // Persist updates
      await this.updateAuthDataForCurrentAuth();
      
      // Notify renderer process
      this.notifyRendererAuthChanged('copilot_token_refreshed', this.currentAuth);
      
      
      return {
        success: true,
        authData: this.currentAuth,
        requiresReauth: false
      };
    } catch (error: any) {
      // Check error analysis results
      const shouldClearAuth = error.shouldClearSession || false;
      const errorType = error.analysis?.errorType || 'UNKNOWN_ERROR';
      const httpStatus = error.httpStatus || 0;
      
      const userLogin = this.currentAuth.ghcAuth.user.login;
      logger.error('[MainAuthManager] ❌ Copilot Token refresh failed:', 'MainAuthManager', {
        user: userLogin,
        error: error.message,
        errorType,
        httpStatus,
        shouldClearAuth,
        hasAnalysis: !!error.analysis
      });
      
      // Decide whether re-authentication is needed based on error analysis
      const requiresReauth = shouldClearAuth ||
        errorType === 'TOKEN_INVALID' ||
        (httpStatus === 401 && errorType === 'TOKEN_EXPIRED');
      
      return {
        success: false,
        error: error.message || 'Unknown error during token refresh',
        requiresReauth,
        errorType,
        httpStatus
      };
    }
  }

  /**
   * Check if auth should be cleared - enhanced version based on error analysis results
   */
  shouldClearAuthSession(refreshResult: TokenRefreshResult): boolean {
    // If refresh failed and re-auth is required, clear auth
    if (!refreshResult.success && refreshResult.requiresReauth === true) {
      return true;
    }
    
    // Check specific error types
    if (refreshResult.errorType === 'TOKEN_INVALID' ||
        (refreshResult.httpStatus === 401 && refreshResult.errorType === 'TOKEN_EXPIRED')) {
      return true;
    }
    
    return false;
  }

  // =========================================================================
  // SigninOps COMPATIBILITY METHODS
  // =========================================================================

  /**
   * Get valid auths for sign-in (from SigninOps) - V2 dual token structure
   */
  async getValidAuthsForSignin(): Promise<ValidAuthsForSignin> {
    const result: ValidAuthsForSignin = {
      validAuths: [],
      expiredAuths: [],
      invalidAuths: []
    };

    try {
      const basicValidProfiles = await this.getBasicValidProfiles();
      
      for (const authData of basicValidProfiles) {
        if (!authData || !authData.ghcAuth || !authData.ghcAuth.user ||
            !authData.ghcAuth.gitHubTokens || !authData.ghcAuth.copilotTokens) {
          result.invalidAuths.push({
            alias: authData?.ghcAuth?.alias || 'unknown',
            reason: 'Invalid auth data structure'
          });
          continue;
        }

        // All basic valid profiles are marked as valid (GitHub token valid for >15 minutes)
        result.validAuths.push(authData);
      }

      return result;

    } catch (error) {
      logger.error('[MainAuthManager] getValidAuthsForSignin failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Get profiles with GHC auth (from SigninOps)
   */
  async getProfilesWithAuth(): Promise<ProfileWithAuth[]> {
    try {
      const basicValidProfiles = await this.getBasicValidProfiles();
      return basicValidProfiles.map(authData => ({
        alias: authData.ghcAuth.alias,
        authData
      }));
    } catch (error) {
      logger.error('[MainAuthManager] getProfilesWithAuth failed:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Clear auth tokens (from SigninOps) - V3 new token format
   */
  async clearAuthTokens(alias: string): Promise<boolean> {
    try {
      const profilePath = path.join(this.getProfilesDirectoryPath(), alias);
      const authData = await this.readAuthJson(profilePath);
      
      if (authData && authData.ghcAuth) {
        // Clear both tokens but keep user info (V3 format)
        const now = new Date().toISOString();
        authData.ghcAuth.gitHubTokens = {
          timestamp: now,
          api_url: 'https://github.com/login/oauth/access_token',
          access_token: '',
          token_type: 'bearer',
          scope: ''
        };
        authData.ghcAuth.copilotTokens = {
          timestamp: now,
          api_url: 'https://api.github.com/copilot_internal/v2/token',
          expires_at: 0,
          token: ''
        };
        authData.updatedAt = now;
        
        await this.writeAuthJson(profilePath, authData);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`[MainAuthManager] Failed to clear auth tokens: ${alias}`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Delete auth.json file (from SigninOps)
   */
  async deleteAuthJson(alias: string): Promise<boolean> {
    try {
      const profilePath = path.join(this.getProfilesDirectoryPath(), alias);
      const authJsonPath = path.join(profilePath, 'auth.json');
      
      if (fs.existsSync(authJsonPath)) {
        fs.unlinkSync(authJsonPath);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`[MainAuthManager] Failed to delete auth.json: ${alias}`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Update auth.json file (from SigninOps)
   */
  async updateAuthJson(alias: string, authData: AuthData): Promise<boolean> {
    try {
      const profilePath = path.join(this.getProfilesDirectoryPath(), alias);
      await this.writeAuthJson(profilePath, authData);
      return true;
    } catch (error) {
      logger.error(`[MainAuthManager] Failed to update auth.json: ${alias}`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}

// Export singleton instance
export const mainAuthManager = MainAuthManager.getInstance();