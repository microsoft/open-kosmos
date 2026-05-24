import { ipcMain } from 'electron';

import { getProfileCacheManager, getAdvancedLogger } from '../lazy';
import type { Context } from './shared';
import { mcpClientManager } from "../../lib/mcpRuntime/mcpClientManager";
import { McpAuthService } from "../../lib/mcpRuntime/auth/McpAuthService";
import { mcpAuthPromptRegistry } from "../../lib/mcpRuntime/auth/mcpAuthPromptRegistry";
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

  ipcMain.handle('mcpAuth:respondConsent', async (
    event,
    requestId: string,
    decision: 'cancel' | 'allow-this-time',
  ) => {
    const logger = getAdvancedLogger();
    if (!['cancel', 'allow-this-time'].includes(decision)) {
      return { success: false, error: 'Invalid MCP auth consent decision' };
    }

    logger.info('[MCP-AUTH-IPC] Consent response received', 'mcpAuth:respondConsent', {
      requestId,
      decision,
      senderUrl: event.sender?.getURL?.() || '',
    });

    const handler = mcpAuthPromptRegistry.takeConsent(requestId);
    if (handler) {
      handler(decision);
      return { success: true };
    }

    return { success: false, error: 'No pending MCP auth consent request' };
  });

  /**
   * Renderer's response to a `mcpAuth:requestClientId` prompt. Either the
   * user supplies a client_id (and optionally a client_secret), or they
   * cancel. The main-process orchestrator (OpenKosmosOAuthProvider flow)
   * registers a one-shot handler under `requestId` in
   * `__pendingMcpAuthClientIdRequest` before sending the prompt.
   */
  ipcMain.handle('mcpAuth:respondClientId', async (
    event,
    requestId: string,
    response: { cancelled: true } | { clientId: string; clientSecret?: string },
  ) => {
    const logger = getAdvancedLogger();

    const isCancel = !!response && 'cancelled' in response && response.cancelled === true;
    const isProvide = !!response
      && 'clientId' in response
      && typeof response.clientId === 'string'
      && response.clientId.trim().length > 0;
    if (!isCancel && !isProvide) {
      return { success: false, error: 'Invalid MCP auth client-id response' };
    }

    logger.info('[MCP-AUTH-IPC] Client-id response received', 'mcpAuth:respondClientId', {
      requestId,
      kind: isCancel ? 'cancel' : 'provided',
      senderUrl: event.sender?.getURL?.() || '',
    });

    const handler = mcpAuthPromptRegistry.takeClientId(requestId);
    if (handler) {
      handler(response);
      return { success: true };
    }

    return { success: false, error: 'No pending MCP auth client-id request' };
  });

  /**
   * Reset stored OAuth credentials for a single MCP server.
   *
   * Intended primarily for development / testing flows where you need to
   * re-authenticate against a different account or rotate the OAuth app.
   * Disconnects the server first so the in-memory client drops its current
   * Bearer token; the next connect re-runs the OAuth flow.
   *
   * `scope`:
   *   - `'tokens'` (default): drop access + refresh token only. Re-runs
   *     PKCE against the same OAuth app — useful for switching accounts
   *     at the provider's own login page.
   *   - `'all'`: drop everything including the registered clientId.
   *     Next connect surfaces the DCR-fallback dialog again — useful for
   *     swapping to a different OAuth app entirely.
   */
  ipcMain.handle('mcp:resetOAuth', async (
    _event,
    serverName: string,
    scope: 'tokens' | 'all' = 'tokens',
  ) => {
    const logger = getAdvancedLogger();
    try {
      const pcManager = await getProfileCacheManager();
      const alias = mcpClientManager.getCurrentUserAlias();
      if (!alias) {
        return { success: false, error: 'No active profile' };
      }
      const info = pcManager.getMcpServerInfo(alias, serverName);
      if (!info?.config) {
        return { success: false, error: `Server "${serverName}" not found` };
      }

      // Disconnect first so the live client stops using the about-to-be-cleared token.
      try {
        await mcpClientManager.disconnect(serverName);
      } catch (e) {
        logger.warn('[MCP-IPC] Disconnect before OAuth reset failed (continuing)', 'mcp:resetOAuth', {
          serverName,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      await McpAuthService.getInstance().clearOAuthForServer(
        serverName,
        info.config,
        scope,
      );

      logger.info('[MCP-IPC] OAuth credentials reset', 'mcp:resetOAuth', { serverName, scope });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('[MCP-IPC] OAuth reset failed', 'mcp:resetOAuth', { serverName, error: message });
      return { success: false, error: message };
    }
  });
}
