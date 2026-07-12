// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  default: ({ onSubmit }: any) => <div data-testid="interactive-request-card" onClick={() => onSubmit?.({ interactionId: 'test', response: 'ok' })} />,
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

  it('excludes missingFiles from presentedFiles when tool result reports them', () => {
    const toolCall = {
      id: 'tc-present-1',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: JSON.stringify({ filePaths: ['/good/file.txt', '/bad/missing.txt'], description: 'Results' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-present',
      role: 'assistant',
      content: [{ type: 'text', text: 'Here are your files' }],
      tool_calls: [toolCall],
    });
    const toolResultMsg = makeMessage({
      id: 'tr-present-1',
      role: 'tool',
      content: [{ type: 'text', text: JSON.stringify({ missingFiles: ['/bad/missing.txt'] }) }],
      tool_call_id: 'tc-present-1',
      name: 'present_deliverables',
    });
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem).toBeDefined();
    expect(assistantItem?.presentedFiles).toBeDefined();
    expect(assistantItem?.presentedFiles?.length).toBe(1);
    // The valid file should be included, not the missing one
    const filePath = JSON.parse(assistantItem!.presentedFiles![0].filePath);
    expect(filePath).toEqual(['/good/file.txt']);
  });

  it('keeps all presented files when tool result has no missingFiles field', () => {
    const toolCall = {
      id: 'tc-present-3',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: JSON.stringify({ filePaths: ['/a.txt', '/b.txt'], description: 'Files' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-present-3',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      tool_calls: [toolCall],
    });
    const toolResultMsg = makeMessage({
      id: 'tr-present-3',
      role: 'tool',
      content: [{ type: 'text', text: JSON.stringify({}) }],
      tool_call_id: 'tc-present-3',
      name: 'present_deliverables',
    });
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles).toBeDefined();
    const filePath = JSON.parse(assistantItem!.presentedFiles![0].filePath);
    expect(filePath).toEqual(['/a.txt', '/b.txt']);
  });

  it('keeps all presented files when tool result text is not valid JSON', () => {
    const toolCall = {
      id: 'tc-present-4',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: JSON.stringify({ filePaths: ['/c.txt'], description: 'Output' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-present-4',
      role: 'assistant',
      content: [{ type: 'text', text: 'Here' }],
      tool_calls: [toolCall],
    });
    const toolResultMsg = makeMessage({
      id: 'tr-present-4',
      role: 'tool',
      content: [{ type: 'text', text: 'not json' }],
      tool_call_id: 'tc-present-4',
      name: 'present_deliverables',
    });
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles).toBeDefined();
    const filePath = JSON.parse(assistantItem!.presentedFiles![0].filePath);
    expect(filePath).toEqual(['/c.txt']);
  });

  it('keeps all presented files when no matching tool result message exists', () => {
    const toolCall = {
      id: 'tc-present-5',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: JSON.stringify({ filePaths: ['/d.txt'], description: 'Result' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-present-5',
      role: 'assistant',
      content: [{ type: 'text', text: 'Files' }],
      tool_calls: [toolCall],
    });
    // No tool result message in allMessages
    const allMessages = [assistantMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles).toBeDefined();
    const filePath = JSON.parse(assistantItem!.presentedFiles![0].filePath);
    expect(filePath).toEqual(['/d.txt']);
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

  it('renders assistant with presentedFiles', () => {
    const msg = makeMessage({ id: 'a-pf', role: 'assistant' });
    const item: ChatRenderItem = {
      type: 'assistant',
      message: msg,
      index: 0,
      presentedFiles: [{ filePath: JSON.stringify(['/out/file.txt']), description: 'Output' }],
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('message-component')).toBeInTheDocument();
  });

  it('renders assistant with extractedFilePaths when no presentedFiles', () => {
    const msg = makeMessage({ id: 'a-efp', role: 'assistant' });
    const item: ChatRenderItem = {
      type: 'assistant',
      message: msg,
      index: 0,
      extractedFilePaths: ['/path/file.txt'],
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    expect(screen.getByTestId('message-component')).toBeInTheDocument();
  });

  it('applies dim style to user item when editing at earlier index', () => {
    const item: ChatRenderItem = {
      type: 'user',
      message: makeMessage({ id: 'u-dim', role: 'user' }),
      index: 5,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'other', index: 3, message: makeMessage({ id: 'other', role: 'user' }), warningMessage: null }} item={item} />,
    );
    expect(container.firstChild).toHaveStyle({ opacity: '0.42' });
  });

  it('applies dim style to interactive-auth when editing at earlier index', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: 'auth needed', command: 'sudo test', chatSessionId: 'cs1' },
      sectionKey: 'ia1',
      sourceMessageIndex: 5,
      index: 0,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'e', index: 3, message: makeMessage({ id: 'e', role: 'user' }), warningMessage: null }} item={item} />,
    );
    expect(container.firstChild).toHaveStyle({ opacity: '0.42' });
  });

  it('passes chat-latest-live-item class when isLast for interactive-auth', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: 'auth needed', command: 'cmd', chatSessionId: 'cs1' },
      sectionKey: 'ia2',
      index: 0,
    };
    const { container } = render(<ChatRenderItemComponent {...baseProps} isLast item={item} />);
    expect(container.firstChild).toHaveClass('chat-latest-live-item');
  });

  it('applies dim style to say-hi item when editing at earlier index', () => {
    const item: ChatRenderItem = {
      type: 'say-hi',
      message: makeMessage({ id: 'say-hi-x', role: 'assistant' }),
      index: 5,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'e', index: 3, message: makeMessage({ id: 'e', role: 'user' }), warningMessage: null }} item={item} />,
    );
    expect(container.firstChild).toHaveStyle({ opacity: '0.42' });
  });

  it('applies dim style to tool-calls-section when editing at earlier index', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'my_tool', arguments: '{}' } }],
      sectionKey: 'sk-dim',
      sourceMessageIndex: 5,
      index: 0,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'e', index: 3, message: makeMessage({ id: 'e', role: 'user' }), warningMessage: null }} item={item} />,
    );
    expect(container.firstChild).toHaveStyle({ opacity: '0.42' });
  });
});

