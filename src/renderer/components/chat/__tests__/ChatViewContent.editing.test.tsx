/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { type Message, MessageHelper } from '@shared/types/chatTypes';

const {
  mockUseCurrentChatSessionId,
  mockCanEditUserMessage,
  mockShowError,
  mockShowToast,
  mockUseMessagesWithStream,
  mockEditStart,
  mockEditCancel,
  mockEditSave,
} = vi.hoisted(() => ({
  mockUseCurrentChatSessionId: vi.fn(() => 'chat-session-1'),
  mockCanEditUserMessage: vi.fn(),
  mockShowError: vi.fn(),
  mockShowToast: vi.fn(),
  mockUseMessagesWithStream: vi.fn(() => ({ messages: [] as Message[], streamingMessageId: undefined as string | undefined })),
  mockEditStart: vi.fn(),
  mockEditCancel: vi.fn(),
  mockEditSave: vi.fn(),
}));

vi.mock('../../../styles/ContentView.css', async () => ({}));
vi.mock('../../../styles/Sidepane.css', async () => ({}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  useCurrentChatSessionId: () => mockUseCurrentChatSessionId(),
  useMessagesWithStream: () => mockUseMessagesWithStream(),
  agentChatSessionCacheManager: {
    getChatSessionCache: vi.fn(() => ({ messages: mockUseMessagesWithStream().messages })),
    replaceMessages: vi.fn(),
  },
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showError: mockShowError,
    showToast: mockShowToast,
  }),
}));

vi.mock('../../../lib/chat/agentChatIpc', async () => ({
  agentChatIpc: {
    editUserMessage: vi.fn(),
    canEditUserMessage: mockCanEditUserMessage,
  },
}));

vi.mock('../edit-message.atom', () => {
  const React = require('react');
  let editState: { chatSessionId: string; id: string; index: number; message: any; warningMessage: string | null } | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
  const getSnapshot = () => editState;
  const setEditState = (v: typeof editState) => { editState = v; listeners.forEach(l => l()); };

  return {
    editMessageAtom: {
      use: () => {
        const state = React.useSyncExternalStore(subscribe, getSnapshot);
        const actions = React.useMemo(() => ({
          start: async (chatSessionId: string, message: any, toast: any) => {
            const messageId = message?.id;
            const { agentChatSessionCacheManager } = await import('../../../lib/chat/agentChatSessionCacheManager');
            const cache = agentChatSessionCacheManager.getChatSessionCache(chatSessionId);
            const allMsgs = cache?.messages || [];
            const index = allMsgs.findIndex((m: any) => m.id === messageId);
            mockEditStart(chatSessionId, index, message, null, toast);
            const result = await mockCanEditUserMessage(chatSessionId, messageId);
            if (!result.canEdit) {
              toast?.showToast(result.error || 'This message can no longer be edited.', 'error', undefined, { persistent: true });
              return;
            }
            setEditState({ chatSessionId, id: messageId, index, message, warningMessage: null });
          },
          cancel: () => {
            mockEditCancel();
            setEditState(null);
          },
          save: (...args: any[]) => {
            mockEditSave(...args);
            setEditState(null);
          },
        }), []);
        return [state, actions] as const;
      },
      _reset: () => setEditState(null),
    },
  };
});

vi.mock('../ChatContainer', async () => {
  const { editMessageAtom } = await import('../edit-message.atom');
  return { default: (props: any) => {
    const [, editActions] = editMessageAtom.use();
    const toast = { showToast: mockShowToast, showError: mockShowError, showSuccess: vi.fn(), showWarning: vi.fn(), showInfo: vi.fn(), showUpdateToast: vi.fn(), dismissToast: vi.fn(), dismissAllToasts: vi.fn() } as any;

    return (
      <div>
        <div data-testid="chat-container-message-ids">
          {props.messages.map((message: Message) => message.id).join(',')}
        </div>
        <button
          type="button"
          onClick={() => {
            const msg = props.messages.find((m: Message) => m.id === 'user-2');
            props.canEditUserMessage && editActions.start(
              'chat-session-1',
              msg,
              toast,
            );
          }}
        >
          Start Edit
        </button>
        {props.editingMessage ? (
          <button type="button" onClick={() => editActions.cancel()}>
            Cancel Edit
          </button>
        ) : null}
      </div>
    );
  } };
});

vi.mock('../ChatInput', () => ({ default: (props: any) => (
  <div data-testid="bottom-chat-input" data-locked={props.isInputLocked ? 'true' : 'false'}>
    Bottom Chat Input
  </div>
) }));
vi.mock('../ChatZeroStates', () => ({ default: () => <div data-testid="zero-states" /> }));
vi.mock('../workspace/WorkspaceExplorerSidepane', () => ({ default: () => <div data-testid="workspace-sidepane" /> }));
vi.mock('../SchedulesSidepane', () => ({ default: () => <div data-testid="schedules-sidepane" /> }));
vi.mock('../InlineFilePreviewPanel', () => ({ default: () => <div data-testid="inline-preview" /> }));

