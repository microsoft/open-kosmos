// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * StreamingV2Message — code block rendering tests.
 * Tests the fix for nested markdown fence rendering and plain-text fallback.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- CSS stubs ---
vi.mock('../../../styles/StreamingV2Message.css', () => ({}));
vi.mock('../../../styles/markdown-render.css', () => ({}));

// --- Track SyntaxHighlighter calls ---
const syntaxHighlighterSpy = vi.fn(({ children, language }: any) => (
  <pre data-testid="syntax-highlighter" data-language={language}><code>{children}</code></pre>
));

vi.mock('react-syntax-highlighter', () => ({
  Prism: (props: any) => syntaxHighlighterSpy(props),
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
}));
vi.mock('../../chat/MermaidDiagram', () => ({
  default: ({ definition }: any) => <div data-testid="mermaid">{definition}</div>,
}));
vi.mock('../../chat/CodeBlockCopyButton', () => ({
  default: ({ code }: any) => <button data-testid="copy-button">{code.substring(0, 20)}</button>,
}));

vi.mock('remark-gfm', () => ({ default: () => () => {} }));
vi.mock('remark-breaks', () => ({ default: () => () => {} }));

// --- Streaming lib mocks ---
vi.mock('../../../lib/streaming/streamingConfig', () => ({
  streamingConfigManager: {
    getUIConfig: () => ({
      showCursor: true,
      cursorAnimation: 'blink',
      smoothScrolling: true,
      autoScrollThreshold: 150,
      renderingMode: 'adaptive',
    }),
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

import { StreamingV2Message } from '../StreamingV2Message';
import type { Message } from '@shared/types/chatTypes';

function makeMessage(content: string): Message {
  return {
    id: 'msg-test',
    role: 'assistant',
    content,
    createdAt: new Date(),
  } as Message;
}

describe('StreamingV2Message — code block rendering', () => {
  beforeEach(() => {
    syntaxHighlighterSpy.mockClear();
  });

  it('renders ````markdown fence as plain text without SyntaxHighlighter', () => {
    const content = '````markdown\n# Hello\n\n| A | B |\n|---|---|\n| 1 | 2 |\n````';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
    expect(wrapper!.textContent).toContain('# Hello');
    expect(wrapper!.textContent).toContain('| A | B |');
  });

  it('renders ```python fence with SyntaxHighlighter', () => {
    const content = '```python\nprint("hello")\n```';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'python' })
    );
  });

  it('renders ```powershell fence with SyntaxHighlighter', () => {
    const content = '```powershell\nGet-Process | Sort-Object CPU\n```';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    expect(syntaxHighlighterSpy).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'powershell' })
    );
  });

  it('renders ````markdown with nested fences as single plain-text code block', () => {
    const content = '````markdown\n## Build\n\n```powershell\ngit clone https://example.com\n```\n\n| A | B |\n|---|---|\n| x | y |\n````';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    // Only ONE code-block-wrapper for the entire ````markdown block
    const wrappers = container.querySelectorAll('.code-block-wrapper');
    expect(wrappers.length).toBe(1);

    // SyntaxHighlighter should NOT be called (markdown uses plain text)
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();

    // Content includes nested fence literally
    expect(wrappers[0]!.textContent).toContain('```powershell');
    expect(wrappers[0]!.textContent).toContain('git clone');
    expect(wrappers[0]!.textContent).toContain('| A | B |');
  });

  it('renders ```text fence as plain text', () => {
    const content = '```text\nsome plain text\n```';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
    expect(wrapper!.textContent).toContain('some plain text');
  });

  it('renders ```md fence as plain text', () => {
    const content = '```md\n# Heading\n```';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
  });

  it('renders code block without language as plain text (defaults to text)', () => {
    const content = '```\nno language\n```';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
  });

  it('inline code uses inline-code class, not code-block-wrapper', () => {
    const content = 'Use `npm install` to install packages.';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const inlineCode = container.querySelector('code.inline-code');
    expect(inlineCode).toBeTruthy();
    expect(inlineCode!.textContent).toBe('npm install');

    const blockWrapper = container.querySelector('.code-block-wrapper');
    expect(blockWrapper).toBeNull();
  });

  it('mermaid code block renders MermaidDiagram, not SyntaxHighlighter', () => {
    const content = '```mermaid\ngraph TD; A-->B;\n```';
    render(<StreamingV2Message message={makeMessage(content)} isStreaming={false} />);

    expect(screen.getByTestId('mermaid')).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
  });

  it('shows language label in header for highlighted languages', () => {
    const content = '```python\nx = 1\n```';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const langSpan = container.querySelector('.code-block-language');
    expect(langSpan).toBeTruthy();
    expect(langSpan!.textContent).toContain('PYTHON');
  });

  it('shows MARKDOWN label for ````markdown blocks', () => {
    const content = '````markdown\n# Hi\n````';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const langSpan = container.querySelector('.code-block-language');
    expect(langSpan).toBeTruthy();
    expect(langSpan!.textContent).toContain('MARKDOWN');
  });

  it('does not show language label for text/no-language blocks', () => {
    const content = '```\nplain\n```';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const langSpan = container.querySelector('.code-block-language');
    expect(langSpan).toBeTruthy();
    expect(langSpan!.textContent).toBe('');
  });

  it('multiple code blocks: python uses highlighter, markdown does not', () => {
    const content = '```python\nprint(1)\n```\n\n````markdown\n# Title\n````';
    const { container } = render(
      <StreamingV2Message message={makeMessage(content)} isStreaming={false} />
    );

    const wrappers = container.querySelectorAll('.code-block-wrapper');
    expect(wrappers.length).toBe(2);

    // SyntaxHighlighter called only for python
    expect(syntaxHighlighterSpy).toHaveBeenCalledTimes(1);
    expect(syntaxHighlighterSpy).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'python' })
    );
  });
});
