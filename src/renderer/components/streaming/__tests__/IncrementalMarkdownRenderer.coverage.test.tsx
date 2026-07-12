/** @vitest-environment happy-dom */

/**
 * IncrementalMarkdownRenderer — branch coverage.
 *
 * The existing suites render through the REAL react-markdown, so the `pre`
 * handler always receives a populated hast `node` and Strategy 1 wins every
 * time — leaving Strategy 2 (the React-children fallback), the string-className
 * sub-branch, the `splitIntoBlocks` streaming paths, and the MarkdownLink
 * onClick routing uncovered.
 *
 * Here react-markdown is mocked to CAPTURE the `components` map handed to it.
 * The test then invokes `components.pre` / `components.code` / `components.a`
 * directly with hand-crafted props, which lets every Strategy 1 / Strategy 2
 * branch be exercised deterministically. `splitIntoBlocks` is driven by
 * rendering with isStreaming and content shaped to hit each split rule.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../styles/StreamingV2Message.css', () => ({}));
vi.mock('../../../styles/markdown-render.css', () => ({}));

// Capture the components map react-markdown receives.
const captured: { components?: any } = {};
vi.mock('react-markdown', () => ({
  default: ({ components, children }: any) => {
    if (components) captured.components = components;
    return <div data-testid="rm">{typeof children === 'string' ? children : null}</div>;
  },
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));

vi.mock('../../chat/MermaidDiagram', () => ({
  default: ({ definition }: any) => <div data-testid="mermaid">{definition}</div>,
}));
vi.mock('../../chat/CodeBlockCopyButton', () => ({
  default: ({ code }: any) => <button data-testid="copy-button">{String(code).slice(0, 10)}</button>,
}));
vi.mock('../../chat/CodeBlockContent', () => ({
  CodeBlockContent: ({ language, content }: any) => (
    <pre data-testid="cbc" data-lang={language}>{content}</pre>
  ),
}));

// MarkdownLink dependencies.
const mockOpen = vi.fn();
vi.mock('../../browser/embeddedBrowser.atom', () => ({
  EmbeddedBrowserAtom: { useChange: () => ({ open: mockOpen }) },
}));
let mockSessionId: string | null = 'sess-1';
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: () => mockSessionId,
}));
let mockBrowserEnabled = true;
vi.mock('../../../lib/userData/useEmbeddedBrowserEnabled', () => ({
  useEmbeddedBrowserEnabled: () => mockBrowserEnabled,
}));

import { IncrementalMarkdownRenderer } from '../IncrementalMarkdownRenderer';

// Render the renderer once to populate `captured.components`, then return it.
function getComponents() {
  captured.components = undefined;
  render(<IncrementalMarkdownRenderer content="seed text" isStreaming={false} />);
  if (!captured.components) throw new Error('components not captured');
  return captured.components;
}

// Render a single element returned by a markdown component function.
function renderEl(el: React.ReactNode) {
  return render(<>{el}</>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionId = 'sess-1';
  mockBrowserEnabled = true;
});

// ============================================================
// code component (line 192)
// ============================================================
describe('code component', () => {
  it('block code (className has language-) preserves className (192 true)', () => {
    const c = getComponents();
    const { container } = renderEl(c.code({ className: 'language-js', children: 'const x=1' }));
    const code = container.querySelector('code.language-js');
    expect(code).toBeTruthy();
    expect(code!.classList.contains('inline-code')).toBe(false);
  });

  it('inline code (no language- className) gets inline-code class (192 false)', () => {
    const c = getComponents();
    const { container } = renderEl(c.code({ children: 'inline' }));
    expect(container.querySelector('code.inline-code')).toBeTruthy();
  });
});

// ============================================================
// pre — Strategy 1 (hast node), lines 213-233
// ============================================================
describe('pre Strategy 1 (hast node)', () => {
  it('array className with language- (line 218 true)', () => {
    const c = getComponents();
    const node = {
      children: [{
        tagName: 'code',
        properties: { className: ['language-python'] },
        children: [{ type: 'text', value: 'print(1)' }],
      }],
    };
    renderEl(c.pre({ node, children: [] }));
    expect(screen.getByTestId('cbc').getAttribute('data-lang')).toBe('python');
  });

  it('array className WITHOUT language- → language stays text (line 218 langCls undefined)', () => {
    const c = getComponents();
    const node = {
      children: [{
        tagName: 'code',
        properties: { className: ['foo', 'bar'] },
        children: [{ type: 'text', value: 'plain' }],
      }],
    };
    renderEl(c.pre({ node, children: [] }));
    expect(screen.getByTestId('cbc').getAttribute('data-lang')).toBe('text');
  });

  it('string className with language- (lines 219, 221 true)', () => {
    const c = getComponents();
    const node = {
      children: [{
        tagName: 'code',
        properties: { className: 'language-ruby' },
        children: [{ type: 'text', value: 'puts 1' }],
      }],
    };
    renderEl(c.pre({ node, children: [] }));
    expect(screen.getByTestId('cbc').getAttribute('data-lang')).toBe('ruby');
  });

  it('string className containing language- but regex no-match (line 221 false)', () => {
    const c = getComponents();
    // includes 'language-' substring but no \w after the dash → match is null
    const node = {
      children: [{
        tagName: 'code',
        properties: { className: 'language-' },
        children: [{ type: 'text', value: 'x' }],
      }],
    };
    renderEl(c.pre({ node, children: [] }));
    expect(screen.getByTestId('cbc').getAttribute('data-lang')).toBe('text');
  });

  it('extractText recurses into nested children and skips non-text (lines 226, 227)', () => {
    const c = getComponents();
    const node = {
      children: [{
        tagName: 'code',
        properties: { className: ['language-txt'] },
        children: [
          { type: 'text', value: 'a' },
          { type: 'element', children: [{ type: 'text', value: 'b' }] },
          { type: 'comment' }, // neither text nor children → '' branch
        ],
      }],
    };
    renderEl(c.pre({ node, children: [] }));
    // 'a' + 'b' joined; trailing newline stripped (none here)
    expect(screen.getByTestId('cbc').textContent).toBe('ab');
  });

  it('mermaid language renders MermaidDiagram (line 256)', () => {
    const c = getComponents();
    const node = {
      children: [{
        tagName: 'code',
        properties: { className: ['language-mermaid'] },
        children: [{ type: 'text', value: 'graph TD; A-->B;' }],
      }],
    };
    renderEl(c.pre({ node, children: [] }));
    expect(screen.getByTestId('mermaid').textContent).toContain('graph TD');
  });
});

// ============================================================
// pre — Strategy 2 (React children fallback), lines 236-252, 254 false
// ============================================================
describe('pre Strategy 2 (React children fallback)', () => {
  it('finds <code> child by type and extracts language (lines 240, 245, 247 true)', () => {
    const c = getComponents();
    const codeChild = React.createElement('code', { className: 'language-go' }, 'fmt.Println()');
    renderEl(c.pre({ children: [codeChild] })); // no node → Strategy 1 skipped
    expect(screen.getByTestId('cbc').getAttribute('data-lang')).toBe('go');
  });

  it('code child with className but no language match → text (line 247 false)', () => {
    const c = getComponents();
    const codeChild = React.createElement('code', { className: 'hljs' }, 'plain');
    renderEl(c.pre({ children: [codeChild] }));
    expect(screen.getByTestId('cbc').getAttribute('data-lang')).toBe('text');
  });

  it('single non-code child with children matches via length===1 fallback (line 240 third clause)', () => {
    const c = getComponents();
    const spanChild = React.createElement('span', {}, 'wrapped');
    renderEl(c.pre({ children: [spanChild] }));
    // detected via the length===1 && children!==undefined clause; className undefined → text
    expect(screen.getByTestId('cbc').getAttribute('data-lang')).toBe('text');
  });

  it('no detectable code child → fallback div (line 254 false / line 272)', () => {
    const c = getComponents();
    const { container } = renderEl(c.pre({ children: [] }));
    expect(container.querySelector('.overflow-x-auto')).toBeTruthy();
    expect(screen.queryByTestId('cbc')).toBeNull();
  });
});

// ============================================================
// language label conditional (line 263)
// ============================================================
describe('language label', () => {
  it('shows "</> LANG" for non-text language', () => {
    const c = getComponents();
    const node = {
      children: [{ tagName: 'code', properties: { className: ['language-rust'] }, children: [{ type: 'text', value: 'x' }] }],
    };
    const { container } = renderEl(c.pre({ node, children: [] }));
    expect(container.querySelector('.code-block-language')!.textContent).toBe('</> RUST');
  });

  it('empty label for text language', () => {
    const c = getComponents();
    const node = {
      children: [{ tagName: 'code', properties: {}, children: [{ type: 'text', value: 'x' }] }],
    };
    const { container } = renderEl(c.pre({ node, children: [] }));
    expect(container.querySelector('.code-block-language')!.textContent).toBe('');
  });
});

// ============================================================
// MarkdownLink onClick routing (line 31)
// ============================================================
describe('a → MarkdownLink onClick (line 31)', () => {
  it('https link with sessionId opens in-app browser (31 all true)', () => {
    const c = getComponents();
    renderEl(c.a({ href: 'https://example.com', children: 'link' }));
    const a = screen.getByText('link');
    fireEvent.click(a);
    expect(mockOpen).toHaveBeenCalledWith('sess-1', 'https://example.com');
  });

  it('https link with disabled embedded browser keeps default link behavior', () => {
    mockBrowserEnabled = false;
    const c = getComponents();
    renderEl(c.a({ href: 'https://example.com', children: 'disabled-link' }));
    const anchor = screen.getByText('disabled-link');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(anchor, event);
    expect(event.defaultPrevented).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('non-http link does not route to browser (31 regex false)', () => {
    const c = getComponents();
    renderEl(c.a({ href: 'mailto:x@y.z', children: 'mail' }));
    fireEvent.click(screen.getByText('mail'));
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('https link with no sessionId does not route (31 sessionId false)', () => {
    mockSessionId = null;
    const c = getComponents();
    renderEl(c.a({ href: 'https://example.com', children: 'link2' }));
    fireEvent.click(screen.getByText('link2'));
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

// ============================================================
// splitIntoBlocks via isStreaming (lines 70,75,83,90,93,104,111,152)
// ============================================================
describe('splitIntoBlocks (streaming)', () => {
  it('renders without crashing for a long code block that forms a split point (75 true)', () => {
    // A code fence whose accumulated block exceeds 100 chars, then a closing
    // fence → triggers the "code block ends && length>100" split (line 75).
    const code = '```js\n' + 'x'.repeat(120) + '\n```\n\ntail paragraph';
    const { container } = render(<IncrementalMarkdownRenderer content={code} isStreaming={true} />);
    expect(container.querySelector('.incremental-markdown-renderer')).toBeTruthy();
  });

  it('short code block does not split (75 false branch)', () => {
    const code = '```\nhi\n```\n';
    const { container } = render(<IncrementalMarkdownRenderer content={code} isStreaming={true} />);
    expect(container.querySelector('.incremental-markdown-renderer')).toBeTruthy();
  });

  it('long paragraph followed by blank line splits (90 true, 93 true)', () => {
    const content = 'P'.repeat(250) + '\n\nsecond paragraph still typing';
    const { container } = render(<IncrementalMarkdownRenderer content={content} isStreaming={true} />);
    // first block rendered, last block pending
    expect(container.querySelector('.markdown-pending-content')).toBeTruthy();
  });

  it('short paragraph + blank does not split (93 false)', () => {
    const content = 'short\n\nmore';
    const { container } = render(<IncrementalMarkdownRenderer content={content} isStreaming={true} />);
    expect(container.querySelector('.incremental-markdown-renderer')).toBeTruthy();
  });

  it('very long sentence ending splits at punctuation (104 true)', () => {
    const content = 'word '.repeat(120) + 'end.\nnext line continues here for the pending block';
    const { container } = render(<IncrementalMarkdownRenderer content={content} isStreaming={true} />);
    expect(container.querySelector('.incremental-markdown-renderer')).toBeTruthy();
  });

  it('whitespace-only streaming content yields empty pending (line 152 || fallback)', () => {
    const { container } = render(<IncrementalMarkdownRenderer content={'\n\n\n'} isStreaming={true} />);
    // blocks=[] → pending = blocks[-1] || '' = '' → no pending area rendered
    expect(container.querySelector('.markdown-pending-content')).toBeNull();
  });

  it('inside-code-block non-fence lines accumulate (line 83 true)', () => {
    const content = '```python\nline1\nline2\nline3\n```\n\ntrailing';
    const { container } = render(<IncrementalMarkdownRenderer content={content} isStreaming={true} />);
    expect(container.querySelector('.incremental-markdown-renderer')).toBeTruthy();
  });
});
