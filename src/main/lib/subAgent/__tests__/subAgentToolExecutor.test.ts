// @ts-nocheck
/**
 * SubAgentToolExecutor unit tests
 *
 * Covers:
 * - executeToolCalls: setExecutionContext called with isSubAgent=true,
 *   cancellation check mid-loop, invalid JSON arguments,
 *   onStepUpdate tool_start/tool_done/tool_error,
 *   MCP server name resolution (resolvedMcpServers vs config.mcp_servers),
 *   non-string tool result → JSON.stringify,
 *   result > SUMMARIZE_THRESHOLD → compressToolResult called,
 *   trackDeliverables called
 * - trackDeliverables: all branches (write_file/create_file/append_to_file,
 *   download_file, present_deliverables, unknown tool, dedup)
 * - formatDeliverablesSection: empty and non-empty
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockExecuteTool = vi.fn();
vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    executeTool: (...args: any[]) => mockExecuteTool(...args),
  },
}));

const mockSetExecutionContext = vi.fn();
const mockClearExecutionContext = vi.fn();
vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    setExecutionContext: (...args: any[]) => mockSetExecutionContext(...args),
    clearExecutionContext: (...args: any[]) => mockClearExecutionContext(...args),
  },
}));

// ─── Imports ───

import { SubAgentToolExecutor } from '../subAgentToolExecutor';
import type { CancellationToken } from '../../cancellation/CancellationToken';

// ─── Helpers ───

function makeCancellationToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function makeOptions(overrides: any = {}): any {
  return {
    subAgent: {
      inheritedModel: 'gpt-4o',
      parentSessionId: 'session-1',
      parentChatId: 'chat-1',
      userAlias: 'testUser',
      resolvedMcpServers: [],
      config: { mcp_servers: [] },
      taskId: 'sa-1',
    },
    task: 'test task',
    cancellationToken: makeCancellationToken(),
    currentUserAlias: 'testUser',
    onStepUpdate: vi.fn(),
    ...overrides,
  };
}

function makeToolCall(name: string, args: string | object, id = 'call-1'): any {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
    },
  };
}

const noopCompress = vi.fn(async (content: string) => content);

function makeExecutor(options?: any, deliverables: string[] = [], compress = noopCompress) {
  return new SubAgentToolExecutor(options ?? makeOptions(), deliverables, compress);
}

// ─── Tests ───

describe('SubAgentToolExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteTool.mockResolvedValue('tool result');
  });

  // ── setExecutionContext ──
  describe('executeToolCalls — execution context', () => {
    it('calls setExecutionContext with isSubAgent=true', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([makeToolCall('web_search', { query: 'test' })], 0);

      expect(mockSetExecutionContext).toHaveBeenCalledOnce();
      const ctx = mockSetExecutionContext.mock.calls[0][0];
      expect(ctx.isSubAgent).toBe(true);
      expect(ctx.chatSessionId).toBe('session-1');
      expect(ctx.chatId).toBe('chat-1');
    });

    it('calls clearExecutionContext in finally block even on error', async () => {
      mockExecuteTool.mockRejectedValueOnce(new Error('tool error'));
      const opts = makeOptions();
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([makeToolCall('failing_tool', {})], 0);

      expect(mockClearExecutionContext).toHaveBeenCalledOnce();
    });

    it('getSubAgentConfig returns undefined', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([], 0);

      const ctx = mockSetExecutionContext.mock.calls[0][0];
      expect(ctx.getSubAgentConfig('any')).toBeUndefined();
    });

    it('getParentContextSummary resolves to empty string', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([], 0);

      const ctx = mockSetExecutionContext.mock.calls[0][0];
      await expect(ctx.getParentContextSummary()).resolves.toBe('');
    });
  });

  // ── Cancellation mid-loop ──
  describe('executeToolCalls — cancellation', () => {
    it('pushes cancellation message and continues when cancelled mid-loop', async () => {
      const cancelToken = makeCancellationToken(false);
      const opts = makeOptions({ cancellationToken: cancelToken });
      const executor = makeExecutor(opts);

      const toolCalls = [
        makeToolCall('web_search', { query: 'first' }, 'call-1'),
        makeToolCall('web_search', { query: 'second' }, 'call-2'),
      ];

      // Cancel after first iteration is about to start
      mockExecuteTool.mockImplementation(async () => {
        (cancelToken as any).isCancellationRequested = true;
        return 'ok';
      });

      const results = await executor.executeToolCalls(toolCalls, 0);

      // First tool executes, second is cancelled → 2 results total
      expect(results).toHaveLength(2);
      const secondResult = results[1];
      const content = secondResult.content?.[0]?.text ?? secondResult.content;
      expect(typeof content === 'string' ? content : JSON.stringify(content)).toContain('cancelled');
    });

    it('immediately cancels first tool when token already cancelled', async () => {
      const opts = makeOptions({ cancellationToken: makeCancellationToken(true) });
      const executor = makeExecutor(opts);

      const results = await executor.executeToolCalls([makeToolCall('web_search', {})], 0);
      expect(results).toHaveLength(1);
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : JSON.stringify(content)).toContain('cancelled');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  // ── Invalid JSON arguments ──
  describe('executeToolCalls — invalid JSON arguments', () => {
    it('falls back to empty toolArgs when JSON.parse fails', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);

      const tc = makeToolCall('web_search', 'NOT VALID JSON { {', 'call-bad');
      mockExecuteTool.mockResolvedValue('some result');

      const results = await executor.executeToolCalls([tc], 0);
      expect(results).toHaveLength(1);
      // Should not throw; tool still executes with {} args
      expect(mockExecuteTool).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'web_search', toolArgs: {} }),
      );
    });
  });

  // ── onStepUpdate ──
  describe('executeToolCalls — onStepUpdate', () => {
    it('fires tool_start before execution', async () => {
      const onStepUpdate = vi.fn();
      const opts = makeOptions({ onStepUpdate });
      const executor = makeExecutor(opts);

      await executor.executeToolCalls([makeToolCall('web_search', { query: 'test' })], 2);

      const startCalls = onStepUpdate.mock.calls.filter(([u]) => u.type === 'tool_start');
      expect(startCalls).toHaveLength(1);
      expect(startCalls[0][0]).toMatchObject({
        type: 'tool_start',
        toolCallId: 'call-1',
        toolName: 'web_search',
        turn: 3,
      });
      expect(startCalls[0][0].toolArgsSummary).toContain('web_search');
    });

    it('fires tool_done after successful execution', async () => {
      const onStepUpdate = vi.fn();
      const opts = makeOptions({ onStepUpdate });
      const executor = makeExecutor(opts);

      await executor.executeToolCalls([makeToolCall('web_search', { query: 'test' })], 0);

      const doneCalls = onStepUpdate.mock.calls.filter(([u]) => u.type === 'tool_done');
      expect(doneCalls).toHaveLength(1);
      expect(doneCalls[0][0]).toMatchObject({
        type: 'tool_done',
        toolCallId: 'call-1',
        toolName: 'web_search',
        turn: 1,
      });
      expect(typeof doneCalls[0][0].durationMs).toBe('number');
    });

    it('fires tool_error after failed execution', async () => {
      const onStepUpdate = vi.fn();
      const opts = makeOptions({ onStepUpdate });
      const executor = makeExecutor(opts);

      mockExecuteTool.mockRejectedValueOnce(new Error('network error'));

      await executor.executeToolCalls([makeToolCall('web_search', { query: 'test' })], 1);

      const errorCalls = onStepUpdate.mock.calls.filter(([u]) => u.type === 'tool_error');
      expect(errorCalls).toHaveLength(1);
      expect(errorCalls[0][0]).toMatchObject({
        type: 'tool_error',
        toolCallId: 'call-1',
        turn: 2,
      });
    });

    it('pushes error message result on tool failure', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);

      mockExecuteTool.mockRejectedValueOnce(new Error('tool_exploded'));

      const results = await executor.executeToolCalls([makeToolCall('bad_tool', {})], 0);
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain('tool_exploded');
    });
  });

  // ── MCP server name resolution ──
  describe('executeToolCalls — MCP server resolution', () => {
    it('uses resolvedMcpServers when non-empty', async () => {
      const opts = makeOptions({
        subAgent: {
          inheritedModel: 'gpt-4o',
          parentSessionId: 'session-1',
          parentChatId: 'chat-1',
          userAlias: 'testUser',
          resolvedMcpServers: [
            { name: 'server-a', connected: true, tools: ['tool1'], inherited: false },
          ],
          config: { mcp_servers: [{ name: 'config-server' }] },
          taskId: 'sa-1',
        },
      });
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([makeToolCall('tool1', {})], 0);

      expect(mockExecuteTool).toHaveBeenCalledWith(
        expect.objectContaining({ agentMcpServerNames: ['server-a'] }),
      );
    });

    it('falls back to config.mcp_servers when resolvedMcpServers is empty', async () => {
      const opts = makeOptions({
        subAgent: {
          inheritedModel: 'gpt-4o',
          parentSessionId: 'session-1',
          parentChatId: 'chat-1',
          userAlias: 'testUser',
          resolvedMcpServers: [],
          config: { mcp_servers: [{ name: 'fallback-server' }] },
          taskId: 'sa-1',
        },
      });
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([makeToolCall('some_tool', {})], 0);

      expect(mockExecuteTool).toHaveBeenCalledWith(
        expect.objectContaining({ agentMcpServerNames: ['fallback-server'] }),
      );
    });

    it('uses empty agentMcpServerNames when both are empty', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([makeToolCall('some_tool', {})], 0);

      expect(mockExecuteTool).toHaveBeenCalledWith(
        expect.objectContaining({ agentMcpServerNames: [] }),
      );
    });
  });

  // ── Non-string tool result ──
  describe('executeToolCalls — result serialization', () => {
    it('JSON.stringifies non-string tool result', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);

      mockExecuteTool.mockResolvedValue({ key: 'value', num: 42 });

      const results = await executor.executeToolCalls([makeToolCall('some_tool', {})], 0);
      const content = results[0].content?.[0]?.text ?? results[0].content;
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      expect(contentStr).toContain('"key"');
      expect(contentStr).toContain('"value"');
    });
  });

  // ── Compression threshold ──
  describe('executeToolCalls — compress large result', () => {
    it('calls compressToolResult when result exceeds threshold', async () => {
      const opts = makeOptions();
      const largeResult = 'X'.repeat(16000);
      mockExecuteTool.mockResolvedValue(largeResult);

      const compress = vi.fn(async (content: string, name: string, origLen: number) =>
        `[Compressed from ${origLen}]`
      );
      const executor = makeExecutor(opts, [], compress);

      const results = await executor.executeToolCalls([makeToolCall('big_tool', {})], 0);
      expect(compress).toHaveBeenCalledOnce();
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain('[Compressed from');
    });

    it('does not call compressToolResult when result is below threshold', async () => {
      const opts = makeOptions();
      mockExecuteTool.mockResolvedValue('small result');

      const compress = vi.fn(async (content: string) => content);
      const executor = makeExecutor(opts, [], compress);

      await executor.executeToolCalls([makeToolCall('small_tool', {})], 0);
      expect(compress).not.toHaveBeenCalled();
    });
  });

  // ── trackDeliverables ──
  describe('trackDeliverables', () => {
    it('tracks write_file with filePath', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('write_file', { filePath: '/out/result.txt' });
      expect(deliverables).toContain('/out/result.txt');
    });

    it('tracks write_file with file_path (snake_case)', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('write_file', { file_path: '/out/snake.txt' });
      expect(deliverables).toContain('/out/snake.txt');
    });

    it('tracks create_file', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('create_file', { filePath: '/out/new.txt' });
      expect(deliverables).toContain('/out/new.txt');
    });

    it('tracks append_to_file', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('append_to_file', { filePath: '/out/append.txt' });
      expect(deliverables).toContain('/out/append.txt');
    });

    it('does not duplicate entries', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('write_file', { filePath: '/out/result.txt' });
      executor.trackDeliverables('write_file', { filePath: '/out/result.txt' });
      expect(deliverables).toHaveLength(1);
    });

    it('tracks download_file with saveDirectory + filename (unix)', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('download_file', { saveDirectory: '/downloads', filename: 'data.csv' });
      expect(deliverables).toContain('/downloads/data.csv');
    });

    it('tracks download_file with Windows-style saveDirectory', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('download_file', {
        saveDirectory: 'C:\\Users\\user\\Downloads',
        filename: 'report.pdf',
      });
      expect(deliverables).toContain('C:\\Users\\user\\Downloads\\report.pdf');
    });

    it('skips download_file when directory or filename missing', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('download_file', { saveDirectory: '/downloads' }); // no filename
      expect(deliverables).toHaveLength(0);
    });

    it('tracks present_deliverables filePaths array', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('present_deliverables', {
        filePaths: ['/out/a.txt', '/out/b.txt'],
      });
      expect(deliverables).toContain('/out/a.txt');
      expect(deliverables).toContain('/out/b.txt');
    });

    it('skips present_deliverables when filePaths is not an array', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('present_deliverables', { filePaths: '/out/single.txt' });
      expect(deliverables).toHaveLength(0);
    });

    it('skips non-file tools', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('read_file', { filePath: '/out/result.txt' });
      expect(deliverables).toHaveLength(0);
    });

    it('skips empty filePath string', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('write_file', { filePath: '' });
      expect(deliverables).toHaveLength(0);
    });

    it('handles exceptions without throwing', () => {
      const executor = makeExecutor();
      expect(() => executor.trackDeliverables('write_file', null as any)).not.toThrow();
    });
  });

  // ── trackDeliverables called from executeToolCalls ──
  describe('executeToolCalls — trackDeliverables integration', () => {
    it('auto-tracks file deliverables after successful tool execution', async () => {
      const opts = makeOptions();
      const deliverables: string[] = [];
      const executor = makeExecutor(opts, deliverables);

      mockExecuteTool.mockResolvedValue('ok');

      await executor.executeToolCalls(
        [makeToolCall('write_file', { filePath: '/out/auto.txt' })],
        0,
      );

      expect(deliverables).toContain('/out/auto.txt');
    });
  });

  // ── formatDeliverablesSection ──
  describe('formatDeliverablesSection', () => {
    it('returns empty string when no deliverables', () => {
      const executor = makeExecutor();
      expect(executor.formatDeliverablesSection()).toBe('');
    });

    it('returns formatted section with file list', () => {
      const deliverables = ['/out/a.txt', '/out/b.md'];
      const executor = makeExecutor(undefined, deliverables);
      const section = executor.formatDeliverablesSection();
      expect(section).toContain('Deliverables');
      expect(section).toContain('2 file(s)');
      expect(section).toContain('/out/a.txt');
      expect(section).toContain('/out/b.md');
    });
  });

  // ── Multiple tool calls ──
  describe('executeToolCalls — multiple calls', () => {
    it('returns results for all tool calls in order', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);

      mockExecuteTool
        .mockResolvedValueOnce('result-1')
        .mockResolvedValueOnce('result-2');

      const results = await executor.executeToolCalls(
        [
          makeToolCall('tool_a', { query: 'first' }, 'id-1'),
          makeToolCall('tool_b', { query: 'second' }, 'id-2'),
        ],
        0,
      );

      expect(results).toHaveLength(2);
      expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    });

    it('continues executing remaining calls after one fails', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);

      mockExecuteTool
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce('result-2');

      const results = await executor.executeToolCalls(
        [
          makeToolCall('tool_a', {}, 'id-1'),
          makeToolCall('tool_b', {}, 'id-2'),
        ],
        0,
      );

      expect(results).toHaveLength(2);
      // First result should be error message
      const firstContent = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof firstContent === 'string' ? firstContent : '').toContain('first failed');
    });
  });

  // ── Empty tool calls ──
  describe('executeToolCalls — empty input', () => {
    it('returns empty array for empty toolCalls', async () => {
      const executor = makeExecutor();
      const results = await executor.executeToolCalls([], 0);
      expect(results).toEqual([]);
      expect(mockSetExecutionContext).toHaveBeenCalledOnce();
      expect(mockClearExecutionContext).toHaveBeenCalledOnce();
    });
  });
});
