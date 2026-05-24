import { describe, it, expect } from 'vitest';
import {
  isDeferredTool,
  extractDiscoveredToolNames,
  buildDiscoveredToolsTag,
  shouldEnableToolSearch,
  filterToolsForRequest,
  formatDeferredToolsIndex,
  McpTool,
  TOOL_SEARCH_TOOL_NAME,
} from '../toolSearchFilter';
import { Message } from '@shared/types/chatTypes';

function makeTool(overrides: Partial<McpTool> & { name: string }): McpTool {
  return {
    description: `${overrides.name} description`,
    inputSchema: { type: 'object', properties: {} },
    serverName: 'external-server',
    ...overrides,
  };
}

describe('isDeferredTool', () => {
  it('returns false for builtin tools', () => {
    expect(isDeferredTool(makeTool({ name: 'read_file', serverName: 'builtin-tools' }))).toBe(false);
  });

  it('returns false for tool_search itself', () => {
    expect(isDeferredTool(makeTool({ name: TOOL_SEARCH_TOOL_NAME, serverName: 'external' }))).toBe(false);
  });

  it('returns false for alwaysLoad tools', () => {
    expect(isDeferredTool(makeTool({ name: 'important_tool', alwaysLoad: true }))).toBe(false);
  });

  it('returns true for external MCP tools', () => {
    expect(isDeferredTool(makeTool({ name: 'ado_query', serverName: 'ado-server' }))).toBe(true);
  });
});

describe('extractDiscoveredToolNames', () => {
  it('extracts tool names from tool_search result messages', () => {
    const resultJson = JSON.stringify({
      matches: [
        { name: 'ado_query', description: 'Query ADO', inputSchema: {}, serverName: 'ado' },
        { name: 'ado_create', description: 'Create item', inputSchema: {}, serverName: 'ado' },
      ],
      query: 'ado',
      total_deferred_tools: 10,
    });
    const messages: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: resultJson }],
      } as any,
    ];

    const discovered = extractDiscoveredToolNames(messages);
    expect(discovered).toEqual(new Set(['ado_query', 'ado_create']));
  });

  it('extracts tool names from <discovered-tools> tags in assistant messages', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Summary of conversation.\n<discovered-tools>tool_a,tool_b,tool_c</discovered-tools>' }],
      } as any,
    ];

    const discovered = extractDiscoveredToolNames(messages);
    expect(discovered).toEqual(new Set(['tool_a', 'tool_b', 'tool_c']));
  });

  it('returns empty set for messages with no discoveries', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] } as any,
    ];
    expect(extractDiscoveredToolNames(messages).size).toBe(0);
  });
});

describe('buildDiscoveredToolsTag', () => {
  it('returns empty string for empty set', () => {
    expect(buildDiscoveredToolsTag(new Set())).toBe('');
  });

  it('builds sorted comma-separated tag', () => {
    const tag = buildDiscoveredToolsTag(new Set(['z_tool', 'a_tool']));
    expect(tag).toBe('\n<discovered-tools>a_tool,z_tool</discovered-tools>');
  });
});

describe('shouldEnableToolSearch', () => {
  const builtinTool = makeTool({ name: 'read_file', serverName: 'builtin-tools' });
  const toolSearchTool = makeTool({ name: TOOL_SEARCH_TOOL_NAME, serverName: 'builtin-tools' });
  const externalTool = makeTool({ name: 'ado_query', serverName: 'ado-server' });

  it('returns false if tool_search is not in the tool list', () => {
    expect(shouldEnableToolSearch([builtinTool, externalTool])).toBe(false);
  });

  it('returns false if no external MCP tools exist', () => {
    expect(shouldEnableToolSearch([builtinTool, toolSearchTool])).toBe(false);
  });

  it('returns true when external tools exist and no context window specified', () => {
    expect(shouldEnableToolSearch([builtinTool, toolSearchTool, externalTool])).toBe(true);
  });

  it('returns false when external tool tokens are below 10% of context window', () => {
    // A single small tool with tiny schema — well under 10% of 128K
    expect(shouldEnableToolSearch([builtinTool, toolSearchTool, externalTool], 128000)).toBe(false);
  });

  it('returns true when external tool tokens exceed 10% of context window', () => {
    // Create tools with large schemas to exceed threshold
    const bigTools = Array.from({ length: 50 }, (_, i) =>
      makeTool({
        name: `big_tool_${i}`,
        serverName: 'big-server',
        description: 'A'.repeat(500),
        inputSchema: { type: 'object', properties: Object.fromEntries(
          Array.from({ length: 20 }, (_, j) => [`param_${j}`, { type: 'string', description: 'B'.repeat(100) }])
        ) },
      })
    );
    expect(shouldEnableToolSearch([builtinTool, toolSearchTool, ...bigTools], 128000)).toBe(true);
  });
});

