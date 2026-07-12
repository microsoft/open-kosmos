import { ipcMain, shell } from 'electron';

import { safeConsole } from '../../lib/utilities/safeConsole';
import { createLogger } from '../../lib/unifiedLogger';
import { getProfileCacheManager } from '../lazy';
import type { Context } from './shared';
import { mcpClientManager } from "../../lib/mcpRuntime/mcpClientManager";
import { chatSessionStore } from "../../lib/chat/chatSessionStore";
import { AgentChatManager } from "../../lib/chat/agentChatManager";
import { chatSessionManager } from "../../lib/userDataADO/chatSessionManager";
import { schedulerManager } from '../../lib/scheduler/SchedulerManager';
import { getEmbeddedBrowserManager } from '../../lib/embeddedBrowser/EmbeddedBrowserManager';
import { getPermissionStatus } from '../../lib/computerUse/permissions';
import { getComputerUsePlatformSupport, getComputerUseUnsupportedReason } from '../../lib/computerUse/platformSupport';
import { normalizeComputerUseSettingsPatch } from '../../lib/userDataADO/profileSettingsCrud';
import { mcpConfigManager } from '../../lib/userDataADO/mcpConfigManager';
import { skillsConfigManager } from '../../lib/userDataADO/skillsConfigManager';
import { hooksConfigManager } from '../../lib/userDataADO/hooksConfigManager';
import { reinjectInlineChatAgents } from '../../lib/userDataADO/profileNotificationHelpers';

