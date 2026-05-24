/**
 * @vitest-environment happy-dom
 */
import type { Message } from '@shared/types/chatTypes';

import { sendUserMessageOptimistically } from '../sendUserMessageOptimistically';

describe('sendUserMessageOptimistically', () => {
  const userMessage: Message = {
    id: 'user_1',
    role: 'user',
    timestamp: 1000,
    content: [{ type: 'text', text: 'hello' }],
  };

  it('rolls back the optimistic user message when backend rejects due to chat status', async () => {
    const cacheManager = {
      getUserMessageSendState: vi.fn(() => ({ canSend: true, error: '', chatStatus: 'idle' })),
      addUserMessage: vi.fn(),
      removeMessage: vi.fn(),
      setErrorMessage: vi.fn(),
    };

    await expect(sendUserMessageOptimistically({
      chatSessionId: 'session_1',
      userMessage,
      cacheManager,
      send: vi.fn().mockRejectedValue(new Error('Cannot send a new message while chat status is sending_response')),
    })).rejects.toThrow('Cannot send a new message while chat status is sending_response');

    expect(cacheManager.addUserMessage).toHaveBeenCalledWith('session_1', userMessage);
    expect(cacheManager.removeMessage).toHaveBeenCalledWith('session_1', 'user_1');
    expect(cacheManager.setErrorMessage).toHaveBeenCalledWith(
      'session_1',
      'Cannot send a new message while chat status is sending_response',
    );
  });

  it('keeps the optimistic user message when the error is a post-persistence API failure', async () => {
    const cacheManager = {
      getUserMessageSendState: vi.fn(() => ({ canSend: true, error: '', chatStatus: 'idle' })),
      addUserMessage: vi.fn(),
      removeMessage: vi.fn(),
      setErrorMessage: vi.fn(),
    };

    await expect(sendUserMessageOptimistically({
      chatSessionId: 'session_1',
      userMessage,
      cacheManager,
      send: vi.fn().mockRejectedValue(new Error('502 Bad Gateway')),
    })).rejects.toThrow('502 Bad Gateway');

    expect(cacheManager.addUserMessage).toHaveBeenCalledWith('session_1', userMessage);
    // User message should NOT be removed — it was already persisted on the backend
    expect(cacheManager.removeMessage).not.toHaveBeenCalled();
    expect(cacheManager.setErrorMessage).toHaveBeenCalledWith('session_1', '502 Bad Gateway');
  });

  it('keeps the optimistic user message for network errors', async () => {
    const cacheManager = {
      getUserMessageSendState: vi.fn(() => ({ canSend: true, error: '', chatStatus: 'idle' })),
      addUserMessage: vi.fn(),
      removeMessage: vi.fn(),
      setErrorMessage: vi.fn(),
    };

    await expect(sendUserMessageOptimistically({
      chatSessionId: 'session_1',
      userMessage,
      cacheManager,
      send: vi.fn().mockRejectedValue(new Error('fetch failed')),
    })).rejects.toThrow('fetch failed');

    expect(cacheManager.addUserMessage).toHaveBeenCalledWith('session_1', userMessage);
    expect(cacheManager.removeMessage).not.toHaveBeenCalled();
    expect(cacheManager.setErrorMessage).toHaveBeenCalledWith('session_1', 'fetch failed');
  });

  it('rolls back the optimistic user message when no agent instance is found (pre-persistence)', async () => {
    const cacheManager = {
      getUserMessageSendState: vi.fn(() => ({ canSend: true, error: '', chatStatus: 'idle' })),
      addUserMessage: vi.fn(),
      removeMessage: vi.fn(),
      setErrorMessage: vi.fn(),
    };

    await expect(sendUserMessageOptimistically({
      chatSessionId: 'session_1',
      userMessage,
      cacheManager,
      send: vi.fn().mockRejectedValue(new Error('No agent instance found for this chat session')),
    })).rejects.toThrow('No agent instance found');

    expect(cacheManager.addUserMessage).toHaveBeenCalledWith('session_1', userMessage);
    expect(cacheManager.removeMessage).toHaveBeenCalledWith('session_1', 'user_1');
    expect(cacheManager.setErrorMessage).toHaveBeenCalledWith(
      'session_1',
      'No agent instance found for this chat session',
    );
  });

  it('rejects before insertion when the session is not explicitly idle', async () => {
    const cacheManager = {
      getUserMessageSendState: vi.fn(() => ({
        canSend: false,
        error: 'Cannot send a new message until chat status is ready.',
        chatStatus: null,
      })),
      addUserMessage: vi.fn(),
      removeMessage: vi.fn(),
      setErrorMessage: vi.fn(),
    };

    await expect(sendUserMessageOptimistically({
      chatSessionId: 'session_1',
      userMessage,
      cacheManager,
      send: vi.fn(),
    })).rejects.toThrow('Cannot send a new message until chat status is ready.');

    expect(cacheManager.addUserMessage).not.toHaveBeenCalled();
    expect(cacheManager.removeMessage).not.toHaveBeenCalled();
    expect(cacheManager.setErrorMessage).toHaveBeenCalledWith(
      'session_1',
      'Cannot send a new message until chat status is ready.',
    );
  });
});