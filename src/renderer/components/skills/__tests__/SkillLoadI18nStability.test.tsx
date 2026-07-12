/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SkillDetailView from '../SkillDetailView';
import SkillFolderExplorer from '../SkillFolderExplorer';

const i18nState = vi.hoisted(() => {
  const messages: Record<string, string> = {
    'skills.detail.loading': 'Loading skill content...',
    'skills.detail.loadFailed': 'Failed to load skill content',
    'skills.detail.selectSkill': 'Select a skill to view details',
    'skills.detail.noContent': 'No SKILL.md content available',
    'skills.folder.loadingDirectory': 'Loading directory...',
    'skills.folder.loadFailed': 'Failed to load directory contents',
    'skills.folder.goBack': 'Go back',
    'skills.folder.emptyDirectory': 'This directory is empty',
  };
  const makeTranslator = () => (key: string) => messages[key] ?? key;

  return {
    language: 'en',
    translators: {
      en: makeTranslator(),
      zh: makeTranslator(),
    },
  };
});

vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: i18nState.translators[i18nState.language as 'en' | 'zh'],
  }),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('lucide-react', () => ({
  ChevronLeft: () => <svg data-testid="chevron-left" />,
  ChevronRight: () => <svg data-testid="chevron-right" />,
  Folder: () => <svg data-testid="icon-folder" />,
  FolderOpen: () => <svg data-testid="icon-folder-open" />,
  FileText: () => <svg data-testid="icon-file-text" />,
  FileCode: () => <svg data-testid="icon-file-code" />,
  FileJson: () => <svg data-testid="icon-file-json" />,
  FileType: () => <svg data-testid="icon-file-type" />,
  Palette: () => <svg data-testid="icon-palette" />,
  Globe: () => <svg data-testid="icon-globe" />,
  Image: () => <svg data-testid="icon-image" />,
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('../SkillViewPanel', () => ({}));

const makeSkill = (name = 'my-skill') => ({ name } as any);

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    name: 'src',
    path: 'src',
    isDirectory: true,
    isFile: false,
    size: 0,
    modifiedTime: '2026-07-05',
    extension: null,
    ...overrides,
  };
}

function makeDir(items: ReturnType<typeof makeItem>[] = [], currentPath = '') {
  return { success: true, data: { currentPath, parentPath: null, items } };
}

describe('skill loaders i18n stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = 'en';
  });

  it('does not reload skill markdown when only language changes', async () => {
    const getSkillMarkdown = vi.fn().mockResolvedValue({ success: true, content: '# Skill Body' });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { skills: { getSkillMarkdown } },
    });

    const { rerender } = render(<SkillDetailView skill={makeSkill()} />);
    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Skill Body'));
    expect(getSkillMarkdown).toHaveBeenCalledTimes(1);

    await act(async () => {
      i18nState.language = 'zh';
      rerender(<SkillDetailView skill={makeSkill()} />);
    });

    expect(getSkillMarkdown).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('markdown')).toHaveTextContent('# Skill Body');
  });

  it('does not reload or reset folder navigation when only language changes', async () => {
    const getSkillDirectoryContents = vi.fn()
      .mockResolvedValueOnce(makeDir([makeItem()]))
      .mockResolvedValueOnce(makeDir([
        makeItem({
          name: 'inner.ts',
          path: 'src/inner.ts',
          isDirectory: false,
          isFile: true,
          size: 1024,
          extension: 'ts',
        }),
      ], 'src'));
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        skills: {
          getSkillDirectoryContents,
          getSkillFileContent: vi.fn(),
        },
      },
    });

    const { rerender } = render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />);
    fireEvent.click((await screen.findByText('src')).closest('.skill-folder-item')!);
    await waitFor(() => expect(screen.getByText('inner.ts')).toBeInTheDocument());
    expect(getSkillDirectoryContents).toHaveBeenCalledTimes(2);

    await act(async () => {
      i18nState.language = 'zh';
      rerender(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />);
    });

    expect(getSkillDirectoryContents).toHaveBeenCalledTimes(2);
    expect(screen.getByText('inner.ts')).toBeInTheDocument();
    expect(screen.queryByText('src')).toBeInTheDocument();
  });
});
