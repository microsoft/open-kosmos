/**
 * search_mcp facade — list installed MCP servers with their connection status.
 */

import {
  BuiltinToolDefinition,
  SearchMcpInput,
  FacadeResult,
  errorResult,
} from './types';
import { GetMcpStatusTool } from '../getMcpStatusTool';
import { profileCacheManager } from '../../../userDataADO/profileCacheManager';

export class SearchMcpFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_mcp',
      description:
        'List installed MCP servers with their connection status. ' +
        'Use "installed: true" to list all installed MCP servers and their current status.',
      inputSchema: {
        type: 'object',
        properties: {
          installed: {
            type: 'boolean',
            description: 'true = list all installed MCP servers with their current connection status',
          },
        },
      },
    };
  }

  static async execute(args: SearchMcpInput): Promise<FacadeResult> {
    if (!args.installed) {
      return errorResult(
        'Provide "installed: true" to list installed servers.',
      );
    }

    return SearchMcpFacade.listInstalled();
  }

  private static async listInstalled(): Promise<FacadeResult> {
    try {
      const currentAlias = (profileCacheManager as any).currentUserAlias as string | null;
      if (!currentAlias) {
        return errorResult('No current user session found.');
      }

      const profile = profileCacheManager.getCachedProfile(currentAlias);

      if (!profile || !Array.isArray(profile.mcp_servers)) {
        return {
          success: true,
          message: 'No MCP servers installed.',
          servers: [],
          total: 0,
        };
      }

      const servers = [];
      for (const server of profile.mcp_servers) {
        try {
          const statusResult = await GetMcpStatusTool.execute({ mcp_name: server.name });
          servers.push({
            name: server.name,
            transport: server.transport,
            source: (server as any).source || 'ON-DEVICE',
            status: (statusResult as any).status || 'unknown',
          });
        } catch {
          servers.push({
            name: server.name,
            transport: server.transport,
            source: (server as any).source || 'ON-DEVICE',
            status: 'unknown',
          });
        }
      }

      return {
        success: true,
        message: `Found ${servers.length} installed MCP server(s).`,
        servers,
        total: servers.length,
      };
    } catch (err) {
      return {
        success: false,
        message: `Error listing installed servers: ${err instanceof Error ? err.message : String(err)}`,
        error: 'LIST_ERROR',
      };
    }
  }
}
