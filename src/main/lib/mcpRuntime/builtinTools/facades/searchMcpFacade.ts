/**
 * search_mcp facade — search MCP library or list installed servers.
 *
 * Merges lookup capabilities from:
 *   get_mcp_template_from_library (library search)
 *   get_mcp_status (installed status)
 * into a single read-only tool.
 */

import {
  BuiltinToolDefinition,
  SearchMcpInput,
  FacadeResult,
  errorResult,
} from './types';
import { McpLibraryFetcher } from '../../../assetsFetcher/mcpLibraryFetcher';
import { GetMcpStatusTool } from '../getMcpStatusTool';
import { profileCacheManager } from '../../../userDataADO/profileCacheManager';

export class SearchMcpFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_mcp',
      description:
        'Search MCP library for available servers, or list installed servers with their connection status. ' +
        'Use "query" to search the library by name or keyword. ' +
        'Use "installed: true" to list all installed MCP servers and their current status.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search MCP library by name or keyword. Returns matching templates.',
          },
          installed: {
            type: 'boolean',
            description: 'true = list all installed MCP servers with their current connection status',
          },
        },
      },
    };
  }

  static async execute(args: SearchMcpInput): Promise<FacadeResult> {
    if (!args.query && !args.installed) {
      return errorResult(
        'Provide "query" to search the library, or "installed: true" to list installed servers.',
      );
    }

    if (args.installed) {
      return SearchMcpFacade.listInstalled();
    }

    return SearchMcpFacade.searchLibrary(args.query!);
  }

  private static async searchLibrary(query: string): Promise<FacadeResult> {
    try {
      const fetcher = McpLibraryFetcher.getInstance();
      const libraryResult = await fetcher.getLibraryData();

      if (!libraryResult.success || !libraryResult.data) {
        return {
          success: false,
          message: `Failed to fetch MCP library: ${libraryResult.error || 'Unknown error'}`,
          error: 'LIBRARY_FETCH_FAILED',
        };
      }

      const queryLower = query.toLowerCase();
      const matches = libraryResult.data.mcp_servers.filter(
        (s: any) =>
          s.name.toLowerCase().includes(queryLower) ||
          (s.description && s.description.toLowerCase().includes(queryLower)),
      );

      return {
        success: true,
        message: `Found ${matches.length} MCP server(s) matching "${query}".`,
        results: matches.map((s: any) => ({
          name: s.name,
          description: s.description,
          transport: s.transport,
          version: s.version,
        })),
        total: matches.length,
      };
    } catch (err) {
      return {
        success: false,
        message: `Error searching MCP library: ${err instanceof Error ? err.message : String(err)}`,
        error: 'SEARCH_ERROR',
      };
    }
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
