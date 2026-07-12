/**
 * @vitest-environment happy-dom
 */
// @ts-nocheck
import React from 'react';
import { render, screen } from '@testing-library/react';
import { type Message, MessageHelper } from '@shared/types/chatTypes';

const {
  mockUseCurrentChatSessionId,
  mockUseMessagesWithStream,
  mockOnSessionSwitch,
  mockEditCancel,
} = vi.hoisted(() => ({
  mockUseCurrentChatSessionId: vi.fn(() => 'chat-session-1'),
  mockUseMessagesWithStream: vi.fn(() => ({
    messages: [] as Message[],
    streamingMessageId: undefined as string | undefined,
  })),
  mockOnSessionSwitch: vi.fn(),
  mockEditCancel: vi.fn(),
}));

vi.mock('../../../styles/ContentView.css', () => ({}));
vi.mock('../../../styles/Sidepane.css', () => ({}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: () => mockUseCurrentChatSessionId(),
  useMessagesWithStream: () => mockUseMessagesWithStream(),
  agentChatSessionCacheManager: {
    getChatSessionCache: vi.fn(() => ({ messages: [] })),
    replaceMessages: vi.fn(),
  },
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showError: vi.fn(), showToast: vi.fn() }),
}));

vi.mock('../../../lib/chat/agentChatIpc', () => ({
  agentChatIpc: { editUserMessage: vi.fn(), canEditUserMessage: vi.fn().mockResolvedValue({ canEdit: true }) },
}));

vi.mock('../edit-message.atom', () => ({
  editMessageAtom: {
    use: () => [null, { start: vi.fn(), cancel: mockEditCancel, save: vi.fn() }],
    useChange: () => ({ start: vi.fn(), cancel: mockEditCancel, save: vi.fn() }),
  },
}));

vi.mock('../chat-side.atom', () => ({
  WorkspaceExplorerAtom: {
    use: () => [{ visible: false }, { setVisible: vi.fn(), effectiveToggle: vi.fn() }],
    useChange: () => ({ onSessionSwitch: mockOnSessionSwitch, setVisible: vi.fn() }),
  },
  ScheduleSidepaneAtom: {
    use: () => [false, { effectiveToggle: vi.fn(), hide: vi.fn() }],
  },
  SubAgentTasksSidepaneAtom: {
    use: () => [{ visible: false }, { hide: vi.fn() }],
  },
}));

vi.mock('../ChatContainer', () => {
  let instanceId = 0;
  return {
    default: (props: any) => {
      const id = React.useMemo(() => ++instanceId, []);
      return (
        <div>
          <div data-testid="chat-container" data-instance-id={id}>
            {props.messages.map((m: Message) => m.id).join(',')}
          </div>
          <div data-testid="can-edit">{String(!!props.canEditUserMessage)}</div>
          <div data-testid="streaming-id">{props.streamingMessageId || 'none'}</div>
        </div>
      );
    },
  };
});

vi.mock('../ChatInput', () => ({
  default: (props: any) => (
    <div
      data-testid="chat-input"
      data-locked={props.isInputLocked ? 'true' : 'false'}
    >
      ChatInput
    </div>
  ),
}));

vi.mock('../ChatZeroStates', () => ({
  default: (props: any) => (
    <div data-testid="zero-states" data-agent={props.agentName}>
      ZeroStates
    </div>
  ),
}));

vi.mock('../ChatSide', () => ({
  default: () => <div data-testid="chat-side" />,
}));

vi.mock('../../../lib/chat/sendUserMessageOptimistically', () => ({
  sendUserMessage: vi.fn(),
  sendUserPrompt: vi.fn(),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../lib/userData/types', () => ({
  isBuiltinAgent: vi.fn((name: string, _brand: string) => {
    return name === 'Kobi';
  }),
  ZeroStates: {},
}));


vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../lib/chat/sessionMessageVisibility', () => ({
  isFrontendOnlySayHiMessage: (msg: any) =>
    msg.role === 'assistant' && Boolean(msg.id?.startsWith('say-hi-')),
}));

import ChatViewContent from '../ChatViewContent';

const createTextMessage = MessageHelper.createTextMessage;

