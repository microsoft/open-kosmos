// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  getChatRenderItemStableKey,
  isVisibleChatRenderItem,
  hasTextContent,
  useRenderItems,
  ChatRenderItemComponent,
  type ChatRenderItem,
} from '../ChatRenderItem';
import { renderHook } from '@testing-library/react';
import type { Message } from '@shared/types/chatTypes';

// Mock child components
vi.mock('../message/Message', async () => ({
  default: ({ message }: { message: Message }) => (
    <div data-testid="message-component">{(message as any).id}</div>
  ),
}));

vi.mock('../ChatInput', async () => ({
  default: ({ mode }: { mode: string }) => (
    <div data-testid="chat-input" data-mode={mode} />
  ),
}));

vi.mock('../ToolCallsSection', async () => ({
  ToolCallsSection: () => <div data-testid="tool-calls-section" />,
}));

vi.mock('../InteractiveRequestCard', async () => ({
  default: () => <div data-testid="interactive-request-card" />,
}));

vi.mock('../InteractiveAuthCard', async () => ({
  default: () => <div data-testid="interactive-auth-card" />,
}));

vi.mock('../message/GeneratedFileCards', async () => ({
  PresentedFile: undefined,
}));

vi.mock('../../lib/chat/agentChatSessionCacheManager', async () => ({
  extractFilePathsFromText: (text: string) => text.includes('/path/') ? ['/path/file.txt'] : [],
  ChatStatus: undefined,
  CachedFilePath: undefined,
  useMessages: () => [],
}));

vi.mock('@renderer/lib/utilities/logger', async () => ({
  logger: { error: vi.fn() },
  createLogger: () => ({ error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

// Helper: create a minimal message
function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    content: [{ type: 'text', text: 'Hello' }],
    streamingComplete: true,
    ...overrides,
  } as Message;
}

// ─── getChatRenderItemStableKey ───────────────────────────────────────────────

describe('getChatRenderItemStableKey', () => {
  it('returns "none" for undefined', () => {
    expect(getChatRenderItemStableKey(undefined)).toBe('none');
  });

  it('returns key for assistant type with message id', () => {
    const item: ChatRenderItem = { type: 'assistant', message: makeMessage({ id: 'a1', role: 'assistant' }), index: 0 };
    expect(getChatRenderItemStableKey(item)).toBe('assistant:a1');
  });

  it('returns key for assistant using index when id is missing', () => {
    const item: ChatRenderItem = { type: 'assistant', message: makeMessage({ id: '', role: 'assistant' }), index: 5 };
    expect(getChatRenderItemStableKey(item)).toBe('assistant:5');
  });

  it('returns key for user type', () => {
    const item: ChatRenderItem = { type: 'user', message: makeMessage({ id: 'u1' }), index: 1 };
    expect(getChatRenderItemStableKey(item)).toBe('user:u1');
  });

  it('returns key for system type', () => {
    const item: ChatRenderItem = { type: 'system', message: makeMessage({ id: 's1', role: 'system' }), index: 2 };
    expect(getChatRenderItemStableKey(item)).toBe('system:s1');
  });

  it('returns key for say-hi type', () => {
    const item: ChatRenderItem = { type: 'say-hi', message: makeMessage({ id: 'say-hi-1', role: 'assistant' }), index: 3 };
    expect(getChatRenderItemStableKey(item)).toBe('say-hi:say-hi-1');
  });

  it('returns key for tool-calls-section using sectionKey', () => {
    const item: ChatRenderItem = { type: 'tool-calls-section', toolCalls: [], sectionKey: 'sk1', index: 4 };
    expect(getChatRenderItemStableKey(item)).toBe('tool-calls-section:sk1');
  });

  it('returns key for tool-calls-section falling back to sourceMessageIndex', () => {
    const item: ChatRenderItem = { type: 'tool-calls-section', toolCalls: [], sectionKey: '', sourceMessageIndex: 7, index: 4 };
    expect(getChatRenderItemStableKey(item)).toBe('tool-calls-section:7');
  });

  it('returns key for interactive-request using interactionId', () => {
    const item: ChatRenderItem = {
      type: 'interactive-request',
      interactiveRequest: { interactionId: 'ir-1', prompt: 'p', type: 'text' } as any,
      sectionKey: 'sk',
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('interactive-request:ir-1');
  });

  it('returns key for interactive-auth using sectionKey', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: { commandFamily: 'cf1' } as any },
      sectionKey: 'sa-1',
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('interactive-auth:sa-1');
  });

  it('returns key for interactive-auth falling back to commandFamily', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: { commandFamily: 'cf2' } as any },
      sectionKey: '',
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('interactive-auth:cf2');
  });

  it('returns key for activity-loading', () => {
    const item: ChatRenderItem = { type: 'activity-loading', sectionKey: 'al1', index: 0 };
    expect(getChatRenderItemStableKey(item)).toBe('activity-loading:al1');
  });

  it('returns key for activity-placeholder', () => {
    const item: ChatRenderItem = { type: 'activity-placeholder', sectionKey: 'ap1', index: 0 };
    expect(getChatRenderItemStableKey(item)).toBe('activity-placeholder:ap1');
  });
});