describe('useRenderItems — extractPresentedFiles edge cases', () => {
  it('skips present_deliverables with invalid JSON arguments', () => {
    const toolCall = {
      id: 'tc-bad-json',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: 'not valid json',
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-bad-json',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      tool_calls: [toolCall],
    });
    const allMessages = [assistantMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem).toBeDefined();
    expect(assistantItem?.presentedFiles).toBeUndefined();
  });

  it('skips present_deliverables when filePaths is not an array', () => {
    const toolCall = {
      id: 'tc-not-array',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: JSON.stringify({ filePaths: '/single/path.txt', description: 'test' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-not-array',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      tool_calls: [toolCall],
    });
    const allMessages = [assistantMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles).toBeUndefined();
  });

  it('skips present_deliverables when arguments is empty', () => {
    const toolCall = {
      id: 'tc-empty-args',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: '',
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-empty-args',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      tool_calls: [toolCall],
    });
    const allMessages = [assistantMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles).toBeUndefined();
  });

  it('uses default description when not provided', () => {
    const toolCall = {
      id: 'tc-no-desc',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: JSON.stringify({ filePaths: ['/out/file.txt'] }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-no-desc',
      role: 'assistant',
      content: [{ type: 'text', text: 'Here' }],
      tool_calls: [toolCall],
    });
    const allMessages = [assistantMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles?.[0]?.description).toBe('Final deliverables');
  });

  it('does not create presentedFiles when all files are missing', () => {
    const toolCall = {
      id: 'tc-all-missing',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: JSON.stringify({ filePaths: ['/bad/a.txt', '/bad/b.txt'], description: 'Results' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-all-missing',
      role: 'assistant',
      content: [{ type: 'text', text: 'Here are your files' }],
      tool_calls: [toolCall],
    });
    const toolResultMsg = makeMessage({
      id: 'tr-all-missing',
      role: 'tool',
      content: [{ type: 'text', text: JSON.stringify({ missingFiles: ['/bad/a.txt', '/bad/b.txt'] }) }],
      tool_call_id: 'tc-all-missing',
      name: 'present_deliverables',
    });
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles).toBeUndefined();
  });

  it('handles tool result with missingFiles not as array', () => {
    const toolCall = {
      id: 'tc-bad-missing',
      type: 'function' as const,
      function: {
        name: 'present_deliverables',
        arguments: JSON.stringify({ filePaths: ['/out/file.txt'], description: 'Output' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-bad-missing',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      tool_calls: [toolCall],
    });
    const toolResultMsg = makeMessage({
      id: 'tr-bad-missing',
      role: 'tool',
      content: [{ type: 'text', text: JSON.stringify({ missingFiles: 'not-an-array' }) }],
      tool_call_id: 'tc-bad-missing',
      name: 'present_deliverables',
    });
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles).toBeDefined();
    const filePath = JSON.parse(assistantItem!.presentedFiles![0].filePath);
    expect(filePath).toEqual(['/out/file.txt']);
  });
});

