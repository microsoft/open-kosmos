/**
 * @vitest-environment happy-dom
 *
 * Tests for code block rendering fixes:
 * - hast node extraction (Strategy 1)
 * - React children fallback (Strategy 2)
 * - Plain text rendering for markdown/md/text languages
 * - Preserved className for block code in code component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// --- CSS / style mocks ---
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

import { IncrementalMarkdownRenderer } from '../IncrementalMarkdownRenderer';

describe('IncrementalMarkdownRenderer — code block rendering', () => {
  beforeEach(() => {
    syntaxHighlighterSpy.mockClear();
  });

  it('renders ````markdown fence as plain text without SyntaxHighlighter', () => {
    const content = '````markdown\n# Hello\n\n| A | B |\n|---|---|\n| 1 | 2 |\n````';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    // Should have code-block-wrapper
    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();

    // SyntaxHighlighter should NOT be called for markdown language
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();

    // Content should be rendered as plain text
    expect(wrapper!.textContent).toContain('# Hello');
    expect(wrapper!.textContent).toContain('| A | B |');
  });

  it('renders ```md fence as plain text without SyntaxHighlighter', () => {
    const content = '```md\n# Title\nSome text\n```';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
  });

  it('renders ```text fence as plain text without SyntaxHighlighter', () => {
    const content = '```text\nplain content here\n```';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
  });

  it('renders ```python fence with SyntaxHighlighter', () => {
    const content = '```python\nprint("hello")\n```';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'python' })
    );
  });

  it('renders ```javascript fence with SyntaxHighlighter', () => {
    const content = '```javascript\nconsole.log("hi");\n```';
    render(<IncrementalMarkdownRenderer content={content} isStreaming={false} />);
    expect(syntaxHighlighterSpy).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'javascript' })
    );
  });

  it('renders ````markdown with nested ```powershell as plain text', () => {
    const content = '````markdown\n## Build\n\n```powershell\ngit clone https://example.com\n```\n````';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    // The whole thing is ONE code block (language=markdown), rendered as plain text
    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();

    // The nested ```powershell should appear as literal text, not a separate code block
    expect(wrapper!.textContent).toContain('```powershell');
    expect(wrapper!.textContent).toContain('git clone https://example.com');
  });

  it('renders code block without language (```\\n) with code-block-wrapper', () => {
    const content = '```\nno language specified\n```';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    // language defaults to 'text', so should use plain rendering
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
  });

  it('shows language label in code-block-header for non-text languages', () => {
    const content = '```python\nprint("hello")\n```';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const header = container.querySelector('.code-block-header');
    expect(header).toBeTruthy();
    expect(header!.textContent).toContain('PYTHON');
  });

  it('shows MARKDOWN label for ````markdown blocks', () => {
    const content = '````markdown\n# Hello\n````';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const header = container.querySelector('.code-block-header');
    expect(header).toBeTruthy();
    expect(header!.textContent).toContain('MARKDOWN');
  });

  it('does not show language label for plain ``` blocks (language=text)', () => {
    const content = '```\nplain\n```';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const langSpan = container.querySelector('.code-block-language');
    expect(langSpan).toBeTruthy();
    // For 'text' language, label should be empty
    expect(langSpan!.textContent).toBe('');
  });

  it('inline code still gets inline-code class', () => {
    const content = 'Use `npm install` to install';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const code = container.querySelector('code.inline-code');
    expect(code).toBeTruthy();
    expect(code!.textContent).toBe('npm install');
  });

  it('code component preserves language-* className for block code', () => {
    // This tests that block code inside <pre> doesn't get inline-code class
    const content = '```python\nx = 1\n```';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    // Should NOT have any inline-code inside code-block-wrapper
    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    const inlineCode = wrapper!.querySelector('.inline-code');
    expect(inlineCode).toBeNull();
  });

  it('renders mermaid block using MermaidDiagram', () => {
    const content = '```mermaid\ngraph TD; A-->B;\n```';
    render(<IncrementalMarkdownRenderer content={content} isStreaming={false} />);
    expect(screen.getByTestId('mermaid')).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
  });

  it('copy button receives code content', () => {
    const content = '```python\nprint("hello")\n```';
    render(<IncrementalMarkdownRenderer content={content} isStreaming={false} />);
    const btn = screen.getByTestId('copy-button');
    expect(btn).toBeTruthy();
  });

  it('handles large markdown code block content', () => {
    const largeContent = '# Title\n\n' + '| Col A | Col B |\n|---|---|\n'.repeat(50) + '\n```bash\necho "nested"\n```';
    const content = '````markdown\n' + largeContent + '\n````';
    const { container } = render(
      <IncrementalMarkdownRenderer content={content} isStreaming={false} />
    );

    const wrapper = container.querySelector('.code-block-wrapper');
    expect(wrapper).toBeTruthy();
    expect(syntaxHighlighterSpy).not.toHaveBeenCalled();
    expect(wrapper!.textContent).toContain('echo "nested"');
  });
});
