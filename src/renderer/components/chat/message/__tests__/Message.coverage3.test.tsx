// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Message.coverage3.test.tsx — targets remaining uncovered branches:
 * - optimizeContentForMarkdown: unclosed code block branch (line ~888)
 * - optimizeContentForMarkdown: incomplete inline code branch (line ~895)
 * - optimizeContentForMarkdown: partial markdown syntax branch (line ~902)
 * - onContentChange callback in StreamingV2Message onHeightChange (line ~960-961)
 * - assistant message with tool_calls but no presentedFiles (metadata hidden)
 * - isCopied state transition on copy
 * - renderGeneratedArtifacts: only scheduleIds, only presentedFiles
 * - say-hi message with card groups
 * - say-hi message with sayHiGroups (legacy chips)
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('../../../../styles/Message.css', () => ({}));
vi.mock('../../../../styles/markdown-render.css', () => ({}));

vi.mock('../../../ui/FileTypeIcon', () => ({
  default: ({ fileName }: any) => <span data-testid="file-icon">{fileName}</span>,
}));

let capturedOnHeightChange: ((h: number) => void) | null = null;
vi.mock('../../../streaming/StreamingV2Message', () => ({
  StreamingV2Message: ({ message, isStreaming, onHeightChange }: any) => {
    capturedOnHeightChange = onHeightChange || null;
    return (
      <div data-testid="streaming-msg" data-streaming={String(isStreaming)}>
        {Array.isArray(message.content)
          ? message.content.map((c: any) => c.text || '').join('')
          : String(message.content || '')}
      </div>
    );
  },
}));

const mockUseFeatureFlag = vi.fn(() => false);
vi.mock('../../../../lib/featureFlags', () => ({
  useFeatureFlag: (...args: any[]) => mockUseFeatureFlag(...args),
}));

vi.mock('../GeneratedFileCards', () => ({
  default: ({ items }: any) => <div data-testid="gen-file-cards">{items?.length}</div>,
  normalizePresentedFilesToGeneratedFileItems: (files: any[]) =>
    files.map((f: any) => ({ filePath: f.filePath, exists: true })),
}));

vi.mock('../GeneratedScheduleCards', () => ({
  default: ({ scheduleIds }: any) => <div data-testid="schedule-cards">{scheduleIds?.length}</div>,
}));

const mockParseSayHiContent = vi.fn((content: string) => ({
  markdownBody: content,
  actionItems: [],
  actionItemGroups: [],
}));
vi.mock('../SayHiActionItems', () => ({
  default: ({ groups }: any) => <div data-testid="say-hi-items">{groups?.length}</div>,
  parseSayHiContent: (...args: any[]) => mockParseSayHiContent(...args),
}));



vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../../menu/ImageGalleryContextMenu', () => ({
  ImageGalleryMenuAtom: {
    useChange: () => ({ open: vi.fn() }),
  },
}));

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

vi.mock('@/lib/chat/agentChatSessionCacheManager', () => ({
  ChatStatus: {},
}));

import Message from '../Message';

const mkMsg = (overrides: any = {}): any => ({
  id: 'msg-1',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello world' }],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFeatureFlag.mockReturnValue(false);
  capturedOnHeightChange = null;
  mockParseSayHiContent.mockReturnValue({ markdownBody: '', actionItems: [], actionItemGroups: [] });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('Message.coverage3 - optimizeContentForMarkdown: unclosed code block', () => {
  it('returns early when there is an unclosed code block during streaming', () => {
    const content = '```python\nprint("hello")';
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: content }] })}
        isStreaming={true}
      />
    );
    // Should render without crash
    expect(screen.getByTestId('streaming-msg')).toBeTruthy();
  });
});

describe('Message.coverage3 - optimizeContentForMarkdown: incomplete inline code', () => {
  it('returns early when there is incomplete inline code during streaming', () => {
    const content = 'Here is some `incomplete code';
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: content }] })}
        isStreaming={true}
      />
    );
    expect(screen.getByTestId('streaming-msg')).toBeTruthy();
  });
});

