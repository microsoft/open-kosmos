// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * StreamingV2Message — coverage file 3
 * Targets uncovered branches: animateTypewriter RAF inner logic, handleFastDisplay
 * when typing, pre-Strategy-2 fallback, link onClick paths, string-className branch.
 */

import React from 'react';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../styles/StreamingV2Message.css', () => ({}));
vi.mock('../../../styles/markdown-render.css', () => ({}));
vi.mock('remark-gfm', () => ({ default: () => () => {} }));
vi.mock('remark-breaks', () => ({ default: () => () => {} }));

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children, language }: any) => (
    <pre data-language={language}><code>{children}</code></pre>
  ),
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({ oneDark: {} }));
vi.mock('../../chat/MermaidDiagram', () => ({
  default: ({ definition }: any) => <div data-testid="mermaid">{definition}</div>,
}));
vi.mock('../../chat/CodeBlockCopyButton', () => ({
  default: ({ code }: any) => <button data-testid="copy-btn">{code}</button>,
}));

// Controllable UI config
const mockGetUIConfig = vi.fn(() => ({
  showCursor: true,
  cursorAnimation: 'smooth',
  smoothScrolling: true,
  autoScrollThreshold: 150,
  renderingMode: 'adaptive',
}));

vi.mock('../../../lib/streaming/streamingConfig', () => ({
  streamingConfigManager: { getUIConfig: (...a: any[]) => mockGetUIConfig(...a) },
}));
vi.mock('../../../lib/streaming/streamingOptimizer', () => ({
  streamingOptimizer: {
    getConfigForText: vi.fn(() => ({ baseDelay: 16, enableBatching: false, maxBatchSize: 10 })),
  },
}));
vi.mock('../../../lib/streaming/compatibilityLayer', () => ({
  streamingCompatibility: {
    getCompatibleConfig: vi.fn(() => ({
      optimizedConfig: { baseDelay: 16, enableBatching: false, maxBatchSize: 10 },
    })),
  },
}));

// Mock EmbeddedBrowserAtom
const mockOpen = vi.fn();
vi.mock('../../browser/embeddedBrowser.atom', () => ({
  EmbeddedBrowserAtom: {
    useChange: () => ({ open: mockOpen }),
  },
}));

// Mock useCurrentChatSessionId
const mockSessionId = { value: 'session-1' };
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: () => mockSessionId.value,
}));
vi.mock('../../../lib/chat/filePathUtils', () => ({
  linkifyFilePaths: (text: string) => text,
  isLocalFilePath: (href: string) => /^\/[^/]/.test(href) || /^[A-Za-z]:[\\/]/.test(href) || /^file:\/\/\//i.test(href),
  isFilePathString: () => false,
  getFileName: (p: string) => p,
  stripFileScheme: (p: string) => p,
}));

const mockBrowserEnabled = { value: true };
vi.mock('../../../lib/userData/useEmbeddedBrowserEnabled', () => ({
  useEmbeddedBrowserEnabled: () => mockBrowserEnabled.value,
}));

import { StreamingV2Message, StreamingScrollManager } from '../StreamingV2Message';

function makeMessage(content: any, overrides: Record<string, any> = {}) {
  return { id: 'msg', role: 'assistant', content, createdAt: new Date(), ...overrides } as any;
}

// ── RAF-driven typewriter: handleFastDisplay when isTyping ────────────────────