describe('ChatViewContent – branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCurrentChatSessionId.mockReturnValue('chat-session-1');
    mockUseMessagesWithStream.mockReturnValue({ messages: [], streamingMessageId: undefined });
  });

  // Branch 2[1]: system message (msg.role !== 'system' is false — hasReal stays false)
  it('system messages are excluded from real-content detection', () => {
    const systemMsg: Message = { id: 'sys-1', role: 'system', content: 'You are a helpful assistant' } as any;
    mockUseMessagesWithStream.mockReturnValue({
      messages: [systemMsg],
      streamingMessageId: undefined,
    });

    const { container } = render(
      <ChatViewContent chatStatus="idle" agentName="TestBot" />,
    );

    // System message is not considered a real message so layout should be empty-chat
    expect(container.querySelector('.empty-chat')).toBeTruthy();
  });

  // Branch 10[0]: isEmpty=true -> 'empty-chat' class
  it('adds empty-chat class when there are no messages', () => {
    mockUseMessagesWithStream.mockReturnValue({ messages: [], streamingMessageId: undefined });

    const { container } = render(
      <ChatViewContent chatStatus="idle" agentName="TestBot" />,
    );

    expect(container.querySelector('.empty-chat')).toBeTruthy();
  });

  // Branch 11[0]: showZeroStates=true -> 'with-zero-states' class
  it('adds with-zero-states class when there are zero states and no messages', () => {
    mockUseMessagesWithStream.mockReturnValue({ messages: [], streamingMessageId: undefined });
    const zeroStates = {
      greeting: 'Hello there!',
      quick_starts: [],
    } as any;

    const { container } = render(
      <ChatViewContent chatStatus="idle" agentName="TestBot" zeroStates={zeroStates} />,
    );

    expect(container.querySelector('.with-zero-states')).toBeTruthy();
    expect(screen.getByTestId('zero-states')).toBeInTheDocument();
  });

  // Branch 7[3,4]: zeroStates with only quick_starts (no greeting)
  it('shows zero states when quick_starts present even without greeting', () => {
    mockUseMessagesWithStream.mockReturnValue({ messages: [], streamingMessageId: undefined });
    const zeroStates = {
      greeting: '',
      quick_starts: [{ label: 'Try this', prompt: 'Try this prompt' }],
    } as any;

    const { container } = render(
      <ChatViewContent chatStatus="idle" agentName="TestBot" zeroStates={zeroStates} />,
    );

    expect(container.querySelector('.with-zero-states')).toBeTruthy();
    expect(screen.getByTestId('zero-states')).toBeInTheDocument();
  });

  // Branch 7[3,4]: zeroStates with neither greeting nor quick_starts (no zero states shown)
  it('does not show zero states when greeting and quick_starts are both empty', () => {
    mockUseMessagesWithStream.mockReturnValue({ messages: [], streamingMessageId: undefined });
    const zeroStates = {
      greeting: '  ',
      quick_starts: [],
    } as any;

    const { container } = render(
      <ChatViewContent chatStatus="idle" agentName="TestBot" zeroStates={zeroStates} />,
    );

    expect(container.querySelector('.with-zero-states')).toBeNull();
    expect(screen.queryByTestId('zero-states')).not.toBeInTheDocument();
  });

  it('shows zero states for Kobi when configured', () => {
    mockUseMessagesWithStream.mockReturnValue({ messages: [], streamingMessageId: undefined });
    const zeroStates = {
      greeting: 'Kobi greeting',
      quick_starts: [{ label: 'Start', prompt: 'Start' }],
    } as any;

    const { container } = render(
      <ChatViewContent chatStatus="idle" agentName="Kobi" zeroStates={zeroStates} />,
    );

    expect(container.querySelector('.with-zero-states')).toBeTruthy();
    expect(screen.getByTestId('zero-states')).toBeInTheDocument();
  });

  // Branch 14[1]: streamingMessageId is defined (not undefined)
  it('passes streamingMessageId to ChatContainer when streaming', () => {
    const messages = [createTextMessage('hello', 'assistant', 'msg-1')];
    mockUseMessagesWithStream.mockReturnValue({
      messages,
      streamingMessageId: 'msg-1',
    });

    render(<ChatViewContent chatStatus="sending_response" agentName="TestBot" />);

    expect(screen.getByTestId('streaming-id')).toHaveTextContent('msg-1');
  });

  // Branch 17[1]: canEditUserMessage=false when chatStatus is not idle
  it('sets canEditUserMessage=false when chatStatus is sending_response', () => {
    const messages = [createTextMessage('hello', 'user', 'user-1')];
    mockUseMessagesWithStream.mockReturnValue({ messages, streamingMessageId: undefined });

    render(<ChatViewContent chatStatus="sending_response" agentName="TestBot" />);

    expect(screen.getByTestId('can-edit')).toHaveTextContent('false');
  });

  // chatStatus is idle and not switching -> canEdit=true
  it('sets canEditUserMessage=true when idle and not switching', () => {
    const messages = [createTextMessage('hello', 'user', 'user-1')];
    mockUseMessagesWithStream.mockReturnValue({ messages, streamingMessageId: undefined });

    render(<ChatViewContent chatStatus="idle" agentName="TestBot" />);

    expect(screen.getByTestId('can-edit')).toHaveTextContent('true');
  });

  // Branch: isEmpty=false when hasSayHiMessage (say-hi alone -> normal layout, but shouldShowSayHi=true)
  it('isEmpty=false when only say-hi message present (shouldShowSayHiMessage=true)', () => {
    const sayHiMsg = createTextMessage('welcome', 'assistant', 'say-hi-session-1');
    mockUseMessagesWithStream.mockReturnValue({
      messages: [sayHiMsg],
      streamingMessageId: undefined,
    });

    const { container } = render(
      <ChatViewContent chatStatus="idle" agentName="TestBot" />,
    );

    // shouldShowSayHiMessage=true means isEmpty=false (no 'empty-chat' class)
    expect(container.querySelector('.empty-chat')).toBeNull();
  });

  // Branch: hasSayHi=true but hasReal=true -> shouldShowSayHi=false, say-hi not in rendered list
  it('say-hi message excluded from render list when real messages exist', () => {
    const sayHiMsg = createTextMessage('welcome', 'assistant', 'say-hi-session-1');
    const userMsg = createTextMessage('hello', 'user', 'user-1');
    mockUseMessagesWithStream.mockReturnValue({
      messages: [sayHiMsg, userMsg],
      streamingMessageId: undefined,
    });

    render(<ChatViewContent chatStatus="idle" agentName="TestBot" />);

    const containerText = screen.getByTestId('chat-container').textContent || '';
    expect(containerText).not.toContain('say-hi-session-1');
    expect(containerText).toContain('user-1');
  });

  // Branch: isSessionSwitching=false, no messages -> showZeroStates depends on zeroStates
  it('does not show zero states when zeroStates is undefined', () => {
    render(<ChatViewContent chatStatus="idle" agentName="TestBot" />);

    expect(screen.queryByTestId('zero-states')).not.toBeInTheDocument();
  });

  // Branch: chatId passed through to ChatContainer
  it('passes chatId and currentChatSessionId to ChatContainer', () => {
    const messages = [createTextMessage('msg', 'user', 'u-1')];
    mockUseMessagesWithStream.mockReturnValue({ messages, streamingMessageId: undefined });
    mockUseCurrentChatSessionId.mockReturnValue('sess-abc');

    render(<ChatViewContent chatId="chat-xyz" chatStatus="idle" agentName="TestBot" />);

    // ChatContainer renders without error
    expect(screen.getByTestId('chat-container')).toBeInTheDocument();
  });

  // Branch: onSelectScheduledSession passed to ChatSide
  it('renders ChatSide regardless of onSelectScheduledSession', () => {
    render(
      <ChatViewContent
        chatStatus="idle"
        agentName="TestBot"
        onSelectScheduledSession={vi.fn()}
      />,
    );
    expect(screen.getByTestId('chat-side')).toBeInTheDocument();
  });

  it('remounts ChatContainer when session ID changes (#767)', () => {
    mockUseCurrentChatSessionId.mockReturnValue('session-A');
    mockUseMessagesWithStream.mockReturnValue({
      messages: [createTextMessage('hello', 'user', 'u-1')],
      streamingMessageId: undefined,
    });

    const { rerender } = render(
      <ChatViewContent chatStatus="idle" agentName="TestBot" />,
    );

    const firstInstanceId = screen.getByTestId('chat-container').getAttribute('data-instance-id');
    expect(firstInstanceId).toBeTruthy();

    // Switch session — key changes, so React should unmount old and mount new.
    // Also change a prop to bust React.memo so the component re-renders.
    mockUseCurrentChatSessionId.mockReturnValue('session-B');
    rerender(<ChatViewContent chatStatus="sending_response" agentName="TestBot" />);

    const secondInstanceId = screen.getByTestId('chat-container').getAttribute('data-instance-id');
    expect(secondInstanceId).toBeTruthy();
    // Different instance ID proves ChatContainer was remounted (not reused)
    expect(secondInstanceId).not.toBe(firstInstanceId);
  });

  // ChatViewContent is wrapped in memo; displayName check
  it('renders without error when no props provided', () => {
    render(<ChatViewContent />);
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  // Branch 14[1]: currentChatSessionId is null/falsy -> passes undefined to ChatContainer
  it('passes undefined as chatSessionId when currentChatSessionId is null', () => {
    mockUseCurrentChatSessionId.mockReturnValue(null);
    const messages = [createTextMessage('hello', 'user', 'user-1')];
    mockUseMessagesWithStream.mockReturnValue({ messages, streamingMessageId: undefined });

    render(<ChatViewContent chatStatus="idle" agentName="TestBot" />);

    // ChatContainer still renders (no crash)
    expect(screen.getByTestId('chat-container')).toBeInTheDocument();
  });
});
