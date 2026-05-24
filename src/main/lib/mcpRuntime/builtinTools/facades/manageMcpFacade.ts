/**
 * manage_mcp facade — unified MCP server management tool.
 *
 * Merges the legacy tools:
 *   create_mcp_server_from_config, update_mcp_server,
 *   get_mcp_status, set_mcp_connection_state
 * into a single action-based interface.
 *
 * Key simplifications:
 * - Flat parameters (no nested mcp_config wrapper)
 * - source/version managed internally (never exposed to AI)
 */

import {
  BuiltinToolDefinition,
  ManageMcpInput,
  FacadeResult,
  errorResult,
} from './types';
import { CreateMcpServerFromConfigTool } from '../createMcpServerFromConfigTool';
import { UpdateMcpServerTool } from '../updateMcpServerTool';
import { GetMcpStatusTool } from '../getMcpStatusTool';
import { mcpClientManager } from '../../mcpClientManager';
import { profileCacheManager } from '../../../userDataADO/profileCacheManager';

const VALID_ACTIONS = ['add', 'update', 'remove', 'connect', 'disconnect', 'reconnect', 'status'] as const;

export class ManageMcpFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'manage_mcp',
      description:
        'Add, update, remove, connect, disconnect, reconnect, or check status of MCP servers. ' +
        'For custom servers, provide transport + command (stdio) or url (sse/StreamableHttp).',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: VALID_ACTIONS as unknown as string[],
            description: 'The operation to perform',
          },
          name: {
            type: 'string',
            description: 'MCP server name (unique identifier)',
          },
          transport: {
            type: 'string',
            enum: ['stdio', 'sse', 'StreamableHttp'],
            description: 'Transport type (required for action=add)',
          },
          command: {
            type: 'string',
            description: 'Command to execute (required when transport=stdio)',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Command line arguments (for stdio transport)',
          },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Environment variables.',
          },
          url: {
            type: 'string',
            description: 'Server URL (required when transport=sse or StreamableHttp)',
          },
        },
        required: ['action', 'name'],
      },
    };
  }

  static async execute(args: ManageMcpInput): Promise<FacadeResult> {
    // --- Validate common ---
    if (!args.action || !(VALID_ACTIONS as readonly string[]).includes(args.action)) {
      return errorResult(
        `Invalid action "${args.action}".`,
        `Valid actions: ${VALID_ACTIONS.join(', ')}`,
      );
    }
    if (!args.name || typeof args.name !== 'string' || !args.name.trim()) {
      return errorResult('"name" is required.', 'Provide the MCP server name.');
    }

    const name = args.name.trim();

    switch (args.action) {
      case 'add':
        return ManageMcpFacade.addDirect(name, args);
      case 'update':
        return ManageMcpFacade.update(name, args);
      case 'remove':
        return ManageMcpFacade.remove(name);
      case 'connect':
      case 'disconnect':
      case 'reconnect':
        return ManageMcpFacade.setConnectionState(name, args.action);
      case 'status':
        return ManageMcpFacade.getStatus(name);
    }
  }

  // ---- Action handlers ----

  private static async addDirect(
    name: string,
    args: ManageMcpInput,
  ): Promise<FacadeResult> {
    // Validate transport-specific requirements eagerly
    if (!args.transport) {
      return errorResult(
        '"transport" is required for adding an MCP server.',
        'Set transport to "stdio", "sse", or "StreamableHttp".',
      );
    }
    if (args.transport === 'stdio' && !args.command) {
      return errorResult(
        '"command" is required for stdio transport.',
        'Set command to the executable path (e.g., "node", "npx", "python3").',
      );
    }
    if ((args.transport === 'sse' || args.transport === 'StreamableHttp') && !args.url) {
      return errorResult(
        `"url" is required for ${args.transport} transport.`,
        'Provide the server URL (e.g., "http://localhost:3000/sse").',
      );
    }

    const createResult = await CreateMcpServerFromConfigTool.execute({
      mcp_config: {
        name,
        transport: args.transport,
        command: args.command,
        args: args.args,
        env: args.env,
        url: args.url,
        source: 'ON-DEVICE',
        version: '1.0.0',
      },
    });

    return createResult as unknown as FacadeResult;
  }

  private static async update(
    name: string,
    args: ManageMcpInput,
  ): Promise<FacadeResult> {
    // Read existing to auto-manage version
    const currentUserAlias = ManageMcpFacade.getCurrentUserAlias();
    if (!currentUserAlias) {
      return errorResult('No current user session found.', 'Please ensure you are logged in.');
    }

    const serverInfo = profileCacheManager.getMcpServerInfo(currentUserAlias, name);
    if (!serverInfo?.config) {
      return errorResult(
        `MCP server "${name}" not found.`,
        'Use search_mcp with installed=true to list installed servers.',
      );
    }

    const existing = serverInfo.config;
    const existingSource = (existing as any).source || 'ON-DEVICE';
    const existingVersion = (existing as any).version || '1.0.0';

    // Build the update payload — only include changed fields
    const mcpConfig: any = { name };

    if (args.transport) mcpConfig.transport = args.transport;
    if (args.command) mcpConfig.command = args.command;
    if (args.args) mcpConfig.args = args.args;
    if (args.env) mcpConfig.env = args.env;
    if (args.url) mcpConfig.url = args.url;

    // Auto-manage version/source
    mcpConfig.source = existingSource;
    mcpConfig.version = ManageMcpFacade.incrementPatch(existingVersion);

    const updateResult = await UpdateMcpServerTool.execute({ mcp_config: mcpConfig });
    return updateResult as unknown as FacadeResult;
  }

  private static async remove(name: string): Promise<FacadeResult> {
    try {
      await mcpClientManager.delete(name);
      return {
        success: true,
        message: `MCP server "${name}" has been removed.`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to remove MCP server "${name}": ${err instanceof Error ? err.message : String(err)}`,
        error: 'REMOVE_FAILED',
      };
    }
  }

  private static async setConnectionState(
    name: string,
    action: 'connect' | 'disconnect' | 'reconnect',
  ): Promise<FacadeResult> {
    const { SetMcpConnectionStateTool } = await import('../setMcpConnectionStateTool');
    const result = await SetMcpConnectionStateTool.execute({ name, action });
    return result as unknown as FacadeResult;
  }

  private static async getStatus(name: string): Promise<FacadeResult> {
    const result = await GetMcpStatusTool.execute({ mcp_name: name });
    return result as unknown as FacadeResult;
  }

  // ---- Helpers ----

  private static getCurrentUserAlias(): string | null {
    try {
      return (profileCacheManager as any).currentUserAlias as string | null;
    } catch {
      return null;
    }
  }

  private static incrementPatch(version: string): string {
    const parts = version.split('.');
    if (parts.length !== 3) return '1.0.1';
    const patch = parseInt(parts[2], 10);
    return `${parts[0]}.${parts[1]}.${isNaN(patch) ? 1 : patch + 1}`;
  }
}
