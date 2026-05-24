/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { type Message, type AssistantMessage, MessageHelper } from '@shared/types/chatTypes';

const mockUseMessages = vi.fn();
const mockUsePendingInteractiveRequest = vi.fn(() => null as any);
const mockEditStart = vi.fn();
const mockEditCancel = vi.fn();
const mockEditSave = vi.fn();

vi.mock('../../../styles/ChatContainer.css', async () => ({}));
vi.mock('../../../styles/InteractiveRequestCard.css', async () => ({}));

vi.mock('../edit-message.atom', () => ({
  editMessageAtom: {
    useChange: () => ({ start: mockEditStart, cancel: mockEditCancel, save: mockEditSave }),
  },
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showToast: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  useMessages: () => mockUseMessages(),
  extractFilePathsFromText: vi.fn(() => []),
  CurrentSessionInteractiveRequest: { use: () => mockUsePendingInteractiveRequest() },
}));

vi.mock('../message/Message', () => ({ default: (props: any) => (
  <div data-testid={`message-${props.message.id}`}>
    <span>{props.message.id}</span>
    {props.canEditUserMessage && props.onEditUserMessage ? (
      <button
        type="button"
        onClick={props.onEditUserMessage}
        aria-label="Edit message"
      >
        <svg aria-hidden="true" />
      </button>
    ) : null}
  </div>
) }));

vi.mock('../ChatInput', () => ({ default: (props: any) => (
  <div data-testid="inline-edit-input">
    <span>{props.initialMessage?.id}</span>
    <span>{props.warningMessage || 'no-warning'}</span>
  </div>
) }));

const mockToolCallsSection: Mock = vi.fn((_: any) => (
  <div data-testid="tool-calls-section" />
));

vi.mock('../ToolCallsSection', async () => ({
  ToolCallsSection: (props: any) => mockToolCallsSection(props),
}));

vi.mock('../InteractiveRequestCard', async () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-testid="interactive-request-card">{props.request.title}</div>
  ),
  InteractiveRequestHistoryItem: (props: any) => (
    <div data-testid="interactive-history-card">{props.entry.title}</div>
  ),
}));

import ChatContainer from '../ChatContainer';

const createTextMessage = MessageHelper.createTextMessage;

function installScrollMetrics(options: {
  scrollHeight: number;
  clientHeight?: number;
  initialScrollTop?: number;
}) {
  const originalScrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
  const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  const scrollTopWrites: number[] = [];
  let scrollTopValue = options.initialScrollTop ?? 0;

  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return scrollTopValue;
    },
    set(value: number) {
      scrollTopValue = value;
      scrollTopWrites.push(value);
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return options.scrollHeight;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return options.clientHeight ?? 0;
    },
  });

  const restoreDescriptor = (property: 'scrollTop' | 'scrollHeight' | 'clientHeight', descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
    } else {
      delete (HTMLElement.prototype as any)[property];
    }
  };

  return {
    scrollTopWrites,
    setScrollTop(value: number) {
      scrollTopValue = value;
    },
    cleanup() {
      restoreDescriptor('scrollTop', originalScrollTopDescriptor);
      restoreDescriptor('scrollHeight', originalScrollHeightDescriptor);
      restoreDescriptor('clientHeight', originalClientHeightDescriptor);
    },
  };
}

