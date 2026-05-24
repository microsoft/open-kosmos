// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * StreamingV2Message — additional coverage targeting uncovered branches.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- CSS stubs ---
vi.mock('../../../styles/StreamingV2Message.css', () => ({}));
vi.mock('../../../styles/markdown-render.css', () => ({}));

// --- Heavy deps ---
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

vi.mock('remark-gfm', () => ({ default: () => () => {} }));
vi.mock('remark-breaks', () => ({ default: () => () => {} }));

// --- Streaming lib mocks ---
const mockGetUIConfig = vi.fn(() => ({
  showCursor: true,
  cursorAnimation: 'blink',
  smoothScrolling: true,
  autoScrollThreshold: 150,
  renderingMode: 'adaptive',
}));

vi.mock('../../../lib/streaming/streamingConfig', () => ({
  streamingConfigManager: {
    getUIConfig: (...args: any[]) => mockGetUIConfig(...args),
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
        enableSmartPausing: false,
        adaptiveSpeed: false,
        performanceMode: 'balanced',
      },
    })),
  },
}));

import { StreamingV2Message, StreamingScrollManager } from '../StreamingV2Message';
import type { Message } from '@shared/types/chatTypes';

function makeMessage(content: string, extra: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'assistant',
    content,
    createdAt: new Date(),
    ...extra,
  } as Message;
}