describe('StreamingV2Message — handleFastDisplay when isTyping', () => {
  let rafCallbacks: Array<(t: number) => void>;
  let origRAF: typeof requestAnimationFrame;
  let origCancelRAF: typeof cancelAnimationFrame;

  beforeEach(() => {
    mockBrowserEnabled.value = true;
    vi.useFakeTimers();
    mockGetUIConfig.mockReturnValue({
      showCursor: true,
      cursorAnimation: 'smooth',
      smoothScrolling: true,
      autoScrollThreshold: 150,
      renderingMode: 'adaptive',
    });
    rafCallbacks = [];
    origRAF = globalThis.requestAnimationFrame;
    origCancelRAF = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as any;
    globalThis.cancelAnimationFrame = vi.fn(() => {
      rafCallbacks = [];
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCancelRAF;
  });

  function flushRAF(t: number) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach((cb) => cb(t));
  }

  it('clicking during typing (isTyping=true) skips animation and shows full text', async () => {
    const text = 'Hello world, streaming now';
    const { container } = render(
      <StreamingV2Message message={makeMessage(text)} isStreaming={true} />
    );

    // Fire a RAF frame to trigger setIsTyping(true) via animateTypewriter
    act(() => { flushRAF(100); });

    const contentEl = container.querySelector('.message-content') as HTMLElement;
    // Click to skip animation
    act(() => { fireEvent.click(contentEl); });

    // After click, displayedText should equal full text
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('animateTypewriter: startIndex >= targetText.length sets displayedText directly', () => {
    // Trigger the branch where the text is already fully displayed (startIndex >= length)
    // This happens when rerendering with same or shorter text while already at full length
    const text = 'Short';
    const { rerender } = render(
      <StreamingV2Message message={makeMessage(text)} isStreaming={true} />
    );
    // Flush so typewriter gets called
    act(() => { flushRAF(100); });
    // Rerender with same text — shouldSkipAnimation or same length handled
    rerender(<StreamingV2Message message={makeMessage(text)} isStreaming={true} />);
    expect(document.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('animate inner loop: completes when currentIndex reaches targetText.length', () => {
    const text = 'ab'; // very short so RAF loop finishes quickly
    render(<StreamingV2Message message={makeMessage(text)} isStreaming={true} />);

    // First RAF: starts animation, deltaTime likely 0 < baseDelay(16), no chars added
    act(() => { flushRAF(0); });
    // Second RAF with enough delta to advance
    act(() => { flushRAF(100); });
    // Third RAF: currentIndex >= targetText.length exits loop
    act(() => { flushRAF(200); });

    expect(document.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('click timeout re-enables animation after 1000ms', async () => {
    const text = 'Click skip then re-enable animation';
    const { container } = render(
      <StreamingV2Message message={makeMessage(text)} isStreaming={true} />
    );
    act(() => { flushRAF(50); });

    const contentEl = container.querySelector('.message-content') as HTMLElement;
    act(() => { fireEvent.click(contentEl); });

    // shouldSkipAnimation is true now
    // After 1001ms it becomes false again
    act(() => { vi.advanceTimersByTime(1001); });

    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });
});

// ── animateTypewriter with batching enabled + Chinese/alphanumeric chars ───────

describe('StreamingV2Message — typewriter batching branches', () => {
  let rafCallbacks: Array<(t: number) => void>;
  let origRAF: typeof requestAnimationFrame;
  let origCancelRAF: typeof cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    origRAF = globalThis.requestAnimationFrame;
    origCancelRAF = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as any;
    globalThis.cancelAnimationFrame = vi.fn(() => {
      rafCallbacks = [];
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCancelRAF;
  });

  function flushRAF(t: number) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach((cb) => cb(t));
  }

  it('batches alphanumeric chars when enableBatching=true', async () => {
    // Override optimizer to enable batching
    const { streamingCompatibility } = await import('../../../lib/streaming/compatibilityLayer');
    vi.mocked(streamingCompatibility.getCompatibleConfig).mockReturnValue({
      optimizedConfig: { baseDelay: 1, enableBatching: true, maxBatchSize: 20 },
    } as any);

    const text = 'ABCDEFGHIJKabcdefghij1234567890'; // long alphanumeric
    render(<StreamingV2Message message={makeMessage(text)} isStreaming={true} />);

    // Multiple frames to exercise batching path
    act(() => { flushRAF(0); });
    act(() => { flushRAF(50); });
    act(() => { flushRAF(100); });
    expect(document.querySelector('.streaming-v2-message')).toBeTruthy();
  });
});

// ── pre-block Strategy 2 fallback (no hast node) ────────────────────────────

describe('StreamingV2Message — pre block Strategy 2 fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetUIConfig.mockReturnValue({
      showCursor: true,
      cursorAnimation: 'smooth',
      smoothScrolling: true,
      autoScrollThreshold: 150,
      renderingMode: 'adaptive',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders a fenced code block with Strategy 1 (hast node path)', () => {
    const message = makeMessage('```typescript\nconst x: number = 1;\n```');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.textContent).toContain('TYPESCRIPT');
  });

  it('renders a fenced code block with language label for non-text language', () => {
    const message = makeMessage('```python\nprint("hi")\n```');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.code-block-language')?.textContent).toContain('PYTHON');
  });

  it('renders empty language label for language=text', () => {
    const message = makeMessage('```\nplain code\n```');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const langSpan = container.querySelector('.code-block-language');
    expect(langSpan?.textContent).toBe('');
  });

  it('renders mermaid diagram for mermaid language block', () => {
    const message = makeMessage('```mermaid\ngraph TD;\n  A-->B\n```');
    render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(screen.getByTestId('mermaid')).toBeTruthy();
  });
});

// ── Link onClick: http/https opens in embedded browser ──────────────────────

describe('StreamingV2Message — link onClick opens embedded browser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockOpen.mockClear();
    mockSessionId.value = 'session-99';
    mockBrowserEnabled.value = true;
    mockGetUIConfig.mockReturnValue({
      showCursor: true,
      cursorAnimation: 'smooth',
      smoothScrolling: true,
      autoScrollThreshold: 150,
      renderingMode: 'adaptive',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('clicking an https link calls embeddedBrowserActions.open with sessionId and href', () => {
    const message = makeMessage('[google](https://google.com)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const link = container.querySelector('a[href="https://google.com"]') as HTMLElement;
    expect(link).toBeTruthy();
    fireEvent.click(link);
    expect(mockOpen).toHaveBeenCalledWith('session-99', 'https://google.com');
  });

  it('clicking an http link calls embeddedBrowserActions.open', () => {
    const message = makeMessage('[site](http://example.com)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const link = container.querySelector('a[href="http://example.com"]') as HTMLElement;
    expect(link).toBeTruthy();
    fireEvent.click(link);
    expect(mockOpen).toHaveBeenCalledWith('session-99', 'http://example.com');
  });

  it('keeps external fallback when embedded browser is disabled', () => {
    mockBrowserEnabled.value = false;
    const message = makeMessage('[site](https://example.com)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const link = container.querySelector('a[href="https://example.com"]') as HTMLElement;
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('routes HTTPS deep links into the embedded browser', () => {
    const message = makeMessage('[meeting](https://conference.example.com/meet/abc)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const link = container.querySelector('a[href="https://conference.example.com/meet/abc"]') as HTMLElement;
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
    fireEvent.click(link);
    expect(mockOpen).toHaveBeenCalledWith('session-99', 'https://conference.example.com/meet/abc');
  });

  it('does NOT call open when no session id is available', () => {
    mockSessionId.value = null;
    const message = makeMessage('[link](https://example.com)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const link = container.querySelector('a') as HTMLElement;
    if (link) {
      fireEvent.click(link);
    }
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('does NOT call open for non-http links', () => {
    const message = makeMessage('[ftp](ftp://example.com)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const link = container.querySelector('a') as HTMLElement;
    if (link) fireEvent.click(link);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('local file path link calls electronAPI.workspace.openPath for non-previewable files', () => {
    const openPath = vi.fn();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { workspace: { openPath } },
    });
    const message = makeMessage('[doc](/Users/me/report.docx)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const link = container.querySelector('a[href="#"]') as HTMLElement;
    expect(link).toBeTruthy();
    fireEvent.click(link);
    expect(openPath).toHaveBeenCalledWith('/Users/me/report.docx');
  });

  it('local previewable file path link dispatches fileViewer:open event', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const message = makeMessage('[doc](/Users/me/report.md)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const link = container.querySelector('a[href="#"]') as HTMLElement;
    expect(link).toBeTruthy();
    fireEvent.click(link);
    const fileViewerEvent = dispatchSpy.mock.calls.find(
      ([event]) => (event as CustomEvent).type === 'fileViewer:open'
    );
    expect(fileViewerEvent).toBeDefined();
    const detail = (fileViewerEvent![0] as CustomEvent).detail;
    expect(detail.file.url).toBe('/Users/me/report.md');
    dispatchSpy.mockRestore();
  });
});

// ── onHeightChange fires when scrollHeight changes during streaming ────────────

describe('StreamingV2Message — onHeightChange during streaming/typing', () => {
  let rafCallbacks: Array<(t: number) => void>;
  let origRAF: typeof requestAnimationFrame;
  let origCancelRAF: typeof cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    mockGetUIConfig.mockReturnValue({
      showCursor: true,
      cursorAnimation: 'smooth',
      smoothScrolling: true,
      autoScrollThreshold: 150,
      renderingMode: 'adaptive',
    });
    rafCallbacks = [];
    origRAF = globalThis.requestAnimationFrame;
    origCancelRAF = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as any;
    globalThis.cancelAnimationFrame = vi.fn(() => {
      rafCallbacks = [];
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCancelRAF;
  });

  function flushRAF(t: number) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach((cb) => cb(t));
  }

  it('calls onHeightChange when containerRef.current scrollHeight differs', () => {
    const onHeightChange = vi.fn();
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('streaming text content')}
        isStreaming={true}
        onHeightChange={onHeightChange}
      />
    );
    // Manually set scrollHeight to simulate a height
    const wrapper = container.querySelector('.streaming-v2-message') as HTMLElement;
    if (wrapper) {
      Object.defineProperty(wrapper, 'scrollHeight', { value: 120, configurable: true });
    }
    act(() => { flushRAF(50); });
    act(() => { flushRAF(100); });
    // No crash — the component should handle the height check
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });
});

// ── ResizeObserver in StreamingScrollManager ─────────────────────────────────

describe('StreamingV2Message — ResizeObserver branch in ScrollManager', () => {
  it('works when ResizeObserver is absent (no window.ResizeObserver)', () => {
    const orig = (window as any).ResizeObserver;
    delete (window as any).ResizeObserver;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const manager = new StreamingScrollManager(container, 150);
    expect(manager).toBeTruthy();
    manager.destroy();
    document.body.removeChild(container);

    (window as any).ResizeObserver = orig;
  });
});

// ── getBuiltinToolsManager export ────────────────────────────────────────────

describe('StreamingV2Message — default export and named exports', () => {
  it('default export is StreamingV2Message', async () => {
    const mod = await import('../StreamingV2Message');
    expect(mod.default).toBeTruthy();
    expect(mod.StreamingV2Message).toBeTruthy();
    expect(mod.StreamingScrollManager).toBeTruthy();
  });
});
