/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import SkillViewPanel from '../SkillViewPanel';

vi.mock('../SkillFolderExplorer', () => ({
  default: ({ skill, onFileSelect }: any) => (
    <div data-testid="folder-explorer" onClick={() => onFileSelect({
      fileName: 'test.txt',
      path: '/test.txt',
      extension: 'txt',
      content: 'hello',
      isSupported: true,
      size: 5,
      modifiedTime: '2024-01-01',
    })}>FolderExplorer</div>
  ),
}));

vi.mock('../SkillFileViewer', () => ({
  default: ({ skill, fileInfo, onBack }: any) => (
    <div data-testid="file-viewer">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const mockSkill = { name: 'TestSkill', description: 'A test skill', path: '/skills/test' } as any;

describe('SkillViewPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: { skills: { getSkillFileContent: vi.fn().mockResolvedValue({ success: true, data: null }) } },
      writable: true, configurable: true,
    });
  });

  it('shows empty state when skill is null', () => {
    const { getByText } = render(<SkillViewPanel skill={null} />);
    expect(getByText('Select a skill to view details')).toBeTruthy();
  });

  it('shows folder explorer when skill is provided', () => {
    const { getByTestId } = render(<SkillViewPanel skill={mockSkill} />);
    expect(getByTestId('folder-explorer')).toBeTruthy();
  });

  it('switches to file viewer when file is selected', () => {
    const { getByTestId } = render(<SkillViewPanel skill={mockSkill} />);
    act(() => { getByTestId('folder-explorer').click(); });
    expect(getByTestId('file-viewer')).toBeTruthy();
  });

  it('goes back to folder explorer from file viewer', () => {
    const { getByTestId, getByText } = render(<SkillViewPanel skill={mockSkill} />);
    act(() => { getByTestId('folder-explorer').click(); });
    act(() => { getByText('Back').click(); });
    expect(getByTestId('folder-explorer')).toBeTruthy();
  });

  it('resets to folder mode when skill changes', () => {
    const { getByTestId, rerender } = render(<SkillViewPanel skill={mockSkill} />);
    act(() => { getByTestId('folder-explorer').click(); });
    const newSkill = { ...mockSkill, name: 'NewSkill' };
    rerender(<SkillViewPanel skill={newSkill} />);
    expect(getByTestId('folder-explorer')).toBeTruthy();
  });

  it('handles skills:refreshFolderExplorer event in folder mode', () => {
    render(<SkillViewPanel skill={mockSkill} />);
    act(() => {
      window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
        detail: { skillName: 'TestSkill' }
      }));
    });
    // Should not crash
  });

  it('handles skills:refreshFolderExplorer event in file mode', async () => {
    const { getByTestId } = render(<SkillViewPanel skill={mockSkill} />);
    act(() => { getByTestId('folder-explorer').click(); });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
        detail: { skillName: 'TestSkill' }
      }));
    });
  });
});