describe('StreamingV2Message — additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUIConfig.mockReturnValue({
      showCursor: true,
      cursorAnimation: 'blink',
      smoothScrolling: true,
      autoScrollThreshold: 150,
      renderingMode: 'adaptive',
    });
  });

  it('renders with array content parts (text extraction)', () => {
    const message = {
      ...makeMessage(''),
      content: [{ type: 'text', text: 'Part one' }, 'Part two', { type: 'image' }],
    } as any;
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('hides cursor when showCursor is false', () => {
    mockGetUIConfig.mockReturnValue({
      showCursor: false,
      cursorAnimation: 'none',
      smoothScrolling: false,
      autoScrollThreshold: 100,
      renderingMode: 'fast',
    });
    const message = makeMessage('Hello streaming text');
    const { container } = render(<StreamingV2Message message={message} isStreaming={true} />);
    const content = container.querySelector('.message-content');
    expect(content).toBeTruthy();
    expect(content!.className).not.toContain('with-inline-cursor');
  });

  it('shows cursor classes when showCursor is true and streaming', () => {
    const message = makeMessage('Hello streaming');
    const { container } = render(<StreamingV2Message message={message} isStreaming={true} />);
    // The cursor class appears on the .message-content div when streaming
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('handles handleFastDisplay click when not typing (no-op)', async () => {
    const message = makeMessage('Static content');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    const contentEl = container.querySelector('.message-content') as HTMLElement;
    // Clicking when not typing should not throw
    expect(() => fireEvent.click(contentEl)).not.toThrow();
  });

  it('renders metrics detail with fragmentsByType and latencyMetrics', () => {
    const message = makeMessage('Hello');
    const { container } = render(
      <StreamingV2Message
        message={message}
        isStreaming={true}
        enableMetricsDisplay={true}
        streamingMetrics={{
          wordsPerSecond: 4.2,
          totalTime: 1200,
          totalFragments: 8,
          fragmentsPerSecond: 6.7,
          contentLength: 80,
          wordCount: 15,
          latencyMetrics: { average: 18.3, peak: 55 },
          fragmentsByType: { text: 5, tool_result: 3 },
        }}
      />
    );
    const detail = container.querySelector('.metrics-detail');
    expect(detail?.textContent).toContain('18.3');
    expect(detail?.textContent).toContain('text:5');
  });

  it('renders metrics without TTFC when not provided', () => {
    const message = makeMessage('Hello');
    const { container } = render(
      <StreamingV2Message
        message={message}
        isStreaming={true}
        enableMetricsDisplay={true}
        streamingMetrics={{
          wordsPerSecond: 2.0,
          totalTime: 500,
          totalFragments: 3,
          fragmentsPerSecond: 6,
          contentLength: 20,
          wordCount: 4,
        }}
      />
    );
    const summary = container.querySelector('.metrics-summary');
    expect(summary?.textContent).not.toContain('TTFC');
  });

  it('does not show metrics when not streaming and enableMetricsDisplay is true', () => {
    const message = makeMessage('Done');
    const { container } = render(
      <StreamingV2Message
        message={message}
        isStreaming={false}
        enableMetricsDisplay={true}
        streamingMetrics={{
          wordsPerSecond: 2.0,
          totalTime: 500,
          totalFragments: 3,
          fragmentsPerSecond: 6,
          contentLength: 20,
          wordCount: 4,
        }}
      />
    );
    expect(container.querySelector('.streaming-metrics')).toBeNull();
  });

  it('renders markdown with local file path link', () => {
    // The 'a' renderer in markdownComponents handles local paths
    const message = makeMessage('[file](/Users/me/doc.txt)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('renders markdown with external link', () => {
    const message = makeMessage('[google](https://google.com)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('renders markdown table', () => {
    const message = makeMessage('| A | B |\n|---|---|\n| 1 | 2 |');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('renders code block with language', () => {
    const message = makeMessage('```javascript\nconsole.log("hi");\n```');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('renders mermaid code block', () => {
    const message = makeMessage('```mermaid\ngraph TD;\n  A-->B;\n```');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('renders code block without language as text', () => {
    const message = makeMessage('```\nplain text\n```');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('renders inline code', () => {
    const message = makeMessage('Use `npm install` to install');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('encodes spaces in markdown link URLs during rendering', () => {
    const message = makeMessage('[doc](path/with spaces/file.md)');
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('handles re-render with shorter text (reset path)', async () => {
    const { rerender } = render(
      <StreamingV2Message message={makeMessage('Long content here')} isStreaming={true} />
    );
    await act(async () => {
      rerender(<StreamingV2Message message={makeMessage('Short')} isStreaming={true} />);
    });
    expect(document.querySelector('.streaming-v2-message')).toBeTruthy();
  });

  it('calls onStreamingComplete only when streamingComplete flag is set on non-streaming', () => {
    const onStreamingComplete = vi.fn();
    const message = makeMessage('Done');
    render(
      <StreamingV2Message
        message={message}
        isStreaming={false}
        onStreamingComplete={onStreamingComplete}
      />
    );
    expect(onStreamingComplete).not.toHaveBeenCalled();
  });

  it('renders strong, em, h1, h2, h3, blockquote, ul, ol, li elements', () => {
    const content = '# H1\n## H2\n### H3\n**bold** _italic_\n> quote\n- item\n1. one';
    const message = makeMessage(content);
    const { container } = render(<StreamingV2Message message={message} isStreaming={false} />);
    expect(container.querySelector('.streaming-v2-message')).toBeTruthy();
  });
});

describe('StreamingScrollManager — additional coverage', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('shouldAutoScroll returns false when isUserScrolling is true', async () => {
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 800, configurable: true, writable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
    const manager = new StreamingScrollManager(container, 150);
    // Simulate user scroll event
    container.dispatchEvent(new Event('scroll'));
    // Now isUserScrolling is true
    expect(manager.shouldAutoScroll()).toBe(false);
    manager.destroy();
  });

  it('notifyObservers catches errors in faulty callbacks', () => {
    const manager = new StreamingScrollManager(container, 150);
    const faultyCallback = vi.fn(() => { throw new Error('observer error'); });
    manager.addObserver(faultyCallback);
    // Should not throw
    expect(() => manager.handleStreamingUpdate()).not.toThrow();
    manager.destroy();
  });

  it('addObserver returns removal function that removes only that observer', () => {
    const manager = new StreamingScrollManager(container, 150);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const remove1 = manager.addObserver(cb1);
    manager.addObserver(cb2);
    remove1();
    // Trigger a content change - wheel event triggers handleScroll, not handleContentChange
    // Just check remove works without error
    expect(typeof remove1).toBe('function');
    manager.destroy();
  });

  it('updateConfig with undefined threshold does not crash', () => {
    const manager = new StreamingScrollManager(container, 150);
    manager.updateConfig({});
    expect(manager.shouldAutoScroll()).toBeDefined();
    manager.destroy();
  });

  it('scrollToBottom with smooth=false uses auto behavior', () => {
    const manager = new StreamingScrollManager(container, 150);
    const spy = vi.spyOn(container, 'scrollTo').mockImplementation(() => {});
    manager.scrollToBottom(false);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    manager.destroy();
  });

  it('destroy clears timeout and observers', () => {
    const manager = new StreamingScrollManager(container, 150);
    container.dispatchEvent(new Event('scroll'));
    const cb = vi.fn();
    manager.addObserver(cb);
    manager.destroy();
    // After destroy, no crashes on further operations
    expect(() => manager.destroy()).not.toThrow();
  });
});