const logger = createLogger();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export default function(ctx: Context) {
  // ProfileCacheManager Data Operations - AUTHORIZED
  ipcMain.handle('profile:getProfile', async (event, alias: string) => {
    try {
      const pcManager = await getProfileCacheManager();
      const profile = pcManager.getCachedProfile(alias);
      if (profile) {
        // Force a notification to frontend to sync current state
        await pcManager.forceNotifyProfileDataManager(alias);
        // Re-inject the manager-owned installed MCP servers, global skill registry, and
        // global Agent Hook library so this IPC read carries the same wire shape as the
        // profile:cacheUpdated push. The cached profile no longer carries mcp_servers,
        // skills, or hooks (owned by McpConfigManager, SkillsConfigManager, and
        // HooksConfigManager respectively); the renderer getProfile fallback
        // (profileDataManager.initialize) forwards mcp_servers to mcpClientCacheManager and
        // applies skills/hooks, so without these the renderer can initialize with an empty
        // server set, skill list, or Hook library if the push races.
        //
        // Chats are also re-hydrated with their inline agents. The cached profile holds
        // agent_ids only; the push warms the renderer agent cache (agents:changed) before
        // the agent_ids-only profile, but this direct return has no such ordering guarantee,
        // so a fallback applied against a cold cache would resolve no agent. Re-injecting the
        // inline agents keeps the fallback self-sufficient (symmetric with the slices above).
        const withInlineAgents = reinjectInlineChatAgents(profile, pcManager.getRegisteredAgents(alias));
        return {
          success: true,
          data: {
            ...withInlineAgents,
            mcp_servers: mcpConfigManager.getServers(alias),
            skills: skillsConfigManager.getSkills(alias),
            hooks: hooksConfigManager.getHooks(alias),
          },
        };
      } else {
        return { success: false, error: 'Profile not found' };
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Normalized renderer cache pulls (Phase 1 of renderer normalization, see
  // docs/sidecar-renderer-normalization-tech-doc.md). Each returns the current
  // in-memory set for an alias so the agent/skill/hook ClientCacheManager can
  // seed itself on init, mirroring mcp:getServerStatus. The push counterparts
  // are agents:changed / skills:changed / hooks:changed from performNotification.
  ipcMain.handle('agents:getAll', async (event, alias: string) => {
    try {
      const pcManager = await getProfileCacheManager();
      return { success: true, data: pcManager.getRegisteredAgents(alias) };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('skills:getAll', async (event, alias: string) => {
    try {
      return { success: true, data: skillsConfigManager.getSkills(alias) };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('hooks:getAll', async (event, alias: string) => {
    try {
      return { success: true, data: hooksConfigManager.getHooks(alias) };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // ProfileCacheManager Primary Chat Operations - AUTHORIZED
  ipcMain.handle('profile:setPrimaryChat', async (event, chatId: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updatePrimaryChat(ctx.currentUserAlias, chatId);
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // ProfileCacheManager FRE (First Run Experience) Operation - AUTHORIZED
  ipcMain.handle('profile:updateFreDone', async (event, alias: string, freDone: boolean) => {
    try {
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updateFreDone(alias, freDone);
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:updateConfirmationSettings', async (event, alias: string, settings: any) => {
    try {
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updateConfirmationSettings(alias, settings);
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:updateBrowserSettings', async (_event, alias: string, settings: any) => {
    try {
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updateBrowserSettings(alias, settings);
      // Tear down any live embedded-browser views when the feature is turned off.
      if (success && settings?.enabled === false) {
        getEmbeddedBrowserManager()?.destroyAll();
      }
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:updateMemexSettings', async (_event, alias: string, settings: any) => {
    try {
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updateMemexSettings(alias, settings);
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:updateComputerUseSettings', async (_event, alias: string, settings: any) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      if (alias !== ctx.currentUserAlias) {
        return { success: false, error: 'Computer Use settings can only be updated for the current profile' };
      }
      const normalizedSettings = normalizeComputerUseSettingsPatch(settings);
      if (!normalizedSettings) {
        return { success: false, error: 'Invalid Computer Use settings' };
      }
      if (normalizedSettings.enabled === true) {
        const unsupportedReason = getComputerUseUnsupportedReason();
        if (unsupportedReason) {
          return { success: false, error: unsupportedReason };
        }
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updateComputerUseSettings(ctx.currentUserAlias, normalizedSettings);
      if (success) {
        // Re-advertise or hide the computer_use builtin tool immediately so toggling
        // the master switch takes effect within the running session instead of only
        // after a relaunch (see computerUse/ai.prompt.md). Best-effort: a refresh
        // failure must not flip the already-persisted save result to failure.
        try {
          await mcpClientManager.refreshBuiltinTools();
        } catch (refreshError) {
          logger.error('[profile:updateComputerUseSettings] refreshBuiltinTools failed', 'profile:updateComputerUseSettings', {
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          });
        }
      }
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Report macOS Screen Recording + Accessibility status to the Settings surface so the
  // user can see what is still required and jump to grant it (PRD: "OS permission status
  // + prompts"). `prompt: true` triggers the Accessibility system dialog and deep-links to
  // the Screen Recording pane; `prompt: false` is a passive read for rendering status.
  ipcMain.handle('computerUse:getPermissionStatus', async (_event, prompt?: boolean) => {
    try {
      const status = { ...getPermissionStatus(prompt === true), ...getComputerUsePlatformSupport() };
      if (prompt === true && status.screenRecording !== 'granted') {
        // Screen Recording has no programmatic prompt (unlike Accessibility, which
        // getPermissionStatus(true) triggers), so open the macOS System Settings pane
        // directly. Best-effort: failing to open must not fail the status read.
        try {
          await shell.openExternal(
            'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
          );
        } catch (openError) {
          logger.error('[computerUse:getPermissionStatus] openExternal failed', 'computerUse:getPermissionStatus', {
            error: openError instanceof Error ? openError.message : String(openError),
          });
        }
      }
      return { success: true, status };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });
  // 🆕 Refactor: call mcpClientManager directly, no longer through profileCacheManager
  ipcMain.handle('profile:addMcpServer', async (event, serverName: string, serverConfig: any) => {
    try {
      await mcpClientManager.add(serverName, serverConfig);

      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:updateMcpServer', async (event, serverName: string, serverConfig: any) => {
    try {
      await mcpClientManager.update(serverName, serverConfig);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:deleteMcpServer', async (event, serverName: string) => {
    try {
      await mcpClientManager.delete(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:connectMcpServer', async (event, serverName: string) => {
    try {
      await mcpClientManager.connect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:reconnectMcpServer', async (event, serverName: string) => {
    try {
      await mcpClientManager.reconnect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:disconnectMcpServer', async (event, serverName: string) => {
    try {
      await mcpClientManager.disconnect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // ProfileCacheManager ChatConfig Operations - AUTHORIZED
  ipcMain.handle('profile:duplicateChatConfig', async (event, sourceChatId: string, newAgentName: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      if (typeof sourceChatId !== 'string' || !sourceChatId.trim()) {
        return { success: false, error: 'Invalid source chat ID' };
      }
      if (typeof newAgentName !== 'string' || !newAgentName.trim()) {
        return { success: false, error: 'Invalid agent name' };
      }
      const pcManager = await getProfileCacheManager();
      const { duplicateAgent } = await import('../../lib/userDataADO/agentDuplicator');
      const result = await duplicateAgent(pcManager, ctx.currentUserAlias, sourceChatId.trim(), newAgentName.trim());

      return result;
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:addChatConfig', async (event, chatConfig: any) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.addChatConfig(ctx.currentUserAlias, chatConfig);

      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:updateChatConfig', async (event, chatId: string, chatConfig: any) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updateChatConfig(ctx.currentUserAlias, chatId, chatConfig);
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:deleteChatConfig', async (event, chatId: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.deleteChatConfig(ctx.currentUserAlias, chatId);

      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:archiveChatConfig', async (event, chatId: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.archiveChatConfig(ctx.currentUserAlias, chatId);
      if (success) {
        schedulerManager.toggleJobsByAgent(chatId, false).catch((err) => {
          safeConsole.warn('[profile:archiveChatConfig] Failed to disable scheduled jobs', chatId, err);
        });
      }
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:unarchiveChatConfig', async (event, chatId: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const result = await pcManager.unarchiveChatConfig(ctx.currentUserAlias, chatId);
      if (result.success) {
        schedulerManager.toggleJobsByAgent(chatId, true).catch((err) => {
          safeConsole.warn('[profile:unarchiveChatConfig] Failed to re-enable scheduled jobs', chatId, err);
        });
      }
      return result;
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:getArchivedAgents', async () => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const data = pcManager.getArchivedAgents(ctx.currentUserAlias);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:getChatConfig', async (event, chatId: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const chatConfig = pcManager.getChatConfig(ctx.currentUserAlias, chatId);
      return { success: true, data: chatConfig };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:getAllChatConfigs', async () => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const chatConfigs = pcManager.getAllChatConfigs(ctx.currentUserAlias);
      return { success: true, data: chatConfigs };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:updateChatAgent', async (event, chatId: string, agentUpdates: any) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updateChatAgent(ctx.currentUserAlias, chatId, agentUpdates);
      return { success };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // ProfileCacheManager ChatSession Operations - AUTHORIZED (Updated to support new frontend coordination layer)

  ipcMain.handle('profile:saveChatSession', async (event, alias: string, chatId: string, chatSessionFile: any) => {
    try {
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.saveChatSession(alias, chatId, chatSessionFile);
      if (!success) {
        return { success: false, error: 'Failed to save chat session' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // renameChatSession - rename ChatSession title through ChatSessionStore
  ipcMain.handle('profile:renameChatSession', async (event, alias: string, chatId: string, sessionId: string, newTitle: string) => {
    try {
      const result = await chatSessionStore.renameSession(alias, chatId, sessionId, newTitle);
      if (!result) {
        return { success: false, error: 'Failed to rename chat session' };
      }

      AgentChatManager.getInstance().updateSessionTitle(sessionId, newTitle);

      const pcManager = await getProfileCacheManager();
      await pcManager.syncStarredChatSessionIndex(alias, chatId, result.metadata, { notifyRenderer: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:setChatSessionStarred', async (event, alias: string, chatId: string, sessionId: string, starred: boolean) => {
    try {
      const result = await chatSessionStore.setStarred(alias, chatId, sessionId, starred);
      if (!result) {
        return { success: false, error: 'Failed to update chat session star state' };
      }

      const pcManager = await getProfileCacheManager();
      await pcManager.syncStarredChatSessionIndex(alias, chatId, result.metadata, { notifyRenderer: true });

      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // deleteChatSession - supports new parameter format (alias, chatId, sessionId)
  ipcMain.handle('profile:deleteChatSession', async (event, alias: string, chatId: string, sessionId: string) => {
    try {
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.deleteChatSession(alias, chatId, sessionId);
      if (!success) {
        return { success: false, error: 'Failed to delete chat session' };
      }

      try {
        getEmbeddedBrowserManager()?.destroySession(sessionId);
      } catch (browserErr) {
        safeConsole.warn('[main] Failed to clean embedded browser session state (non-fatal):', String(browserErr));
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // getChatSessionFile - get complete ChatSession file data (alias, chatId, sessionId)
  // 🔥 New architecture: chatId parameter required to locate ChatSession file
  ipcMain.handle('profile:getChatSessionFile', async (event, alias: string, chatId: string, sessionId: string) => {
    try {
      const pcManager = await getProfileCacheManager();
      const sessionFile = await pcManager.getChatSessionFile(alias, chatId, sessionId);
      return { success: true, data: sessionFile };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // getChatSessions - 🔥 New architecture: fetch from independent chat_sessions directory structure (paginated loading)
  // Initial load: start from most recent month, load until reaching minCount or all loaded
  ipcMain.handle('profile:getChatSessions', async (event, alias: string, chatId: string, minCount: number = 10) => {
    try {
      // Use new chatSessionManager to fetch from independent directory structure (supports pagination)
      const result = await chatSessionManager.getChatSessions(alias, chatId, minCount);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // getMoreChatSessions - 🔥 New architecture: scroll to load more ChatSessions (one month at a time)
  ipcMain.handle('profile:getMoreChatSessions', async (event, alias: string, chatId: string, fromMonthIndex: number) => {
    try {
      const result = await chatSessionManager.getMoreChatSessions(alias, chatId, fromMonthIndex);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // getAllScheduledSessions - Get all scheduler sessions for a chat with pagination
  ipcMain.handle('profile:getAllScheduledSessions', async (event, alias: string, chatId: string, options?: { limit?: number; offset?: number }) => {
    try {
      const result = await chatSessionManager.getAllScheduledSessions(alias, chatId, options);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('profile:getChatUnreadSummary', async (event, alias: string, chatId: string) => {
    try {
      const summary = await chatSessionStore.getUnreadSummary(alias, chatId);
      return { success: true, data: summary };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });
}