/**
 * Tool Search Filter — deferred tool loading for large tool sets
 *
 * Replicates Claude Code's "Tool Search" pattern:
 * MCP tools are deferred by default (not sent to LLM). A `tool_search` builtin
 * tool lets the LLM discover tools on-demand. Discovered tools are included in
 * subsequent turns.
 *
 * Since OpenKosmos uses OpenAI-compatible API (no native defer_loading), we simply
 * filter deferred tools out of the request and prepend a deferred tool index.
 */

import { Message, MessageHelper } from '@shared/types/chatTypes';

/**
 * Must match BUILTIN_SERVER_NAME in builtinMcpClient.ts.
 * Duplicated here to avoid importing from the heavy builtinMcpClient module
 * which transitively pulls in builtinToolsManager and all tool implementations.
 */
const BUILTIN_SERVER_NAME = 'builtin-tools';

export const TOOL_SEARCH_TOOL_NAME = 'tool_search';

/** Estimated characters per token for rough token estimation */
const CHARS_PER_TOKEN = 2.5;

/** Default: defer if MCP tools exceed 10% of context window */
const DEFAULT_TOOL_TOKEN_PERCENTAGE = 10;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
  serverName: string;
  annotations?: Record<string, any>;
  /**
   * When true, this tool is never deferred — always sent inline to the LLM.
   * MCP servers set this via `_meta['anthropic/alwaysLoad']`.
   * Aligned with Claude Code's Tool.alwaysLoad field.
   */
  alwaysLoad?: boolean;
  /**
   * Extra keywords for tool search matching, from `_meta['anthropic/searchHint']`.
   * Aligned with Claude Code's Tool.searchHint field.
   */
  searchHint?: string;
}

export interface ToolSearchFilterResult {
  /** Tools to actually send to the LLM API */
  filteredTools: McpTool[];
  /** Tools that were deferred (available for tool_search but not sent) */
  deferredTools: McpTool[];
  /** Whether tool search is active for this request */
  toolSearchEnabled: boolean;
}

/**
 * Determine if a tool should be deferred (not sent inline to the LLM).
 * - Builtin tools → always inline
 * - tool_search itself → always inline
 * - External MCP tools → deferred by default
 */
export function isDeferredTool(tool: McpTool): boolean {
  // Explicit opt-out — aligned with Claude Code's _meta['anthropic/alwaysLoad']
  if (tool.alwaysLoad === true) return false;
  if (tool.serverName === BUILTIN_SERVER_NAME) return false;
  if (tool.name === TOOL_SEARCH_TOOL_NAME) return false;
  return true;
}

/** Tag used to preserve discovered tool names across context compaction */
const DISCOVERED_TOOLS_TAG = 'discovered-tools';

/**
 * Scan message history for tool names discovered via tool_search calls.
 * Looks for:
 * 1. Tool messages where name === 'tool_search' (normal discovery)
 * 2. <discovered-tools> tags in summary messages (post-compaction preservation)
 */
export function extractDiscoveredToolNames(messages: Message[]): Set<string> {
  const discovered = new Set<string>();

  for (const msg of messages) {
    // Source 1: tool_search result messages
    if (msg.role === 'tool' && msg.name === TOOL_SEARCH_TOOL_NAME) {
      const text = MessageHelper.getText(msg);
      if (!text) continue;

      try {
        const result = JSON.parse(text);
        if (result.matches && Array.isArray(result.matches)) {
          for (const match of result.matches) {
            if (typeof match === 'string') {
              discovered.add(match);
            } else if (match && typeof match.name === 'string') {
              discovered.add(match.name);
            }
          }
        }
      } catch {
        // Not JSON — try line-by-line name extraction (fallback)
        for (const line of text.split('\n')) {
          const dashIdx = line.indexOf(' — ');
          if (dashIdx > 0) {
            const name = line.substring(0, dashIdx).trim();
            if (name && /^[\w-]+$/.test(name)) {
              discovered.add(name);
            }
          }
        }
      }
      continue;
    }

    // Source 2: <discovered-tools> tag in summary messages (survives compaction)
    if (msg.role === 'assistant') {
      const text = MessageHelper.getText(msg);
      if (!text) continue;
      const tagStart = text.indexOf(`<${DISCOVERED_TOOLS_TAG}>`);
      const tagEnd = text.indexOf(`</${DISCOVERED_TOOLS_TAG}>`);
      if (tagStart >= 0 && tagEnd > tagStart) {
        const inner = text.substring(tagStart + DISCOVERED_TOOLS_TAG.length + 2, tagEnd);
        for (const name of inner.split(',')) {
          const trimmed = name.trim();
          if (trimmed) discovered.add(trimmed);
        }
      }
    }
  }

  return discovered;
}

