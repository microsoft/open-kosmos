// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('lucide-react', () => ({
  ChevronLeft: ({ size, strokeWidth }: any) => (
    <svg data-testid="chevron-left" data-size={size} data-stroke-width={strokeWidth} />
  ),
  FileText: ({ size, color, strokeWidth }: any) => (
    <svg
      data-testid="file-text-icon"
      data-size={size}
      data-stroke-width={strokeWidth}
      style={color ? { color } : undefined}
    />
  ),
}));

vi.mock('../../ui/FileContentRenderer', () => ({
  default: ({ name, content, viewMode }: { name: string; content: string; viewMode?: string }) => (
    <div data-testid="file-content-renderer" data-name={name} data-view-mode={viewMode ?? ''}>{content}</div>
  ),
}));

import SkillFileViewer from '../SkillFileViewer';

const skill = {
  name: 'demo-skill',
  displayName: 'Demo Skill',
  description: 'Demo skill',
};

function fileInfo(overrides: Record<string, any> = {}) {
  return {
    fileName: 'example.md',
    path: 'skills/demo/example.md',
    extension: 'md',
    content: '# Heading',
    isSupported: true,
    size: 10,
    modifiedTime: '2026-06-20T00:00:00Z',
    ...overrides,
  };
}

describe('SkillFileViewer', () => {
  it('renders the empty selection state when no file is selected', () => {
    render(<SkillFileViewer skill={skill} fileInfo={null} onBack={vi.fn()} />);

    expect(screen.getByText('No file selected')).toBeTruthy();
  });

  it('renders unsupported file details with a dotted extension', () => {
    render(<SkillFileViewer skill={skill} fileInfo={fileInfo({ fileName: 'archive.bin', extension: 'bin', isSupported: false })} onBack={vi.fn()} />);

    expect(screen.getByText('archive.bin')).toBeTruthy();
    expect(screen.getByText('BIN')).toBeTruthy();
    expect(screen.getByText('This format is not supported for preview')).toBeTruthy();
    expect(screen.getByText('File type: .bin')).toBeTruthy();
  });

  it('renders unsupported files with an unknown type when the extension is missing', () => {
    render(<SkillFileViewer skill={skill} fileInfo={fileInfo({ fileName: 'README', extension: '', isSupported: false })} onBack={vi.fn()} />);

    expect(screen.getByText('File type: Unknown')).toBeTruthy();
  });

  it('renders an empty-content state for supported files without content', () => {
    render(<SkillFileViewer skill={skill} fileInfo={fileInfo({ fileName: 'empty.txt', extension: 'txt', content: '' })} onBack={vi.fn()} />);

    expect(screen.getByText('empty.txt')).toBeTruthy();
    expect(screen.getByText('Text')).toBeTruthy();
    expect(screen.getByText('File content is empty')).toBeTruthy();
  });

  it('delegates markdown content to the shared file content renderer', () => {
    render(<SkillFileViewer skill={skill} fileInfo={fileInfo({ content: '---\ntitle: Guide\n---\nMarkdown body' })} onBack={vi.fn()} />);

    const renderer = screen.getByTestId('file-content-renderer');
    expect(renderer.getAttribute('data-name')).toBe('example.md');
    expect(renderer.textContent).toContain('Markdown body');
  });

  it('passes plain markdown through the shared file content renderer', () => {
    render(<SkillFileViewer skill={skill} fileInfo={fileInfo()} onBack={vi.fn()} />);

    expect(screen.getByTestId('file-content-renderer').textContent).toContain('# Heading');
  });

  it('renders skill HTML files as inert source instead of executable preview', () => {
    render(
      <SkillFileViewer
        skill={skill}
        fileInfo={fileInfo({
          fileName: 'page.html',
          extension: 'html',
          content: '<script>window.evil = true</script>',
        })}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('HTML')).toBeTruthy();
    expect(screen.getByTestId('file-content-renderer').getAttribute('data-view-mode')).toBe('source');
  });

  it('renders every supported code extension with the expected language label and code text', () => {
    const extensions = [
      ['js', 'JavaScript'],
      ['jsx', 'JavaScript (JSX)'],
      ['ts', 'TypeScript'],
      ['tsx', 'TypeScript (TSX)'],
      ['py', 'Python'],
      ['json', 'JSON'],
      ['yaml', 'YAML'],
      ['yml', 'YAML'],
      ['css', 'CSS'],
      ['html', 'HTML'],
      ['xml', 'XML'],
    ];

    for (const [extension, label] of extensions) {
      const { unmount } = render(
        <SkillFileViewer
          skill={skill}
          fileInfo={fileInfo({ fileName: `sample.${extension}`, extension, content: `content for ${extension}` })}
          onBack={vi.fn()}
        />
      );

      expect(screen.getByText(`sample.${extension}`)).toBeTruthy();
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(screen.getByText(`content for ${extension}`)).toBeTruthy();
      unmount();
    }
  });

  it('calls onBack and uses the neutral token for JSON file icon color', () => {
    const onBack = vi.fn();

    render(<SkillFileViewer skill={skill} fileInfo={fileInfo({ fileName: 'data.json', extension: 'json', content: '{"ok":true}' })} onBack={onBack} />);

    fireEvent.click(screen.getByTitle('Back to folder'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chevron-left').dataset.size).toBe('20');
    expect(screen.getAllByTestId('file-text-icon')[0].style.color).toBe('var(--color-neutral-500)');
  });

  it('renders unknown supported file types as plain text with fallback language and icon color', () => {
    render(<SkillFileViewer skill={skill} fileInfo={fileInfo({ fileName: 'notes.log', extension: 'log', content: 'plain log text' })} onBack={vi.fn()} />);

    expect(screen.getByText('LOG')).toBeTruthy();
    expect(screen.getByText('plain log text')).toBeTruthy();
    expect(screen.getByTestId('file-text-icon').style.color).toBe('var(--color-neutral-400)');
  });
});
