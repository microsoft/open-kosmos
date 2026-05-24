/** @vitest-environment happy-dom */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import WorkspaceExplorerSidepane from '../WorkspaceExplorerSidepane';

// ── mock atoms ─────────────────────────────────────────────────────────────
const mockCancelReveal = vi.fn();
const mockOnMenuToggle = vi.fn();

vi.mock('../../chat-side.atom', () => ({
  WorkspaceExplorerAtom: {
    use: vi.fn(() => [
      { visible: true, reveal: undefined },
      { cancelReveal: mockCancelReveal },
    ]),
  },
}));

vi.mock('../../../menu/WorkspaceMenuDropdown', () => ({
  WorkspaceMenuAtom: {
    useChange: vi.fn(() => ({ toggle: mockOnMenuToggle })),
  },
}));

// ── mock userData & auth ───────────────────────────────────────────────────
vi.mock('../../../userData/userDataProvider', () => ({
  useProfileData: vi.fn(() => ({
    data: {
      chats: [
        {
          chat_id: 'chat-1',
          agent: {
            workspace: '/workspace/path',
            knowledge: { knowledgeBase: '/workspace/path/knowledge' },
          },
        },
      ],
      lastUpdated: 0,
    },
  })),
}));

vi.mock('../../../auth/AuthProvider', () => ({
  useAuthContext: vi.fn(() => ({ user: { login: 'testuser' } })),
}));

// ── mock chat session hooks ────────────────────────────────────────────────
vi.mock('../../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: vi.fn(() => '20240101-session'),
  useCurrentChatId: vi.fn(() => 'chat-1'),
}));

// ── mock workspaceOps ──────────────────────────────────────────────────────
vi.mock('../../../../lib/chat/workspaceOps', () => ({
  updateChatWorkspace: vi.fn(),
  updateChatKnowledgeBase: vi.fn(),
  getWorkspaceFileTree: vi.fn(async () => ({ success: true, data: { tree: [] } })),
  getDirectoryChildren: vi.fn(async () => ({ success: true, data: { children: [] } })),
  clearFileTreeCache: vi.fn(),
  isValidWorkspacePath: (v: string) => Boolean(v),
  startWatch: vi.fn(async () => ({ success: true })),
  stopWatch: vi.fn(async () => ({ success: true })),
  copyPathToWorkspace: vi.fn(),
  copyPathsToWorkspace: vi.fn(),
  openInSystemExplorer: vi.fn(),
  workspaceOps: { onRefresh: vi.fn(() => vi.fn()) },
}));

// ── mock id utils ──────────────────────────────────────────────────────────
vi.mock('../../../../../shared/utils/idFormats', () => ({
  extractMonthFromChatSessionIdValue: (id: string) => id.slice(0, 6),
}));

// ── mock FileExplorerSection to keep rendering simple ─────────────────────
vi.mock('../FileExplorerSection', () => ({
  default: ({ title }: { title: string }) => <div data-testid={`fes-${title.replace(/\s+/g, '-')}`}>{title}</div>,
}));

vi.mock('../PasteToWorkspaceProvider', () => ({
  usePasteToWorkspace: () => ({ openPasteDialog: vi.fn() }),
}));

vi.mock('../SharePointSearchProvider', () => ({
  useSharePointSearch: () => ({ openSharePointSearch: vi.fn() }),
}));

// ── set up electronAPI ────────────────────────────────────────────────────
beforeAll(() => {
  (window as any).electronAPI = {
    workspace: { getDefaultWorkspacePath: vi.fn(async () => ({ success: true, data: '/workspace/path' })) },
  };
});

describe('WorkspaceExplorerSidepane', () => {
  it('renders both FileExplorerSection sections when visible', async () => {
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
    expect(screen.getByTestId('fes-Current-Chat-Session-Deliverables')).toBeInTheDocument();
  });

  it('returns null when not visible', async () => {
    const { WorkspaceExplorerAtom } = await import('../../chat-side.atom');
    (WorkspaceExplorerAtom.use as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { visible: false, reveal: undefined },
      { cancelReveal: mockCancelReveal },
    ]);
    const { container } = render(<WorkspaceExplorerSidepane />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the outer sidepane container class', async () => {
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(document.querySelector('.file-explorer-sidepane')).toBeInTheDocument();
  });
});
