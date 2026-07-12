const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => loggerMock),
}));

vi.mock('../agentChatUtilities', async () => ({
  normalizeToolCalls: vi.fn((toolCalls) => toolCalls),
  detectTruncatedToolCalls: vi.fn(() => []),
  sanitizeToolCallsForApi: vi.fn((toolCalls) => ({ toolCalls })),
  applyStorageCompressionToRecentMessages: vi.fn(async () => ({ success: false })),
}));

import { AgentChatTurnRunner } from '../agentChatTurnRunner';
import { CancellationError, CancellationTokenSource } from '../../cancellation';
import { ChatStatus } from '../agentChatTypes';
import { GhcApiError } from '../../utilities/errors';
import { NonInteractiveRuntimeInteractionError } from '../agentChatInteractionPolicy';

function createRunner() {
  const currentChatSession = {
    chat_history: [],
    context_history: [],
  } as any;
  const displayMessages = [{ id: 'display-1', role: 'assistant' }] as any;

  const deps = {
    getAgentName: () => 'OpenKosmos',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    getCurrentChatSession: () => currentChatSession,
    getChatHistory: () => currentChatSession.chat_history,
    getDisplayMessages: () => displayMessages,
    getSessionFromAuthManager: vi.fn().mockResolvedValue({ accessToken: 'token' }),
    runConversationAttempt: vi.fn().mockResolvedValue(undefined),
    checkAndCompress: vi.fn().mockResolvedValue({ applied: false }),
    setChatStatus: vi.fn(),
    callWithToolsStreaming: vi.fn().mockResolvedValue({
      finishReason: 'stop',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
    }),
    addMessageToSession: vi.fn().mockResolvedValue(undefined),
    batchValidateAndRequestApproval: vi.fn().mockResolvedValue(new Map()),
    executeToolCall: vi.fn(),
    postProcessToolResult: vi.fn(),
    assertExecutionActive: vi.fn(),
    createMcpImageHash: vi.fn(),
    hasInjectedMcpImageHash: vi.fn(() => false),
    emitStreamingChunk: vi.fn(),
    saveChatSession: vi.fn().mockResolvedValue({ success: true }),
    calculateAndNotifyContext: vi.fn().mockResolvedValue(undefined),
    extractFactsFromConversation: vi.fn().mockResolvedValue(undefined),
    cleanupIncompleteToolCalls: vi.fn().mockResolvedValue(undefined),
    resetMessagesToSave: vi.fn(),
    clearOutput: vi.fn(),
    getCurrentModelId: vi.fn(() => 'gpt-4.1'),
  };

  return { runner: new AgentChatTurnRunner(deps), deps };
}

