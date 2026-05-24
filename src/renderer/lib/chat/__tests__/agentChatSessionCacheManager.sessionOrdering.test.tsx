/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

describe('AgentChatSessionCacheManager session ordering hooks', () => {
  let activeUnmount: (() => void) | null = null;
  let consoleLogSpy: MockInstance;
  let consoleWarnSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let chatSessionCacheCreatedListener: ((data: { chatSessionId: string; chatId: string; initialData?: any }) => void) | null = null;

  beforeEach(() => {
    activeUnmount = null;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        agentChat: {
          onChatSessionCacheCreated: (callback: (data: { chatSessionId: string; chatId: string; initialData?: any }) => void) => {
            chatSessionCacheCreatedListener = callback;
            return () => {
              if (chatSessionCacheCreatedListener === callback) {
                chatSessionCacheCreatedListener = null;
              }
            };
          },
        },
      },
    });
  });

  afterEach(async () => {
    const module = await import('../agentChatSessionCacheManager');
    if (activeUnmount) {
      act(() => {
        activeUnmount?.();
      });
      activeUnmount = null;
    }
    act(() => {
      module.agentChatSessionCacheManager.cleanup();
    });
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('updates from no-cache to ready when the session changes before the cache snapshot arrives', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-a', 'chat-1', { messages: [] });
    manager.setCurrentChatSessionId('chat-1', 'session-a');

    const Probe = () => {
      const currentSessionId = module.useCurrentChatSessionId();
      const hasCache = module.useHasChatSessionCache(currentSessionId);

      return (
        <div data-testid="state">
          {currentSessionId ?? 'none'}|{hasCache ? 'ready' : 'missing'}
        </div>
      );
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('state')).toHaveTextContent('session-a|ready');

    act(() => {
      manager.setCurrentChatSessionId('chat-1', 'session-b');
    });

    expect(screen.getByTestId('state')).toHaveTextContent('session-b|missing');

    act(() => {
      manager.createChatSessionCache('session-b', 'chat-1', {
        messages: [
          {
            id: 'assistant-b',
            role: 'assistant',
            content: [{ type: 'text', text: 'session b ready' }],
          } as any,
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('session-b|ready');
    });
  });

  it('updates visible messages when the cache snapshot arrives after the session already changed', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-a', 'chat-1', {
      messages: [
        {
          id: 'assistant-a',
          role: 'assistant',
          content: [{ type: 'text', text: 'history-a' }],
        } as any,
      ],
    });
    manager.setCurrentChatSessionId('chat-1', 'session-a');

    const Probe = () => {
      const currentSessionId = module.useCurrentChatSessionId();
      const messages = module.useMessages();
      const firstText = (messages[0]?.content?.[0] as any)?.text || 'none';

      return (
        <div data-testid="state">
          {currentSessionId ?? 'none'}|{firstText}
        </div>
      );
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('state')).toHaveTextContent('session-a|history-a');

    act(() => {
      manager.setCurrentChatSessionId('chat-1', 'session-b');
    });

    expect(screen.getByTestId('state')).toHaveTextContent('session-b|none');

    act(() => {
      manager.createChatSessionCache('session-b', 'chat-1', {
        messages: [
          {
            id: 'assistant-b',
            role: 'assistant',
            content: [{ type: 'text', text: 'history-b' }],
          } as any,
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('session-b|history-b');
    });
  });

  it('clears streamingMessageId when chatStatus transitions to idle (cancel scenario)', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    // Create a cache that simulates an active streaming session
    manager.createChatSessionCache('session-cancel', 'chat-1', {
      messages: [
        {
          id: 'assistant-streaming',
          role: 'assistant',
          content: [{ type: 'text', text: 'partial response...' }],
        } as any,
      ],
      chatStatus: 'received_response',
      streamingMessageId: 'assistant-streaming',
    });
    manager.setCurrentChatSessionId('chat-1', 'session-cancel');

    // Verify that streamingMessageId is set (as if streaming was in progress)
    const cache = manager.getChatSessionCache('session-cancel');
    expect(cache).not.toBeNull();
    expect(cache!.streamingMessageId).toBe('assistant-streaming');

    const Probe = () => {
      const streamingMessageId = module.useStreamingMessageId();
      const { chatStatus } = module.CurrentSessionStatus.use();
      return (
        <div data-testid="state">
          {chatStatus}|{streamingMessageId ?? 'null'}
        </div>
      );
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('state')).toHaveTextContent('received_response|assistant-streaming');

    // Simulate cancel: chatStatus transitions to idle via handleChatStatusChanged
    act(() => {
      (manager as any).sessions.handleChatStatusChanged('session-cancel', 'idle');
    });

    // Lifecycle notifications are batched via setTimeout(fn, 0), so we need to
    // flush the macrotask before checking the React-rendered output.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // streamingMessageId should be cleared
    expect(screen.getByTestId('state')).toHaveTextContent('idle|null');
    expect(manager.getChatSessionCache('session-cancel')!.streamingMessageId).toBeNull();
  });

  it('does NOT clear streamingMessageId when chatStatus transitions to non-idle status', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-nonidle', 'chat-1', {
      messages: [],
      chatStatus: 'sending_response',
      streamingMessageId: 'msg-1',
    });
    manager.setCurrentChatSessionId('chat-1', 'session-nonidle');

    // Transition to received_response (not idle) — should NOT clear streamingMessageId
    act(() => {
      (manager as any).sessions.handleChatStatusChanged('session-nonidle', 'received_response');
    });

    expect(manager.getChatSessionCache('session-nonidle')!.streamingMessageId).toBe('msg-1');
  });

  it('clears the streaming message id when the active tool result finishes without a complete chunk', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-tool', 'chat-1', {
      messages: [],
    });
    manager.setCurrentChatSessionId('chat-1', 'session-tool');

    act(() => {
      (manager as any).sessions.handleStreamingChunk('session-tool', {
        type: 'tool_result',
        chatSessionId: 'session-tool',
        messageId: 'tool-call-1',
        timestamp: Date.now(),
        toolResult: {
          tool_call_id: 'tool-call-1',
          tool_name: 'execute_command',
          content: '{"stdout":"done","stderr":"","exitCode":0}',
          isPartial: false,
        },
      });
    });

    const Probe = () => {
      const currentSessionId = module.useCurrentChatSessionId();
      const streamingMessageId = module.useStreamingMessageId();

      return (
        <div data-testid="state">
          {currentSessionId ?? 'none'}|{streamingMessageId ?? 'idle'}
        </div>
      );
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('session-tool|idle');
    });

    const cache = manager.getChatSessionCache('session-tool');
    expect(cache?.streamingMessageId).toBeNull();
    expect((cache?.messages.find((message) => message.id === 'tool-call-1') as any)?.streamingComplete).toBe(true);
  });

  it('captures a cache snapshot created immediately after the current session changes', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    const Probe = () => {
      const currentSessionId = module.useCurrentChatSessionId();
      const messages = module.useMessages();
      const firstText = (messages[0]?.content?.[0] as any)?.text || 'none';

      return (
        <div data-testid="state">
          {currentSessionId ?? 'none'}|{firstText}
        </div>
      );
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('state')).toHaveTextContent('none|none');

    act(() => {
      manager.setCurrentChatSessionId('chat-1', 'session-fast');
      manager.createChatSessionCache('session-fast', 'chat-1', {
        messages: [
          {
            id: 'assistant-fast',
            role: 'assistant',
            content: [{ type: 'text', text: 'history-fast' }],
          } as any,
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('session-fast|history-fast');
    });
  });

  it('does not append a locally edited user message onto a divergent older snapshot', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    expect(chatSessionCacheCreatedListener).not.toBeNull();

    manager.createChatSessionCache('session-edit', 'chat-1', {
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: [{ type: 'text', text: 'original prompt' }],
        } as any,
        {
          id: 'assistant-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'original answer' }],
        } as any,
      ],
    });

    manager.replaceMessages('session-edit', [
      {
        id: 'user-1',
        role: 'user',
        content: [{ type: 'text', text: 'edited prompt' }],
      } as any,
    ]);

    act(() => {
      chatSessionCacheCreatedListener?.({
        chatSessionId: 'session-edit',
        chatId: 'chat-1',
        initialData: {
          messages: [
            {
              id: 'user-1-old',
              role: 'user',
              content: [{ type: 'text', text: 'original prompt' }],
            } as any,
            {
              id: 'assistant-1-old',
              role: 'assistant',
              content: [{ type: 'text', text: 'usage / answer' }],
            } as any,
          ],
        },
      });
    });

    expect(manager.getChatSessionCache('session-edit')?.messages.map((message) => message.id)).toEqual([
      'user-1-old',
      'assistant-1-old',
    ]);
  });

  it('keeps trailing cached messages when the incoming snapshot has no stable message ids', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    expect(chatSessionCacheCreatedListener).not.toBeNull();

    manager.createChatSessionCache('session-empty-prefix', 'chat-1', {
      messages: [
        {
          id: 'assistant-keep',
          role: 'assistant',
          content: [{ type: 'text', text: 'keep me' }],
        } as any,
      ],
    });

    act(() => {
      chatSessionCacheCreatedListener?.({
        chatSessionId: 'session-empty-prefix',
        chatId: 'chat-1',
        initialData: {
          messages: [
            {
              id: 'say-hi-session-empty-prefix',
              role: 'assistant',
              content: [{ type: 'text', text: 'hello' }],
            } as any,
          ],
        },
      });
    });

    expect(manager.getChatSessionCache('session-empty-prefix')?.messages.map((message) => message.id)).toEqual([
      'say-hi-session-empty-prefix',
      'assistant-keep',
    ]);
  });

  it('reports ready immediately when the cache already exists before the session becomes current', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-c', 'chat-1', {
      messages: [
        {
          id: 'assistant-c',
          role: 'assistant',
          content: [{ type: 'text', text: 'session c ready' }],
        } as any,
      ],
    });

    const Probe = () => {
      const currentSessionId = module.useCurrentChatSessionId();
      const hasCache = module.useHasChatSessionCache(currentSessionId);

      return (
        <div data-testid="state">
          {currentSessionId ?? 'none'}|{hasCache ? 'ready' : 'missing'}
        </div>
      );
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('state')).toHaveTextContent('none|missing');

    act(() => {
      manager.setCurrentChatSessionId('chat-1', 'session-c');
    });

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('session-c|ready');
    });
  });

  it('switches to the target session cache without rendering the previous session messages first', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-a', 'chat-1', {
      messages: [
        {
          id: 'assistant-a',
          role: 'assistant',
          content: [{ type: 'text', text: 'history-a' }],
        } as any,
      ],
    });
    manager.createChatSessionCache('session-b', 'chat-1', {
      messages: [
        {
          id: 'assistant-b',
          role: 'assistant',
          content: [{ type: 'text', text: 'history-b' }],
        } as any,
      ],
    });
    manager.setCurrentChatSessionId('chat-1', 'session-a');

    const Probe = () => {
      const currentSessionId = module.useCurrentChatSessionId();
      const messages = module.useMessages();
      const firstText = (messages[0]?.content?.[0] as any)?.text || 'none';

      return (
        <div data-testid="state">
          {currentSessionId ?? 'none'}|{firstText}
        </div>
      );
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('state')).toHaveTextContent('session-a|history-a');

    act(() => {
      manager.setCurrentChatSessionId('chat-1', 'session-b');
    });

    expect(screen.getByTestId('state')).toHaveTextContent('session-b|history-b');
    expect(screen.getByTestId('state')).not.toHaveTextContent('session-b|history-a');
  });

  it('reads the cached chat status on the first render without a transient idle fallback', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-busy', 'chat-1', {
      messages: [],
      chatStatus: 'sending_response',
    });
    manager.setCurrentChatSessionId('chat-1', 'session-busy');

    const Probe = () => {
      const { chatStatus } = module.CurrentSessionStatus.use();

      return <div data-testid="status">{chatStatus}</div>;
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('status')).toHaveTextContent('sending_response');
  });

  it('switches to the target session status without replaying the previous session status first', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;
    const renders: string[] = [];

    manager.createChatSessionCache('session-idle', 'chat-1', {
      messages: [],
      chatStatus: 'idle',
    });
    manager.createChatSessionCache('session-busy', 'chat-1', {
      messages: [],
      chatStatus: 'sending_response',
    });
    manager.setCurrentChatSessionId('chat-1', 'session-idle');

    const Probe = () => {
      const { chatStatus } = module.CurrentSessionStatus.use();
      renders.push(chatStatus);
      return <div data-testid="status">{chatStatus}</div>;
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('status')).toHaveTextContent('idle');

    act(() => {
      manager.setCurrentChatSessionId('chat-1', 'session-busy');
    });

    expect(screen.getByTestId('status')).toHaveTextContent('sending_response');
    expect(renders[0]).toBe('idle');
    expect(renders.at(-1)).toBe('sending_response');
    expect(renders.slice(1)).not.toContain('idle');
  });

  it('returns idle immediately when the current session is cleared', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;
    const renders: string[] = [];

    manager.createChatSessionCache('session-busy', 'chat-1', {
      messages: [],
      chatStatus: 'sending_response',
    });
    manager.setCurrentChatSessionId('chat-1', 'session-busy');

    const Probe = () => {
      const { chatStatus } = module.CurrentSessionStatus.use();
      renders.push(chatStatus);
      return <div data-testid="status">{chatStatus}</div>;
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('status')).toHaveTextContent('sending_response');

    const renderCountBeforeClear = renders.length;

    act(() => {
      manager.setCurrentChatSessionId(null, null);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(renders.at(-1)).toBe('idle');
    expect(renders.slice(renderCountBeforeClear)).not.toContain('sending_response');
  });

  it('CurrentSessionError clears reactively when clearErrorMessage is called (regression)', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-err', 'chat-1', { messages: [] });
    manager.setCurrentChatSessionId('chat-1', 'session-err');

    // Set an error message
    act(() => {
      manager.setErrorMessage('session-err', 'Something went wrong');
    });

    const Probe = () => {
      const errorMessage = module.CurrentSessionError.use();
      return <div data-testid="error">{errorMessage ?? 'none'}</div>;
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('error')).toHaveTextContent('Something went wrong');

    // Clear the error (simulates retry success)
    act(() => {
      manager.clearErrorMessage('session-err');
    });

    // Lifecycle notifications are batched via setTimeout(fn, 0)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // The error bar should disappear reactively
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  /**
   * Regression test for: CurrentSessionInteractiveRequest must re-render
   * when handleInteractiveRequest updates pendingInteractiveRequest on the
   * current session cache.
   *
   * Root cause: CurrentSessionInteractiveRequest used SubCurrentSid (fires only
   * on session ID change) instead of SubCurrentSession (fires on cache data change).
   * Introduced in commit 784d650b (PR #663 — immer refactor).
   */
  it('CurrentSessionInteractiveRequest re-renders when handleInteractiveRequest is called', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-ir', 'chat-ir', {
      messages: [],
      chatStatus: 'received_response',
    });
    manager.setCurrentChatSessionId('chat-ir', 'session-ir');

    const Probe = () => {
      const req = module.CurrentSessionInteractiveRequest.use();
      return <div data-testid="ir">{req?.interactionId ?? 'none'}</div>;
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('ir')).toHaveTextContent('none');

    // Simulate main process sending interactionRequest IPC
    act(() => {
      (manager as any).sessions.handleInteractiveRequest('session-ir', {
        interactionId: 'form_12345',
        chatSessionId: 'session-ir',
        requestType: 'form',
        status: 'pending',
        title: 'Test form',
        createdAt: Date.now(),
        source: 'tool',
      });
    });

    // Lifecycle notifications are batched via setTimeout(fn, 0)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // The component must re-render with the new interactionId
    expect(screen.getByTestId('ir')).toHaveTextContent('form_12345');
  });

  it('CurrentSessionInteractiveRequest clears when handleInteractionProcessed is called', async () => {
    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-ip', 'chat-ip', {
      messages: [],
      chatStatus: 'received_response',
      pendingInteractiveRequest: {
        interactionId: 'form_99',
        chatSessionId: 'session-ip',
        requestType: 'form',
        status: 'pending',
        title: 'Pending',
        createdAt: Date.now(),
        source: 'tool',
      } as any,
    });
    manager.setCurrentChatSessionId('chat-ip', 'session-ip');

    const Probe = () => {
      const req = module.CurrentSessionInteractiveRequest.use();
      return <div data-testid="ir">{req?.interactionId ?? 'none'}</div>;
    };

    const renderResult = render(<Probe />);
    activeUnmount = renderResult.unmount;

    expect(screen.getByTestId('ir')).toHaveTextContent('form_99');

    // Simulate interaction processed
    act(() => {
      (manager as any).sessions.handleInteractionProcessed('session-ip', {
        interactionId: 'form_99',
      });
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId('ir')).toHaveTextContent('none');
  });
});