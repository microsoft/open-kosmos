// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- CSS stubs ---
vi.mock('../../../../styles/Message.css', () => ({}));
vi.mock('../../../../styles/markdown-render.css', () => ({}));

// --- FileTypeIcon ---
vi.mock('../../../ui/FileTypeIcon', () => ({
  default: ({ fileName }: any) => <span data-testid="file-icon">{fileName}</span>,
}));

// --- StreamingV2Message ---
vi.mock('../../../streaming/StreamingV2Message', () => ({
  StreamingV2Message: ({ message, isStreaming }: any) => (
    <div data-testid="streaming-msg" data-streaming={String(isStreaming)}>
      {typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((c: any) => c.text || '').join('')
          : ''}
    </div>
  ),
}));

// --- featureFlags ---
const mockUseFeatureFlag = vi.fn(() => false);
vi.mock('../../../../lib/featureFlags', () => ({
  useFeatureFlag: (...args: any[]) => mockUseFeatureFlag(...args),
}));

// --- GeneratedFileCards ---
vi.mock('../GeneratedFileCards', () => ({
  default: ({ items }: any) => <div data-testid="gen-file-cards">{items?.length}</div>,
  normalizePresentedFilesToGeneratedFileItems: (files: any[]) =>
    files.map((f: any) => ({ filePath: f.filePath, exists: true })),
}));

// --- GeneratedScheduleCards ---
vi.mock('../GeneratedScheduleCards', () => ({
  default: ({ scheduleIds }: any) => <div data-testid="schedule-cards">{scheduleIds?.length}</div>,
}));

// --- SayHiActionItems ---
vi.mock('../SayHiActionItems', () => ({
  default: ({ groups }: any) => <div data-testid="say-hi-items" />,
  parseSayHiContent: (content: string) => ({
    markdownBody: content,
    actionItems: [],
    actionItemGroups: [],
  }),
}));



// --- logger ---
vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// --- ImageGalleryContextMenu ---
const mockGalleryMenuOpen = vi.fn();
vi.mock('../../../menu/ImageGalleryContextMenu', () => ({
  ImageGalleryMenuAtom: {
    useChange: () => ({ open: mockGalleryMenuOpen }),
  },
}));

// --- chatTypes ---
vi.mock('@shared/types/chatTypes', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    MessageHelper: {
      getText: vi.fn((msg: any) => {
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
          return msg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');
        }
        return '';
      }),
      getImages: vi.fn(() => []),
      getFiles: vi.fn(() => []),
      getOffice: vi.fn(() => []),
      getOthers: vi.fn(() => []),
    },
  };
});

// --- agentChatSessionCacheManager ---
vi.mock('@/lib/chat/agentChatSessionCacheManager', () => ({
  ChatStatus: {},
}));

import Message from '../Message';

// Helper to build a minimal message
const mkMsg = (overrides: any = {}): any => ({
  id: 'msg-1',
  role: 'assistant',
  content: 'Hello world',
  ...overrides,
});

