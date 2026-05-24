// 🚀 Performance timing: record module load start time
// NOTE: must use raw console here — safeConsole is not yet imported at this point
console.time('[Startup] Total main.ts load');
console.time('[Startup] Module imports');

// 🛡️ Global EPIPE error handling - must be registered early to capture all stream write errors
// EPIPE errors occur when writing to a closed pipe (e.g., console output during app exit)
// These errors should be silently ignored instead of crashing the app
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

import { app, BrowserWindow, Menu, shell, protocol, powerMonitor, globalShortcut } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile, execSync } from 'child_process';
import JSZip from 'jszip';


// 🔥 Must be called before app.ready - register custom protocol for screenshot feature
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'screenshot',
    privileges: {
      secure: true,
      standard: true,
      bypassCSP: true,
      supportFetchAPI: true,
      stream: true,
    }
  },
]);
import SelectionHook, { type SelectionHookInstance, type TextSelectionData } from 'selection-hook'
import { recoverSelectionText } from './lib/selectionHookEncoding';

// 🚀 Phase 2 optimization: heavy modules converted to dynamic import, not loaded at startup
// The following modules perform heavy initialization on import (singleton creation, file I/O, config reading, etc.)
// Changed to on-demand loading, significantly improving Windows startup speed

// Type imports (no code execution, used for type checking only)

const DEV_SERVER_PORT = process.env.DEV_SERVER_PORT || '39017';
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'] || `http://localhost:${DEV_SERVER_PORT}`;

// Lightweight utility modules (no side effects, can keep static imports)
import { createLogger } from './lib/unifiedLogger';
import { crashCaptureManager } from './lib/crash/CrashCaptureManager';
import { safeConsole, exitSafeLog } from './lib/utilities/safeConsole';
import { getDebugInfoEntries } from './lib/utilities/debugInfoEntries';
import { buildDebugInfoManifest } from './lib/utilities/debugInfoManifest';
import { createRedactor, isTextFile, redactFileContent } from './lib/utilities/redact';
import { featureFlagManager, isFeatureEnabled } from './lib/featureFlags';

import {
  getProfileCacheManager,
  getAppCacheManager,
  getMainAuthManager,
  getMainTokenMonitor,
  getAdvancedLogger,
  useAdvancedLogger,
} from './startup/lazy';
import { setUpIPC } from './startup/ipc';
import { startEvalMode } from './startup/evalMode';
import { ghcModelsManager } from "./lib/llm/ghcModelsManager";
import { schedulerManager } from "./lib/scheduler/SchedulerManager";
import { mcpClientManager } from "./lib/mcpRuntime/mcpClientManager";
import { agentChatManager } from "./lib/chat/agentChatManager";
import { chatSessionStore } from "./lib/chat/chatSessionStore";
import { scheduleStore } from "./lib/scheduler/scheduleStore";
import { SubAgentTaskStore } from "./lib/subAgent/subAgentTaskStore";


console.timeEnd('[Startup] Module imports');

// 🚀 Optimization: async dotenv loading, non-blocking startup
// Only load .env.local in development, use setImmediate to avoid blocking main thread
if (process.env.NODE_ENV === 'development') {
  setImmediate(async () => {
    const possibleEnvPaths = [
      path.join(__dirname, '../../.env.local'),
      path.join(process.cwd(), '.env.local'),
    ];

    const { default: dotenv } = await import('dotenv');
    for (const envPath of possibleEnvPaths) {
      try {
        await fs.promises.access(envPath, fs.constants.F_OK);
        dotenv.config({ path: envPath });
        safeConsole.log('[Startup] ✅ Loaded .env.local from:', envPath);
        break;
      } catch {
        // File not found, try next one
      }
    }
  });
}


// 🚀 Optimization: deferred Hot reload initialization, non-blocking startup
if (process.env.NODE_ENV === 'development') {
  // Use setImmediate for deferred loading, avoid blocking main process startup
  setImmediate(async () => {
    try {
      const watchPath = __dirname;

      safeConsole.log('[Hot Reload] 🔥 Development mode detected, enabling electron-reload');

      const { default: electronReload } = await import('electron-reload');
      electronReload(watchPath, {
        electron: require.resolve('electron'),
        hardResetMethod: 'exit',
        forceHardReset: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
        ignored: [/node_modules/, /\.map$/],
      });

      safeConsole.log('[Hot Reload] ✅ electron-reload enabled successfully');
    } catch (error) {
      safeConsole.error('[Hot Reload] ❌ Failed to enable electron-reload:', error);
    }
  });
}

const isEvalMode = process.argv.includes('--eval-mode');

const hasSingleInstanceLock = isEvalMode
  ? true  // Skip single-instance lock in eval mode — allow running alongside GUI
  : app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  // March 2026 regression note: a Playwright install path once tried to spawn
  // `process.execPath`, which is the packaged Electron app rather than a Node
  // runtime. Keeping a single-instance lock here ensures that similar process-
  // launch mistakes degrade into "focus existing window" instead of running
  // two full app instances side by side.
  safeConsole.warn('[Startup] Another instance is already running, quitting this process');
  app.quit();
}

class ElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private debugWindow: BrowserWindow | null = null;
  private selectedText: string = ''; // Store captured selected text
  private isDev: boolean = false;
  private currentUserAlias: string | null = null;
  private selectionHook: SelectionHookInstance | null = null; // SelectionHook instance

  // 🚀 State tracking: app component initialization status
  private isAnalyticsReady: boolean = false;
  private isAgentChatReady: boolean = false;
  private powerMonitorLoggingRegistered: boolean = false;
  private lastSuspendAt: number | null = null;

  private logSchedulerLifecycleState(event: string, extra?: Record<string, unknown>): void {
    if (!isFeatureEnabled('openkosmosFeatureScheduler')) return;

    Promise.resolve()
      .then(() => {
        getAdvancedLogger().info(`scheduler.lifecycle.${event}`, 'main:schedulerLifecycle', {
          schedulerState: schedulerManager.getRuntimeDiagnostics(),
          ...extra,
        });
      })
      .catch((error) => {
        getAdvancedLogger().warn(`scheduler.lifecycle.${event}.failed`, 'main:schedulerLifecycle', {
          error: error instanceof Error ? error.message : String(error),
          ...extra,
        });
      });
  }

  constructor() {
    safeConsole.time('[Startup] ElectronApp constructor');

    // Ensure environment variables are fully passed through
    process.env.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';

    // Add additional paths if needed
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
    crashCaptureManager.initialize({ isDev: this.isDev });
    crashCaptureManager.recordBreadcrumb('lifecycle', 'electron-app-constructor', {
      isDev: this.isDev,
    });

    // 🚀 Initialize Feature Flag manager before any feature-gated setup runs.
    try {
      featureFlagManager.initialize();
    } catch (error) {
      safeConsole.warn('[Startup] FeatureFlagManager initialization failed:', error);
    }

    this.setupEventHandlers();

    // 🚀 Optimization: deferred log initialization, non-blocking constructor
    setImmediate(() => {
      const logger = getAdvancedLogger();
      logger.info('ElectronApp initialized', 'main', { isDev: this.isDev });
      logger.debug('PATH environment variable', 'main', { path: process.env.PATH });
    });

    safeConsole.timeEnd('[Startup] ElectronApp constructor');
  }

  private setupEventHandlers(): void {
    // App event handlers
    app.on('ready', this.onReady.bind(this));
    app.on('window-all-closed', this.onWindowAllClosed.bind(this));
    app.on('activate', this.onActivate.bind(this));
    app.on('second-instance', () => {
      // Focus recovery is intentionally lightweight: if a future regression or
      // an OS-level reopen launches a second process, users should be brought
      // back to the existing window instead of losing context.
      safeConsole.log('[Startup] Second instance detected, focusing existing window');
      const focusExistingWindow = async () => {
        try {
          await this.onActivate();
        } catch (error) {
          safeConsole.warn('[Startup] Failed to focus existing window for second instance:', error);
        }
      };

      if (app.isReady()) {
        void focusExistingWindow();
      } else {
        app.once('ready', () => {
          void focusExistingWindow();
        });
      }
    });

    // 🔥 Fix: add cleanup handling before app exit
    app.on('before-quit', (event) => {
      try {
        this.logSchedulerLifecycleState('before-quit', {
          appUptimeSeconds: Math.round(process.uptime()),
        });
        // Ensure SelectionHook is properly cleaned up before app exit
        this.cleanupSelectionHook();
      } catch (error) {
        // Ignore cleanup errors to avoid preventing app exit
        safeConsole.warn('[APP-EXIT] Error during SelectionHook cleanup:', error);
      }
    });

    app.on('will-quit', (event) => {
      try {
        this.logSchedulerLifecycleState('will-quit', {
          appUptimeSeconds: Math.round(process.uptime()),
        });
        // Last chance to clean up SelectionHook
        this.cleanupSelectionHook();
      } catch (error) {
        // Ignore cleanup errors, ensure app can exit normally
        safeConsole.warn('[APP-EXIT] Final cleanup error (ignored):', error);
      }
    });
    app.on('before-quit', this.onBeforeQuit.bind(this));

    const host = this;
    class Injection {
      get currentUserAlias() { return host.currentUserAlias; }
      set currentUserAlias(alias: string | null) { host.currentUserAlias = alias; }

      get mainWindow() { return host.mainWindow; }
      get debugWindow() { return host.debugWindow; }
      get isDev() { return host.isDev; }
      get isAnalyticsReady() { return host.isAnalyticsReady; }
      get isAgentChatReady() { return host.isAgentChatReady; }
      get selectedText() { return host.selectedText; }


      cleanupSelectionHook = host.cleanupSelectionHook.bind(host);
      onBeforeQuit = host.onBeforeQuit.bind(host);
      registerGlobalShortcuts = host.registerGlobalShortcuts.bind(host);
      getPersistedWindowZoomLevel = host.getPersistedWindowZoomLevel.bind(host);
      applyWindowZoomLevel = host.applyWindowZoomLevel.bind(host);
      stepWindowZoomLevel = host.stepWindowZoomLevel.bind(host);
      resetWindowZoomLevel = host.resetWindowZoomLevel.bind(host);
      getMenuTemplate = host.getMenuTemplate.bind(host);
      handleWebSearch = host.handleWebSearch.bind(host);
      unregisterGlobalShortcuts = host.unregisterGlobalShortcuts.bind(host);
      createDebugWindow = host.createDebugWindow.bind(host);
      checkAssetsLibrariesAsync = host.checkAssetsLibrariesAsync.bind(host);
    }
    setUpIPC(new Injection());
  }

  /**
   * 🆕 Asynchronously check remote assets libraries (agent_lib.json, mcp_lib.json, skills_lib.json)
   * Called during silent check after user login
   */
  private async checkAssetsLibrariesAsync(): Promise<void> {
    try {
      // Refresh remote model list
      try {
        const refreshed = await ghcModelsManager.refreshFromRemote();
        if (refreshed) {
          safeConsole.log('[UPDATE] GitHub Copilot models refreshed from remote');
        }
      } catch (modelsError) {
        safeConsole.warn('[UPDATE] Models refresh failed (non-fatal):', modelsError);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      safeConsole.error(`[UPDATE] Assets library check failed: ${errorMessage}`);
    }
  }

  /**
   * Check if app is fully ready, if so, notify renderer process
   */
  private checkAppReadiness() {
    if (this.isAnalyticsReady && this.isAgentChatReady) {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        safeConsole.log('[Startup] App fully ready (Analytics + AgentChat), notifying renderer');
        this.mainWindow.webContents.send('app:ready', true);
      }
    }
  }

  private registerPowerMonitorLogging(): void {
    if (this.powerMonitorLoggingRegistered) {
      return;
    }

    this.powerMonitorLoggingRegistered = true;

    const logger = getAdvancedLogger();
    const logPowerEvent = (event: string, data?: Record<string, unknown>) => {
      logger.info(`[PowerMonitor] ${event}`, 'main:powerMonitor', {
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        ...data,
      });
    };

    powerMonitor.on('suspend', () => {
      this.lastSuspendAt = Date.now();
      this.logSchedulerLifecycleState('power-suspend', {
        suspendedAt: new Date(this.lastSuspendAt).toISOString(),
      });
      logPowerEvent('System suspend detected', {
        appUptimeSeconds: Math.round(process.uptime()),
      });

      if (process.platform === 'win32') {
        logger.warn(
          '[PowerMonitor] Windows suspend detected. Node/Electron timers and in-flight IPC may pause until resume; if startup is waiting on an unresolved promise, UI can appear stuck after wake.',
          'main:powerMonitor',
          {
            arch: process.arch,
            appUptimeSeconds: Math.round(process.uptime()),
          },
        );
      }
    });

    powerMonitor.on('resume', () => {
      const resumedAt = Date.now();
      const suspendedForMs = this.lastSuspendAt ? resumedAt - this.lastSuspendAt : undefined;
      const suspendedAt = this.lastSuspendAt;
      this.lastSuspendAt = null;

      this.logSchedulerLifecycleState('power-resume', {
        suspendedAt: suspendedAt ? new Date(suspendedAt).toISOString() : undefined,
        resumedAt: new Date(resumedAt).toISOString(),
        suspendedForMs,
      });

      logPowerEvent('System resume detected', {
        suspendedForMs,
        suspendedForSeconds: suspendedForMs !== undefined ? Math.round(suspendedForMs / 1000) : undefined,
        appUptimeSeconds: Math.round(process.uptime()),
      });

      if (process.platform === 'win32') {
        logger.warn(
          '[PowerMonitor] Windows resume detected. If startup or profile initialization was pending before suspend, review the preceding 1-2 minutes of logs for unresolved IPC/fetch operations and consider power policy / connected-standby interference.',
          'main:powerMonitor',
          {
            arch: process.arch,
            suspendedForMs,
          },
        );
      }

      if (isFeatureEnabled('openkosmosFeatureScheduler') && suspendedAt && suspendedForMs && suspendedForMs > 0) {
        Promise.resolve()
          .then(() => schedulerManager.handleSystemResume(suspendedAt, resumedAt))
          .catch((schedulerError) => {
            logger.warn(
              '[PowerMonitor] Scheduler resume catch-up failed',
              'main:powerMonitor',
              {
                suspendedForMs,
                error: schedulerError instanceof Error ? schedulerError.message : String(schedulerError),
              },
            );
          });
      }
    });

    powerMonitor.on('on-battery', () => {
      logPowerEvent('Power source changed: battery');
    });

    powerMonitor.on('on-ac', () => {
      logPowerEvent('Power source changed: AC');
    });

    powerMonitor.on('lock-screen', () => {
      this.logSchedulerLifecycleState('power-lock-screen');
      logPowerEvent('Screen locked');
    });

    powerMonitor.on('unlock-screen', () => {
      this.logSchedulerLifecycleState('power-unlock-screen');
      logPowerEvent('Screen unlocked');
    });

    logPowerEvent('Power monitor diagnostics registered');
  }

  private async onReady(): Promise<void> {
    safeConsole.time('[Startup] onReady');
    try {
      // ── Eval mode: headless HTTP harness ──
      // Check first, before any GUI-only initialization (crash recovery,
      // power monitor, scheduler logging) to avoid unnecessary work and
      // ensure eval mode has its own clean error path.
      if (isEvalMode) {
        await startEvalMode();
        return; // Skip all UI initialization
      }

      crashCaptureManager.recordBreadcrumb('lifecycle', 'app-ready');



      const crashStatus = crashCaptureManager.getStatus();
      getAdvancedLogger().info('scheduler.lifecycle.startup-recovery-context', 'main:onReady', { previousSessionId: crashStatus.recoveredCrash?.previousSessionId ?? null, currentSessionId: crashStatus.currentSessionId, recoveredCrashDetected: crashStatus.hasRecoveredCrash, alias: this.currentUserAlias, schedulerWillInit: isFeatureEnabled('openkosmosFeatureScheduler') });
      this.registerPowerMonitorLogging();

      // 🧹 Cleanup: remove playwright-profiles directory and legacy session state
      // files on every startup.  Playwright persistent contexts may leave behind
      // lock files or corrupted state that causes launch failures on subsequent
      // runs.  Wiping the directory ensures a fresh browser context each time.
      // The session-state JSON files (browser-session-state.json,
      // cdp-session-state.json, kosmos-token-cache.json) are legacy token caches
      // that must stay removed. Browser auth now persists only via the
      // profile-scoped OpenKosmosTokenCache path.
      try {
        const userDataPath = app.getPath('userData');

        // 1. Remove playwright-profiles directory
        const playwrightProfilesDir = path.join(userDataPath, 'playwright-profiles');
        if (fs.existsSync(playwrightProfilesDir)) {
          fs.rmSync(playwrightProfilesDir, { recursive: true, force: true });
          safeConsole.info('[Startup] 🧹 Removed playwright-profiles directory');
        }

        // 2. Remove legacy session state files
        const legacyFiles = ['browser-session-state.json', 'cdp-session-state.json', 'kosmos-token-cache.json'];
        for (const filename of legacyFiles) {
          const filePath = path.join(userDataPath, filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            safeConsole.info(`[Startup] 🧹 Removed legacy session state file: ${filename}`);
          }
        }
      } catch (cleanupErr) {
        safeConsole.warn('[Startup] Failed to clean up playwright/session state files:', cleanupErr);
      }

      // 🚀 Highest priority: warm up AppCacheManager (read app.json / migrate runtimeConfig.json)
      // Fire-and-forget, fully parallel with all subsequent tasks, ensure earlier than profile.json initialization
      getAppCacheManager().catch((e) => {
        safeConsole.warn('[Startup] AppCacheManager pre-warm failed:', e);
      });

      safeConsole.time('[Startup] createMainWindow');
      // 🚀 Optimization: start window creation task immediately
      const windowCreationTask = this.createMainWindow();

      // Mark Analytics as ready immediately (analytics removed)
      this.isAnalyticsReady = true;
      this.checkAppReadiness();

      // Wait for window creation to complete (subsequent logic depends on this.mainWindow)
      await windowCreationTask;
      safeConsole.timeEnd('[Startup] createMainWindow');

      // Register menu and shortcuts (catch errors to prevent blocking subsequent flow)
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


      safeConsole.timeEnd('[Startup] onReady');
    } catch (error) {
      safeConsole.timeEnd('[Startup] onReady');
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
    crashCaptureManager.recordBreadcrumb('lifecycle', 'app-activate');
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
    crashCaptureManager.recordBreadcrumb('lifecycle', 'before-quit');

    // Prevent immediate quit to allow cleanup
    event.preventDefault();

    const exitStart = Date.now();
    const exitId = `exit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      // Add final exit log before cleanup
      useAdvancedLogger((advancedLogger) => {
        advancedLogger.info(`[${exitId}] Application exiting - starting cleanup sequence...`);
        exitSafeLog('Added final exit log');
      });

      // Phase 0.5: stop all scheduled tasks
      if (isFeatureEnabled('openkosmosFeatureScheduler')) {
        exitSafeLog('Phase 0.5: Stopping scheduled cron tasks');
        try {
          getAdvancedLogger().info('scheduler.lifecycle.shutdown-sequence', 'main:onBeforeQuit', { stage: 'before-dispose', reason: 'app-quit', schedulerState: schedulerManager.getRuntimeDiagnostics() });
          await schedulerManager.dispose('app-quit');
          getAdvancedLogger().info('scheduler.lifecycle.shutdown-sequence', 'main:onBeforeQuit', { stage: 'after-dispose', reason: 'app-quit', schedulerState: schedulerManager.getRuntimeDiagnostics() });
          exitSafeLog('SchedulerManager disposed successfully');
        } catch (schedulerError) {
          getAdvancedLogger().warn('scheduler.lifecycle.shutdown-sequence', 'main:onBeforeQuit', { stage: 'dispose-failed', reason: 'app-quit', error: schedulerError instanceof Error ? schedulerError.message : String(schedulerError) });
        }
      }

      // Phase 0.6: Flush DevLogger (dev mode only)
      if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
        exitSafeLog('Phase 0.6: Flushing DevLogger buffered logs');
        try {
          const { shutdownDevLogger } = await import('./lib/devLogger');
          await shutdownDevLogger();
          exitSafeLog('DevLogger flushed successfully');
        } catch (devLoggerError) {
          safeConsole.warn('DevLogger flush failed:', devLoggerError);
        }
      }

      // Phase 1: Clean up resources
      exitSafeLog('Phase 1: Cleaning up resources');

      // Phase 1.5: Remote Channel cleanup removed (integration deleted)
      exitSafeLog('Phase 1.5: Skipped (Remote Channel integration removed)');

      // Phase 2: Clean up MCP clients and child processes
      exitSafeLog('Phase 2: Cleaning up MCP clients and child processes');
      try {

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
      await useAdvancedLogger(async (logger) => {
        exitSafeLog('Starting logger flush...');

        // Set timeout for logger flush
        await Promise.race([
          logger.handleAppExit(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Logger flush timeout')), 10000) // 10 second timeout
          )
        ]);

        exitSafeLog('Logger flush completed, proceeding with quit');
      });

      // Phase 4: Final cleanup summary
      const exitDuration = Date.now() - exitStart;
      exitSafeLog(`Cleanup sequence completed in ${exitDuration}ms, now exiting`);
      crashCaptureManager.markCleanExit(0);

      // Now allow the app to quit
      app.exit(0);
    } catch (error) {
      const exitDuration = Date.now() - exitStart;
      safeConsole.error(`Error during app exit (${exitDuration}ms):`, error);

      // Force quit even if cleanup fails
      exitSafeLog('Force quitting due to cleanup errors');
      crashCaptureManager.markCleanExit(1);
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
      titleBarStyle: process.platform === 'win32' ? 'hidden' : process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
      titleBarOverlay: undefined,
      // frame: defaults to true, no need to set explicitly
      icon: app.isPackaged
        ? path.join(process.resourcesPath, 'brand-assets/win/app.ico')
        : path.join(__dirname, `../../brands/openkosmos/assets/win/app.ico`),
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
    crashCaptureManager.attachToMainWindow(this.mainWindow);
    crashCaptureManager.recordBreadcrumb('window', 'main-window-created', {
      windowId: this.mainWindow.id,
    });

    // Dev mode: attach DevLogger to capture Renderer console logs
    if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
      import('./lib/devLogger').then(({ attachDevLoggerToWindow }) => {
        if (this.mainWindow) {
          attachDevLoggerToWindow(this.mainWindow);
        }
      }).catch((err) => {
        safeConsole.warn('[DevLogger] Failed to attach:', err);
      });
    }

    // Native right-click context menu for editable fields (Cut/Copy/Paste/Select All)
    this.mainWindow.webContents.on('context-menu', (_event, params) => {
      const { isEditable, selectionText, editFlags } = params;
      // Only show native context menu for editable areas (input, textarea, contenteditable)
      // or when text is selected (for copy)
      if (!isEditable && !selectionText) return;

      const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

      if (isEditable) {
        menuTemplate.push(
          { label: 'Cut', role: 'cut', enabled: editFlags.canCut },
        );
      }
      if (selectionText || isEditable) {
        menuTemplate.push(
          { label: 'Copy', role: 'copy', enabled: editFlags.canCopy },
        );
      }
      if (isEditable) {
        menuTemplate.push(
          { label: 'Paste', role: 'paste', enabled: editFlags.canPaste },
          { type: 'separator' },
          { label: 'Select All', role: 'selectAll', enabled: editFlags.canSelectAll },
        );
      }

      if (menuTemplate.length > 0) {
        const contextMenu = Menu.buildFromTemplate(menuTemplate);
        contextMenu.popup({ window: this.mainWindow || undefined });
      }
    });

    const applyPersistedZoomLevel = async () => {
      try {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          return;
        }

        const zoomLevel = await this.getPersistedWindowZoomLevel();
        this.applyWindowZoomLevel(zoomLevel);
      } catch (e) {
        safeConsole.error('[Zoom] Failed to restore zoom level:', e);
      }
    };

    const ensurePersistedZoomLevel = async () => {
      try {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          return;
        }

        const persistedZoomLevel = await this.getPersistedWindowZoomLevel();
        const actualZoomLevel = this.mainWindow.webContents.getZoomLevel();
        if (actualZoomLevel !== persistedZoomLevel) {
          this.applyWindowZoomLevel(persistedZoomLevel);
        }
      } catch (e) {
        safeConsole.error('[Zoom] Failed to ensure zoom level:', e);
      }
    };

    const persistMainWindowMaximized = async (maximized: boolean) => {
      try {
        const acm = await getAppCacheManager();
        await acm.updateConfig({ mainWindowMaximized: maximized });
      } catch (e) {
        safeConsole.error('[WindowState] Failed to persist maximized state:', e);
      }
    };

    const reapplyPersistedZoomLevelAfterWindowStateChange = (state: 'maximized' | 'normal') => {
      this.mainWindow?.webContents.send('window:stateChanged', state);

      setTimeout(() => {
        void applyPersistedZoomLevel();
      }, 0);
    };

    // Listen for window state changes
    this.mainWindow.on('maximize', () => {
      void persistMainWindowMaximized(true);
      reapplyPersistedZoomLevelAfterWindowStateChange('maximized');
    });
    this.mainWindow.on('unmaximize', () => {
      void persistMainWindowMaximized(false);
      reapplyPersistedZoomLevelAfterWindowStateChange('normal');
    });

    // macOS fullscreen events — notify renderer so it can adjust traffic-light-aware layout
    this.mainWindow.on('enter-full-screen', () => {
      this.mainWindow?.webContents.send('window:fullScreenChanged', true);
    });
    this.mainWindow.on('leave-full-screen', () => {
      this.mainWindow?.webContents.send('window:fullScreenChanged', false);
    });

    this.mainWindow.webContents.on('did-finish-load', () => {
      void applyPersistedZoomLevel();
    });

    this.mainWindow.webContents.on('did-stop-loading', () => {
      void ensurePersistedZoomLevel();
    });

    // Restore persisted zoom level for the initial blank page before the first navigation.
    await applyPersistedZoomLevel();

    // Set up window event handlers first
    this.mainWindow.once('ready-to-show', async () => {
      safeConsole.timeEnd('[Startup] Total main.ts load');
      safeConsole.log('[Startup] 🎉 Window ready-to-show event fired!');
      crashCaptureManager.recordBreadcrumb('window', 'main-window-ready-to-show', {
        windowId: this.mainWindow?.id,
      });

      if (this.mainWindow) {
        try {
          const acm = await getAppCacheManager();
          const config = acm.getConfig();
          if (config.mainWindowMaximized) {
            this.mainWindow.maximize();
          }
        } catch (error) {
          safeConsole.error('[WindowState] Failed to restore maximized state:', error);
        }

        // 🚀 Optimization: show window immediately, move heavy initialization to background
        this.mainWindow.show();
        safeConsole.log('[Startup] 🎉 Window shown!');

        // 🚀 Optimization: deferred setting of auth module main window reference
        setImmediate(async () => {
          try {
            const authManager = await getMainAuthManager();
            const tokenMonitor = await getMainTokenMonitor();
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              authManager.setMainWindow(this.mainWindow);
              tokenMonitor.setMainWindow(this.mainWindow);
            }
          } catch (error) {
            safeConsole.error('[Startup] Failed to set auth module windows:', error);
          }
        });

        // 📸 Deferred registration of screenshot feature IPC handlers
        setImmediate(async () => {
          try {
            const { registerScreenshotIPC } = await import('./lib/screenshot');
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              registerScreenshotIPC(this.mainWindow, {
                getCurrentUserAlias: () => this.currentUserAlias,
              });
            }
          } catch (error) {
            safeConsole.error('[Startup] Failed to register screenshot IPC:', error);
          }
        });

        // 🔥 Optimization: async deferred loading of AgentChatManager, avoid blocking window display
        setImmediate(async () => {
          try {
            // Check again if mainWindow still exists
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              agentChatManager.setMainWindow(this.mainWindow);
            }

            // Mark AgentChat as ready
            this.isAgentChatReady = true;
            this.checkAppReadiness();
          } catch (error) {
            safeConsole.error('[Startup] Failed to lazy load AgentChatManager:', error);
            // Mark as ready even on failure
            this.isAgentChatReady = true;
            this.checkAppReadiness();
          }
        });

        if (this.isDev) {
          setTimeout(() => {
            this.mainWindow?.webContents.openDevTools();
          }, 2000); // Delay 1 second before opening DevTools, ensure window is fully loaded

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


    // 🚀 Optimization: deferred registration of ProfileCacheManager and AppCacheManager main window
    if (this.mainWindow) {
      setImmediate(async () => {
        const pcManager = await getProfileCacheManager();
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          pcManager.setMainWindow(this.mainWindow);
        }

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          chatSessionStore.setMainWindow(this.mainWindow);
        }

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          scheduleStore.setMainWindow(this.mainWindow);
        }

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          SubAgentTaskStore.getInstance().setMainWindow(this.mainWindow);
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
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    // Load the app
    try {
      if (this.isDev) {
        // electron-vite sets ELECTRON_RENDERER_URL; both Vite and webpack use index.html
        // Retry logic: Chromium network service can crash transiently on startup (ERR_FAILED -2)
        const maxRetries = 5;
        const retryDelayMs = 1000;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await this.mainWindow.loadURL(DEV_SERVER_URL);
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
            const msg = err instanceof Error ? err.message : String(err);
            getAdvancedLogger().warn(`[createWindow] loadURL attempt ${attempt}/${maxRetries} failed: ${msg}`, 'main');
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
          }
        }

        if (lastError) {
          throw lastError;
        }
      } else {
        // Production mode: load from built files
        const htmlPath = path.join(__dirname, '../renderer/index.html');

        if (!fs.existsSync(htmlPath)) {
          // Load a simple fallback page
          await this.mainWindow.loadURL('data:text/html,<html><body><h1>OpenKosmos App</h1><p>HTML file not found. Please run: npm run build</p></body></html>');
        } else {
          await this.mainWindow.loadFile(htmlPath);
        }
      }
    } catch (error) {
      // Load error page
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.mainWindow.loadURL('data:text/html,<html><body><h1>OpenKosmos App - Error</h1><p>Failed to load: ' + errorMessage + '</p></body></html>');
    }
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  private async initSelectionHook(): Promise<void> {
    const logger = getAdvancedLogger();

    if( this.selectionHook) {
      return;
    }

    try {
      const selectionHook = new SelectionHook();

      selectionHook.on('text-selection', (selection: TextSelectionData) => {
        logger.info('[SELECTION-HOOK] Text selection event received:' + selection.text);
        if (selection && selection.text && selection.text.length > 0 && selection.text.length < 20000) {
          this.selectedText = recoverSelectionText(selection.text.trim());
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
      logger.warn(`[SELECTION-HOOK] Failed to initialize selection-hook: ${error instanceof Error ? error.message : String(error)}`);
      // If selection-hook initialization fails, set to null, fall back to clipboard approach
      this.selectionHook = null;
    }
  }

  /**
   * Safely clean up SelectionHook instance
   * Prevent crash during app exit
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
        // Ignore errors during cleanup to avoid crash
        safeConsole.warn('[SELECTION-HOOK] Error during cleanup (ignored):', error);
        this.selectionHook = null;
      }
    }
  }

  /**
   * Capture user-selected text
   * Strategy: three-tier fallback strategy
   * 1. selection-hook native module (recommended, directly reads system selected text)
   * 2. Electron clipboard API (fallback, requires user to manually copy)
   * 3. Exception fault tolerance handling
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
               this.selectedText = recoverSelectionText(selection.text.trim());
               logger.info('[SELECTION-HOOK] Active capture success: ' + this.selectedText.substring(0, 50) + '...');
           }
        }
      } catch (e) {
         // logger.warn('[SELECTION-HOOK] Active capture failed, falling back to cached event data', e);
      }
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
            `../../brands/openkosmos/assets/win/app.ico`,
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
        // electron-vite sets ELECTRON_RENDERER_URL; both Vite and webpack use index.html
        await this.debugWindow.loadURL(DEV_SERVER_URL);

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
      safeConsole.error('Failed to perform web search:', error);
      return { success: false, error: String(error) };
    }
  }

  private normalizeWindowZoomLevel(level: number): number {
    const zoomStep = 0.5;
    const zoomMin = -3;
    const zoomMax = 3;
    const rounded = Math.round(level / zoomStep) * zoomStep;
    return Math.min(zoomMax, Math.max(zoomMin, rounded));
  }

  private async getPersistedWindowZoomLevel(): Promise<number> {
    const acm = await getAppCacheManager();
    const zoomLevel = acm.getConfig().zoomLevel;
    return typeof zoomLevel === 'number' ? this.normalizeWindowZoomLevel(zoomLevel) : 0;
  }

  private applyWindowZoomLevel(level: number): number {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return 0;
    }

    const next = this.normalizeWindowZoomLevel(level);
    this.mainWindow.webContents.setZoomLevel(next);
    this.mainWindow.webContents.send('window:zoomChanged', next);
    return next;
  }

  private async persistWindowZoomLevel(level: number): Promise<void> {
    try {
      const acm = await getAppCacheManager();
      await acm.updateConfig({ zoomLevel: level });
    } catch (e) {
      safeConsole.error('[Zoom] Failed to persist zoom level:', e);
    }
  }

  private async stepWindowZoomLevel(delta: number): Promise<number> {
    const current = await this.getPersistedWindowZoomLevel();
    const next = this.normalizeWindowZoomLevel(current + delta);
    this.applyWindowZoomLevel(next);
    void this.persistWindowZoomLevel(next);
    return next;
  }

  private async resetWindowZoomLevel(): Promise<number> {
    const next = this.applyWindowZoomLevel(0);
    void this.persistWindowZoomLevel(next);
    return next;
  }

  private getDebugInfoTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  private async addPathToZip(zip: JSZip, sourcePath: string, zipPrefix: string, redact?: (s: string) => string): Promise<void> {
    if (!fs.existsSync(sourcePath)) {
      return;
    }

    const stats = await fs.promises.stat(sourcePath);
    if (stats.isDirectory()) {
      const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true });
      if (entries.length === 0) {
        zip.folder(zipPrefix);
        return;
      }

      await Promise.all(entries.map(async (entry) => {
        const childSourcePath = path.join(sourcePath, entry.name);
        const childZipPath = `${zipPrefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await this.addPathToZip(zip, childSourcePath, childZipPath, redact);
          return;
        }

        if (entry.isFile()) {
          if (redact && isTextFile(entry.name)) {
            const text = await fs.promises.readFile(childSourcePath, 'utf-8');
            zip.file(childZipPath, redactFileContent(text, childZipPath, redact));
          } else {
            const content = await fs.promises.readFile(childSourcePath);
            zip.file(childZipPath, content);
          }
        }
      }));
      return;
    }

    if (stats.isFile()) {
      if (redact && isTextFile(sourcePath)) {
        const text = await fs.promises.readFile(sourcePath, 'utf-8');
        zip.file(zipPrefix, redactFileContent(text, zipPrefix, redact));
      } else {
        const content = await fs.promises.readFile(sourcePath);
        zip.file(zipPrefix, content);
      }
    }
  }

  private async exportDebugInfo(): Promise<{ success: boolean; filePath?: string; fileName?: string; error?: string }> {
    try {
      const logger = getAdvancedLogger();
      if (logger && typeof logger.flushToDisk === 'function') {
        await logger.flushToDisk();
      }

      const downloadsDir = app.getPath('downloads');
      const timestamp = this.getDebugInfoTimestamp();
      let fileName = `debug-${timestamp}.zip`;
      let filePath = path.join(downloadsDir, fileName);
      let suffix = 1;

      while (fs.existsSync(filePath)) {
        fileName = `debug-${timestamp}-${suffix}.zip`;
        filePath = path.join(downloadsDir, fileName);
        suffix += 1;
      }

      const zip = new JSZip();
      const redact = createRedactor({ userAlias: this.currentUserAlias });
      const exportedAt = new Date().toISOString();
      const crashStatus = crashCaptureManager.getStatus();
      const crashBundleNames = fs.existsSync(crashStatus.crashRootDir)
        ? fs.readdirSync(crashStatus.crashRootDir).filter((entry) => {
            try {
              return fs.statSync(path.join(crashStatus.crashRootDir, entry)).isDirectory();
            } catch {
              return false;
            }
          })
        : [];

      const manifestJson = JSON.stringify(buildDebugInfoManifest({
        appName: app.getName(),
        appVersion: app.getVersion(),
        exportedAt,
        platform: process.platform,
        arch: process.arch,
        crashStatus,
        crashBundleNames,
      }), null, 2);
      zip.file('manifest.json', redact(manifestJson));

      for (const entry of getDebugInfoEntries(
        app.getPath('userData'),
        app.getPath('crashDumps'),
        this.currentUserAlias,
      )) {
        await this.addPathToZip(zip, entry.sourcePath, entry.zipPath, redact);
      }

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      await fs.promises.writeFile(filePath, buffer);

      return {
        success: true,
        filePath,
        fileName,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export debug info',
      };
    }
  }

  private notifyDebugInfoDownload(result: { success: boolean; filePath?: string; fileName?: string; error?: string }): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send('app:debugInfoDownloaded', result);
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
                await useAdvancedLogger(logger => logger.flushToDisk());
              } catch (error) {}
            },
          },
          {
            label: 'Download Debug Info',
            click: async () => {
              const result = await this.exportDebugInfo();
              this.notifyDebugInfoDownload(result);
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
          {
            label: 'Actual Size',
            accelerator: 'CmdOrCtrl+0',
            click: async () => {
              await this.resetWindowZoomLevel();
            },
          },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+=',
            click: async () => {
              await this.stepWindowZoomLevel(0.5);
            },
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: async () => {
              await this.stepWindowZoomLevel(-0.5);
            },
          },
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
const electronApp = hasSingleInstanceLock ? new ElectronApp() : null;

// Export for potential use in other modules
export default electronApp;
