// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSkillFileContent = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn() }));

vi.mock('../SkillFolderExplorer', () => ({
  default: ({ onFileSelect }: any) => (
    <button
      data-testid="folder-explorer"
      onClick={() =>
        onFileSelect({
          fileName: 'original.txt',
          path: '/skills/original.txt',
          extension: 'txt',
          content: 'original-content',
          isSupported: true,
          size: 10,
          modifiedTime: '2026-01-01',
        })
      }
      type="button"
    >
      folder
    </button>
  ),
}));

vi.mock('../SkillFileViewer', () => ({
  default: ({ fileInfo, onBack }: any) => (
    <div data-testid="file-viewer">
      <span data-testid="file-name">{fileInfo?.fileName ?? 'missing'}</span>
      <span data-testid="file-content">{fileInfo?.content ?? 'missing'}</span>
      <button data-testid="back" onClick={onBack} type="button">back</button>
    </div>
  ),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}));

import SkillViewPanel from '../SkillViewPanel';

const skill = { name: 'TestSkill', path: '/skills/test' } as any;

describe('SkillViewPanel supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSkillFileContent.mockResolvedValue({
      success: true,
      data: {
        fileName: 'refreshed.txt',
        path: '/skills/original.txt',
        extension: 'txt',
        content: 'refreshed-content',
        isSupported: true,
        size: 42,
        modifiedTime: '2026-02-02',
      },
    });

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        skills: {
          getSkillFileContent: mockGetSkillFileContent,
        },
      },
    });
  });

  it('ignores refresh events for a different skill', async () => {
    render(<SkillViewPanel skill={skill} />);

    fireEvent.click(screen.getByTestId('folder-explorer'));
    expect(screen.getByTestId('file-viewer')).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
        detail: { skillName: 'OtherSkill' },
      }));
    });

    expect(mockGetSkillFileContent).not.toHaveBeenCalled();
    expect(screen.getByTestId('file-name')).toHaveTextContent('original.txt');
  });

  it('updates the selected file after a matching refresh event returns file data', async () => {
    render(<SkillViewPanel skill={skill} />);

    fireEvent.click(screen.getByTestId('folder-explorer'));

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
        detail: { skillName: 'TestSkill' },
      }));
    });

    await waitFor(() => {
      expect(mockGetSkillFileContent).toHaveBeenCalledWith('TestSkill', '/skills/original.txt');
    });
    expect(screen.getByTestId('file-name')).toHaveTextContent('refreshed.txt');
    expect(screen.getByTestId('file-content')).toHaveTextContent('refreshed-content');
  });
});