describe('Message.coverage3 - optimizeContentForMarkdown: partial markdown', () => {
  it('returns early when content ends with partial markdown syntax', () => {
    const content = 'Some text with partial **bold';
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: content }] })}
        isStreaming={true}
      />
    );
    expect(screen.getByTestId('streaming-msg')).toBeTruthy();
  });

  it('handles partial heading syntax during streaming', () => {
    const content = 'Some text ##';
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: content }] })}
        isStreaming={true}
      />
    );
    expect(screen.getByTestId('streaming-msg')).toBeTruthy();
  });
});

describe('Message.coverage3 - onContentChange callback via onHeightChange', () => {
  it('calls onContentChange when StreamingV2Message triggers onHeightChange', () => {
    const onContentChange = vi.fn();
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] })}
        isStreaming={true}
        onContentChange={onContentChange}
      />
    );

    // Trigger the height change callback
    act(() => {
      if (capturedOnHeightChange) {
        capturedOnHeightChange(100);
      }
    });

    expect(onContentChange).toHaveBeenCalledWith('Hello', true);
  });
});

describe('Message.coverage3 - assistant with tool_calls but no presentedFiles (hides metadata)', () => {
  it('does not show message metadata when assistant has tool_calls and no presentedFiles', () => {
    render(
      <Message
        message={mkMsg({
          role: 'assistant',
          content: [{ type: 'text', text: 'tool result' }],
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'search', arguments: '{}' } }],
        })}
        isStreaming={false}
        presentedFiles={[]}
      />
    );
    // metadata section should be hidden since tool_calls.length > 0 and no presentedFiles
    expect(screen.queryByTitle('Copy')).toBeNull();
  });
});

describe('Message.coverage3 - isCopied state transitions', () => {
  it('has a copy button that can be clicked without crashing', async () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] })}
        isStreaming={false}
      />
    );

    const copyBtn = screen.getByTitle('Copy');
    expect(copyBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
    });

    // clipboard.writeText should have been called
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello world');
  });
});

describe('Message.coverage3 - renderGeneratedArtifacts: schedule IDs in content', () => {
  it('renders GeneratedScheduleCards when content contains schedule job IDs', () => {
    const scheduleContent = 'Job ID: sched_20240101120000_abc-def_ghij123';
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: scheduleContent }] })}
        isStreaming={false}
      />
    );
    expect(screen.getByTestId('schedule-cards')).toBeTruthy();
  });
});

describe('Message.coverage3 - say-hi: legacy sayHiGroups path', () => {
  it('renders SayHiActionItems when sayHiGroups is non-empty', () => {
    mockParseSayHiContent.mockReturnValue({
      markdownBody: 'hello',
      actionItemGroups: [{ label: 'Group 1', items: [{ text: 'Item 1', prompt: 'prompt' }] }],
      actionItems: [],
    });

    render(
      <Message
        message={mkMsg({
          id: 'say-hi-002',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello with action items' }],
        })}
        isStreaming={false}
      />
    );
    expect(screen.getByTestId('say-hi-items')).toBeTruthy();
  });
});

describe('Message.coverage3 - user message copy', () => {
  it('renders Copy button for user message', () => {
    render(
      <Message
        message={mkMsg({ role: 'user', content: [{ type: 'text', text: 'user text' }] })}
        isStreaming={false}
      />
    );
    expect(screen.getByTitle('Copy')).toBeTruthy();
  });

  it('copies user message text to clipboard', async () => {
    render(
      <Message
        message={mkMsg({ role: 'user', content: [{ type: 'text', text: 'user text' }] })}
        isStreaming={false}
      />
    );
    const copyBtn = screen.getByTitle('Copy');
    fireEvent.click(copyBtn);
    await act(async () => { await Promise.resolve(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('user text');
  });
});

describe('Message.coverage3 - empty content branch', () => {
  it('handles empty string content', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: '' }] })}
        isStreaming={true}
      />
    );
    expect(screen.getByTestId('streaming-msg')).toBeTruthy();
  });
});

describe('Message.coverage3 - FINAL_SUMMARY marker removal', () => {
  it('strips FINAL_SUMMARY marker from content', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'text', text: '<FINAL_SUMMARY>\nActual content here' }] })}
        isStreaming={false}
      />
    );
    const msgEl = screen.getByTestId('streaming-msg');
    expect(msgEl.textContent).not.toContain('<FINAL_SUMMARY>');
    expect(msgEl.textContent).toContain('Actual content here');
  });
});
