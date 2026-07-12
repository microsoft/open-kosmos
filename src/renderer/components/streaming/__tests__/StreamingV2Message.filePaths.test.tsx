/**
 * @vitest-environment happy-dom
 *
 * Component-level tests for file path linkification in StreamingV2Message.
 * Uses the REAL linkifyFilePaths (not mocked) to verify end-to-end rendering.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
    getUIConfig: () => ({
      showCursor: true,
      cursorAnimation: 'blink',
    }),
  },
}));
vi.mock('../../../lib/streaming/streamingOptimizer', () => ({
  streamingOptimizer: {
    getConfigForText: () => ({
      baseDelay: 10,
      enableBatching: false,
      maxBatchSize: 3,
    }),
  },
}));
vi.mock('../../../lib/streaming/compatibilityLayer', () => ({
  streamingCompatibility: {
    getCompatibleConfig: () => ({
      optimizedConfig: {
        baseDelay: 10,
        enableBatching: false,
        maxBatchSize: 3,
      },
    }),
  },
}));

// --- Embedded browser mock ---
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: () => 'session-test',
}));
vi.mock('../../../lib/userData/useEmbeddedBrowserEnabled', () => ({
  useEmbeddedBrowserEnabled: () => true,
}));
vi.mock('../../browser/embeddedBrowser.atom', () => ({
  EmbeddedBrowserAtom: { useChange: () => ({ open: vi.fn() }) },
}));

// NOTE: filePathUtils is NOT mocked — uses the real implementation

import { StreamingV2Message } from '../StreamingV2Message';

function makeMessage(text: string, role: string = 'assistant') {
  return {
    id: 'msg-test',
    role,
    content: [{ type: 'text' as const, text }],
    createdAt: new Date(),
  } as any;
}

describe('StreamingV2Message file path linkification', () => {
  const mockOpenPath = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    (window as any).electronAPI = {
      workspace: { openPath: mockOpenPath },
    };
    mockOpenPath.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('linkifies a bare Unix path in assistant messages', async () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('File saved to /Users/alice/projects/report.md done.')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('report.md');
  });

  it('does not linkify paths in user messages', async () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('Check /Users/alice/projects/report.md please.', 'user')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    const links = container.querySelectorAll('a[href="#"]');
    expect(links.length).toBe(0);
  });

  it('does not linkify backtick-wrapped paths in user messages', async () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('Open `C:\\Users\\me\\file.txt` for me', 'user')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    const links = container.querySelectorAll('a[href="#"]');
    expect(links.length).toBe(0);
    // The inline-code element should still render the path literally
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('C:\\Users\\me\\file.txt');
  });

  it('does not linkify a leaked-link pattern typed by the user inside backticks', async () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('Use `[file.txt](C:\\Users\\me\\file.txt)` as a literal', 'user')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    const links = container.querySelectorAll('a[href="#"]');
    expect(links.length).toBe(0);
  });

  it('renders inline code file path as clickable link', async () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('See `C:\\Users\\test\\file.txt` for details.')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('file.txt');
  });

  it('calls openPath when clicking a non-previewable file path link', async () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('See `C:\\Users\\test\\file.docx` here.')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    fireEvent.click(link!);
    expect(mockOpenPath).toHaveBeenCalledWith('C:\\Users\\test\\file.docx');
  });

  it('dispatches fileViewer:open when clicking a previewable file path link', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('See `C:\\Users\\test\\file.txt` here.')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    fireEvent.click(link!);
    const fileViewerEvent = dispatchSpy.mock.calls.find(
      ([event]) => (event as CustomEvent).type === 'fileViewer:open'
    );
    expect(fileViewerEvent).toBeDefined();
    dispatchSpy.mockRestore();
  });

  it('renders Windows bare path as clickable link with filename', async () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('File: C:/Users/test/report.md done.')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('report.md');
  });

  it('does not crash on malformed percent encoding', async () => {
    const { container } = render(
      <StreamingV2Message
        message={makeMessage('See `C:\\Users\\test\\file%2.txt` here.')}
        isStreaming={false}
      />
    );
    await vi.advanceTimersByTimeAsync(500);

    // Should render without crashing — the malformed %2 is not a valid path
    expect(container).toBeDefined();
  });
});
