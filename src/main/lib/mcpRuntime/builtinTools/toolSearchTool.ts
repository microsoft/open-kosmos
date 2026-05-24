/**
 * Tool Search Tool — lets the LLM discover deferred MCP tools on-demand.
 *
 * When many MCP servers are connected, sending all tool definitions in every
 * request wastes tokens and degrades model selection quality. This tool acts
 * as a meta-tool: the LLM calls it to search for relevant tools by keyword
 * or exact name, and the matched tools' full schemas are returned so they
 * can be included in subsequent turns.
 *
 * Query forms:
 * - "select:toolA,toolB" — fetch exact tools by name (comma-separated)
 * - "keyword1 keyword2"  — fuzzy keyword search against name + description
 * - "+servername query"  — require server name prefix, rank by remaining terms
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { BuiltinToolsManager } from './builtinToolsManager';
import { mcpClientManager } from '../mcpClientManager';
import type { McpTool } from '../../chat/toolSearchFilter';

interface ToolSearchArgs {
  query: string;
  max_results?: number;
}

interface ToolSearchMatch {
  name: string;
  description: string;
  inputSchema: any;
  serverName: string;
}

interface ToolSearchResult {
  matches: ToolSearchMatch[];
  query: string;
  total_deferred_tools: number;
  pending_mcp_servers?: string[];
}

const DEFAULT_MAX_RESULTS = 5;

export class ToolSearchTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'tool_search',
      description:
        'Fetches full schema definitions for deferred tools so they can be called. ' +
        'Deferred tools appear by name in <available-deferred-tools> messages. ' +
        'Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. ' +
        'This tool takes a query, matches it against the deferred tool list, and returns the matched tools\' ' +
        'complete schema definitions. Once a tool\'s schema appears in that result, it is callable exactly like ' +
        'any tool defined at the top of the prompt.\n\n' +
        'Query forms:\n' +
        '- "select:Read,Edit,Grep" — fetch these exact tools by name\n' +
        '- "notebook jupyter" — keyword search, up to max_results best matches\n' +
        '- "+slack send" — require "slack" in the name, rank by remaining terms',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search query. Use "select:name1,name2" for exact matches, or keywords for fuzzy search. ' +
              'Prefix a word with "+" to require it in the server name.',
          },
          max_results: {
            type: 'number',
            description: `Maximum number of results to return. Default: ${DEFAULT_MAX_RESULTS}.`,
          },
        },
        required: ['query'],
      },
    };
  }

  static execute(args: ToolSearchArgs, chatSessionId?: string): ToolExecutionResult {
    const deferredTools = BuiltinToolsManager.getDeferredToolsContext(chatSessionId);
    if (!deferredTools || deferredTools.length === 0) {
      return {
        success: true,
        data: JSON.stringify({
          matches: [],
          query: args.query,
          total_deferred_tools: 0,
        } satisfies ToolSearchResult),
      };
    }

    const maxResults = Math.min(Math.max(args.max_results ?? DEFAULT_MAX_RESULTS, 1), 20);
    const query = (args.query ?? '').trim();

    let matches: McpTool[];

    if (query.startsWith('select:')) {
      // Exact name match: "select:tool1,tool2"
      const names = query.substring(7).split(',').map(n => n.trim()).filter(Boolean);
      const nameSet = new Set(names);
      matches = deferredTools.filter(t => nameSet.has(t.name));
    } else {
      // Fast path: if query exactly matches a tool name (case-insensitive), return immediately
      const exactMatch = deferredTools.find(t => t.name.toLowerCase() === query.toLowerCase());
      if (exactMatch) {
        matches = [exactMatch];
      } else {
        // Keyword search with optional +serverName prefix
        matches = searchToolsWithKeywords(deferredTools, query, maxResults);
      }
    }

    const result: ToolSearchResult = {
      matches: matches.slice(0, maxResults).map(t => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema,
        serverName: t.serverName,
      })),
      query: args.query,
      total_deferred_tools: deferredTools.length,
    };

    // When no matches found, hint about MCP servers still connecting
    if (result.matches.length === 0) {
      try {
        const pendingServers = mcpClientManager.getAllMcpServerRuntimeStates()
          .filter(s => s.status === 'connecting')
          .map(s => s.serverName);
        if (pendingServers.length > 0) {
          result.pending_mcp_servers = pendingServers;
        }
      } catch { /* ignore — mcpClientManager may not be ready */ }
    }

    return {
      success: true,
      data: JSON.stringify(result),
    };
  }
}

/**
 * Score-based keyword search across tool name, description, and serverName.
 */
function searchToolsWithKeywords(tools: McpTool[], query: string, maxResults: number): McpTool[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tools.slice(0, maxResults);

  // Separate required server prefix terms (+term) from regular terms
  const requiredServerTerms: string[] = [];
  const searchTerms: string[] = [];

  for (const term of terms) {
    if (term.startsWith('+') && term.length > 1) {
      requiredServerTerms.push(term.substring(1));
    } else {
      searchTerms.push(term);
    }
  }

  const scored = tools
    .map(tool => {
      const name = tool.name.toLowerCase();
      const desc = (tool.description ?? '').toLowerCase();
      const server = tool.serverName.toLowerCase();
      const hint = (tool.searchHint ?? '').toLowerCase();

      // Check required server prefix
      if (requiredServerTerms.length > 0) {
        const hasRequired = requiredServerTerms.every(rt => server.includes(rt) || name.includes(rt));
        if (!hasRequired) return { tool, score: -1 };
      }

      let score = 0;
      for (const term of searchTerms) {
        // Name match (highest weight)
        if (name === term) score += 10;
        else if (name.includes(term)) score += 5;

        // Server name match
        if (server.includes(term)) score += 3;

        // Description match
        if (desc.includes(term)) score += 2;

        // searchHint match (same weight as description)
        if (hint.includes(term)) score += 2;
      }

      // Bonus for matching all search terms
      if (searchTerms.length > 0) {
        const allMatch = searchTerms.every(t =>
          name.includes(t) || desc.includes(t) || server.includes(t) || hint.includes(t));
        if (allMatch) score += 5;
      }

      return { tool, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxResults).map(s => s.tool);
}
