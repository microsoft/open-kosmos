import { ipcMain } from "electron";

import type { Context } from './shared';
import { SubAgentTaskStore } from "../../lib/subAgent/subAgentTaskStore";
import { SubAgentTaskWatcherRegistry } from "../../lib/subAgent/subAgentTaskWatcherRegistry";

export default function(ctx: Context) {

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
