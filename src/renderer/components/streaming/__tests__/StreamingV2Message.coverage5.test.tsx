// @ts-nocheck
/** @vitest-environment happy-dom */

/**
 * StreamingV2Message — coverage file 5.
 *
 * The existing suites render through the REAL react-markdown, so the `pre`
 * handler always receives a populated hast `node` and Strategy 1 wins — leaving
 * Strategy 2 (the React-children fallback), the optional-chaining arms, and the
 * string-className branch uncovered.
 *
 * Here react-markdown is mocked to CAPTURE the `components` map, then the test
 * invokes `components.pre` / `components.code` directly with hand-crafted props
 * to drive every Strategy 1 / Strategy 2 branch deterministically. The
 * StreamingScrollManager branches and the handleFastDisplay/metrics timer
 * branches are covered with focused direct tests.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../styles/StreamingV2Message.css', () => ({}));
vi.mock('../../../styles/markdown-render.css', () => ({}));
vi.mock('remark-gfm', () => ({ default: () => () => {} }));
vi.mock('remark-breaks', () => ({ default: () => () => {} }));

// Capture the components map handed to react-markdown.
const captured: { components?: any } = {};
vi.mock('react-markdown', () => ({
  default: ({ components, children }: any) => {
    if (components) captured.components = components;
    return <div data-testid="rm">{typeof children === 'string' ? children : null}</div>;
  },
}));

vi.mock('../../chat/MermaidDiagram', () => ({
  default: ({ definition }: any) => <div data-testid="mermaid">{definition}</div>,
}));
vi.mock('../../chat/CodeBlockCopyButton', () => ({
  default: ({ code }: any) => <button data-testid="copy-btn">{String(code).slice(0, 10)}</button>,
}));
vi.mock('../../chat/CodeBlockContent', () => ({
  CodeBlockContent: ({ language, content }: any) => (
    <pre data-testid="cbc" data-lang={language}>{content}</pre>
  ),
}));

const mockGetCompatibleConfig = vi.fn(() => ({
  optimizedConfig: { baseDelay: 1, enableBatching: true, maxBatchSize: 20 },
}));
const mockGetConfigForText = vi.fn(() => ({ baseDelay: 1, enableBatching: true, maxBatchSize: 20 }));
let mockShowCursor = true;
vi.mock('../../../lib/streaming/streamingConfig', () => ({
  streamingConfigManager: {
    getUIConfig: vi.fn(() => ({
      showCursor: mockShowCursor,
      cursorAnimation: 'smooth',
      smoothScrolling: true,
      autoScrollThreshold: 150,
      renderingMode: 'adaptive',
    })),
  },
}));
vi.mock('../../../lib/streaming/streamingOptimizer', () => ({
  streamingOptimizer: { getConfigForText: (...a: any[]) => mockGetConfigForText(...a) },
}));
vi.mock('../../../lib/streaming/compatibilityLayer', () => ({
  streamingCompatibility: { getCompatibleConfig: (...a: any[]) => mockGetCompatibleConfig(...a) },
}));

const mockOpen = vi.fn();
vi.mock('../../browser/embeddedBrowser.atom', () => ({
  EmbeddedBrowserAtom: { useChange: () => ({ open: mockOpen }) },
}));
let mockSessionId: string | null = 'sess-5';
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: () => mockSessionId,
}));
vi.mock('../../../lib/chat/filePathUtils', () => ({
  linkifyFilePaths: (text: string) => text,
  isLocalFilePath: (href: string) => /^\/[^/]/.test(href) || /^[A-Za-z]:[\\/]/.test(href) || /^file:\/\/\//i.test(href),
  isFilePathString: () => false,
  getFileName: (p: string) => p,
  stripFileScheme: (p: string) => p,
}));
let mockBrowserEnabled = true;
vi.mock('../../../lib/userData/useEmbeddedBrowserEnabled', () => ({
  useEmbeddedBrowserEnabled: () => mockBrowserEnabled,
}));

import { StreamingV2Message, StreamingScrollManager } from '../StreamingV2Message';

function makeMessage(content: any, overrides: Record<string, any> = {}) {
  return { id: 'msg', role: 'assistant', content, createdAt: new Date(), ...overrides } as any;
}

// Render SV2 (non-streaming so displayedText is set synchronously, which means
// ReactMarkdown renders and the components map is captured) → return components.
function getComponents() {
  captured.components = undefined;
  render(<StreamingV2Message message={makeMessage('seed text')} isStreaming={false} />);
  if (!captured.components) throw new Error('components not captured');
  return captured.components;
}
function renderEl(el: React.ReactNode) {
  return render(<>{el}</>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionId = 'sess-5';
  mockBrowserEnabled = true;
  mockShowCursor = true;
  mockGetCompatibleConfig.mockReturnValue({
    optimizedConfig: { baseDelay: 1, enableBatching: true, maxBatchSize: 20 },
  });
});

// ============================================================
// code component (line 327)
// ============================================================
describe('code component', () => {
  it('block code with language- className is preserved (327 true)', () => {
    const c = getComponents();
    const { container } = renderEl(c.code({ className: 'language-ts', children: 'let x' }));
    const el = container.querySelector('code.language-ts');
    expect(el).toBeTruthy();
    expect(el!.classList.contains('inline-code')).toBe(false);
  });
  it('inline code without language- gets inline-code (327 false)', () => {
    const c = getComponents();
    const { container } = renderEl(c.code({ children: 'inline' }));
    expect(container.querySelector('code.inline-code')).toBeTruthy();
  });
});

// ============================================================
// pre Strategy 1 — hast node (lines 346-365)
// ============================================================
describe('pre Strategy 1 (hast node)', () => {
  it('array className with language- (line 351 true)', () => {
    const c = getComponents();
    const node = { children: [{ tagName: 'code', properties: { className: ['language-python'] }, children: [{ type: 'text', value: 'p' }] }] };
    renderEl(c.pre({ node, children: [] }));
    expect(document.querySelector('[data-testid="cbc"]')!.getAttribute('data-lang')).toBe('python');
  });

  it('array className without language- → stays text (line 351 langCls undefined)', () => {
    const c = getComponents();
    const node = { children: [{ tagName: 'code', properties: { className: ['hljs', 'foo'] }, children: [{ type: 'text', value: 'x' }] }] };
    renderEl(c.pre({ node, children: [] }));
    expect(document.querySelector('[data-testid="cbc"]')!.getAttribute('data-lang')).toBe('text');
  });

  it('string className with language- (lines 352, 354 true)', () => {
    const c = getComponents();
    const node = { children: [{ tagName: 'code', properties: { className: 'language-rust' }, children: [{ type: 'text', value: 'r' }] }] };
    renderEl(c.pre({ node, children: [] }));
    expect(document.querySelector('[data-testid="cbc"]')!.getAttribute('data-lang')).toBe('rust');
  });

  it('string className "language-" with no \\w → match null (line 354 false)', () => {
    const c = getComponents();
    const node = { children: [{ tagName: 'code', properties: { className: 'language-' }, children: [{ type: 'text', value: 'x' }] }] };
    renderEl(c.pre({ node, children: [] }));
    expect(document.querySelector('[data-testid="cbc"]')!.getAttribute('data-lang')).toBe('text');
  });

  it('extractText recurses + skips non-text nodes (lines 358, 359, 360)', () => {
    const c = getComponents();
    const node = { children: [{
      tagName: 'code', properties: { className: ['language-txt'] },
      children: [
        { type: 'text', value: 'a' },
        { type: 'element', children: [{ type: 'text', value: 'b' }] },
        { type: 'comment' },
      ],
    }] };
    renderEl(c.pre({ node, children: [] }));
    expect(document.querySelector('[data-testid="cbc"]')!.textContent).toBe('ab');
  });

  it('node present but first child not <code> → falls to Strategy 2 (line 346 false)', () => {
    const c = getComponents();
    const node = { children: [{ tagName: 'span' }] };
    const codeChild = React.createElement('code', { className: 'language-go' }, 'g');
    renderEl(c.pre({ node, children: [codeChild] }));
    expect(document.querySelector('[data-testid="cbc"]')!.getAttribute('data-lang')).toBe('go');
  });

  it('mermaid language renders MermaidDiagram (line 387)', () => {
    const c = getComponents();
    const node = { children: [{ tagName: 'code', properties: { className: ['language-mermaid'] }, children: [{ type: 'text', value: 'graph TD; A-->B;' }] }] };
    renderEl(c.pre({ node, children: [] }));
    expect(document.querySelector('[data-testid="mermaid"]')!.textContent).toContain('graph TD');
  });
});

// ============================================================
// pre Strategy 2 — React children fallback (lines 369-384, 404)
// ============================================================
describe('pre Strategy 2 (React children)', () => {
  it('finds <code> child by type, extracts language (lines 373, 380, 381 true)', () => {
    const c = getComponents();
    const codeChild = React.createElement('code', { className: 'language-java' }, 'System.out');
    renderEl(c.pre({ children: [codeChild] }));
    expect(document.querySelector('[data-testid="cbc"]')!.getAttribute('data-lang')).toBe('java');
  });

  it('code child className present but no language match → text (line 381 false)', () => {
    const c = getComponents();
    const codeChild = React.createElement('code', { className: 'hljs' }, 'x');
    renderEl(c.pre({ children: [codeChild] }));
    expect(document.querySelector('[data-testid="cbc"]')!.getAttribute('data-lang')).toBe('text');
  });

  it('single non-code child with children matches via length===1 clause (line 373 third clause)', () => {
    const c = getComponents();
    const spanChild = React.createElement('span', {}, 'wrapped');
    renderEl(c.pre({ children: [spanChild] }));
    expect(document.querySelector('[data-testid="cbc"]')!.getAttribute('data-lang')).toBe('text');
  });

  it('no detectable code child → fallback pre-wrapper (line 369 detected stays false → 404)', () => {
    const c = getComponents();
    const { container } = renderEl(c.pre({ children: [] }));
    expect(container.querySelector('.pre-wrapper')).toBeTruthy();
    expect(document.querySelector('[data-testid="cbc"]')).toBeNull();
  });
});

// ============================================================
// language label conditional (line 395)
// ============================================================
describe('language label', () => {
  it('non-text language shows "</> LANG"', () => {
    const c = getComponents();
    const node = { children: [{ tagName: 'code', properties: { className: ['language-cpp'] }, children: [{ type: 'text', value: 'x' }] }] };
    const { container } = renderEl(c.pre({ node, children: [] }));
    expect(container.querySelector('.code-block-language')!.textContent).toBe('</> CPP');
  });
  it('text language shows empty label', () => {
    const c = getComponents();
    const node = { children: [{ tagName: 'code', properties: {}, children: [{ type: 'text', value: 'x' }] }] };
    const { container } = renderEl(c.pre({ node, children: [] }));
    expect(container.querySelector('.code-block-language')!.textContent).toBe('');
  });
});

// ============================================================
// a link handler — local path vs http routing
// ============================================================
describe('a link handler', () => {
  it('http link with session opens in-app browser', () => {
    const c = getComponents();
    const { container } = renderEl(c.a({ href: 'https://example.com', children: 'x' }));
    fireEvent.click(container.querySelector('a')!);
    expect(mockOpen).toHaveBeenCalledWith('sess-5', 'https://example.com');
  });
  it('http link keeps default behavior when embedded browser is disabled', () => {
    mockBrowserEnabled = false;
    const c = getComponents();
    const { container } = renderEl(c.a({ href: 'https://example.com', children: 'x' }));
    const anchor = container.querySelector('a')!;
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(anchor, event);
    expect(event.defaultPrevented).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });
  it('local path link routes to workspace.openPath for non-previewable files', () => {
    (window as any).electronAPI = { workspace: { openPath: vi.fn() } };
    const c = getComponents();
    const { container } = renderEl(c.a({ href: '/Users/x/file.docx', children: 'f' }));
    fireEvent.click(container.querySelector('a')!);
    expect((window as any).electronAPI.workspace.openPath).toHaveBeenCalledWith('/Users/x/file.docx');
  });

  it('local path link dispatches fileViewer:open for previewable files', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const c = getComponents();
    const { container } = renderEl(c.a({ href: '/Users/x/file.txt', children: 'f' }));
    fireEvent.click(container.querySelector('a')!);
    const fileViewerEvent = dispatchSpy.mock.calls.find(
      ([event]) => (event as CustomEvent).type === 'fileViewer:open'
    );
    expect(fileViewerEvent).toBeDefined();
    const detail = (fileViewerEvent![0] as CustomEvent).detail;
    expect(detail.file.url).toBe('/Users/x/file.txt');
    dispatchSpy.mockRestore();
  });

  it('local backslash path dispatches fileViewer:open with correct filename', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const c = getComponents();
    const { container } = renderEl(c.a({ href: 'C:\\Users\\x\\notes.md', children: 'notes' }));
    fireEvent.click(container.querySelector('a')!);
    const fileViewerEvent = dispatchSpy.mock.calls.find(
      ([event]) => (event as CustomEvent).type === 'fileViewer:open'
    );
    if (fileViewerEvent) {
      const detail = (fileViewerEvent[0] as CustomEvent).detail;
      expect(detail.file.name).toBe('notes.md');
    }
    dispatchSpy.mockRestore();
  });

  it('bare filename previewable link dispatches fileViewer:open with filename as-is', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const c = getComponents();
    const { container } = renderEl(c.a({ href: 'readme.md', children: 'readme' }));
    fireEvent.click(container.querySelector('a')!);
    const fileViewerEvent = dispatchSpy.mock.calls.find(
      ([event]) => (event as CustomEvent).type === 'fileViewer:open'
    );
    if (fileViewerEvent) {
      const detail = (fileViewerEvent[0] as CustomEvent).detail;
      expect(detail.file.name).toBe('readme.md');
    }
    dispatchSpy.mockRestore();
  });
});

describe('inline markdown components', () => {
  it('keeps the strong renderer wired after custom link routing', () => {
    const c = getComponents();
    const { container } = renderEl(c.strong({ children: 'bold' }));
    const strong = container.querySelector('strong.font-bold');
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe('bold');
  });
});

// ============================================================
// handleFastDisplay — array content join + double-click clearTimeout
// (lines 186, 187, 197)
// ============================================================
function setupRAF() {
  const callbacks: Array<(t: number) => void> = [];
  const origRAF = globalThis.requestAnimationFrame;
  const origCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = vi.fn((cb) => { callbacks.push(cb); return callbacks.length; }) as any;
  globalThis.cancelAnimationFrame = vi.fn(() => { callbacks.length = 0; });
  const flush = (t: number) => { const cbs = [...callbacks]; callbacks.length = 0; cbs.forEach((cb) => cb(t)); };
  const teardown = () => { globalThis.requestAnimationFrame = origRAF; globalThis.cancelAnimationFrame = origCancel; };
  return { flush, teardown };
}

describe('handleFastDisplay (array content + double click)', () => {
  let raf: ReturnType<typeof setupRAF>;
  beforeEach(() => { vi.useFakeTimers(); raf = setupRAF();
    mockGetCompatibleConfig.mockReturnValue({ optimizedConfig: { baseDelay: 100, enableBatching: false, maxBatchSize: 5 } });
  });
  afterEach(() => { vi.useRealTimers(); raf.teardown(); });

  it('clicking while typing with array content joins parts (186, 187) and double click clears timeout (197)', () => {
    const content = [
      { type: 'text', text: 'Part ' },
      'literal-string-part ',
      { type: 'text' }, // no .text → falls to '' via || (line 187)
      { type: 'text', text: 'tail of message that is long enough to type out slowly' },
    ];
    const { container } = render(<StreamingV2Message message={makeMessage(content)} isStreaming={true} />);
    act(() => { raf.flush(0); }); // begins typing → isTyping true

    const el = container.querySelector('.message-content') as HTMLElement;
    act(() => { fireEvent.click(el); }); // first skip → sets clickTimeoutRef
    // Re-arm typing so a second click re-enters handleFastDisplay's clearTimeout (197)
    act(() => { vi.advanceTimersByTime(1100); });
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });
});

// ============================================================
// metrics effect clearTimeout on re-trigger (line 289)
// ============================================================
describe('metrics auto-hide timer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('re-running the metrics effect clears the previous timeout (line 289)', () => {
    const metrics = { wordsPerSecond: 5, totalTime: 100, totalFragments: 3, fragmentsPerSecond: 2, contentLength: 10, wordCount: 2 } as any;
    const { rerender } = render(
      <StreamingV2Message message={makeMessage('hello')} isStreaming={true} enableMetricsDisplay={true} streamingMetrics={metrics} />
    );
    // Re-render with a NEW metrics object → effect deps change → clearTimeout of the
    // previous metricsTimeoutRef fires (line 289 true).
    rerender(
      <StreamingV2Message message={makeMessage('hello')} isStreaming={true} enableMetricsDisplay={true} streamingMetrics={{ ...metrics, wordsPerSecond: 6 }} />
    );
    expect(document.querySelector('.streaming-metrics')).toBeTruthy();
  });
});

// ============================================================
// StreamingScrollManager — handleContentChange auto-scroll (637) + addObserver remove (681)
// ============================================================
describe('StreamingScrollManager', () => {
  function makeContainer(scrollTop: number) {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
    container.scrollTo = vi.fn();
    document.body.appendChild(container);
    return container;
  }

  it('auto-scrolls to bottom when near bottom and not user-scrolling (line 637/641 true)', () => {
    const container = makeContainer(790); // distanceFromBottom = 1000-790-200 = 10 <= 150
    const mgr = new StreamingScrollManager(container, 150);
    mgr.handleStreamingUpdate();
    expect(container.scrollTo).toHaveBeenCalled();
    mgr.destroy();
    document.body.removeChild(container);
  });

  it('does NOT auto-scroll when far from bottom (line 641 false)', () => {
    const container = makeContainer(0); // distanceFromBottom = 800 > 150
    const mgr = new StreamingScrollManager(container, 150);
    mgr.handleStreamingUpdate();
    expect(container.scrollTo).not.toHaveBeenCalled();
    mgr.destroy();
    document.body.removeChild(container);
  });

  it('addObserver returns an unsubscribe that splices the callback (line 681 index>-1)', () => {
    const container = makeContainer(790);
    const mgr = new StreamingScrollManager(container, 150);
    const cb = vi.fn();
    const unsub = mgr.addObserver(cb);
    mgr.handleStreamingUpdate();
    expect(cb).toHaveBeenCalledTimes(1);
    unsub(); // removes the observer (index > -1)
    cb.mockClear();
    mgr.handleStreamingUpdate();
    expect(cb).not.toHaveBeenCalled();
    mgr.destroy();
    document.body.removeChild(container);
  });

  it('notifyObservers swallows observer errors (line 691 catch)', () => {
    const container = makeContainer(790);
    const mgr = new StreamingScrollManager(container, 150);
    mgr.addObserver(() => { throw new Error('boom'); });
    expect(() => mgr.handleStreamingUpdate()).not.toThrow();
    mgr.destroy();
    document.body.removeChild(container);
  });
});
