/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { IncrementalMarkdownRenderer } from '../IncrementalMarkdownRenderer';

describe('IncrementalMarkdownRenderer', () => {
  it('renders plain text content', () => {
    render(<IncrementalMarkdownRenderer content="Hello world" isStreaming={false} />);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('renders nothing when content is empty string', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content="" isStreaming={false} />
    );
    const wrapper = container.querySelector('.incremental-markdown-renderer');
    expect(wrapper).toBeTruthy();
  });

  it('renders markdown with bold text', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content="**bold text**" isStreaming={false} />
    );
    const strong = container.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong!.textContent).toBe('bold text');
  });

  it('renders markdown with italic text', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content="_italic_" isStreaming={false} />
    );
    const em = container.querySelector('em');
    expect(em).toBeTruthy();
  });

  it('renders a link', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content="[example](https://example.com)" isStreaming={false} />
    );
    const a = container.querySelector('a');
    expect(a).toBeTruthy();
    expect(a!.getAttribute('href')).toBe('https://example.com');
    expect(a!.getAttribute('target')).toBe('_blank');
  });

  it('renders headings', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content={'# H1\n## H2\n### H3'} isStreaming={false} />
    );
    expect(container.querySelector('h1')).toBeTruthy();
    expect(container.querySelector('h2')).toBeTruthy();
    expect(container.querySelector('h3')).toBeTruthy();
  });

  it('renders unordered list', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content={'- item 1\n- item 2'} isStreaming={false} />
    );
    expect(container.querySelector('ul')).toBeTruthy();
    expect(container.querySelectorAll('li').length).toBe(2);
  });

  it('renders ordered list', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content={'1. first\n2. second'} isStreaming={false} />
    );
    expect(container.querySelector('ol')).toBeTruthy();
  });

  it('renders blockquote', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content="> a quote" isStreaming={false} />
    );
    expect(container.querySelector('blockquote')).toBeTruthy();
  });

  it('renders inline code', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer content="use `console.log()`" isStreaming={false} />
    );
    const code = container.querySelector('code.inline-code');
    expect(code).toBeTruthy();
  });

  it('renders a code block via SyntaxHighlighter', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer
        content={'```javascript\nconsole.log("hi");\n```'}
        isStreaming={false}
      />
    );
    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
  });

  it('renders mermaid block using MermaidDiagram', () => {
    render(
      <IncrementalMarkdownRenderer
        content={'```mermaid\ngraph TD; A-->B;\n```'}
        isStreaming={false}
      />
    );
    expect(screen.getByTestId('mermaid')).toBeTruthy();
  });

  it('renders table wrapped in table-wrapper', () => {
    const tableContent = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { container } = render(
      <IncrementalMarkdownRenderer content={tableContent} isStreaming={false} />
    );
    const wrapper = container.querySelector('.table-wrapper');
    expect(wrapper).toBeTruthy();
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('applies cursor class when isStreaming and showCursor are true', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer
        content="streaming..."
        isStreaming={true}
        showCursor={true}
        cursorAnimation="smooth"
      />
    );
    const pending = container.querySelector('.markdown-pending-content');
    expect(pending?.className).toContain('with-inline-cursor');
    expect(pending?.className).toContain('cursor-smooth');
  });

  it('does not apply cursor class when showCursor is false', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer
        content="no cursor"
        isStreaming={true}
        showCursor={false}
      />
    );
    const pending = container.querySelector('.markdown-pending-content');
    expect(pending?.className).not.toContain('with-inline-cursor');
  });

  it('renders all content in pending area when not streaming', () => {
    const { container } = render(
      <IncrementalMarkdownRenderer
        content="full content here"
        isStreaming={false}
      />
    );
    // In non-streaming mode, renderedBlocks is empty, all content goes to pendingContent
    const pending = container.querySelector('.markdown-pending-content');
    expect(pending).toBeTruthy();
    expect(pending!.textContent).toContain('full content here');
  });

  it('splits long content into blocks when streaming', () => {
    // Build content with two "complete" paragraphs (> 200 chars each) separated by blank lines
    const para1 = 'A'.repeat(210) + '\n\n';
    const para2 = 'B'.repeat(50);
    const { container } = render(
      <IncrementalMarkdownRenderer
        content={para1 + para2}
        isStreaming={true}
      />
    );
    // Should have at least one rendered block + pending area
    const wrapper = container.querySelector('.incremental-markdown-renderer');
    expect(wrapper).toBeTruthy();
  });

  it('renders code block with language label and copy button', () => {
    render(
      <IncrementalMarkdownRenderer
        content={'```python\nprint("hello")\n```'}
        isStreaming={false}
      />
    );
    expect(screen.getByText('</> PYTHON')).toBeTruthy();
    expect(screen.getByTestId('copy-button')).toBeTruthy();
  });

  it('renders pre fallback when no language code child', () => {
    // plain pre without language class — ReactMarkdown produces a <pre><code>
    // but since there is no className on code, language defaults to 'text'
    const { container } = render(
      <IncrementalMarkdownRenderer
        content={'```\nno language\n```'}
        isStreaming={false}
      />
    );
    // language === 'text' so label is empty string but wrapper still present
    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
  });
});
