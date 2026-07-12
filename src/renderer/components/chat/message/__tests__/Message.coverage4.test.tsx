// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Additional coverage tests for Message.tsx targeting the previously-uncovered
 * regions: the ImageGalleryNew sub-component (cache/fetch/FileReader, image
 * load/error, click + context-menu), renderNewFormatMessage segmented output,
 * renderAttachmentsContent (image/file/office/others attachment cards), and the
 * extractTextContent object/array branches.
 */

import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

// --- CSS stubs ---
vi.mock('../../../../styles/Message.css', () => ({}));
vi.mock('../../../../styles/markdown-render.css', () => ({}));

// --- FileTypeIcon ---
vi.mock('../../../ui/FileTypeIcon', () => ({
  default: ({ fileName }: any) => <span data-testid="file-icon">{fileName}</span>,
}));

// --- StreamingV2Message (captures callbacks so we can drive them) ---
const streamingCallbacks: Array<{ onStreamingComplete?: () => void; onHeightChange?: (h: number) => void }> = [];
vi.mock('../../../streaming/StreamingV2Message', () => ({
  StreamingV2Message: ({ message, isStreaming, onStreamingComplete, onHeightChange }: any) => {
    streamingCallbacks.push({ onStreamingComplete, onHeightChange });
    return (
      <div
        data-testid="streaming-msg"
        data-streaming={String(isStreaming)}
        onClick={() => {
          onStreamingComplete?.();
          onHeightChange?.(42);
        }}
      >
        {typeof message.content === 'string'
          ? message.content
          : Array.isArray(message.content)
            ? message.content.map((c: any) => c.text || '').join('')
            : ''}
      </div>
    );
  },
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
const mockParseSayHi = vi.fn((content: string) => ({
  markdownBody: content,
  actionItems: [],
  actionItemGroups: [],
}));
vi.mock('../SayHiActionItems', () => ({
  default: ({ groups }: any) => <div data-testid="say-hi-items">{groups?.length}</div>,
  parseSayHiContent: (c: string) => mockParseSayHi(c),
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

// --- chatTypes: MessageHelper getters are overridable per test ---
const mockGetImages = vi.fn(() => []);
const mockGetFiles = vi.fn(() => []);
const mockGetOffice = vi.fn(() => []);
const mockGetOthers = vi.fn(() => []);
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
      getImages: (...a: any[]) => mockGetImages(...a),
      getFiles: (...a: any[]) => mockGetFiles(...a),
      getOffice: (...a: any[]) => mockGetOffice(...a),
      getOthers: (...a: any[]) => mockGetOthers(...a),
    },
  };
});

// --- agentChatSessionCacheManager ---
vi.mock('@/lib/chat/agentChatSessionCacheManager', () => ({
  ChatStatus: {},
}));

import Message from '../Message';

const mkMsg = (overrides: any = {}): any => ({
  id: 'msg-1',
  role: 'assistant',
  content: 'Hello world',
  ...overrides,
});

// Build an assistant message whose content contains a complete IMAGE_REGISTRY block.
const registryContent = (url: string, id = 'img1', alt = 'an image') =>
  `Intro text\n<IMAGE_REGISTRY>\n${JSON.stringify({ id, url, alt })}\n</IMAGE_REGISTRY>\nTrailing text`;

// --- FileReader mock factory ---
let dispatchMode: 'loadend' | 'error' = 'loadend';
class MockFileReader {
  public result: any = 'data:image/png;base64,AAA';
  public onloadend: null | (() => void) = null;
  public onerror: null | (() => void) = null;
  readAsDataURL(_blob: any) {
    if (dispatchMode === 'error') {
      this.onerror?.();
    } else {
      this.onloadend?.();
    }
  }
}

describe('Message.tsx additional coverage', () => {
  let originalFetch: any;
  let originalFileReader: any;

  beforeEach(() => {
    vi.clearAllMocks();
    streamingCallbacks.length = 0;
    dispatchMode = 'loadend';
    mockUseFeatureFlag.mockReturnValue(false);
    mockGetImages.mockReturnValue([]);
    mockGetFiles.mockReturnValue([]);
    mockGetOffice.mockReturnValue([]);
    mockGetOthers.mockReturnValue([]);
    mockParseSayHi.mockImplementation((content: string) => ({
      markdownBody: content,
      actionItems: [],
      actionItemGroups: [],
    }));
    imageCacheClearHack();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    originalFetch = global.fetch;
    originalFileReader = global.FileReader;
    global.fetch = vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'])) });
    (global as any).FileReader = MockFileReader;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (global as any).FileReader = originalFileReader;
  });

  // The module-level imageCache Map persists across renders within the test
  // process. Use a unique URL per test to avoid cross-test cache hits.
  let urlSeq = 0;
  function uniqueHttpUrl() {
    urlSeq += 1;
    return `https://example.com/img-${urlSeq}.png`;
  }
  function imageCacheClearHack() {
    // No direct access to the private cache; uniqueness of URLs is sufficient.
  }

  // ── ImageGalleryNew via renderNewFormatMessage ────────────────────────────

  it('renders new-format image gallery and caches an http image via fetch+FileReader', async () => {
    const url = uniqueHttpUrl();
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content: registryContent(url) })} isStreaming={false} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Gallery container present
    expect(document.querySelector('.image-gallery-new')).toBeTruthy();
    // fetch was used to download the remote image
    expect(global.fetch).toHaveBeenCalledWith(url);
    // Segmented text rendered before/after the gallery
    expect(screen.getAllByTestId('streaming-msg').length).toBeGreaterThan(0);
  });

  it('uses direct file:// url without fetch', async () => {
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content: registryContent('file:///tmp/a.png') })}
          isStreaming={false}
        />,
      );
      await Promise.resolve();
    });
    expect(global.fetch).not.toHaveBeenCalled();
    const img = document.querySelector('.gallery-grid-item img') as HTMLImageElement;
    expect(img).toBeTruthy();
  });

  it('treats an absolute path url as a local file (prefixes file://)', async () => {
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content: registryContent('/tmp/local.png') })}
          isStreaming={false}
        />,
      );
      await Promise.resolve();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles FileReader error path by marking image as errored', async () => {
    dispatchMode = 'error';
    const url = uniqueHttpUrl();
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content: registryContent(url) })} isStreaming={false} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Error placeholder rendered
    expect(document.querySelector('.image-error-placeholder')).toBeTruthy();
  });

  it('handles fetch rejection in cacheImage catch branch', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('network down'));
    const url = uniqueHttpUrl();
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content: registryContent(url) })} isStreaming={false} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('.image-error-placeholder')).toBeTruthy();
  });

  it('fires img onLoad (with dimensions) and onError handlers', async () => {
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content: registryContent('file:///tmp/b.png') })}
          isStreaming={false}
        />,
      );
      await Promise.resolve();
    });
    const img = document.querySelector('.gallery-grid-item img') as HTMLImageElement;
    expect(img).toBeTruthy();
    // Simulate natural dimensions then fire load
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 200 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 100 });
    await act(async () => {
      fireEvent.load(img);
    });
    // Fire error on a fresh render's img
    await act(async () => {
      fireEvent.error(img);
    });
    expect(document.querySelector('.gallery-grid-item')).toBeTruthy();
  });

  it('clicking a loaded gallery item dispatches imageViewer:open', async () => {
    const handler = vi.fn();
    window.addEventListener('imageViewer:open', handler);
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content: registryContent('file:///tmp/c.png') })}
          isStreaming={false}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Clear the loading state by firing the hidden img's onLoad
    await act(async () => {
      fireEvent.load(document.querySelector('.gallery-grid-item img') as HTMLImageElement);
    });
    const item = document.querySelector('.gallery-grid-item') as HTMLElement;
    await act(async () => {
      fireEvent.click(item);
    });
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('imageViewer:open', handler);
  });

  it('right-clicking a loaded gallery item opens the context menu', async () => {
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content: registryContent('file:///tmp/d.png') })}
          isStreaming={false}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.load(document.querySelector('.gallery-grid-item img') as HTMLImageElement);
    });
    const item = document.querySelector('.gallery-grid-item') as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(item);
    });
    expect(mockGalleryMenuOpen).toHaveBeenCalled();
  });

  it('copy button in new-format metadata copies content', async () => {
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content: registryContent('file:///tmp/e.png') })}
          isStreaming={false}
        />,
      );
      await Promise.resolve();
    });
    const copyBtn = screen.getByLabelText('Copy');
    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
    });
    expect((navigator.clipboard as any).writeText).toHaveBeenCalled();
  });

  it('drives StreamingV2Message onStreamingComplete/onHeightChange in segments', async () => {
    const onContentChange = vi.fn();
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content: registryContent('file:///tmp/f.png') })}
          isStreaming={false}
          onContentChange={onContentChange}
        />,
      );
      await Promise.resolve();
    });
    const seg = screen.getAllByTestId('streaming-msg')[0];
    await act(async () => {
      fireEvent.click(seg); // our mock calls onStreamingComplete + onHeightChange
    });
    expect(onContentChange).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('suppresses new-format metadata while streaming', async () => {
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content: registryContent('file:///tmp/g.png') })}
          isStreaming={true}
        />,
      );
      await Promise.resolve();
    });
    // While streaming, the metadata copy button is not rendered
    expect(screen.queryByLabelText('Copy')).toBeNull();
  });

  it('renders incomplete streaming IMAGE_REGISTRY (start tag only)', async () => {
    const content = 'Before image\n<IMAGE_REGISTRY>\npartial-not-json';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={true} />);
      await Promise.resolve();
    });
    expect(screen.getAllByTestId('streaming-msg').length).toBeGreaterThan(0);
  });

  // ── renderAttachmentsContent (user message, array content) ────────────────

  it('renders image/file/office/others attachments and handles clicks', async () => {
    mockGetImages.mockReturnValue([
      { image_url: { url: 'http://x/img.png' }, metadata: { fileName: 'pic.png' } },
    ]);
    mockGetFiles.mockReturnValue([
      { file: { fileName: 'doc.txt', filePath: '/tmp/doc.txt', mimeType: 'text/plain' }, metadata: { fileSize: 10 } },
    ]);
    mockGetOffice.mockReturnValue([
      { file: { fileName: 'sheet.xlsx', filePath: '/tmp/sheet.xlsx', mimeType: 'app/xlsx' }, metadata: { fileSize: 20 } },
    ]);
    mockGetOthers.mockReturnValue([
      { file: { fileName: 'data.bin', filePath: '/tmp/data.bin', mimeType: 'app/bin' }, metadata: { fileSize: 30 } },
    ]);

    const imgHandler = vi.fn();
    const fileHandler = vi.fn();
    window.addEventListener('imageViewer:open', imgHandler);
    window.addEventListener('fileViewer:open', fileHandler);

    render(
      <Message
        message={mkMsg({ role: 'user', content: [{ type: 'text', text: 'see attachments' }] })}
        isStreaming={false}
      />,
    );

    // Click image attachment -> imageViewer:open
    fireEvent.click(document.querySelector('.image-attachment') as HTMLElement);
    expect(imgHandler).toHaveBeenCalled();

    // Click each file-attachment card -> fileViewer:open (file/office/others)
    const fileCards = document.querySelectorAll('.file-attachment');
    expect(fileCards.length).toBe(3);
    fileCards.forEach((c) => fireEvent.click(c as HTMLElement));
    expect(fileHandler).toHaveBeenCalled();

    // Trigger img onError on the attachment image
    const attachImg = document.querySelector('.attachment-image') as HTMLImageElement;
    fireEvent.error(attachImg);
    expect(attachImg.style.display).toBe('none');

    window.removeEventListener('imageViewer:open', imgHandler);
    window.removeEventListener('fileViewer:open', fileHandler);
  });

  it('renders no attachments block when there are zero attachment parts', () => {
    render(
      <Message
        message={mkMsg({ role: 'user', content: [{ type: 'text', text: 'plain' }] })}
        isStreaming={false}
      />,
    );
    expect(document.querySelector('.message-attachments')).toBeNull();
  });

  // ── extractTextContent branches ───────────────────────────────────────────

  it('extracts text from array content that lacks text parts via MessageHelper', () => {
    // content array of objects with type but no text -> falls through to MessageHelper.getText
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ type: 'image', foo: 'bar' }] })}
        isStreaming={false}
      />,
    );
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('renders empty string for non-array object content', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: { some: 'object' } as any })}
        isStreaming={false}
      />,
    );
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('coerces numeric/other primitive content to string', () => {
    render(
      <Message message={mkMsg({ role: 'assistant', content: 12345 as any })} isStreaming={false} />,
    );
    expect(screen.getByTestId('streaming-msg').textContent).toContain('12345');
  });

  // ── assistant non-new-format streaming callbacks ──────────────────────────

  it('drives onContentChange via the main assistant StreamingV2Message', () => {
    const onContentChange = vi.fn();
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'plain assistant text' })}
        isStreaming={true}
        onContentChange={onContentChange}
      />,
    );
    fireEvent.click(screen.getByTestId('streaming-msg'));
    expect(onContentChange).toHaveBeenCalledWith('plain assistant text', true);
  });

  it('logs say-hi message rendering branch', () => {
    render(
      <Message
        message={mkMsg({ id: 'say-hi-1', role: 'assistant', content: [{ type: 'text', text: 'hi there' }] })}
        isStreaming={false}
      />,
    );
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  // ── say-hi card variants ──────────────────────────────────────────────────


  it('renders legacy say-hi action item groups', () => {
    mockParseSayHi.mockReturnValue({
      markdownBody: 'body',
      actionItems: [],
      actionItemGroups: [{ title: 'g', items: [] }],
    });
    render(
      <Message
        message={mkMsg({ id: 'say-hi-legacy', role: 'assistant', content: 'greeting' })}
        isStreaming={false}
      />,
    );
    expect(screen.getByTestId('say-hi-items')).toBeInTheDocument();
  });

  // ── optimizeContentForMarkdown streaming branches ─────────────────────────

  it('handles streaming content with an unclosed code block', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'intro\n```js\nconst a = 1;' })}
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('handles streaming content ending in incomplete inline code', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'text with `inline' })}
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('handles streaming content ending in partial markdown syntax', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'a heading start **' })}
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('renders empty/falsy content without crashing', () => {
    render(<Message message={mkMsg({ role: 'assistant', content: '' })} isStreaming={true} />);
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  // ── multi-image gallery (loop with multiple registry entries) ─────────────

  it('renders multiple images in the gallery', async () => {
    const content =
      'Header\n<IMAGE_REGISTRY>\n' +
      JSON.stringify({ id: 'a', url: 'file:///tmp/a.png', alt: 'A' }) + '\n' +
      JSON.stringify({ id: 'b', url: 'file:///tmp/b.png', alt: 'B' }) + '\n' +
      '</IMAGE_REGISTRY>';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={false} />);
      await Promise.resolve();
    });
    expect(document.querySelectorAll('.gallery-grid-item').length).toBe(2);
  });

  it('skips invalid registry entries lacking a url', async () => {
    // imageData with id but no url -> registered but filtered/skipped in render
    const content =
      'Header\n<IMAGE_REGISTRY>\n' +
      JSON.stringify({ id: 'novalue' }) + '\n' +
      '</IMAGE_REGISTRY>';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={false} />);
      await Promise.resolve();
    });
    // No gallery item rendered because the only image has no url
    expect(document.querySelectorAll('.gallery-grid-item').length).toBe(0);
  });

  // ── parseNewFormatMessage edge branches ───────────────────────────────────

  it('registry at the very start with no preceding text', async () => {
    const content =
      '<IMAGE_REGISTRY>\n' + JSON.stringify({ id: 'a', url: 'file:///tmp/a.png' }) + '\n</IMAGE_REGISTRY>';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={false} />);
      await Promise.resolve();
    });
    expect(document.querySelector('.image-gallery-new')).toBeTruthy();
  });

  it('empty registry block produces no gallery', async () => {
    const content = 'Header\n<IMAGE_REGISTRY>\n\n</IMAGE_REGISTRY>\nFooter';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={false} />);
      await Promise.resolve();
    });
    expect(document.querySelectorAll('.gallery-grid-item').length).toBe(0);
  });

  it('registry with a non-JSON / id-less line yields no images', async () => {
    const content =
      'Header\n<IMAGE_REGISTRY>\nnot-json-line\n' + JSON.stringify({ url: 'file:///x.png' }) + '\n</IMAGE_REGISTRY>';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={false} />);
      await Promise.resolve();
    });
    expect(document.querySelectorAll('.gallery-grid-item').length).toBe(0);
  });

  it('renders a registry-prefix-only message (REGISTRY_PREFIXES branch)', () => {
    render(<Message message={mkMsg({ role: 'assistant', content: '<IMAGE' })} isStreaming={false} />);
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('incomplete registry start tag, not streaming (isStreaming false)', async () => {
    const content = 'Lead text\n<IMAGE_REGISTRY>\nstuff after';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={false} />);
      await Promise.resolve();
    });
    expect(screen.getAllByTestId('streaming-msg').length).toBeGreaterThan(0);
  });

  it('registry start tag at content start while streaming (no preceding text)', async () => {
    const content = '<IMAGE_REGISTRY>\nstreaming-tail';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={true} />);
      await Promise.resolve();
    });
    expect(screen.getAllByTestId('streaming-msg').length).toBeGreaterThan(0);
  });

  // ── gallery fallbacks: missing id / alt ───────────────────────────────────

  it('renders gallery images that lack id and alt (fallback paths)', async () => {
    // Two images, one without id/alt, exercising id/alt fallbacks in maps
    const content =
      'H\n<IMAGE_REGISTRY>\n' +
      JSON.stringify({ url: 'file:///tmp/noid.png' }) + '\n' +
      '</IMAGE_REGISTRY>';
    // image without id -> not registered (registry keyed by id). Use one WITH id but no alt.
    const content2 =
      'H\n<IMAGE_REGISTRY>\n' +
      JSON.stringify({ id: 'noalt', url: 'file:///tmp/noalt.png' }) + '\n' +
      '</IMAGE_REGISTRY>';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content: content2 })} isStreaming={false} />);
      await Promise.resolve();
    });
    const item = document.querySelector('.gallery-grid-item') as HTMLElement;
    await act(async () => {
      fireEvent.load(document.querySelector('.gallery-grid-item img') as HTMLImageElement);
    });
    await act(async () => {
      fireEvent.click(item);
      fireEvent.contextMenu(item);
    });
    expect(item).toBeTruthy();
  });

  // ── class ternaries: assistant with tool_calls ────────────────────────────

  it('new-format assistant message WITH tool_calls and presentedFiles renders metadata', async () => {
    const content = 'Lead\n<IMAGE_REGISTRY>\n' + JSON.stringify({ id: 'z', url: 'file:///tmp/z.png' }) + '\n</IMAGE_REGISTRY>';
    await act(async () => {
      render(
        <Message
          message={mkMsg({ role: 'assistant', content, tool_calls: [{ id: 't1' }] })}
          isStreaming={false}
          presentedFiles={[{ filePath: '/tmp/p.txt', fileName: 'p.txt', mimeType: 'text/plain' } as any]}
        />,
      );
      await Promise.resolve();
    });
    // has-tool-calls class on the segment message div
    expect(document.querySelector('.assistant-message.has-tool-calls')).toBeTruthy();
    expect(screen.getByLabelText('Copy')).toBeInTheDocument();
  });

  it('non-new-format assistant with tool_calls applies container has-tool-calls class', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: 'plain', tool_calls: [{ id: 't1' }] })}
        isStreaming={false}
      />,
    );
    expect(document.querySelector('.assistant-message-container.has-tool-calls')).toBeTruthy();
  });

  // ── attachment fallbacks: image without fileName metadata ─────────────────

  it('image attachment without fileName uses index fallback alt/title', () => {
    mockGetImages.mockReturnValue([
      { image_url: { url: 'http://x/i.png' }, metadata: {} },
    ]);
    const imgHandler = vi.fn();
    window.addEventListener('imageViewer:open', imgHandler);
    render(
      <Message
        message={mkMsg({ role: 'user', content: [{ type: 'text', text: 't' }] })}
        isStreaming={false}
      />,
    );
    fireEvent.click(document.querySelector('.image-attachment') as HTMLElement);
    expect(imgHandler).toHaveBeenCalled();
    window.removeEventListener('imageViewer:open', imgHandler);
  });

  // ── extractTextContent: object content[0] without type / falsy content ─────

  it('array content with objects lacking type falls back to empty string', () => {
    render(
      <Message
        message={mkMsg({ role: 'assistant', content: [{ foo: 'bar' }] as any })}
        isStreaming={false}
      />,
    );
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  it('null content coerces to empty string', () => {
    render(<Message message={mkMsg({ role: 'assistant', content: null as any })} isStreaming={false} />);
    expect(screen.getByTestId('streaming-msg')).toBeInTheDocument();
  });

  // ── assistant completed copy button "Copied" state ────────────────────────

  it('assistant completed copy button toggles to Copied', async () => {
    render(
      <Message message={mkMsg({ role: 'assistant', content: 'done text' })} isStreaming={false} />,
    );
    const copyBtn = screen.getByTitle('Copy');
    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
    });
    expect(screen.getByTitle('Copied')).toBeInTheDocument();
  });

  // ── cacheImage second-render cache hit (274 true branch) ──────────────────

  it('reuses imageCache on a second render of the same http image', async () => {
    const url = uniqueHttpUrl();
    const content = 'X\n<IMAGE_REGISTRY>\n' + JSON.stringify({ id: 'cc', url }) + '\n</IMAGE_REGISTRY>';
    await act(async () => {
      render(<Message message={mkMsg({ role: 'assistant', content })} isStreaming={false} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsAfterFirst = (global.fetch as any).mock.calls.length;
    // Second render with the same URL should hit the module-level cache, no new fetch
    await act(async () => {
      render(<Message message={mkMsg({ id: 'msg-2', role: 'assistant', content })} isStreaming={false} />);
      await Promise.resolve();
    });
    expect((global.fetch as any).mock.calls.length).toBe(callsAfterFirst);
  });

  // ── handleOpenImageViewer fallback (message.id undefined) ──────────────────

  it('image attachment on a message without id uses unknown fallback', () => {
    mockGetImages.mockReturnValue([
      { image_url: { url: 'http://x/i.png' }, metadata: {} },
    ]);
    const imgHandler = vi.fn();
    window.addEventListener('imageViewer:open', imgHandler);
    render(
      <Message
        message={{ role: 'user', content: [{ type: 'text', text: 't' }] } as any}
        isStreaming={false}
      />,
    );
    fireEvent.click(document.querySelector('.image-attachment') as HTMLElement);
    expect(imgHandler).toHaveBeenCalled();
    window.removeEventListener('imageViewer:open', imgHandler);
  });

  // ── renderNewFormatMessage message.id fallback + streaming gallery ────────

  it('new-format message without id, streaming, with trailing gallery', async () => {
    const content =
      'Lead\n<IMAGE_REGISTRY>\n' + JSON.stringify({ id: 'sg', url: 'file:///tmp/sg.png' }) + '\n</IMAGE_REGISTRY>';
    await act(async () => {
      render(
        <Message message={{ role: 'assistant', content } as any} isStreaming={true} />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('.image-gallery-new')).toBeTruthy();
    // last segment streaming class applied
    expect(document.querySelector('.segment.streaming')).toBeTruthy();
  });
});
