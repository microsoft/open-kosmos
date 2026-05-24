import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StreamingChunk } from '@shared/types/streamingTypes';
import type { Message, AssistantMessage } from '@shared/types/chatTypes';

vi.mock('../../utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

import { SessionManager, type ChatSessionCache, type SessionListener, type MessageListener } from '../session-manager';
import { isFeatureEnabled } from '../../featureFlags';

const mockedIsFeatureEnabled = vi.mocked(isFeatureEnabled);

function makeChunk(overrides: Partial<StreamingChunk>): StreamingChunk {
  return {
    chunkId: 'chunk-1',
    messageId: 'msg-1',
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    timestamp: Date.now(),
    type: 'content',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2, 8),
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    timestamp: Date.now(),
    ...overrides,
  } as Message;
}

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
    mockedIsFeatureEnabled.mockReturnValue(false);
  });

  describe('handleChatSessionCacheCreated', () => {
    it('creates a new session cache', () => {
      const existed = manager.handleChatSessionCacheCreated('s1', 'c1');
      expect(existed).toBe(false);
      const cache = manager.getChatSessionCache('s1');
      expect(cache).not.toBeNull();
      expect(cache!.chatSessionId).toBe('s1');
      expect(cache!.chatId).toBe('c1');
      expect(cache!.chatStatus).toBe('idle');
      expect(cache!.messages).toEqual([]);
    });

    it('returns true when recreating an existing session', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const existed = manager.handleChatSessionCacheCreated('s1', 'c1');
      expect(existed).toBe(true);
    });

    it('uses provided messages from initialData', () => {
      const messages: Message[] = [makeMessage({ id: 'u1', role: 'user' })];
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages });
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(1);
    });

    it('falls back to renderChatHistory in initialData', () => {
      const messages: Message[] = [makeMessage({ id: 'u1', role: 'user' })];
      manager.handleChatSessionCacheCreated('s1', 'c1', { renderChatHistory: messages } as any);
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(1);
    });

    it('filters MCP-injected image messages when browserControl is enabled', () => {
      mockedIsFeatureEnabled.mockReturnValue(true);
      const messages: Message[] = [
        makeMessage({ id: 'user_img_1', role: 'user' }),
        makeMessage({ id: 'u1', role: 'user' }),
      ];
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages });
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(1);
      expect(cache.messages[0].id).toBe('u1');
    });

    it('does not filter when browserControl is enabled but no img messages exist', () => {
      mockedIsFeatureEnabled.mockReturnValue(true);
      const messages: Message[] = [
        makeMessage({ id: 'u1', role: 'user' }),
        makeMessage({ id: 'u2', role: 'user' }),
      ];
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages });
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(2);
    });

    it('preserves say-hi messages from existing cache on recreate', () => {
      const sayHi: Message = makeMessage({ id: 'say-hi-greeting', role: 'assistant' });
      const system: Message = makeMessage({ id: 'sys1', role: 'system' as any });
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [system, sayHi] });

      // Recreate without say-hi in incoming messages
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [system] });
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages.some(m => m.id?.startsWith('say-hi-'))).toBe(true);
    });

    it('preserves say-hi with unshift when no system message exists', () => {
      const sayHi: Message = makeMessage({ id: 'say-hi-greeting', role: 'assistant' });
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [sayHi] });

      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [] });
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages[0].id).toMatch(/^say-hi-/);
    });

    it('inherits streamingMessageId from existing cache', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', { streamingMessageId: 'streaming-1' });
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [] });
      expect(manager.getChatSessionCache('s1')!.streamingMessageId).toBe('streaming-1');
    });

    it('does not inherit streamingMessageId when initialData provides one', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', { streamingMessageId: 'old-stream' });
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [], streamingMessageId: 'new-stream' });
      expect(manager.getChatSessionCache('s1')!.streamingMessageId).toBe('new-stream');
    });

    it('preserves pendingInteractiveRequest from existing cache', () => {
      const req = { interactionId: 'int-1', type: 'confirm' } as any;
      manager.handleChatSessionCacheCreated('s1', 'c1', { pendingInteractiveRequest: req });
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [] });
      expect(manager.getChatSessionCache('s1')!.pendingInteractiveRequest).toEqual(req);
    });

    it('preserves errorMessage from existing cache', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', { errorMessage: 'oops' } as any);
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [] });
      expect(manager.getChatSessionCache('s1')!.errorMessage).toBe('oops');
    });

    it('notifies session listeners with add event', () => {
      const listener = vi.fn();
      manager.onSessionChange(listener);
      manager.handleChatSessionCacheCreated('s1', 'c1');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ chatSessionId: 's1' }), 'add');
    });

    it('uses initialData chatStatus and contextTokenUsage', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        chatStatus: 'sending_response',
        contextTokenUsage: { tokenCount: 100, totalMessages: 5, contextMessages: 3, compressionRatio: 0.8 },
      });
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.chatStatus).toBe('sending_response');
      expect(cache.contextTokenUsage.tokenCount).toBe(100);
    });
  });

  describe('handleChatSessionCacheDestroyed', () => {
    it('removes an existing session and notifies listeners', () => {
      const listener = vi.fn();
      manager.onSessionChange(listener);
      manager.handleChatSessionCacheCreated('s1', 'c1');
      listener.mockClear();

      const result = manager.handleChatSessionCacheDestroyed('s1');
      expect(result).toBe(true);
      expect(manager.getChatSessionCache('s1')).toBeNull();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ chatSessionId: 's1' }), 'remove');
    });

    it('returns undefined for non-existent session', () => {
      const result = manager.handleChatSessionCacheDestroyed('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('handleChatStatusChanged', () => {
    it('updates chat status', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleChatStatusChanged('s1', 'sending_response');
      expect(manager.getChatSessionCache('s1')!.chatStatus).toBe('sending_response');
    });

    it('clears streamingMessageId when transitioning to idle', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', { streamingMessageId: 'msg-1' });
      manager.handleChatStatusChanged('s1', 'idle');
      expect(manager.getChatSessionCache('s1')!.streamingMessageId).toBeNull();
    });

    it('returns false for non-existent session', () => {
      const result = manager.handleChatStatusChanged('nonexistent', 'idle');
      expect(result).toBe(false);
    });
  });

  describe('handleContextChange', () => {
    it('updates context token usage', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleContextChange('s1', { tokenCount: 500, totalMessages: 10, contextMessages: 8, compressionRatio: 0.9 });
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.contextTokenUsage.tokenCount).toBe(500);
      expect(cache.contextTokenUsage.compressionRatio).toBe(0.9);
    });

    it('defaults missing stats to 0/1.0', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleContextChange('s1', {});
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.contextTokenUsage.tokenCount).toBe(0);
      expect(cache.contextTokenUsage.compressionRatio).toBe(1.0);
    });

    it('returns false for non-existent session', () => {
      expect(manager.handleContextChange('nonexistent', {})).toBe(false);
    });
  });

  describe('addUserMessage', () => {
    it('appends user message and notifies message listeners', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const msgListener = vi.fn();
      manager.onMessageChange(msgListener);

      const msg = makeMessage({ id: 'u1', role: 'user' });
      manager.addUserMessage('s1', msg);

      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(1);
      expect(cache.messages[0].id).toBe('u1');
      expect(msgListener).toHaveBeenCalledWith(
        [{ message: msg, type: 'add' }],
        expect.objectContaining({ chatSessionId: 's1' }),
      );
    });

    it('filters MCP-injected image messages when browserControl is enabled', () => {
      mockedIsFeatureEnabled.mockReturnValue(true);
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const msg = makeMessage({ id: 'user_img_abc', role: 'user' });
      manager.addUserMessage('s1', msg);
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(0);
    });

    it('returns false for non-existent session', () => {
      const msg = makeMessage({ id: 'u1', role: 'user' });
      const result = manager.addUserMessage('nonexistent', msg);
      expect(result).toBe(false);
    });
  });

  describe('removeMessage', () => {
    it('removes a message by id', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' }), makeMessage({ id: 'u2', role: 'user' })],
      });
      manager.removeMessage('s1', 'u1');
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(1);
      expect(cache.messages[0].id).toBe('u2');
    });

    it('does nothing if message not found', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' })],
      });
      const result = manager.removeMessage('s1', 'nonexistent');
      // updateSession returns 'unchanged' when nothing was mutated
      expect(result).toBe(false);
    });

    it('returns false for non-existent session (no tag)', () => {
      const result = manager.removeMessage('nonexistent', 'msg1');
      expect(result).toBe(false);
    });
  });

  describe('handleStreamingChunk - content', () => {
    it('creates a new assistant message on first content chunk', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const chunk = makeChunk({
        chatSessionId: 's1',
        messageId: 'a1',
        type: 'content',
        contentDelta: { text: 'Hello' },
      });
      manager.handleStreamingChunk('s1', chunk);
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(1);
      expect(cache.messages[0].role).toBe('assistant');
      expect(cache.messages[0].content[0]).toEqual({ type: 'text', text: 'Hello' });
      expect(cache.streamingMessageId).toBe('a1');
    });

    it('appends text to existing message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'content', contentDelta: { text: 'Hello' },
      }));
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'content', contentDelta: { text: ' World' },
      }));
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages[0].content[0]).toEqual({ type: 'text', text: 'Hello World' });
    });

    it('appends text to existing message that has mixed content parts', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [{
          id: 'a1', role: 'assistant',
          content: [{ type: 'image', image_url: { url: 'http://x' } }, { type: 'text', text: 'existing' }],
          timestamp: Date.now(), streamingComplete: false,
        } as any],
      });
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'content', contentDelta: { text: '+more' },
      }));
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages[0].content[0]).toEqual({ type: 'image', image_url: { url: 'http://x' } });
      expect(cache.messages[0].content[1]).toEqual({ type: 'text', text: 'existing+more' });
    });

    it('adds text content part if message has no text part', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [{
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'image', image_url: { url: 'http://x' } }],
          timestamp: Date.now(),
        } as any],
      });
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'content', contentDelta: { text: 'text' },
      }));
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages[0].content).toHaveLength(2);
      expect(cache.messages[0].content[1]).toEqual({ type: 'text', text: 'text' });
    });

    it('ignores chunk with no contentDelta', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'content',
      }));
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(0);
    });
  });

  describe('handleStreamingChunk - tool_call', () => {
    it('creates a new message with tool call', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 0, id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"q":' } },
      }));
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(1);
      const msg = cache.messages[0] as AssistantMessage;
      expect(msg.tool_calls).toHaveLength(1);
      expect(msg.tool_calls![0].id).toBe('tc1');
      expect(msg.tool_calls![0].function.name).toBe('search');
    });

    it('accumulates tool call arguments', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 0, id: 'tc1', function: { name: 'fn', arguments: '{"a":' } },
      }));
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 0, function: { arguments: '"b"}' } },
      }));
      const msg = manager.getChatSessionCache('s1')!.messages[0] as AssistantMessage;
      expect(msg.tool_calls![0].function.arguments).toBe('{"a":"b"}');
    });

    it('adds tool_call to existing assistant message without tool_calls property', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [{
          id: 'a1', role: 'assistant',
          content: [{ type: 'text', text: 'thinking...' }],
          timestamp: Date.now(), streamingComplete: false,
        } as any],
      });
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 0, id: 'tc1', function: { name: 'fn', arguments: '{}' } },
      }));
      const msg = manager.getChatSessionCache('s1')!.messages[0] as AssistantMessage;
      expect(msg.tool_calls).toHaveLength(1);
      expect(msg.tool_calls![0].id).toBe('tc1');
    });

    it('handles multiple tool calls at different indices', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 0, id: 'tc1', function: { name: 'fn1', arguments: '{}' } },
      }));
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 1, id: 'tc2', function: { name: 'fn2', arguments: '{}' } },
      }));
      const msg = manager.getChatSessionCache('s1')!.messages[0] as AssistantMessage;
      expect(msg.tool_calls).toHaveLength(2);
      expect(msg.tool_calls![1].function.name).toBe('fn2');
    });

    it('handles tool_call delta without function property', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 0, id: 'tc1', function: { name: 'fn', arguments: '{}' } },
      }));
      // Second delta with no function at all
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 0 },
      }));
      const msg = manager.getChatSessionCache('s1')!.messages[0] as AssistantMessage;
      expect(msg.tool_calls![0].function.arguments).toBe('{}');
    });

    it('ignores chunk with no toolCallDelta', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
      }));
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(0);
    });

    it('ignores tool_call chunk targeting non-assistant message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'a1', role: 'user' })],
      });
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_call',
        toolCallDelta: { index: 0, id: 'tc1', function: { name: 'fn', arguments: '{}' } },
      }));
      const msg = manager.getChatSessionCache('s1')!.messages[0];
      expect((msg as any).tool_calls).toBeUndefined();
    });
  });

  describe('handleStreamingChunk - tool_result', () => {
    it('creates a tool message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_result',
        toolResult: { tool_call_id: 'tc1', tool_name: 'search', content: 'result', isError: false },
      }));
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(1);
      expect(cache.messages[0].role).toBe('tool');
      expect(cache.messages[0].id).toBe('tc1');
    });

    it('updates existing tool message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_result',
        toolResult: { tool_call_id: 'tc1', tool_name: 'search', content: 'partial', isError: false, isPartial: true },
      }));
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_result',
        toolResult: { tool_call_id: 'tc1', tool_name: 'search', content: 'complete', isError: false },
      }));
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(1);
      expect(cache.messages[0].content[0]).toEqual({ type: 'text', text: 'complete' });
    });

    it('clears streamingMessageId when final tool result matches', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', { streamingMessageId: 'tc1' });
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'tc1', type: 'tool_result',
        toolResult: { tool_call_id: 'tc1', tool_name: 'fn', content: 'done', isError: false },
      }));
      expect(manager.getChatSessionCache('s1')!.streamingMessageId).toBeNull();
    });

    it('ignores chunk with no toolResult', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'tool_result',
      }));
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(0);
    });
  });

  describe('handleStreamingChunk - complete', () => {
    it('marks message as streamingComplete', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'content', contentDelta: { text: 'hi' },
      }));
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'complete',
        complete: { messageId: 'a1', hasToolCalls: false },
      }));
      const msg = manager.getChatSessionCache('s1')!.messages[0];
      expect('streamingComplete' in msg && msg.streamingComplete).toBe(true);
    });

    it('clears streamingMessageId on complete', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', { streamingMessageId: 'a1' });
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'content', contentDelta: { text: 'hi' },
      }));
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'complete',
        complete: { messageId: 'a1', hasToolCalls: false },
      }));
      expect(manager.getChatSessionCache('s1')!.streamingMessageId).toBeNull();
    });

    it('ignores complete chunk with no complete field', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'complete',
      }));
      // No crash, no changes
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(0);
    });

    it('ignores complete for non-assistant/tool message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' })],
      });
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'u1', type: 'complete',
        complete: { messageId: 'u1', hasToolCalls: false },
      }));
      const msg = manager.getChatSessionCache('s1')!.messages[0];
      expect('streamingComplete' in msg).toBe(false);
    });

    it('ignores complete for non-existent message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'x', type: 'complete',
        complete: { messageId: 'nonexistent', hasToolCalls: false },
      }));
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(0);
    });
  });

  describe('handleStreamingChunk - user_message', () => {
    it('adds user message from chunk', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'u1', type: 'user_message',
        userMessage: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 123 },
      }));
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(1);
      expect(cache.messages[0].role).toBe('user');
      expect(cache.messages[0].id).toBe('u1');
    });

    it('uses messageId when userMessage has no id', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'fallback-id', type: 'user_message',
        userMessage: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      }));
      expect(manager.getChatSessionCache('s1')!.messages[0].id).toBe('fallback-id');
    });

    it('skips duplicate user message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' })],
      });
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'u1', type: 'user_message',
        userMessage: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'dup' }] },
      }));
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(1);
    });

    it('ignores chunk with no userMessage', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'u1', type: 'user_message',
      }));
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(0);
    });
  });

  describe('handleStreamingChunk - unknown type', () => {
    it('handles unknown chunk type gracefully', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleStreamingChunk('s1', makeChunk({
        chatSessionId: 's1', messageId: 'a1', type: 'unknown_type' as any,
      }));
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(0);
    });
  });

  describe('handleInteractiveRequest / handleInteractionProcessed', () => {
    it('sets and clears pendingInteractiveRequest', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const req = { interactionId: 'int-1', type: 'confirm' } as any;
      manager.handleInteractiveRequest('s1', req);
      expect(manager.getChatSessionCache('s1')!.pendingInteractiveRequest).toEqual(req);

      manager.handleInteractionProcessed('s1', { interactionId: 'int-1' });
      expect(manager.getChatSessionCache('s1')!.pendingInteractiveRequest).toBeNull();
    });

    it('does not clear if interactionId mismatch', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const req = { interactionId: 'int-1', type: 'confirm' } as any;
      manager.handleInteractiveRequest('s1', req);
      manager.handleInteractionProcessed('s1', { interactionId: 'int-other' });
      expect(manager.getChatSessionCache('s1')!.pendingInteractiveRequest).toEqual(req);
    });
  });

  describe('getUserMessageSendState', () => {
    it('returns canSend:false for null session id', () => {
      const state = manager.getUserMessageSendState(null);
      expect(state.canSend).toBe(false);
    });

    it('returns canSend:false for undefined session id', () => {
      const state = manager.getUserMessageSendState(undefined);
      expect(state.canSend).toBe(false);
    });

    it('returns canSend:false when status is not idle', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleChatStatusChanged('s1', 'sending_response');
      const state = manager.getUserMessageSendState('s1');
      expect(state.canSend).toBe(false);
      expect(state.chatStatus).toBe('sending_response');
    });

    it('returns canSend:false with appropriate message when no cache exists', () => {
      const state = manager.getUserMessageSendState('nonexistent');
      expect(state.canSend).toBe(false);
      expect(state.chatStatus).toBeNull();
    });

    it('returns canSend:true when idle', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const state = manager.getUserMessageSendState('s1');
      expect(state.canSend).toBe(true);
      expect(state.error).toBe('');
    });
  });

  describe('hasChatSessionCache', () => {
    it('returns true for existing session', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      expect(manager.hasChatSessionCache('s1')).toBe(true);
    });

    it('returns false for non-existent session', () => {
      expect(manager.hasChatSessionCache('nonexistent')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(manager.hasChatSessionCache(null)).toBe(false);
      expect(manager.hasChatSessionCache(undefined)).toBe(false);
    });
  });

  describe('getAllChatSessionCaches', () => {
    it('returns all caches', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleChatSessionCacheCreated('s2', 'c2');
      const all = manager.getAllChatSessionCaches();
      expect(Object.keys(all)).toHaveLength(2);
    });
  });

  describe('replaceFilePathInMessages', () => {
    it('replaces file paths in text content', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'file at /old/path.md' }] })],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old/path.md', '/new/path.md');
      expect(count).toBe(1);
      expect(manager.getChatSessionCache('s1')!.messages[0].content[0]).toEqual({
        type: 'text', text: 'file at /new/path.md',
      });
    });

    it('replaces file paths in file content parts', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({
          id: 'u1', role: 'user',
          content: [{ type: 'file', file: { filePath: '/old/path.md', fileName: 'x' } }] as any,
        })],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old/path.md', '/new/path.md');
      expect(count).toBe(1);
    });

    it('replaces file paths in office content parts', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({
          id: 'u1', role: 'user',
          content: [{ type: 'office', file: { filePath: '/old/path.docx', fileName: 'x' } }] as any,
        })],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old/path.docx', '/new/path.docx');
      expect(count).toBe(1);
    });

    it('replaces file paths in others content parts', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({
          id: 'u1', role: 'user',
          content: [{ type: 'others', file: { filePath: '/old/x', fileName: 'x' } }] as any,
        })],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old/x', '/new/x');
      expect(count).toBe(1);
    });

    it('replaces file paths in image content parts', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({
          id: 'u1', role: 'user',
          content: [{ type: 'image', image_url: { url: '/old/img.png' } }] as any,
        })],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old/img.png', '/new/img.png');
      expect(count).toBe(1);
    });

    it('replaces file paths in tool_calls arguments', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [{
          id: 'a1', role: 'assistant', content: [{ type: 'text', text: '' }], timestamp: Date.now(),
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'write', arguments: '{"path":"/old/f.txt"}' } }],
        } as any],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old/f.txt', '/new/f.txt');
      expect(count).toBe(1);
    });

    it('returns 0 when no replacements made', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user', content: [{ type: 'text', text: 'no match' }] })],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old/path', '/new/path');
      expect(count).toBe(0);
    });

    it('skips messages with non-array content', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [{ id: 'u1', role: 'user', content: 'string content', timestamp: Date.now() } as any],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old', '/new');
      expect(count).toBe(0);
    });

    it('handles file/office/others/image parts with missing nested object', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({
          id: 'u1', role: 'user',
          content: [
            { type: 'file' },
            { type: 'office' },
            { type: 'others' },
            { type: 'image' },
          ] as any,
        })],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old', '/new');
      expect(count).toBe(0);
    });

    it('skips tool_calls with empty arguments string', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [{
          id: 'a1', role: 'assistant', content: [{ type: 'text', text: '' }], timestamp: Date.now(),
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'fn', arguments: '' } }],
        } as any],
      });
      const count = manager.replaceFilePathInMessages('s1', '/old', '/new');
      expect(count).toBe(0);
    });
  });

  describe('replaceMessages', () => {
    it('replaces all messages', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1' })],
      });
      const newMsgs = [makeMessage({ id: 'u2' }), makeMessage({ id: 'u3' })];
      manager.replaceMessages('s1', newMsgs);
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(2);
    });

    it('applies partial updates', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.replaceMessages('s1', [], { chatStatus: 'sending_response' });
      expect(manager.getChatSessionCache('s1')!.chatStatus).toBe('sending_response');
    });

    it('returns false for non-existent session', () => {
      expect(manager.replaceMessages('nonexistent', [])).toBe(false);
    });
  });

  describe('setAssistantSayHiMessage', () => {
    it('inserts say-hi message after system message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'sys', role: 'system' as any })],
      });
      manager.setAssistantSayHiMessage('s1', 'Welcome!');
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages).toHaveLength(2);
      expect(cache.messages[1].id).toMatch(/^say-hi-/);
      expect(cache.messages[1].content[0]).toEqual({ type: 'text', text: 'Welcome!' });
    });

    it('inserts at beginning when no system message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' })],
      });
      manager.setAssistantSayHiMessage('s1', 'Hi!');
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages[0].id).toMatch(/^say-hi-/);
    });

    it('removes existing say-hi before inserting new one', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'sys', role: 'system' as any })],
      });
      manager.setAssistantSayHiMessage('s1', 'First');
      manager.setAssistantSayHiMessage('s1', 'Second');
      const cache = manager.getChatSessionCache('s1')!;
      const sayHis = cache.messages.filter(m => m.id?.startsWith('say-hi-'));
      expect(sayHis).toHaveLength(1);
      expect(sayHis[0].content[0]).toEqual({ type: 'text', text: 'Second' });
    });

    it('clears say-hi when given null', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'sys', role: 'system' as any })],
      });
      manager.setAssistantSayHiMessage('s1', 'Hello');
      manager.setAssistantSayHiMessage('s1', null);
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages.filter(m => m.id?.startsWith('say-hi-'))).toHaveLength(0);
    });

    it('clears say-hi when given empty string', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.setAssistantSayHiMessage('s1', 'Hello');
      manager.setAssistantSayHiMessage('s1', '   ');
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages.filter(m => m.id?.startsWith('say-hi-'))).toHaveLength(0);
    });
  });

  describe('setErrorMessage / clearErrorMessage', () => {
    it('sets and clears error message', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.setErrorMessage('s1', 'Something went wrong');
      expect(manager.getChatSessionCache('s1')!.errorMessage).toBe('Something went wrong');
      manager.clearErrorMessage('s1');
      expect(manager.getChatSessionCache('s1')!.errorMessage).toBeNull();
    });

    it('handles error message longer than 100 characters', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const longMsg = 'x'.repeat(200);
      manager.setErrorMessage('s1', longMsg);
      expect(manager.getChatSessionCache('s1')!.errorMessage).toBe(longMsg);
    });
  });

  describe('cleanup', () => {
    it('clears all caches', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.handleChatSessionCacheCreated('s2', 'c2');
      manager.cleanup();
      expect(manager.getChatSessionCache('s1')).toBeNull();
      expect(manager.getChatSessionCache('s2')).toBeNull();
    });
  });

  describe('listener management', () => {
    it('unsubscribes session listener', () => {
      const listener = vi.fn();
      const unsub = manager.onSessionChange(listener);
      unsub();
      manager.handleChatSessionCacheCreated('s1', 'c1');
      expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribes message listener', () => {
      const listener = vi.fn();
      const unsub = manager.onMessageChange(listener);
      unsub();
      manager.handleChatSessionCacheCreated('s1', 'c1');
      manager.addUserMessage('s1', makeMessage({ id: 'u1' }));
      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies session listeners on updateSession', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const listener = vi.fn();
      manager.onSessionChange(listener);
      manager.handleChatStatusChanged('s1', 'sending_response');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ chatStatus: 'sending_response' }),
        'update',
      );
    });

    it('notifies multiple session listeners', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const l1 = vi.fn();
      const l2 = vi.fn();
      manager.onSessionChange(l1);
      manager.onSessionChange(l2);
      manager.handleChatStatusChanged('s1', 'sending_response');
      expect(l1).toHaveBeenCalled();
      expect(l2).toHaveBeenCalled();
    });
  });

  describe('mergeSnapshotMessagesWithExistingCache', () => {
    it('preserves streaming message from existing cache during refresh', () => {
      // First create with initial messages
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [
          makeMessage({ id: 'u1', role: 'user' }),
          makeMessage({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'partial stream' }] }),
        ],
        streamingMessageId: 'a1',
      });

      // Recreate with a snapshot that has older content for a1
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [
          makeMessage({ id: 'u1', role: 'user' }),
          makeMessage({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'old' }] }),
        ],
      });

      const cache = manager.getChatSessionCache('s1')!;
      const a1 = cache.messages.find(m => m.id === 'a1')!;
      expect(a1.content[0]).toEqual({ type: 'text', text: 'partial stream' });
    });

    it('preserves trailing messages from existing cache', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [
          makeMessage({ id: 'u1', role: 'user' }),
          makeMessage({ id: 'a1', role: 'assistant' }),
          makeMessage({ id: 'u2', role: 'user' }),
        ],
      });

      // Snapshot only has u1, a1 (trailing u2 should be preserved)
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [
          makeMessage({ id: 'u1', role: 'user' }),
          makeMessage({ id: 'a1', role: 'assistant' }),
        ],
      });

      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages.find(m => m.id === 'u2')).toBeDefined();
    });

    it('does not preserve trailing messages when snapshot diverges', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [
          makeMessage({ id: 'u1', role: 'user' }),
          makeMessage({ id: 'a1', role: 'assistant' }),
        ],
      });

      // Incoming snapshot has different order - not a prefix of existing
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [
          makeMessage({ id: 'a1', role: 'assistant' }),
          makeMessage({ id: 'u1', role: 'user' }),
          makeMessage({ id: 'u3', role: 'user' }),
        ],
      });

      const cache = manager.getChatSessionCache('s1')!;
      // Should not have trailing from existing cache since snapshot diverges
      expect(cache.messages.find(m => m.id === 'a1')).toBeDefined();
    });

    it('handles empty existing cache', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', { messages: [] });
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' })],
      });
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(1);
    });

    it('falls back to incoming message when streaming message not in existing cache', () => {
      // Existing cache has streamingMessageId set to 'a1' but a1 is not in messages
      // (e.g., it was a say-hi message that was filtered)
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' })],
        streamingMessageId: 'a1',
      });

      const incomingA1 = makeMessage({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'from backend' }] });
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' }), incomingA1],
      });

      const cache = manager.getChatSessionCache('s1')!;
      const a1 = cache.messages.find(m => m.id === 'a1')!;
      expect(a1.content[0]).toEqual({ type: 'text', text: 'from backend' });
    });

    it('passes through messages without id in incoming snapshot', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' })],
        streamingMessageId: 'a1',
      });
      // Incoming snapshot contains a message without id
      const noIdMsg = { role: 'system', content: [{ type: 'text', text: 'sys' }], timestamp: 1 } as any;
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [noIdMsg, makeMessage({ id: 'u1', role: 'user' })],
      });
      const cache = manager.getChatSessionCache('s1')!;
      expect(cache.messages[0].role).toBe('system');
    });

    it('handles incoming snapshot longer than existing cache', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [makeMessage({ id: 'u1', role: 'user' })],
      });
      manager.handleChatSessionCacheCreated('s1', 'c1', {
        messages: [
          makeMessage({ id: 'u1', role: 'user' }),
          makeMessage({ id: 'a1', role: 'assistant' }),
          makeMessage({ id: 'u2', role: 'user' }),
        ],
      });
      expect(manager.getChatSessionCache('s1')!.messages).toHaveLength(3);
    });
  });

  describe('immutability via immer', () => {
    it('produces new reference on update', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const before = manager.getChatSessionCache('s1');
      manager.handleChatStatusChanged('s1', 'sending_response');
      const after = manager.getChatSessionCache('s1');
      expect(before).not.toBe(after);
    });

    it('returns same reference when no change is made', () => {
      manager.handleChatSessionCacheCreated('s1', 'c1');
      const before = manager.getChatSessionCache('s1');
      // handleInteractionProcessed with mismatched id = no mutation
      manager.handleInteractionProcessed('s1', { interactionId: 'no-match' });
      const after = manager.getChatSessionCache('s1');
      expect(before).toBe(after);
    });
  });
});