// ─── Additional coverage for ChatRenderItem internal functions ────────────────

describe('useRenderItems — assistant message variants', () => {
  it('handles assistant message with tool_calls but no text (tool-only message)', () => {
    const toolCall = { id: 'tc1', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"/test"}' } };
    const msg = makeMessage({
      id: 'a-tool-only',
      role: 'assistant',
      content: [],
      tool_calls: [toolCall],
    });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    const tcItem = result.current.find(i => i.type === 'tool-calls-section');
    expect(tcItem).toBeDefined();
  });

  it('handles assistant message with both text and tool_calls', () => {
    const toolCall = { id: 'tc2', type: 'function' as const, function: { name: 'write_file', arguments: '{"filePath":"/out"}' } };
    const msg = makeMessage({
      id: 'a-text-and-tools',
      role: 'assistant',
      content: [{ type: 'text', text: 'I will create the file.' }],
      tool_calls: [toolCall],
    });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    const tcItem = result.current.find(i => i.type === 'tool-calls-section');
    expect(assistantItem).toBeDefined();
    expect(tcItem).toBeDefined();
  });

  it('handles multiple assistant messages with tool calls between them', () => {
    const tc1 = { id: 'tc1', type: 'function' as const, function: { name: 'read_file', arguments: '{}' } };
    const tc2 = { id: 'tc2', type: 'function' as const, function: { name: 'write_file', arguments: '{}' } };
    const msg1 = makeMessage({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'First' }], tool_calls: [tc1] });
    const msg2 = makeMessage({ id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Second' }], tool_calls: [tc2] });
    const allMessages = [msg1, msg2];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItems = result.current.filter(i => i.type === 'assistant');
    expect(assistantItems.length).toBe(2);
  });

  it('skips synthetic user messages with metadata.synthetic flag', () => {
    const msg = makeMessage({ id: 'u-synth', role: 'user', content: [{ type: 'text', text: 'trigger' }] });
    (msg as any).metadata = { synthetic: true };
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    expect(result.current).toHaveLength(0);
  });

  it('skips user messages with task-notification-trigger text', () => {
    const msg = makeMessage({ id: 'u-trigger', role: 'user', content: [{ type: 'text', text: '<task-notification-trigger/>' }] });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    expect(result.current).toHaveLength(0);
  });

  it('handles assistant message with file paths in text content', () => {
    const msg = makeMessage({
      id: 'a-filepaths',
      role: 'assistant',
      content: [{ type: 'text', text: 'Created /path/file.txt for you' }],
    });
    const { result } = renderHook(() => useRenderItems([msg], null, [msg], null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem).toBeDefined();
  });

  it('flushes presented files before user message', () => {
    const tc = {
      id: 'tc-flush',
      type: 'function' as const,
      function: { name: 'present_deliverables', arguments: JSON.stringify({ filePaths: ['/out/x.txt'], description: 'Result' }) },
    };
    const assistantMsg = makeMessage({ id: 'a-flush', role: 'assistant', content: [{ type: 'text', text: 'Done' }], tool_calls: [tc] });
    const userMsg = makeMessage({ id: 'u-flush', role: 'user', content: [{ type: 'text', text: 'Thanks' }] });
    const allMessages = [assistantMsg, userMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const assistantItem = result.current.find(i => i.type === 'assistant');
    expect(assistantItem?.presentedFiles).toBeDefined();
  });
});

describe('useRenderItems — extractInteractiveAuthCards coverage', () => {
  it('creates interactive-auth item for execute_command with interactiveAuth result', () => {
    const toolCall = {
      id: 'tc-exec-auth',
      type: 'function' as const,
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({ command: 'sudo', args: ['apt', 'update'] }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-exec-auth',
      role: 'assistant',
      content: [],
      tool_calls: [toolCall],
    });
    const toolResultMsg = {
      ...makeMessage({
        id: 'tr-exec-auth',
        role: 'tool',
        content: [{ type: 'text', text: JSON.stringify({ interactiveAuth: 'Password required', exitCode: null, timedOut: false }) }],
      }),
      tool_call_id: 'tc-exec-auth',
      name: 'execute_command',
      streamingComplete: false,
    } as any;
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const authItem = result.current.find(i => i.type === 'interactive-auth');
    expect(authItem).toBeDefined();
  });

  it('does not create interactive-auth when tool result has exitCode', () => {
    const toolCall = {
      id: 'tc-exec-done',
      type: 'function' as const,
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({ command: 'ls' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-exec-done',
      role: 'assistant',
      content: [],
      tool_calls: [toolCall],
    });
    const toolResultMsg = {
      ...makeMessage({
        id: 'tr-exec-done',
        role: 'tool',
        content: [{ type: 'text', text: JSON.stringify({ interactiveAuth: null, exitCode: 0, timedOut: false }) }],
      }),
      tool_call_id: 'tc-exec-done',
      name: 'execute_command',
      streamingComplete: false,
    } as any;
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const authItem = result.current.find(i => i.type === 'interactive-auth');
    expect(authItem).toBeUndefined();
  });

  it('does not create interactive-auth for non-execute_command tool calls', () => {
    const toolCall = {
      id: 'tc-other',
      type: 'function' as const,
      function: {
        name: 'read_file',
        arguments: '{}',
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-other',
      role: 'assistant',
      content: [],
      tool_calls: [toolCall],
    });
    const allMessages = [assistantMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const authItem = result.current.find(i => i.type === 'interactive-auth');
    expect(authItem).toBeUndefined();
  });

  it('handles execute_command with no args in arguments', () => {
    const toolCall = {
      id: 'tc-no-args',
      type: 'function' as const,
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({ command: 'whoami' }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-no-args',
      role: 'assistant',
      content: [],
      tool_calls: [toolCall],
    });
    const toolResultMsg = {
      ...makeMessage({
        id: 'tr-no-args',
        role: 'tool',
        content: [{ type: 'text', text: JSON.stringify({ interactiveAuth: 'Need auth', exitCode: null, timedOut: false }) }],
      }),
      tool_call_id: 'tc-no-args',
      name: 'execute_command',
      streamingComplete: false,
    } as any;
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, null, allMessages, null));
    const authItem = result.current.find(i => i.type === 'interactive-auth');
    expect(authItem).toBeDefined();
  });
});

describe('isVisibleChatRenderItem — additional branches', () => {
  it('returns false for interactive-auth with empty hint', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: '' as any, command: 'cmd', chatSessionId: 'cs' },
      sectionKey: 'ia-empty',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(false);
  });

  it('returns false for interactive-request with null request', () => {
    const item: ChatRenderItem = {
      type: 'interactive-request',
      interactiveRequest: null as any,
      sectionKey: 'ir-null',
      index: 0,
    };
    expect(isVisibleChatRenderItem(item)).toBe(false);
  });
});

