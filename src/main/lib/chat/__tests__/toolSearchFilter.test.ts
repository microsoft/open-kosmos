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
  MAX_INLINE_TOOLS,
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
    expect(isDeferredTool(makeTool({ name: 'weather_current', serverName: 'weather-server' }))).toBe(true);
  });
});

describe('extractDiscoveredToolNames', () => {
  it('extracts tool names from tool_search result messages', () => {
    const resultJson = JSON.stringify({
      matches: [
        { name: 'weather_current', description: 'Get current weather', inputSchema: {}, serverName: 'weather' },
        { name: 'weather_forecast', description: 'Get a forecast', inputSchema: {}, serverName: 'weather' },
      ],
      query: 'weather',
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
    expect(discovered).toEqual(new Set(['weather_current', 'weather_forecast']));
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
  const externalTool = makeTool({ name: 'weather_current', serverName: 'weather-server' });

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

  it('forces true when total tools exceed MAX_INLINE_TOOLS even if tokens are below threshold', () => {
    // 130 small external tools — tokens well under 10% of 128K, but count exceeds 128
    const manySmallTools = Array.from({ length: 130 }, (_, i) =>
      makeTool({ name: `small_${i}`, serverName: 'ext', description: 'x' })
    );
    expect(shouldEnableToolSearch([builtinTool, toolSearchTool, ...manySmallTools], 128000)).toBe(true);
  });

  it('handles tools with missing name, description, or inputSchema in token estimation', () => {
    const toolNoDesc = makeTool({
      name: 'no_desc',
      serverName: 'ext',
      description: undefined,
      inputSchema: undefined,
    });
    // Should not throw; just returns false for small tool set
    expect(shouldEnableToolSearch([builtinTool, toolSearchTool, toolNoDesc], 128000)).toBe(false);
  });
});

describe('filterToolsForRequest', () => {
  const builtinTool = makeTool({ name: 'read_file', serverName: 'builtin-tools' });
  const toolSearchTool = makeTool({ name: TOOL_SEARCH_TOOL_NAME, serverName: 'builtin-tools' });
  const externalTool1 = makeTool({ name: 'weather_current', serverName: 'weather-server' });
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
    expect(result.filteredTools.map(t => t.name)).toContain('weather_current');
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
    expect(result.filteredTools.map(t => t.name)).not.toContain('weather_current');
    expect(result.deferredTools.map(t => t.name)).toContain('weather_current');
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
          matches: [{ name: 'weather_current', description: '', inputSchema: {}, serverName: 'weather' }],
          query: 'weather',
          total_deferred_tools: 2,
        }) }],
      } as any,
    ];

    const result = filterToolsForRequest(
      [builtinTool, toolSearchTool, externalTool1, externalTool2],
      messagesWithDiscovery,
      { enabled: true },
    );
    expect(result.filteredTools.map(t => t.name)).toContain('weather_current');
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
        content: [{ type: 'text', text: 'weather_current — Get current weather\nslack_send — Send a Slack message' }],
      } as any,
    ];

    const discovered = extractDiscoveredToolNames(messages);
    expect(discovered).toEqual(new Set(['weather_current', 'slack_send']));
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

  it('skips assistant messages with no text content', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [] } as any,
    ];
    expect(extractDiscoveredToolNames(messages).size).toBe(0);
  });

  it('skips assistant messages without discovered-tools tag', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'Just a normal summary.' }] } as any,
    ];
    expect(extractDiscoveredToolNames(messages).size).toBe(0);
  });

  it('skips tool_search result messages with no text', () => {
    const messages: Message[] = [
      { role: 'tool', name: TOOL_SEARCH_TOOL_NAME, content: [] } as any,
    ];
    expect(extractDiscoveredToolNames(messages).size).toBe(0);
  });

  it('skips fallback lines without em-dash separator', () => {
    const messages: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: 'no dash here\nanother line' }],
      } as any,
    ];
    expect(extractDiscoveredToolNames(messages).size).toBe(0);
  });

  it('skips fallback lines with invalid tool name characters', () => {
    const messages: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: 'bad name! — some description' }],
      } as any,
    ];
    expect(extractDiscoveredToolNames(messages).size).toBe(0);
  });

  it('skips JSON matches that are neither string nor object with name', () => {
    const resultJson = JSON.stringify({
      matches: [42, null, { noName: true }],
      query: 'test',
      total_deferred_tools: 3,
    });
    const messages: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: resultJson }],
      } as any,
    ];
    expect(extractDiscoveredToolNames(messages).size).toBe(0);
  });

  it('skips empty entries in discovered-tools tag', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '<discovered-tools>tool_a,,tool_b, ,</discovered-tools>' }],
      } as any,
    ];
    const discovered = extractDiscoveredToolNames(messages);
    expect(discovered).toEqual(new Set(['tool_a', 'tool_b']));
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

