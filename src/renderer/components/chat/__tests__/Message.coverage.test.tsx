/**
 * @vitest-environment happy-dom
 *
 * Message component — coverage for uncovered branches:
 * - tool / system role (returns null)
 * - assistant with tool_calls (has-tool-calls CSS)
 * - user message with file/image attachments
 * - say-hi assistant message
 * - hasNewImageFormat detection
 * - parseNewFormatMessage (via assistant message with IMAGE_REGISTRY)
 * - copy button interaction
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Message } from '@shared/types/chatTypes';
import MessageComponent from '../message/Message';

// ── module mocks (mirrors existing Message test setup) ──────────────────────

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
  useToast: () => ({ showToast: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../message/TextToSpeechButton', async () => ({
  TextToSpeechButton: () => null,
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

// ── helpers ──────────────────────────────────────────────────────────────────

function makeAssistantMessage(text: string, extra?: Partial<Message>): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    timestamp: Date.now(),
    streamingComplete: true,
    content: [{ type: 'text', text }],
    ...extra,
  } as Message;
}

function makeUserMessage(content: Message['content']): Message {
  return {
    id: 'user-1',
    role: 'user',
    timestamp: Date.now(),
    content,
  } as Message;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Message — role guards', () => {
  it('renders nothing for tool role messages', () => {
    const msg: Message = {
      id: 'tool-1',
      role: 'tool',
      content: [{ type: 'text', text: 'tool result' }],
      timestamp: Date.now(),
      streamingComplete: true,
    } as any;
    const { container } = render(<MessageComponent message={msg} isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for system role messages', () => {
    const msg: Message = {
      id: 'sys-1',
      role: 'system',
      content: [{ type: 'text', text: 'System instructions' }],
      timestamp: Date.now(),
    } as any;
    const { container } = render(<MessageComponent message={msg} isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('Message — assistant message CSS classes', () => {
  it('adds has-tool-calls class when assistant message has tool_calls', () => {
    const msg: Message = {
      ...makeAssistantMessage('Calling a tool'),
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
      ],
    } as any;
    const { container } = render(<MessageComponent message={msg} isStreaming={false} />);
    expect(container.querySelector('.has-tool-calls')).toBeInTheDocument();
  });

  it('does not add has-tool-calls class when assistant has no tool_calls', () => {
    const { container } = render(
      <MessageComponent message={makeAssistantMessage('Hello')} isStreaming={false} />,
    );
    expect(container.querySelector('.has-tool-calls')).not.toBeInTheDocument();
  });

  it('renders the assistant-message-container class for assistant messages', () => {
    const { container } = render(
      <MessageComponent message={makeAssistantMessage('Hi')} isStreaming={false} />,
    );
    expect(container.querySelector('.assistant-message-container')).toBeInTheDocument();
  });

  it('renders the user-message-container class for user messages', () => {
    const { container } = render(
      <MessageComponent
        message={makeUserMessage([{ type: 'text', text: 'Hello' }])}
        isStreaming={false}
      />,
    );
    expect(container.querySelector('.user-message-container')).toBeInTheDocument();
  });
});

describe('Message — say-hi assistant message', () => {
  it('renders a say-hi message as an assistant message', () => {
    const msg: Message = {
      ...makeAssistantMessage('Hello! How can I help?'),
      id: 'say-hi-session-1-1234',
    };
    const { container } = render(<MessageComponent message={msg} isStreaming={false} />);
    expect(container.querySelector('.assistant-message-container')).toBeInTheDocument();
    expect(screen.getByTestId('streaming-v2-message')).toBeInTheDocument();
  });
});

describe('Message — user message with attachments', () => {
  it('renders a user message with a file attachment', () => {
    const msg = makeUserMessage([
      { type: 'text', text: 'Please review this file.' },
      {
        type: 'file',
        file: { fileName: 'report.md', filePath: '/tmp/report.md', mimeType: 'text/markdown' },
        metadata: { fileSize: 2048 },
      } as any,
    ]);
    const { container } = render(<MessageComponent message={msg} isStreaming={false} />);
    expect(container.querySelector('.message-attachments')).toBeInTheDocument();
    expect(container.querySelector('.file-attachment')).toBeInTheDocument();
  });

  it('renders a user message with an image attachment', () => {
    const msg = makeUserMessage([
      { type: 'text', text: 'See the screenshot.' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,abc' },
        metadata: { fileName: 'screenshot.png', fileSize: 512 },
      } as any,
    ]);
    const { container } = render(<MessageComponent message={msg} isStreaming={false} />);
    // user message should render without crash; text visible
    expect(screen.getByTestId('streaming-v2-message')).toBeInTheDocument();
  });

  it('does not render attachment section when user message has no attachments', () => {
    const msg = makeUserMessage([{ type: 'text', text: 'Just text.' }]);
    const { container } = render(<MessageComponent message={msg} isStreaming={false} />);
    expect(container.querySelector('.message-attachments')).not.toBeInTheDocument();
  });
});

describe('Message — streaming assistant message', () => {
  it('adds streaming class to markdown container when isStreaming is true', () => {
    const { container } = render(
      <MessageComponent message={makeAssistantMessage('Typing...')} isStreaming />,
    );
    expect(container.querySelector('.markdown-body.streaming')).toBeInTheDocument();
  });

  it('does not add streaming class when isStreaming is false', () => {
    const { container } = render(
      <MessageComponent message={makeAssistantMessage('Done.')} isStreaming={false} />,
    );
    expect(container.querySelector('.markdown-body.streaming')).not.toBeInTheDocument();
  });
});

describe('Message — IMAGE_REGISTRY format detection and rendering', () => {
  it('renders segmented-message div for assistant message with complete IMAGE_REGISTRY', () => {
    const imageData = JSON.stringify({ id: 'img-1', url: 'file:///tmp/image.png', alt: 'Test' });
    const text = `Here is the result:\n<IMAGE_REGISTRY>\n${imageData}\n</IMAGE_REGISTRY>\nDone.`;
    const { container } = render(
      <MessageComponent message={makeAssistantMessage(text)} isStreaming={false} />,
    );
    expect(container.querySelector('.segmented-message.new-format')).toBeInTheDocument();
  });

  it('renders image-gallery segment for IMAGE_REGISTRY content', () => {
    const imageData = JSON.stringify({ id: 'img-1', url: 'file:///tmp/image.png', alt: 'Gallery' });
    const text = `<IMAGE_REGISTRY>\n${imageData}\n</IMAGE_REGISTRY>`;
    const { container } = render(
      <MessageComponent message={makeAssistantMessage(text)} isStreaming={false} />,
    );
    expect(container.querySelector('.segment-image-gallery')).toBeInTheDocument();
  });

  it('renders text segment before IMAGE_REGISTRY', () => {
    const imageData = JSON.stringify({ id: 'img-1', url: 'file:///tmp/image.png' });
    const text = `Introduction text\n<IMAGE_REGISTRY>\n${imageData}\n</IMAGE_REGISTRY>`;
    const { container } = render(
      <MessageComponent message={makeAssistantMessage(text)} isStreaming={false} />,
    );
    const textSegments = container.querySelectorAll('.segment-text');
    expect(textSegments.length).toBeGreaterThan(0);
  });

  it('renders text segment after IMAGE_REGISTRY', () => {
    const imageData = JSON.stringify({ id: 'img-1', url: 'file:///tmp/image.png' });
    const text = `<IMAGE_REGISTRY>\n${imageData}\n</IMAGE_REGISTRY>\nConcluding paragraph.`;
    const { container } = render(
      <MessageComponent message={makeAssistantMessage(text)} isStreaming={false} />,
    );
    const textSegments = container.querySelectorAll('.segment-text');
    expect(textSegments.length).toBeGreaterThan(0);
  });

  it('renders partial IMAGE_REGISTRY prefix as streaming text during streaming', () => {
    // Simulate streaming: only incomplete opening tag
    const text = 'Before registry\n<IMAGE_REGISTRY>\npartial content';
    const { container } = render(
      <MessageComponent message={makeAssistantMessage(text)} isStreaming />,
    );
    // Still uses segmented rendering path because hasNewImageFormat detects it
    expect(container.querySelector('.segmented-message.new-format')).toBeInTheDocument();
  });

  it('does not use segmented rendering for normal assistant message without IMAGE_REGISTRY', () => {
    const { container } = render(
      <MessageComponent message={makeAssistantMessage('Just a normal response.')} isStreaming={false} />,
    );
    expect(container.querySelector('.segmented-message')).not.toBeInTheDocument();
    expect(container.querySelector('.assistant-message-container')).toBeInTheDocument();
  });
});

describe('Message — copy button', () => {
  it('renders a copy button for user messages', () => {
    const { container } = render(
      <MessageComponent
        message={makeUserMessage([{ type: 'text', text: 'Hello world.' }])}
        isStreaming={false}
      />,
    );
    expect(container.querySelector('.copy-btn')).toBeInTheDocument();
  });

  it('copy button does not crash when clipboard is unavailable', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    const { container } = render(
      <MessageComponent
        message={makeUserMessage([{ type: 'text', text: 'Hello.' }])}
        isStreaming={false}
      />,
    );
    const copyBtn = container.querySelector('.copy-btn') as HTMLButtonElement;
    expect(() => fireEvent.click(copyBtn)).not.toThrow();
  });
});

describe('Message — FINAL_SUMMARY marker stripping', () => {
  it('strips the FINAL_SUMMARY marker from content before rendering', () => {
    const text = '<FINAL_SUMMARY>\nThis is the final answer.';
    render(<MessageComponent message={makeAssistantMessage(text)} isStreaming={false} />);
    const rendered = screen.getByTestId('streaming-v2-message');
    expect(rendered.textContent).not.toContain('<FINAL_SUMMARY>');
    expect(rendered.textContent).toContain('This is the final answer.');
  });
});
