import { ipcMain, dialog } from 'electron';
import type { Message, UserMessage } from '@shared/types/chatTypes';

import { getAdvancedLogger } from '../lazy';
import type { Context } from './shared';
import { agentChatManager } from "../../lib/chat/agentChatManager";
import { importChatSessionFromFile } from "../../lib/userDataADO/index";
import { interactiveRequestManager } from "../../lib/chat/interactiveRequestManager";

export default function(ctx: Context) {
  // Initialize AgentChatManager
  ipcMain.handle('agentChat:initialize', async (event, alias: string) => {
    try {

      // Note: mainWindow reference has been set in window ready-to-show event
      await agentChatManager.initialize(alias);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get current AgentChat instance info
  ipcMain.handle('agentChat:getCurrentInstance', async () => {
    try {
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
      const messages = agentChatManager.getChatHistory();
      return { success: true, data: messages };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 🔥 New:Get messages for display (Custom System Prompt + chatHistory)
  ipcMain.handle('agentChat:getDisplayMessages', async () => {
    try {
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

  // 🔥 IPC handler for starting new conversation for specified ChatId
  ipcMain.handle('agentChat:startNewChatFor', async (event, chatId: string, _options?: unknown) => {
    try {
      const instance = await agentChatManager.startNewChatFor(chatId);
      return instance ? { success: true, chatSessionId: instance.getChatSessionId() } : { success: false };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Process conversation (with streaming support)
  ipcMain.handle('agentChat:streamMessage', async (event, message: UserMessage, targetChatSessionId?: string) => {
    try {
      // Resolve which session to use: explicit target > current active
      const effectiveChatSessionId = targetChatSessionId || agentChatManager.getCurrentActiveChatSessionId();
      if (!effectiveChatSessionId) {
        return { success: false, error: 'No current chat session ID' };
      }

      const instance = targetChatSessionId
        ? agentChatManager.getInstanceByChatSessionId(targetChatSessionId)
        : agentChatManager.getCurrentInstance();

      if (!instance) {
        return { success: false, error: 'No current agent instance' };
      }

      const currentStatus = instance.getChatStatus();
      if (currentStatus !== 'idle') {
        return {
          success: false,
          error: `Cannot send a new message while chat status is ${currentStatus}`,
        };
      }

      // 🔥 New:Set eventSender so AgentChat can send events to renderer process
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

      // Set streaming callback
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

      const result = await agentChatManager.streamMessage(effectiveChatSessionId, message);

      // 🔥 New:Clear eventSender after processing is complete
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

      // Use the provided chatSessionId, fall back to current active session if not provided
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

  ipcMain.handle('agentChat:editUserMessage', async (event, chatSessionId: string, messageId: string, updatedMessage: Message) => {
    let instance: any = null;
    try {

      const targetChatSessionId = chatSessionId || agentChatManager.getCurrentActiveChatSessionId();
      if (!targetChatSessionId) {
        return { success: false, error: 'No chat session ID provided' };
      }

      instance = agentChatManager.getInstanceByChatSessionId(targetChatSessionId);
      if (!instance) {
        return { success: false, error: `No agent instance found for session: ${targetChatSessionId}` };
      }

      instance.setEventSender(event.sender);
      const result = await agentChatManager.editUserMessage(targetChatSessionId, messageId, updatedMessage);
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      instance?.setEventSender?.(null);
    }
  });

  ipcMain.handle('agentChat:canEditUserMessage', async (_event, chatSessionId: string, messageId: string) => {
    try {

      const targetChatSessionId = chatSessionId || agentChatManager.getCurrentActiveChatSessionId();
      if (!targetChatSessionId) {
        return { success: false, error: 'No chat session ID provided' };
      }

      return agentChatManager.canEditUserMessage(targetChatSessionId, messageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Cancel chat operation (using current active chatSession)
  ipcMain.handle('agentChat:cancelChat', async (event, chatId: string) => {
    try {
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
      agentChatManager.syncChatHistory(messages);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get current Chat ID
  ipcMain.handle('agentChat:getCurrentChatId', async () => {
    try {
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
  // 🔥 New:Switch to specified ChatSessionId (new architecture)
  ipcMain.handle('agentChat:switchToChatSession', async (event, chatId: string, chatSessionId: string) => {
    try {
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

  // 🔥 New: get current ChatSession status (frontend-initiated call)
  ipcMain.handle('agentChat:getChatStatusInfo', async () => {
    try {
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

  // 🔥 New:Get current ChatSession Context Token usage (frontend-initiated call)
  ipcMain.handle('agentChat:getCurrentContextTokenUsage', async () => {
    try {
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
      const result = await agentChatManager.cancelChatSession(chatSessionId);
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agentChat:cancelActiveToolExecution', async (_event, chatSessionId: string) => {
    try {
      return await agentChatManager.cancelActiveToolExecution(chatSessionId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 🔥 New:Delete AgentChat instance for specified ChatSession
  ipcMain.handle('agentChat:removeAgentChatInstance', async (event, chatSessionId: string) => {
    try {
      agentChatManager.removeInstanceByChatSession(chatSessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 🔥 New: Fork ChatSession - duplicate ChatSession and switch to the new one
  ipcMain.handle('agentChat:forkChatSession', async (event, chatId: string, sourceChatSessionId: string) => {
    try {
      const result = await agentChatManager.forkChatSession(chatId, sourceChatSessionId);
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Import a single ChatSession JSON file into the current agent.
  ipcMain.handle('agentChat:importChatSession', async (event, chatId: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      if (!ctx.mainWindow) {
        return { success: false, error: 'No main window available' };
      }

      // 1. Show file selection dialog, select chat session JSON file
      const result = await dialog.showOpenDialog(ctx.mainWindow, {
        title: 'Select Chat Session JSON',
        properties: ['openFile'],
        filters: [
          { name: 'Chat Session JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      // Handle dialog result (compatible with both old and new API)
      let jsonPath: string | undefined;

      if (Array.isArray(result)) {
        // Old API format (just file paths array)
        if (result.length === 0) {
          return { success: false, error: 'File selection canceled' };
        }
        jsonPath = result[0];
      } else {
        // New API format (object with canceled and filePaths)
        const dialogResult = result as { canceled: boolean; filePaths: string[] };
        if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
          return { success: false, error: 'File selection canceled' };
        }
        jsonPath = dialogResult.filePaths[0];
      }

      if (!jsonPath) {
        return { success: false, error: 'No file selected' };
      }

      // 2. Call importer to execute import
      const importResult = await importChatSessionFromFile(ctx.currentUserAlias, chatId, jsonPath);

      return importResult;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 🔥 New: Replace file path references in current ChatSession
  ipcMain.handle('agentChat:replaceFilePathInSession', async (event, oldPath: string, newPath: string) => {
    try {
      const currentInstance = agentChatManager.getCurrentInstance();
      if (!currentInstance) {
        return { success: false, replacedCount: 0, error: 'No current agent instance available' };
      }

      const result = await currentInstance.replaceFilePathInSession(oldPath, newPath);
      return result;
    } catch (error) {
      return { success: false, replacedCount: 0, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get current ChatSession
  ipcMain.handle('agentChat:getCurrentChatSession', async () => {
    try {
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

  ipcMain.handle('agentChat:sendInteractionResponse', async (event, response: any) => {
    try {
      const logger = getAdvancedLogger();

      logger.info('[MAIN-IPC] Received interactive response from frontend', 'agentChat:sendInteractionResponse', {
        interactionId: response?.interactionId,
        chatSessionId: response?.chatSessionId,
        requestType: response?.requestType,
        action: response?.action,
      });

      const resolved = interactiveRequestManager.resolveRequest(response);
      if (!resolved) {
        return {
          success: false,
          error: `No pending interactive request found for session ${response?.chatSessionId}`,
        };
      }

      return { success: true };
    } catch (error) {
      const errorLogger = getAdvancedLogger();
      errorLogger.error('[MAIN-IPC] Error handling interactive response', 'agentChat:sendInteractionResponse', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