// ─── isVisibleChatRenderItem ──────────────────────────────────────────────────

describe('isVisibleChatRenderItem', () => {
  it('returns false for undefined', () => {
    expect(isVisibleChatRenderItem(undefined)).toBe(false);
  });

  it('returns false for activity-loading', () => {
    expect(isVisibleChatRenderItem({ type: 'activity-loading', sectionKey: 'x', index: 0 })).toBe(false);
  });

  it('returns false for activity-placeholder', () => {
    expect(isVisibleChatRenderItem({ type: 'activity-placeholder', sectionKey: 'x', index: 0 })).toBe(false);
  });

  it('returns true for user type', () => {
    expect(isVisibleChatRenderItem({ type: 'user', message: makeMessage(), index: 0 })).toBe(true);
  });

  it('returns true for assistant type', () => {
    expect(isVisibleChatRenderItem({ type: 'assistant', message: makeMessage({ role: 'assistant' }), index: 0 })).toBe(true);
  });

  it('returns false for tool-calls-section with no named tool calls', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [{ id: '1', type: 'function', function: { name: '', arguments: '{}' } }],
      sectionKey: 'sk',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(false);
  });

  it('returns true for tool-calls-section with named tool calls', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [{ id: '1', type: 'function', function: { name: 'my_tool', arguments: '{}' } }],
      sectionKey: 'sk',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(true);
  });

  it('returns true for interactive-request', () => {
    const item: ChatRenderItem = {
      type: 'interactive-request',
      interactiveRequest: { interactionId: 'ir', prompt: 'p', type: 'text' } as any,
      sectionKey: 'sk',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(true);
  });

  it('returns true for interactive-auth with hint', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: { commandFamily: 'cf' } as any },
      sectionKey: 'sk',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(true);
  });
});

// ─── hasTextContent ───────────────────────────────────────────────────────────

describe('hasTextContent', () => {
  it('returns true for message with non-empty text', () => {
    expect(hasTextContent(makeMessage({ content: [{ type: 'text', text: 'Hello' }] }))).toBe(true);
  });

  it('returns false for message with empty text', () => {
    expect(hasTextContent(makeMessage({ content: [{ type: 'text', text: '   ' }] }))).toBe(false);
  });

  it('returns false for message with no text parts', () => {
    expect(hasTextContent(makeMessage({ content: [] }))).toBe(false);
  });

  it('returns false for null/undefined text', () => {
    expect(hasTextContent(makeMessage({ content: [{ type: 'text', text: '' }] }))).toBe(false);
  });
});

// ─── useRenderItems ───────────────────────────────────────────────────────────