describe('filterToolsForRequest', () => {
  const builtinTool = makeTool({ name: 'read_file', serverName: 'builtin-tools' });
  const toolSearchTool = makeTool({ name: TOOL_SEARCH_TOOL_NAME, serverName: 'builtin-tools' });
  const externalTool1 = makeTool({ name: 'ado_query', serverName: 'ado-server' });
  const externalTool2 = makeTool({ name: 'slack_send', serverName: 'slack-server' });
  const alwaysLoadTool = makeTool({ name: 'critical_tool', serverName: 'ext', alwaysLoad: true });

  it('returns all tools (minus tool_search) when disabled', () => {
    const result = filterToolsForRequest(
      [builtinTool, toolSearchTool, externalTool1],
      [],
      { enabled: false },
    );
    expect(result.toolSearchEnabled).toBe(false);
    expect(result.filteredTools.map(t => t.name)).toContain('read_file');
    expect(result.filteredTools.map(t => t.name)).toContain('ado_query');
    expect(result.filteredTools.map(t => t.name)).not.toContain(TOOL_SEARCH_TOOL_NAME);
  });

  it('defers external tools when enabled', () => {
    const result = filterToolsForRequest(
      [builtinTool, toolSearchTool, externalTool1, externalTool2],
      [],
      { enabled: true },
    );
    expect(result.toolSearchEnabled).toBe(true);
    expect(result.filteredTools.map(t => t.name)).toContain('read_file');
    expect(result.filteredTools.map(t => t.name)).toContain(TOOL_SEARCH_TOOL_NAME);
    expect(result.filteredTools.map(t => t.name)).not.toContain('ado_query');
    expect(result.deferredTools.map(t => t.name)).toContain('ado_query');
    expect(result.deferredTools.map(t => t.name)).toContain('slack_send');
  });

  it('keeps alwaysLoad tools inline', () => {
    const result = filterToolsForRequest(
      [builtinTool, toolSearchTool, alwaysLoadTool, externalTool1],
      [],
      { enabled: true },
    );
    expect(result.filteredTools.map(t => t.name)).toContain('critical_tool');
    expect(result.deferredTools.map(t => t.name)).not.toContain('critical_tool');
  });

  it('includes previously discovered tools inline', () => {
    const messagesWithDiscovery: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: JSON.stringify({
          matches: [{ name: 'ado_query', description: '', inputSchema: {}, serverName: 'ado' }],
          query: 'ado',
          total_deferred_tools: 2,
        }) }],
      } as any,
    ];

    const result = filterToolsForRequest(
      [builtinTool, toolSearchTool, externalTool1, externalTool2],
      messagesWithDiscovery,
      { enabled: true },
    );
    expect(result.filteredTools.map(t => t.name)).toContain('ado_query');
    expect(result.filteredTools.map(t => t.name)).not.toContain('slack_send');
  });
});

describe('formatDeferredToolsIndex', () => {
  it('formats tool names sorted alphabetically', () => {
    const tools = [
      makeTool({ name: 'z_tool' }),
      makeTool({ name: 'a_tool' }),
      makeTool({ name: 'm_tool' }),
    ];
    const index = formatDeferredToolsIndex(tools);
    expect(index).toBe('<available-deferred-tools>\na_tool\nm_tool\nz_tool\n</available-deferred-tools>');
  });
});

describe('extractDiscoveredToolNames — fallback text parsing', () => {
  it('extracts names from line-by-line "name — description" format when JSON parse fails', () => {
    const messages: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: 'ado_query — Query ADO work items\nslack_send — Send a Slack message' }],
      } as any,
    ];

    const discovered = extractDiscoveredToolNames(messages);
    expect(discovered).toEqual(new Set(['ado_query', 'slack_send']));
  });

  it('handles string matches inside JSON result', () => {
    const resultJson = JSON.stringify({
      matches: ['tool_string_a', 'tool_string_b'],
      query: 'test',
      total_deferred_tools: 5,
    });
    const messages: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: resultJson }],
      } as any,
    ];

    const discovered = extractDiscoveredToolNames(messages);
    expect(discovered).toEqual(new Set(['tool_string_a', 'tool_string_b']));
  });
});

describe('filterToolsForRequest — no deferred tools', () => {
  it('disables tool search when enabled=true but all tools are builtin (no deferrable tools)', () => {
    const builtinTool = makeTool({ name: 'read_file', serverName: 'builtin-tools' });
    const toolSearchTool = makeTool({ name: TOOL_SEARCH_TOOL_NAME, serverName: 'builtin-tools' });

    const result = filterToolsForRequest(
      [builtinTool, toolSearchTool],
      [],
      { enabled: true },
    );

    expect(result.toolSearchEnabled).toBe(false);
    expect(result.deferredTools).toHaveLength(0);
    expect(result.filteredTools.map(t => t.name)).toContain('read_file');
    expect(result.filteredTools.map(t => t.name)).not.toContain(TOOL_SEARCH_TOOL_NAME);
  });
});
