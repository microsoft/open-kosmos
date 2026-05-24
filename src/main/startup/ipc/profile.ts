import { ipcMain } from 'electron';

import { safeConsole } from '../../lib/utilities/safeConsole';
import { getProfileCacheManager } from '../lazy';
import type { Context } from './shared';
import { mcpClientManager } from "../../lib/mcpRuntime/mcpClientManager";
import { chatSessionStore } from "../../lib/chat/chatSessionStore";
import { AgentChatManager } from "../../lib/chat/agentChatManager";
import { chatSessionManager } from "../../lib/userDataADO/chatSessionManager";
import { schedulerManager } from '../../lib/scheduler/SchedulerManager';

export default function(ctx: Context) {
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
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updatePrimaryAgent(ctx.currentUserAlias, agentName);
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

  ipcMain.handle('profile:updateConfirmationSettings', async (event, alias: string, settings: any) => {
    try {
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.updateConfirmationSettings(alias, settings);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ProfileCacheManager MCP Operations - AUTHORIZED
  // 🆕 Refactor: call mcpClientManager directly, no longer through profileCacheManager
  ipcMain.handle('profile:addMcpServer', async (event, serverName: string, serverConfig: any) => {
    try {
      await mcpClientManager.add(serverName, serverConfig);

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('profile:updateMcpServer', async (event, serverName: string, serverConfig: any) => {
    try {
      await mcpClientManager.update(serverName, serverConfig);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('profile:deleteMcpServer', async (event, serverName: string) => {
    try {
      await mcpClientManager.delete(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('profile:connectMcpServer', async (event, serverName: string) => {
    try {
      await mcpClientManager.connect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('profile:reconnectMcpServer', async (event, serverName: string) => {
    try {
      await mcpClientManager.reconnect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('profile:disconnectMcpServer', async (event, serverName: string) => {
    try {
      await mcpClientManager.disconnect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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

      if (result.success) {
        // Notify memex manager of new agent (fire-and-forget)
        if (ctx._memexManager && result.newChatId) {
          ctx._memexManager.onAgentCreated(result.newChatId).catch(() => {});
        }
      }

      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('profile:addChatConfig', async (event, chatConfig: any) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.addChatConfig(ctx.currentUserAlias, chatConfig);

      if (success) {
        // Notify memex manager of new agent (fire-and-forget)
        if (ctx._memexManager) {
          ctx._memexManager.onAgentCreated(chatConfig.chat_id).catch(() => {});
        }
      }

      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('profile:deleteChatConfig', async (event, chatId: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const success = await pcManager.deleteChatConfig(ctx.currentUserAlias, chatId);

      // Notify memex manager of agent deletion (fire-and-forget)
      if (success && ctx._memexManager) {
        ctx._memexManager.onAgentDeleted(chatId).catch(() => {});
      }

      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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

      // Remote channel notification removed (integration deleted)

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // getMoreChatSessions - 🔥 New architecture: scroll to load more ChatSessions (one month at a time)
  ipcMain.handle('profile:getMoreChatSessions', async (event, alias: string, chatId: string, fromMonthIndex: number) => {
    try {
      const result = await chatSessionManager.getMoreChatSessions(alias, chatId, fromMonthIndex);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('profile:getChatUnreadSummary', async (event, alias: string, chatId: string) => {
    try {
      const summary = await chatSessionStore.getUnreadSummary(alias, chatId);
      return { success: true, data: summary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}