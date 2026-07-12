const { mockExecuteTool, mockSetExecutionContext, mockClearExecutionContext, mockIsBuiltinTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn().mockResolvedValue({ content: [] }),
  mockSetExecutionContext: vi.fn(),
  mockClearExecutionContext: vi.fn(),
  mockIsBuiltinTool: vi.fn((_toolName?: string, _agentServers?: string[]) => false),
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    getToolsForServer: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({ content: [] }),
    getRunningServers: vi.fn(() => []),
    executeTool: mockExecuteTool,
    isBuiltinTool: mockIsBuiltinTool,
  },
}));

vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    getInstance: vi.fn(() => ({
      getTools: vi.fn(() => []),
      callTool: vi.fn().mockResolvedValue({ content: [] }),
    })),
    setExecutionContext: mockSetExecutionContext,
    clearExecutionContext: mockClearExecutionContext,
  },
}));

import { AgentChatToolExecutor, type AgentChatToolExecutorDeps } from '../agentChatToolExecutor';
import { CancellationError, CancellationTokenSource } from '../../cancellation';
import { TOOL_IDLE_TIMEOUT_MS, ToolIdleTimeoutError } from '../../mcpRuntime/toolTimeoutPolicy';

function createExecutor(overrides: Partial<AgentChatToolExecutorDeps> = {}) {
  let nonce = 0;
  let activeHandler: (() => Promise<void> | void) | null = null;
  const currentChatSession = overrides.getCurrentChatSession !== undefined ? undefined : {
    chat_history: [],
    context_history: [],
  } as any;

  return new AgentChatToolExecutor({
    getAgentName: () => 'OpenKosmos',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    getCurrentUserAlias: () => 'user',
    getCurrentCancellationToken: () => undefined,
    getCurrentToolExecutionNonce: () => nonce,
    setCurrentToolExecutionNonce: (next) => { nonce = next; },
    getActiveToolCancellationHandler: () => activeHandler,
    setActiveToolCancellationHandler: (handler) => { activeHandler = handler; },
    getEventSender: () => null,
    getInteractionPolicy: () => 'allow-ui',
    currentModelSupportsTools: () => true,
    getCurrentModelId: () => 'gpt-5',
    getContextSummary: () => '',
    getCurrentChatSession: () => currentChatSession as any,
    getCurrentUserMessageId: () => undefined,
    saveChatSession: vi.fn().mockResolvedValue({ success: true }),
    getSkipPersistence: () => false,
    getAgentMcpServerNames: () => [],
    ...overrides,
  });
}