describe('Message component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFeatureFlag.mockReturnValue(false);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders null for tool role messages', () => {
    const { container } = render(<Message message={mkMsg({ role: 'tool' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null for system role messages', () => {
    const { container } = render(<Message message={mkMsg({ role: 'system' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an assistant message', () => {
    render(<Message message={mkMsg({ role: 'assistant', content: 'Hello' })} />);
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('renders a user message', () => {
    render(<Message message={mkMsg({ role: 'user', content: 'User text' })} />);
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('shows copy button for user messages', () => {
    render(<Message message={mkMsg({ role: 'user', content: 'Copy me' })} />);
    expect(screen.getAllByTitle(/Copy/).length).toBeGreaterThan(0);
  });

  it('shows copy button for completed assistant messages', () => {
    render(<Message message={mkMsg({ role: 'assistant', content: 'Done' })} isStreaming={false} />);
    expect(screen.getAllByTitle(/Copy/).length).toBeGreaterThan(0);
  });

  it('hides metadata area while streaming', () => {
    render(<Message message={mkMsg({ role: 'assistant', content: 'Streaming...' })} isStreaming={true} />);
    // No copy button in metadata (streaming suppresses it)
    expect(screen.queryByTitle('Copy')).toBeNull();
  });

  it('copy button changes to Copied state briefly', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<Message message={mkMsg({ role: 'user', content: 'text' })} />);
    const copyBtn = screen.getByTitle('Copy');
    await act(async () => {
      fireEvent.click(copyBtn);
      // flush the async clipboard write promise
      await Promise.resolve();
    });
    expect(screen.getByTitle('Copied')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByTitle('Copy')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shows edit button when canEditUserMessage and onEditUserMessage are provided', () => {
    const onEdit = vi.fn();
    render(
      <Message
        message={mkMsg({ role: 'user', content: 'edit me' })}
        canEditUserMessage={true}
        onEditUserMessage={onEdit}
      />,
    );
    const editBtn = screen.getByTitle('Edit message');
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalled();
  });

  it('does not show edit button when canEditUserMessage is false', () => {
    render(<Message message={mkMsg({ role: 'user', content: 'text' })} canEditUserMessage={false} />);
    expect(screen.queryByTitle('Edit message')).toBeNull();
  });

  it('renders generated file cards when cachedFilePaths provided', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'here are files' })}
        isStreaming={false}
        cachedFilePaths={[{ path: '/tmp/file.txt', exists: true }]}
      />,
    );
    expect(screen.getByTestId('gen-file-cards')).toBeInTheDocument();
  });

  it('renders presentedFiles when provided', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'files' })}
        isStreaming={false}
        presentedFiles={[{ filePath: '/tmp/a.txt', fileName: 'a.txt', mimeType: 'text/plain' } as any]}
      />,
    );
    expect(screen.getByTestId('gen-file-cards')).toBeInTheDocument();
  });

  it('renders schedule cards when content has schedule IDs', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'Job sched_20240101120000_abc12345 created' })}
        isStreaming={false}
      />,
    );
    expect(screen.getByTestId('schedule-cards')).toBeInTheDocument();
  });

  it('strips FINAL_SUMMARY prefix from content', () => {
    render(
      <Message message={mkMsg({ role: 'assistant', content: '<FINAL_SUMMARY> My answer' })} isStreaming={false} />,
    );
    expect(screen.getByTestId('streaming-msg').textContent).toContain('My answer');
    expect(screen.getByTestId('streaming-msg').textContent).not.toContain('<FINAL_SUMMARY>');
  });

  it('handles array content for assistant messages', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: 'Array content' }] })}
        isStreaming={false}
      />,
    );
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('renders new-format image message (IMAGE_REGISTRY)', () => {
    const content = `Some text\n<IMAGE_REGISTRY>\n{"id":"img1","url":"http://example.com/img.png","alt":"test"}\n</IMAGE_REGISTRY>`;
    render(
      <Message message={mkMsg({ role: 'assistant', content })} isStreaming={false} />,
    );
    // Should use segmented rendering, resulting in StreamingV2Message for the text segment
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('renders message with tool_calls without metadata area', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'with tools', tool_calls: [{ id: 't1' }] })}
        isStreaming={false}
      />,
    );
    // With tool_calls and no presentedFiles, metadata (copy button) should not be rendered
    expect(screen.queryByTitle('Copy')).toBeNull();
  });

  it('renders metadata when tool_calls present AND presentedFiles provided', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'files', tool_calls: [{ id: 't1' }] })}
        isStreaming={false}
        presentedFiles={[{ filePath: '/tmp/a.txt', fileName: 'a.txt', mimeType: 'text/plain' } as any]}
      />,
    );
    expect(screen.getByTitle('Copy')).toBeInTheDocument();
  });
});
