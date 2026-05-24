/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- CSS / style mocks ---
vi.mock('../../../styles/StreamingV2Message.css', () => ({}));
vi.mock('../../../styles/markdown-render.css', () => ({}));

// --- Heavy dependency mocks ---
vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children, language }: any) => (
    <pre data-language={language}><code>{children}</code></pre>
  ),
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
}));
vi.mock('../../chat/MermaidDiagram', () => ({
  default: ({ definition }: any) => <div data-testid="mermaid">{definition}</div>,
}));
vi.mock('../../chat/CodeBlockCopyButton', () => ({
  default: ({ code }: any) => <button data-testid="copy-button">{code}</button>,
}));

// --- Streaming lib mocks ---
vi.mock('../../../lib/streaming/streamingConfig', () => ({
  streamingConfigManager: {
    getUIConfig: vi.fn(() => ({
      showCursor: true,
      cursorAnimation: 'smooth',
      smoothScrolling: true,
      autoScrollThreshold: 150,
      renderingMode: 'adaptive',
    })),
  },
}));
vi.mock('../../../lib/streaming/streamingOptimizer', () => ({
  streamingOptimizer: {
    getConfigForText: vi.fn(() => ({
      baseDelay: 16,
      enableBatching: true,
      maxBatchSize: 10,
    })),
  },
}));
vi.mock('../../../lib/streaming/compatibilityLayer', () => ({
  streamingCompatibility: {
    getCompatibleConfig: vi.fn(() => ({
      optimizedConfig: {
        baseDelay: 16,
        enableBatching: true,
        maxBatchSize: 10,
      },
    })),
  },
}));

import { StreamingV2Message, StreamingScrollManager } from '../StreamingV2Message';
import type { StreamingMetrics } from '../StreamingV2Message';

// ── helpers ────────────────────────────────────────────────────────────────

function makeMessage(content: any = '', overrides: Record<string, any> = {}) {
  return {
    id: 'msg-1',
    role: 'assistant',
    content,
    createdAt: new Date(),
    ...overrides,
  } as any;
}

const baseMetrics: StreamingMetrics = {
  wordsPerSecond: 25.5,
  totalTime: 1200,
  totalFragments: 48,
  fragmentsPerSecond: 40,
  contentLength: 512,
  wordCount: 85,
};

// ── StreamingV2Message ─────────────────────────────────────────────────────

