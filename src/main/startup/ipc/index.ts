import { app, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { registerCodingCliIPC } from '../../lib/codingCli/codingCliIPC';
import { initEmbeddedBrowserManager } from '../../lib/embeddedBrowser/EmbeddedBrowserManager';
import { registerEmbeddedBrowserIPC } from '../../lib/embeddedBrowser/embeddedBrowserIPC';
import { setupMemex } from '../../lib/memex/memexIPC';
import { registerSyncIPC } from '../../lib/sync/syncIPC';
import { registerSchedulerIPC } from '../../lib/scheduler/SchedulerIPC';
import { registerAgentHooksIPC } from '../../lib/agentHooks/agentHooksIpc';
import { registerBuddyIPC } from '../../lib/buddy/BuddyIPC';
import { createLogger } from '../../lib/unifiedLogger';
import { safeConsole } from '../../lib/utilities/safeConsole';
import { isFeatureEnabled, featureFlagManager } from "../../lib/featureFlags";
import {
  getProfileCacheManager,
  getAppCacheManager,
  getTerminalManagerInstance,
  getAdvancedLogger,
  useAdvancedLogger,
} from '../lazy';

import type { Context } from './shared';

import handleAppIPC from './app';
import handleSigninIPC from './signin';
import handleAuthIPC from './auth';
import handleProfileIPC from './profile';
import handleSubAgentIPC from './sub-agent';
import handleMcpIPC from './mcp';
import handleSkillIPC from './skill';
import handleAgentChatIPC from './agent-chat';
import handleAgentChatSteeringIPC from './agent-chat-steering';
import handleFsIPC from './fs';
import handleWorkspaceIPC from './workspace';
import handleLlmIPC from './llm';
import handleWhisperIPC from './whisper';
import handleWindowIPC from './window';
import handleChatSessionIPC from './chat-session';
import { registerRendererLogIPC } from './renderer-log';

import { registerExternalAgentIPC } from '../../lib/externalAgent/externalAgentIPC';
import { openkosmosPlaceholderManager } from "../../lib/userDataADO/openkosmosPlaceholders";
import { userInputPlaceholderParser } from "../../lib/userDataADO/userInputPlaceholderParser";
import { getBuiltinToolsManager } from "../../lib/mcpRuntime/builtinTools/builtinToolsManager";
import { nativeModuleManager } from "../../lib/nativeModules";
import { RuntimeManager } from '../../lib/runtime/RuntimeManager';

const logger = createLogger();

export function setUpIPC(ctx: Context) {
  // 🔥 Fix: add cleanup handling before app exit
  app.on('before-quit', (event) => {
    try {
      // Ensure SelectionHook is properly cleaned up before app exit
      ctx.cleanupSelectionHook();
    } catch (error) {
      // Ignore cleanup errors to avoid preventing app exit
      safeConsole.warn('[APP-EXIT] Error during SelectionHook cleanup:', error);
    }
  });

  app.on('will-quit', (event) => {
    try {
      // Last chance to clean up SelectionHook
      ctx.cleanupSelectionHook();
    } catch (error) {
      // Ignore cleanup errors, ensure app can exit normally
      safeConsole.warn('[APP-EXIT] Final cleanup error (ignored):', error);
    }
  });
  app.on('before-quit', ctx.onBeforeQuit);

  handleAppIPC(ctx);
  handleSigninIPC(ctx);
  handleAuthIPC(ctx);
  handleProfileIPC(ctx);
  handleSubAgentIPC(ctx);
  handleMcpIPC(ctx);
  handleSkillIPC(ctx);
  handleAgentChatIPC(ctx);
  handleAgentChatSteeringIPC(ctx);
  handleFsIPC(ctx);
  handleWorkspaceIPC(ctx);
  handleLlmIPC(ctx);
  handleWhisperIPC(ctx);
  handleWindowIPC(ctx);
  handleChatSessionIPC(ctx);
  registerAgentHooksIPC(ctx);
  // This will register runtime ipc hanles
  RuntimeManager.getInstance();

  // OpenKosmos Placeholder Operations - handle @OPENKOSMOS_ placeholder variable substitution
  ipcMain.handle('openkosmos:replacePlaceholders', async (event, envObj: Record<string, string>) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      const result = openkosmosPlaceholderManager.replacePlaceholdersInObject(
        envObj,
        { alias: ctx.currentUserAlias }
      );
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // USER_INPUT Placeholder Operations - parse @USER_INPUT_ placeholder variables
  ipcMain.handle('openkosmos:parseUserInputPlaceholders', async (event, config: any) => {
    try {
      const result = userInputPlaceholderParser.parseConfig(config);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Builtin Tools - AUTHORIZED
  ipcMain.handle('builtinTools:execute', async (event, toolName: string, args: any) => {
    try {
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


  // Main window control (called by ToolBar)
  ipcMain.handle('mainWindow:show', () => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      if (ctx.mainWindow.isMinimized()) {
        ctx.mainWindow.restore();
      }
      ctx.mainWindow.show();
      ctx.mainWindow.focus();
      return { success: true };
    }
    return { success: false, error: 'Main window not available' };
  });

  ipcMain.handle('mainWindow:focus', () => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.focus();
      return { success: true };
    }
    return { success: false, error: 'Main window not available' };
  });

  ipcMain.handle('mainWindow:navigate', (event, route: string, state?: any) => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      // Notify main window renderer process to navigate
      ctx.mainWindow.webContents.send('navigate:to', { route, state });
      return { success: true };
    }
    return { success: false, error: 'Main window not available' };
  });

  ipcMain.handle(
    'mainWindow:showWithAgent',
    async (event, chatId: string) => {
      // Handle Search Pseudo Agent
      if (chatId && chatId.startsWith('pseudo-agent-search-')) {
        return ctx.handleWebSearch(chatId);
      }

      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
        // 1. Restore/show main window
        if (ctx.mainWindow.isMinimized()) {
          ctx.mainWindow.restore();
        }
        ctx.mainWindow.show();
        ctx.mainWindow.focus();

        // 2. Navigate to the chat route with selected text
        const selectedText = ctx.selectedText;
        const route = `/agent/chat/${chatId}`;

        ctx.mainWindow.webContents.send('navigate:to', {
          route,
          state: { selectedText },
        });

        // 3. Auto-hide ToolBar (configurable)
        if (ctx.getToolBarAutoHide()) {
          ctx.hideToolBar();
        }

        return { success: true };
      }
      return { success: false, error: 'Main window not available' };
    },
  );

  // Scheduler Management - IPC handlers are always registered;
  // UI visibility is controlled by feature flag on the renderer side.
  registerSchedulerIPC();

  // Buddy Companion - IPC handlers are always registered;
  // UI visibility is controlled by feature flag on the renderer side.
  registerBuddyIPC();

  // Coding CLI - profile-level setting for the coding_agent built-in tool.
  // Handlers always register; the feature is controlled by the per-profile master switch
  // (codingAgentSettings.enabled) surfaced in Settings → Coding CLI.
  registerCodingCliIPC({ getAlias: () => ctx.currentUserAlias });

  // In-app browser side panel (opens chat-message links inside the app, and is
  // driven by the agent-facing `browser` built-in tool). Store the manager in a
  // module singleton so that tool — which runs outside this startup closure —
  // can reach the same live instance via getEmbeddedBrowserManager().
  {
    const embeddedBrowserManager = initEmbeddedBrowserManager(() => ctx.mainWindow);
    registerEmbeddedBrowserIPC(embeddedBrowserManager);
  }

  // Memex Memory — read IPC for the active chat's primary agent memory sidepane.
  // Handlers always register; each call gates on profile.json `memex.enabled`.
  // The agent mutates memory via `memex_memory`; this only serves renderer reads.
  setupMemex(ctx);

  // ============== Sync IPC Handlers ==============
  registerSyncIPC({
    getProfileCacheManager,
    getTerminalManager: getTerminalManagerInstance,
    getCurrentAlias: () => ctx.currentUserAlias || 'default',
  });

  // Logger management
  ipcMain.handle('logger:manualFlush', async () => {
    try {
      await useAdvancedLogger((logger) => logger.flushToDisk());
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Handle structured logs from Renderer process (sent via IPC instead of console.log)
  registerRendererLogIPC();

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


  // Debug window handlers
  ipcMain.handle('debug:openWindow', async () => {
    try {
      await ctx.createDebugWindow();
      return { success: true };
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
      const flags = featureFlagManager.getAllFlagsValues();
      return { success: true, data: flags };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Check if a single feature flag is enabled
  ipcMain.handle('featureFlags:isEnabled', async (event, flagName: string) => {
    try {
      const isEnabled = featureFlagManager.isEnabled(flagName as any);
      return { success: true, data: isEnabled };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });



  // ====================================================
  // NativeModule on-demand download IPC handlers
  // Manage download of large native modules such as whisper-node-addon / sherpa-onnx
  // ====================================================

  // Get module status
  ipcMain.handle('native-module:getStatus', async (_, moduleKey: string) => {
    try {
      const info = nativeModuleManager.getStatus(moduleKey);
      return { success: true, data: info };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Trigger download (async, progress pushed via IPC)
  ipcMain.handle('native-module:ensureDownloaded', async (_, moduleKey: string) => {
    try {
      const localPath = await nativeModuleManager.ensureDownloaded(moduleKey);
      return { success: true, data: { localPath } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Cancel download
  ipcMain.handle('native-module:cancelDownload', async (_, moduleKey: string) => {
    try {
      nativeModuleManager.cancelDownload(moduleKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Delete downloaded module (free disk space)
  ipcMain.handle('native-module:delete', async (_, moduleKey: string) => {
    try {
      nativeModuleManager.deleteModule(moduleKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // External Agent IPC handlers
  registerExternalAgentIPC();
}
