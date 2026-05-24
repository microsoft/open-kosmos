/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { type Message, MessageHelper } from '@shared/types/chatTypes';

vi.mock('../../../styles/ChatContainer.css', async () => ({}));
vi.mock('../../../styles/InteractiveRequestCard.css', async () => ({}));

vi.mock('../edit-message.atom', () => ({
  editMessageAtom: {
    useChange: () => ({ start: vi.fn(), cancel: vi.fn(), save: vi.fn() }),
  },
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showToast: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  extractFilePathsFromText: vi.fn(() => []),
  CurrentSessionInteractiveRequest: { use: () => null },
  useMessages: () => [],
}));

vi.mock('../message/Message', () => ({ default: (props: any) => (
  <div data-testid={`message-${props.message.id}`}>{props.message.id}</div>
) }));

vi.mock('../ChatInput', () => ({ default: () => <div data-testid="inline-edit-input" /> }));

vi.mock('../InteractiveRequestCard', async () => ({
  __esModule: true,
  default: () => null,
  InteractiveRequestHistoryItem: () => null,
}));

import ChatContainer from '../ChatContainer';

const createTextMessage = MessageHelper.createTextMessage;

describe('ChatContainer tool execution status with hidden say-hi', () => {
  it('keeps the tool section header in executing state when say-hi is omitted from rendered messages', () => {
    const sayHi = createTextMessage('say-hi-session-1', 'assistant', 'welcome');
    const user = createTextMessage('user-1', 'user', 'run task');
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
            arguments: JSON.stringify({ url: 'https://example.com' }),
          },
        },
      ],
    };

    const { container } = render(
      <ChatContainer
        messages={[user, assistantToolOnly]}
        allMessages={[sayHi, user, assistantToolOnly]}
        chatStatus="sending_response"
        streamingMessageId="assistant-tool-1"
      />,
    );

    expect(screen.getByText('Used 1 tool')).toBeInTheDocument();
    expect(container.querySelector('.tool-status-icon.executing')).toBeInTheDocument();
    expect(container.querySelector('.tool-status-icon.interrupted')).not.toBeInTheDocument();
  });
});