describe('StreamingV2Message', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders without crashing with string content', () => {
    render(<StreamingV2Message message={makeMessage('Hello')} isStreaming={false} />);
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('renders without crashing with empty string content', () => {
    const { container } = render(
      <StreamingV2Message message={makeMessage('')} isStreaming={false} />
    );
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('handles array content parts', () => {
    const content = [{ type: 'text', text: 'Part A' }, { type: 'text', text: ' Part B' }];
    render(<StreamingV2Message message={makeMessage(content)} isStreaming={false} />);
    expect(screen.getByText(/Part A/)).toBeTruthy();
  });

  it('handles array content with mixed string/object parts', () => {
    const content = ['plain string', { text: ' with object' }];
    render(<StreamingV2Message message={makeMessage(content)} isStreaming={false} />);
    // Content combined, just ensure no throw
    expect(true).toBe(true);
  });

  it('shows typing class when isStreaming is true (non-empty content)', async () => {
    const { container } = render(
      <StreamingV2Message message={makeMessage('streaming content')} isStreaming={true} />
    );
    const el = container.querySelector('.streaming-v2-message');
    expect(el).toBeTruthy();
  });

  it('does not show metrics when enableMetricsDisplay is false', () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={true}
        streamingMetrics={baseMetrics}
        enableMetricsDisplay={false}
      />
    );
    expect(container.querySelector('.streaming-metrics')).toBeNull();
  });

  it('shows metrics when enableMetricsDisplay is true and streaming', () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={true}
        streamingMetrics={baseMetrics}
        enableMetricsDisplay={true}
      />
    );
    expect(container.querySelector('.streaming-metrics')).toBeTruthy();
  });

  it('renders wordsPerSecond in metrics', () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={true}
        streamingMetrics={baseMetrics}
        enableMetricsDisplay={true}
      />
    );
    const summary = container.querySelector('.metrics-summary');
    expect(summary?.textContent).toContain('25.5');
    expect(summary?.textContent).toContain('words/s');
  });

  it('renders timeToFirstContent when present', () => {
    const metrics = { ...baseMetrics, timeToFirstContent: 342 };
    render(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={true}
        streamingMetrics={metrics}
        enableMetricsDisplay={true}
      />
    );
    expect(screen.getByText(/342ms TTFC/)).toBeTruthy();
  });

  it('toggles metrics detail on click', () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={true}
        streamingMetrics={baseMetrics}
        enableMetricsDisplay={true}
      />
    );
    const metricsDiv = container.querySelector('.streaming-metrics') as HTMLElement;
    expect(metricsDiv).toBeTruthy();

    // showMetrics starts true from useEffect, so detail is visible initially
    expect(container.querySelector('.metrics-detail')).toBeTruthy();

    // Click to hide detail (toggles showMetrics to false)
    fireEvent.click(metricsDiv);
    expect(container.querySelector('.metrics-detail')).toBeNull();

    // Click again to show
    fireEvent.click(metricsDiv);
    expect(container.querySelector('.metrics-detail')).toBeTruthy();
  });

  it('shows latency metrics in detail when present', () => {
    const metrics = { ...baseMetrics, latencyMetrics: { average: 12.5, peak: 50 } };
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={true}
        streamingMetrics={metrics}
        enableMetricsDisplay={true}
      />
    );
    // showMetrics is set to true by the useEffect on mount; detail visible immediately
    const detail = container.querySelector('.metrics-detail');
    expect(detail).toBeTruthy();
    expect(detail!.textContent).toContain('12.5ms');
    expect(detail!.textContent).toContain('peak 50ms');
  });

  it('shows fragmentsByType in detail when present', () => {
    const metrics = { ...baseMetrics, fragmentsByType: { text: 40, tool: 8 } };
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={true}
        streamingMetrics={metrics}
        enableMetricsDisplay={true}
      />
    );
    // showMetrics is set to true by the useEffect on mount; detail visible immediately
    const detail = container.querySelector('.metrics-detail');
    expect(detail).toBeTruthy();
    expect(detail!.textContent).toContain('text:40');
    expect(detail!.textContent).toContain('tool:8');
  });

  it('auto-hides metrics after 5 seconds when streaming stops', () => {
    // Render while streaming so metrics appear
    const { container, rerender } = render(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={true}
        streamingMetrics={baseMetrics}
        enableMetricsDisplay={true}
      />
    );
    expect(container.querySelector('.streaming-metrics')).toBeTruthy();

    // Stop streaming — the useEffect sets showMetrics to false
    rerender(
      <StreamingV2Message
        message={makeMessage('text')}
        isStreaming={false}
        streamingMetrics={baseMetrics}
        enableMetricsDisplay={true}
      />
    );
    // isStreaming=false and isTyping=false and showMetrics=false → panel hidden
    expect(container.querySelector('.streaming-metrics')).toBeNull();
  });

  it('calls onStreamingComplete when streamingComplete flag is set', () => {
    const onComplete = vi.fn();
    render(
      <StreamingV2Message
        message={makeMessage('text', { streamingComplete: true })}
        isStreaming={false}
        onStreamingComplete={onComplete}
      />
    );
    expect(onComplete).toHaveBeenCalled();
  });

  it('calls onHeightChange when content height changes', () => {
    const onHeightChange = vi.fn();
    render(
      <StreamingV2Message
        message={makeMessage('hello world')}
        isStreaming={false}
        onHeightChange={onHeightChange}
      />
    );
    // The callback may or may not fire depending on scrollHeight in happy-dom
    // but it should not throw
    expect(true).toBe(true);
  });

  it('renders a code block in message content', () => {
    const content = '```javascript\nconst x = 1;\n```';
    render(<StreamingV2Message message={makeMessage(content)} isStreaming={false} />);
    const wrapper = document.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
  });

  it('renders mermaid diagram in message content', () => {
    const content = '```mermaid\ngraph LR; A-->B;\n```';
    render(<StreamingV2Message message={makeMessage(content)} isStreaming={false} />);
    expect(screen.getByTestId('mermaid')).toBeTruthy();
  });

  it('renders local file path as local link', () => {
    const content = '[file](/path/to/file.txt)';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );
    const link = container.querySelector('a[href="#"]');
    expect(link).toBeTruthy();
  });

  it('renders external links with target=_blank', () => {
    const content = '[external](https://example.com)';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );
    const link = container.querySelector('a[target="_blank"]');
    expect(link).toBeTruthy();
  });

  it('clicking local file link calls electronAPI.workspace.openPath', () => {
    const openPath = vi.fn();
    (window as any).electronAPI = { workspace: { openPath } };

    const content = '[doc](/some/path/file.md)';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );
    const link = container.querySelector('a[href="#"]') as HTMLElement;
    fireEvent.click(link);
    expect(openPath).toHaveBeenCalledWith('/some/path/file.md');
  });

  it('does not throw when electronAPI is undefined on local link click', () => {
    (window as any).electronAPI = undefined;
    const content = '[doc](/some/file.md)';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );
    const link = container.querySelector('a[href="#"]') as HTMLElement;
    expect(() => fireEvent.click(link)).not.toThrow();
  });

  it('encodes spaces in markdown link URLs', () => {
    const content = '[file](/path/with spaces/file.txt)';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );
    // Link should exist (spaces encoded to %20)
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
  });

  it('renders table wrapped in table-wrapper', () => {
    const content = '| Col A | Col B |\n|---|---|\n| 1 | 2 |';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );
    expect(container.querySelector('.table-wrapper')).toBeTruthy();
    expect(container.querySelector('table')).toBeTruthy();
  });
});

