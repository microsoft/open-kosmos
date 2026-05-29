/**
 * search_agents facade — search Agent library or list installed agents.
 *
 * Merges lookup capabilities from:
 *   get_agent_template_from_library (library search)
 *   list_agents (installed listing)
 * into a single read-only tool.
 */

import {
  BuiltinToolDefinition,
  SearchAgentsInput,
  FacadeResult,
  errorResult,
} from './types';
import { AgentLibraryFetcher } from '../../../assetsFetcher/agentLibraryFetcher';
import { ListAgentsTool } from '../listAgentsTool';

export class SearchAgentsFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_agents',
      description:
        'Search agent library for available agent templates, or list installed agents. ' +
        'Use "query" to search the library by name or keyword. ' +
        'Use "installed: true" to list all installed/configured agents.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search agent library by name or keyword',
          },
          installed: {
            type: 'boolean',
            description: 'true = list all installed/configured agents',
          },
        },
      },
    };
  }

  static async execute(args: SearchAgentsInput): Promise<FacadeResult> {
    if (!args.query && !args.installed) {
      return errorResult(
        'Provide "query" to search the library, or "installed: true" to list installed agents.',
      );
    }

    if (args.installed) {
      const result = await ListAgentsTool.execute();
      return result as unknown as FacadeResult;
    }

    return SearchAgentsFacade.searchLibrary(args.query!);
  }

  private static async searchLibrary(query: string): Promise<FacadeResult> {
    try {
      const fetcher = AgentLibraryFetcher.getInstance();
      const libraryResult = await fetcher.getLibraryData();

      if (!libraryResult.success || !libraryResult.data) {
        return {
          success: false,
          message: `Failed to fetch Agent library: ${libraryResult.error || 'Unknown error'}`,
          error: 'LIBRARY_FETCH_FAILED',
        };
      }

      const queryLower = query.toLowerCase();
      const matches = libraryResult.data.agents.filter(
        (a: any) =>
          a.name.toLowerCase().includes(queryLower) ||
          (a.description && a.description.toLowerCase().includes(queryLower)),
      );

      return {
        success: true,
        message: `Found ${matches.length} agent(s) matching "${query}".`,
        results: matches.map((a: any) => ({
          name: a.name,
          description: a.description,
          version: a.version,
        })),
        total: matches.length,
      };
    } catch (err) {
      return {
        success: false,
        message: `Error searching Agent library: ${err instanceof Error ? err.message : String(err)}`,
        error: 'SEARCH_ERROR',
      };
    }
  }
}
