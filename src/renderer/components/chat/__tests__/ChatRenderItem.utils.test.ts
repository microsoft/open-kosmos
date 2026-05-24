// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from 'vitest';
import {
  getChatRenderItemStableKey,
  isVisibleChatRenderItem,
  hasTextContent,
  ChatRenderItem,
} from '../ChatRenderItem';
import type { Message, ToolCall } from '@shared/types/chatTypes';
import type { InteractiveRequest } from '@shared/types/interactiveRequestTypes';
import type { ExecuteCommandInteractiveAuthHint } from '@shared/types/toolCallArgs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello world' }],
    tool_calls: [],
    streamingComplete: true,
    ...overrides,
  } as unknown as Message;
}

function makeToolCall(id = 'tc-1', name = 'some_tool'): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: '{}' },
  };
}

// ---------------------------------------------------------------------------
// getChatRenderItemStableKey
// ---------------------------------------------------------------------------

describe('getChatRenderItemStableKey', () => {
  it('returns "none" for undefined', () => {
    expect(getChatRenderItemStableKey(undefined)).toBe('none');
  });

  it('returns key for assistant item with id', () => {
    const item: ChatRenderItem = {
      type: 'assistant',
      message: makeTextMessage({ id: 'abc' }),
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('assistant:abc');
  });

  it('falls back to index when message id is missing', () => {
    const item: ChatRenderItem = {
      type: 'user',
      message: makeTextMessage({ id: '' }),
      index: 5,
    };
    expect(getChatRenderItemStableKey(item)).toBe('user:5');
  });

  it('returns key for say-hi item', () => {
    const item: ChatRenderItem = {
      type: 'say-hi',
      message: makeTextMessage({ id: 'say-hi-001' }),
      index: 2,
    };
    expect(getChatRenderItemStableKey(item)).toBe('say-hi:say-hi-001');
  });

  it('returns key for system item', () => {
    const item: ChatRenderItem = {
      type: 'system',
      message: makeTextMessage({ id: 'sys-1', role: 'system' } as any),
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('system:sys-1');
  });

  it('uses sectionKey for tool-calls-section', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [makeToolCall()],
      sectionKey: 'tool-section-3',
      index: 2,
    };
    expect(getChatRenderItemStableKey(item)).toBe('tool-calls-section:tool-section-3');
  });

  it('uses interactionId for interactive-request', () => {
    const item: ChatRenderItem = {
      type: 'interactive-request',
      interactiveRequest: { interactionId: 'ir-99' } as InteractiveRequest,
      sectionKey: 'ir-section',
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('interactive-request:ir-99');
  });

  it('uses sectionKey for interactive-auth', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: {
        hint: { commandFamily: 'git' } as ExecuteCommandInteractiveAuthHint,
      },
      sectionKey: 'auth-section-0',
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('interactive-auth:auth-section-0');
  });

  it('uses commandFamily fallback for interactive-auth when sectionKey is empty', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: {
        hint: { commandFamily: 'git' } as ExecuteCommandInteractiveAuthHint,
      },
      sectionKey: '',
      index: 7,
    };
    const key = getChatRenderItemStableKey(item);
    // Falls back through sectionKey (falsy) → commandFamily → index
    expect(key).toBe('interactive-auth:git');
  });

  it('returns key for activity-loading', () => {
    const item: ChatRenderItem = {
      type: 'activity-loading',
      sectionKey: 'loading-1',
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('activity-loading:loading-1');
  });

  it('returns key for activity-placeholder', () => {
    const item: ChatRenderItem = {
      type: 'activity-placeholder',
      sectionKey: 'placeholder-2',
      index: 1,
    };
    expect(getChatRenderItemStableKey(item)).toBe('activity-placeholder:placeholder-2');
  });
});

// ---------------------------------------------------------------------------
// isVisibleChatRenderItem
// ---------------------------------------------------------------------------

describe('isVisibleChatRenderItem', () => {
  it('returns false for undefined', () => {
    expect(isVisibleChatRenderItem(undefined)).toBe(false);
  });

  it('returns true for assistant item', () => {
    const item: ChatRenderItem = {
      type: 'assistant',
      message: makeTextMessage(),
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(true);
  });

  it('returns true for user item', () => {
    const item: ChatRenderItem = {
      type: 'user',
      message: makeTextMessage({ role: 'user' } as any),
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(true);
  });

  it('returns false for activity-loading', () => {
    const item: ChatRenderItem = { type: 'activity-loading', sectionKey: 'k', index: 0 };
    expect(isVisibleChatRenderItem(item)).toBe(false);
  });

  it('returns false for activity-placeholder', () => {
    const item: ChatRenderItem = { type: 'activity-placeholder', sectionKey: 'k', index: 0 };
    expect(isVisibleChatRenderItem(item)).toBe(false);
  });

  it('returns true for tool-calls-section with a named tool call', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [makeToolCall('tc-1', 'web_search')],
      sectionKey: 's',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(true);
  });

  it('returns false for tool-calls-section when all tool names are empty', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [makeToolCall('tc-1', '  ')],
      sectionKey: 's',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(false);
  });

  it('returns false for tool-calls-section with no tool calls', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [],
      sectionKey: 's',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(false);
  });

  it('returns true for interactive-request with a request', () => {
    const item: ChatRenderItem = {
      type: 'interactive-request',
      interactiveRequest: { interactionId: 'x' } as InteractiveRequest,
      sectionKey: 's',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(true);
  });

  it('returns true for interactive-auth with a hint', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: { commandFamily: 'npm' } as ExecuteCommandInteractiveAuthHint },
      sectionKey: 's',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasTextContent
// ---------------------------------------------------------------------------

describe('hasTextContent', () => {
  it('returns true for a message with non-empty text', () => {
    const msg = makeTextMessage();
    expect(hasTextContent(msg)).toBe(true);
  });

  it('returns false for a message with only whitespace text', () => {
    const msg = makeTextMessage({
      content: [{ type: 'text', text: '   ' }] as any,
    });
    expect(hasTextContent(msg)).toBe(false);
  });

  it('returns false for a message with no text parts', () => {
    const msg = makeTextMessage({
      content: [{ type: 'image_url', image_url: { url: 'http://example.com/img.png' } }] as any,
    });
    expect(hasTextContent(msg)).toBe(false);
  });

  it('returns false for empty content array', () => {
    const msg = makeTextMessage({ content: [] as any });
    expect(hasTextContent(msg)).toBe(false);
  });

  it('returns true when at least one text part is non-empty', () => {
    const msg = makeTextMessage({
      content: [
        { type: 'text', text: '' },
        { type: 'text', text: 'hello' },
      ] as any,
    });
    expect(hasTextContent(msg)).toBe(true);
  });
});