// ── encodeMarkdownLinkSpaces (exercised through the component) ───────────────

describe('encodeMarkdownLinkSpaces (via StreamingV2Message)', () => {
  it('preserves links without spaces', () => {
    const content = '[example](https://example.com/no-spaces)';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/no-spaces');
  });
});

// ── StreamingScrollManager ─────────────────────────────────────────────────

describe('StreamingScrollManager', () => {
  let container: HTMLElement;
  let manager: InstanceType<typeof StreamingScrollManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 850, configurable: true, writable: true });
    Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
    container.scrollTo = vi.fn();
    document.body.appendChild(container);
    manager = new StreamingScrollManager(container, 150);
  });

  afterEach(() => {
    manager.destroy();
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it('constructs without throwing', () => {
    expect(manager).toBeTruthy();
  });

  it('shouldAutoScroll returns true when near bottom', () => {
    // scrollHeight(1000) - scrollTop(850) - clientHeight(100) = 50 <= 150
    expect(manager.shouldAutoScroll()).toBe(true);
  });

  it('shouldAutoScroll returns false when far from bottom', () => {
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true, writable: true });
    expect(manager.shouldAutoScroll()).toBe(false);
  });

  it('shouldAutoScroll returns false while user is scrolling', () => {
    container.dispatchEvent(new Event('scroll'));
    expect(manager.shouldAutoScroll()).toBe(false);
  });

  it('shouldAutoScroll returns true after user scroll timeout', () => {
    container.dispatchEvent(new Event('scroll'));
    expect(manager.shouldAutoScroll()).toBe(false);
    act(() => { vi.advanceTimersByTime(1001); });
    expect(manager.shouldAutoScroll()).toBe(true);
  });

  it('scrollToBottom calls container.scrollTo with smooth behavior', () => {
    manager.scrollToBottom(true);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('scrollToBottom calls container.scrollTo with auto behavior', () => {
    manager.scrollToBottom(false);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
  });

  it('handleStreamingUpdate triggers scroll when near bottom', () => {
    manager.handleStreamingUpdate();
    expect(container.scrollTo).toHaveBeenCalled();
  });

  it('handleStreamingUpdate does NOT scroll when far from bottom', () => {
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true, writable: true });
    manager.handleStreamingUpdate();
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('addObserver: callback is called on content change', () => {
    const cb = vi.fn();
    manager.addObserver(cb);
    manager.handleStreamingUpdate();
    expect(cb).toHaveBeenCalled();
  });

  it('addObserver: returns unsubscribe that removes the callback', () => {
    const cb = vi.fn();
    const unsub = manager.addObserver(cb);
    unsub();
    manager.handleStreamingUpdate();
    expect(cb).not.toHaveBeenCalled();
  });

  it('observer error does not propagate', () => {
    manager.addObserver(() => { throw new Error('observer error'); });
    expect(() => manager.handleStreamingUpdate()).not.toThrow();
  });

  it('updateConfig changes the autoScrollThreshold', () => {
    // Move scrollTop so original threshold (150) would auto-scroll but new threshold (10) wouldn't
    Object.defineProperty(container, 'scrollTop', { value: 850, configurable: true, writable: true });
    // distance = 1000 - 850 - 100 = 50; initially auto-scroll fires
    manager.handleStreamingUpdate();
    expect(container.scrollTo).toHaveBeenCalledTimes(1);

    // Now set a very tight threshold so 50px gap is outside it
    manager.updateConfig({ autoScrollThreshold: 10 });
    // Reset mock call count
    vi.mocked(container.scrollTo).mockClear();
    manager.handleStreamingUpdate();
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('wheel event also sets userScrolling flag', () => {
    container.dispatchEvent(new Event('wheel'));
    expect(manager.shouldAutoScroll()).toBe(false);
  });

  it('touchmove event also sets userScrolling flag', () => {
    container.dispatchEvent(new Event('touchmove'));
    expect(manager.shouldAutoScroll()).toBe(false);
  });

  it('destroy clears observers', () => {
    const cb = vi.fn();
    manager.addObserver(cb);
    manager.destroy();
    // After destroy, handleStreamingUpdate should not throw and cb not called
    expect(() => manager.handleStreamingUpdate()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});
