import { ipcMain } from 'electron';

import { getProfileCacheManager } from '../lazy';
import type { Context } from './shared';
import { mcpClientManager } from "../../lib/mcpRuntime/mcpClientManager";
import { McpLibraryFetcher } from "../../lib/assetsFetcher/mcpLibraryFetcher";

export default function(ctx: Context) {

  // MCP Status Operations - AUTHORIZED
  // 🆕 Refactor: get runtime status directly from mcpClientManager
  ipcMain.handle('mcp:getServerStatus', async () => {
    try {
      // 🆕 Dynamically import mcpClientManager

      // Get runtime status from mcpClientManager
      const runtimeStates = mcpClientManager.getAllMcpServerRuntimeStates();

      // Serialize error objects for IPC transmission
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

  // MCP Library Operations - AUTHORIZED
  ipcMain.handle('mcpLibrary:getLibraryData', async () => {
    try {
      const fetcher = McpLibraryFetcher.getInstance();
      const result = await fetcher.getLibraryData();
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('mcpLibrary:fetchAndUpdate', async () => {
    try {
      const fetcher = McpLibraryFetcher.getInstance();
      const result = await fetcher.fetchAndUpdate();
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

}