describe('AgentChatTurnRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes a tool-free turn and transitions back to idle', async () => {
    const { runner, deps } = createRunner();

    await runner.run({ executionNonce: 1 });

    expect(deps.checkAndCompress).toHaveBeenCalledTimes(1);
    expect(deps.callWithToolsStreaming).toHaveBeenCalledTimes(1);
    expect(deps.addMessageToSession).toHaveBeenCalledTimes(1);
    expect(deps.extractFactsFromConversation).toHaveBeenCalledTimes(1);
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(1, ChatStatus.SENDING_RESPONSE);
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(2, ChatStatus.RECEIVED_RESPONSE);
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(3, ChatStatus.IDLE);
  });

  it('runs retry through the shared conversation attempt and returns display messages', async () => {
    const { runner, deps } = createRunner();

    const result = await runner.runRetry({});

    expect(deps.runConversationAttempt).toHaveBeenCalledWith(undefined, undefined);
    expect(result).toEqual(deps.getDisplayMessages());
  });

  it('can defer the retry final idle transition to the caller', async () => {
    const { runner, deps } = createRunner();

    await runner.runRetry({ deferFinalIdle: true });

    expect(deps.runConversationAttempt).toHaveBeenCalledWith(undefined, undefined, { deferFinalIdle: true });
  });

  it('logs graceful retry cancellation separately from ordinary failures', async () => {
    const { runner, deps } = createRunner();
    deps.runConversationAttempt.mockRejectedValueOnce(new CancellationError('cancelled'));

    await expect(runner.runRetry({})).rejects.toThrow('cancelled');

    expect(loggerMock.info).toHaveBeenCalledWith(
      '[AgentChat] ✅ Retry cancelled gracefully',
      'retryChat',
      expect.objectContaining({ agentName: 'OpenKosmos' }),
    );
    expect(loggerMock.error).not.toHaveBeenCalledWith(expect.stringContaining('Retry failed'));
  });

  it('stops retry before starting when the token is already cancelled', async () => {
    const { runner, deps } = createRunner();
    const token = { isCancellationRequested: true } as any;

    await expect(runner.runRetry({ token })).rejects.toBeInstanceOf(CancellationError);

    expect(deps.runConversationAttempt).not.toHaveBeenCalled();
  });

  it('logs retry failures for non-Error thrown values', async () => {
    const { runner, deps } = createRunner();
    deps.runConversationAttempt.mockRejectedValueOnce('bad retry');

    await expect(runner.runRetry({})).rejects.toBe('bad retry');

    expect(loggerMock.error).toHaveBeenCalledWith('[AgentChat] Retry failed: bad retry');
  });

  it('logs retry failures for Error instances', async () => {
    const { runner, deps } = createRunner();
    deps.runConversationAttempt.mockRejectedValueOnce(new Error('retry exploded'));

    await expect(runner.runRetry({})).rejects.toThrow('retry exploded');

    expect(loggerMock.error).toHaveBeenCalledWith('[AgentChat] Retry failed: retry exploded');
  });

  it('logs stream-message failures separately from graceful cancellation', async () => {
    const { runner, deps } = createRunner();
    const userMessage = {
      id: 'user-1',
      role: 'user',
      timestamp: 123,
      content: [{ type: 'text', text: 'hello' }],
    } as any;
    deps.runConversationAttempt.mockRejectedValueOnce(new Error('network down'));

    await expect(runner.runStreamMessage({ userMessage })).rejects.toThrow('network down');

    expect(loggerMock.error).toHaveBeenCalledWith('[AgentChat] Conversation processing failed: network down');
  });

  it('logs graceful stream-message cancellation separately from ordinary failures', async () => {
    const { runner, deps } = createRunner();
    const userMessage = {
      id: 'user-1',
      role: 'user',
      timestamp: 123,
      content: [{ type: 'text', text: 'hello' }],
    } as any;
    deps.runConversationAttempt.mockRejectedValueOnce(new CancellationError('stop'));

    await expect(runner.runStreamMessage({ userMessage })).rejects.toThrow('stop');

    expect(loggerMock.info).toHaveBeenCalledWith(
      '[AgentChat] ✅ Operation cancelled gracefully',
      'streamMessage',
      expect.objectContaining({ agentName: 'OpenKosmos' }),
    );
  });

  it('logs stream-message failures for non-Error thrown values', async () => {
    const { runner, deps } = createRunner();
    const userMessage = {
      id: 'user-1',
      role: 'user',
      timestamp: 123,
      content: [{ type: 'text', text: 'hello' }],
    } as any;
    deps.runConversationAttempt.mockRejectedValueOnce('bad stream');

    await expect(runner.runStreamMessage({ userMessage })).rejects.toBe('bad stream');

    expect(loggerMock.error).toHaveBeenCalledWith('[AgentChat] Conversation processing failed: bad stream');
  });

  it('adds the user message and emits a user chunk before running the conversation attempt', async () => {
    const { runner, deps } = createRunner();
    const userMessage = {
      id: 'user-1',
      role: 'user',
      timestamp: 123,
      content: [{ type: 'text', text: 'hello' }],
    } as any;

    const result = await runner.runStreamMessage({
      userMessage,
      emitUserMessage: true,
    });

    expect(deps.addMessageToSession).toHaveBeenCalledWith(userMessage);
    expect(deps.emitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user_message',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      userMessage: expect.objectContaining({ id: 'user-1' }),
    }));
    expect(deps.runConversationAttempt).toHaveBeenCalledWith(undefined, undefined, { deferFinalIdle: true });
    expect(result).toEqual(deps.getDisplayMessages());
  });

  it('can run a synthetic stream turn without persisting the trigger message', async () => {
    const { runner, deps } = createRunner();
    const userMessage = {
      id: 'wake-1',
      role: 'user',
      timestamp: 123,
      content: [{ type: 'text', text: '<task-notification-trigger/>' }],
      metadata: { synthetic: true },
    } as any;

    const result = await runner.runStreamMessage({
      userMessage,
      emitUserMessage: false,
      persistUserMessage: false,
    });

    expect(deps.addMessageToSession).not.toHaveBeenCalled();
    expect(deps.emitStreamingChunk).not.toHaveBeenCalled();
    expect(deps.runConversationAttempt).toHaveBeenCalledWith(undefined, undefined, { deferFinalIdle: true });
    expect(result).toEqual(deps.getDisplayMessages());
  });

  it('invokes onUserMessageCommitted after persisting, before running the conversation attempt', async () => {
    const { runner, deps } = createRunner();
    const userMessage = {
      id: 'user-1',
      role: 'user',
      timestamp: 123,
      content: [{ type: 'text', text: 'hello' }],
    } as any;

    const order: string[] = [];
    deps.addMessageToSession.mockImplementationOnce(async () => { order.push('persist'); });
    deps.runConversationAttempt.mockImplementationOnce(async () => { order.push('run'); });
    const onUserMessageCommitted = vi.fn(() => { order.push('commit'); });

    await runner.runStreamMessage({ userMessage, emitUserMessage: true, onUserMessageCommitted });

    expect(onUserMessageCommitted).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['persist', 'commit', 'run']);
  });

  it('does not invoke onUserMessageCommitted when the trigger message is not persisted', async () => {
    const { runner, deps } = createRunner();
    const userMessage = {
      id: 'wake-1',
      role: 'user',
      timestamp: 123,
      content: [{ type: 'text', text: '<task-notification-trigger/>' }],
    } as any;
    const onUserMessageCommitted = vi.fn();

    await runner.runStreamMessage({
      userMessage,
      emitUserMessage: false,
      persistUserMessage: false,
      onUserMessageCommitted,
    });

    expect(onUserMessageCommitted).not.toHaveBeenCalled();
    expect(deps.addMessageToSession).not.toHaveBeenCalled();
  });

  it('can defer the final idle transition to the caller', async () => {
    const { runner, deps } = createRunner();

    await runner.run({ executionNonce: 1, deferFinalIdle: true });

    expect(deps.setChatStatus).toHaveBeenNthCalledWith(1, ChatStatus.SENDING_RESPONSE);
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(2, ChatStatus.RECEIVED_RESPONSE);
    expect(deps.setChatStatus).not.toHaveBeenCalledWith(ChatStatus.IDLE);
  });

  it('emits a generated message id when streaming a user message without an id', async () => {
    const { runner, deps } = createRunner();
    const userMessage = {
      role: 'user',
      timestamp: 123,
      content: [{ type: 'text', text: 'hello' }],
    } as any;

    await runner.runStreamMessage({ userMessage, emitUserMessage: true });

    expect(deps.emitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({
      messageId: expect.stringMatching(/^user_session-1_/),
      userMessage: expect.objectContaining({ id: undefined }),
    }));
  });

  it('cleans up and clears output on cancellation failure', async () => {
    const { runner, deps } = createRunner();

    await runner.handleFailure(new CancellationError('cancelled'));

    expect(deps.cleanupIncompleteToolCalls).toHaveBeenCalledTimes(1);
    expect(deps.resetMessagesToSave).toHaveBeenCalledTimes(1);
    expect(deps.setChatStatus).toHaveBeenCalledWith(ChatStatus.IDLE);
    expect(deps.clearOutput).toHaveBeenCalledTimes(1);
  });

  it('sets idle and clears output on non-cancellation failure without re-throwing', async () => {
    const { runner, deps } = createRunner();

    await runner.handleFailure(new Error('Cannot have more than 128 tools. Current: 248'));

    expect(deps.setChatStatus).toHaveBeenCalledWith(ChatStatus.IDLE);
    expect(deps.clearOutput).toHaveBeenCalledTimes(1);
    // Should NOT call cleanupIncompleteToolCalls (that's cancellation-only)
    expect(deps.cleanupIncompleteToolCalls).not.toHaveBeenCalled();
  });

  it('stringifies non-Error values in generic failure handling', async () => {
    const { runner, deps } = createRunner();

    await runner.handleFailure('plain failure');

    expect(loggerMock.error).toHaveBeenCalledWith('[AgentChat] Unified streaming processing failed: plain failure');
    expect(deps.setChatStatus).toHaveBeenCalledWith(ChatStatus.IDLE);
  });

  it('persists usage and API-reported model on the assistant message', async () => {
    const { runner, deps } = createRunner();
    deps.callWithToolsStreaming.mockResolvedValue({
      finishReason: 'stop',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
      usage: {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      },
      model: 'gpt-4.1-2025-04-14',
    });

    await runner.run({ executionNonce: 1 });

    const savedMessage = deps.addMessageToSession.mock.calls[0][0];
    expect(savedMessage.usage).toEqual({
      prompt_tokens: 500,
      completion_tokens: 200,
      total_tokens: 700,
    });
    expect(savedMessage.model).toBe('gpt-4.1-2025-04-14');
  });

  it('reports usage to callbacks and anchors prompt token estimates', async () => {
    const { runner, deps } = createRunner();
    const onUsageReceived = vi.fn();
    const anchorTokenEstimate = vi.fn();
    Object.assign(deps, { onUsageReceived, anchorTokenEstimate });
    deps.callWithToolsStreaming.mockResolvedValue({
      finishReason: 'stop',
      message: {
        id: 'assistant-usage',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
      usage: {
        promptTokens: 50,
        completionTokens: 20,
        totalTokens: 70,
      },
    });

    await runner.run({ executionNonce: 1 });

    expect(onUsageReceived).toHaveBeenCalledWith({
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
    });
    expect(anchorTokenEstimate).toHaveBeenCalledWith(50);
  });

  it('falls back to config model ID when API does not report model', async () => {
    const { runner, deps } = createRunner();
    deps.callWithToolsStreaming.mockResolvedValue({
      finishReason: 'stop',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      // model is undefined — should fall back to getCurrentModelId()
    });

    await runner.run({ executionNonce: 1 });

    const savedMessage = deps.addMessageToSession.mock.calls[0][0];
    expect(savedMessage.model).toBe('gpt-4.1'); // from getCurrentModelId mock
    expect(savedMessage.usage).toBeDefined();
  });

  it('does not set usage when streaming response has no usage', async () => {
    const { runner, deps } = createRunner();
    // Default mock has no usage/model — test that message is clean

    await runner.run({ executionNonce: 1 });

    const savedMessage = deps.addMessageToSession.mock.calls[0][0];
    expect(savedMessage.usage).toBeUndefined();
    // model should still be set (config fallback)
    expect(savedMessage.model).toBe('gpt-4.1');
  });

  it('anchors neither usage nor estimates when prompt token count is absent', async () => {
    const { runner, deps } = createRunner();
    const onUsageReceived = vi.fn();
    const anchorTokenEstimate = vi.fn();
    Object.assign(deps, { onUsageReceived, anchorTokenEstimate });
    deps.callWithToolsStreaming.mockResolvedValue({
      finishReason: 'stop',
      message: {
        id: 'assistant-no-prompt',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
      usage: {
        promptTokens: 0,
        completionTokens: 5,
        totalTokens: 5,
      },
    });

    await runner.run({ executionNonce: 1 });

    expect(onUsageReceived).toHaveBeenCalled();
    expect(anchorTokenEstimate).not.toHaveBeenCalled();
  });

  it('skips persisting an empty assistant response without tool calls', async () => {
    const { runner, deps } = createRunner();
    deps.callWithToolsStreaming.mockResolvedValue({
      finishReason: 'stop',
      message: {
        id: 'assistant-empty',
        role: 'assistant',
        content: [{ type: 'text', text: '   ' }],
      },
    });

    await runner.run({ executionNonce: 1 });

    expect(deps.addMessageToSession).not.toHaveBeenCalled();
    expect(deps.extractFactsFromConversation).toHaveBeenCalled();
  });

  it('stops the tool-follow-up pipeline when execution becomes stale during a tool turn', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-tool',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: {
            name: 'execute_command',
            arguments: '{"command":"sleep 1"}',
          },
        },
      ],
    } as any;

    deps.callWithToolsStreaming.mockResolvedValue({
      finishReason: 'tool_calls',
      message: assistantResponse,
    });
    deps.executeToolCall.mockResolvedValue({ success: true });
    deps.postProcessToolResult.mockResolvedValue({ success: true });

    let assertCallCount = 0;
    deps.assertExecutionActive.mockImplementation((_token, _nonce, stage) => {
      assertCallCount += 1;
      if (stage === 'tool execution: execute_command') {
        throw new CancellationError('cancelled');
      }
    });

    await expect(runner.run({ executionNonce: 1 })).rejects.toBeInstanceOf(CancellationError);

    expect(deps.addMessageToSession).toHaveBeenCalledTimes(1);
    expect(deps.addMessageToSession).toHaveBeenCalledWith(assistantResponse);
    expect(deps.executeToolCall).toHaveBeenCalledTimes(1);
    expect(deps.postProcessToolResult).not.toHaveBeenCalled();
    expect(deps.emitStreamingChunk).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_result',
      toolResult: expect.objectContaining({ tool_call_id: 'tool-1' }),
    }));
    expect(deps.extractFactsFromConversation).not.toHaveBeenCalled();
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(1, ChatStatus.SENDING_RESPONSE);
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(2, ChatStatus.RECEIVED_RESPONSE);
    expect(deps.setChatStatus).not.toHaveBeenCalledWith(ChatStatus.IDLE);
    expect(assertCallCount).toBeGreaterThan(0);
  });

  it('persists assistant tool calls after approval hooks can mutate arguments', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-tool',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"before.txt"}',
          },
        },
      ],
    } as any;

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({
        finishReason: 'tool_calls',
        message: assistantResponse,
      })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
        },
      });
    deps.batchValidateAndRequestApproval.mockImplementation(async (toolCalls: any[]) => {
      toolCalls[0].function.arguments = '{"path":"after.txt"}';
      return new Map([['tool-1', true]]);
    });
    deps.executeToolCall.mockResolvedValue({ success: true });
    deps.postProcessToolResult.mockResolvedValue({ success: true });

    await runner.run({ executionNonce: 1 });

    const savedAssistant = deps.addMessageToSession.mock.calls[0][0];
    expect(savedAssistant.role).toBe('assistant');
    expect(savedAssistant.tool_calls[0].function.arguments).toBe('{"path":"after.txt"}');
    expect(deps.executeToolCall.mock.calls[0][0].function.arguments).toBe('{"path":"after.txt"}');
  });

  it('persists and emits structured system-fallback interactive-input results without collapsing them into user skips', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-tool',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: {
            name: 'request_interactive_input',
            arguments: '{"title":"Need input"}',
          },
        },
      ],
    } as any;

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({
        finishReason: 'tool_calls',
        message: assistantResponse,
      })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
        },
      });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-1', true]]));
    deps.executeToolCall.mockResolvedValue({ success: true });
    deps.postProcessToolResult.mockResolvedValue({
      success: true,
      status: 'skipped',
      request_type: 'choice',
      skipped_by_user: false,
      user_action: 'system_fallback',
      message: 'This interactive input request could not be delivered to an active UI receiver, so the runtime returned a fallback result. Do not treat this as an explicit user decline.',
      selected_values: [],
    });

    await runner.run({ executionNonce: 1 });

    const toolMessage = deps.addMessageToSession.mock.calls[1][0];
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('"status": "skipped"'),
      }),
    ]));
    expect(toolMessage.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('"skipped_by_user": false'),
      }),
    ]));
    expect(toolMessage.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('"user_action": "system_fallback"'),
      }),
    ]));

    expect(deps.emitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_result',
      toolResult: expect.objectContaining({
        tool_call_id: 'tool-1',
        tool_name: 'request_interactive_input',
        content: expect.stringContaining('"user_action": "system_fallback"'),
      }),
    }));
  });

  it('forces one compression retry when the provider rejects the payload for context overflow', async () => {
    const { runner, deps } = createRunner();

    deps.callWithToolsStreaming
      .mockRejectedValueOnce(new GhcApiError('prompt token count 472939 exceeds the limit of 168000', 400))
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: {
          id: 'assistant-2',
          role: 'assistant',
          content: [{ type: 'text', text: 'recovered' }],
        },
      });
    deps.checkAndCompress
      .mockResolvedValueOnce({ applied: false })
      .mockResolvedValueOnce({ applied: true });

    await runner.run({ executionNonce: 1 });

    expect(deps.callWithToolsStreaming).toHaveBeenCalledTimes(2);
    expect(deps.checkAndCompress).toHaveBeenNthCalledWith(1);
    expect(deps.checkAndCompress).toHaveBeenNthCalledWith(2, { force: true });
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(1, ChatStatus.SENDING_RESPONSE);
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(2, ChatStatus.SENDING_RESPONSE);
    expect(deps.setChatStatus).toHaveBeenNthCalledWith(3, ChatStatus.RECEIVED_RESPONSE);
  });

  it('does not loop when forced overflow recovery cannot apply a smaller context', async () => {
    const { runner, deps } = createRunner();

    deps.callWithToolsStreaming.mockRejectedValueOnce(
      new GhcApiError('prompt token count 472939 exceeds the limit of 168000', 400)
    );
    deps.checkAndCompress
      .mockResolvedValueOnce({ applied: false })
      .mockResolvedValueOnce({ applied: false });

    await expect(runner.run({ executionNonce: 1 })).rejects.toThrow('prompt token count 472939 exceeds the limit of 168000');

    expect(deps.callWithToolsStreaming).toHaveBeenCalledTimes(1);
    expect(deps.checkAndCompress).toHaveBeenNthCalledWith(1);
    expect(deps.checkAndCompress).toHaveBeenNthCalledWith(2, { force: true });
  });

  // Regression tests for "switching session loses partial reply after Stop":
  // when the user clicks Stop mid-stream, the streaming layer raises a
  // StreamCancellationError carrying the partial assistant text. The turn runner
  // must persist that text via addMessageToSession + saveChatSession before
  // re-throwing, otherwise the partial reply lives only in the renderer cache
  // and is lost on session switch / window close.
  it('persists partial assistant text when the stream is cancelled mid-flight', async () => {
    const { runner, deps } = createRunner();
    const partialMessage = {
      id: 'assistant-partial',
      role: 'assistant',
      content: [{ type: 'text', text: 'partial answer' }],
    } as any;
    const cancellationError: any = new Error('Operation cancelled during streaming');
    cancellationError.name = 'StreamCancellationError';
    cancellationError.partialResponse = {
      message: partialMessage,
      finishReason: 'cancelled',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: 'gpt-4.1',
    };
    deps.callWithToolsStreaming.mockRejectedValueOnce(cancellationError);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(cancellationError);

    expect(deps.addMessageToSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-partial',
        role: 'assistant',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4.1',
      }),
    );
    expect(deps.saveChatSession).toHaveBeenCalled();
  });

  it('persists text-only content and discards partial tool calls when cancellation happens after visible text', async () => {
    const { runner, deps } = createRunner();
    const cancellationError: any = new Error('aborted');
    cancellationError.name = 'StreamCancellationError';
    cancellationError.partialResponse = {
      message: {
        id: 'assistant-partial',
        role: 'assistant',
        content: [{ type: 'text', text: 'I can help with that.' }],
        tool_calls: [{ id: 'call_1', function: { name: 'foo', arguments: '{}' } }],
      },
      finishReason: 'cancelled',
    };
    deps.callWithToolsStreaming.mockRejectedValueOnce(cancellationError);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(cancellationError);

    expect(deps.addMessageToSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-partial',
        role: 'assistant',
      }),
    );
    const savedMessage = deps.addMessageToSession.mock.calls[0][0];
    expect(savedMessage.tool_calls).toBeUndefined();
    expect(savedMessage.content).toEqual([{ type: 'text', text: 'I can help with that.' }]);
    expect(deps.saveChatSession).toHaveBeenCalled();
  });

  it('skips persisting cancelled partial responses that have no visible text', async () => {
    // Partial tool_calls with no visible text have no matching tool result; saving them
    // would create orphaned tool-call history and cause API 400 on retry.
    const { runner, deps } = createRunner();
    const cancellationError: any = new Error('aborted');
    cancellationError.name = 'StreamCancellationError';
    cancellationError.partialResponse = {
      message: {
        id: 'assistant-partial',
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        tool_calls: [{ id: 'call_1', function: { name: 'foo', arguments: '{}' } }],
      },
      finishReason: 'cancelled',
    };
    deps.callWithToolsStreaming.mockRejectedValueOnce(cancellationError);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(cancellationError);

    expect(deps.addMessageToSession).not.toHaveBeenCalled();
    expect(deps.saveChatSession).not.toHaveBeenCalled();
  });

  it('does not attempt partial-response persistence for a plain CancellationError', async () => {
    const { runner, deps } = createRunner();
    deps.callWithToolsStreaming.mockRejectedValueOnce(new CancellationError('cancelled before API call'));

    await expect(runner.run({ executionNonce: 1 })).rejects.toThrow('cancelled before API call');

    expect(deps.addMessageToSession).not.toHaveBeenCalled();
    expect(deps.saveChatSession).not.toHaveBeenCalled();
  });

  it('throws GhcApiError when authentication session is not available', async () => {
    const { runner, deps } = createRunner();
    deps.getSessionFromAuthManager.mockResolvedValueOnce(null);

    await expect(runner.run({ executionNonce: 1 })).rejects.toThrow('GitHub Copilot authentication required');
  });

  it('persists and emits tool execution failure for a regular error', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-tool',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"filePath":"/tmp/test.txt"}' },
        },
      ],
    } as any;

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-1', true]]));
    deps.executeToolCall.mockRejectedValueOnce(new Error('file not found'));

    await runner.run({ executionNonce: 1 });

    // Should have persisted the error as a tool message
    const toolMsg = deps.addMessageToSession.mock.calls.find((call: any[]) => call[0].role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(JSON.stringify(toolMsg![0].content)).toContain('file not found');
  });

  it('persists assistant tool-call message when cancellation happens during tool validation', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-tool-cancel',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"filePath":"/tmp/test.txt"}' },
        },
      ],
    } as any;
    const cancellation = new CancellationError('cancelled during hooks');

    deps.callWithToolsStreaming.mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse });
    deps.batchValidateAndRequestApproval.mockRejectedValueOnce(cancellation);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(cancellation);

    expect(deps.addMessageToSession).toHaveBeenCalledWith(assistantResponse);
    expect(deps.executeToolCall).not.toHaveBeenCalled();
  });

  it('persists assistant tool-call message when tool validation throws a non-cancellation error', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-tool-approval-error',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"filePath":"/tmp/test.txt"}' },
        },
      ],
    } as any;
    const approvalError = new Error('approval service unavailable');

    deps.callWithToolsStreaming.mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse });
    deps.batchValidateAndRequestApproval.mockRejectedValueOnce(approvalError);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(approvalError);

    expect(deps.addMessageToSession).toHaveBeenCalledWith(assistantResponse);
    expect(deps.executeToolCall).not.toHaveBeenCalled();
  });

  it('persists assistant tool-call message when cancellation is requested after tool validation', async () => {
    const { runner, deps } = createRunner();
    const source = new CancellationTokenSource();
    const assistantResponse = {
      id: 'assistant-tool-cancel-after-validation',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"filePath":"/tmp/test.txt"}' },
        },
      ],
    } as any;

    deps.callWithToolsStreaming.mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse });
    deps.batchValidateAndRequestApproval.mockImplementationOnce(async () => {
      source.cancel();
      return new Map([['tool-1', true]]);
    });

    await expect(runner.run({ token: source.token, executionNonce: 1 })).rejects.toThrow('Operation cancelled after tool validation');

    expect(deps.addMessageToSession).toHaveBeenCalledWith(assistantResponse);
    expect(deps.executeToolCall).not.toHaveBeenCalled();
    source.dispose();
  });

  it('persists and emits tool execution failure for unknown thrown values', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-tool',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-unknown',
          type: 'function',
          function: { name: 'read_file', arguments: '{"filePath":"/tmp/test.txt"}' },
        },
      ],
    } as any;

    deps.callWithToolsStreaming.mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-unknown', true]]));
    deps.executeToolCall.mockRejectedValueOnce('bad tool');

    await runner.run({ executionNonce: 1 });

    const toolMsg = deps.addMessageToSession.mock.calls.find((call: any[]) => call[0].role === 'tool');
    expect(JSON.stringify(toolMsg![0].content)).toContain('Unknown error');
  });

  it('persists and rethrows non-interactive runtime interaction failures', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-tool',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: { name: 'request_interactive_input', arguments: '{"title":"Pick one"}' },
        },
      ],
    } as any;
    const blockedError = new NonInteractiveRuntimeInteractionError({
      policy: 'forbid',
      requestType: 'choice',
      message: 'Interactive input is unavailable',
    });

    deps.callWithToolsStreaming.mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-1', true]]));
    deps.executeToolCall.mockRejectedValueOnce(blockedError);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(blockedError);

    const toolMsg = deps.addMessageToSession.mock.calls.find((call: any[]) => call[0].role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(JSON.stringify(toolMsg![0].content)).toContain('Interactive input is unavailable');
  });

  it('handles tool calls with MCP image result by injecting a user image message', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-img',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-img',
          type: 'function',
          function: { name: 'take_screenshot', arguments: '{}' },
        },
      ],
    } as any;

    const imageResult = {
      type: 'image',
      data: 'base64imagedata',
      mimeType: 'image/png',
    };

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'screenshot taken' }] },
      });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-img', true]]));
    deps.executeToolCall.mockResolvedValue(imageResult);
    deps.postProcessToolResult.mockResolvedValue(imageResult);
    deps.createMcpImageHash.mockReturnValue('img-hash-1');
    deps.hasInjectedMcpImageHash.mockReturnValue(false);

    await runner.run({ executionNonce: 1 });

    // Should have injected a user image message
    const imageMsgCall = deps.addMessageToSession.mock.calls.find(
      (call: any[]) => call[0].role === 'user' && call[0].content?.some((p: any) => p.type === 'image'),
    );
    expect(imageMsgCall).toBeDefined();
  });

  it('uses jpg fallback when an MCP image mime type has no subtype', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-img',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-img',
          type: 'function',
          function: { name: 'take_screenshot', arguments: '{}' },
        },
      ],
    } as any;

    const imageResult = {
      type: 'image',
      data: 'base64imagedata',
      mimeType: 'image',
    };

    deps.callWithToolsStreaming.mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-img', true]]));
    deps.executeToolCall.mockResolvedValue(imageResult);
    deps.postProcessToolResult.mockResolvedValue(imageResult);
    deps.createMcpImageHash.mockReturnValue('img-hash-fallback');

    await runner.run({ executionNonce: 1 });

    const imageMsgCall = deps.addMessageToSession.mock.calls.find(
      (call: any[]) => call[0].role === 'user' && call[0].content?.some((p: any) => p.type === 'image'),
    );
    expect(imageMsgCall![0].content[1].metadata.fileName).toMatch(/\.jpg$/);
  });

  it('does not inject duplicate MCP image when hash already exists', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-img2',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        { id: 'tool-img2', type: 'function', function: { name: 'take_screenshot', arguments: '{}' } },
      ],
    } as any;

    const imageResult = { type: 'image', data: 'base64', mimeType: 'image/png' };

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-img2', true]]));
    deps.executeToolCall.mockResolvedValue(imageResult);
    deps.postProcessToolResult.mockResolvedValue(imageResult);
    deps.createMcpImageHash.mockReturnValue('dup-hash');
    deps.hasInjectedMcpImageHash.mockReturnValue(true); // already injected

    await runner.run({ executionNonce: 1 });

    const imageMsgCalls = deps.addMessageToSession.mock.calls.filter(
      (call: any[]) => call[0].role === 'user' && call[0].content?.some((p: any) => p.type === 'image'),
    );
    expect(imageMsgCalls).toHaveLength(0);
  });

  it('threads tool-reported width/height into the image and surfaces its description', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-img3',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        { id: 'tool-img3', type: 'function', function: { name: 'computer_use', arguments: '{"action":"screenshot"}' } },
      ],
    } as any;

    const imageResult = {
      type: 'image',
      data: 'base64imagedata',
      mimeType: 'image/jpeg',
      width: 1280,
      height: 800,
      description: 'Screenshot of display #2 (1280x800px). Frontmost app: Freeform.',
    };

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-img3', true]]));
    deps.executeToolCall.mockResolvedValue(imageResult);
    deps.postProcessToolResult.mockResolvedValue(imageResult);
    deps.createMcpImageHash.mockReturnValue('img-hash-3');
    deps.hasInjectedMcpImageHash.mockReturnValue(false);

    await runner.run({ executionNonce: 1 });

    // Injected vision message carries pixel dimensions so token accounting can size it.
    const imageMsgCall = deps.addMessageToSession.mock.calls.find(
      (call: any[]) => call[0].role === 'user' && call[0].content?.some((p: any) => p.type === 'image'),
    );
    const imagePart = imageMsgCall![0].content.find((p: any) => p.type === 'image');
    expect(imagePart.metadata.width).toBe(1280);
    expect(imagePart.metadata.height).toBe(800);

    // The tool's own (text) result surfaces the description and dims, never the raw bytes.
    const toolMsgCall = deps.addMessageToSession.mock.calls.find((call: any[]) => call[0].role === 'tool');
    const toolText = toolMsgCall![0].content[0].text;
    expect(toolText).toContain('Frontmost app: Freeform');
    expect(toolText).toContain('"width": 1280');
    expect(toolText).not.toContain('base64imagedata');
  });

  it('omits image dimensions when a tool reports only one of width/height', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-img4',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        { id: 'tool-img4', type: 'function', function: { name: 'computer_use', arguments: '{"action":"screenshot"}' } },
      ],
    } as any;

    // width present but height missing -> dimensions are dropped (cannot size reliably).
    const imageResult = { type: 'image', data: 'b64', mimeType: 'image/png', width: 1280 };

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-img4', true]]));
    deps.executeToolCall.mockResolvedValue(imageResult);
    deps.postProcessToolResult.mockResolvedValue(imageResult);
    deps.createMcpImageHash.mockReturnValue('img-hash-4');
    deps.hasInjectedMcpImageHash.mockReturnValue(false);

    await runner.run({ executionNonce: 1 });

    const imageMsgCall = deps.addMessageToSession.mock.calls.find(
      (call: any[]) => call[0].role === 'user' && call[0].content?.some((p: any) => p.type === 'image'),
    );
    const imagePart = imageMsgCall![0].content.find((p: any) => p.type === 'image');
    expect(imagePart.metadata.width).toBeUndefined();
    expect(imagePart.metadata.height).toBeUndefined();
    // Falls back to the generic note when the tool supplies no description.
    const toolMsgCall = deps.addMessageToSession.mock.calls.find((call: any[]) => call[0].role === 'tool');
    expect(toolMsgCall![0].content[0].text).toContain('raw image data removed');
  });

  it('applies storage compression and recalculates context after a non-tool turn', async () => {
    const { applyStorageCompressionToRecentMessages } = await import('../agentChatUtilities');
    const mockCompress = applyStorageCompressionToRecentMessages as Mock;

    const compressedMsg = {
      id: 'user-1', role: 'user', timestamp: 1,
      content: [{ type: 'text', text: 'compressed' }],
    } as any;
    mockCompress.mockResolvedValueOnce({ success: true, compressedMessage: compressedMsg });

    const { runner, deps } = createRunner();
    (deps.getCurrentChatSession() as any).chat_history = [
      { id: 'user-1', role: 'user', content: [{ type: 'text', text: 'original' }] },
    ];
    (deps.getCurrentChatSession() as any).context_history = [
      { id: 'user-1', role: 'user', content: [{ type: 'text', text: 'original' }] },
    ];

    await runner.run({ executionNonce: 1 });

    expect(deps.saveChatSession).toHaveBeenCalled();
    expect(deps.calculateAndNotifyContext).toHaveBeenCalled();
  });

  it('persists truncated tool errors for finish_reason=length tool calls', async () => {
    const { runner, deps } = createRunner();

    // Mock normalizeToolCalls and detectTruncatedToolCalls for this test
    const { normalizeToolCalls, detectTruncatedToolCalls } = await import('../agentChatUtilities');
    const mockNormalize = normalizeToolCalls as Mock;
    const mockDetect = detectTruncatedToolCalls as Mock;

    const truncatedToolCall = {
      id: 'truncated-1',
      type: 'function',
      function: { name: 'write_file', arguments: '{"filePath":"/tmp' }, // truncated
    };

    const assistantResponse = {
      id: 'assistant-trunc',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [truncatedToolCall],
    } as any;

    mockNormalize.mockReturnValueOnce([truncatedToolCall]);
    mockDetect.mockReturnValueOnce([truncatedToolCall]);

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({
        finishReason: 'length',
        message: assistantResponse,
      })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      });

    await runner.run({ executionNonce: 1 });

    // Should have persisted a truncated error tool message
    const toolMsgCalls = deps.addMessageToSession.mock.calls.filter(
      (call: any[]) => call[0].role === 'tool',
    );
    expect(toolMsgCalls.length).toBeGreaterThan(0);
    const truncatedMsgContent = JSON.stringify(toolMsgCalls[0][0].content);
    expect(truncatedMsgContent).toContain('truncated');
  });

  it('handles unnormalized and anonymous truncated tool calls defensively', async () => {
    const { runner, deps } = createRunner();
    const { normalizeToolCalls, detectTruncatedToolCalls } = await import('../agentChatUtilities');
    const mockNormalize = normalizeToolCalls as Mock;
    const mockDetect = detectTruncatedToolCalls as Mock;
    const anonymousTruncatedToolCall = {
      id: 'truncated-anon',
      type: 'function',
      function: { arguments: '{"filePath":"/tmp' },
    };
    const assistantResponse = {
      id: 'assistant-trunc',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [anonymousTruncatedToolCall],
    } as any;

    mockNormalize.mockReturnValueOnce(null);
    mockDetect.mockReturnValueOnce([anonymousTruncatedToolCall]);
    deps.callWithToolsStreaming.mockResolvedValueOnce({
      finishReason: 'length',
      message: assistantResponse,
    });

    await runner.run({ executionNonce: 1 });

    const toolMsg = deps.addMessageToSession.mock.calls.find((call: any[]) => call[0].role === 'tool');
    expect(JSON.stringify(toolMsg![0].content)).toContain('unknown');
  });

  it('does not treat ordinary provider errors as context overflow', async () => {
    const { runner, deps } = createRunner();
    const error = new GhcApiError('rate limited', 429);
    deps.callWithToolsStreaming.mockRejectedValueOnce(error);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(error);

    expect(deps.checkAndCompress).toHaveBeenCalledTimes(1);
  });

  it('does not treat non-GitHub errors as context overflow', async () => {
    const { runner, deps } = createRunner();
    const error = new Error('prompt token count is too high');
    deps.callWithToolsStreaming.mockRejectedValueOnce(error);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(error);

    expect(deps.checkAndCompress).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed partial cancellation payloads', async () => {
    const { runner, deps } = createRunner();
    const malformed: any = new Error('cancelled');
    malformed.name = 'StreamCancellationError';
    malformed.partialResponse = { message: { id: 'assistant' }, finishReason: 12 };
    deps.callWithToolsStreaming.mockRejectedValueOnce(malformed);

    await expect(runner.run({ executionNonce: 1 })).rejects.toBe(malformed);

    expect(deps.addMessageToSession).not.toHaveBeenCalled();
  });

  it('continues when storage compression has no matching persisted message ids', async () => {
    const { applyStorageCompressionToRecentMessages } = await import('../agentChatUtilities');
    const mockCompress = applyStorageCompressionToRecentMessages as Mock;
    mockCompress.mockResolvedValueOnce({
      success: true,
      compressedMessage: {
        id: 'missing',
        role: 'user',
        timestamp: 1,
        content: [{ type: 'text', text: 'compressed' }],
      },
    });
    const { runner, deps } = createRunner();
    (deps.getCurrentChatSession() as any).chat_history = [
      { id: 'other', role: 'user', content: [{ type: 'text', text: 'original' }] },
    ];
    (deps.getCurrentChatSession() as any).context_history = [
      { id: 'other', role: 'user', content: [{ type: 'text', text: 'original' }] },
    ];

    await runner.run({ executionNonce: 1 });

    expect(deps.saveChatSession).toHaveBeenCalled();
    expect((deps.getCurrentChatSession() as any).chat_history[0].id).toBe('other');
  });

  it('emits tool_result chunk with isError=true for denied tool result', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-denied',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        { id: 'tool-denied', type: 'function', function: { name: 'execute_command', arguments: '{"command":"rm -rf /"}' } },
      ],
    } as any;

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-denied', true]]));
    deps.executeToolCall.mockResolvedValue({ denied: true, message: 'Operation denied' });
    deps.postProcessToolResult.mockResolvedValue({ denied: true, message: 'Operation denied' });

    await runner.run({ executionNonce: 1 });

    const toolResultChunk = deps.emitStreamingChunk.mock.calls.find(
      (call: any[]) => call[0].type === 'tool_result',
    );
    expect(toolResultChunk).toBeDefined();
    expect(toolResultChunk![0].toolResult.isError).toBe(true);
  });

  it('emits tool_result chunk with isError=true when post-processing denies a successful result', async () => {
    const { runner, deps } = createRunner();
    const assistantResponse = {
      id: 'assistant-post-denied',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        { id: 'tool-post-denied', type: 'function', function: { name: 'read_file', arguments: '{"path":"safe.txt"}' } },
      ],
    } as any;

    deps.callWithToolsStreaming
      .mockResolvedValueOnce({ finishReason: 'tool_calls', message: assistantResponse })
      .mockResolvedValueOnce({
        finishReason: 'stop',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      });
    deps.batchValidateAndRequestApproval.mockResolvedValue(new Map([['tool-post-denied', true]]));
    deps.executeToolCall.mockResolvedValue({ success: true, content: 'raw secret' });
    deps.postProcessToolResult.mockResolvedValue({ denied: true, message: 'Blocked by hook' });

    await runner.run({ executionNonce: 1 });

    const toolResultChunk = deps.emitStreamingChunk.mock.calls.find(
      (call: any[]) => call[0].type === 'tool_result',
    );
    expect(toolResultChunk).toBeDefined();
    expect(toolResultChunk![0].toolResult).toMatchObject({
      content: JSON.stringify({ denied: true, message: 'Blocked by hook' }, null, 2),
      isError: true,
    });
  });
});