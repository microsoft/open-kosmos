import { ipcMain } from 'electron';

import { isFeatureEnabled } from '../../lib/featureFlags';
import { getMainAuthManager, getMainTokenMonitor, getAdvancedLogger } from '../lazy';
import type { Context } from './shared';
import { browserControlHttpServer } from "../../lib/browserControl/browserControlHttpServer";
import { schedulerManager } from "../../lib/scheduler/SchedulerManager";
import { ghcAuthManager } from "../../lib/auth/ghcAuth";
import { BuddyManager } from '../../lib/buddy/BuddyManager';

export default function(ctx: Context) {
  // Get locally available sessions
  ipcMain.handle('auth:getLocalActiveSessions', async () => {
    try {
      const authManager = await getMainAuthManager();
      const sessions = await authManager.getLocalActiveAuths();
      return { success: true, data: sessions };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Set current session - V2.0 using AuthData
  ipcMain.handle('auth:setCurrentSession', async (event, authData: any) => {
    try {
      // 🔥 Defensive check: ensure authData structure is complete
      if (!authData || !authData.ghcAuth || !authData.ghcAuth.user || !authData.ghcAuth.user.login) {
        const errorMsg = 'Invalid AuthData structure in IPC handler';
        return { success: false, error: errorMsg };
      }

      const userLogin = authData.ghcAuth.user.login;
      const logger = getAdvancedLogger();

      const authManager = await getMainAuthManager();
      await authManager.setCurrentAuth(authData);

      // 🔥 Set currentUserAlias in main process
      ctx.currentUserAlias = userLogin;

      await ctx.registerGlobalShortcuts(); // Register global shortcuts

      // 🆕 Start Browser Control HTTP server (only when feature flag is enabled)
      if (isFeatureEnabled('browserControl')) {
        await browserControlHttpServer.ensureStarted();
      }

      // Initialize SchedulerManager in background — must not block sign-in
      // Chain onto any prior init promise so dispose always waits for the full sequence
      if (isFeatureEnabled('openkosmosFeatureScheduler')) {
        logger.info('[Startup] SchedulerManager initialization requested (background)', 'auth:setCurrentSession', {
          userLogin,
          trigger: 'session_restore',
        });
        const previousInit = ctx._schedulerInitPromise ?? Promise.resolve();
        ctx._schedulerInitPromise = previousInit.then(() =>
          Promise.resolve()
            .then(() => {
              logger.info('scheduler.lifecycle.auth-setCurrentSession.before-init', 'auth:setCurrentSession', {
                userLogin,
                trigger: 'session_restore',
                schedulerState: schedulerManager.getRuntimeDiagnostics(),
              });
              return schedulerManager.initialize(userLogin).then(() => {
                logger.info('scheduler.lifecycle.auth-setCurrentSession.after-init', 'auth:setCurrentSession', {
                  userLogin,
                  trigger: 'session_restore',
                  schedulerState: schedulerManager.getRuntimeDiagnostics(),
                });
                logger.info('[Startup] SchedulerManager initialization completed', 'auth:setCurrentSession', {
                  userLogin,
                });
              });
            })
            .catch((schedulerError) => {
              logger.warn('[Startup] SchedulerManager initialization failed', 'auth:setCurrentSession', {
                userLogin,
                error: schedulerError instanceof Error ? schedulerError.message : String(schedulerError),
              });
            }),
        );
      }

      // Initialize BuddyManager in background — chained to prevent cross-account state pollution
      const previousBuddyInit = ctx._buddyInitPromise ?? Promise.resolve();
      ctx._buddyInitPromise = previousBuddyInit.then(() => {
        BuddyManager.getInstance().initialize(userLogin)
          .catch((buddyError) => {
            logger.warn('[Startup] BuddyManager initialization failed', 'auth:setCurrentSession', {
              userLogin,
              error: buddyError instanceof Error ? buddyError.message : String(buddyError),
            });
          });
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get current session
  ipcMain.handle('auth:getCurrentSession', async () => {
    try {
      const authManager = await getMainAuthManager();
      const session = authManager.getCurrentAuth();
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Destroy current session
  ipcMain.handle('auth:destroyCurrentSession', async () => {
    try {
      const logger = getAdvancedLogger();
      const targetAlias = ctx.currentUserAlias;

      if (isFeatureEnabled('openkosmosFeatureScheduler')) {
        try {
          // Wait for background init to finish before disposing to avoid race
          const capturedInitPromise = ctx._schedulerInitPromise;
          if (capturedInitPromise) {
            await capturedInitPromise;
            // Only clear if no new login replaced the promise while we waited
            if (ctx._schedulerInitPromise === capturedInitPromise) {
              ctx._schedulerInitPromise = undefined;
            }
          }

          // After awaiting, a new login may have taken over — abort if alias changed
          if (ctx.currentUserAlias !== targetAlias) {
            logger.info('[Startup] SchedulerManager dispose skipped — session already switched', 'auth:destroyCurrentSession', {
              targetAlias,
              currentAlias: ctx.currentUserAlias,
            });
            return { success: true };
          }

          logger.info('scheduler.lifecycle.auth-destroyCurrentSession.before-dispose', 'auth:destroyCurrentSession', {
            schedulerState: schedulerManager.getRuntimeDiagnostics(),
          });
          await schedulerManager.dispose('auth-destroy-current-session');
          logger.info('scheduler.lifecycle.auth-destroyCurrentSession.after-dispose', 'auth:destroyCurrentSession', {
            schedulerState: schedulerManager.getRuntimeDiagnostics(),
          });
        } catch (schedulerError) {
          logger.warn('[Startup] SchedulerManager dispose failed during session destroy', 'auth:destroyCurrentSession', {
            error: schedulerError instanceof Error ? schedulerError.message : String(schedulerError),
          });
        }
      }

      // Final alias check — a new login may have taken over while we were disposing scheduler
      if (ctx.currentUserAlias !== targetAlias) {
        logger.info('[Startup] Session destroy aborted — session already switched', 'auth:destroyCurrentSession', {
          targetAlias,
          currentAlias: ctx.currentUserAlias,
        });
        return { success: true };
      }

      const authManager = await getMainAuthManager();
      await authManager.destroyCurrentAuth();

      // 🔥 Critical fix: clean up currentUserAlias in main process
      ctx.currentUserAlias = null;

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get access token
  ipcMain.handle('auth:getAccessToken', async () => {
    try {
      const authManager = await getMainAuthManager();
      const token = authManager.getCopilotAccessToken();
      return { success: true, data: token };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Refresh current session token
  ipcMain.handle('auth:refreshCurrentSessionToken', async () => {
    try {
      const authManager = await getMainAuthManager();
      const result = await authManager.refreshCopilotToken();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Token monitoring control
  // Note: startTokenMonitoring has been removed - Token monitoring is now automatically started by setCurrentAuth()

  ipcMain.handle('auth:stopTokenMonitoring', async () => {
    try {
      const tokenMonitor = await getMainTokenMonitor();
      tokenMonitor.stopMonitoring();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get monitoring status
  ipcMain.handle('auth:getMonitoringStatus', async () => {
    try {
      const tokenMonitor = await getMainTokenMonitor();
      const status = tokenMonitor.getMonitoringStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Manually trigger Token check
  ipcMain.handle('auth:manualTokenCheck', async () => {
    try {
      const tokenMonitor = await getMainTokenMonitor();
      await tokenMonitor.manualCheck();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // GitHub Copilot OAuth Device Flow - complete flow
  ipcMain.handle('auth:startGhcDeviceFlow', async (event) => {
    try {

      // Helper function: safely send message to renderer process
      const safeSend = (channel: string, data: any) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send(channel, data);
          }
        } catch (error) {
          // Ignore send failure errors (window may have been closed)
        }
      };

      // Use the complete Device Flow authentication flow
      await ghcAuthManager.performDeviceFlowAuthentication(
        // onDeviceCode: notify renderer process after device code generation
        (deviceCode) => {
          safeSend('auth:deviceCodeGenerated', deviceCode);
        },
        // onError: notify renderer process on authentication failure
        (error) => {
          safeSend('auth:deviceFlowError', { error });
        },
        // onSuccess: notify renderer process on authentication success and perform follow-up
        async (authInfo) => {

          try {
            // 🔥 Critical fix: setCurrentAuth calls handlePostAuthentication to complete all initialization
            // Including starting Token monitoring, we need to wait for it to complete before notifying frontend
            const authManager = await getMainAuthManager();
            await authManager.setCurrentAuth(authInfo);

            // Set current user alias
            ctx.currentUserAlias = authInfo.ghcAuth.user.login;

            await ctx.registerGlobalShortcuts(); // Register global shortcuts

            // 🔥 Important: only notify frontend after all initialization is complete
            safeSend('auth:deviceFlowSuccess', { authInfo });

          } catch (sessionError: any) {
            safeSend('auth:deviceFlowError', { error: sessionError.message });
          }
        }
      );

      return { success: true, message: 'Device Flow started, waiting for completion...' };

    } catch (error: any) {
      return { success: false, error: error.message || 'Unknown error' };
    }
  });

  // Unified sign-out handler - coordinate cleanup of all components
  ipcMain.handle('auth:signOut', async () => {
    try {
      // 🆕 Stop Browser Control HTTP server
      if (isFeatureEnabled('browserControl') && (process.platform === 'win32' || process.platform === 'darwin')) {
        await browserControlHttpServer.stop();
      }

      const authManager = await getMainAuthManager();
      await authManager.signOut();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