describe('useRenderItems', () => {
  it('returns empty array for empty messages', () => {
    const { result } = renderHook(() => useRenderItems([], null, [], null));
    expect(result.current).toEqual([]);
  });

  it('creates user item for user message', () => {
    const msg = makeMessage({ id: 'u1', role: 'user' });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    expect(result.current[0].type).toBe('user');
  });

  it('creates system item for system message', () => {
    const msg = makeMessage({ id: 's1', role: 'system' });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    expect(result.current[0].type).toBe('system');
  });

  it('creates say-hi item for say-hi messages', () => {
    const msg = makeMessage({ id: 'say-hi-welcome', role: 'assistant', content: [] });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    expect(result.current[0].type).toBe('say-hi');
  });

  it('creates assistant item for assistant message with text', () => {
    const msg = makeMessage({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    expect(result.current[0].type).toBe('assistant');
  });

  it('skips tool messages', () => {
    const msg = makeMessage({ id: 't1', role: 'tool' });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    expect(result.current).toHaveLength(0);
  });

  it('appends pending interactive request at end', () => {
    const pendingRequest = { interactionId: 'ir-1', prompt: 'q', type: 'text' } as any;
    const { result } = renderHook(() => useRenderItems([], null, [], pendingRequest));
    expect(result.current[0].type).toBe('interactive-request');
  });

  it('collects tool calls into tool-calls-section', () => {
    const toolCall = { id: 'tc1', type: 'function' as const, function: { name: 'my_tool', arguments: '{}' } };
    const msg = makeMessage({
      id: 'a2',
      role: 'assistant',
      content: [],
      tool_calls: [toolCall],
    });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    const tcItem = result.current.find(i => i.type === 'tool-calls-section');
    expect(tcItem).toBeDefined();
  });
});

// ─── ChatRenderItemComponent ──────────────────────────────────────────────────

const baseProps = {
  isLast: false,
  renderLoadingIndicator: () => <span data-testid="loading" />,
  chatId: 'chat-1',
  chatStatus: undefined,
  editingMessage: null,
  onSaveEditedMessage: vi.fn(),
  onCancelEdit: vi.fn(),
  onStartEdit: vi.fn(),
  canEditUserMessage: false,
  streamingMessageId: undefined,
  fileExistsCache: {},
  handleContentChange: vi.fn(),
};

describe('ChatRenderItemComponent', () => {
  it('renders loading indicator for activity-loading', () => {
    const item: ChatRenderItem = { type: 'activity-loading', sectionKey: 'sk', index: 0 };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
  });

  it('renders loading indicator for activity-placeholder', () => {
    const item: ChatRenderItem = { type: 'activity-placeholder', sectionKey: 'sk', index: 0 };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
  });

  it('renders InteractiveRequestCard for interactive-request', () => {
    const item: ChatRenderItem = {
      type: 'interactive-request',
      interactiveRequest: { interactionId: 'ir1', prompt: 'q', type: 'text' } as any,
      sectionKey: 'sk',
      index: 0,
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('interactive-request-card')).toBeInTheDocument();
  });

  it('renders InteractiveAuthCard for interactive-auth', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: { commandFamily: 'git' } as any },
      sectionKey: 'sk',
      index: 0,
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('interactive-auth-card')).toBeInTheDocument();
  });

  it('applies dim style to interactive-auth when editing and index > editingSourceMessageIndex', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: { commandFamily: 'git' } as any },
      sectionKey: 'sk',
      sourceMessageIndex: 5,
      index: 5,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'e', index: 2, message: makeMessage({ id: 'e', role: 'user' }), warningMessage: null }} item={item} />,
    );
    expect(container.firstChild).toHaveStyle({ opacity: '0.42' });
  });

  it('renders ToolCallsSection for tool-calls-section with tool calls', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'my_tool', arguments: '{}' } }],
      sectionKey: 'sk',
      index: 0,
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('tool-calls-section')).toBeInTheDocument();
  });

  it('renders null for tool-calls-section with empty toolCalls', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [],
      sectionKey: 'sk',
      index: 0,
    };
    const { container } = render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders MessageComponent for system type', () => {
    const item: ChatRenderItem = {
      type: 'system',
      message: makeMessage({ id: 'sys-1', role: 'system' }),
      index: 0,
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('message-component')).toBeInTheDocument();
  });

  it('renders MessageComponent for say-hi type', () => {
    const item: ChatRenderItem = {
      type: 'say-hi',
      message: makeMessage({ id: 'say-hi-1', role: 'assistant' }),
      index: 0,
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('message-component')).toBeInTheDocument();
  });

  it('renders ChatInput editor for user message when editing', () => {
    const msg = makeMessage({ id: 'u1', role: 'user' });
    const item: ChatRenderItem = { type: 'user', message: msg, index: 0 };
    render(
      <ChatRenderItemComponent
        {...baseProps}
        item={item}
        editingMessage={{ id: 'u1', warningMessage: undefined }}
      />,
    );
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('renders MessageComponent for user type when not editing', () => {
    const msg = makeMessage({ id: 'u2', role: 'user' });
    const item: ChatRenderItem = { type: 'user', message: msg, index: 0 };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('message-component')).toBeInTheDocument();
  });

  it('renders MessageComponent for assistant type', () => {
    const msg = makeMessage({ id: 'a1', role: 'assistant' });
    const item: ChatRenderItem = {
      type: 'assistant',
      message: msg,
      index: 0,
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('message-component')).toBeInTheDocument();
  });

  it('applies dim style to system item when editing at earlier index', () => {
    const item: ChatRenderItem = {
      type: 'system',
      message: makeMessage({ id: 's1', role: 'system' }),
      index: 5,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'e', index: 3, message: makeMessage({ id: 'e', role: 'user' }), warningMessage: null }} item={item} />,
    );
    expect(container.firstChild).toHaveStyle({ opacity: '0.42' });
  });

  it('applies dim style to assistant item when editing at earlier index', () => {
    const item: ChatRenderItem = {
      type: 'assistant',
      message: makeMessage({ id: 'a1', role: 'assistant' }),
      index: 5,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'e', index: 3, message: makeMessage({ id: 'e', role: 'user' }), warningMessage: null }} item={item} />,
    );
    expect(container.firstChild).toHaveStyle({ opacity: '0.42' });
  });

  it('passes chat-latest-live-item class when isLast for tool-calls-section', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'my_tool', arguments: '{}' } }],
      sectionKey: 'sk',
      index: 0,
    };
    const { container } = render(<ChatRenderItemComponent {...baseProps} isLast item={item} />);
    expect(container.firstChild).toHaveClass('chat-latest-live-item');
  });
});