describe('useRenderItems — chatSessionId parameter', () => {
  it('passes chatSessionId to interactive-auth items', () => {
    const toolCall = {
      id: 'tc-auth-cs',
      type: 'function' as const,
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({ command: 'sudo', args: ['test'] }),
      },
    };
    const assistantMsg = makeMessage({
      id: 'a-auth-cs',
      role: 'assistant',
      content: [],
      tool_calls: [toolCall],
    });
    const toolResultMsg = {
      ...makeMessage({
        id: 'tr-auth-cs',
        role: 'tool',
        content: [{ type: 'text', text: JSON.stringify({ interactiveAuth: 'Need password', exitCode: null, timedOut: false }) }],
      }),
      tool_call_id: 'tc-auth-cs',
      name: 'execute_command',
      streamingComplete: false,
    } as any;
    const allMessages = [assistantMsg, toolResultMsg];
    const { result } = renderHook(() => useRenderItems(allMessages, 'test-session-id', allMessages, null));
    const authItem = result.current.find(i => i.type === 'interactive-auth') as any;
    expect(authItem).toBeDefined();
    expect(authItem.interactiveAuth.chatSessionId).toBe('test-session-id');
  });
});

describe('ChatRenderItemComponent — submitInteractiveRequest', () => {
  it('calls electronAPI.agentChat.sendInteractionResponse when interactive request is submitted', async () => {
    const sendInteractionResponse = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI = { agentChat: { sendInteractionResponse } };

    const item: ChatRenderItem = {
      type: 'interactive-request',
      interactiveRequest: { interactionId: 'ir-test', prompt: 'Enter password', type: 'text' } as any,
      sectionKey: 'ir-sk',
      index: 0,
    };
    render(<ChatRenderItemComponent {...baseProps} item={item} />);
    const card = screen.getByTestId('interactive-request-card');
    fireEvent.click(card);
    await vi.waitFor(() => {
      expect(sendInteractionResponse).toHaveBeenCalled();
    });
  });
});