describe('AgentChatToolExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteTool.mockResolvedValue({ content: [] });
    mockIsBuiltinTool.mockReturnValue(false);
  });

  // ── executeToolCall ─────────────────────────────────────────────────────────

  it('returns a structured truncated-arguments error instead of throwing', async () => {
    const executor = createExecutor();

    const result = await executor.executeToolCall({
      id: 'tool-1',
      function: { name: 'test_tool', arguments: '{"foo": [1, 2}' },
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'Tool arguments were truncated',
      tool_call_id: 'tool-1',
      tool_name: 'test_tool',
      truncated: true,
    }));
  });

  it('throws when the model does not support tools', async () => {
    const executor = createExecutor({ currentModelSupportsTools: () => false, getCurrentModelId: () => 'no-tools-model' });

    await expect(executor.executeToolCall({ id: 't1', function: { name: 'x', arguments: '{}' } })).rejects.toThrow(
      'no-tools-model does not support tool calls',
    );
  });

  it('returns a parse-error result for genuinely invalid JSON', async () => {
    const executor = createExecutor();

    const result = await executor.executeToolCall({
      id: 'tool-2',
      function: { name: 'bad_json', arguments: 'not-json' },
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'Invalid tool arguments',
      tool_call_id: 'tool-2',
      parseError: true,
    }));
  });

  it('returns a denied result when approved === false', async () => {
    const executor = createExecutor();

    const result = await executor.executeToolCall(
      { id: 'tool-3', function: { name: 'file_op', arguments: '{}' } },
      false,
    );

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'Tool execution denied by user',
      tool_call_id: 'tool-3',
      denied: true,
    }));
  });

  it('handles empty string arguments as empty object', async () => {
    const executor = createExecutor();

    await executor.executeToolCall({ id: 'tool-4', function: { name: 'no_args', arguments: '' } });

    expect(mockExecuteTool).toHaveBeenCalledWith(expect.objectContaining({ toolArgs: {} }));
  });

  it('calls mcpClientManager.executeTool with correct tool name and parsed args', async () => {
    const executor = createExecutor();
    mockExecuteTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }] });

    const result = await executor.executeToolCall({
      id: 'tool-5',
      function: { name: 'list_files', arguments: '{"path":"/tmp"}' },
    });

    expect(mockExecuteTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'list_files',
      toolArgs: { path: '/tmp' },
    }));
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }] });
  });

  it('captures execution context callbacks before dispatching built-in tools', async () => {
    const eventSender = {} as Electron.WebContents;
    const disposeTokenListener = vi.fn();
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn((cb: () => void) => {
        cb();
        return { dispose: disposeTokenListener };
      }),
    } as any;
    const executor = createExecutor({
      getEventSender: () => eventSender,
      getCurrentCancellationToken: () => cancellationToken,
      getContextSummary: () => 'parent summary',
      getCurrentUserMessageId: () => 'current-user-message',
      getAgentMcpServerNames: () => ['builtin'],
      getInteractionPolicy: () => 'forbid',
    });

    await executor.executeToolCall({ id: 'tool-context', function: { name: 'ctx_tool', arguments: undefined } });

    const context = mockSetExecutionContext.mock.calls[0][0];
    expect(context.agentName).toBe('OpenKosmos');
    expect(context.interactionPolicy).toBe('forbid');
    expect(context.eventSender).toBe(eventSender);
    expect(context.currentUserMessageId).toBe('current-user-message');
    await expect(context.getParentContextSummary()).resolves.toBe('parent summary');
    const registeredHandler = vi.fn();
    const registration = context.registerCancellationHandler(registeredHandler);
    registration.dispose();
    expect(cancellationToken.onCancellationRequested).toHaveBeenCalledTimes(1);
    expect(disposeTokenListener).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'ctx_tool',
      toolArgs: {},
      agentMcpServerNames: ['builtin'],
    }));
    expect(mockClearExecutionContext).toHaveBeenCalledTimes(1);
  });

  it('does not infer a capture anchor from older chat history when the current turn id is unavailable', async () => {
    const executor = createExecutor({
      getCurrentChatSession: () => ({
        chat_history: [
          { id: 'old-user', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'old' }] },
        ],
        context_history: [],
      } as any),
      getCurrentUserMessageId: () => undefined,
    });

    await executor.executeToolCall({ id: 'tool-no-anchor', function: { name: 'ctx_tool', arguments: '{}' } });

    const context = mockSetExecutionContext.mock.calls[0][0];
    expect(context.currentUserMessageId).toBeUndefined();
  });

  it('aborts the in-flight tool when the active cancellation handler runs', async () => {
    let activeHandler: (() => Promise<void> | void) | null = null;
    mockExecuteTool.mockImplementation(async ({ signal }) => {
      expect(signal.aborted).toBe(false);
      await activeHandler?.();
      expect(signal.aborted).toBe(true);
      return { content: [] };
    });
    const executor = createExecutor({
      getActiveToolCancellationHandler: () => activeHandler,
      setActiveToolCancellationHandler: (handler) => { activeHandler = handler; },
    });

    await executor.executeToolCall({ id: 'tool-abort', function: { name: 'abortable_tool', arguments: '{}' } });

    expect(activeHandler).toBeNull();
  });

  it('propagates MCP tool errors as thrown exceptions', async () => {
    const executor = createExecutor();
    mockExecuteTool.mockRejectedValue(new Error('MCP server unavailable'));

    await expect(
      executor.executeToolCall({ id: 'tool-6', function: { name: 'crash', arguments: '{}' } }),
    ).rejects.toThrow('MCP server unavailable');
  });

  // ── central no-response watchdog ────────────────────────────────────────────

  it('terminates a builtin tool that produces no response within the idle budget', async () => {
    vi.useFakeTimers();
    try {
      mockIsBuiltinTool.mockReturnValue(true);
      let capturedSignal: AbortSignal | undefined;
      mockExecuteTool.mockImplementation(({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal;
        return new Promise(() => {}); // never resolves -> simulates a hung tool
      });
      const executor = createExecutor();

      const callPromise = executor.executeToolCall({ id: 'idle-1', function: { name: 'slow_tool', arguments: '{}' } });
      callPromise.catch(() => {}); // avoid an unhandled rejection while we advance timers

      expect(capturedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS);

      await expect(callPromise).rejects.toBeInstanceOf(ToolIdleTimeoutError);
      expect(capturedSignal?.aborted).toBe(true);
      expect(mockClearExecutionContext).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the idle budget when the tool reports activity', async () => {
    vi.useFakeTimers();
    try {
      mockIsBuiltinTool.mockReturnValue(true);
      let capturedSignal: AbortSignal | undefined;
      mockExecuteTool.mockImplementation(({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal;
        return new Promise(() => {});
      });
      const executor = createExecutor();

      const callPromise = executor.executeToolCall({ id: 'idle-2', function: { name: 'slow_tool', arguments: '{}' } });
      callPromise.catch(() => {});

      const context = mockSetExecutionContext.mock.calls[0][0];
      expect(typeof context.reportActivity).toBe('function');

      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 1000);
      expect(capturedSignal?.aborted).toBe(false);
      context.reportActivity();
      // Total elapsed now exceeds one budget, but the reset keeps the tool alive.
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 1000);
      expect(capturedSignal?.aborted).toBe(false);
      // Cross the budget measured from the last activity.
      await vi.advanceTimersByTimeAsync(1000);
      expect(capturedSignal?.aborted).toBe(true);
      await expect(callPromise).rejects.toBeInstanceOf(ToolIdleTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not arm the watchdog for third-party MCP tools', async () => {
    vi.useFakeTimers();
    try {
      mockIsBuiltinTool.mockReturnValue(false);
      let resolveExec: (value: unknown) => void = () => {};
      let capturedSignal: AbortSignal | undefined;
      mockExecuteTool.mockImplementation(({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal;
        return new Promise((resolve) => { resolveExec = resolve; });
      });
      const executor = createExecutor();

      const callPromise = executor.executeToolCall({ id: 'mcp-1', function: { name: 'mcp_tool', arguments: '{}' } });

      const context = mockSetExecutionContext.mock.calls[0][0];
      expect(context.reportActivity).toBeUndefined();
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS * 2);
      expect(capturedSignal?.aborted).toBe(false);

      resolveExec({ content: [] });
      await expect(callPromise).resolves.toEqual({ content: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses agent-scoped routing when deciding whether to arm the builtin watchdog', async () => {
    vi.useFakeTimers();
    try {
      mockIsBuiltinTool.mockImplementation((_toolName?: string, agentServers?: string[]) => {
        return !agentServers?.includes('agent-server');
      });
      let resolveExec: (value: unknown) => void = () => {};
      let capturedSignal: AbortSignal | undefined;
      mockExecuteTool.mockImplementation(({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal;
        return new Promise((resolve) => { resolveExec = resolve; });
      });
      const executor = createExecutor({ getAgentMcpServerNames: () => ['agent-server'] });

      const callPromise = executor.executeToolCall({ id: 'scoped-1', function: { name: 'shared_tool', arguments: '{}' } });

      expect(mockIsBuiltinTool).toHaveBeenCalledWith('shared_tool', ['agent-server']);
      const context = mockSetExecutionContext.mock.calls[0][0];
      expect(context.reportActivity).toBeUndefined();
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS * 2);
      expect(capturedSignal?.aborted).toBe(false);

      resolveExec({ content: [] });
      await expect(callPromise).resolves.toEqual({ content: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not arm the watchdog for self-managed builtin tools (coding_agent)', async () => {
    vi.useFakeTimers();
    try {
      mockIsBuiltinTool.mockReturnValue(true);
      let resolveExec: (value: unknown) => void = () => {};
      let capturedSignal: AbortSignal | undefined;
      mockExecuteTool.mockImplementation(({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal;
        return new Promise((resolve) => { resolveExec = resolve; });
      });
      const executor = createExecutor();

      const callPromise = executor.executeToolCall({ id: 'ca-1', function: { name: 'coding_agent', arguments: '{}' } });

      const context = mockSetExecutionContext.mock.calls[0][0];
      expect(context.reportActivity).toBeUndefined();
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS * 2);
      expect(capturedSignal?.aborted).toBe(false);

      resolveExec({ content: [] });
      await expect(callPromise).resolves.toEqual({ content: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes the watchdog when a builtin tool completes normally', async () => {
    vi.useFakeTimers();
    try {
      mockIsBuiltinTool.mockReturnValue(true);
      let capturedSignal: AbortSignal | undefined;
      mockExecuteTool.mockImplementation(({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal;
        return Promise.resolve({ content: [] });
      });
      const executor = createExecutor();

      await executor.executeToolCall({ id: 'done-1', function: { name: 'fast_tool', arguments: '{}' } });

      // Advancing well past the budget must not abort after a clean completion.
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS * 2);
      expect(capturedSignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a builtin tool rejection while the watchdog is armed', async () => {
    mockIsBuiltinTool.mockReturnValue(true);
    mockExecuteTool.mockRejectedValue(new Error('builtin boom'));
    const executor = createExecutor();

    await expect(
      executor.executeToolCall({ id: 'b-err', function: { name: 'b_tool', arguments: '{}' } }),
    ).rejects.toThrow('builtin boom');
  });

  // ── assertExecutionActive ───────────────────────────────────────────────────

  it('throws CancellationError when the cancellation token is requested', () => {
    const cts = new CancellationTokenSource();
    cts.cancel();
    const executor = createExecutor({ getCurrentCancellationToken: () => cts.token });

    expect(() => executor.assertExecutionActive(cts.token, 0, 'test-stage')).toThrow(CancellationError);
  });

  it('throws CancellationError when the execution nonce has changed', () => {
    let nonce = 0;
    const executor = createExecutor({
      getCurrentToolExecutionNonce: () => nonce,
      setCurrentToolExecutionNonce: (next) => { nonce = next; },
    });
    // Advance the nonce externally to simulate stale execution
    nonce = 5;

    expect(() => executor.assertExecutionActive(undefined, 0, 'nonce-check')).toThrow(CancellationError);
  });

  it('does not throw when token is not cancelled and nonce matches', () => {
    const executor = createExecutor();
    // Should not throw with matching nonce = 0 and no token
    expect(() => executor.assertExecutionActive(undefined, 0, 'ok-stage')).not.toThrow();
  });

  // ── invalidateActiveExecution ───────────────────────────────────────────────

  it('increments the execution nonce', () => {
    let nonce = 3;
    const executor = createExecutor({
      getCurrentToolExecutionNonce: () => nonce,
      setCurrentToolExecutionNonce: (next) => { nonce = next; },
    });

    executor.invalidateActiveExecution();
    expect(nonce).toBe(4);
  });

  // ── cancelActiveToolExecution / registerActiveToolCancellationHandler ───────

  it('does nothing when no active handler is registered', async () => {
    const executor = createExecutor({ getActiveToolCancellationHandler: () => null });
    await expect(executor.cancelActiveToolExecution()).resolves.toBeUndefined();
  });

  it('calls and clears the active cancellation handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    let activeHandler: (() => Promise<void> | void) | null = handler;

    const executor = createExecutor({
      getActiveToolCancellationHandler: () => activeHandler,
      setActiveToolCancellationHandler: (h) => { activeHandler = h; },
    });

    await executor.cancelActiveToolExecution();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(activeHandler).toBeNull();
  });

  it('swallows errors thrown by the cancellation handler', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('cancel boom'));
    let activeHandler: (() => Promise<void> | void) | null = handler;

    const executor = createExecutor({
      getActiveToolCancellationHandler: () => activeHandler,
      setActiveToolCancellationHandler: (h) => { activeHandler = h; },
    });

    await expect(executor.cancelActiveToolExecution()).resolves.toBeUndefined();
  });

  it('swallows non-Error values thrown by the cancellation handler', async () => {
    const handler = vi.fn().mockRejectedValue('cancel boom');
    let activeHandler: (() => Promise<void> | void) | null = handler;

    const executor = createExecutor({
      getActiveToolCancellationHandler: () => activeHandler,
      setActiveToolCancellationHandler: (h) => { activeHandler = h; },
    });

    await expect(executor.cancelActiveToolExecution()).resolves.toBeUndefined();
  });

  it('dispose() clears the handler only if it is the same handler', () => {
    let activeHandler: (() => Promise<void> | void) | null = null;
    const executor = createExecutor({
      getActiveToolCancellationHandler: () => activeHandler,
      setActiveToolCancellationHandler: (h) => { activeHandler = h; },
    });

    const handlerA = vi.fn();
    const reg = executor.registerActiveToolCancellationHandler(handlerA);
    expect(activeHandler).toBe(handlerA);

    // Replace with a different handler before dispose
    const handlerB = vi.fn();
    activeHandler = handlerB;

    // dispose should NOT clear handlerB because it is not the registered handler
    reg.dispose();
    expect(activeHandler).toBe(handlerB);
  });

  it('dispose() clears the handler when it is the same handler', () => {
    let activeHandler: (() => Promise<void> | void) | null = null;
    const executor = createExecutor({
      getActiveToolCancellationHandler: () => activeHandler,
      setActiveToolCancellationHandler: (h) => { activeHandler = h; },
    });

    const handler = vi.fn();
    const reg = executor.registerActiveToolCancellationHandler(handler);
    reg.dispose();
    expect(activeHandler).toBeNull();
  });

  // ── cleanupIncompleteToolCalls ──────────────────────────────────────────────

  it('removes an empty assistant tool-call message when none of its tool calls executed', async () => {
    const currentChatSession = {
      chat_history: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [{ id: 'call-1', function: { name: 'tool_a', arguments: '{}' } }],
        },
      ],
      context_history: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [{ id: 'call-1', function: { name: 'tool_a', arguments: '{}' } }],
        },
      ],
    } as any;
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();

    expect(currentChatSession.chat_history).toEqual([]);
    expect(currentChatSession.context_history).toEqual([]);
    expect(saveChatSession).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no chat session', async () => {
    const saveChatSession = vi.fn();
    const executor = createExecutor({
      getCurrentChatSession: () => null,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();
    expect(saveChatSession).not.toHaveBeenCalled();
  });

  it('does nothing when chat history is empty', async () => {
    const currentChatSession = { chat_history: [], context_history: [] } as any;
    const saveChatSession = vi.fn();

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();
    expect(saveChatSession).not.toHaveBeenCalled();
  });

  it('does nothing when there are no assistant messages with tool calls', async () => {
    const currentChatSession = {
      chat_history: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      context_history: [],
    } as any;
    const saveChatSession = vi.fn();

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();
    expect(saveChatSession).not.toHaveBeenCalled();
  });

  it('does nothing when all tool calls have corresponding tool messages', async () => {
    const currentChatSession = {
      chat_history: [
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [{ id: 'call-1', function: { name: 'tool_a', arguments: '{}' } }],
        },
        { id: 't1', role: 'tool', tool_call_id: 'call-1', content: [{ type: 'text', text: 'result' }] },
      ],
      context_history: [],
    } as any;
    const saveChatSession = vi.fn();

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();
    expect(saveChatSession).not.toHaveBeenCalled();
  });

  it('keeps executed tool calls and strips unexecuted ones from the assistant message', async () => {
    const currentChatSession = {
      chat_history: [
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [
            { id: 'call-1', function: { name: 'tool_a', arguments: '{}' } },
            { id: 'call-2', function: { name: 'tool_b', arguments: '{}' } },
          ],
        },
        { id: 't1', role: 'tool', tool_call_id: 'call-1', content: [{ type: 'text', text: 'ok' }] },
        // call-2 has no corresponding tool message → should be stripped
      ],
      context_history: [
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [
            { id: 'call-1', function: { name: 'tool_a', arguments: '{}' } },
            { id: 'call-2', function: { name: 'tool_b', arguments: '{}' } },
          ],
        },
      ],
    } as any;
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();

    const assistantMsg = currentChatSession.chat_history[0];
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0].id).toBe('call-1');
    expect(saveChatSession).toHaveBeenCalledTimes(1);
  });

  it('keeps executed tool calls when the assistant message is absent from context history', async () => {
    const currentChatSession = {
      chat_history: [
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [
            { id: 'call-1', function: { name: 'tool_a', arguments: '{}' } },
            { id: 'call-2', function: { name: 'tool_b', arguments: '{}' } },
          ],
        },
        { id: 't1', role: 'tool', tool_call_id: 'call-1', content: [{ type: 'text', text: 'ok' }] },
      ],
      context_history: [],
    } as any;
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();

    expect(currentChatSession.chat_history[0].tool_calls).toHaveLength(1);
    expect(saveChatSession).toHaveBeenCalledTimes(1);
  });

  it('deletes an empty assistant message when it is absent from context history', async () => {
    const currentChatSession = {
      chat_history: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [{ id: 'call-1', function: { name: 'tool_a', arguments: '{}' } }],
        },
      ],
      context_history: [],
    } as any;
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();

    expect(currentChatSession.chat_history).toEqual([]);
    expect(saveChatSession).toHaveBeenCalledTimes(1);
  });

  it('clears tool_calls entirely and keeps content when assistant has text but all tool calls are unexecuted', async () => {
    const currentChatSession = {
      chat_history: [
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Thinking...' }],
          tool_calls: [{ id: 'call-1', function: { name: 'tool_a', arguments: '{}' } }],
        },
        // No tool messages → call-1 is unexecuted
      ],
      context_history: [
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Thinking...' }],
          tool_calls: [{ id: 'call-1', function: { name: 'tool_a', arguments: '{}' } }],
        },
      ],
    } as any;
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();

    const assistantMsg = currentChatSession.chat_history[0];
    // tool_calls stripped but content preserved
    expect(assistantMsg.tool_calls).toBeUndefined();
    expect(assistantMsg.content[0].text).toBe('Thinking...');
    expect(saveChatSession).toHaveBeenCalledTimes(1);
  });

  it('keeps assistant content when the message is absent from context history', async () => {
    const currentChatSession = {
      chat_history: [
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Thinking...' }],
          tool_calls: [{ id: 'call-1', function: { name: 'tool_a', arguments: '{}' } }],
        },
      ],
      context_history: [],
    } as any;
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });

    const executor = createExecutor({
      getCurrentChatSession: () => currentChatSession,
      saveChatSession,
    });

    await executor.cleanupIncompleteToolCalls();

    expect(currentChatSession.chat_history[0].tool_calls).toBeUndefined();
    expect(saveChatSession).toHaveBeenCalledTimes(1);
  });

  it('swallows cleanup errors after logging them', async () => {
    const executor = createExecutor({
      getAgentName: () => 'CleanupAgent',
      getCurrentChatSession: () => {
        throw new Error('session unavailable');
      },
    });

    await expect(executor.cleanupIncompleteToolCalls()).resolves.toBeUndefined();
  });

  it('swallows non-Error cleanup failures after logging them', async () => {
    const executor = createExecutor({
      getCurrentChatSession: () => {
        throw 'session unavailable';
      },
    });

    await expect(executor.cleanupIncompleteToolCalls()).resolves.toBeUndefined();
  });
});