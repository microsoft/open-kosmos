/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import GeneratedFileCards, {
  normalizePresentedFilesToGeneratedFileItems,
  PresentedFile,
} from '../message/GeneratedFileCards';

const mockShowToast = vi.fn();
const mockMoveFileToKnowledgeBase = vi.fn();
const mockOpenPath = vi.fn();

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useAgentConfig: () => ({
    agent: {
      knowledgeBase: '/workspace/knowledge',
    },
  }),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatId: () => 'chat-123',
  CurrentSessionIdle: { use: () => true },
}));

vi.mock('../../../lib/chat/moveToKnowledgeBase', async () => {
  const actual = await vi.importActual('../../../lib/chat/moveToKnowledgeBase');
  return {
    ...actual,
    moveFileToKnowledgeBase: (...args: unknown[]) => mockMoveFileToKnowledgeBase(...args),
  };
});

describe('GeneratedFileCards', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockMoveFileToKnowledgeBase.mockReset();
    mockMoveFileToKnowledgeBase.mockResolvedValue({ success: true });

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
        },
        workspace: {
          openPath: mockOpenPath,
          showInFolder: vi.fn().mockResolvedValue({ success: true }),
        },
        skillLibrary: {
          installSkillFromFilePath: vi.fn().mockResolvedValue({ success: true, skillName: 'Test Skill', isOverwrite: false }),
        },
      },
    });

    mockOpenPath.mockReset();
    mockOpenPath.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes present_deliverables payloads into grouped generated file items', () => {
    const files: PresentedFile[] = [
      {
        filePath: JSON.stringify([' /workspace/output/report.md ', '/workspace/output/chart.png']),
        description: 'Final deliverables',
      },
      {
        filePath: '/workspace/output/notes.txt',
        description: 'Supporting files',
      },
    ];

    const items = normalizePresentedFilesToGeneratedFileItems(files);

    expect(items).toEqual([
      {
        filePath: '/workspace/output/report.md',
        groupLabel: 'Final deliverables',
      },
      {
        filePath: '/workspace/output/chart.png',
        groupLabel: 'Final deliverables',
      },
      {
        filePath: '/workspace/output/notes.txt',
        groupLabel: 'Supporting files',
      },
    ]);
  });

  it('renders grouped files and hides Move to Knowledge Base for files already in the knowledge base', () => {
    const items = normalizePresentedFilesToGeneratedFileItems([
      {
        filePath: JSON.stringify(['/workspace/output/report.md', '/workspace/knowledge/already-added.md']),
        description: 'Final deliverables',
      },
    ]);

    render(
      <GeneratedFileCards
        items={items.map((item) => ({ ...item, exists: true }))}
       
      />,
    );

    expect(screen.getByText('Final deliverables')).toBeInTheDocument();
    expect(screen.getByText('report.md')).toBeInTheDocument();
    expect(screen.getByText('already-added.md')).toBeInTheDocument();

    const menuButtons = screen.getAllByTitle('More options');

    fireEvent.click(menuButtons[0]);
    expect(screen.getByText('Move to Knowledge Base')).toBeInTheDocument();

    fireEvent.click(menuButtons[1]);
    expect(screen.queryByText('Move to Knowledge Base')).not.toBeInTheDocument();
  });

  it('shows a success toast with an Open Knowledge Base action after moving a file', async () => {
    render(
      <GeneratedFileCards
        items={[{ filePath: '/workspace/output/report.md', exists: true }]}
       
      />,
    );

    fireEvent.click(screen.getByTitle('More options'));
    fireEvent.click(screen.getByText('Move to Knowledge Base'));

    await waitFor(() => {
      expect(mockMoveFileToKnowledgeBase).toHaveBeenCalledWith('/workspace/output/report.md', '/workspace/knowledge');
      expect(mockShowToast).toHaveBeenCalledWith(
        'File moved to knowledge base',
        'success',
        5000,
        expect.objectContaining({
          actions: [
            expect.objectContaining({
              label: 'Open Knowledge Base',
              variant: 'primary',
              onClick: expect.any(Function),
            }),
          ],
        }),
      );
    });
  });

  it('shows Install skill for .zip and SKILL.md artifacts', () => {
    render(
      <GeneratedFileCards
        items={[
          { filePath: '/workspace/output/pptx.skill', exists: true },
          { filePath: '/workspace/output/pptx.zip', exists: true },
          { filePath: '/workspace/output/pptx/SKILL.md', exists: true },
        ]}
       
      />,
    );

    const menuButtons = screen.getAllByTitle('More options');

    fireEvent.click(menuButtons[0]);
    expect(screen.getByText('Install skill')).toBeInTheDocument();

    fireEvent.click(menuButtons[1]);
    expect(screen.getByText('Install skill')).toBeInTheDocument();

    fireEvent.click(menuButtons[2]);
    expect(screen.getByText('Install skill')).toBeInTheDocument();
  });

  it('copies file path to clipboard when "Copy file path" is clicked', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: { writeText: mockWriteText },
    });

    render(
      <GeneratedFileCards
        items={[{ filePath: '/workspace/output/report.md', exists: true }]}
       
      />,
    );

    fireEvent.click(screen.getByTitle('More options'));
    fireEvent.click(screen.getByText('Copy file path'));

    expect(mockWriteText).toHaveBeenCalledWith('/workspace/output/report.md');
  });

  it('renders generated file cards with responsive width constraints', () => {
    const { container } = render(
      <GeneratedFileCards
        items={[
          {
            filePath: '/Users/testuser/Library/Application Support/openkosmos-app/profiles/demo-user/chat_workspaces/chat_1774501148705_hn6mnv93u/202603/chatSession_20260326203735/我的母亲.md',
            exists: true,
          },
        ]}
       
      />,
    );

    const card = container.querySelector('.file-attachment-item') as HTMLElement | null;
    expect(card).toBeInTheDocument();
    expect(card).toHaveStyle({
      width: 'min(100%, 400px)',
      maxWidth: '100%',
      minWidth: '0',
    });
  });
});