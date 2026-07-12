/** @vitest-environment happy-dom */

import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import WorkspaceExplorerSidepane from '../WorkspaceExplorerSidepane';
import { useProfileData } from '../../../userData/userDataProvider';
import { useAuthContext } from '../../../auth/AuthProvider';
import {
  useCurrentChatSessionId,
  useCurrentChatId,
} from '../../../../lib/chat/agentChatSessionCacheManager';
import {
  updateChatWorkspace,
  updateChatKnowledgeBase,
} from '../../../../lib/chat/workspaceOps';
import { extractMonthFromChatSessionIdValue } from '../../../../../shared/utils/idFormats';

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
  WorkspaceMenuAtom: { useChange: vi.fn(() => ({ toggle: mockOnMenuToggle })) },
}));

vi.mock('../../../userData/userDataProvider', () => ({
  useProfileData: vi.fn(),
}));

vi.mock('../../../auth/AuthProvider', () => ({
  useAuthContext: vi.fn(),
}));

vi.mock('../../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: vi.fn(),
  useCurrentChatId: vi.fn(),
}));

vi.mock('../../../../lib/chat/workspaceOps', () => ({
  updateChatWorkspace: vi.fn(async () => undefined),
  updateChatKnowledgeBase: vi.fn(async () => undefined),
}));

vi.mock('../../../../../shared/utils/idFormats', () => ({
  extractMonthFromChatSessionIdValue: vi.fn((id: string) => id.slice(0, 6)),
}));

// FileExplorerSection mock exposes onUpdatePath via a clickable button so the
// parent's update callbacks (handleUpdateWorkspacePath / KnowledgeBasePath) run.
vi.mock('../FileExplorerSection', () => ({
  default: ({ title, onUpdatePath, currentPath, defaultPath }: any) => (
    <div data-testid={`fes-${title.replace(/\s+/g, '-')}`}>
      <span data-testid={`current-${title.replace(/\s+/g, '-')}`}>{currentPath}</span>
      <span data-testid={`default-${title.replace(/\s+/g, '-')}`}>{defaultPath}</span>
      <button data-testid={`update-${title.replace(/\s+/g, '-')}`} onClick={() => onUpdatePath?.('/new/path')}>
        update
      </button>
    </div>
  ),
}));

const mockedProfile = vi.mocked(useProfileData);
const mockedAuth = vi.mocked(useAuthContext);
const mockedSessionId = vi.mocked(useCurrentChatSessionId);
const mockedChatId = vi.mocked(useCurrentChatId);
const mockedExtractMonth = vi.mocked(extractMonthFromChatSessionIdValue);

function profileWith(chats: any[]): any {
  return { data: { chats, lastUpdated: 0 } };
}

beforeAll(() => {
  (window as any).electronAPI = {
    workspace: {
      getDefaultWorkspacePath: vi.fn(async () => ({ success: true, data: '/workspace/path' })),
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedExtractMonth.mockImplementation((id: string) => id.slice(0, 6));
  mockedAuth.mockReturnValue({ user: { login: 'testuser' } } as any);
  mockedSessionId.mockReturnValue('202401-session');
  mockedChatId.mockReturnValue('chat-1');
  mockedProfile.mockReturnValue(
    profileWith([
      {
        chat_id: 'chat-1',
        agent: { workspace: '/workspace/path', knowledge: { knowledgeBase: '/workspace/path/knowledge' } },
      },
    ]),
  );
});

describe('WorkspaceExplorerSidepane extra coverage', () => {
  it('invokes update callbacks for both sections when a chat is active', async () => {
    await act(async () => {
      render(<WorkspaceExplorerSidepane />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-Agent-Knowledge-Files'));
    });
    expect(updateChatKnowledgeBase).toHaveBeenCalledWith('chat-1', '/new/path');

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-Current-Session-Deliverables'));
    });
    expect(updateChatWorkspace).toHaveBeenCalledWith('chat-1', '/new/path');
  });

  it('skips update callbacks when there is no active chat', async () => {
    mockedChatId.mockReturnValue(null as any);
    await act(async () => {
      render(<WorkspaceExplorerSidepane />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-Agent-Knowledge-Files'));
      fireEvent.click(screen.getByTestId('update-Current-Session-Deliverables'));
    });
    expect(updateChatWorkspace).not.toHaveBeenCalled();
    expect(updateChatKnowledgeBase).not.toHaveBeenCalled();
  });

  it('falls back to empty workspace/knowledge when chat is missing or fields absent', async () => {
    // currentChatId points to a chat that is not in the list -> find returns undefined
    mockedProfile.mockReturnValue(
      profileWith([{ chat_id: 'other-chat', agent: { knowledgeBase: '/legacy/kb' } }]),
    );
    await act(async () => {
      render(<WorkspaceExplorerSidepane />);
    });
    // No workspace -> session deliverables path is empty
    expect(screen.getByTestId('current-Current-Session-Deliverables').textContent).toBe('');
  });

  it('uses the legacy agent.knowledgeBase field when knowledge.knowledgeBase is absent', async () => {
    mockedProfile.mockReturnValue(
      profileWith([{ chat_id: 'chat-1', agent: { workspace: '/ws', knowledgeBase: '/legacy/kb' } }]),
    );
    await act(async () => {
      render(<WorkspaceExplorerSidepane />);
    });
    expect(screen.getByTestId('current-Agent-Knowledge-Files').textContent).toBe('/legacy/kb');
  });

  it('returns empty deliverables path when the month cannot be extracted', async () => {
    mockedExtractMonth.mockReturnValue('');
    await act(async () => {
      render(<WorkspaceExplorerSidepane />);
    });
    expect(screen.getByTestId('current-Current-Session-Deliverables').textContent).toBe('');
  });

  it('uses a backslash separator when the workspace path is Windows-style', async () => {
    mockedProfile.mockReturnValue(
      profileWith([
        {
          chat_id: 'chat-1',
          agent: { workspace: 'C:\\workspace', knowledge: { knowledgeBase: 'C:\\workspace\\knowledge' } },
        },
      ]),
    );
    mockedExtractMonth.mockReturnValue('202401');
    await act(async () => {
      render(<WorkspaceExplorerSidepane />);
    });
    expect(screen.getByTestId('current-Current-Session-Deliverables').textContent).toBe(
      'C:\\workspace\\202401\\202401-session',
    );
  });

  it('clears default paths when there is no chat or user alias', async () => {
    mockedAuth.mockReturnValue({ user: undefined } as any);
    await act(async () => {
      render(<WorkspaceExplorerSidepane />);
    });
    // getDefaultWorkspacePath must not be called without a user alias
    expect((window as any).electronAPI.workspace.getDefaultWorkspacePath).not.toHaveBeenCalled();
  });

  it('renders empty state when profile has no chats', async () => {
    mockedProfile.mockReturnValue({ data: { chats: undefined, lastUpdated: 0 } } as any);
    await act(async () => {
      render(<WorkspaceExplorerSidepane />);
    });
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });
});