/**
 * Build a <discovered-tools> tag string to embed in summary messages.
 * This preserves discovered tool names across context compaction.
 */
export function buildDiscoveredToolsTag(toolNames: Set<string>): string {
  if (toolNames.size === 0) return '';
  const sorted = [...toolNames].sort();
  return `\n<${DISCOVERED_TOOLS_TAG}>${sorted.join(',')}</${DISCOVERED_TOOLS_TAG}>`;
}

/**
 * Decide whether tool search should be enabled for this request.
 * Aligned with Claude Code's default 'tst' mode: always enabled when
 * there are any deferrable external MCP tools.
 *
 * When contextWindowSize is provided, falls back to 'tst-auto' behavior:
 * only enable if deferred tools exceed 10% of context window tokens.
 */
export function shouldEnableToolSearch(
  allTools: McpTool[],
  contextWindowSize?: number,
): boolean {
  // tool_search must be present — without it, the LLM cannot discover deferred tools
  if (!allTools.some(t => t.name === TOOL_SEARCH_TOOL_NAME)) return false;

  const externalTools = allTools.filter(t => isDeferredTool(t));
  if (externalTools.length === 0) return false;

  // If context window is known, use token threshold (tst-auto behavior)
  if (contextWindowSize && contextWindowSize > 0) {
    const toolChars = externalTools.reduce((sum, t) => {
      return sum + (t.name?.length ?? 0)
        + (t.description?.length ?? 0)
        + (JSON.stringify(t.inputSchema ?? {}).length);
    }, 0);
    const estimatedTokens = toolChars / CHARS_PER_TOKEN;
    const threshold = contextWindowSize * (DEFAULT_TOOL_TOKEN_PERCENTAGE / 100);
    if (estimatedTokens < threshold) return false;
  }

  return true;
}

/**
 * Main filter: reduce the tools sent to the LLM API.
 *
 * Returns:
 * - filteredTools: builtin tools + tool_search + previously-discovered deferred tools
 * - deferredTools: all deferred tools (for tool_search to search against)
 * - toolSearchEnabled: whether filtering was applied
 *
 * Tools are sorted for prompt cache stability: builtin prefix, then MCP tools.
 */
export function filterToolsForRequest(
  allTools: McpTool[],
  messages: Message[],
  options: { enabled: boolean },
): ToolSearchFilterResult {
  if (!options.enabled) {
    // Tool search disabled — send all tools except tool_search itself
    const tools = allTools.filter(t => t.name !== TOOL_SEARCH_TOOL_NAME);
    return { filteredTools: sortToolsForCache(tools), deferredTools: [], toolSearchEnabled: false };
  }

  const inlineTools: McpTool[] = [];
  const deferredTools: McpTool[] = [];

  for (const tool of allTools) {
    if (isDeferredTool(tool)) {
      deferredTools.push(tool);
    } else {
      inlineTools.push(tool);
    }
  }

  if (deferredTools.length === 0) {
    // Nothing to defer — disable tool search
    const tools = allTools.filter(t => t.name !== TOOL_SEARCH_TOOL_NAME);
    return { filteredTools: sortToolsForCache(tools), deferredTools: [], toolSearchEnabled: false };
  }

  // Find previously discovered tools from message history
  const discoveredNames = extractDiscoveredToolNames(messages);

  // Include discovered deferred tools inline
  const discoveredDeferred = deferredTools.filter(t => discoveredNames.has(t.name));

  const filteredTools = [...inlineTools, ...discoveredDeferred];

  return {
    filteredTools: sortToolsForCache(filteredTools),
    deferredTools,
    toolSearchEnabled: true,
  };
}

/**
 * Format the deferred tools index for injection into the message list.
 * Aligned with Claude Code: one tool name per line, no descriptions.
 */
export function formatDeferredToolsIndex(deferredTools: McpTool[]): string {
  const lines = deferredTools
    .map(t => t.name)
    .sort();

  return `<available-deferred-tools>\n${lines.join('\n')}\n</available-deferred-tools>`;
}

/**
 * Sort tools for prompt cache stability: builtin first, then external, each sorted by name.
 */
function sortToolsForCache(tools: McpTool[]): McpTool[] {
  const byName = (a: McpTool, b: McpTool) => a.name.localeCompare(b.name);
  const builtin = tools.filter(t => t.serverName === BUILTIN_SERVER_NAME).sort(byName);
  const external = tools.filter(t => t.serverName !== BUILTIN_SERVER_NAME).sort(byName);
  return [...builtin, ...external];
}
