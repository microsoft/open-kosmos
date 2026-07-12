/** @vitest-environment happy-dom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../styles/OverlayFileViewer.css', () => ({}));

const monacoCreate = vi.hoisted(() => vi.fn((_container: HTMLElement, _options: Record<string, unknown>) => ({
  dispose: vi.fn(),
})));

vi.mock('monaco-editor', () => ({
  editor: {
    create: monacoCreate,
  },
}));

import FileContentRenderer, {
  classifyFileContent,
  getFileExtension,
  getMonacoLanguage,
  isTextFileContentCategory,
} from '../FileContentRenderer';

describe('FileContentRenderer helpers', () => {
  it('classifies files by MIME type and extension', () => {
    expect(classifyFileContent({ name: 'x.bin', mimeType: 'application/pdf' })).toBe('pdf');
    expect(classifyFileContent({ name: 'x.bin', mimeType: 'text/html' })).toBe('html');
    expect(classifyFileContent({ name: 'x.bin', mimeType: 'text/markdown' })).toBe('markdown');
    expect(classifyFileContent({ name: 'x.bin', mimeType: 'application/json' })).toBe('json');
    expect(classifyFileContent({ name: 'x.bin', mimeType: 'text/plain' })).toBe('text');
    expect(classifyFileContent({ name: 'x.bin', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('office');
    expect(classifyFileContent({ name: 'page.html' })).toBe('html');
    expect(classifyFileContent({ name: 'README.markdown' })).toBe('markdown');
    expect(classifyFileContent({ name: 'data.json' })).toBe('json');
    expect(classifyFileContent({ name: 'app.ts' })).toBe('code');
    expect(classifyFileContent({ name: 'notes.txt' })).toBe('text');
    expect(classifyFileContent({ name: 'doc.pdf' })).toBe('pdf');
    expect(classifyFileContent({ name: 'deck.pptx' })).toBe('office');
    expect(classifyFileContent({ name: 'archive.bin' })).toBe('other');
    expect(isTextFileContentCategory('markdown')).toBe(true);
    expect(isTextFileContentCategory('pdf')).toBe(false);
  });

  it('maps extensions to file and Monaco languages', () => {
    expect(getFileExtension('README')).toBe('');
    expect(getFileExtension('archive.tar.md')).toBe('md');
    expect(getMonacoLanguage('md')).toBe('markdown');
    expect(getMonacoLanguage('ts')).toBe('typescript');
    expect(getMonacoLanguage('groovy')).toBe('plaintext');
    expect(getMonacoLanguage('unknown')).toBe('plaintext');
  });
});

describe('FileContentRenderer', () => {
  beforeEach(() => {
    monacoCreate.mockClear();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Markdown with parsed YAML frontmatter and GFM body', () => {
    render(
      <FileContentRenderer
        name="memory.md"
        content={[
          '---',
          'title: Memory Card',
          'source: OpenKosmos',
          '---',
          '# Heading',
          '',
          '| A | B |',
          '| - | - |',
          '| 1 | 2 |',
        ].join('\n')}
      />,
    );

    expect(document.querySelector('.file-viewer-markdown-content')).not.toBeNull();
    expect(document.querySelector('.file-viewer-frontmatter')).not.toBeNull();
    expect(screen.getByText('title')).toBeTruthy();
    expect(screen.getByText('Memory Card')).toBeTruthy();
    expect(screen.getByText('source')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('opens external Markdown links with the system browser path', () => {
    render(<FileContentRenderer name="links.md" content="[GitHub](https://github.com)" />);

    fireEvent.click(screen.getByRole('link', { name: 'GitHub' }));

    expect(window.open).toHaveBeenCalledWith('https://github.com', '_blank', 'noopener,noreferrer');
  });

  it('keeps relative Markdown links as normal anchors', () => {
    render(<FileContentRenderer name="links.md" content="[Local](./local.md)" />);

    const link = screen.getByRole('link', { name: 'Local' });
    expect(link.getAttribute('href')).toBe('./local.md');
  });

  it('renders known Memex wikilinks as navigable Markdown links', () => {
    const onNavigate = vi.fn();
    render(
      <FileContentRenderer
        name="memory.md"
        content="See [[target-card|the target]] and keep [[missing-card]] as text."
        markdownWikilinks={{
          resolveTarget: (target) => target === 'target-card' ? 'target-card' : null,
          onNavigate,
        }}
      />,
    );

    const link = screen.getByRole('link', { name: 'the target' });
    expect(link.getAttribute('href')).toBe('#memex-card:target-card');
    expect(link.className).toContain('file-viewer-wikilink');

    fireEvent.click(link);

    expect(onNavigate).toHaveBeenCalledWith('target-card');
    expect(screen.getByText('[[missing-card]]', { exact: false })).toBeTruthy();
  });

  it('does not transform Memex wikilinks inside code spans or fenced blocks', () => {
    render(
      <FileContentRenderer
        name="memory.md"
        content={[
          'Inline `[[target-card]]` stays code.',
          '',
          '```',
          '[[target-card]]',
          '```',
        ].join('\n')}
        markdownWikilinks={{
          resolveTarget: () => 'target-card',
          onNavigate: vi.fn(),
        }}
      />,
    );

    expect(screen.queryByRole('link', { name: 'target-card' })).toBeNull();
    expect(screen.getAllByText('[[target-card]]')).toHaveLength(2);
  });

  it('renders HTML in render mode and revokes its blob URL on unmount', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:html');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const { unmount } = render(<FileContentRenderer name="page.html" content="<h1>Hello</h1>" />);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('page.html').className).toBe('file-viewer-html-embed');
    expect(screen.getByTitle('page.html').getAttribute('src')).toBe('blob:html');
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:html');
  });

  it('renders HTML source mode with Monaco instead of an iframe', async () => {
    render(<FileContentRenderer name="page.html" content="<h1>Hello</h1>" viewMode="source" />);

    await waitFor(() => expect(monacoCreate).toHaveBeenCalled());
    expect(monacoCreate.mock.calls[0][1]).toMatchObject({
      value: '<h1>Hello</h1>',
      language: 'html',
      fontSize: 13,
      lineHeight: 21,
      readOnly: true,
    });
  });

  it('uses overlay class names for all shared file-content consumers', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:overlay-html');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(
      <FileContentRenderer
        name="page.html"
        content="<h1>Hello</h1>"
      />,
    );

    expect(screen.getByTitle('page.html').className).toBe('file-viewer-html-embed');
  });

  it('renders JSON, code, text, and fallback files with Monaco languages', async () => {
    const cases = [
      ['data.json', '{"ok":true}', 'json'],
      ['script.ts', 'const ok = true;', 'typescript'],
      ['notes.txt', 'plain text', 'plaintext'],
      ['unknown.bin', 'raw bytes', 'plaintext'],
    ] as const;

    for (const [name, content, language] of cases) {
      const { unmount } = render(<FileContentRenderer name={name} content={content} />);
      await waitFor(() => expect(monacoCreate).toHaveBeenLastCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({ value: content, language }),
      ));
      unmount();
    }
  });

  it('renders nothing for empty HTML render content', () => {
    const { container } = render(<FileContentRenderer name="empty.html" content="" />);
    expect(container.firstChild).toBeNull();
  });
});
