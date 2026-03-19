// src/main/lib/auth/tokenMonitor.ts - Main process Token monitor (V3.0 - new Token format)
import { BrowserWindow } from 'electron';
import { createLogger } from '../unifiedLogger';
import { MainAuthManager } from './authManager';
import { AuthData } from './types/authTypes';

const logger = createLogger();

/**
 * Main process Token monitor V3.0 - Responsible for monitoring and refreshing tokens
 *
 * Core responsibilities:
 * - Periodically check Copilot Token validity (GitHub Token has no expires field, long-lived)
 * - Copilot Token remaining validity <= 5 minutes → auto refresh
 * - Notify user to re-login when GitHub Token becomes invalid
 * - Notify renderer process of Token status changes
 */
export class MainTokenMonitor {
  private static instance: MainTokenMonitor;
  private monitorInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 60 * 1000; // Check every 60 seconds
  private readonly COPILOT_TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000; // Copilot token 5-minute threshold
  private readonly GITHUB_TOKEN_MIN_VALIDITY = 15 * 60 * 1000; // GitHub token minimum validity 15 minutes
  private isMonitoring = false;
  private authManager: MainAuthManager;
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.authManager = MainAuthManager.getInstance();
  }

  /**
   * Set main window reference
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Start Token monitoring
   */
  startMonitoring(): void {
    // Enhanced duplicate start prevention check
    if (this.isMonitoring && this.monitorInterval) {
      logger.warn('[MainTokenMonitor] ⚠️ Token monitor already running, skipping startup', 'MainTokenMonitor', {
        isMonitoring: this.isMonitoring,
        hasInterval: !!this.monitorInterval
      });
      return;
    }
    
    // Clean up any existing old interval (defensive programming)
    if (this.monitorInterval) {
      logger.warn('[MainTokenMonitor] ⚠️ Residual interval detected, cleaning up first', 'MainTokenMonitor');
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.isMonitoring = true;
    
    // 🔥 Key change: execute first check immediately
    this.checkAndRefreshToken().catch(error => {
      logger.error('[MainTokenMonitor] ❌ Initial token check failed:', 'MainTokenMonitor', {
        error: error instanceof Error ? error.message : String(error)
      });
    });
    
    // Set up periodic check
    this.monitorInterval = setInterval(async () => {
      await this.checkAndRefreshToken();
    }, this.CHECK_INTERVAL);

    
    this.notifyRenderer('monitor_started', {
      checkInterval: this.CHECK_INTERVAL,
      copilotRefreshThreshold: this.COPILOT_TOKEN_REFRESH_THRESHOLD,
      gitHubMinValidity: this.GITHUB_TOKEN_MIN_VALIDITY
    });
  }

  /**
   * Stop Token monitoring
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isMonitoring = false;

    
    this.notifyRenderer('monitor_stopped', {
      timestamp: Date.now()
    });
  }

  /**
   * Check and refresh Token (V3.0 - new format)
   *
   * Monitoring logic:
   * 1. Check Copilot Token (expires_at is a seconds-level timestamp)
   * 2. IF Copilot Token remaining validity <= 5 minutes → refresh Copilot Token
   * 3. IF refresh fails and it's a GitHub Token issue → notify user to re-login
   */
  private async checkAndRefreshToken(): Promise<void> {
    const checkId = `check_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    logger.debug(`[MainTokenMonitor] 🔍 [${checkId}] Starting monitor check (V3.0 new format)`, 'MainTokenMonitor', {
      timestamp: new Date().toISOString(),
      isMonitoring: this.isMonitoring,
      intervalMs: this.CHECK_INTERVAL,
      copilotRefreshThresholdMinutes: this.COPILOT_TOKEN_REFRESH_THRESHOLD / 60000
    });
    
    try {
      // Get current auth
      const currentAuth = this.authManager.getCurrentAuth();
      
      if (!currentAuth) {
        logger.debug(`[MainTokenMonitor] ℹ️ [${checkId}] No current auth, continuing to monitor and waiting for auth recovery`, 'MainTokenMonitor');
        return;
      }

      const now = Date.now();
      const ghcAuth = currentAuth.ghcAuth;
      
      // Validate token existence (V3 format)
      const hasGitHubToken = !!(ghcAuth.gitHubTokens?.access_token && ghcAuth.gitHubTokens.access_token.trim());
      const hasCopilotToken = !!(ghcAuth.copilotTokens?.token && ghcAuth.copilotTokens.token.trim());
      
      if (!hasGitHubToken) {
        logger.warn(`[MainTokenMonitor] ⚠️ [${checkId}] Missing GitHub token, cannot continue`, 'MainTokenMonitor');
        this.notifyRenderer('require_reauth', {
          reason: 'missing_github_token',
          userMessage: 'GitHub token missing, please log in again',
          checkId,
          timestamp: Date.now()
        });
        return;
      }
      
      if (!hasCopilotToken) {
        logger.warn(`[MainTokenMonitor] ⚠️ [${checkId}] Missing Copilot token but GitHub token exists, attempting refresh`, 'MainTokenMonitor');
        await this.handleCopilotTokenRefresh('missing');
        return;
      }
      
      // Check Copilot Token (V3 format - expires_at is a seconds-level timestamp)
      const nowSeconds = Math.floor(now / 1000);
      const copilotTimeUntilExpiry = (ghcAuth.copilotTokens.expires_at - nowSeconds) * 1000; // Convert to milliseconds
      const copilotMinutesUntilExpiry = Math.round(copilotTimeUntilExpiry / 60000);
      const copilotIsExpired = ghcAuth.copilotTokens.expires_at <= nowSeconds;
      const copilotIsExpiringSoon = copilotTimeUntilExpiry <= this.COPILOT_TOKEN_REFRESH_THRESHOLD;
      
      logger.debug(`[MainTokenMonitor] 📊 [${checkId}] Token status check (V3.0)`, 'MainTokenMonitor', {
        user: ghcAuth.user.login,
        ghcCurrentAuthCopilotTokenExpiresAt: ghcAuth.copilotTokens.expires_at,
        copilotTokenExpiresAt: new Date(ghcAuth.copilotTokens.expires_at * 1000).toISOString(),
        copilotMinutesUntilExpiry,
        copilotIsExpired,
        copilotIsExpiringSoon,
        hasGitHubToken,
        hasCopilotToken,
        copilotRefreshThresholdMinutes: this.COPILOT_TOKEN_REFRESH_THRESHOLD / 60000
      });
      
      // V3.0 monitoring logic: only monitor Copilot Token
      // GitHub Token has no expires field, long-lived, only checked when Copilot Token refresh fails
      if (copilotIsExpired) {
        await this.handleCopilotTokenRefresh('expired');
      } else if (copilotIsExpiringSoon) {
        await this.handleCopilotTokenRefresh('expiring_soon');
      } else {
        logger.debug(`[MainTokenMonitor] ✅ [${checkId}] Copilot Token status normal`, 'MainTokenMonitor', {
          user: ghcAuth.user.login,
          copilotMinutesUntilExpiry,
          nextCheckIn: this.CHECK_INTERVAL / 1000 + 's'
        });
      }
      
    } catch (error) {
      logger.error(`[MainTokenMonitor] ❌ [${checkId}] Error during monitor check`, 'MainTokenMonitor', { error: error instanceof Error ? error.message : String(error) });
      this.notifyRenderer('monitor_error', {
        error: error instanceof Error ? error.message : String(error),
        checkId,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle Copilot Token refresh (V3.0)
   * Uses GitHub Token to refresh Copilot Token
   * If GitHub Token is expired (API returns 401), notify user to re-login
   */
  private async handleCopilotTokenRefresh(mode: 'expired' | 'expiring_soon' | 'missing'): Promise<void> {
    
    // Call authManager.refreshCopilotToken()
    // This method internally uses GitHub token to refresh Copilot token
    const refreshResult = await this.authManager.refreshCopilotToken();
    
    if (refreshResult.success) {
      this.notifyRenderer('copilot_token_refresh_success', {
        mode,
        timestamp: Date.now()
      });
    } else {
      logger.error('[MainTokenMonitor] ❌ Copilot Token refresh failed', 'MainTokenMonitor', {
        error: refreshResult.error,
        errorType: refreshResult.errorType,
        httpStatus: refreshResult.httpStatus
      });
      
      // V3.0 logic: Check if failure was caused by an expired GitHub Token
      // If GitHub Token is expired (typically 401 error), user needs to re-login
      const isGitHubTokenExpired = refreshResult.httpStatus === 401 ||
                                   refreshResult.errorType === 'TOKEN_EXPIRED' ||
                                   refreshResult.errorType === 'TOKEN_INVALID';
      
      if (isGitHubTokenExpired || this.authManager.shouldClearAuthSession(refreshResult)) {
        logger.warn('[MainTokenMonitor] ⚠️ GitHub Token expired or invalid, user needs to log in again', 'MainTokenMonitor');
        
        await this.authManager.destroyCurrentAuth();
        
        this.notifyRenderer('require_reauth', {
          reason: 'github_token_expired',
          userMessage: 'GitHub authentication expired, please log in again',
          error: refreshResult.error,
          timestamp: Date.now()
        });
      } else {
        // Recoverable error (possibly network issues etc.), notify renderer but don't clear session
        this.notifyRenderer('copilot_token_refresh_failed', {
          reason: 'refresh_failed_recoverable',
          error: refreshResult.error,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Notify renderer process
   */
  private notifyRenderer(event: string, data: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('auth:tokenMonitor', {
        event,
        data,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Manually trigger a check
   */
  async manualCheck(): Promise<void> {
    await this.checkAndRefreshToken();
  }

  /**
   * Trigger an immediate check (for scenarios like wake from sleep)
   */
  triggerImmediateCheck(): void {
    // Use setTimeout to ensure async execution
    setTimeout(async () => {
      await this.checkAndRefreshToken();
    }, 100);
  }

  /**
   * Get monitoring status (V3.0)
   */
  getMonitoringStatus(): { isRunning: boolean; checkInterval: number; copilotRefreshThreshold: number } {
    return {
      isRunning: this.isMonitoring,
      checkInterval: this.CHECK_INTERVAL,
      copilotRefreshThreshold: this.COPILOT_TOKEN_REFRESH_THRESHOLD
    };
  }

  // Singleton pattern
  static getInstance(): MainTokenMonitor {
    if (!MainTokenMonitor.instance) {
      MainTokenMonitor.instance = new MainTokenMonitor();
    }
    return MainTokenMonitor.instance;
  }

  static resetInstance(): void {
    MainTokenMonitor.instance = null as any;
  }
}

// Export singleton instance
export const mainTokenMonitor = MainTokenMonitor.getInstance();