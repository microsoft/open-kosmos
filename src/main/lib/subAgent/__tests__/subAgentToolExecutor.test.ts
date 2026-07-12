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
const mockIsBuiltinTool = vi.fn();
vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  BUILTIN_SERVER_NAME: 'builtin-tools',
  SUB_AGENT_BLOCKED_TOOLS: new Set([
    'sub_agent',
    'computer_use',
    'send_to_subagent',
  ]),
  mcpClientManager: {
    executeTool: (...args: any[]) => mockExecuteTool(...args),
    isBuiltinTool: (...args: any[]) => mockIsBuiltinTool(...args),
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
import { SELF_MANAGED_IDLE_TOOLS, TOOL_IDLE_TIMEOUT_MS } from '../../mcpRuntime/toolTimeoutPolicy';

// ─── Helpers ───

function makeCancellationToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function makeControllableCancellationToken(): CancellationToken & { cancel(): void } {
  let handler: (() => void) | undefined;
  return {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn((cb: () => void) => {
      handler = cb;
      return { dispose: vi.fn(() => { handler = undefined; }) };
    }),
    cancel() {
      this.isCancellationRequested = true;
      handler?.();
    },
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
    mockIsBuiltinTool.mockReturnValue(true);
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

    it('getParentContextSummary resolves to empty string', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([makeToolCall('web_search', { query: 'test' })], 0);

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

  // ── Sub-agent builtin idle watchdog ──
  describe('executeToolCalls — builtin no-response watchdog', () => {
    it('aborts silent builtin tools after the shared idle budget', async () => {
      mockIsBuiltinTool.mockReturnValue(true);
      let observedSignal: AbortSignal | undefined;
      let lateReject!: (reason: unknown) => void;
      mockExecuteTool.mockImplementation(({ signal }) => {
        observedSignal = signal;
        return new Promise((_resolve, reject) => { lateReject = reject; });
      });

      const executor = makeExecutor();
      vi.useFakeTimers();
      try {
        const resultsPromise = executor.executeToolCalls(
          [makeToolCall('execute_command', { command: 'sleep 600' })],
          0,
        );
        await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS + 10);
        const results = await resultsPromise;

        expect(observedSignal?.aborted).toBe(true);
        const content = results[0].content?.[0]?.text ?? results[0].content;
        expect(typeof content === 'string' ? content : '').toContain('produced no response');
        lateReject(new Error('late tool rejection'));
        await Promise.resolve();
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets the sub-agent builtin idle budget when the tool reports activity', async () => {
      mockIsBuiltinTool.mockReturnValue(true);
      let resolveTool!: (value: string) => void;
      mockExecuteTool.mockImplementation(() => new Promise<string>((resolve) => {
        resolveTool = resolve;
      }));

      const executor = makeExecutor();
      vi.useFakeTimers();
      try {
        const resultsPromise = executor.executeToolCalls(
          [makeToolCall('execute_command', { command: 'long-running-with-output' })],
          0,
        );
        await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 1000);
        const ctx = mockSetExecutionContext.mock.calls[0][0];
        ctx.reportActivity();
        await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 1000);
        resolveTool('done');

        const results = await resultsPromise;
        const content = results[0].content?.[0]?.text ?? results[0].content;
        expect(typeof content === 'string' ? content : '').toContain('done');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not double-watch self-managed builtin tools', async () => {
      expect(SELF_MANAGED_IDLE_TOOLS.has('coding_agent')).toBe(true);
      mockIsBuiltinTool.mockReturnValue(true);
      let resolveTool!: (value: string) => void;
      mockExecuteTool.mockImplementation(() => new Promise<string>((resolve) => {
        resolveTool = resolve;
      }));

      const executor = makeExecutor();
      vi.useFakeTimers();
      try {
        const resultsPromise = executor.executeToolCalls(
          [makeToolCall('coding_agent', { task: 'work', cwd: '/tmp' })],
          0,
        );
        await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS + 10);
        resolveTool('self-managed result');

        const results = await resultsPromise;
        const content = results[0].content?.[0]?.text ?? results[0].content;
        expect(typeof content === 'string' ? content : '').toContain('self-managed result');
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses sub-agent scoped routing when deciding whether to arm the builtin watchdog', async () => {
      mockIsBuiltinTool.mockImplementation((_toolName, agentServers) => !agentServers?.includes('agent-server'));
      let resolveTool!: (value: string) => void;
      let observedSignal: AbortSignal | undefined;
      mockExecuteTool.mockImplementation(({ signal }) => {
        observedSignal = signal;
        return new Promise<string>((resolve) => { resolveTool = resolve; });
      });
      const opts = makeOptions({
        subAgent: {
          ...makeOptions().subAgent,
          resolvedMcpServers: [{ name: 'agent-server', tools: ['shared_tool'] }],
        },
      });

      const executor = makeExecutor(opts);
      vi.useFakeTimers();
      try {
        const resultsPromise = executor.executeToolCalls(
          [makeToolCall('shared_tool', { query: 'active external tool' })],
          0,
        );

        expect(mockIsBuiltinTool).toHaveBeenCalledWith('shared_tool', ['agent-server'], true);
        const ctx = mockSetExecutionContext.mock.calls[0][0];
        expect(ctx.reportActivity).toBeUndefined();
        await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS + 10);
        expect(observedSignal?.aborted).toBe(false);

        resolveTool('external result');
        const results = await resultsPromise;
        const content = results[0].content?.[0]?.text ?? results[0].content;
        expect(typeof content === 'string' ? content : '').toContain('external result');
      } finally {
        vi.useRealTimers();
      }
    });

    it('runs registered cancellation handlers when the parent cancellation token fires', async () => {
      mockIsBuiltinTool.mockReturnValue(true);
      const cancellationToken = makeControllableCancellationToken();
      const handler = vi.fn();
      let observedSignal: AbortSignal | undefined;
      mockExecuteTool.mockImplementation(({ signal }) => {
        observedSignal = signal;
        const ctx = mockSetExecutionContext.mock.calls[0][0];
        ctx.registerCancellationHandler(handler);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted by token')), { once: true });
        });
      });

      const executor = makeExecutor(makeOptions({ cancellationToken }));
      const resultsPromise = executor.executeToolCalls(
        [makeToolCall('execute_command', { command: 'sleep 600' })],
        0,
      );
      cancellationToken.cancel();
      const results = await resultsPromise;

      expect(observedSignal?.aborted).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain('aborted by token');
    });

    it('does not run disposed cancellation handlers', async () => {
      mockIsBuiltinTool.mockReturnValue(true);
      const cancellationToken = makeControllableCancellationToken();
      const handler = vi.fn();
      mockExecuteTool.mockImplementation(async () => {
        const ctx = mockSetExecutionContext.mock.calls[0][0];
        const registration = ctx.registerCancellationHandler(handler);
        registration.dispose();
        cancellationToken.cancel();
        return 'completed after disposed handler';
      });

      const executor = makeExecutor(makeOptions({ cancellationToken }));
      const results = await executor.executeToolCalls(
        [makeToolCall('execute_command', { command: 'echo ok' })],
        0,
      );

      expect(handler).not.toHaveBeenCalled();
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain('completed after disposed handler');
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

    it('stringifies non-Error tool failures', async () => {
      const executor = makeExecutor();
      mockExecuteTool.mockRejectedValueOnce('plain failure');

      const results = await executor.executeToolCalls([makeToolCall('bad_tool', {})], 0);

      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain('plain failure');
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
        expect.objectContaining({
          agentMcpServerNames: ['server-a'],
          strictAgentMcpServerNames: true,
        }),
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
          config: { mcp_servers: [{ name: 'fallback-server', tools: ['some_tool'] }] },
          taskId: 'sa-1',
        },
      });
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([makeToolCall('some_tool', {})], 0);

      expect(mockExecuteTool).toHaveBeenCalledWith(
        expect.objectContaining({
          agentMcpServerNames: ['fallback-server'],
          strictAgentMcpServerNames: true,
        }),
      );
    });

    it('rejects config MCP servers that do not explicitly list the called tool', async () => {
      mockIsBuiltinTool.mockReturnValue(false);
      const opts = makeOptions({
        subAgent: {
          inheritedModel: 'gpt-4o',
          parentSessionId: 'session-1',
          parentChatId: 'chat-1',
          userAlias: 'testUser',
          resolvedMcpServers: [],
          config: { mcp_servers: [{ name: 'fallback-server', tools: [] }] },
          taskId: 'sa-1',
        },
      });
      const executor = makeExecutor(opts);

      const results = await executor.executeToolCalls([makeToolCall('some_tool', {})], 0);

      expect(mockExecuteTool).not.toHaveBeenCalled();
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain(
        "Tool 'some_tool' is not available to this sub-agent",
      );
    });

    it('uses builtin-only routing when no external MCP servers are allowed', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);
      await executor.executeToolCalls([makeToolCall('some_tool', {})], 0);

      expect(mockExecuteTool).toHaveBeenCalledWith(
        expect.objectContaining({
          agentMcpServerNames: ['builtin-tools'],
          strictAgentMcpServerNames: true,
        }),
      );
    });

    it('rejects non-builtin tools when no external MCP servers are allowed', async () => {
      mockIsBuiltinTool.mockReturnValue(false);
      const opts = makeOptions();
      const executor = makeExecutor(opts);

      const results = await executor.executeToolCalls([makeToolCall('web_search', {})], 0);

      expect(mockExecuteTool).not.toHaveBeenCalled();
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain(
        "Tool 'web_search' is not available to this sub-agent",
      );
    });

    it('rejects tool calls outside the explicit ad-hoc allowlist', async () => {
      const opts = makeOptions({
        allowedToolNames: new Set(['read_file']),
      });
      const executor = makeExecutor(opts);

      const results = await executor.executeToolCalls([makeToolCall('write_file', {})], 0);

      expect(mockExecuteTool).not.toHaveBeenCalled();
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain(
        "Tool 'write_file' is not allowed for this sub-agent",
      );
    });

    it('rejects blocked builtin tools even when the builtin server exposes them', async () => {
      const opts = makeOptions();
      const executor = makeExecutor(opts);

      const results = await executor.executeToolCalls([makeToolCall('sub_agent', {})], 0);

      expect(mockExecuteTool).not.toHaveBeenCalled();
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain(
        "Tool 'sub_agent' is unavailable to sub-agents",
      );
    });

    it('rejects blocked tools before matching external MCP server bindings', async () => {
      const opts = makeOptions({
        allowedToolNames: new Set(['computer_use']),
        subAgent: {
          inheritedModel: 'gpt-4o',
          parentSessionId: 'session-1',
          parentChatId: 'chat-1',
          userAlias: 'testUser',
          resolvedMcpServers: [
            { name: 'external-server', connected: true, tools: ['computer_use'], inherited: true },
          ],
          config: { mcp_servers: [] },
          taskId: 'sa-1',
        },
      });
      const executor = makeExecutor(opts);

      const results = await executor.executeToolCalls([makeToolCall('computer_use', {})], 0);

      expect(mockExecuteTool).not.toHaveBeenCalled();
      const content = results[0].content?.[0]?.text ?? results[0].content;
      expect(typeof content === 'string' ? content : '').toContain(
        "Tool 'computer_use' is unavailable to sub-agents",
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

    it('tracks download_file with save_directory alias', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('download_file', { save_directory: '/downloads', filename: 'alias.csv' });
      expect(deliverables).toContain('/downloads/alias.csv');
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

    it('excludes missingFiles from present_deliverables when toolResult has them', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('present_deliverables', {
        filePaths: ['/out/good.txt', '/out/missing.txt', '/out/also-good.txt'],
      }, { missingFiles: ['/out/missing.txt'] });
      expect(deliverables).toContain('/out/good.txt');
      expect(deliverables).toContain('/out/also-good.txt');
      expect(deliverables).not.toContain('/out/missing.txt');
    });

    it('excludes missingFiles when toolResult is a JSON string (runtime shape)', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('present_deliverables', {
        filePaths: ['/out/good.txt', '/out/missing.txt'],
      }, JSON.stringify({ missingFiles: ['/out/missing.txt'] }));
      expect(deliverables).toContain('/out/good.txt');
      expect(deliverables).not.toContain('/out/missing.txt');
    });

    it('tracks all files when toolResult is an unparseable string', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('present_deliverables', {
        filePaths: ['/out/a.txt'],
      }, 'not json');
      expect(deliverables).toContain('/out/a.txt');
    });

    it('tracks all files when toolResult has no missingFiles', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('present_deliverables', {
        filePaths: ['/out/a.txt', '/out/b.txt'],
      }, {});
      expect(deliverables).toContain('/out/a.txt');
      expect(deliverables).toContain('/out/b.txt');
    });

    it('tracks all files when toolResult is undefined', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('present_deliverables', {
        filePaths: ['/out/a.txt'],
      });
      expect(deliverables).toContain('/out/a.txt');
    });

    it('excludes all files when all are missing', () => {
      const deliverables: string[] = [];
      const executor = makeExecutor(undefined, deliverables);
      executor.trackDeliverables('present_deliverables', {
        filePaths: ['/out/a.txt', '/out/b.txt'],
      }, { missingFiles: ['/out/a.txt', '/out/b.txt'] });
      expect(deliverables).toHaveLength(0);
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
      expect(mockSetExecutionContext).not.toHaveBeenCalled();
      expect(mockClearExecutionContext).not.toHaveBeenCalled();
    });
  });
});