describe('filterToolsForRequest — MAX_INLINE_TOOLS hard cap', () => {
  const toolSearchTool = makeTool({ name: TOOL_SEARCH_TOOL_NAME, serverName: 'builtin-tools' });

  function makeBuiltinTools(count: number): McpTool[] {
    return Array.from({ length: count }, (_, i) =>
      makeTool({ name: `builtin_${i}`, serverName: 'builtin-tools' }),
    );
  }

  it('caps at MAX_INLINE_TOOLS when disabled and tool count exceeds limit', () => {
    const tools = [...makeBuiltinTools(135), toolSearchTool];

    const result = filterToolsForRequest(tools, [], { enabled: false });

    expect(result.toolSearchEnabled).toBe(false);
    expect(result.filteredTools.length).toBeLessThanOrEqual(MAX_INLINE_TOOLS);
  });

  it('caps at MAX_INLINE_TOOLS when no deferred tools but inline exceeds limit', () => {
    const builtins = makeBuiltinTools(130);
    const alwaysLoadTools = Array.from({ length: 5 }, (_, i) =>
      makeTool({ name: `always_load_${i}`, serverName: 'ext', alwaysLoad: true }),
    );

    const result = filterToolsForRequest(
      [...builtins, toolSearchTool, ...alwaysLoadTools],
      [],
      { enabled: true },
    );

    expect(result.toolSearchEnabled).toBe(false);
    expect(result.filteredTools.length).toBeLessThanOrEqual(MAX_INLINE_TOOLS);
  });

  it('truncates discovered tools when inline + discovered exceeds limit', () => {
    const builtins = makeBuiltinTools(125);
    const externalTools = Array.from({ length: 20 }, (_, i) =>
      makeTool({ name: `ext_tool_${i}`, serverName: 'ext-server' }),
    );

    const discoveredNames = externalTools.slice(0, 10).map(t => t.name);
    const messages: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: JSON.stringify({
          matches: discoveredNames.map(n => ({ name: n })),
          query: 'test',
          total_deferred_tools: 20,
        }) }],
      } as any,
    ];

    const result = filterToolsForRequest(
      [...builtins, toolSearchTool, ...externalTools],
      messages,
      { enabled: true },
    );

    expect(result.toolSearchEnabled).toBe(true);
    expect(result.filteredTools.length).toBeLessThanOrEqual(MAX_INLINE_TOOLS);
  });

  it('allows zero discovered tools when inline alone exceeds limit', () => {
    const builtins = makeBuiltinTools(130);
    const externalTools = Array.from({ length: 5 }, (_, i) =>
      makeTool({ name: `ext_tool_${i}`, serverName: 'ext-server' }),
    );

    const messages: Message[] = [
      {
        role: 'tool',
        name: TOOL_SEARCH_TOOL_NAME,
        content: [{ type: 'text', text: JSON.stringify({
          matches: externalTools.map(t => ({ name: t.name })),
          query: 'test',
          total_deferred_tools: 5,
        }) }],
      } as any,
    ];

    const result = filterToolsForRequest(
      [...builtins, toolSearchTool, ...externalTools],
      messages,
      { enabled: true },
    );

    expect(result.toolSearchEnabled).toBe(true);
    expect(result.filteredTools.length).toBeLessThanOrEqual(MAX_INLINE_TOOLS);
    // tool_search must be preserved even when inline tools exceed the cap
    expect(result.filteredTools.some(t => t.name === TOOL_SEARCH_TOOL_NAME)).toBe(true);
    const discoveredInResult = result.filteredTools.filter(t =>
      externalTools.some(e => e.name === t.name),
    );
    expect(discoveredInResult.length).toBe(0);
  });

  it('preserves tool_search in enforceHardCap when it would be sliced off', () => {
    // 130 builtins + tool_search (sorted last by name) + externals
    const builtins = makeBuiltinTools(130);
    const externalTools = Array.from({ length: 3 }, (_, i) =>
      makeTool({ name: `zzz_ext_${i}`, serverName: 'ext-server' }),
    );

    const result = filterToolsForRequest(
      [...builtins, toolSearchTool, ...externalTools],
      [],
      { enabled: true },
    );

    expect(result.toolSearchEnabled).toBe(true);
    expect(result.filteredTools.length).toBeLessThanOrEqual(MAX_INLINE_TOOLS);
    expect(result.filteredTools.some(t => t.name === TOOL_SEARCH_TOOL_NAME)).toBe(true);
  });

  it('does not truncate when total is within limit', () => {
    const builtins = makeBuiltinTools(50);
    const externalTools = Array.from({ length: 10 }, (_, i) =>
      makeTool({ name: `ext_tool_${i}`, serverName: 'ext-server' }),
    );

    const result = filterToolsForRequest(
      [...builtins, toolSearchTool, ...externalTools],
      [],
      { enabled: true },
    );

    expect(result.toolSearchEnabled).toBe(true);
    expect(result.filteredTools.length).toBe(51); // 50 builtins + tool_search
  });
});