describe('ChatContainer user-message editing', () => {
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;

    window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      return window.setTimeout(() => callback(performance.now()), 0);
    }) as typeof window.requestAnimationFrame;

    window.cancelAnimationFrame = ((handle: number): void => {
      window.clearTimeout(handle);
    }) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('enables edit on all user messages and reports downstream side effects for the clicked message', () => {
    const firstUser = createTextMessage('first', 'user', 'user-1');
    const firstAssistant = createTextMessage('answer 1', 'assistant', 'assistant-1');
    const secondUser = createTextMessage('second', 'user', 'user-2');
    const downstreamAssistant: AssistantMessage = {
      ...createTextMessage('', 'assistant', 'assistant-2'),
      tool_calls: [
        {
          id: 'tool-call-1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: '{}',
          },
        },
      ],
    };

    mockUseMessages.mockReturnValue([firstUser, firstAssistant, secondUser, downstreamAssistant]);

    render(
      <ChatContainer
        messages={[firstUser, firstAssistant, secondUser, downstreamAssistant]}
        allMessages={[firstUser, firstAssistant, secondUser, downstreamAssistant]}
        chatStatus="idle"
        canEditUserMessage
      />,
    );

    const editButtons = screen.getAllByRole('button', { name: 'Edit message' });
    expect(editButtons).toHaveLength(2);

    fireEvent.click(within(screen.getByTestId('message-user-1')).getByRole('button', { name: 'Edit message' }));

    expect(mockEditStart).toHaveBeenCalled();
  });

  it('replaces the selected user message with the inline editor when editing', () => {
    const firstUser = createTextMessage('first', 'user', 'user-1');
    const firstAssistant = createTextMessage('answer 1', 'assistant', 'assistant-1');
    const secondUser = createTextMessage('second', 'user', 'user-2');

    mockUseMessages.mockReturnValue([firstUser, firstAssistant, secondUser]);

    render(
      <ChatContainer
        messages={[firstUser, firstAssistant, secondUser]}
        allMessages={[firstUser, firstAssistant, secondUser]}
        chatStatus="idle"
        editingMessage={{ chatSessionId: 'chat-1', id: 'user-2', index: 2, message: secondUser, warningMessage: 'external side effects already happened' }}
      />,
    );

    expect(screen.getByTestId('inline-edit-input')).toBeInTheDocument();
    expect(screen.getByText('user-2')).toBeInTheDocument();
    expect(screen.getByText('external side effects already happened')).toBeInTheDocument();
    expect(screen.queryByTestId('message-user-2')).not.toBeInTheDocument();
  });

  it('does not auto-scroll again when inline edit mode rerenders the same chat without new messages', () => {
    const firstUser = createTextMessage('first', 'user', 'user-1');
    const firstAssistant = createTextMessage('answer 1', 'assistant', 'assistant-1');
    const secondUser = createTextMessage('second', 'user', 'user-2');
    const messages = [firstUser, firstAssistant, secondUser];

    mockUseMessages.mockReturnValue(messages);

    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    let scrollTopWriteCount = 0;
    let scrollTopValue = 0;

    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTopValue;
      },
      set(value: number) {
        scrollTopWriteCount += 1;
        scrollTopValue = value;
      },
    });

    try {
      const { rerender } = render(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatStatus="idle"
          canEditUserMessage
        />,
      );

      const writesAfterInitialRender = scrollTopWriteCount;

      rerender(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatStatus="idle"
          editingMessage={{ chatSessionId: 'chat-1', id: 'user-2', index: 2, message: secondUser, warningMessage: 'external side effects already happened' }}
        />,
      );

      expect(scrollTopWriteCount).toBe(writesAfterInitialRender);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalDescriptor);
      }
    }
  });

  it('scrolls to the latest position on initial render after loading chat history', () => {
    const firstUser = createTextMessage('first', 'user', 'user-1');
    const firstAssistant = createTextMessage('answer 1', 'assistant', 'assistant-1');
    const secondUser = createTextMessage('second', 'user', 'user-2');
    const messages = [firstUser, firstAssistant, secondUser];

    mockUseMessages.mockReturnValue(messages);

    const originalScrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    let scrollTopValue = 0;

    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTopValue;
      },
      set(value: number) {
        scrollTopValue = value;
      },
    });

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 480;
      },
    });

    try {
      render(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatSessionId="chat-session-1"
          chatStatus="idle"
          canEditUserMessage
        />,
      );

      vi.runAllTimers();

      expect(scrollTopValue).toBe(480);
    } finally {
      if (originalScrollTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTopDescriptor);
      }
      if (originalScrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeightDescriptor);
      }
    }
  });

  it('scrolls to the latest position when switching to another session with the same chat and message count', () => {
    const firstSessionMessages = [
      createTextMessage('first', 'user', 'user-1'),
      createTextMessage('answer 1', 'assistant', 'assistant-1'),
    ];
    const secondSessionMessages = [
      createTextMessage('second', 'user', 'user-2'),
      createTextMessage('answer 2', 'assistant', 'assistant-2'),
    ];

    mockUseMessages
      .mockReturnValueOnce(firstSessionMessages)
      .mockReturnValueOnce(secondSessionMessages);

    const originalScrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const scrollTopWrites: number[] = [];
    let scrollTopValue = 0;

    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTopValue;
      },
      set(value: number) {
        scrollTopValue = value;
        scrollTopWrites.push(value);
      },
    });

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 640;
      },
    });

    try {
      const { rerender } = render(
        <ChatContainer
          messages={firstSessionMessages}
          allMessages={firstSessionMessages}
          chatSessionId="chat-session-1"
          chatStatus="idle"
          canEditUserMessage
        />,
      );

      vi.runAllTimers();

      rerender(
        <ChatContainer
          messages={secondSessionMessages}
          allMessages={secondSessionMessages}
          chatSessionId="chat-session-2"
          chatStatus="idle"
          canEditUserMessage
        />,
      );

      vi.runAllTimers();

      expect(scrollTopWrites.length).toBeGreaterThanOrEqual(2);
      expect(scrollTopWrites.every((value) => value === 640)).toBe(true);
    } finally {
      if (originalScrollTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTopDescriptor);
      }
      if (originalScrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeightDescriptor);
      }
    }
  });

  it('does not auto-scroll when only chatId changes but session and message count stay the same', () => {
    const messages = [
      createTextMessage('first', 'user', 'user-1'),
      createTextMessage('answer 1', 'assistant', 'assistant-1'),
    ];

    mockUseMessages.mockReturnValue(messages);

    const originalScrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const scrollTopWrites: number[] = [];
    let scrollTopValue = 0;

    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTopValue;
      },
      set(value: number) {
        scrollTopValue = value;
        scrollTopWrites.push(value);
      },
    });

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 512;
      },
    });

    try {
      const { rerender } = render(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatSessionId="chat-session-1"
          chatStatus="idle"
          canEditUserMessage
        />,
      );

      vi.runAllTimers();
      const writesAfterInitialRender = scrollTopWrites.length;

      rerender(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatSessionId="chat-session-1"
          chatStatus="idle"
          canEditUserMessage
        />,
      );

      vi.runAllTimers();

      expect(scrollTopWrites.length).toBe(writesAfterInitialRender);
      expect(scrollTopWrites.every((value) => value === 512)).toBe(true);
    } finally {
      if (originalScrollTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTopDescriptor);
      }
      if (originalScrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeightDescriptor);
      }
    }
  });

  it('pauses resize-driven latest-scroll while the user is reading earlier content and resumes near latest', () => {
    const user = createTextMessage('first', 'user', 'user-1');
    const assistant = createTextMessage('answer 1', 'assistant', 'assistant-1');
    const messages = [user, assistant];

    mockUseMessages.mockReturnValue(messages);

    const resizeCallbacks: ResizeObserverCallback[] = [];
    const originalResizeObserver = (window as any).ResizeObserver;
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
    }
    (window as any).ResizeObserver = MockResizeObserver;

    const scrollMetrics = installScrollMetrics({
      scrollHeight: 1000,
      clientHeight: 400,
    });

    try {
      const { container } = render(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatSessionId="chat-session-1"
          chatStatus="idle"
        />,
      );

      vi.runAllTimers();
      const writesAfterInitialRender = scrollMetrics.scrollTopWrites.length;
      const scrollContainer = container.querySelector('.chat-container-reverse') as HTMLElement;

      scrollMetrics.setScrollTop(500);
      fireEvent.scroll(scrollContainer);
      resizeCallbacks[0]?.([], {} as ResizeObserver);

      expect(scrollMetrics.scrollTopWrites.length).toBe(writesAfterInitialRender);

      scrollMetrics.setScrollTop(600);
      fireEvent.scroll(scrollContainer);
      resizeCallbacks[0]?.([], {} as ResizeObserver);

      expect(scrollMetrics.scrollTopWrites).toHaveLength(writesAfterInitialRender + 1);
      expect(scrollMetrics.scrollTopWrites.at(-1)).toBe(1000);
    } finally {
      scrollMetrics.cleanup();
      (window as any).ResizeObserver = originalResizeObserver;
    }
  });

  it('does not force-scroll appended assistant messages after manual scroll-away, but still follows appended user messages', () => {
    const firstUser = createTextMessage('first', 'user', 'user-1');
    const firstAssistant = createTextMessage('answer 1', 'assistant', 'assistant-1');
    const appendedAssistant = createTextMessage('answer 2', 'assistant', 'assistant-2');
    const appendedUser = createTextMessage('follow up', 'user', 'user-2');
    const initialMessages = [firstUser, firstAssistant];
    const assistantAppendedMessages = [firstUser, firstAssistant, appendedAssistant];
    const userAppendedMessages = [firstUser, firstAssistant, appendedAssistant, appendedUser];

    mockUseMessages.mockReturnValue(initialMessages);

    const scrollMetrics = installScrollMetrics({
      scrollHeight: 1000,
      clientHeight: 400,
    });

    try {
      const { container, rerender } = render(
        <ChatContainer
          messages={initialMessages}
          allMessages={initialMessages}
          chatSessionId="chat-session-1"
          chatStatus="idle"
        />,
      );

      vi.runAllTimers();
      const writesAfterInitialRender = scrollMetrics.scrollTopWrites.length;
      const scrollContainer = container.querySelector('.chat-container-reverse') as HTMLElement;

      scrollMetrics.setScrollTop(500);
      fireEvent.scroll(scrollContainer);

      rerender(
        <ChatContainer
          messages={assistantAppendedMessages}
          allMessages={assistantAppendedMessages}
          chatSessionId="chat-session-1"
          chatStatus="sending_response"
        />,
      );
      vi.runAllTimers();

      expect(scrollMetrics.scrollTopWrites.length).toBe(writesAfterInitialRender);

      rerender(
        <ChatContainer
          messages={userAppendedMessages}
          allMessages={userAppendedMessages}
          chatSessionId="chat-session-1"
          chatStatus="idle"
        />,
      );
      vi.runAllTimers();

      expect(scrollMetrics.scrollTopWrites.length).toBeGreaterThan(writesAfterInitialRender);
      expect(scrollMetrics.scrollTopWrites.at(-1)).toBe(1000);
    } finally {
      scrollMetrics.cleanup();
    }
  });

  it('shows a jump-to-latest button after manual scroll-away and hides it on click while force-scrolling to latest', () => {
    const messages = [
      createTextMessage('first', 'user', 'user-1'),
      createTextMessage('answer 1', 'assistant', 'assistant-1'),
    ];

    mockUseMessages.mockReturnValue(messages);

    const scrollMetrics = installScrollMetrics({
      scrollHeight: 1000,
      clientHeight: 400,
    });

    try {
      const { container } = render(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatSessionId="chat-session-1"
          chatStatus="idle"
        />,
      );

      vi.runAllTimers();

      expect(screen.queryByRole('button', { name: /scroll to latest message/i })).not.toBeInTheDocument();

      const scrollContainer = container.querySelector('.chat-container-reverse') as HTMLElement;
      scrollMetrics.setScrollTop(500);
      fireEvent.scroll(scrollContainer);

      const jumpButton = screen.getByRole('button', { name: /scroll to latest message/i });
      const writesBeforeClick = scrollMetrics.scrollTopWrites.length;

      fireEvent.click(jumpButton);
      vi.runAllTimers();

      expect(screen.queryByRole('button', { name: /scroll to latest message/i })).not.toBeInTheDocument();
      expect(scrollMetrics.scrollTopWrites.length).toBeGreaterThan(writesBeforeClick);
      expect(scrollMetrics.scrollTopWrites.at(-1)).toBe(1000);
    } finally {
      scrollMetrics.cleanup();
    }
  });

  it('renders the new session prop messages when rerendering a same-chat session switch', () => {
    const firstSessionMessages = [
      createTextMessage('first', 'user', 'user-1'),
      createTextMessage('answer 1', 'assistant', 'assistant-1'),
    ];
    const secondSessionMessages = [
      createTextMessage('second', 'user', 'user-2'),
      createTextMessage('answer 2', 'assistant', 'assistant-2'),
    ];

    mockUseMessages.mockReturnValue(firstSessionMessages);

    const { rerender } = render(
      <ChatContainer
        messages={firstSessionMessages}
        allMessages={firstSessionMessages}
        chatSessionId="chat-session-1"
        chatStatus="idle"
      />,
    );

    expect(screen.getByTestId('message-user-1')).toBeInTheDocument();
    expect(screen.queryByTestId('message-user-2')).not.toBeInTheDocument();

    // Simulate stale internal hook data while the parent has already switched sessions.
    mockUseMessages.mockReturnValue(firstSessionMessages);

    rerender(
      <ChatContainer
        messages={secondSessionMessages}
        allMessages={secondSessionMessages}
        chatSessionId="chat-session-2"
        chatStatus="idle"
      />,
    );

    expect(screen.queryByTestId('message-user-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-user-2')).toBeInTheDocument();
  });

  it('dims only downstream messages in chronological order while editing', () => {
    const firstUser = createTextMessage('first', 'user', 'user-1');
    const firstAssistant = createTextMessage('answer 1', 'assistant', 'assistant-1');
    const secondUser = createTextMessage('second', 'user', 'user-2');
    const secondAssistant = createTextMessage('answer 2', 'assistant', 'assistant-2');
    const messages = [firstUser, firstAssistant, secondUser, secondAssistant];

    mockUseMessages.mockReturnValue(messages);

    render(
      <ChatContainer
        messages={messages}
        allMessages={messages}
        chatStatus="idle"
        editingMessage={{ chatSessionId: 'chat-1', id: 'user-2', index: 2, message: secondUser, warningMessage: null }}
      />,
    );

    const newerAssistantWrapper = screen.getByTestId('message-assistant-2').parentElement;
    const olderAssistantWrapper = screen.getByTestId('message-assistant-1').parentElement;
    const olderUserWrapper = screen.getByTestId('message-user-1').parentElement;

    expect(newerAssistantWrapper).toHaveStyle({ opacity: '0.42' });
    expect(olderAssistantWrapper).not.toHaveStyle({ opacity: '0.42' });
    expect(olderUserWrapper).not.toHaveStyle({ opacity: '0.42' });
  });

  it('replaces the bottom activity slot with the newest tool-call section instead of rendering loading outside the message flow', () => {
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistant = createTextMessage('working', 'assistant', 'assistant-1');

    mockUseMessages.mockReturnValue([user, assistant]);

    const { container, rerender } = render(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="sending_response"
      />,
    );

    const messageFlow = container.querySelector('.chat-message-flow-reverse');
    const initialActivitySlot = messageFlow?.querySelector('.chat-activity-slot');
    expect(initialActivitySlot).toBeInTheDocument();
    expect(container.querySelectorAll('.chat-activity-slot')).toHaveLength(1);

    const assistantToolCall: Message = {
      id: 'assistant-tool-1',
      role: 'assistant',
      timestamp: Date.now(),
      streamingComplete: false,
      content: [],
      tool_calls: [
        {
          id: 'tool-call-1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{}',
          },
        },
      ],
    };

    mockUseMessages.mockReturnValue([user, assistant, assistantToolCall]);

    rerender(
      <ChatContainer
        messages={[user, assistant, assistantToolCall]}
        allMessages={[user, assistant, assistantToolCall]}
        chatStatus="sending_response"
        streamingMessageId="assistant-tool-1"
      />,
    );

    const toolCallsSection = screen.getByTestId('tool-calls-section');
    expect(toolCallsSection).toBeInTheDocument();
    expect(messageFlow?.querySelector('.chat-activity-slot')).not.toBeInTheDocument();
    expect(toolCallsSection.parentElement).toBe(messageFlow?.children[1]);
    expect(container.querySelectorAll('.chat-activity-slot')).toHaveLength(0);
  });

  it('keeps a hidden placeholder slot when loading hides before any visible assistant tool call content exists', () => {
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistant = createTextMessage('working', 'assistant', 'assistant-1');

    mockUseMessages.mockReturnValue([user, assistant]);

    const { container, rerender } = render(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="sending_response"
      />,
    );

    const streamingAssistantPendingToolName: Message = {
      id: 'assistant-tool-pending',
      role: 'assistant',
      timestamp: Date.now(),
      streamingComplete: false,
      content: [],
      tool_calls: [
        {
          id: '',
          type: 'function',
          function: {
            name: '',
            arguments: '',
          },
        },
      ],
    };

    mockUseMessages.mockReturnValue([user, assistant, streamingAssistantPendingToolName]);

    rerender(
      <ChatContainer
        messages={[user, assistant, streamingAssistantPendingToolName]}
        allMessages={[user, assistant, streamingAssistantPendingToolName]}
        chatStatus="sending_response"
        streamingMessageId="assistant-tool-pending"
      />,
    );

    const placeholderSlot = container.querySelector('.chat-activity-slot-placeholder');
    expect(placeholderSlot).toBeInTheDocument();
    expect(placeholderSlot).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.chat-activity-slot-placeholder-content')).toBeInTheDocument();
  });

  it('keeps the newest slot stable across loading, placeholder, tool-call section, and next loading states', () => {
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistant = createTextMessage('working', 'assistant', 'assistant-1');

    mockUseMessages.mockReturnValue([user, assistant]);

    const { container, rerender } = render(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="sending_response"
      />,
    );

    const getNewestLiveSlot = () => container.querySelector('.chat-message-flow-reverse')?.children[1] ?? null;

    expect(getNewestLiveSlot()).toHaveClass('chat-activity-slot');

    const pendingStreamingAssistant: Message = {
      id: 'assistant-loop',
      role: 'assistant',
      timestamp: Date.now(),
      streamingComplete: false,
      content: [],
      tool_calls: [
        {
          id: '',
          type: 'function',
          function: {
            name: '',
            arguments: '',
          },
        },
      ],
    };

    mockUseMessages.mockReturnValue([user, assistant, pendingStreamingAssistant]);

    rerender(
      <ChatContainer
        messages={[user, assistant, pendingStreamingAssistant]}
        allMessages={[user, assistant, pendingStreamingAssistant]}
        chatStatus="sending_response"
        streamingMessageId="assistant-loop"
      />,
    );

    expect(getNewestLiveSlot()).toHaveClass('chat-activity-slot', 'chat-activity-slot-placeholder');

    const visibleToolCallAssistant: Message = {
      ...pendingStreamingAssistant,
      tool_calls: [
        {
          id: 'tool-call-1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{}',
          },
        },
      ],
    };

    mockUseMessages.mockReturnValue([user, assistant, visibleToolCallAssistant]);

    rerender(
      <ChatContainer
        messages={[user, assistant, visibleToolCallAssistant]}
        allMessages={[user, assistant, visibleToolCallAssistant]}
        chatStatus="sending_response"
        streamingMessageId="assistant-loop"
      />,
    );

    expect(screen.getByTestId('tool-calls-section')).toBeInTheDocument();
    expect(getNewestLiveSlot()).not.toHaveClass('chat-activity-slot');

    const toolResultMessage: Message = {
      id: 'tool-call-1',
      role: 'tool',
      timestamp: Date.now(),
      streamingComplete: true,
      tool_call_id: 'tool-call-1',
      name: 'read_file',
      content: [{ type: 'text', text: 'done' }],
    };

    mockUseMessages.mockReturnValue([user, assistant, visibleToolCallAssistant]);

    rerender(
      <ChatContainer
        messages={[user, assistant, visibleToolCallAssistant]}
        allMessages={[user, assistant, visibleToolCallAssistant, toolResultMessage]}
        chatStatus="sending_response"
      />,
    );

    expect(getNewestLiveSlot()).toHaveClass('chat-activity-slot');
    expect(container.querySelector('.chat-activity-slot-placeholder')).not.toBeInTheDocument();
  });

  it('keeps a sticky placeholder if activity disappears but the latest visible message item has not changed yet', () => {
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistant = createTextMessage('working', 'assistant', 'assistant-1');

    mockUseMessages.mockReturnValue([user, assistant]);

    const { container, rerender } = render(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="sending_response"
      />,
    );

    expect(container.querySelector('.chat-activity-slot')).toBeInTheDocument();

    rerender(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="received_response"
      />,
    );

    const stickyPlaceholder = container.querySelector('.chat-activity-slot-placeholder');
    expect(stickyPlaceholder).toBeInTheDocument();
    expect(stickyPlaceholder).toHaveAttribute('aria-hidden', 'true');

    const nextAssistant = createTextMessage('visible follow-up', 'assistant', 'assistant-2');
    mockUseMessages.mockReturnValue([user, assistant, nextAssistant]);

    rerender(
      <ChatContainer
        messages={[user, assistant, nextAssistant]}
        allMessages={[user, assistant, nextAssistant]}
        chatStatus="received_response"
      />,
    );

    expect(container.querySelector('.chat-activity-slot-placeholder')).not.toBeInTheDocument();
  });

  it('renders a pending interactive request inline in the timeline', () => {
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistant = createTextMessage('waiting for approval', 'assistant', 'assistant-1');

    mockUseMessages.mockReturnValue([user, assistant]);
    mockUsePendingInteractiveRequest.mockReturnValue({
      interactionId: 'approval-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      status: 'pending',
      title: 'Review tool access requests',
      createdAt: Date.now(),
      items: [],
    });

    render(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="idle"
      />,
    );

    expect(screen.getByTestId('interactive-request-card')).toHaveTextContent('Review tool access requests');
  });

  it('preserves the allMessages source index for tool sections when say-hi is hidden from the rendered list', () => {
    const sayHi = createTextMessage('welcome', 'assistant', 'say-hi-session-1');
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistantToolOnly: Message = {
      id: 'assistant-tool-1',
      role: 'assistant',
      timestamp: Date.now(),
      streamingComplete: false,
      content: [],
      tool_calls: [
        {
          id: 'tool-call-1',
          type: 'function',
          function: {
            name: 'fetch_webpage',
            arguments: '{}',
          },
        },
      ],
    };

    const renderedMessages = [user, assistantToolOnly];
    const allMessages = [sayHi, user, assistantToolOnly];
    mockUseMessages.mockReturnValue(allMessages);

    render(
      <ChatContainer
        messages={renderedMessages}
        allMessages={allMessages}
        chatStatus="sending_response"
        streamingMessageId="assistant-tool-1"
      />,
    );

    expect(mockToolCallsSection).toHaveBeenCalled();
    const lastToolCallsSectionProps = mockToolCallsSection.mock.calls[mockToolCallsSection.mock.calls.length - 1]?.[0];
    expect(lastToolCallsSectionProps?.sourceMessageIndex).toBe(2);
  });

  it('scrolls to the latest position when a pending interactive request appears without new messages', () => {
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistant = createTextMessage('waiting for approval', 'assistant', 'assistant-1');
    const messages = [user, assistant];

    mockUseMessages.mockReturnValue(messages);
    mockUsePendingInteractiveRequest.mockReturnValue(null);

    const originalScrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const scrollTopWrites: number[] = [];
    let scrollTopValue = 0;

    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTopValue;
      },
      set(value: number) {
        scrollTopValue = value;
        scrollTopWrites.push(value);
      },
    });

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 720;
      },
    });

    try {
      const { rerender } = render(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatStatus="idle"
          chatSessionId="session-0"
        />,
      );

      vi.runOnlyPendingTimers();
      const writesAfterInitialRender = scrollTopWrites.length;

      mockUsePendingInteractiveRequest.mockReturnValue({
        interactionId: 'approval-1',
        chatId: 'chat-1',
        chatSessionId: 'session-1',
        requestType: 'approval',
        status: 'pending',
        title: 'Review tool access requests',
        createdAt: Date.now(),
        items: [],
      });

      rerender(
        <ChatContainer
          messages={messages}
          allMessages={messages}
          chatStatus="idle"
          chatSessionId="session-1"
        />,
      );

      vi.runOnlyPendingTimers();

      expect(scrollTopWrites.length).toBeGreaterThan(writesAfterInitialRender);
      expect(scrollTopWrites.slice(writesAfterInitialRender).every((value) => value === 720)).toBe(true);
    } finally {
      if (originalScrollTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTopDescriptor);
      }
      if (originalScrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeightDescriptor);
      }
    }
  });

  it('does not keep resolved interactive history cards in the UI after completion', () => {
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistant = createTextMessage('done', 'assistant', 'assistant-1');

    mockUseMessages.mockReturnValue([user, assistant]);

    render(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="idle"
      />,
    );

    expect(screen.queryByTestId('interactive-history-card')).not.toBeInTheDocument();
  });

  it('removes the pending interactive card after cancellation clears the request and chat returns to idle', () => {
    const user = createTextMessage('run task', 'user', 'user-1');
    const assistant = createTextMessage('waiting for approval', 'assistant', 'assistant-1');

    mockUseMessages.mockReturnValue([user, assistant]);
    mockUsePendingInteractiveRequest.mockReturnValue({
      interactionId: 'approval-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      status: 'pending',
      title: 'Review tool access requests',
      createdAt: Date.now(),
      items: [],
    });

    const { rerender } = render(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="sending_response"
      />,
    );

    expect(screen.getByTestId('interactive-request-card')).toHaveTextContent('Review tool access requests');

    mockUsePendingInteractiveRequest.mockReturnValue(null);

    rerender(
      <ChatContainer
        messages={[user, assistant]}
        allMessages={[user, assistant]}
        chatStatus="idle"
      />,
    );

    expect(screen.queryByTestId('interactive-request-card')).not.toBeInTheDocument();
  });
});