// 🚀 Performance timing: record module loading start time
console.time('[Startup] Total main.ts load');
console.time('[Startup] Module imports');

// 🛡️ Global EPIPE error handling - must register at the earliest stage to capture all stream write errors
// EPIPE errors occur when writing to a closed pipe (e.g., console output during app exit)
// These errors should be silently ignored rather than causing the app to crash
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'EIO') {
    // Silently ignore - pipe closed or I/O error
    return;
  }
});

process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'EIO') {
    // Silently ignore - pipe closed or I/O error
    return;
  }
});

import { app, BrowserWindow, ipcMain, Menu, shell, dialog, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Browser Control configuration and status check
import { BROWSER_CONFIG, COMBINED_SCRIPTS } from './lib/browserControl/browserConfig';
import { checkBrowserControlEnabled } from './lib/browserControl/browserControlStatus';
import { browserControlHttpServer } from './lib/browserControl/browserControlHttpServer';

// 🔥 Must be called before app.ready - register custom protocol for screenshot functionality
protocol.registerSchemesAsPrivileged([{
  scheme: 'screenshot',
  privileges: {
    secure: true,
    standard: true,
    bypassCSP: true,
    supportFetchAPI: true,
    stream: true,
  }
}]);
import * as os from 'os';
import type {
  SelectionHookConstructor,
  SelectionHookInstance,
  TextSelectionData,
} from 'selection-hook'

// 🚀 Phase 2 optimization: heavy modules changed to dynamic import, not loaded at startup
// The following modules perform heavy initialization on import (singleton creation, file I/O, config reading, etc.)
// Changed to on-demand loading, significantly improving Windows startup speed

// Type imports (no code execution, used only for type checking)
import type { ProfileCacheManager } from './lib/userDataADO/profileCacheManager';
import type { AppCacheManager } from './lib/userDataADO/appCacheManager';
import type { RuntimeManager } from './lib/runtime/RuntimeManager';
import type { MainAuthManager } from './lib/auth/authManager';
import type { MainTokenMonitor } from './lib/auth/tokenMonitor';

// Lightweight utility modules (no side effects, can keep static imports)
import { createLogger, resetGlobalLogger } from './lib/unifiedLogger';
import { safeConsole, exitSafeLog } from './lib/utilities/safeConsole';
import { isFeatureEnabled } from './lib/featureFlags';

// 🚀 Lazy-loaded module cache
let _profileCacheManager: ProfileCacheManager | null = null;
let _appCacheManager: AppCacheManager | null = null;
let _runtimeManager: RuntimeManager | null = null;
let _mainAuthManager: MainAuthManager | null = null;
let _mainTokenMonitor: MainTokenMonitor | null = null;

// 🚀 Lazy getters: modules are loaded only on first call
async function getProfileCacheManager(): Promise<ProfileCacheManager> {
  if (!_profileCacheManager) {
    const module = await import('./lib/userDataADO');
    _profileCacheManager = module.profileCacheManager;
  }
  return _profileCacheManager;
}

async function getAppCacheManager(): Promise<AppCacheManager> {
  if (!_appCacheManager) {
    const module = await import('./lib/userDataADO/appCacheManager');
    _appCacheManager = module.appCacheManager;
    // Initialize immediately on first load (read and migrate app.json)
    await _appCacheManager.initialize();
  }
  return _appCacheManager;
}

async function getRuntimeManager(): Promise<RuntimeManager> {
  if (!_runtimeManager) {
    const module = await import('./lib/runtime/RuntimeManager');
    _runtimeManager = module.runtimeManager;
  }
  return _runtimeManager;
}

async function getMainAuthManager(): Promise<MainAuthManager> {
  if (!_mainAuthManager) {
    const module = await import('./lib/auth/authManager');
    _mainAuthManager = module.mainAuthManager;
  }
  return _mainAuthManager;
}

async function getMainTokenMonitor(): Promise<MainTokenMonitor> {
  if (!_mainTokenMonitor) {
    const module = await import('./lib/auth/tokenMonitor');
    _mainTokenMonitor = module.mainTokenMonitor;
  }
  return _mainTokenMonitor;
}

// 🚀 Synchronous getters (for fast access after initialization)
function getProfileCacheManagerSync(): ProfileCacheManager | null {
  return _profileCacheManager;
}

function getMainAuthManagerSync(): MainAuthManager | null {
  return _mainAuthManager;
}

function getMainTokenMonitorSync(): MainTokenMonitor | null {
  return _mainTokenMonitor;
}

console.timeEnd('[Startup] Module imports');

// 🚀 Optimization: dotenv loaded asynchronously, non-blocking startup
// Only load .env.local in development, use setImmediate to avoid blocking the main thread
if (process.env.NODE_ENV === 'development') {
  setImmediate(async () => {
    const possibleEnvPaths = [
      path.join(__dirname, '../../.env.local'),
      path.join(process.cwd(), '.env.local'),
    ];
    
    for (const envPath of possibleEnvPaths) {
      try {
        await fs.promises.access(envPath, fs.constants.F_OK);
        require('dotenv').config({ path: envPath });
        console.log('[Startup] ✅ Loaded .env.local from:', envPath);
        break;
      } catch {
        // File does not exist, continue to next
      }
    }
  });
}


// 🚀 Optimization: Hot reload lazy initialization, non-blocking startup
if (process.env.NODE_ENV === 'development') {
  // Use setImmediate for deferred loading to avoid blocking main process startup
  setImmediate(() => {
    try {
      const electronReload = require('electron-reload');
      const watchPath = __dirname;

      console.log('[Hot Reload] 🔥 Development mode detected, enabling electron-reload');

      electronReload(watchPath, {
        electron: require.resolve('electron'),
        hardResetMethod: 'exit',
        forceHardReset: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
        ignored: [/node_modules/, /\.map$/],
      });

      console.log('[Hot Reload] ✅ electron-reload enabled successfully');
    } catch (error) {
      console.error('[Hot Reload] ❌ Failed to enable electron-reload:', error);
    }
  });
}

// 🚀 Optimization: Logger lazy initialization, created only on first use
let advancedLogger: any = null;

// Lazily get Logger instance
const getAdvancedLogger = () => {
  if (!advancedLogger) {
    const logDirectory = path.join(app.getPath('userData'), 'logs');
    resetGlobalLogger();
    advancedLogger = createLogger();
    advancedLogger.updateConfig({ LOGGER_DIRECTORY: logDirectory });
  }
  return advancedLogger;
};

class ElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private debugWindow: BrowserWindow | null = null;
  private selectedText: string = ''; // Store captured selected text
  private isDev: boolean = false;
  private currentUserAlias: string | null = null;
  private selectionHook: SelectionHookInstance | null = null; // SelectionHook instance
  
  // 🚀 State tracking: app component initialization status
  private isAgentChatReady: boolean = false;

  // Browser Control Installation state (persistent, retained after component unmount)
  private browserControlInstallState = {
    isInstalling: false,
    phase: 'idle' as string,
    progress: 0,
    error: ''
  };

  constructor() {
    console.time('[Startup] ElectronApp constructor');
    
    // Ensure environment variables are fully passed
    process.env.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
    
    // If needed, additional paths can be added
    if (process.platform === 'darwin') {
      const additionalPaths = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/opt/homebrew/sbin',
        '/usr/local/sbin',
        '/usr/sbin',
        '/sbin'
      ];
      process.env.PATH = additionalPaths.join(':') + ':' + (process.env.PATH || '');
    }
    
    // Respect NODE_ENV from environment, fallback to --dev flag for backwards compatibility
    this.isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    
    // 🚀 Initialize Feature Flag manager (needs early initialization to parse command line arguments)
    (async () => {
      try {
        const { featureFlagManager } = await import('./lib/featureFlags');
        featureFlagManager.initialize();
      } catch (error) {
        console.warn('[Startup] FeatureFlagManager initialization failed:', error);
      }
    })();
    
    this.setupEventHandlers();
    
    // 🚀 Optimization: deferred log initialization, non-blocking constructor
    setImmediate(() => {
      const logger = getAdvancedLogger();
      logger.info('ElectronApp initialized', 'main', { isDev: this.isDev });
      logger.debug('PATH environment variable', 'main', { path: process.env.PATH });
    });
    
    console.timeEnd('[Startup] ElectronApp constructor');
  }

  private setupEventHandlers(): void {
    // App event handlers
    app.on('ready', this.onReady.bind(this));
    app.on('window-all-closed', this.onWindowAllClosed.bind(this));
    app.on('activate', this.onActivate.bind(this));
    
    // 🔥 Fix: add cleanup handling before app exit
    app.on('before-quit', (event) => {
      try {
        // Ensure SelectionHook is properly cleaned up before app exit
        this.cleanupSelectionHook();
      } catch (error) {
        // Ignore cleanup errors to avoid preventing app exit
        safeConsole.warn('[APP-EXIT] Error during SelectionHook cleanup:', error);
      }
    });

    app.on('will-quit', (event) => {
      try {
        // Last chance to clean up SelectionHook
        this.cleanupSelectionHook();
      } catch (error) {
        // Ignore cleanup errors to ensure app can exit normally
        safeConsole.warn('[APP-EXIT] Final cleanup error (ignored):', error);
      }
    });
    app.on('before-quit', this.onBeforeQuit.bind(this));

    // IPC event handlers
    ipcMain.handle('app:getVersion', () => app.getVersion());
    ipcMain.handle('app:getName', () => app.getName());
    ipcMain.handle('app:isDev', () => this.isDev);
    
    // � New: check if app is ready (both Analytics and AgentChat loaded)
    ipcMain.handle('app:isReady', () => {
      // In development mode, or if any component is ready, we may want to show the UI
      // But for strict "fully ready", both must be completed
      return { 
        success: true, 
        data: this.isAgentChatReady 
      };
    });

    // �🔥 New: platform detection IPC handler - for detecting Windows ARM and disabling Memory feature
    ipcMain.handle('app:getPlatformInfo', () => {
      const platform = process.platform; // 'win32', 'darwin', 'linux'
      const arch = process.arch; // 'arm64', 'x64', 'ia32'
      const isWindowsArm = platform === 'win32' && arch === 'arm64';
      
      return {
        platform,
        arch,
        isWindowsArm,
        // 🔥 Memory feature is disabled on Windows ARM (because better-sqlite3 and sqlite-vec are not supported)
        memoryEnabled: !isWindowsArm
      };
    });
    
    // 🔥 New: get userData path - for local resource access (e.g., FRE videos)
    ipcMain.handle('app:getUserDataPath', () => {
      return app.getPath('userData');
    });

    // 🆕 AppConfig IPC handlers — uniformly managed by AppCacheManager for app.json
    ipcMain.handle('app:getAppConfig', async () => {
      try {
        const manager = await getAppCacheManager();
        return { success: true, data: manager.getConfig() };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle('app:updateAppConfig', async (_event, updates: any) => {
      try {
        const manager = await getAppCacheManager();
        await manager.updateConfig(updates);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
    
    // ONLY AUTHORIZED HANDLERS: SigninOps and essential app functions
    
    // SigninOps handlers - AUTHORIZED (unified signin functionality)
    
    // Enhanced startup handler with refresh token validation
    ipcMain.handle('signin:getValidUsersForSignin', async () => {
      try {
        const authManager = await getMainAuthManager();
        const userValidation = await authManager.getValidAuthsForSignin();
        return { success: true, data: userValidation };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Auth management handlers - AUTHORIZED
    ipcMain.handle('signin:clearTokens', async (event, alias: string) => {
      try {
        const authManager = await getMainAuthManager();
        const success = await authManager.clearAuthTokens(alias);
        if (success) {
          // Clear current user alias if it is the currently logged-in user
          if (this.currentUserAlias === alias) {
            this.currentUserAlias = null;
          }
        } else {
        }
        return { success, error: success ? undefined : 'Failed to clear auth tokens' };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    });

    ipcMain.handle('signin:clearAuthData', async (event, alias: string) => {
      try {
        const authManager = await getMainAuthManager();
        const success = await authManager.deleteAuthJson(alias);
        if (success) {
          // Clear current user alias if it is the currently logged-in user
          if (this.currentUserAlias === alias) {
            this.currentUserAlias = null;
          }
        }
        return { success, error: success ? undefined : 'Failed to clear auth.json file' };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    });

    ipcMain.handle('signin:updateAuthData', async (event, alias: string, authData: any) => {
      try {
        const authManager = await getMainAuthManager();
        const success = await authManager.updateAuthJson(alias, authData);
        return { success, error: success ? undefined : 'Failed to update auth data' };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    });

    ipcMain.handle('signin:updateAuthJson', async (event, alias: string, authData: any) => {
      try {
        const authManager = await getMainAuthManager();
        const success = await authManager.updateAuthJson(alias, authData);
        return { success, error: success ? undefined : 'Failed to update auth.json' };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    });

    // Profile scanning handler (uses SigninOps internally) - AUTHORIZED
    ipcMain.handle('signin:getProfilesWithGhcAuth', async () => {
      try {
        const authManager = await getMainAuthManager();
        const profilesWithAuth = await authManager.getProfilesWithAuth();
        return { success: true, data: profilesWithAuth };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ===============================
    // Main process authentication management IPC handlers
    // ===============================
    
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
        
        const authManager = await getMainAuthManager();
        await authManager.setCurrentAuth(authData);
        
        // 🔥 Set main process currentUserAlias
        this.currentUserAlias = userLogin;

        await this.registerGlobalShortcuts(); // Register global shortcuts
        
        // 🆕 Start Browser Control HTTP server and heartbeat monitoring (only effective when enabled)
        if (process.platform === 'win32') {
          const { browserControlHttpServer } = await import('./lib/browserControl/browserControlHttpServer');
          const { browserControlMonitor } = await import('./lib/browserControl/browserControlMonitor');
          await browserControlHttpServer.ensureStarted();
          browserControlMonitor.start(userLogin);
        }
        
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
        const authManager = await getMainAuthManager();
        await authManager.destroyCurrentAuth();
        
        // 🔥 Critical fix: clean up main process currentUserAlias
        this.currentUserAlias = null;
        
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
        const { ghcAuthManager } = await import('./lib/auth/ghcAuth');
        
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
          // onDeviceCode: notify renderer process after device code is generated
          (deviceCode) => {
            safeSend('auth:deviceCodeGenerated', deviceCode);
          },
          // onError: notify renderer process on authentication failure
          (error) => {
            safeSend('auth:deviceFlowError', { error });
          },
          // onSuccess: notify renderer process on authentication success and perform follow-up processing
          async (authInfo) => {
            
            try {
              // 🔥 Critical fix: setCurrentAuth will call handlePostAuthentication to complete all initialization
              // Including starting Token monitoring, we need to wait for it to complete before notifying the frontend
              const authManager = await getMainAuthManager();
              await authManager.setCurrentAuth(authInfo);
              
              // Set current user alias
              this.currentUserAlias = authInfo.ghcAuth.user.login;

              await this.registerGlobalShortcuts(); // Register global shortcuts
              
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
        // 🆕 Stop Browser Control heartbeat monitoring and HTTP server
        if (process.platform === 'win32') {
          const { browserControlMonitor } = await import('./lib/browserControl/browserControlMonitor');
          const { browserControlHttpServer } = await import('./lib/browserControl/browserControlHttpServer');
          await browserControlMonitor.stop();
          await browserControlHttpServer.stop();
        }
        
        const authManager = await getMainAuthManager();
        await authManager.signOut();
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ProfileCacheManager Data Operations - AUTHORIZED
    ipcMain.handle('profile:getProfile', async (event, alias: string) => {
      try {
        const pcManager = await getProfileCacheManager();
        const profile = pcManager.getCachedProfile(alias);
        if (profile) {
          // Force a notification to frontend to sync current state
          await pcManager.forceNotifyProfileDataManager(alias);
          return { success: true, data: profile };
        } else {
          return { success: false, error: 'Profile not found' };
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ProfileCacheManager Primary Agent Operations - AUTHORIZED
    ipcMain.handle('profile:setPrimaryAgent', async (event, agentName: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.updatePrimaryAgent(this.currentUserAlias, agentName);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ProfileCacheManager FRE (First Run Experience) Operation - AUTHORIZED
    ipcMain.handle('profile:updateFreDone', async (event, alias: string, freDone: boolean) => {
      try {
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.updateFreDone(alias, freDone);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ProfileCacheManager MCP Operations - AUTHORIZED
    // 🆕 Refactor: call mcpClientManager directly instead of going through profileCacheManager
    ipcMain.handle('profile:addMcpServer', async (event, serverName: string, serverConfig: any) => {
      try {
        const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
        await mcpClientManager.add(serverName, serverConfig);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:updateMcpServer', async (event, serverName: string, serverConfig: any) => {
      try {
        const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
        await mcpClientManager.update(serverName, serverConfig);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:deleteMcpServer', async (event, serverName: string) => {
      try {
        const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
        await mcpClientManager.delete(serverName);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:connectMcpServer', async (event, serverName: string) => {
      try {
        const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
        await mcpClientManager.connect(serverName);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:reconnectMcpServer', async (event, serverName: string) => {
      try {
        const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
        await mcpClientManager.reconnect(serverName);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:disconnectMcpServer', async (event, serverName: string) => {
      try {
        const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
        await mcpClientManager.disconnect(serverName);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ProfileCacheManager ChatConfig Operations - AUTHORIZED
    ipcMain.handle('profile:addChatConfig', async (event, chatConfig: any) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.addChatConfig(this.currentUserAlias, chatConfig);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:updateChatConfig', async (event, chatId: string, chatConfig: any) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.updateChatConfig(this.currentUserAlias, chatId, chatConfig);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:deleteChatConfig', async (event, chatId: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.deleteChatConfig(this.currentUserAlias, chatId);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:getChatConfig', async (event, chatId: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        const chatConfig = pcManager.getChatConfig(this.currentUserAlias, chatId);
        return { success: true, data: chatConfig };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:getAllChatConfigs', async () => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        const chatConfigs = pcManager.getAllChatConfigs(this.currentUserAlias);
        return { success: true, data: chatConfigs };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('profile:updateChatAgent', async (event, chatId: string, agentUpdates: any) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.updateChatAgent(this.currentUserAlias, chatId, agentUpdates);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ProfileCacheManager ChatSession Operations - AUTHORIZED (updated to support new frontend coordination layer)
    
    // existChatSession - check if ChatSession exists
    ipcMain.handle('profile:existChatSession', async (event, alias: string, chatId: string, session: any) => {
      try {
        const pcManager = await getProfileCacheManager();
        const exists = await pcManager.existChatSession(alias, chatId, session);
        return { success: true, data: exists };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // addChatSession - support new parameter format (alias, chatId, session, chatSessionFile)
    ipcMain.handle('profile:addChatSession', async (event, alias: string, chatId: string, session: any, chatSessionFile?: any) => {
      try {
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.addChatSession(alias, chatId, session, chatSessionFile);
        if (!success) {
          return { success: false, error: 'Failed to add chat session' };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // updateChatSession - support new parameter format (alias, chatId, sessionId, updates, chatSessionFile)
    ipcMain.handle('profile:updateChatSession', async (event, alias: string, chatId: string, sessionId: string, updates: any, chatSessionFile?: any) => {
      try {
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.updateChatSession(alias, chatId, sessionId, updates, chatSessionFile);
        if (!success) {
          return { success: false, error: 'Failed to update chat session' };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // renameChatSession - rename ChatSession title (lightweight, no need for frontend to pass complete file)
    ipcMain.handle('profile:renameChatSession', async (event, alias: string, chatId: string, sessionId: string, newTitle: string) => {
      try {
        const pcManager = await getProfileCacheManager();
        // 1. Get the complete ChatSession file
        const chatSessionFile = await pcManager.getChatSessionFile(alias, chatId, sessionId);
        if (!chatSessionFile) {
          return { success: false, error: 'Chat session file not found' };
        }
        // 2. Update title
        chatSessionFile.title = newTitle;
        // 3. Update cache, index, and file through ProfileCacheManager
        const success = await pcManager.updateChatSession(
          alias, chatId, sessionId,
          { title: newTitle },
          chatSessionFile
        );
        if (!success) {
          return { success: false, error: 'Failed to rename chat session' };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // deleteChatSession - support new parameter format (alias, chatId, sessionId)
    ipcMain.handle('profile:deleteChatSession', async (event, alias: string, chatId: string, sessionId: string) => {
      try {
        const pcManager = await getProfileCacheManager();
        const success = await pcManager.deleteChatSession(alias, chatId, sessionId);
        if (!success) {
          return { success: false, error: 'Failed to delete chat session' };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // getChatSessionFile - get complete ChatSession file data (alias, chatId, sessionId)
    // 🔥 New architecture: requires chatId parameter to locate ChatSession file
    ipcMain.handle('profile:getChatSessionFile', async (event, alias: string, chatId: string, sessionId: string) => {
      try {
        const pcManager = await getProfileCacheManager();
        const sessionFile = await pcManager.getChatSessionFile(alias, chatId, sessionId);
        return { success: true, data: sessionFile };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // getChatSessions - 🔥 New architecture: get from independent chat_sessions directory structure (paginated loading)
    // Initial load: start from the most recent month, load until reaching minCount items or all loaded
    ipcMain.handle('profile:getChatSessions', async (event, alias: string, chatId: string, minCount: number = 10) => {
      try {
        // Use new chatSessionManager to get from independent directory structure (with pagination support)
        const { chatSessionManager } = await import('./lib/userDataADO/chatSessionManager');
        const result = await chatSessionManager.getChatSessions(alias, chatId, minCount);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // getMoreChatSessions - 🔥 New architecture: scroll to load more ChatSessions (one month at a time)
    ipcMain.handle('profile:getMoreChatSessions', async (event, alias: string, chatId: string, fromMonthIndex: number) => {
      try {
        const { chatSessionManager } = await import('./lib/userDataADO/chatSessionManager');
        const result = await chatSessionManager.getMoreChatSessions(alias, chatId, fromMonthIndex);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // getAllChatSessions - 🔥 Get all ChatSessions (no pagination, for special scenarios)
    ipcMain.handle('profile:getAllChatSessions', async (event, alias: string, chatId: string) => {
      try {
        const { chatSessionManager } = await import('./lib/userDataADO/chatSessionManager');
        const sessions = await chatSessionManager.getAllChatSessions(alias, chatId);
        return { success: true, data: sessions };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // 🔥 New: download ChatSession to Downloads directory
    ipcMain.handle('chatSession:downloadChatSession', async (
      event, 
      alias: string, 
      chatId: string, 
      sessionId: string, 
      title: string
    ) => {
      try {
        const { getChatSessionFilePath } = await import('./lib/userDataADO/pathUtils');
        
        // 1. Get ChatSession source file path
        const sourcePath = getChatSessionFilePath(alias, chatId, sessionId);
        
        // Check if source file exists
        if (!fs.existsSync(sourcePath)) {
          return { 
            success: false, 
            error: 'Chat session file not found' 
          };
        }
        
        // 2. Get system Downloads directory
        const downloadsDir = app.getPath('downloads');
        
        // 3. Sanitize filename (remove illegal characters)
        const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').trim() || sessionId;
        let destFileName = `${safeTitle}.json`;
        let destPath = path.join(downloadsDir, destFileName);
        
        // 4. Filename conflict handling: if same-name file exists, add timestamp suffix
        if (fs.existsSync(destPath)) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          destFileName = `${safeTitle}_${timestamp}.json`;
          destPath = path.join(downloadsDir, destFileName);
        }
        
        // 5. Copy file
        await fs.promises.copyFile(sourcePath, destPath);
        
        return { 
          success: true, 
          filePath: destPath,
          fileName: destFileName
        };
      } catch (error) {
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to download chat session' 
        };
      }
    });

    // Note: ChatSession File Operations and ChatSessionOps IPC handlers have been removed
    // Frontend ChatSessionOpsManager now serves as a coordination layer, interacting only with ProfileCacheManager
    // No longer directly interacting with ChatSessionFileOps

    // V1 ProfileCacheManager Model Operations removed - now handled through V2 Chat Agent updates

    // MCP Status Operations - AUTHORIZED
    // 🆕 Refactor: get runtime state directly from mcpClientManager
    ipcMain.handle('mcp:getServerStatus', async () => {
      try {
        // 🆕 Dynamically import mcpClientManager
        const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
        
        // Get runtime state from mcpClientManager
        const runtimeStates = mcpClientManager.getAllMcpServerRuntimeStates();
        
        // Serialize error objects for IPC transport
        const serverStatus = runtimeStates.map(state => ({
          serverName: state.serverName,
          status: state.status,
          tools: state.tools,
          lastError: state.lastError ? state.lastError.message : null
        }));
        
        return { success: true, data: serverStatus };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });


    // MCP Tool Execution - through ProfileCacheManager
    ipcMain.handle('mcp:executeTool', async (event, toolName: string, args: any) => {
      try {
        const pcManager = await getProfileCacheManager();
        const result = await pcManager.executeToolCall(toolName, args);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // KOSMOS Placeholder Operations - handle @KOSMOS_ placeholder variable replacement
    ipcMain.handle('kosmos:replacePlaceholders', async (event, envObj: Record<string, string>) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        const { kosmosPlaceholderManager } = await import('./lib/userDataADO/kosmosPlaceholders');
        const result = kosmosPlaceholderManager.replacePlaceholdersInObject(
          envObj,
          { alias: this.currentUserAlias }
        );
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // USER_INPUT Placeholder Operations - resolve @USER_INPUT_ placeholder variables
    ipcMain.handle('kosmos:parseUserInputPlaceholders', async (event, config: any) => {
      try {
        const { userInputPlaceholderParser } = await import('./lib/userDataADO/userInputPlaceholderParser');
        const result = userInputPlaceholderParser.parseConfig(config, {
          currentUserAlias: this.currentUserAlias || undefined
        });
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Skill Library Operations - AUTHORIZED
    // Display skill override confirmation dialog
    ipcMain.handle('skillLibrary:showOverwriteConfirmDialog', async (event, skillName: string) => {
      try {
        if (!this.mainWindow) {
          return { success: false, error: 'No main window available' };
        }
        
        const confirmResult = await dialog.showMessageBox(this.mainWindow, {
          type: 'warning',
          title: 'Skill Already Exists',
          message: `A skill named "${skillName}" already exists in your ON-DEVICE version.`,
          detail: 'Do you want to overwrite it with the new Skills from library? This action cannot be undone.',
          buttons: ['Cancel', 'Overwrite'],
          defaultId: 0,
          cancelId: 0
        });
        
        // Handle both old and new Electron API formats
        let confirmed = false;
        if (typeof confirmResult === 'number') {
          confirmed = confirmResult === 1; // Old API format
        } else {
          confirmed = (confirmResult as any).response === 1; // New API format
        }
        
        return { success: true, confirmed };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Install skill from a known file path (e.g., from file card / assistant message attachment)
    ipcMain.handle('skillLibrary:installSkillFromFilePath', async (event, filePath: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }

        if (!filePath) {
          return { success: false, error: 'File path is required' };
        }

        const { addSkillFromDevice } = await import('./lib/skill/skillDeviceImporter');

        // Create confirmation callback for overwrite scenarios
        const confirmCallback = async (skillName: string): Promise<boolean> => {
          if (!this.mainWindow) {
            return false;
          }

          const confirmResult = await dialog.showMessageBox(this.mainWindow, {
            type: 'warning',
            title: 'Skill Already Exists',
            message: `A skill named "${skillName}" already exists.`,
            detail: 'Do you want to replace it with the new version? This action cannot be undone.',
            buttons: ['Cancel', 'Replace'],
            defaultId: 0,
            cancelId: 0
          });

          if (typeof confirmResult === 'number') {
            return confirmResult === 1;
          } else {
            return (confirmResult as any).response === 1;
          }
        };

        const importResult = await addSkillFromDevice(filePath, this.currentUserAlias, confirmCallback);
        return importResult;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Add skill from local device (zip file)
    ipcMain.handle('skillLibrary:addSkillFromDevice', async () => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        if (!this.mainWindow) {
          return { success: false, error: 'No main window available' };
        }

        // 1. Open file dialog to select zip/skill file
        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: 'Select Skill Package',
          properties: ['openFile'],
          filters: [
            { name: 'Skill Package', extensions: ['zip', 'skill'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        // Handle dialog result (compatible with both old and new API)
        let zipPath: string | undefined;
        
        if (Array.isArray(result)) {
          // Old API format (just file paths array)
          if (result.length === 0) {
            return { success: false, error: 'File selection canceled' };
          }
          zipPath = result[0];
        } else {
          // New API format (object with canceled and filePaths)
          const dialogResult = result as { canceled: boolean; filePaths: string[] };
          if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
            return { success: false, error: 'File selection canceled' };
          }
          zipPath = dialogResult.filePaths[0];
        }
        
        if (!zipPath) {
          return { success: false, error: 'No file selected' };
        }
        
        // 2. Import and validate the skill with confirmation callback
        const { addSkillFromDevice } = await import('./lib/skill/skillDeviceImporter');
        
        // Create confirmation callback for overwrite scenarios
        const confirmCallback = async (skillName: string): Promise<boolean> => {
          if (!this.mainWindow) {
            return false;
          }
          
          const confirmResult = await dialog.showMessageBox(this.mainWindow, {
            type: 'warning',
            title: 'Skill Already Exists',
            message: `A skill named "${skillName}" already exists.`,
            detail: 'Do you want to replace it with the new version? This action cannot be undone.',
            buttons: ['Cancel', 'Replace'],
            defaultId: 0,
            cancelId: 0
          });
          
          // Handle both old and new Electron API formats
          if (typeof confirmResult === 'number') {
            return confirmResult === 1; // Old API format
          } else {
            return (confirmResult as any).response === 1; // New API format - use type assertion
          }
        };
        
        const importResult = await addSkillFromDevice(zipPath, this.currentUserAlias, confirmCallback);
        
        return importResult;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Update skill from local device (zip file) - specific skill name validation
    ipcMain.handle('skillLibrary:updateSkillFromDevice', async (event, targetSkillName: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        if (!this.mainWindow) {
          return { success: false, error: 'No main window available' };
        }

        if (!targetSkillName) {
          return { success: false, error: 'Target skill name is required for update' };
        }

        // 1. Open file dialog to select zip/skill file
        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: 'Select Skill Package to Update',
          properties: ['openFile'],
          filters: [
            { name: 'Skill Package', extensions: ['zip', 'skill'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        // Handle dialog result (compatible with both old and new API)
        let zipPath: string | undefined;
        
        if (Array.isArray(result)) {
          // Old API format (just file paths array)
          if (result.length === 0) {
            return { success: false, error: 'File selection canceled' };
          }
          zipPath = result[0];
        } else {
          // New API format (object with canceled and filePaths)
          const dialogResult = result as { canceled: boolean; filePaths: string[] };
          if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
            return { success: false, error: 'File selection canceled' };
          }
          zipPath = dialogResult.filePaths[0];
        }
        
        if (!zipPath) {
          return { success: false, error: 'No file selected' };
        }
        
        // 2. Import and validate the skill with skillName validation callback
        const { updateSkillFromDevice } = await import('./lib/skill/skillDeviceImporter');
        
        // Create skillName validation callback for update scenarios
        const validateSkillNameCallback = async (detectedSkillName: string): Promise<boolean> => {
          // Check if detected skill name matches the target skill name
          if (detectedSkillName !== targetSkillName) {
            return false; // Validation failed - skill names don't match
          }
          return true; // Validation passed - proceed with update
        };

        // Create confirmation callback for overwrite scenarios (always confirm for updates)
        const confirmCallback = async (skillName: string): Promise<boolean> => {
          if (!this.mainWindow) {
            return false;
          }
          
          const confirmResult = await dialog.showMessageBox(this.mainWindow, {
            type: 'question',
            title: 'Update Skill',
            message: `Update skill "${skillName}"?`,
            detail: 'This will replace the existing skill with the new version. This action cannot be undone.',
            buttons: ['Cancel', 'Update'],
            defaultId: 1,
            cancelId: 0
          });
          
          // Handle both old and new Electron API formats
          if (typeof confirmResult === 'number') {
            return confirmResult === 1; // Old API format
          } else {
            return (confirmResult as any).response === 1; // New API format - use type assertion
          }
        };
        
        const importResult = await updateSkillFromDevice(zipPath, this.currentUserAlias, targetSkillName, validateSkillNameCallback, confirmCallback);
        
        return importResult;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Builtin Tools - AUTHORIZED
    ipcMain.handle('builtinTools:execute', async (event, toolName: string, args: any) => {
      try {
        const { getBuiltinToolsManager } = await import('./lib/mcpRuntime/builtinTools/builtinToolsManager');
        const builtinToolsManager = getBuiltinToolsManager();
        
        // Initialize if not already initialized
        if (!builtinToolsManager['isInitialized']) {
          await builtinToolsManager.initialize();
        }
        
        const result = await builtinToolsManager.executeTool(toolName, args);
        return { success: result.success, data: result.data, error: result.error };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('builtinTools:getAllTools', async () => {
      try {
        const { getBuiltinToolsManager } = await import('./lib/mcpRuntime/builtinTools/builtinToolsManager');
        const builtinToolsManager = getBuiltinToolsManager();
        
        // Initialize if not already initialized
        if (!builtinToolsManager['isInitialized']) {
          await builtinToolsManager.initialize();
        }
        
        const toolsInfo = builtinToolsManager.getAllToolsInfo();
        return { success: true, data: toolsInfo };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('builtinTools:isBuiltinTool', async (event, toolName: string) => {
      try {
        const { getBuiltinToolsManager } = await import('./lib/mcpRuntime/builtinTools/builtinToolsManager');
        const builtinToolsManager = getBuiltinToolsManager();
        
        // Initialize if not already initialized
        if (!builtinToolsManager['isInitialized']) {
          await builtinToolsManager.initialize();
        }
        
        const isBuiltin = builtinToolsManager.isBuiltinTool(toolName);
        return { success: true, data: isBuiltin };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Skills - AUTHORIZED
    // Get the content of Skill SKILL.md file
    ipcMain.handle('skills:getSkillMarkdown', async (event, skillName: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        // Build SKILL.md file path
        // {app user data folder}/profiles/{user alias}/skills/{skill-name}/SKILL.md
        const skillMarkdownPath = path.join(
          app.getPath('userData'),
          'profiles',
          this.currentUserAlias,
          'skills',
          skillName,
          'SKILL.md'
        );
        
        // Check if file exists
        if (!fs.existsSync(skillMarkdownPath)) {
          return { success: false, error: `SKILL.md not found for skill: ${skillName}` };
        }
        
        // Read file content
        const content = fs.readFileSync(skillMarkdownPath, 'utf8');
        return { success: true, content };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get file and directory listing in Skill directory
    ipcMain.handle('skills:getSkillDirectoryContents', async (event, skillName: string, relativePath: string = '') => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        // Build Skill directory path
        const skillBasePath = path.join(
          app.getPath('userData'),
          'profiles',
          this.currentUserAlias,
          'skills',
          skillName
        );
        
        // Build full path
        const fullPath = relativePath ? path.join(skillBasePath, relativePath) : skillBasePath;
        
        // Security check: ensure path is within skill directory
        const normalizedFullPath = path.normalize(fullPath);
        const normalizedBasePath = path.normalize(skillBasePath);
        if (!normalizedFullPath.startsWith(normalizedBasePath)) {
          return { success: false, error: 'Invalid path: attempted to access outside skill directory' };
        }
        
        // Check if directory exists
        if (!fs.existsSync(fullPath)) {
          return { success: false, error: `Directory not found: ${relativePath || '/'}` };
        }
        
        const stats = fs.statSync(fullPath);
        if (!stats.isDirectory()) {
          return { success: false, error: 'Path is not a directory' };
        }
        
        // Read directory content
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        
        const items = entries.map(entry => {
          const itemPath = path.join(fullPath, entry.name);
          const itemStats = fs.statSync(itemPath);
          const itemRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
          
          return {
            name: entry.name,
            path: itemRelativePath,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            size: itemStats.size,
            modifiedTime: itemStats.mtime.toISOString(),
            extension: entry.isFile() ? path.extname(entry.name).toLowerCase().slice(1) : null
          };
        });
        
        // Sort: directories first, files second, each sorted by name
        items.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
        
        return {
          success: true,
          data: {
            currentPath: relativePath || '/',
            parentPath: relativePath ? path.dirname(relativePath) || null : null,
            items
          }
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Read file content in Skill directory
    ipcMain.handle('skills:getSkillFileContent', async (event, skillName: string, relativePath: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        if (!relativePath) {
          return { success: false, error: 'File path is required' };
        }
        
        // Build Skill directory path
        const skillBasePath = path.join(
          app.getPath('userData'),
          'profiles',
          this.currentUserAlias,
          'skills',
          skillName
        );
        
        // Build full path
        const fullPath = path.join(skillBasePath, relativePath);
        
        // Security check: ensure path is within skill directory
        const normalizedFullPath = path.normalize(fullPath);
        const normalizedBasePath = path.normalize(skillBasePath);
        if (!normalizedFullPath.startsWith(normalizedBasePath)) {
          return { success: false, error: 'Invalid path: attempted to access outside skill directory' };
        }
        
        // Check if file exists
        if (!fs.existsSync(fullPath)) {
          return { success: false, error: `File not found: ${relativePath}` };
        }
        
        const stats = fs.statSync(fullPath);
        if (!stats.isFile()) {
          return { success: false, error: 'Path is not a file' };
        }
        
        // Get file extension
        const extension = path.extname(relativePath).toLowerCase().slice(1);
        const fileName = path.basename(relativePath);
        
        // Supported text file types
        const supportedTextExtensions = ['md', 'js', 'ts', 'jsx', 'tsx', 'py', 'json', 'yaml', 'yml', 'txt', 'css', 'html', 'xml'];
        
        if (!supportedTextExtensions.includes(extension)) {
          return {
            success: true,
            data: {
              fileName,
              path: relativePath,
              extension,
              content: null,
              isSupported: false,
              size: stats.size,
              modifiedTime: stats.mtime.toISOString()
            }
          };
        }
        
        // Read file content
        const content = fs.readFileSync(fullPath, 'utf8');
        
        return {
          success: true,
          data: {
            fileName,
            path: relativePath,
            extension,
            content,
            isSupported: true,
            size: stats.size,
            modifiedTime: stats.mtime.toISOString()
          }
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Delete Skill (delete cache config, profile.json config, and folder)
    ipcMain.handle('skills:deleteSkill', async (event, skillName: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        // 1. Delete cache in ProfileCacheManager
        const pcManager = await getProfileCacheManager();
        const deleteResult = await pcManager.deleteSkill(this.currentUserAlias, skillName);
        if (!deleteResult) {
          return { success: false, error: 'Failed to delete skill from cache' };
        }
        
        // 2. Delete skill directory in the file system
        const skillPath = path.join(
          app.getPath('userData'),
          'profiles',
          this.currentUserAlias,
          'skills',
          skillName
        );
        
        if (fs.existsSync(skillPath)) {
          // Recursively delete directory and all content
          fs.rmSync(skillPath, { recursive: true, force: true });
        }
        
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Open Skill folder (in Finder/File Explorer)
    ipcMain.handle('skills:openSkillFolder', async (event, skillName: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        // Build Skill directory path
        const skillPath = path.join(
          app.getPath('userData'),
          'profiles',
          this.currentUserAlias,
          'skills',
          skillName
        );
        
        // Check if directory exists
        if (!fs.existsSync(skillPath)) {
          return { success: false, error: `Skill directory not found: ${skillName}` };
        }
        
        // Open directory in file manager
        await shell.openPath(skillPath);
        
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // MCP Client Management handlers removed - main.ts should not directly call mcpClientManager
    // These operations are now handled through ProfileCacheManager
    
    // ===============================
    // AgentChat IPC handlers
    // ===============================
    
    // Initialize AgentChatManager
    ipcMain.handle('agentChat:initialize', async (event, alias: string) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        
        // Note: mainWindow reference is already set in window ready-to-show event
        await agentChatManager.initialize(alias);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Get current AgentChat instance info
    ipcMain.handle('agentChat:getCurrentInstance', async () => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const instance = agentChatManager.getCurrentInstance();
        
        if (instance) {
          const agentInfo = await instance.getAgentInfo();
          return { success: true, data: agentInfo };
        } else {
          return { success: true, data: null };
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Get chat history
    ipcMain.handle('agentChat:getChatHistory', async () => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const messages = agentChatManager.getChatHistory();
        return { success: true, data: messages };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // 🔥 New: get messages for display (Custom System Prompt + chatHistory)
    ipcMain.handle('agentChat:getDisplayMessages', async () => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const instance = agentChatManager.getCurrentInstance();
        if (!instance) {
          return { success: false, error: 'No current agent instance' };
        }
        const messages = instance.getDisplayMessages();
        return { success: true, data: messages };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // 🔥 IPC handling for starting a new conversation for a specified ChatId
    ipcMain.handle('agentChat:startNewChatFor', async (event, chatId: string) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const instance = await agentChatManager.startNewChatFor(chatId);
        return instance ? { success: true, chatSessionId: instance.getChatSessionId() } : { success: false };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Handle conversation (with streaming support)
    ipcMain.handle('agentChat:streamMessage', async (event, message: any) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const instance = agentChatManager.getCurrentInstance();
        
        if (!instance) {
          return { success: false, error: 'No current agent instance' };
        }
        
        // 🔥 New: set eventSender so AgentChat can send events to renderer process
        instance.setEventSender(event.sender);
        
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
        
        // Set up streaming callbacks
        const callbacks = {
          onAssistantMessage: (msg: any) => {
            safeSend('agentChat:streamingMessage', msg);
          },
          onToolUse: (toolName: string) => {
            safeSend('agentChat:toolUse', toolName);
          },
          onToolResult: (result: any) => {
            safeSend('agentChat:toolResult', result);
          }
        };
        
        // Use AgentChatManager.streamMessage instead of directly calling instance
        // This enables CancellationToken support
        const currentChatSessionId = agentChatManager.getCurrentActiveChatSessionId();
        if (!currentChatSessionId) {
          return { success: false, error: 'No current chat session ID' };
        }
        
        const result = await agentChatManager.streamMessage(currentChatSessionId, message);
        
        // 🔥 New: clear eventSender after processing is complete
        instance.setEventSender(null);
        
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const statusCode = (error as any)?.statusCode;
        return { success: false, error: statusCode ? `[HTTP ${statusCode}] ${errorMessage}` : errorMessage };
      }
    });
    
    // 🔥 Retry the last failed conversation
    ipcMain.handle('agentChat:retryChat', async (event, chatSessionId: string) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        
        // Use the passed chatSessionId, if none then fall back to the current active session
        const targetChatSessionId = chatSessionId || agentChatManager.getCurrentActiveChatSessionId();
        if (!targetChatSessionId) {
          return { success: false, error: 'No chat session ID provided' };
        }
        
        const instance = agentChatManager.getInstanceByChatSessionId(targetChatSessionId);
        if (!instance) {
          return { success: false, error: `No agent instance found for session: ${targetChatSessionId}` };
        }
        
        // Set eventSender so AgentChat can send events to renderer process
        instance.setEventSender(event.sender);
        
        const result = await agentChatManager.retryChat(targetChatSessionId);
        
        // Clear eventSender after processing is complete
        instance.setEventSender(null);
        
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Cancel chat operation (using the current active chatSession)
    ipcMain.handle('agentChat:cancelChat', async (event, chatId: string) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const currentChatSessionId = agentChatManager.getCurrentActiveChatSessionId();
        if (!currentChatSessionId) {
          return { success: false, error: 'No active chat session to cancel' };
        }
        const result = await agentChatManager.cancelChatSession(currentChatSessionId);
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Sync chat history
    ipcMain.handle('agentChat:syncChatHistory', async (event, messages: any[]) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        agentChatManager.syncChatHistory(messages);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Get current Chat ID
    ipcMain.handle('agentChat:getCurrentChatId', async () => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const currentInstance = agentChatManager.getCurrentInstance();
        const chatId = currentInstance ? currentInstance.getChatId() : null;
        return { success: true, data: chatId };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Refresh current instance
    ipcMain.handle('agentChat:refreshCurrentInstance', async () => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const instance = await agentChatManager.refreshCurrentInstance();
        
        if (instance) {
          const agentInfo = await instance.getAgentInfo();
          return { success: true, data: agentInfo };
        } else {
          return { success: false, error: 'Failed to refresh instance' };
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    // 🔥 New: switch to specified ChatSessionId (new architecture)
    ipcMain.handle('agentChat:switchToChatSession', async (event, chatId: string, chatSessionId: string) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const instance = await agentChatManager.switchToChatSession(chatId, chatSessionId);
        
        if (instance) {
          const agentInfo = await instance.getAgentInfo();
          return { success: true, data: agentInfo };
        } else {
          return { success: false, error: 'Failed to switch to chat session' };
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // 🔥 New: get current ChatSession status info (called proactively by frontend)
    ipcMain.handle('agentChat:getChatStatusInfo', async () => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const instance = agentChatManager.getCurrentInstance();
        
        if (!instance) {
          return { success: false, error: 'No current agent instance' };
        }
        
        const statusInfo = instance.getChatStatusInfo();
        return { success: true, data: statusInfo };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // 🔥 New: get current ChatSession Context Token usage (called proactively by frontend)
    ipcMain.handle('agentChat:getCurrentContextTokenUsage', async () => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const tokenUsage = agentChatManager.getCurrentContextTokenUsage();
        
        if (!tokenUsage) {
          return { success: false, error: 'No context token usage available' };
        }
        
        return { success: true, data: tokenUsage };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // 🔥 New: cancel specified ChatSession operation
    ipcMain.handle('agentChat:cancelChatSession', async (event, chatSessionId: string) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const result = await agentChatManager.cancelChatSession(chatSessionId);
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // 🔥 New: delete specified ChatSession AgentChat instance
    ipcMain.handle('agentChat:removeAgentChatInstance', async (event, chatSessionId: string) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        agentChatManager.removeInstanceByChatSession(chatSessionId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // 🔥 New: Fork ChatSession - copy ChatSession and switch to new ChatSession
    ipcMain.handle('agentChat:forkChatSession', async (event, chatId: string, sourceChatSessionId: string) => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const result = await agentChatManager.forkChatSession(chatId, sourceChatSessionId);
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // 🔥 New: Import Agent Assets - import Chat Sessions and Workspace from zip package
    ipcMain.handle('agentChat:importAgentAssets', async (event, chatId: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        if (!this.mainWindow) {
          return { success: false, error: 'No main window available' };
        }
        
        // 1. Open file selection dialog to select zip file
        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: 'Select Agent Assets Package',
          properties: ['openFile'],
          filters: [
            { name: 'Agent Assets Package', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        
        // Handle dialog result (compatible with both old and new API)
        let zipPath: string | undefined;
        
        if (Array.isArray(result)) {
          // Old API format (just file paths array)
          if (result.length === 0) {
            return { success: false, error: 'File selection canceled' };
          }
          zipPath = result[0];
        } else {
          // New API format (object with canceled and filePaths)
          const dialogResult = result as { canceled: boolean; filePaths: string[] };
          if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
            return { success: false, error: 'File selection canceled' };
          }
          zipPath = dialogResult.filePaths[0];
        }
        
        if (!zipPath) {
          return { success: false, error: 'No file selected' };
        }
        
        // 2. Call agentAssetsImporter to perform import
        const { importAgentAssetsFromZip } = await import('./lib/userDataADO/agentAssetsImporter');
        const importResult = await importAgentAssetsFromZip(this.currentUserAlias, chatId, zipPath);
        
        return importResult;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // 🔥 New: Import Agent Assets from URL - download zip package from remote URL and import
    ipcMain.handle('agentChat:importAgentAssetsFromUrl', async (event, chatId: string, zipUrl: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        
        // Call agentAssetsImporter importAgentAssetsFromUrl to perform import
        const { importAgentAssetsFromUrl } = await import('./lib/userDataADO/agentAssetsImporter');
        const importResult = await importAgentAssetsFromUrl(this.currentUserAlias, chatId, zipUrl);
        
        return importResult;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Get current ChatSession
    ipcMain.handle('agentChat:getCurrentChatSession', async () => {
      try {
        const { agentChatManager } = await import('./lib/chat/agentChatManager');
        const currentInstance = agentChatManager.getCurrentInstance();
        if (!currentInstance) {
          return { success: false, error: 'No current agent instance available' };
        }
        
        const currentSession = currentInstance.getCurrentChatSession();
        return { success: true, data: currentSession };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // 🔥 New: handle batch Tool approval responses
    ipcMain.handle('agentChat:sendBatchApprovalResponse', async (event, response: { batchRequestId: string; requestId: string; toolCallId: string; approved: boolean }) => {
      try {
        const logger = getAdvancedLogger();
        
        logger.info('[MAIN-IPC] 📥 Received batch approval response from frontend', 'agentChat:sendBatchApprovalResponse', {
          batchRequestId: response.batchRequestId,
          requestId: response.requestId,
          toolCallId: response.toolCallId,
          approved: response.approved
        });
        
        // Find the corresponding batch handler from global pending handlers
        const handlers = (global as any).__pendingBatchApprovalHandlers;
        
        logger.info('[MAIN-IPC] Checking for pending handlers', 'agentChat:sendBatchApprovalResponse', {
          batchRequestId: response.batchRequestId,
          hasPendingHandlers: !!handlers,
          hasSpecificHandler: !!(handlers && handlers[response.batchRequestId])
        });
        
        if (handlers && handlers[response.batchRequestId]) {
          const handler = handlers[response.batchRequestId];
          
          logger.info('[MAIN-IPC] ✅ Found handler, calling it', 'agentChat:sendBatchApprovalResponse', {
            batchRequestId: response.batchRequestId
          });
          
          // Call handler, passing complete response
          handler(response);
          
          logger.info('[MAIN-IPC] ✅ Handler called successfully', 'agentChat:sendBatchApprovalResponse', {
            batchRequestId: response.batchRequestId
          });
          
          return { success: true };
        } else {
          logger.error('[MAIN-IPC] ❌ No pending handler found', 'agentChat:sendBatchApprovalResponse', {
            batchRequestId: response.batchRequestId,
            availableHandlerIds: handlers ? Object.keys(handlers) : []
          });
          
          return {
            success: false,
            error: `No pending batch approval request found for batchRequestId: ${response.batchRequestId}`
          };
        }
      } catch (error) {
        const errorLogger = getAdvancedLogger();
        errorLogger.error('[MAIN-IPC] ❌ Error handling batch approval response', 'agentChat:sendBatchApprovalResponse', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
    
    // 🔥 New: handle user information input responses
    ipcMain.handle('agentChat:sendUserInfoInputResponse', async (event, response: { requestId: string; action: 'continue' | 'skip'; userInputs?: Record<string, any> }) => {
      try {
        const logger = getAdvancedLogger();
        
        logger.info('[MAIN-IPC] 📥 Received user info input response from frontend', 'agentChat:sendUserInfoInputResponse', {
          requestId: response.requestId,
          action: response.action,
          hasUserInputs: !!response.userInputs,
          userInputsKeys: response.userInputs ? Object.keys(response.userInputs) : []
        });
        
        // Find the corresponding handler from global pending handlers
        // 🔥 Fix: Variable name must match the one in agentChat.ts
        const handlers = (global as any).__pendingInfoInputHandlers;
        
        logger.info('[MAIN-IPC] Checking for pending handlers', 'agentChat:sendUserInfoInputResponse', {
          requestId: response.requestId,
          hasPendingHandlers: !!handlers,
          hasSpecificHandler: !!(handlers && handlers[response.requestId])
        });
        
        if (handlers && handlers[response.requestId]) {
          const handler = handlers[response.requestId];
          
          logger.info('[MAIN-IPC] ✅ Found handler, calling it', 'agentChat:sendUserInfoInputResponse', {
            requestId: response.requestId
          });
          
          // Call handler, passing complete response
          handler(response);
          
          logger.info('[MAIN-IPC] ✅ Handler called successfully', 'agentChat:sendUserInfoInputResponse', {
            requestId: response.requestId
          });
          
          return { success: true };
        } else {
          logger.error('[MAIN-IPC] ❌ No pending handler found', 'agentChat:sendUserInfoInputResponse', {
            requestId: response.requestId,
            availableHandlerIds: handlers ? Object.keys(handlers) : []
          });
          
          return {
            success: false,
            error: `No pending user info input request found for requestId: ${response.requestId}`
          };
        }
      } catch (error) {
        const errorLogger = getAdvancedLogger();
        errorLogger.error('[MAIN-IPC] ❌ Error handling user info input response', 'agentChat:sendUserInfoInputResponse', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
    
    
    // Window management
    ipcMain.handle('window:minimize', () => this.mainWindow?.minimize());
    ipcMain.handle('window:maximize', () => this.mainWindow?.maximize());
    ipcMain.handle('window:unmaximize', () => this.mainWindow?.unmaximize());
    ipcMain.handle('window:close', () => this.mainWindow?.close());
    ipcMain.handle('window:isMaximized', () => this.mainWindow?.isMaximized() || false);
    
    // 🔥 New: display application menu (Popup)
    ipcMain.handle('window:showAppMenu', (event, x: number, y: number) => {
      const template = this.getMenuTemplate();
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: this.mainWindow || undefined, x: Math.round(x), y: Math.round(y) });
      return true;
    });
    
    // Window always on top management for minimal mode
    ipcMain.handle('window:setAlwaysOnTop', (event, flag: boolean) => {
      if (this.mainWindow) {
        this.mainWindow.setAlwaysOnTop(flag, 'floating');
        return true;
      }
      return false;
    });
    
    ipcMain.handle('window:isAlwaysOnTop', () => {
      return this.mainWindow?.isAlwaysOnTop() || false;
    });
    
    // Chat popup window management
    ipcMain.handle('window:setSize', (event, width: number, height: number) => {
      if (this.mainWindow) {
        this.mainWindow.setSize(width, height);
        this.mainWindow.center();
        return true;
      }
      return false;
    });
    
    ipcMain.handle('window:getSize', () => {
      if (this.mainWindow) {
        const [width, height] = this.mainWindow.getSize();
        return { width, height };
      }
      return { width: 1200, height: 800 };
    });
    
    // Window size constraint management for minimal mode
    ipcMain.handle('window:setMinSize', (event, width: number, height: number) => {
      if (this.mainWindow) {
        this.mainWindow.setMinimumSize(width, height);
        return true;
      }
      return false;
    });
    
    ipcMain.handle('window:setMaxSize', (event, width: number, height: number) => {
      if (this.mainWindow) {
        this.mainWindow.setMaximumSize(width, height);
        return true;
      }
      return false;
    });
    
    ipcMain.handle('window:getMinSize', () => {
      if (this.mainWindow) {
        const [width, height] = this.mainWindow.getMinimumSize();
        return { width, height };
      }
      return { width: 800, height: 600 };
    });
    
    ipcMain.handle('window:getMaxSize', () => {
      if (this.mainWindow) {
        const [width, height] = this.mainWindow.getMaximumSize();
        return { width, height };
      }
      return { width: 0, height: 0 }; // 0 means no limit
    });

    // Main window control
    ipcMain.handle('mainWindow:show', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.show();
        this.mainWindow.focus();
        return { success: true };
      }
      return { success: false, error: 'Main window not available' };
    });

    ipcMain.handle('mainWindow:focus', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.focus();
        return { success: true };
      }
      return { success: false, error: 'Main window not available' };
    });

    ipcMain.handle('mainWindow:navigate', (event, route: string, state?: any) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        // Notify main window renderer process to navigate
        this.mainWindow.webContents.send('navigate:to', { route, state });
        return { success: true };
      }
      return { success: false, error: 'Main window not available' };
    });


    // Browser Control Settings
    ipcMain.handle('browserControl:getSettings', async () => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        const settings = pcManager.getBrowserControlSettings(this.currentUserAlias);
        return { success: true, data: settings };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('browserControl:updateSettings', async (event, settings: any) => {
      try {
        console.log(`[BrowserControl] Browser change requested:`, settings);
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user alias set' };
        }
        const pcManager = await getProfileCacheManager();
        
        // Save new settings (no longer operating registry; registry is handled uniformly during enable/disable)
        const success = await pcManager.updateBrowserControlSettings(this.currentUserAlias, settings);
        
        // 🆕 Write selectedBrowser.json to native-server directory (for Native Server to read)
        if (settings.browser) {
          const selectedBrowserPath = path.join(app.getPath('userData'), 'assets', 'native-server', 'selectedBrowser.json');
          try {
            // Ensure directory exists
            const dir = path.dirname(selectedBrowserPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(selectedBrowserPath, JSON.stringify({
              browser: settings.browser,
              updatedAt: Date.now()
            }, null, 2));
            console.log(`[BrowserControl] Selected browser saved to: ${selectedBrowserPath}`);
          } catch (writeErr) {
            console.warn(`[BrowserControl] Failed to write selectedBrowser.json:`, writeErr);
          }
          
          // 🆕 Notify Native Server to update (if running)
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            await fetch('http://127.0.0.1:12306/control/set-browser', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ browser: settings.browser }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            console.log(`[BrowserControl] Native Server notified of browser change`);
          } catch {
            // Native Server may not be running or endpoint does not exist, ignore
            console.log(`[BrowserControl] Native Server not reachable, skipped notification`);
          }
        }
        
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Browser Control Install, load, and start
    ipcMain.handle('browserControl:enable', async () => {
      // 🔒 Feature Flag check: browserControl
      if (!isFeatureEnabled('browserControl')) {
        return { success: false, error: 'Browser Control feature is not enabled' };
      }
      
      // Helper function for sending installation phase change events
      const sendPhaseChange = (phase: string, message?: string) => {
        this.browserControlInstallState.phase = phase;
        if (phase === 'error') {
          this.browserControlInstallState.error = message || 'Unknown error';
          this.browserControlInstallState.isInstalling = false;
        } else if (phase === 'completed') {
          this.browserControlInstallState.isInstalling = false;
          this.browserControlInstallState.progress = 100;
        }
        this.mainWindow?.webContents.send('browserControl:phaseChange', phase, message);
      };

      // Helper function for sending download progress events and updating installation state
      const sendDownloadProgress = (progress: { percent: number; transferred: string; total: string }) => {
        this.browserControlInstallState.progress = progress.percent;
        this.mainWindow?.webContents.send('browserControl:downloadProgress', progress);
      };

      // Clean up old state
      this.browserControlInstallState = {
        isInstalling: true,
        phase: 'idle',
        progress: 0,
        error: ''
      };

      try {
        // Currently only supports Windows platform
        if (process.platform !== 'win32') {
          sendPhaseChange('error', 'Browser Control setup is only supported on Windows');
          return { success: false, error: 'Browser Control setup is only supported on Windows' };
        }

        const browserControlDir = path.join(app.getAppPath(), 'resources', 'browser-control');

        // Read user-selected browser type
        const pcManager = await getProfileCacheManager();
        const browserSettings = this.currentUserAlias 
          ? pcManager.getBrowserControlSettings(this.currentUserAlias)
          : { browser: 'edge' as const };
        const selectedBrowser = browserSettings.browser || 'edge';
        const browserConfig = BROWSER_CONFIG[selectedBrowser];

        // 0. Check if browser is already installed (highest priority)
        const { checkBrowserInstalled } = await import('./lib/browserControl/browserControlStatus');
        let isBrowserInstalled = await checkBrowserInstalled(selectedBrowser);
        
        // If not installed, show dialog asking user whether to auto-install
        if (!isBrowserInstalled) {
          console.log(`[BrowserControl] ${browserConfig.displayName} is not installed, asking user for confirmation...`);
          
          const requestId = `browser-install-${Date.now()}`;
          
          // Send event to frontend to display confirmation dialog
          this.mainWindow?.webContents.send('browserControl:showBrowserInstallConfirm', {
            requestId,
            browserName: browserConfig.displayName,
          });
          
          // Wait for user response
          const userConfirmed = await new Promise<boolean>((resolve) => {
            (global as any).__pendingBrowserInstallConfirm = (global as any).__pendingBrowserInstallConfirm || {};
            (global as any).__pendingBrowserInstallConfirm[requestId] = (confirmed: boolean) => {
              delete (global as any).__pendingBrowserInstallConfirm[requestId];
              resolve(confirmed);
            };
          });
          
          // User cancelled
          if (!userConfirmed) {
            console.log(`[BrowserControl] User cancelled browser installation`);
            sendPhaseChange('idle');
            this.browserControlInstallState.isInstalling = false;
            return { success: false, error: 'User cancelled browser installation' };
          }
          
          // User confirmed, continue download and installation flow
          console.log(`[BrowserControl] User confirmed, downloading installer...`);
          sendPhaseChange('downloading');
          
          const { exec } = require('child_process');
          const tempDir = app.getPath('temp');
          
          // Use timestamp to generate unique filename, avoiding file-in-use issues
          const timestamp = Date.now();
          const installerExt = path.extname(browserConfig.installerName);
          const installerBase = path.basename(browserConfig.installerName, installerExt);
          const uniqueInstallerName = `${installerBase}_${timestamp}${installerExt}`;
          const installerPath = path.join(tempDir, uniqueInstallerName);
          
          console.log(`[BrowserControl] Installer path: ${installerPath}`);
          
          // Use curl for download (built-in on Windows 10+, -L auto-follows redirects)
          await new Promise<void>((resolve, reject) => {
            const downloadCmd = `curl -L -o "${installerPath}" "${browserConfig.downloadUrl}"`;
            console.log(`[BrowserControl] Download command: ${downloadCmd}`);
            
            exec(downloadCmd, { timeout: 300000 }, (error: Error | null, stdout: string, stderr: string) => {
              if (error) {
                console.error(`[BrowserControl] Download failed:`, error.message);
                if (stderr) console.error(`[BrowserControl] Download stderr:`, stderr);
                reject(error);
              } else {
                console.log(`[BrowserControl] Download completed: ${installerPath}`);
                resolve();
              }
            });
          });
          
          // Check if file exists
          if (!fs.existsSync(installerPath)) {
            const errorMsg = `Failed to download ${browserConfig.displayName} installer.`;
            sendPhaseChange('error', errorMsg);
            return { success: false, error: errorMsg };
          }
          
          // Use sudo-prompt to elevate privileges and install silently via msiexec (MSI offline package, blocks until installation completes)
          sendPhaseChange('installing', `Installing ${browserConfig.displayName}...`);
          console.log(`[BrowserControl] Installing ${browserConfig.displayName} from: ${installerPath}`);

          const sudoInstall = require('sudo-prompt');
          const installCmd = `msiexec /i "${installerPath}" ${browserConfig.installerArgs}`;
          console.log(`[BrowserControl] Install command: ${installCmd}`);

          await new Promise<void>((resolve, reject) => {
            sudoInstall.exec(installCmd, { name: 'Kosmos Browser Install' }, (error: Error | null, stdout: string, stderr: string) => {
              if (error) {
                console.error(`[BrowserControl] Install failed:`, error.message);
                if (stderr) console.error(`[BrowserControl] Install stderr:`, stderr);
                reject(error);
              } else {
                console.log(`[BrowserControl] Install process completed`);
                if (stdout) console.log(`[BrowserControl] Install stdout:`, stdout);
                resolve();
              }
            });
          });

          // Clean up temporary installation files
          try {
            fs.unlinkSync(installerPath);
            console.log(`[BrowserControl] Cleaned up installer: ${installerPath}`);
          } catch (cleanupErr) {
            console.warn(`[BrowserControl] Failed to clean up installer:`, cleanupErr);
          }

          // msiexec is synchronous; installation is complete when process exits, verify directly
          isBrowserInstalled = await checkBrowserInstalled(selectedBrowser);
          if (!isBrowserInstalled) {
            const errorMsg = `${browserConfig.displayName} installation may have failed. Please install manually and try again.`;
            sendPhaseChange('error', errorMsg);
            return { success: false, error: errorMsg };
          }

          console.log(`[BrowserControl] ${browserConfig.displayName} installed successfully`);
        }

        // Write to profile.json and selectedBrowser.json to ensure data consistency on both sides
        const userDataDir = app.getPath('userData');
        
        // 1) Write to profile.json
        pcManager.updateBrowserControlSettings(this.currentUserAlias!, { browser: selectedBrowser });
        console.log(`[BrowserControl] Written profile.json browserControl: ${selectedBrowser}`);
        
        // 2) Write selectedBrowser.json for Native Server to read at startup
        const selectedBrowserJson = path.join(userDataDir, 'assets', 'native-server', 'selectedBrowser.json');
        fs.mkdirSync(path.dirname(selectedBrowserJson), { recursive: true });
        fs.writeFileSync(selectedBrowserJson, JSON.stringify({ browser: selectedBrowser }, null, 2));
        console.log(`[BrowserControl] Written selectedBrowser.json: ${selectedBrowser}`);

        // 1. First request admin privileges and register browser extension (register both Chrome and Edge)
        sendPhaseChange('preparing');
        const sudo = require('sudo-prompt');
        const registerAllScript = path.join(browserControlDir, COMBINED_SCRIPTS.registerAll);
        const command = `powershell.exe -ExecutionPolicy Bypass -File "${registerAllScript}"`;
        const options = { name: 'Kosmos Browser Control Setup' };

        // Wait for admin privilege registration to complete (registering both Chrome and Edge)
        await new Promise<void>((resolve, reject) => {
          sudo.exec(command, options, (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
              reject(error);
            } else {
              console.log('[BrowserControl] Chrome and Edge extensions registered successfully');
              resolve();
            }
          });
        });

        // 2. Start HTTP server to host update.xml and CRX files
        await browserControlHttpServer.ensureStarted();

        // 3. Check if Native Server needs to be downloaded
        const { NativeServerFetcher } = await import('./lib/browserControl/nativeServerFetcher');
        const nativeServerFetcher = new NativeServerFetcher();
        const nativeServerCheck = nativeServerFetcher.checkLocalNativeServer();
        
        // If Native Server needs to be downloaded, show dialog to ask user
        if (nativeServerCheck.needsDownload) {
          console.log('[BrowserControl] Native Server not found, asking user for confirmation...');
          
          const requestId = `native-server-download-${Date.now()}`;
          
          // Send event to frontend to display confirmation dialog
          this.mainWindow?.webContents.send('browserControl:showNativeServerDownloadConfirm', {
            requestId,
          });
          
          // Wait for user response
          const userConfirmed = await new Promise<boolean>((resolve) => {
            (global as any).__pendingNativeServerDownloadConfirm = (global as any).__pendingNativeServerDownloadConfirm || {};
            (global as any).__pendingNativeServerDownloadConfirm[requestId] = (confirmed: boolean) => {
              delete (global as any).__pendingNativeServerDownloadConfirm[requestId];
              resolve(confirmed);
            };
          });
          
          // User cancelled
          if (!userConfirmed) {
            console.log('[BrowserControl] User cancelled Native Server download');
            sendPhaseChange('idle');
            this.browserControlInstallState.isInstalling = false;
            return { success: false, error: 'User cancelled Native Server download' };
          }
          
          console.log('[BrowserControl] User confirmed Native Server download');
        }
        
        // Download/ensure Native Server is ready
        console.log('[BrowserControl] Ensuring Native Server is downloaded...');
        const fetchResult = await nativeServerFetcher.ensureNativeServer(
          (progress) => {
            sendDownloadProgress(progress);
          },
          (phase) => {
            sendPhaseChange(phase);
          }
        );
        if (!fetchResult.success) {
          sendPhaseChange('error', `Failed to download Native Server: ${fetchResult.error}`);
          return { success: false, error: `Failed to download Native Server: ${fetchResult.error}` };
        }
        console.log(`[BrowserControl] Native Server ready: ${fetchResult.nativeServerDir}, version: ${fetchResult.version}, downloaded: ${fetchResult.downloaded}`);

        // 4. Register Native Server (register both Chrome and Edge, no admin privileges needed, writes to HKCU)
        sendPhaseChange('connecting');
        const { exec } = require('child_process');
        const env = { ...process.env, KOSMOS_USER_DATA_DIR: userDataDir };
        
        // Use combined script to register both Chrome and Edge Native Server simultaneously
        const registerNativeServerAllScript = path.join(browserControlDir, COMBINED_SCRIPTS.registerNativeServerAll);
        console.log('[BrowserControl] Registering Chrome and Edge Native Server...');
        await new Promise<void>((resolveNative) => {
          exec(`powershell -ExecutionPolicy Bypass -File "${registerNativeServerAllScript}"`, { env }, (err: Error | null, stdout: string, stderr: string) => {
            if (err) {
              console.error('[BrowserControl] Native Server registration failed:', err.message);
            } else {
              console.log('[BrowserControl] Chrome and Edge Native Server registered successfully');
            }
            resolveNative();
          });
        });

        // 5. Add Browser Control MCP server configuration (on first enable)
        if (this.currentUserAlias) {
          const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
          const pcManager = await getProfileCacheManager();
          const mcpServerName = 'kosmos-chrome-extension';
          const existingServer = pcManager.getMcpServerInfo(this.currentUserAlias, mcpServerName);
          
          if (!existingServer.config) {
            // Config does not exist: add config (no auto-connect, connection handled by launchBrowserWithSnap)
            const mcpConfig = {
              name: mcpServerName,
              transport: 'StreamableHttp' as const,
              command: '',
              args: [],
              env: {},
              url: 'http://127.0.0.1:12306/mcp',
              in_use: true,
              version: '1.0.0',
              source: 'ON-DEVICE' as const
            };
            
            // Only add config, do not connect (add auto-connects, so use pcManager to add directly here)
            await pcManager.addMcpServerConfig(this.currentUserAlias, mcpConfig);
            console.log('[BrowserControl] MCP server config added:', mcpServerName);
          }
        }

        // Note: HTTP server is stopped after MCP connection succeeds in launchBrowserWithSnap()
        // This ensures the browser has enough time to download extensions from the HTTP server

        // 6. Start browser and snap split-screen (reuse common method)
        await this.launchBrowserWithSnap();

        // 7. Start heartbeat monitoring (will automatically manage MCP connection)
        const { browserControlMonitor } = await import('./lib/browserControl/browserControlMonitor');
        browserControlMonitor.start(this.currentUserAlias!);

        sendPhaseChange('completed');
        return { success: true };
      } catch (error) {
        sendPhaseChange('error', error instanceof Error ? error.message : 'Unknown error');
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Browser Control uninstall
    ipcMain.handle('browserControl:disable', async () => {
      // 🔒 Feature Flag check: browserControl
      if (!isFeatureEnabled('browserControl')) {
        return { success: false, error: 'Browser Control feature is not enabled' };
      }
      
      try {
        // Currently only supports Windows platform
        if (process.platform !== 'win32') {
          return { success: false, error: 'Browser Control setup is only supported on Windows' };
        }

        const browserControlDir = path.join(app.getAppPath(), 'resources', 'browser-control');

        // 1. Unregister Native Server (unregister both Chrome and Edge, no admin privileges needed)
        const { exec } = require('child_process');
        
        // Use combined script to unregister both Chrome and Edge Native Server simultaneously
        const unregisterNativeServerAllScript = path.join(browserControlDir, COMBINED_SCRIPTS.unregisterNativeServerAll);
        console.log('[BrowserControl] Unregistering Chrome and Edge Native Server...');
        await new Promise<void>((resolveNative) => {
          exec(`powershell -ExecutionPolicy Bypass -File "${unregisterNativeServerAllScript}"`, (err: Error | null) => {
            if (err) {
              console.error('[BrowserControl] Native Server unregistration failed:', err.message);
            } else {
              console.log('[BrowserControl] Chrome and Edge Native Server unregistered successfully');
            }
            resolveNative();
          });
        });

        // 2. Prepare script commands to remove extension from registry (unregister both Chrome and Edge, admin privileges required)
        const sudo = require('sudo-prompt');
        const unregisterAllScript = path.join(browserControlDir, COMBINED_SCRIPTS.unregisterAll);
        const command = `powershell.exe -ExecutionPolicy Bypass -File "${unregisterAllScript}"`;
        const options = { name: 'Kosmos Browser Control Uninstall' };

        // 4. Execute commands and wait for completion
        return new Promise((resolve) => {
          // 4.1. Run unregistration script to unregister Browser Extension
          sudo.exec(command, options, async (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
              resolve({ success: false, error: error.message });
              return;
            }

            // 🆕 Stop Browser Control heartbeat monitoring and HTTP server
            const { browserControlMonitor } = await import('./lib/browserControl/browserControlMonitor');
            const { browserControlHttpServer } = await import('./lib/browserControl/browserControlHttpServer');
            await browserControlMonitor.stop();
            await browserControlHttpServer.stop();

            // 4.2. Delete MCP server config and disconnect
            if (this.currentUserAlias) {
              const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
              const mcpServerName = 'kosmos-chrome-extension';
              
              try {
                // Disconnect first
                await mcpClientManager.disconnect(mcpServerName);
                console.log('[BrowserControl] MCP server disconnected:', mcpServerName);
              } catch (disconnectError) {
                console.log('[BrowserControl] MCP server disconnect attempt:', disconnectError instanceof Error ? disconnectError.message : String(disconnectError));
              }

              try {
                // Delete config
                await mcpClientManager.delete(mcpServerName);
                console.log('[BrowserControl] MCP server config removed:', mcpServerName);
              } catch (removeError) {
                console.log('[BrowserControl] MCP server remove attempt:', removeError instanceof Error ? removeError.message : String(removeError));
              }
            }

            resolve({ success: true });
          });
        });
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Browser Control status query - only check static configuration (registry + MCP profile)
    // enabled only reflects whether user has configured Browser Control, not runtime connection status
    ipcMain.handle('browserControl:getStatus', async () => {
      // 🔒 Feature Flag check: browserControl
      if (!isFeatureEnabled('browserControl')) {
        return { success: true, data: { enabled: false } };
      }
      
      try {
        const mcpServerName = 'kosmos-chrome-extension';
        
        // Read user-selected browser type
        let selectedBrowser: 'chrome' | 'edge' = 'edge';
        if (this.currentUserAlias) {
          const pcManager = await getProfileCacheManager();
          const settings = pcManager.getBrowserControlSettings(this.currentUserAlias);
          selectedBrowser = settings.browser || 'edge';
        }
        const browserConfig = BROWSER_CONFIG[selectedBrowser];
        
        // 1. Check if Native Messaging Host config exists in registry
        const hostName = 'com.chromemcp.nativehost';
        const regPath = `HKCU\\${browserConfig.nativeHostRegPath}\\${hostName}`;
        
        const isRegistryConfigured = await new Promise<boolean>((resolve) => {
          const { exec } = require('child_process');
          // Check if registry key exists (no need to query specific value, key existence is sufficient)
          exec(`reg query "${regPath}"`, (error: Error | null, stdout: string) => {
            if (!error && stdout.includes(hostName)) {
              resolve(true);
            } else {
              resolve(false);
            }
          });
        });
        
        // 2. Check if config exists in MCP profile
        let isMcpConfigured = false;
        if (this.currentUserAlias) {
          const pcManager = await getProfileCacheManager();
          const existingServer = pcManager.getMcpServerInfo(this.currentUserAlias, mcpServerName);
          isMcpConfigured = !!existingServer.config;
        }
        
        // 3. If Chrome is selected, also check if Chrome is installed
        let isBrowserInstalled = true; // Edge is installed by default (built-in on Windows)
        if (selectedBrowser === 'chrome') {
          const { checkBrowserInstalled } = await import('./lib/browserControl/browserControlStatus');
          isBrowserInstalled = await checkBrowserInstalled('chrome');
        }
        
        // enabled = registry config exists AND MCP config exists AND browser is installed
        const isEnabled = isRegistryConfigured && isMcpConfigured && isBrowserInstalled;
        
        return {
          success: true,
          data: { enabled: isEnabled }
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Browser Control installation status query (for component recovery)
    ipcMain.handle('browserControl:getInstallStatus', async () => {
      // 🔒 Feature Flag check: browserControl
      if (!isFeatureEnabled('browserControl')) {
        return { success: true, data: { isInstalling: false, phase: 'idle', progress: 0, error: '' } };
      }
      
      return {
        success: true,
        data: { ...this.browserControlInstallState }
      };
    });

    // Browser Control browser installation confirmation response
    ipcMain.handle('browserControl:respondBrowserInstallConfirm', async (event, requestId: string, confirmed: boolean) => {
      const handlers = (global as any).__pendingBrowserInstallConfirm;
      if (handlers && handlers[requestId]) {
        handlers[requestId](confirmed);
        return { success: true };
      }
      return { success: false, error: 'No pending browser install confirmation request' };
    });

    // Browser Control Native Server download confirmation response
    ipcMain.handle('browserControl:respondNativeServerDownloadConfirm', async (event, requestId: string, confirmed: boolean) => {
      const handlers = (global as any).__pendingNativeServerDownloadConfirm;
      if (handlers && handlers[requestId]) {
        handlers[requestId](confirmed);
        return { success: true };
      }
      return { success: false, error: 'No pending native server download confirmation request' };
    });

    // Start browser and snap split-screen (for reopening browser after enable)
    ipcMain.handle('browserControl:launchWithSnap', async () => {
      // 🔒 Feature Flag check: browserControl
      if (!isFeatureEnabled('browserControl')) {
        return { success: false, error: 'Browser Control feature is not enabled' };
      }
      
      return this.launchBrowserWithSnap();
    });

    // Logger management
    ipcMain.handle('logger:manualFlush', async () => {
      try {
        if (advancedLogger && typeof advancedLogger.flushToDisk === 'function') {
          await advancedLogger.flushToDisk();
          return { success: true };
        } else {
          return { success: false, error: 'Advanced logger not available' };
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Folder opening handlers
    ipcMain.handle('folder:openLogs', async () => {
      try {
        const logDirectory = path.join(app.getPath('userData'), 'logs');
        // Ensure logs directory exists
        if (!fs.existsSync(logDirectory)) {
          fs.mkdirSync(logDirectory, { recursive: true });
        }
        await shell.openPath(logDirectory);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    ipcMain.handle('folder:openProfile', async (event, alias: string) => {
      try {
        if (!alias) {
          return { success: false, error: 'No user profile selected' };
        }
        const profileDirectory = path.join(app.getPath('userData'), 'profiles', alias);
        // Ensure profile directory exists
        if (!fs.existsSync(profileDirectory)) {
          fs.mkdirSync(profileDirectory, { recursive: true });
        }
        await shell.openPath(profileDirectory);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
    
    // Delete file or directory (supports recursive directory deletion)
    // Use shell.trashItem to move to trash, safer and handles permission issues
    ipcMain.handle('fs:deletePaths', async (event, paths: string[]) => {
      try {
        const results: { path: string; success: boolean; error?: string }[] = [];
        
        for (const targetPath of paths) {
          try {
            // Security check: ensure path exists
            if (!fs.existsSync(targetPath)) {
              results.push({ path: targetPath, success: false, error: 'Path does not exist' });
              continue;
            }
            
            // Use shell.trashItem to move to trash
            // This is safer (user can recover) and handles permission issues with system files like .DS_Store
            await shell.trashItem(targetPath);
            
            results.push({ path: targetPath, success: true });
          } catch (err) {
            // If trashItem fails, try using traditional deletion method
            try {
              const stats = fs.statSync(targetPath);
              
              if (stats.isDirectory()) {
                // Recursively delete directory
                fs.rmSync(targetPath, { recursive: true, force: true });
              } else {
                // Delete file
                fs.unlinkSync(targetPath);
              }
              
              results.push({ path: targetPath, success: true });
            } catch (fallbackErr) {
              results.push({
                path: targetPath,
                success: false,
                error: fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error'
              });
            }
          }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        return {
          success: failCount === 0,
          results,
          successCount,
          failCount
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // File system handlers for VSCode import
    ipcMain.handle('fs:exists', async (event, filePath: string) => {
      try {
        return fs.existsSync(filePath);
      } catch (error) {
        return false;
      }
    });
    
    ipcMain.handle('fs:access', async (event, filePath: string) => {
      try {
        // Check if file is readable
        fs.accessSync(filePath, fs.constants.R_OK);
        const readable = true;
        
        // Check if file is writable
        let writable = false;
        try {
          fs.accessSync(filePath, fs.constants.W_OK);
          writable = true;
        } catch {
          // File is not writable, but that's okay for reading
        }
        
        return { readable, writable };
      } catch (error) {
        return { readable: false, writable: false };
      }
    });
    
    ipcMain.handle('fs:readFile', async (event, filePath: string, encoding?: BufferEncoding | 'base64') => {
      try {
        const stats = fs.statSync(filePath);
        
        let content: string;
        if (encoding === 'base64') {
          // 🔥 Binary file: read as Buffer then convert to base64 string
          const buffer = fs.readFileSync(filePath);
          content = buffer.toString('base64');
        } else {
          // Text file: use specified encoding or default utf8
          content = fs.readFileSync(filePath, encoding || 'utf8');
        }
        
        return {
          success: true,
          content,
          size: stats.size,
          lastModified: stats.mtime.getTime()
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    ipcMain.handle('fs:writeFile', async (event, filePath: string, content: string, encoding?: BufferEncoding) => {
      try {
        // Ensure directory exists
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        
        // Write file
        fs.writeFileSync(filePath, content, encoding || 'utf8');
        
        return {
          success: true,
          filePath
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    ipcMain.handle('fs:stat', async (event, filePath: string) => {
      try {
        const stats = fs.statSync(filePath);
        
        return {
          success: true,
          stats: {
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            mtime: stats.mtime.getTime(),
            atime: stats.atime.getTime(),
            birthtime: stats.birthtime.getTime()
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    ipcMain.handle('fs:expandPath', async (event, filePath: string) => {
      try {
        // Expand environment variables and tilde
        let expandedPath = filePath;
        
        // Handle tilde expansion
        if (expandedPath.startsWith('~/')) {
          expandedPath = path.join(os.homedir(), expandedPath.slice(2));
        }
        
        // Handle Windows environment variables
        if (process.platform === 'win32') {
          expandedPath = expandedPath.replace(/%([^%]+)%/g, (match, envVar) => {
            return process.env[envVar] || match;
          });
        }
        
        // Handle Unix-style environment variables
        expandedPath = expandedPath.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (match, envVar) => {
          return process.env[envVar] || match;
        });
        
        return expandedPath;
      } catch (error) {
        return filePath; // Return original path if expansion fails
      }
    });
    
    ipcMain.handle('fs:selectFile', async (event, options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => {
      try {
        if (!this.mainWindow) {
          return {
            success: false,
            error: 'No main window available'
          };
        }
        
        const dialogOptions: Electron.OpenDialogOptions = {
          title: options?.title || 'Select File',
          properties: ['openFile'],
          filters: options?.filters || [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        };
        
        const result = await dialog.showOpenDialog(this.mainWindow, dialogOptions);
        
        // Handle the result properly - check if it's the old format or new format
        if (Array.isArray(result)) {
          // Old API format (just file paths array)
          if (result.length === 0) {
            return {
              success: false,
              error: 'File selection canceled'
            };
          }
          return {
            success: true,
            filePath: result[0]
          };
        } else {
          // New API format (object with canceled and filePaths)
          const dialogResult = result as any;
          if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
            return {
              success: false,
              error: 'File selection canceled'
            };
          }
          return {
            success: true,
            filePath: dialogResult.filePaths[0]
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // New: API implementation for getting complete file metadata
    ipcMain.handle('fs:getFileMetadata', async (event, filePath: string) => {
      try {
        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        const fileExtension = path.extname(filePath).toLowerCase().slice(1);
        
        // Detect MIME type
        const mimeTypeMap: { [key: string]: string } = {
          'txt': 'text/plain',
          'md': 'text/markdown',
          'js': 'text/javascript',
          'ts': 'text/typescript',
          'jsx': 'text/javascript',
          'tsx': 'text/typescript',
          'css': 'text/css',
          'html': 'text/html',
          'json': 'application/json',
          'xml': 'application/xml',
          'yaml': 'text/yaml',
          'yml': 'text/yaml',
          'py': 'text/x-python',
          'java': 'text/x-java',
          'c': 'text/x-c',
          'cpp': 'text/x-cpp',
          'cs': 'text/x-csharp',
          'go': 'text/x-go',
          'rs': 'text/x-rust'
        };
        
        const mimeType = mimeTypeMap[fileExtension] || 'text/plain';
        const isTextFile = Object.keys(mimeTypeMap).includes(fileExtension);
        
        // If text file, count line numbers
        let lineCount: number | undefined;
        if (isTextFile && stats.size < 50 * 1024 * 1024) { // Only process files smaller than 50MB
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            lineCount = content.split('\n').length;
          } catch {
            // If reading fails, do not set line count
          }
        }
        
        return {
          success: true,
          metadata: {
            fullPath: filePath,
            fileName: fileName,
            fileSize: stats.size,
            fileType: fileExtension,
            mimeType: mimeType,
            lineCount: lineCount,
            lastModified: stats.mtime.getTime(),
            isTextFile: isTextFile
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // New: download file from URL to local path
    ipcMain.handle('fs:downloadFile', async (event, url: string, destPath: string) => {
      try {
        // Ensure destination directory exists
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        
        // Download the file using fetch
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(destPath, buffer);
        
        console.log(`[fs:downloadFile] Downloaded ${url} to ${destPath}`);
        
        return {
          success: true,
          filePath: destPath,
          size: buffer.length
        };
      } catch (error) {
        console.error(`[fs:downloadFile] Failed to download ${url}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // New: API implementation for selecting multiple files
    ipcMain.handle('fs:selectFiles', async (event, options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      allowMultiple?: boolean;
    }) => {
      try {
        if (!this.mainWindow) {
          return {
            success: false,
            error: 'No main window available'
          };
        }
        
        const dialogOptions: Electron.OpenDialogOptions = {
          title: options?.title || 'Select Files',
          properties: options?.allowMultiple ? ['openFile', 'multiSelections'] : ['openFile'],
          // Do not set filters, show all file types by default
          // On Windows, if both '*' wildcard and specific extensions exist, the wildcard is skipped in favor of specific extensions
          filters: options?.filters
        };
        
        const result = await dialog.showOpenDialog(this.mainWindow, dialogOptions);
        
        // Handle the result properly - check if it's the old format or new format
        if (Array.isArray(result)) {
          // Old API format (just file paths array)
          if (result.length === 0) {
            return {
              success: false,
              error: 'File selection canceled'
            };
          }
          return {
            success: true,
            filePaths: result
          };
        } else {
          // New API format (object with canceled and filePaths)
          const dialogResult = result as any;
          if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
            return {
              success: false,
              error: 'File selection canceled'
            };
          }
          return {
            success: true,
            filePaths: dialogResult.filePaths
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // ===============================
    // Quick Start image cache IPC handlers
    // ===============================
    
    // Get or cache image (download and cache if not exists)
    ipcMain.handle('quickStartImageCache:getOrCache', async (event, agentName: string, imageUrl: string) => {
      try {
        const { quickStartImageCacheManager } = await import('./lib/cache/quickStartImageCacheManager');
        const result = await quickStartImageCacheManager.getOrCacheImage(agentName, imageUrl);
        return {
          success: true,
          cachedUrl: result // May be file:// URL or null
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          cachedUrl: null
        };
      }
    });
    
    // Clear image cache for specified Agent
    ipcMain.handle('quickStartImageCache:clearAgent', async (event, agentName: string) => {
      try {
        const { quickStartImageCacheManager } = await import('./lib/cache/quickStartImageCacheManager');
        quickStartImageCacheManager.clearAgentCache(agentName);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Clear all image cache
    ipcMain.handle('quickStartImageCache:clearAll', async () => {
      try {
        const { quickStartImageCacheManager } = await import('./lib/cache/quickStartImageCacheManager');
        quickStartImageCacheManager.clearAllCache();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // ===============================
    // Workspace related IPC handlers
    // ===============================
    
    // Select workspace folder
    ipcMain.handle('workspace:selectFolder', async () => {
      try {
        if (!this.mainWindow) {
          return {
            success: false,
            error: 'No main window available'
          };
        }
        
        const dialogOptions: Electron.OpenDialogOptions = {
          title: 'Select Workspace Folder',
          properties: ['openDirectory'],
          buttonLabel: 'Select Folder'
        };
        
        const result = await dialog.showOpenDialog(this.mainWindow, dialogOptions);
        
        // Handle the result properly
        if (Array.isArray(result)) {
          // Old API format (just file paths array)
          if (result.length === 0) {
            return {
              success: false,
              error: 'Folder selection canceled'
            };
          }
          return {
            success: true,
            folderPath: result[0]
          };
        } else {
          // New API format (object with canceled and filePaths)
          const dialogResult = result as any;
          if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
            return {
              success: false,
              error: 'Folder selection canceled'
            };
          }
          return {
            success: true,
            folderPath: dialogResult.filePaths[0]
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Get file tree structure - using high-performance ripgrep-based implementation
    ipcMain.handle('workspace:getFileTree', async (event, workspacePath: string, options?: {
      maxDepth?: number;
      ignorePatterns?: string[];
    }) => {
      try {
        // 🔥 Fix: normalize path separators to prevent startsWith validation failure caused by mixed slashes on Windows
        workspacePath = path.normalize(workspacePath);
        if (!workspacePath || !fs.existsSync(workspacePath)) {
          return {
            success: false,
            error: 'Invalid workspace path'
          };
        }
        
        
        // Use FileTreeService (ripgrep-based)
        const { getWorkspaceWatcher } = await import('./lib/workspace/WorkspaceWatcher');
        const watcher = getWorkspaceWatcher();
        
        // Convert ignorePatterns to excludePattern
        const excludePattern = options?.ignorePatterns?.join(',');
        
        const result = await watcher.getFileTree({
          folder: workspacePath,
          maxDepth: options?.maxDepth, // Do not set default value, allow undefined to pass through for unlimited depth
          excludePattern,
          includeHidden: true,
          useGitignore: true
        });
        
        // Convert to frontend-expected format (with path security validation and absolute path conversion)
        const convertNodeFormat = (node: any, workspacePath: string): any => {
          if (!node) return null;
          
          // 🔥 Critical fix: ensure all paths are absolute paths
          let safePath = node.path;
          
          // Detailed debug log
          
          // 🔥 Force convert to absolute path
          if (!path.isAbsolute(safePath)) {
            // Relative path: join to workspace
            safePath = path.join(workspacePath, safePath);
          }
          
          // Normalize path
          safePath = path.normalize(safePath);
          
          // 🔥 Strict validation: ensure path is within workspace
          if (!safePath.startsWith(workspacePath)) {
            return null;
          }
          
          const converted: any = {
            name: node.name,
            path: safePath,
            type: node.isDirectory ? 'directory' : 'file'
          };
          
          // Add size info to file nodes
          if (!node.isDirectory) {
            try {
              const stats = fs.statSync(safePath);
              converted.size = stats.size;
            } catch (err) {
              converted.size = 0;
            }
          }
          
          // Directory nodes need to include children property, even for empty directories
          if (node.isDirectory) {
            const validChildren = node.children && node.children.length > 0
              ? node.children.map((child: any) => convertNodeFormat(child, workspacePath)).filter(Boolean)
              : [];
            converted.children = validChildren;
            converted.isExpanded = false;
            
          }
          
          return converted;
        };
        
        const tree = result.root.children?.map((child: any) => convertNodeFormat(child, workspacePath)).filter(Boolean) || [];
        
        
        return {
          success: true,
          data: {
            workspacePath,
            workspaceName: path.basename(workspacePath),
            tree
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Clear file tree cache - for refresh functionality
    ipcMain.handle('workspace:clearFileTreeCache', async (event, workspacePath?: string) => {
      try {
        
        const { getWorkspaceWatcher } = await import('./lib/workspace/WorkspaceWatcher');
        const watcher = getWorkspaceWatcher();
        
        // Clear cache for specified path or all caches
        watcher.clearFileTreeCache(workspacePath);
        
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Get direct children of directory (lazy-load file tree) - returns single level only, no recursion
    ipcMain.handle('workspace:getDirectoryChildren', async (event, dirPath: string, options?: {
      ignorePatterns?: string[];
    }) => {
      try {
        dirPath = path.normalize(dirPath);
        if (!dirPath || !fs.existsSync(dirPath)) {
          return { success: false, error: 'Invalid directory path' };
        }

        const ignoreSet = new Set(options?.ignorePatterns || [
          'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.vscode', '.idea'
        ]);

        // Use fs.readdir directly to get immediate children - ripgrep --files only
        // returns files and misses directories that contain no files at depth 1.
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        const children: any[] = [];
        for (const entry of entries) {
          // Skip ignored patterns
          if (ignoreSet.has(entry.name)) continue;

          const childPath = path.join(dirPath, entry.name);
          const isDirectory = entry.isDirectory() || entry.isSymbolicLink() && (() => {
            try { return fs.statSync(childPath).isDirectory(); } catch { return false; }
          })();

          const item: any = {
            name: entry.name,
            path: childPath,
            type: isDirectory ? 'directory' : 'file',
          };

          if (!isDirectory) {
            try { item.size = fs.statSync(childPath).size; } catch { item.size = 0; }
          }

          children.push(item);
        }

        // Sort: directories first, then files, both alphabetically
        children.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        return { success: true, data: { dirPath, children } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Watch workspace file changes - using real file system monitoring
    ipcMain.handle('workspace:startWatch', async (event, workspacePath: string, options?: {
      excludes?: string[];
      includes?: string[];
    }) => {
      try {

        const { getWorkspaceWatcher } = await import('./lib/workspace/WorkspaceWatcher');
        const watcher = getWorkspaceWatcher();

        // Set up event listeners (if not already set up)
        if (!watcher.listenerCount('fileChanged')) {
          watcher.on('fileChanged', (changes) => {
            // Send file change event to renderer process (check if webContents is still valid)
            try {
              if (!event.sender.isDestroyed()) {
                event.sender.send('workspace:fileChanged', changes);
              }
            } catch (error) {
              // Ignore send failure errors (window may have been closed)
            }
          });

          watcher.on('watchError', (error) => {
            // Send error event to renderer process (check if webContents is still valid)
            try {
              if (!event.sender.isDestroyed()) {
                event.sender.send('workspace:watchError', error);
              }
            } catch (err) {
              // Ignore send failure errors (window may have been closed)
            }
          });
        }

        // Start file monitoring
        await watcher.startFileWatch(workspacePath, options);

        return { success: true };

      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Stop monitoring workspace
    ipcMain.handle('workspace:stopWatch', async () => {
      try {

        const { getWorkspaceWatcher } = await import('./lib/workspace/WorkspaceWatcher');
        const watcher = getWorkspaceWatcher();

        await watcher.stopFileWatch();

        return { success: true };

      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Get file watch statistics
    ipcMain.handle('workspace:getWatcherStats', async () => {
      try {
        const { getWorkspaceWatcher } = await import('./lib/workspace/WorkspaceWatcher');
        const watcher = getWorkspaceWatcher();

        const stats = watcher.getWatcherStats();
        
        return {
          success: true,
          data: stats
        };

      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Search workspace files
    ipcMain.handle('workspace:searchFiles', async (event, query: {
      folder?: string;
      pattern?: string;
      maxResults?: number;
      fuzzy?: boolean;
      searchTarget?: 'files' | 'folders' | 'both';
    }) => {
      try {
        
        // Validate folder parameter
        if (!query.folder) {
          const errorMsg = 'Workspace folder path is required for file search. Please provide a valid workspace path.';
          return {
            success: false,
            error: errorMsg
          };
        }
        
        const { getWorkspaceWatcher } = await import('./lib/workspace/WorkspaceWatcher');
        const watcher = getWorkspaceWatcher();
        
        // Call search service
        const result = await watcher.searchFiles(query as any);
        
        
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Copy file or directory to target path
    ipcMain.handle('workspace:copyPath', async (event, sourcePath: string, destPath: string) => {
      try {
        
        // Validate source path exists
        if (!fs.existsSync(sourcePath)) {
          return {
            success: false,
            error: 'Source path does not exist'
          };
        }
        
        // Get source path info
        const sourceStats = fs.statSync(sourcePath);
        const sourceName = path.basename(sourcePath);
        const targetPath = path.join(destPath, sourceName);
        
        // Check if target path already exists
        if (fs.existsSync(targetPath)) {
          return {
            success: false,
            error: `Target path already exists: ${sourceName}`
          };
        }
        
        // Recursive copy function
        const copyRecursive = (src: string, dest: string) => {
          const stats = fs.statSync(src);
          
          if (stats.isDirectory()) {
            // Create directory
            fs.mkdirSync(dest, { recursive: true });
            
            // Read directory contentand recursively copy
            const entries = fs.readdirSync(src);
            for (const entry of entries) {
              const srcPath = path.join(src, entry);
              const destPath = path.join(dest, entry);
              copyRecursive(srcPath, destPath);
            }
          } else {
            // Copy file
            fs.copyFileSync(src, dest);
          }
        };
        
        // Perform copy
        copyRecursive(sourcePath, targetPath);
        
        
        return {
          success: true,
          data: {
            sourcePath,
            targetPath,
            isDirectory: sourceStats.isDirectory()
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Move file or directory to target path
    ipcMain.handle('workspace:movePath', async (event, sourcePath: string, destPath: string, options?: { force?: boolean }) => {
      try {
        // Validate source path exists
        if (!fs.existsSync(sourcePath)) {
          return {
            success: false,
            error: 'Source path does not exist'
          };
        }

        // Ensure target directory exists
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }

        const sourceName = path.basename(sourcePath);
        const targetPath = path.join(destPath, sourceName);

        // Check if target path already exists
        if (fs.existsSync(targetPath)) {
          if (!options?.force) {
            return {
              success: false,
              error: 'TARGET_EXISTS',
              data: { targetPath, sourceName }
            };
          }
          // force mode: delete existing target first
          fs.rmSync(targetPath, { recursive: true, force: true });
        }

        // Try rename (efficient on same file system), fall back to copy + delete on failure
        try {
          fs.renameSync(sourcePath, targetPath);
        } catch (renameError) {
          // rename fails across file systems, use copy + delete
          const sourceStats = fs.statSync(sourcePath);
          if (sourceStats.isDirectory()) {
            const copyRecursive = (src: string, dest: string) => {
              fs.mkdirSync(dest, { recursive: true });
              const entries = fs.readdirSync(src);
              for (const entry of entries) {
                const srcPath = path.join(src, entry);
                const dstPath = path.join(dest, entry);
                if (fs.statSync(srcPath).isDirectory()) {
                  copyRecursive(srcPath, dstPath);
                } else {
                  fs.copyFileSync(srcPath, dstPath);
                }
              }
            };
            copyRecursive(sourcePath, targetPath);
            fs.rmSync(sourcePath, { recursive: true, force: true });
          } else {
            fs.copyFileSync(sourcePath, targetPath);
            fs.unlinkSync(sourcePath);
          }
        }

        return {
          success: true,
          data: {
            sourcePath,
            targetPath,
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Open file or directory (using system default program)
    ipcMain.handle('workspace:openPath', async (event, targetPath: string) => {
      try {
        
        // Validate path exists
        if (!fs.existsSync(targetPath)) {
          return {
            success: false,
            error: 'Path does not exist'
          };
        }
        
        // Use shell.openPath to open file or directory
        const result = await shell.openPath(targetPath);
        
        if (result) {
          // If non-empty string is returned, it indicates an error
          return {
            success: false,
            error: result
          };
        }
        
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Show file or directory in file manager
    ipcMain.handle('workspace:showInFolder', async (event, targetPath: string) => {
      try {
        
        // Validate path exists
        if (!fs.existsSync(targetPath)) {
          return {
            success: false,
            error: 'Path does not exist'
          };
        }
        
        // Use shell.showItemInFolder to show in file manager
        shell.showItemInFolder(targetPath);
        
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Get default Workspace path
    ipcMain.handle('workspace:getDefaultWorkspacePath', async (event, alias: string, chatId: string) => {
      try {
        
        if (!alias || !chatId) {
          return {
            success: false,
            error: 'Both alias and chatId are required'
          };
        }
        
        const { getDefaultWorkspacePath } = await import('./lib/userDataADO/pathUtils');
        const defaultPath = getDefaultWorkspacePath(alias, chatId);
        
        return {
          success: true,
          data: defaultPath
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    // Debug window handlers
    ipcMain.handle('debug:openWindow', async () => {
      try {
        await this.createDebugWindow();
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ===============================
    // LLM related IPC handlers
    // ===============================
    
    // System Prompt optimization
    ipcMain.handle('llm:improveSystemPrompt', async (event, userInputPrompt: string) => {
      try {
        const { SystemPromptLlmWriter } = await import('./lib/llm/systemPromptLlmWritter');
        const result = await SystemPromptLlmWriter.improveSystemPrompt(userInputPrompt);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // MCP config formatting
    ipcMain.handle('llm:formatMcpConfig', async (event, userInputMcpConfig: string) => {
      try {
        const { McpConfigLlmFormatter } = await import('./lib/llm/mcpConfigLlmFormatter');
        const result = await McpConfigLlmFormatter.formatMcpConfig(userInputMcpConfig);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Chat session title generation
    ipcMain.handle('llm:generateChatTitle', async (event, userMessage: string) => {
      try {
        const { ChatSessionTitleLlmSummarizer } = await import('./lib/llm/chatSessionTitleLlmSummarizer');
        const result = await ChatSessionTitleLlmSummarizer.generateTitle(userMessage);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Filename generation (auto-generate filename and extension based on content)
    ipcMain.handle('llm:generateFileName', async (event, content: string) => {
      try {
        const { FileNameLlmGenerator } = await import('./lib/llm/fileNameLlmGenerator');
        const result = await FileNameLlmGenerator.generateFileName(content);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Document summary generation (generate LLM summary from extracted document text content)
    ipcMain.handle('llm:generateDocumentSummary', async (event, fileName: string, content: string, truncated: boolean = false) => {
      const logger = getAdvancedLogger();
      const startTime = Date.now();
      logger.info(`[DocSummary] 📥 IPC request — fileName="${fileName}", contentLength=${content?.length ?? 0}, truncated=${truncated}`, 'llm:generateDocumentSummary');
      try {
        const { DocumentSummaryLlmGenerator } = await import('./lib/llm/documentSummaryLlmGenerator');
        const result = await DocumentSummaryLlmGenerator.generateSummary(fileName, content, truncated);
        const durationMs = Date.now() - startTime;
        if (result.success) {
          logger.info(`[DocSummary] ✅ IPC success — fileName="${fileName}", summaryLength=${result.summary?.length ?? 0}, summary="${(result.summary || '').substring(0, 120)}${(result.summary?.length ?? 0) > 120 ? '...' : ''}", duration=${durationMs}ms`, 'llm:generateDocumentSummary');
        } else {
          logger.warn(`[DocSummary] ⚠️ IPC generation failed — fileName="${fileName}", warnings=${JSON.stringify(result.warnings)}, errors=${JSON.stringify(result.errors)}, duration=${durationMs}ms`, 'llm:generateDocumentSummary');
        }
        return { success: true, data: result };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[DocSummary] ❌ IPC error — fileName="${fileName}", error="${errorMsg}", duration=${durationMs}ms`, 'llm:generateDocumentSummary');
        return { success: false, error: errorMsg };
      }
    });

    // Text embedding
    ipcMain.handle('llm:embedText', async (event, text: string) => {
      try {
        const { textLlmEmbedder } = await import('./lib/llm/textLlmEmbedder');
        const result = await textLlmEmbedder.embed(text);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Batch text embedding
    ipcMain.handle('llm:embedBatch', async (event, texts: string[]) => {
      try {
        const { textLlmEmbedder } = await import('./lib/llm/textLlmEmbedder');
        const result = await textLlmEmbedder.embedBatch(texts);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Azure OpenAI API call (direct call)
    ipcMain.handle('llm:callAzureOpenAI', async (event, userPrompt: string, systemPrompt?: string, maxTokens?: number, temperature?: number) => {
      try {
        const { azureOpenAIModelApi } = await import('./lib/llm/AzureOpenAIModelApi');
        const result = await azureOpenAIModelApi.callGPT41(userPrompt, systemPrompt, maxTokens, temperature);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ===============================
    // Models related IPC handlers (GitHub Copilot Models)
    // ===============================
    
    // Get all GitHub Copilot models
    ipcMain.handle('models:getAllModels', async () => {
      try {
        const { getAllModels } = await import('./lib/llm/ghcModels');
        const models = getAllModels();
        return { success: true, data: models };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get list of models used by Kosmos
    ipcMain.handle('models:getAllKosmosUsedModels', async () => {
      try {
        const { getAllKosmosUsedModels } = await import('./lib/llm/ghcModels');
        const models = getAllKosmosUsedModels();
        return { success: true, data: models };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get single model by ID
    ipcMain.handle('models:getModelById', async (event, modelId: string) => {
      try {
        const { getModelById } = await import('./lib/llm/ghcModels');
        const model = getModelById(modelId);
        return { success: true, data: model };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get model capability info
    ipcMain.handle('models:getModelCapabilities', async (event, modelId: string) => {
      try {
        const { getModelCapabilities } = await import('./lib/llm/ghcModels');
        const capabilities = getModelCapabilities(modelId);
        return { success: true, data: capabilities };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Validate whether model ID is valid
    ipcMain.handle('models:validateModelId', async (event, modelId: string) => {
      try {
        const { validateModelId } = await import('./lib/llm/ghcModels');
        const isValid = validateModelId(modelId);
        return { success: true, data: isValid };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get default model ID
    ipcMain.handle('models:getDefaultModel', async () => {
      try {
        const { getDefaultModel } = await import('./lib/llm/ghcModels');
        const defaultModel = getDefaultModel();
        return { success: true, data: defaultModel };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Determine if it is a reasoning model
    ipcMain.handle('models:isReasoningModel', async (event, modelId: string) => {
      try {
        const { isReasoningModel } = await import('./lib/llm/ghcModels');
        const isReasoning = isReasoningModel(modelId);
        return { success: true, data: isReasoning };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });


    // ===============================
    // Feature Flags related IPC handlers (read-only)
    // ===============================

    // Get values of all feature flags
    ipcMain.handle('featureFlags:getAllFlags', async () => {
      try {
        const { featureFlagManager } = await import('./lib/featureFlags');
        const flags = featureFlagManager.getAllFlagsValues();
        return { success: true, data: flags };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Check if a single feature flag is enabled
    ipcMain.handle('featureFlags:isEnabled', async (event, flagName: string) => {
      try {
        const { featureFlagManager } = await import('./lib/featureFlags');
        const isEnabled = featureFlagManager.isEnabled(flagName as any);
        return { success: true, data: isEnabled };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });


    // ===============================
    // Whisper speech recognition related IPC handlers
    // ===============================

    // Get all Whisper model statuses
    ipcMain.handle('whisper:getAllModelStatus', async () => {
      try {
        const { whisperModelManager } = await import('./lib/whisper');
        const statuses = whisperModelManager.getAllModelStatus();
        return { success: true, data: statuses };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get single model status
    ipcMain.handle('whisper:getModelStatus', async (event, size: string) => {
      try {
        const { whisperModelManager } = await import('./lib/whisper');
        const status = whisperModelManager.getModelStatus(size as any);
        return { success: true, data: status };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get all model info
    ipcMain.handle('whisper:getAllModelInfo', async () => {
      try {
        const { whisperModelManager } = await import('./lib/whisper');
        const info = whisperModelManager.getAllModelInfo();
        return { success: true, data: info };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Download model
    ipcMain.handle('whisper:downloadModel', async (event, size: string) => {
      try {
        const { whisperModelManager } = await import('./lib/whisper');

        // Find the window that initiated the request
        const win = BrowserWindow.fromWebContents(event.sender);

        await whisperModelManager.downloadModel(
          size as any,
          undefined, // onProgress callback (we use IPC events instead)
          win || undefined
        );

        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Cancel model download
    ipcMain.handle('whisper:cancelDownload', async (event, size: string) => {
      try {
        const { whisperModelManager } = await import('./lib/whisper');
        const cancelled = whisperModelManager.cancelDownload(size as any);
        return { success: true, data: cancelled };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Delete model
    ipcMain.handle('whisper:deleteModel', async (event, size: string) => {
      try {
        const { whisperModelManager } = await import('./lib/whisper');
        const deleted = whisperModelManager.deleteModel(size as any);
        return { success: true, data: deleted };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get model path
    ipcMain.handle('whisper:getModelPath', async (event, size: string) => {
      try {
        const { whisperModelManager } = await import('./lib/whisper');
        const modelPath = whisperModelManager.getModelPath(size as any);
        return { success: true, data: modelPath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Check if there are active downloads
    ipcMain.handle('whisper:isDownloading', async () => {
      try {
        const { whisperModelManager } = await import('./lib/whisper');
        const isDownloading = whisperModelManager.isDownloading();
        const activeDownloads = whisperModelManager.getActiveDownloads();
        return { success: true, data: { isDownloading, activeDownloads } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Whisper transcription
    ipcMain.handle('whisper:transcribe', async (event, data: { pcmData: number[]; modelSize: string; options?: any }) => {
      try {
        const { transcribePCM } = await import('./lib/whisper');

        // Convert the number array back to Float32Array
        const pcmFloat32 = new Float32Array(data.pcmData);

        const result = await transcribePCM(
          pcmFloat32,
          data.modelSize as any,
          {
            language: data.options?.language,
            useGPU: data.options?.useGPU ?? false,
            enableVAD: data.options?.enableVAD ?? false,
            threads: data.options?.threads ?? 4,
            translate: data.options?.translate ?? false,
          }
        );

        return { success: true, data: result };
      } catch (error) {
        console.error('[Main] Whisper transcription error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Check if Whisper is available
    ipcMain.handle('whisper:isAvailable', async () => {
      try {
        const { isWhisperAvailable } = await import('./lib/whisper');
        const available = await isWhisperAvailable();
        return { success: true, data: available };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // ===============================
    // Streaming Whisper Transcription
    // ===============================

    // Start a streaming transcription session
    ipcMain.handle('whisper:startStreaming', async (event, data: {
      modelSize: string;
      options?: {
        language?: string;
        useGPU?: boolean;
        threads?: number;
        translate?: boolean;
        vadThreshold?: number;
        silenceDuration?: number;
        minSpeechDuration?: number;
      };
    }) => {
      try {
        const { startStreamingSession } = await import('./lib/whisper');
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const sessionId = await startStreamingSession(
          data.modelSize as any,
          data.options || {},
          browserWindow
        );
        return { success: true, data: { sessionId } };
      } catch (error) {
        console.error('[Main] Failed to start streaming session:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Process an audio chunk for streaming transcription
    ipcMain.handle('whisper:processChunk', async (event, data: {
      sessionId: string;
      pcmData: number[];
    }) => {
      try {
        const { processAudioChunk } = await import('./lib/whisper');
        const pcmFloat32 = new Float32Array(data.pcmData);
        await processAudioChunk(data.sessionId, pcmFloat32);
        return { success: true };
      } catch (error) {
        console.error('[Main] Failed to process audio chunk:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Stop streaming session and get final transcription
    ipcMain.handle('whisper:stopStreaming', async (event, sessionId: string) => {
      try {
        const { stopStreamingSession } = await import('./lib/whisper');
        await stopStreamingSession(sessionId);
        return { success: true };
      } catch (error) {
        console.error('[Main] Failed to stop streaming session:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Cancel streaming session without final transcription
    ipcMain.handle('whisper:cancelStreaming', async (event, sessionId: string) => {
      try {
        const { cancelStreamingSession } = await import('./lib/whisper');
        cancelStreamingSession(sessionId);
        return { success: true };
      } catch (error) {
        console.error('[Main] Failed to cancel streaming session:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Check if a streaming session is active
    ipcMain.handle('whisper:isStreamingActive', async (event, sessionId: string) => {
      try {
        const { isSessionActive } = await import('./lib/whisper');
        const active = isSessionActive(sessionId);
        return { success: true, data: active };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get/update Voice Input settings — data source: AppConfig.voiceInput (app.json, global config)
    ipcMain.handle('voiceInput:getSettings', async () => {
      try {
        const manager = await getAppCacheManager();
        const vc = manager.getConfig().voiceInput;
        // Map AppConfig.voiceInput → legacy VoiceInputSettings shape for UI backward compat
        return {
          success: true,
          data: {
            whisperModel: vc?.whisperModelSelected || 'base',
            language: vc?.recognitionLanguage || 'auto',
            useGPU: vc?.gpuAcceleration ?? false,
            translate: false,
          },
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('voiceInput:updateSettings', async (event, settings: any) => {
      try {
        const manager = await getAppCacheManager();
        await manager.updateConfig({
          voiceInput: {
            ...(settings.whisperModel !== undefined && { whisperModelSelected: settings.whisperModel }),
            ...(settings.language !== undefined && { recognitionLanguage: settings.language }),
            ...(settings.useGPU !== undefined && { gpuAcceleration: settings.useGPU }),
          },
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });


    // ====================================================
    // NativeModule on-demand download IPC handlers
    // Manage downloads of large native modules such as whisper-node-addon
    // ====================================================

    // Get module status
    ipcMain.handle('native-module:getStatus', async (_, moduleKey: string) => {
      try {
        const { nativeModuleManager } = await import('./lib/nativeModules');
        const info = nativeModuleManager.getStatus(moduleKey);
        return { success: true, data: info };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Trigger download (async, progress pushed via IPC)
    ipcMain.handle('native-module:ensureDownloaded', async (_, moduleKey: string) => {
      try {
        const { nativeModuleManager } = await import('./lib/nativeModules');
        const localPath = await nativeModuleManager.ensureDownloaded(moduleKey);
        return { success: true, data: { localPath } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Cancel download
    ipcMain.handle('native-module:cancelDownload', async (_, moduleKey: string) => {
      try {
        const { nativeModuleManager } = await import('./lib/nativeModules');
        nativeModuleManager.cancelDownload(moduleKey);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Delete downloaded module (free disk space)
    ipcMain.handle('native-module:delete', async (_, moduleKey: string) => {
      try {
        const { nativeModuleManager } = await import('./lib/nativeModules');
        nativeModuleManager.deleteModule(moduleKey);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });


    // ===============================
    // mem0 memory system related IPC handlers
    // ===============================
    
    // Search memories
    ipcMain.handle('mem0:searchMemories', async (event, query: string, options?: {limit?: number}) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user session' };
        }
        
        const { getKosmosMemory } = await import('./lib/mem0/kosmos-adapters');
        const memory = await getKosmosMemory(this.currentUserAlias);
        const results = await memory.search(query, {
          limit: options?.limit || 5,
          userId: this.currentUserAlias
        });
        
        return { success: true, data: results?.results || [] };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Add memory
    ipcMain.handle('mem0:addMemory', async (event, content: string, metadata?: any) => {
      const ipcStartTime = Date.now();
      try {
        
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user session' };
        }
        
        const { getKosmosMemory } = await import('./lib/mem0/kosmos-adapters');
        
        const memory = await getKosmosMemory(this.currentUserAlias);
        
        
        const addStartTime = Date.now();
        const result = await memory.add(content, {
          userId: this.currentUserAlias,
          ...metadata
        });
        const addDuration = Date.now() - addStartTime;
        
        
        const ipcDuration = Date.now() - ipcStartTime;
        
        
        return { success: true, data: result };
      } catch (error) {
        const ipcDuration = Date.now() - ipcStartTime;
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Delete memory
    ipcMain.handle('mem0:deleteMemory', async (event, memoryId: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user session' };
        }
        
        const { getKosmosMemory } = await import('./lib/mem0/kosmos-adapters');
        const memory = await getKosmosMemory(this.currentUserAlias);
        await memory.delete(memoryId);
        
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Update memory
    ipcMain.handle('mem0:updateMemory', async (event, memoryId: string, content: string, metadata?: any) => {
      try {
       if (!this.currentUserAlias) {
          return { success: false, error: 'No current user session' };
        }
        
        const { getKosmosMemory } = await import('./lib/mem0/kosmos-adapters');
        const memory = await getKosmosMemory(this.currentUserAlias);
        const result = await memory.update(memoryId, {
          userId: this.currentUserAlias,
          ...metadata
        });
        
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get all memories
    ipcMain.handle('mem0:getAllMemories', async (event, options?: {limit?: number}) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user session' };
        }
        
        const { getKosmosMemory } = await import('./lib/mem0/kosmos-adapters');
        const memory = await getKosmosMemory(this.currentUserAlias);
        const results = await memory.getAll({
          limit: options?.limit || 50,
          userId: this.currentUserAlias
        });
        
        return { success: true, data: results?.results || [] };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get memory history
    ipcMain.handle('mem0:getMemoryHistory', async (event, memoryId: string) => {
      try {
        if (!this.currentUserAlias) {
          return { success: false, error: 'No current user session' };
        }
        
        const { getKosmosMemory } = await import('./lib/mem0/kosmos-adapters');
        const memory = await getKosmosMemory(this.currentUserAlias);
        const results = await memory.history(memoryId);
        
        return { success: true, data: results || [] };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
  }

  /**
   * Check if app is fully ready, if so, notify renderer process
   */
  private checkAppReadiness() {
    if (this.isAgentChatReady) {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        safeConsole.log('[Startup] App fully ready (AgentChat), notifying renderer');
        this.mainWindow.webContents.send('app:ready', true);
      }
    }
  }

  private async onReady(): Promise<void> {
    console.time('[Startup] onReady');
    try {
      // 🚀 Highest priority: warm up AppCacheManager (read app.json / migrate runtimeConfig.json)
      // fire-and-forget, fully parallel with all subsequent tasks, ensuring initialization before profile.json
      getAppCacheManager().catch((e) => {
        safeConsole.warn('[Startup] AppCacheManager pre-warm failed:', e);
      });

      console.time('[Startup] createMainWindow');
      // 🚀 Optimization: start window creation task immediately
      const windowCreationTask = this.createMainWindow();

      // Wait for window creation to complete (subsequent logic depends on this.mainWindow)
      await windowCreationTask;
      console.timeEnd('[Startup] createMainWindow');
      
      // Register menus and shortcuts (catch errors to prevent blocking subsequent flow)
      try {
        if (process.platform !== 'win32') {
          this.setupMenu();
        } else {
          Menu.setApplicationMenu(null);
        }
        
      } catch (e) {
        safeConsole.error('[Startup] Menu/Shortcuts initialization failed:', e);
        createLogger().error('[Startup] Menu/Shortcuts initialization failed', 'main', { error: e });
      }

      console.timeEnd('[Startup] onReady');
    } catch (error) {
      console.timeEnd('[Startup] onReady');
      safeConsole.error('[Startup] Critical error in onReady:', error);
      createLogger().error('[Startup] Critical error in onReady', 'main', { error });
    }
  }

  private onWindowAllClosed(): void {
    safeConsole.log('[APP-EXIT] All windows closed');
    
    // macOS standard behavior: close window but do not quit app
    if (process.platform !== 'darwin') {
      // On non-macOS systems, quit app when all windows are closed
      app.quit();
    }
    // On macOS, do not call app.quit(), keep app running in Dock
  }

  private async onActivate(): Promise<void> {
    // macOS standard behavior: reopen window when Dock icon is clicked
    if (this.mainWindow === null || this.mainWindow.isDestroyed()) {
      // Main window destroyed, recreate
      await this.createMainWindow();
    } else if (!this.mainWindow.isVisible()) {
      // Main window exists but hidden, show and focus
      this.mainWindow.show();
      this.mainWindow.focus();
    } else if (this.mainWindow.isMinimized()) {
      // Main window minimized, restore and focus
      this.mainWindow.restore();
      this.mainWindow.focus();
    } else {
      // Main window visible, focus only
      this.mainWindow.focus();
    }
  }

  private async onBeforeQuit(event: Electron.Event): Promise<void> {
    exitSafeLog('App before quit event triggered');
    
    // Prevent immediate quit to allow cleanup
    event.preventDefault();
    
    const exitStart = Date.now();
    const exitId = `exit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    try {
      // Add final exit log before cleanup
      if (advancedLogger) {
        advancedLogger.info(`[${exitId}] Application exiting - starting cleanup sequence...`);
        exitSafeLog('Added final exit log');
      }

      // Phase 0: (Analytics removed for open-source)

      // Phase 1: Clean up mem0 and LibSQL resources
      exitSafeLog('Phase 1: Cleaning up mem0 and LibSQL resources');
      try {
        const { resetKosmosMemory } = await import('./lib/mem0/kosmos-adapters');
        
        // Set timeout for mem0 cleanup to prevent hanging
        await Promise.race([
          resetKosmosMemory(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Mem0 cleanup timeout')), 10000) // 10 second timeout
          )
        ]);
        
        exitSafeLog('Mem0 and Better-SQLite3 and sqlite-vec resource cleanup completed successfully');
      } catch (mem0Error) {
        const errorMessage = mem0Error instanceof Error ? mem0Error.message : String(mem0Error);
        safeConsole.warn(`Mem0 cleanup failed or timed out: ${errorMessage}`);
      }

      // Phase 2: Clean up MCP clients and child processes
      exitSafeLog('Phase 2: Cleaning up MCP clients and child processes');
      try {
        const { mcpClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
        
        // Set timeout for MCP cleanup to prevent hanging
        await Promise.race([
          mcpClientManager.cleanup(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('MCP cleanup timeout')), 20000) // 20 second timeout
          )
        ]);
        
        exitSafeLog('MCP cleanup completed successfully');
      } catch (mcpError) {
        const errorMessage = mcpError instanceof Error ? mcpError.message : String(mcpError);
        safeConsole.warn(`MCP cleanup failed or timed out: ${errorMessage}`);
        
        // If MCP cleanup timed out, try force cleanup
        if (errorMessage.includes('timeout')) {
          exitSafeLog('Attempting force cleanup of remaining child processes');
          await this.forceCleanupChildProcesses(exitId);
        }
      }

      // Clean up global shortcuts
      exitSafeLog('Phase 3: Cleaning up global shortcuts');
      this.unregisterGlobalShortcuts();


      // Phase 4: Handle logger exit to flush all logs
      exitSafeLog('Phase 4: Flushing logs');
      if (advancedLogger && typeof advancedLogger.handleAppExit === 'function') {
        exitSafeLog('Starting logger flush...');
        
        // Set timeout for logger flush
        await Promise.race([
          advancedLogger.handleAppExit(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Logger flush timeout')), 10000) // 10 second timeout
          )
        ]);
        
        exitSafeLog('Logger flush completed, proceeding with quit');
      }
      
      // Phase 4: Final cleanup summary
      const exitDuration = Date.now() - exitStart;
      exitSafeLog(`Cleanup sequence completed in ${exitDuration}ms, now exiting`);
      
      // Now allow the app to quit
      app.exit(0);
    } catch (error) {
      const exitDuration = Date.now() - exitStart;
      safeConsole.error(`Error during app exit (${exitDuration}ms):`, error);
      
      // Force quit even if cleanup fails
      exitSafeLog('Force quitting due to cleanup errors');
      app.exit(1);
    }
  }

  /**
   * Force cleanup of remaining child processes when normal cleanup fails
   */
  private async forceCleanupChildProcesses(exitId: string): Promise<void> {
    try {
      exitSafeLog(`[${exitId}] Starting force cleanup of child processes`);
      
      // Only attempt this on macOS/Linux where we have better process management
      if (process.platform !== 'win32') {
        const { execSync } = require('child_process');
        const appPid = process.pid;
        
        try {
          // Find and terminate any remaining child processes
          const psCommand = `ps -eo pid,ppid,comm | grep -E "(npm|uvx|python|pip|uv|node)" | grep -v grep`;
          const psResult = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });
          
          if (psResult.trim()) {
            exitSafeLog(`[${exitId}] Found remaining processes:`, psResult);
            
            const lines = psResult.trim().split('\n');
            for (const line of lines) {
              const [pid, ppid, comm] = line.trim().split(/\s+/);
              
              // Kill direct children of our app
              if (ppid && parseInt(ppid) === appPid) {
                try {
                  process.kill(parseInt(pid), 'SIGKILL');
                  exitSafeLog(`[${exitId}] Force killed child process: ${comm} (PID: ${pid})`);
                } catch (killError) {
                  safeConsole.warn(`[${exitId}] Failed to kill process ${pid}:`, killError);
                }
              }
            }
          } else {
            exitSafeLog(`[${exitId}] No remaining child processes found`);
          }
        } catch (psError) {
          safeConsole.warn(`[${exitId}] Process search failed:`, psError);
        }
      } else {
        exitSafeLog(`[${exitId}] Force cleanup not implemented for Windows`);
      }
    } catch (error) {
      safeConsole.error(`[${exitId}] Force cleanup failed:`, error);
    }
  }

  private async createMainWindow(): Promise<void> {
    
    // Create the browser window
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 1008,
      minHeight: 702,
      show: false, // Start hidden and show when ready
      titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default', // Hide title bar on Windows
      titleBarOverlay: undefined,
      // frame: defaults to true, no need to set explicitly
      icon: app.isPackaged 
        ? path.join(process.resourcesPath, 'brand-assets/win/app.ico')
        : path.join(__dirname, `../../brands/${process.env.BRAND_NAME}/assets/win/app.ico`),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: false,
        allowRunningInsecureContent: true,
        experimentalFeatures: false,
        sandbox: false,
        enableBlinkFeatures: '',
        disableBlinkFeatures: '',
        // Add sandbox-related security configuration
        spellcheck: false,
        webgl: false,
        plugins: false,
      },
    });

    // Listen for window state changes
    this.mainWindow.on('maximize', () => {
      this.mainWindow?.webContents.send('window:stateChanged', 'maximized');
    });
    this.mainWindow.on('unmaximize', () => {
      this.mainWindow?.webContents.send('window:stateChanged', 'normal');
    });

    // Set up window event handlers first
    this.mainWindow.once('ready-to-show', async () => {
      console.timeEnd('[Startup] Total main.ts load');
      console.log('[Startup] 🎉 Window ready-to-show event fired!');
      
      if (this.mainWindow) {
        // 🚀 Optimization: show window immediately, move heavy initialization to background
        this.mainWindow.show();
        console.log('[Startup] 🎉 Window shown!');

        // 🚀 Optimization: defer setting auth module main window reference
        setImmediate(async () => {
          try {
            const authManager = await getMainAuthManager();
            const tokenMonitor = await getMainTokenMonitor();
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              authManager.setMainWindow(this.mainWindow);
              tokenMonitor.setMainWindow(this.mainWindow);
            }
          } catch (error) {
            console.error('[Startup] Failed to set auth module windows:', error);
          }
        });
        
        // 📸 Defer registration of screenshot IPC handlers
        setImmediate(async () => {
          try {
            const { registerScreenshotIPC } = await import('./lib/screenshot');
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              registerScreenshotIPC(this.mainWindow, {
                getCurrentUserAlias: () => this.currentUserAlias,
              });
            }
          } catch (error) {
            console.error('[Startup] Failed to register screenshot IPC:', error);
          }
        });
        
        // 🔥 Optimization: async deferred loading of AgentChatManager to avoid blocking window display
        setImmediate(async () => {
          try {
            const { agentChatManager } = await import('./lib/chat/agentChatManager');
            // Re-check if mainWindow still exists
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              agentChatManager.setMainWindow(this.mainWindow);
            }
            
            // Mark AgentChat as ready
            this.isAgentChatReady = true;
            this.checkAppReadiness();
          } catch (error) {
            console.error('[Startup] Failed to lazy load AgentChatManager:', error);
            // Mark as ready even on failure
            this.isAgentChatReady = true;
            this.checkAppReadiness();
          }
        });
        
        if (this.isDev) {
          setTimeout(() => {
            this.mainWindow?.webContents.openDevTools();
          }, 2000); // Delay 1 second before opening DevTools to ensure window is fully loaded
          
          // Add keyboard shortcuts for development
          this.mainWindow.webContents.on('before-input-event', (event, input) => {
            // F5 or Ctrl+R to reload
            if ((input.key === 'F5') || (input.control && input.key === 'r')) {
              this.mainWindow?.webContents.reload();
            }
          });
        }
      }
    });

    
    // 🚀 Optimization: defer registering main window for ProfileCacheManager and AppCacheManager
    if (this.mainWindow) {
      setImmediate(async () => {
        const pcManager = await getProfileCacheManager();
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          pcManager.setMainWindow(this.mainWindow);
        }
        // 🆕 Initialize AppCacheManager and set main window reference
        const acManager = await getAppCacheManager();
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          acManager.setMainWindow(this.mainWindow);
        }
      });
    }

    // macOS standard behavior: intercept close event, hide window instead of destroying
    if (process.platform === 'darwin') {
      this.mainWindow.on('close', (event) => {
        // Prevent window from closing
        event.preventDefault();
        // Hide window instead of destroying
        this.mainWindow?.hide();
      });
    }

    this.mainWindow.on('closed', () => {

      // macOS standard behavior: do not quit app when main window is closed
      if (process.platform === 'darwin') {
        // On macOS, only clean up window reference, keep app running
        this.mainWindow = null;
      } else {
        // On non-macOS systems, quit program when main window is closed
        try {
          // Close Debug window
          if (this.debugWindow && !this.debugWindow.isDestroyed()) {
            this.debugWindow.close();
            this.debugWindow = null;
          }

          this.mainWindow = null;

        } catch (error) {
        }
      }
    });

    // Handle external links
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) {
        require('electron').shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    // Load the app
    try {
      if (this.isDev) {
        // Development mode: load from webpack-dev-server
        const devServerUrl = 'http://localhost:3000';
        await this.mainWindow.loadURL(devServerUrl);
      } else {
        // Production mode: load from built files
        const htmlPath = path.join(__dirname, '../renderer/index.html');

        const fs = require('fs');
        if (!fs.existsSync(htmlPath)) {
          // Load a simple fallback page
          await this.mainWindow.loadURL('data:text/html,<html><body><h1>KOSMOS App</h1><p>HTML file not found. Please run: npm run build</p></body></html>');
        } else {
          await this.mainWindow.loadFile(htmlPath);
        }
      }
    } catch (error) {
      // Load error page
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.mainWindow.loadURL('data:text/html,<html><body><h1>KOSMOS App - Error</h1><p>Failed to load: ' + errorMessage + '</p></body></html>');
    }
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }


  private initSelectionHook() {
    const logger = getAdvancedLogger();
    // Only support selection-hook for Kosmos brand
    if (process.env.BRAND_NAME !== 'kosmos') {
      return;
    }

    if( this.selectionHook) {
      return;
    }
    
    try {
      const SelectionHook:SelectionHookConstructor = require('selection-hook');
      const selectionHook = new SelectionHook();

      selectionHook.on('text-selection', (selection: TextSelectionData) => {
        logger.info('[SELECTION-HOOK] Text selection event received:' + selection.text);
        if (selection && selection.text && selection.text.length > 0 && selection.text.length < 20000) {
          this.selectedText = selection.text.trim();
        }
      });

      this.selectionHook = selectionHook;
      this.selectionHook!.start({debug: this.isDev});
      
      // 🔥 Fix: register process exit listener to safely clean up SelectionHook
      process.on('exit', () => {
        this.cleanupSelectionHook();
      });
      logger.info('[SELECTION-HOOK] selection-hook initialized successfully');
    } catch (error) {
      logger.warn('[SELECTION-HOOK] Failed to initialize selection-hook:', error);
      // If selection-hook initialization fails, set to null, fall back to clipboard approach
      this.selectionHook = null;
    }
  }
  
  /**
   * Safely clean up SelectionHook instance
   * Prevent crashes during app exit
   */
  private cleanupSelectionHook() {
    if (this.selectionHook) {
      try {
        // Try to safely stop SelectionHook
        if (typeof this.selectionHook.stop === 'function') {
          this.selectionHook.stop();
        }
        
        // Clear reference, let garbage collector handle it
        this.selectionHook = null;
        
      } catch (error) {
        // Ignore errors during cleanup to avoid crashes
        safeConsole.warn('[SELECTION-HOOK] Error during cleanup (ignored):', error);
        this.selectionHook = null;
      }
    }
  }

  /**
   * Capture user selected text
   * Strategy: three-tier fallback strategy
   * 1. selection-hook native module (recommended, directly reads system selected text)
   * 2. Electron clipboard API (fallback, requires user to manually copy)
   * 3. Exception tolerance handling
   */
  private async captureSelectedText(): Promise<void> {
    if (process.platform === 'darwin') {
      return;
    }
    // Approach 1: selection-hook (real-time monitoring)
    // If selectionHook is initialized, rely on 'selection' event to update this.selectedText in real-time
    if (this.selectionHook) {
      // 🟢 Optimization: proactively get current selection (more reliable than relying on events, especially in shortcut-triggered scenarios)
      // Reference SelectionService.ts processSelectTextByShortcut implementation
      try {
        const logger = getAdvancedLogger();
        // @ts-ignore - selection-hook typing might vary
        if (typeof this.selectionHook.getCurrentSelection === 'function') {
           // @ts-ignore
           const selection = this.selectionHook.getCurrentSelection();
           if (selection && selection.text && selection.text.length > 0) {
               this.selectedText = selection.text.trim();
               logger.info('[SELECTION-HOOK] Active capture success: ' + this.selectedText.substring(0, 50) + '...');
           }
        }
      } catch (e) {
         // logger.warn('[SELECTION-HOOK] Active capture failed, falling back to cached event data', e);
      }
    }
  }


  /**
   * Start browser and implement split-screen layout
   * Can be reused by enable and launchWithSnap
   */
  private async launchBrowserWithSnap(): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: 'Browser Control is only supported on Windows' };
      }

      if (!this.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      const { exec } = require('child_process');
      const browserControlDir = path.join(app.getAppPath(), 'resources', 'browser-control');

      // Read user-selected browser type
      const pcManager = await getProfileCacheManager();
      const browserSettings = pcManager.getBrowserControlSettings(this.currentUserAlias);
      const browserConfig = BROWSER_CONFIG[browserSettings.browser || 'edge'];

      // 1. Check if browser has foreground windows running (excluding background processes like WebView2)
      const processName = browserConfig.exe.replace('.exe', '');
      const isBrowserRunning = await new Promise<boolean>((resolve) => {
        exec(`powershell -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count -gt 0"`, (err: Error | null, stdout: string) => {
          if (err) {
            resolve(false);
          } else {
            resolve(stdout.trim().toLowerCase() === 'true');
          }
        });
      });

      console.log('[BrowserControl] Setting up browser with Windows Snap...');

      try {
        const snapLeftScript = path.join(browserControlDir, 'snap-left.ps1');

        // 2. Ensure Kosmos window is in foreground (restore minimized, show, focus)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore();
          }
          this.mainWindow.show();
          this.mainWindow.focus();
        }

        // 3. Snap Kosmos to left
        console.log('[BrowserControl] Snapping Kosmos to left...');
        await new Promise<void>((resolveSnap) => {
          exec(`powershell -ExecutionPolicy Bypass -File "${snapLeftScript}"`, (err: Error | null) => {
            if (err) console.warn('[BrowserControl] Failed to snap Kosmos to left:', err.message);
            resolveSnap();
          });
        });

        // 4. Get Kosmos window position, calculate where Chrome should be placed
        const kosmosBounds = this.mainWindow?.getBounds() || { x: 0, y: 0, width: 960, height: 540 };
        const targetX = kosmosBounds.x + kosmosBounds.width;
        const targetY = kosmosBounds.y;
        console.log(`[BrowserControl] Kosmos bounds: x=${kosmosBounds.x}, y=${kosmosBounds.y}, width=${kosmosBounds.width}, height=${kosmosBounds.height}`);

        // 5. Start browser (skip if already running)
        if (isBrowserRunning) {
          console.log(`[BrowserControl] ${browserConfig.exe} is already running, skipping launch`);
        } else {
          console.log(`[BrowserControl] Launching ${browserConfig.exe}...`);
          
          // Edge special handling: first launch requires start→close→restart to correctly load extensions
          // Edge extension config is written on exit
          if (browserSettings.browser === 'edge') {
            // First launch
            await new Promise<void>((resolveExec) => {
              exec(`${browserConfig.startCmd} --new-window`, (err: Error | null) => {
                if (err) console.warn(`[BrowserControl] Failed to launch ${browserConfig.exe}:`, err.message);
                resolveExec();
              });
            });
            
            // Wait 1 second
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Close browser
            console.log(`[BrowserControl] Closing ${browserConfig.exe} for extension registration...`);
            await new Promise<void>((resolveKill) => {
              exec(`taskkill /IM ${browserConfig.exe} /F`, (err: Error | null) => {
                if (err) console.warn(`[BrowserControl] Failed to close ${browserConfig.exe}:`, err.message);
                resolveKill();
              });
            });
            
            // Wait 1 second to ensure complete exit
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Launch again
            console.log(`[BrowserControl] Re-launching ${browserConfig.exe}...`);
            await new Promise<void>((resolveExec) => {
              exec(`${browserConfig.startCmd} --new-window`, (err: Error | null) => {
                if (err) console.warn(`[BrowserControl] Failed to re-launch ${browserConfig.exe}:`, err.message);
                resolveExec();
              });
            });
          } else {
            // Chrome launches directly
            await new Promise<void>((resolveExec) => {
              exec(`${browserConfig.startCmd} --new-window`, (err: Error | null) => {
                if (err) console.warn(`[BrowserControl] Failed to launch ${browserConfig.exe}:`, err.message);
                resolveExec();
              });
            });
          }
        }

        // 6. Move browser to the monitor where Kosmos is located
        console.log(`[BrowserControl] Moving ${browserConfig.exe} to Kosmos display...`);
        const moveBrowserScript = path.join(browserControlDir, browserConfig.moveBrowserToDisplayScript);
        await new Promise<void>((resolveMove) => {
          exec(`powershell -ExecutionPolicy Bypass -File "${moveBrowserScript}" -targetX ${targetX} -targetY ${targetY}`, (err: Error | null) => {
            if (err) console.warn(`[BrowserControl] Failed to move ${browserConfig.exe}:`, err.message);
            resolveMove();
          });
        });

        // 7. Snap browser to right
        console.log(`[BrowserControl] Snapping ${browserConfig.exe} to right...`);
        const snapRightScript = path.join(browserControlDir, browserConfig.snapRightScript);
        await new Promise<void>((resolveSnap) => {
          exec(`powershell -ExecutionPolicy Bypass -File "${snapRightScript}"`, (err: Error | null) => {
            if (err) console.warn(`[BrowserControl] Failed to snap ${browserConfig.exe} to right:`, err.message);
            resolveSnap();
          });
        });

      } catch (snapError) {
        console.warn('[BrowserControl] Snap failed, falling back to normal launch:', snapError);
        if (!isBrowserRunning) {
          await new Promise<void>((resolveExec) => {
            exec(browserConfig.startCmd, (err: Error | null) => {
              if (err) console.warn(`[BrowserControl] Failed to launch ${browserConfig.exe}:`, err.message);
              resolveExec();
            });
          });
        }
      }

      // 8. Poll and wait for Native Server to start
      const mcpServerUrl = 'http://127.0.0.1:12306';
      const maxWaitTime = 30000;
      const pollInterval = 500;
      const startTime = Date.now();

      console.log('[BrowserControl] Waiting for Native Server to start...');

      let serverReady = false;
      while (Date.now() - startTime < maxWaitTime) {
        try {
          const response = await fetch(`${mcpServerUrl}/ping`);
          if (response.ok) {
            serverReady = true;
            console.log('[BrowserControl] Native Server is ready!');
            break;
          }
        } catch {
          // Connection failed, continue waiting
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      if (!serverReady) {
        console.warn('[BrowserControl] Native Server did not start within timeout, attempting MCP connection anyway...');
      }

      return { success: true };
    } catch (error) {
      console.error('[BrowserControl] launchBrowserWithSnap failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async createDebugWindow(): Promise<void> {
    // If debug window already exists, just focus it
    if (this.debugWindow && !this.debugWindow.isDestroyed()) {
      this.debugWindow.focus();
      return;
    }

    
    // Create the debug window
    this.debugWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: `${process.env.APP_NAME} Debug Tools`,
      parent: this.mainWindow || undefined,
      modal: false,
      icon: app.isPackaged
        ? path.join(process.resourcesPath, 'brand-assets/win/app.ico')
        : path.join(
            __dirname,
            `../../brands/${process.env.BRAND_NAME}/assets/win/app.ico`,
          ),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: false,
        allowRunningInsecureContent: true,
        experimentalFeatures: false,
        sandbox: false,
        enableBlinkFeatures: '',
        disableBlinkFeatures: '',
      },
    });


    // Set up window event handlers
    this.debugWindow.once('ready-to-show', () => {
      if (this.debugWindow) {
        this.debugWindow.show();
        
        if (this.isDev) {
          this.debugWindow.webContents.openDevTools();
        }
      }
    });

    this.debugWindow.on('closed', () => {
      this.debugWindow = null;
    });

    // Load the same app as main window
    try {
      if (this.isDev) {
        // Development mode: load from webpack-dev-server
        const devServerUrl = 'http://localhost:3000';
        await this.debugWindow.loadURL(devServerUrl);

        // Set the debug flag after DOM is ready
        await this.debugWindow.webContents.executeJavaScript(`
          window.isDebugWindow = true;

          // Force a React re-render by dispatching a custom event
          if (window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('debugWindowReady'));
          }
        `);

      } else {
        // Production mode: load from built files
        const htmlPath = path.join(__dirname, '../renderer/index.html');

        const fs = require('fs');
        if (!fs.existsSync(htmlPath)) {
          await this.debugWindow.loadURL('data:text/html,<html><body><h1>Debug Tools</h1><p>HTML file not found. Please run: npm run build</p></body></html>');
        } else {
          await this.debugWindow.loadFile(htmlPath);

          // Set the debug flag after DOM is ready
          await this.debugWindow.webContents.executeJavaScript(`
            window.isDebugWindow = true;

            // Force a React re-render by dispatching a custom event
            if (window.dispatchEvent) {
              window.dispatchEvent(new CustomEvent('debugWindowReady'));
            }
          `);

        }
      }
    } catch (error) {
      // Load error page
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.debugWindow.loadURL('data:text/html,<html><body><h1>Debug Tools - Error</h1><p>Failed to load: ' + errorMessage + '</p></body></html>');
    }
  }

  /**
   * Register global shortcuts
   */
  private async registerGlobalShortcuts(): Promise<void> {
    const logger = getAdvancedLogger();
    // Only register shortcuts for Kosmos brand
    if (process.env.BRAND_NAME !== 'kosmos') {
      return;
    }

    // Unregister existing shortcuts to prevent duplicates or stale shortcuts
    this.unregisterGlobalShortcuts();

    // Register screenshot shortcut
    const { registerScreenshotShortcut } = await import('./lib/screenshot');
    await registerScreenshotShortcut({
      getCurrentUserAlias: () => this.currentUserAlias,
    });
  }

  /**
   * Unregister all global shortcuts
   */
  private unregisterGlobalShortcuts(): void {
    const { globalShortcut } = require('electron');
    globalShortcut.unregisterAll();
  }

  private async handleWebSearch(chatId: string): Promise<{ success: boolean; error?: string }> {
    const logger = getAdvancedLogger();
    try {
      const selectedText = this.selectedText ? this.selectedText.trim() : '';
      logger.info(`[WEB-SEARCH] Performing web search for chatId: ${chatId} with selected text: ${selectedText.substring(0, 50)}...`);
      const query = encodeURIComponent(selectedText);
      let url = '';

      if (chatId === 'pseudo-agent-search-bing') {
        url = selectedText ? `https://www.bing.com/search?q=${query}` : 'https://www.bing.com';
      } else {
        // Default to Google
        url = selectedText ? `https://www.google.com/search?q=${query}` : 'https://www.google.com';
      }

      

      await shell.openExternal(url);

      return { success: true };
    } catch (error) {
      console.error('Failed to perform web search:', error);
      return { success: false, error: String(error) };
    }
  }

  private getMenuTemplate(): Electron.MenuItemConstructorOptions[] {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Logs Folder',
            click: async () => {
              try {
                const logDirectory = path.join(app.getPath('userData'), 'logs');
                // Ensure logs directory exists
                if (!fs.existsSync(logDirectory)) {
                  fs.mkdirSync(logDirectory, { recursive: true });
                }
                await shell.openPath(logDirectory);
              } catch (error) {}
            },
          },
          {
            label: 'Open Profile Folder',
            click: async () => {
              try {
                if (!this.currentUserAlias) {
                  // Show a message or dialog that no user is signed in
                  return;
                }
                const profileDirectory = path.join(
                  app.getPath('userData'),
                  'profiles',
                  this.currentUserAlias,
                );
                // Ensure profile directory exists
                if (!fs.existsSync(profileDirectory)) {
                  fs.mkdirSync(profileDirectory, { recursive: true });
                }
                await shell.openPath(profileDirectory);
              } catch (error) {}
            },
          },
          { type: 'separator' },
          {
            label: 'Open Debug Tools',
            accelerator:
              process.platform === 'darwin' ? 'Cmd+Shift+D' : 'Ctrl+Shift+D',
            click: async () => {
              try {
                await this.createDebugWindow();
              } catch (error) {}
            },
          },
          { type: 'separator' },
          {
            label: 'Log to Disk',
            accelerator:
              process.platform === 'darwin' ? 'Cmd+Shift+L' : 'Ctrl+Shift+L',
            click: async () => {
              try {
                if (
                  advancedLogger &&
                  typeof advancedLogger.flushToDisk === 'function'
                ) {
                  await advancedLogger.flushToDisk();
                } else {
                }
              } catch (error) {}
            },
          },
          { type: 'separator' },
          {
            label: 'Exit',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: () => {
              app.quit();
            },
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          ...(process.platform === 'darwin'
            ? [
                { role: 'pasteAndMatchStyle' as const },
                { role: 'delete' as const },
                { role: 'selectAll' as const },
                { type: 'separator' as const },
                {
                  label: 'Speech',
                  submenu: [
                    { role: 'startSpeaking' as const },
                    { role: 'stopSpeaking' as const },
                  ],
                },
              ]
            : [
                { role: 'delete' as const },
                { type: 'separator' as const },
                { role: 'selectAll' as const },
              ]),
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            role: 'toggleDevTools',
            label: 'Inspect (Developer Tools)',
            accelerator:
              process.platform === 'darwin' ? 'Cmd+Option+I' : 'Ctrl+Shift+I',
          },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          ...(process.platform === 'darwin'
            ? [
                { type: 'separator' as const },
                { role: 'front' as const, label: 'Bring All to Front' },
              ]
            : [{ role: 'close' as const }]),
        ],
      },
    ];

    // Adjust menu structure on macOS
    if (process.platform === 'darwin') {
      template.unshift({
        label: app.getName(),
        submenu: [
          { role: 'about', label: 'About ' + app.getName() },
          { type: 'separator' },
          { role: 'services', label: 'Services', submenu: [] },
          { type: 'separator' },
          { role: 'hide', label: 'Hide ' + app.getName() },
          { role: 'hideOthers', label: 'Hide Others' },
          { role: 'unhide', label: 'Show All' },
          { type: 'separator' },
          { role: 'quit', label: 'Quit ' + app.getName() },
        ],
      });
    }

    return template;
  }

  private setupMenu(): void {
    const template = this.getMenuTemplate();
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
}

// Create and start the application
const electronApp = new ElectronApp();

// Export for potential use in other modules
export default electronApp;
