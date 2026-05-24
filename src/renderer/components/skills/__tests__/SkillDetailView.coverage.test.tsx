/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Set up electronAPI before importing component
const mockGetSkillMarkdown = vi.fn();
(window as any).electronAPI = {
  skills: { getSkillMarkdown: mockGetSkillMarkdown },
};

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn(),
  }),
}));

import SkillDetailView from '../SkillDetailView';

const mockSkill = {
  name: 'TestSkill',
  version: '1.0.0',
  description: 'A test skill',
} as any;

describe('SkillDetailView', () => {
  beforeEach(() => {
    mockGetSkillMarkdown.mockReset();
  });

  it('shows empty state when skill is null', () => {
    mockGetSkillMarkdown.mockResolvedValue({ success: false });
    render(<SkillDetailView skill={null} />);
    expect(screen.getByText('Select a skill to view details')).toBeTruthy();
  });

  it('shows skill header with name and version', () => {
    mockGetSkillMarkdown.mockResolvedValue({ success: true, content: '# Hello' });
    render(<SkillDetailView skill={mockSkill} />);
    expect(screen.getByText('TestSkill')).toBeTruthy();
    expect(screen.getByText('v1.0.0')).toBeTruthy();
    expect(screen.getByText('A test skill')).toBeTruthy();
  });

  it('shows markdown content when loaded', async () => {
    mockGetSkillMarkdown.mockResolvedValue({ success: true, content: '# Hello World' });
    render(<SkillDetailView skill={mockSkill} />);
    await waitFor(() => {
      expect(screen.getByTestId('markdown')).toBeTruthy();
    });
  });

  it('shows error when load fails with error message', async () => {
    mockGetSkillMarkdown.mockResolvedValue({ success: false, error: 'Not found' });
    render(<SkillDetailView skill={mockSkill} />);
    await waitFor(() => {
      expect(screen.getByText(/Not found/)).toBeTruthy();
    });
  });

  it('shows fallback error message when no error text', async () => {
    mockGetSkillMarkdown.mockResolvedValue({ success: false });
    render(<SkillDetailView skill={mockSkill} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load skill content/)).toBeTruthy();
    });
  });

  it('shows fallback message when no error and no content', async () => {
    // success: false, no error => shows 'Failed to load skill content' (the fallback error)
    // To get 'No SKILL.md content available', we'd need no error AND no content, but
    // the component always sets error in the else branch. So test the error fallback:
    mockGetSkillMarkdown.mockResolvedValue({ success: false });
    render(<SkillDetailView skill={mockSkill} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load skill content/)).toBeTruthy();
    });
  });

  it('handles thrown error in load', async () => {
    mockGetSkillMarkdown.mockRejectedValue({ message: 'network error' });
    render(<SkillDetailView skill={mockSkill} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load skill content/)).toBeTruthy();
    });
  });

  it('shows skill without version', () => {
    mockGetSkillMarkdown.mockResolvedValue({ success: false, error: 'x' });
    const skillNoVersion = { name: 'NoVer', description: 'desc' } as any;
    render(<SkillDetailView skill={skillNoVersion} />);
    expect(screen.getByText('NoVer')).toBeTruthy();
    expect(screen.queryByText(/^v/)).toBeNull();
  });
});
