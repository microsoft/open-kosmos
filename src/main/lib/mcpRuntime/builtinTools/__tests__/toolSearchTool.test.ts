import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolSearchTool } from '../toolSearchTool';
import { BuiltinToolsManager } from '../builtinToolsManager';
import type { McpTool } from '../../../chat/toolSearchFilter';

// Mock mcpClientManager to avoid Electron dependencies
vi.mock('../../mcpClientManager', () => ({
  mcpClientManager: {
    getAllMcpServerRuntimeStates: vi.fn().mockReturnValue([]),
  },
}));

// Mock builtinToolsManager methods used by ToolSearchTool
vi.mock('../builtinToolsManager', () => ({
  BuiltinToolsManager: {
    getDeferredToolsContext: vi.fn(),
    getExecutionContext: vi.fn().mockReturnValue(null),
  },
}));

function makeDeferredTool(name: string, serverName: string, description?: string, searchHint?: string): McpTool {
  return {
    name,
    description: description ?? `${name} tool`,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    serverName,
    searchHint,
  };
}

const DEFERRED_TOOLS: McpTool[] = [
  makeDeferredTool('ado_query', 'ado-server', 'Query Azure DevOps work items'),
  makeDeferredTool('ado_create_work_item', 'ado-server', 'Create a work item in ADO'),
  makeDeferredTool('slack_send_message', 'slack-server', 'Send a Slack message'),
  makeDeferredTool('slack_list_channels', 'slack-server', 'List Slack channels'),
  makeDeferredTool('kusto_query', 'kusto-server', 'Run a Kusto query', 'KQL database analytics'),
];

describe('ToolSearchTool', () => {
  beforeEach(() => {
    vi.mocked(BuiltinToolsManager.getDeferredToolsContext).mockReturnValue(DEFERRED_TOOLS);
  });

  describe('getDefinition', () => {
    it('returns a valid tool definition', () => {
      const def = ToolSearchTool.getDefinition();
      expect(def.name).toBe('tool_search');
      expect(def.inputSchema.required).toContain('query');
    });
  });

  describe('execute — select: exact match', () => {
    it('returns exact tools by name', () => {
      const result = ToolSearchTool.execute({ query: 'select:ado_query,kusto_query' });
      expect(result.success).toBe(true);
      const data = JSON.parse(result.data!);
      expect(data.matches).toHaveLength(2);
      expect(data.matches.map((m: any) => m.name).sort()).toEqual(['ado_query', 'kusto_query']);
    });

    it('returns empty for non-existent tool names', () => {
      const result = ToolSearchTool.execute({ query: 'select:nonexistent_tool' });
      const data = JSON.parse(result.data!);
      expect(data.matches).toHaveLength(0);
    });
  });

  describe('execute — exact name fast path', () => {
    it('returns immediately on case-insensitive exact name match', () => {
      const result = ToolSearchTool.execute({ query: 'ADO_QUERY' });
      const data = JSON.parse(result.data!);
      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].name).toBe('ado_query');
    });
  });

  describe('execute — keyword search', () => {
    it('finds tools by keyword in name', () => {
      const result = ToolSearchTool.execute({ query: 'slack' });
      const data = JSON.parse(result.data!);
      expect(data.matches.length).toBeGreaterThanOrEqual(2);
      expect(data.matches.every((m: any) => m.name.includes('slack'))).toBe(true);
    });

    it('finds tools by keyword in description', () => {
      const result = ToolSearchTool.execute({ query: 'Kusto' });
      const data = JSON.parse(result.data!);
      expect(data.matches.some((m: any) => m.name === 'kusto_query')).toBe(true);
    });

    it('finds tools by searchHint', () => {
      const result = ToolSearchTool.execute({ query: 'KQL' });
      const data = JSON.parse(result.data!);
      expect(data.matches.some((m: any) => m.name === 'kusto_query')).toBe(true);
    });

    it('respects max_results', () => {
      const result = ToolSearchTool.execute({ query: 'ado', max_results: 1 });
      const data = JSON.parse(result.data!);
      expect(data.matches).toHaveLength(1);
    });
  });

  describe('execute — +server prefix', () => {
    it('requires server name match with + prefix', () => {
      const result = ToolSearchTool.execute({ query: '+ado query' });
      const data = JSON.parse(result.data!);
      expect(data.matches.length).toBeGreaterThan(0);
      expect(data.matches.every((m: any) => m.serverName.includes('ado') || m.name.includes('ado'))).toBe(true);
    });

    it('returns no results when server prefix does not match', () => {
      const result = ToolSearchTool.execute({ query: '+nonexistent query' });
      const data = JSON.parse(result.data!);
      expect(data.matches).toHaveLength(0);
    });
  });

  describe('execute — empty context', () => {
    it('returns empty when no deferred tools exist', () => {
      vi.mocked(BuiltinToolsManager.getDeferredToolsContext).mockReturnValue(null);
      const result = ToolSearchTool.execute({ query: 'anything' });
      const data = JSON.parse(result.data!);
      expect(data.matches).toHaveLength(0);
      expect(data.total_deferred_tools).toBe(0);
    });
  });

  describe('execute — metadata', () => {
    it('includes total_deferred_tools count', () => {
      const result = ToolSearchTool.execute({ query: 'ado_query' });
      const data = JSON.parse(result.data!);
      expect(data.total_deferred_tools).toBe(DEFERRED_TOOLS.length);
    });

    it('includes query in result', () => {
      const result = ToolSearchTool.execute({ query: 'test query' });
      const data = JSON.parse(result.data!);
      expect(data.query).toBe('test query');
    });
  });
});
