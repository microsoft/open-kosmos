/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import type { Message } from '@shared/types/chatTypes';
import MessageComponent from '../message/Message';

vi.mock('react-syntax-highlighter', async () => ({
  Prism: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', async () => ({
  oneDark: {},
}));

vi.mock('../../../styles/Message.css', async () => ({}));
vi.mock('../../../styles/markdown-render.css', async () => ({}));

vi.mock('../../streaming/StreamingV2Message', async () => ({
  StreamingV2Message: ({ message }: { message: Message }) => (
    <div data-testid="streaming-v2-message" className="streaming-v2-message min-w-0 w-full max-w-full">
      {message.content.find((part) => part.type === 'text' && 'text' in part)?.text}
    </div>
  ),
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock('../../../lib/featureFlags', async () => ({
  useFeatureFlag: () => false,
}));

vi.mock('../message/GeneratedFileCards', async () => ({
  __esModule: true,
  default: () => null,
  normalizePresentedFilesToGeneratedFileItems: vi.fn(() => []),
}));

vi.mock('../message/GeneratedScheduleCards', async () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../message/SayHiActionItems', async () => ({
  __esModule: true,
  default: () => null,
  parseSayHiContent: vi.fn((content: string) => ({
    markdownBody: content,
    actionItemGroups: [],
  })),
}));

vi.mock('../message/PmProjectSayHiCards', async () => ({
  __esModule: true,
  default: () => null,
  parsePmSayHiCards: vi.fn(() => null),
}));

vi.mock('../message/PmAgentSayHiCards', async () => ({
  __esModule: true,
  default: () => null,
  parsePmAgentSayHiMessage: vi.fn(() => null),
}));

describe('Message assistant wrapping', () => {
  it('keeps the assistant streaming render path shrink-safe inside the markdown container', () => {
    const message: Message = {
      id: 'assistant-wrap',
      role: 'assistant',
      timestamp: Date.now(),
      streamingComplete: true,
      content: [
        {
          type: 'text',
          text: 'This is a long assistant response that should remain shrink-safe inside narrow layouts.',
        },
      ],
    };

    const { container } = render(<MessageComponent message={message} isStreaming={false} />);

    const markdownContainer = container.querySelector('.message-content.markdown-body');
    expect(markdownContainer).toBeInTheDocument();

    const assistantFlow = container.querySelector('.assistant-message-flow');
    expect(assistantFlow).toBeInTheDocument();
    expect(assistantFlow).toHaveClass('min-w-0', 'w-full', 'max-w-full');

    const streamingMessage = screen.getByTestId('streaming-v2-message');
    expect(streamingMessage).toHaveClass('streaming-v2-message', 'min-w-0', 'w-full', 'max-w-full');
  });

  it('renders user actions inside the dedicated user metadata container', () => {
    const message: Message = {
      id: 'user-actions-layout',
      role: 'user',
      timestamp: Date.now(),
      content: [
        {
          type: 'text',
          text: 'Journeys',
        },
      ],
    };

    const { container } = render(
      <MessageComponent
        message={message}
        isStreaming={false}
        canEditUserMessage
        onEditUserMessage={vi.fn()}
      />,
    );

    const userMetadata = container.querySelector('.message-metadata.user-message-metadata');
    expect(userMetadata).toBeInTheDocument();

    const assistantMetadata = container.querySelector('.assistant-message-metadata');
    expect(assistantMetadata).not.toBeInTheDocument();

    const actions = userMetadata?.querySelector('.message-actions');
    expect(actions).toBeInTheDocument();
    expect(within(userMetadata as HTMLElement).getByRole('button', { name: 'Edit message' })).toBeInTheDocument();
    expect(within(userMetadata as HTMLElement).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});