import { ipcMain, app, shell } from "electron";
import * as path from 'path';
import { isFeatureEnabled } from '../../lib/featureFlags';

import { getProfileCacheManager } from '../lazy';

import type { Context } from './shared';
import { SubAgentFileManager } from "../../lib/subAgent/subAgentFileManager";
import { SubAgentTaskStore } from "../../lib/subAgent/subAgentTaskStore";
import { SubAgentTaskWatcherRegistry } from "../../lib/subAgent/subAgentTaskWatcherRegistry";

export default function(ctx: Context) {

  // MCP Client Management handlers removed - main.ts should not directly call mcpClientManager
  // These operations are now handled through ProfileCacheManager

  // ===============================
  // Sub-Agent CRUD IPC handlers
  // ===============================

  // Get all sub-agent configs (read complete SubAgentConfig from file system)
  ipcMain.handle('subAgent:getAll', async () => {
    // 🔒 Feature Flag check: kosmosFeatureSubAgent
    if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
      return { success: true, data: [] };
    }
    try {
      const pcManager = await getProfileCacheManager();
      const subAgents = await pcManager.getSubAgents();
      return { success: true, data: subAgents };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Add sub-agent (write AGENT.md + update profile index)
  ipcMain.handle('subAgent:add', async (_, config: any) => {
    // 🔒 Feature Flag check: kosmosFeatureSubAgent
    if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const result = await pcManager.addSubAgent(ctx.currentUserAlias, config);
      if (!result) {
        return { success: false, error: 'Failed to add sub-agent' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Update sub-agent (update AGENT.md + profile index)
  ipcMain.handle('subAgent:update', async (_, name: string, config: any) => {
    // 🔒 Feature Flag check: kosmosFeatureSubAgent
    if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const result = await pcManager.updateSubAgent(ctx.currentUserAlias, name, config);
      if (!result) {
        return { success: false, error: 'Failed to update sub-agent' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Delete sub-agent (delete agent directory + profile index + cascade cleanup ChatAgent references)
  ipcMain.handle('subAgent:delete', async (_, name: string) => {
    // 🔒 Feature Flag check: kosmosFeatureSubAgent
    if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      const result = await pcManager.deleteSubAgent(ctx.currentUserAlias, name);
      if (!result) {
        return { success: false, error: 'Failed to delete sub-agent' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Import Claude Code format .md file as sub-agent
  ipcMain.handle('subAgent:importFromFile', async (_, filePath: string) => {
    // 🔒 Feature Flag check: kosmosFeatureSubAgent
    if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const fileManager = SubAgentFileManager.getInstance();
      const pcManager = await getProfileCacheManager();

      const appPath = app.getPath('userData');
      const profileDir = path.join(appPath, 'profiles', ctx.currentUserAlias);

      // Import: parse .md → write AGENT.md
      const config = await fileManager.importClaudeCodeAgent(profileDir, filePath);

      // Add index entry to profile
      await pcManager.addSubAgent(ctx.currentUserAlias, config);

      return { success: true, data: config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Export as Claude Code standard format
  ipcMain.handle('subAgent:exportAsClaudeCode', async (_, name: string) => {
    // 🔒 Feature Flag check: kosmosFeatureSubAgent
    if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const fileManager = SubAgentFileManager.getInstance();

      const appPath = app.getPath('userData');
      const profileDir = path.join(appPath, 'profiles', ctx.currentUserAlias);

      const config = await fileManager.readAgentConfig(profileDir, name);
      if (!config) {
        return { success: false, error: `Sub-agent "${name}" not found` };
      }

      const content = fileManager.exportAsClaudeCodeFormat(config);
      return { success: true, data: content };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Open agent directory in file manager
  ipcMain.handle('subAgent:openInExplorer', async (_, name: string) => {
    // 🔒 Feature Flag check: kosmosFeatureSubAgent
    if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const fileManager = SubAgentFileManager.getInstance();

      const appPath = app.getPath('userData');
      const profileDir = path.join(appPath, 'profiles', ctx.currentUserAlias);
      const agentDir = fileManager.getAgentDirectory(profileDir, name);

      await shell.openPath(agentDir);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Manually trigger file system scan sync
  ipcMain.handle('subAgent:syncFromDisk', async () => {
    // 🔒 Feature Flag check: kosmosFeatureSubAgent
    if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
      return { success: true, data: [] };
    }
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const pcManager = await getProfileCacheManager();
      await pcManager.syncSubAgentIndex(ctx.currentUserAlias);
      const subAgents = await pcManager.getSubAgents();
      return { success: true, data: subAgents };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ===============================
  // Sub-Agent Task Streaming IPC handlers
  // ===============================

  // List all tasks for a session (metadata only)
  ipcMain.handle('subAgentTask:listForSession', async (_event, parentSessionId: string) => {
    try {
      const store = SubAgentTaskStore.getInstance();
      const tasks = store.getTasksForSession(parentSessionId, ctx.currentUserAlias || undefined);
      return { success: true, data: tasks };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Resolve taskId from a correlationId (parent toolCall.id)
  ipcMain.handle('subAgentTask:resolveByCorrelationId', async (_event, correlationId: string) => {
    const { SubAgentManager } = await import("../../lib/subAgent/subAgentManager");
    const manager = SubAgentManager.getInstance();
    const taskId = manager.resolveTaskIdByCorrelationId(correlationId);
    return { success: true, data: taskId };
  });

  // Open a task panel — load snapshot + register watcher for streaming
  ipcMain.handle('subAgentTask:open', async (event, taskId: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      const store = SubAgentTaskStore.getInstance();
      const taskFile = store.getTaskFile(taskId) || await store.loadFromDisk(ctx.currentUserAlias, taskId);

      if (!taskFile) {
        return { success: false, error: `Task "${taskId}" not found` };
      }

      // Register watcher for streaming
      SubAgentTaskWatcherRegistry.getInstance().watch(taskId, event.sender);

      return {
        success: true,
        data: {
          taskId: taskFile.taskId,
          subAgentName: taskFile.subAgentName,
          status: taskFile.status,
          startTime: taskFile.startTime,
          endTime: taskFile.endTime,
          turnCount: taskFile.turnCount,
          model: taskFile.model,
          messages: taskFile.chat_history,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Close a task panel — unregister watcher
  ipcMain.handle('subAgentTask:close', async (_, taskId: string) => {
    try {
      SubAgentTaskWatcherRegistry.getInstance().unwatch(taskId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