import ChatViewContent from '../ChatViewContent';

const createTextMessage = MessageHelper.createTextMessage;

describe('ChatViewContent user-message editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanEditUserMessage.mockResolvedValue({ canEdit: true });
    mockUseMessagesWithStream.mockReturnValue({ messages: [], streamingMessageId: undefined });
  });

  it('keeps the bottom composer visible while inline editing is active', async () => {
    const messages = [
      createTextMessage('first', 'user', 'user-1'),
      createTextMessage('answer', 'assistant', 'assistant-1'),
      createTextMessage('latest', 'user', 'user-2'),
    ];
    mockUseMessagesWithStream.mockReturnValue({ messages, streamingMessageId: undefined });

    render(
      <ChatViewContent
        chatStatus="idle"
        agentName="OpenKosmos"
      />,
    );

    expect(screen.getByTestId('bottom-chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-chat-input')).toHaveAttribute('data-locked', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Start Edit' }));

    await waitFor(() => {
      expect(screen.getByTestId('bottom-chat-input')).toBeInTheDocument();
    });
    expect(screen.getByTestId('bottom-chat-input')).toHaveAttribute('data-locked', 'true');
    expect(screen.getByRole('button', { name: 'Cancel Edit' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Edit' }));

    expect(screen.getByTestId('bottom-chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-chat-input')).toHaveAttribute('data-locked', 'false');
  });

  it('shows a precheck error instead of entering edit mode when the message has been compressed out of context', async () => {
    mockCanEditUserMessage.mockResolvedValue({
      canEdit: false,
      error: 'This message can no longer be edited because its original content has been compressed out of the current context.',
    });

    const messages = [
      createTextMessage('first', 'user', 'user-1'),
      createTextMessage('answer', 'assistant', 'assistant-1'),
      createTextMessage('latest', 'user', 'user-2'),
    ];
    mockUseMessagesWithStream.mockReturnValue({ messages, streamingMessageId: undefined });

    render(
      <ChatViewContent
        chatStatus="idle"
        agentName="OpenKosmos"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start Edit' }));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'This message can no longer be edited because its original content has been compressed out of the current context.',
        'error',
        undefined,
        { persistent: true },
      );
    });
    expect(screen.getByTestId('bottom-chat-input')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel Edit' })).not.toBeInTheDocument();
  });

  it('shows a session transition placeholder instead of empty-state UI while switching sessions', () => {
    const zeroStates = {
      greeting: 'hello',
      quick_starts: [{ label: 'Try this', prompt: 'Try this' }],
    } as any;

    const { container } = render(
      <ChatViewContent
        isSessionSwitching
        chatStatus="idle"
        zeroStates={zeroStates}
        agentName="OpenKosmos"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Opening chat history...');
    expect(screen.getByTestId('bottom-chat-input')).toHaveAttribute('data-locked', 'true');
    expect(screen.queryByTestId('zero-states')).not.toBeInTheDocument();
    expect(container.querySelector('.chat-content')?.classList.contains('empty-chat')).toBe(false);
  });

  it('keeps say-hi visible only while the current session has no real user or assistant messages', () => {
    const sayHiMessage = createTextMessage('welcome', 'assistant', 'say-hi-chat-session-1');
    mockUseMessagesWithStream.mockReturnValue({ messages: [sayHiMessage], streamingMessageId: undefined });

    const { rerender } = render(
      <ChatViewContent
        chatId="chat-1"
        chatStatus="idle"
        agentName="PM Studio"
      />,
    );

    expect(screen.getByTestId('chat-container-message-ids')).toHaveTextContent('say-hi-chat-session-1');

    const replyMessage = createTextMessage('real reply', 'assistant', 'assistant-1');
    mockUseMessagesWithStream.mockReturnValue({ messages: [sayHiMessage, replyMessage], streamingMessageId: undefined });
    rerender(
      <ChatViewContent
        chatId="chat-2"
        chatStatus="idle"
        agentName="PM Studio"
      />,
    );

    expect(screen.getByTestId('chat-container-message-ids')).toHaveTextContent('assistant-1');
    expect(screen.getByTestId('chat-container-message-ids')).not.toHaveTextContent('say-hi-chat-session-1');
  });

  it('hides say-hi when the current session already contains tool output', () => {
    const sayHiMessage = createTextMessage('welcome', 'assistant', 'say-hi-chat-session-1');
    const toolMessage = MessageHelper.createToolMessage('tool output', 'call-1', 'some_tool', 'tool-1');
    mockUseMessagesWithStream.mockReturnValue({ messages: [sayHiMessage, toolMessage], streamingMessageId: undefined });

    render(
      <ChatViewContent
        chatStatus="idle"
        agentName="PM Studio"
      />,
    );

    expect(screen.getByTestId('chat-container-message-ids')).toHaveTextContent('tool-1');
    expect(screen.getByTestId('chat-container-message-ids')).not.toHaveTextContent('say-hi-chat-session-1');
  });


});