describe('ChatRenderItemComponent — sourceMessageIndex undefined branches', () => {
  it('tool-calls-section without sourceMessageIndex does not dim when editing', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'test', arguments: '{}' } }],
      sectionKey: 'sk-no-src',
      index: 0,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'e', index: 3, message: makeMessage({ id: 'e', role: 'user' }), warningMessage: null }} item={item} />,
    );
    // sourceMessageIndex is undefined, so ?? -1 makes shouldDim false
    expect(container.firstChild).not.toHaveStyle({ opacity: '0.42' });
  });

  it('interactive-auth without sourceMessageIndex does not dim when editing', () => {
    const item: ChatRenderItem = {
      type: 'interactive-auth',
      interactiveAuth: { hint: 'auth', command: 'cmd', chatSessionId: 'cs1' },
      sectionKey: 'ia-no-src',
      index: 0,
    };
    const { container } = render(
      <ChatRenderItemComponent {...baseProps} editingMessage={{ chatSessionId: 'cs', id: 'e', index: 3, message: makeMessage({ id: 'e', role: 'user' }), warningMessage: null }} item={item} />,
    );
    expect(container.firstChild).not.toHaveStyle({ opacity: '0.42' });
  });

  it('getChatRenderItemStableKey for tool-calls-section without sectionKey uses sourceMessageIndex', () => {
    const item: ChatRenderItem = {
      type: 'tool-calls-section',
      toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'test', arguments: '{}' } }],
      sectionKey: '',
      sourceMessageIndex: 42,
      index: 0,
    };
    expect(getChatRenderItemStableKey(item)).toBe('tool-calls-section:42');
  });
});
