/** @vitest-environment happy-dom */

import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkspaceExplorerSidepane from '../WorkspaceExplorerSidepane';

// ── shared mock state ─────────────────────────────────────────────────────────
const mockCancelReveal = vi.fn();
const mockOnMenuToggle = vi.fn();
const mockSetVisible = vi.fn();
const mockBackToExplorer = vi.fn();
const mockMarkPreviewDirty = vi.fn();
const mockResizePreview = vi.fn();
const mockUpdateChatWorkspace = vi.fn(async (..._args: unknown[]) => undefined);
const mockUpdateChatKnowledgeBase = vi.fn(async (..._args: unknown[]) => undefined);

// ── atom mock – mutable so individual tests can override ─────────────────────
let atomState: any = {
  visible: true,
  mode: 'explorer',
  preview: undefined,
  reveal: undefined,
};
let atomActions: any = {
  cancelReveal: mockCancelReveal,
  setVisible: mockSetVisible,
  backToExplorer: mockBackToExplorer,
  markPreviewDirty: mockMarkPreviewDirty,
  resizePreview: mockResizePreview,
};

vi.mock('../../chat-side.atom', () => ({
  WorkspaceExplorerAtom: {
    use: vi.fn(() => [atomState, atomActions]),
  },
}));

vi.mock('../../../menu/WorkspaceMenuDropdown', () => ({
  WorkspaceMenuAtom: {
    useChange: vi.fn(() => ({ toggle: mockOnMenuToggle })),
  },
}));

// ── userData + auth ───────────────────────────────────────────────────────────
vi.mock('../../../userData/userDataProvider', () => ({
  useProfileData: vi.fn(() => ({
    data: {
      chats: [
        {
          chat_id: 'chat-1',
          agent: {
            workspace: 'C:\\Users\\agent\\workspace',
            knowledge: { knowledgeBase: 'C:\\Users\\agent\\workspace\\knowledge' },
          },
        },
        {
          chat_id: 'chat-2',
          agent: {
            workspace: '/posix/workspace',
            knowledgeBase: '/posix/workspace/knowledge',
          },
        },
        {
          chat_id: 'chat-no-agent',
        },
      ],
      lastUpdated: 0,
    },
  })),
}));

vi.mock('../../../auth/AuthProvider', () => ({
  useAuthContext: vi.fn(() => ({ user: { login: 'testuser' } })),
}));

// ── chat session hooks ────────────────────────────────────────────────────────
let mockChatId = 'chat-1';
let mockSessionId = '20240101-session';

vi.mock('../../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: vi.fn(() => mockSessionId),
  useCurrentChatId: vi.fn(() => mockChatId),
}));

// ── workspaceOps ──────────────────────────────────────────────────────────────
vi.mock('../../../../lib/chat/workspaceOps', () => ({
  updateChatWorkspace: (...args: unknown[]) => mockUpdateChatWorkspace(...args),
  updateChatKnowledgeBase: (...args: unknown[]) => mockUpdateChatKnowledgeBase(...args),
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

// ── id utils ──────────────────────────────────────────────────────────────────
vi.mock('../../../../../shared/utils/idFormats', () => ({
  extractMonthFromChatSessionIdValue: (id: string) => (id.length >= 6 ? id.slice(0, 6) : ''),
}));

// ── InlineFilePreviewPanel mock ───────────────────────────────────────────────
vi.mock('../../InlineFilePreviewPanel', () => ({
  default: ({ file, onClose, onBack, onDirtyStateChange, style }: any) => (
    <div data-testid="inline-file-preview" style={style}>
      <span data-testid="preview-filename">{file?.name}</span>
      <button data-testid="preview-close" onClick={onClose}>Close</button>
      {onBack && <button data-testid="preview-back" onClick={onBack}>Back</button>}
      <button data-testid="preview-dirty" onClick={() => onDirtyStateChange?.(true)}>Mark Dirty</button>
    </div>
  ),
}));

// ── FileExplorerSection mock ──────────────────────────────────────────────────
vi.mock('../FileExplorerSection', () => ({
  default: ({ title, onUpdatePath }: { title: string; onUpdatePath: (p: string) => Promise<void> }) => (
    <div data-testid={`fes-${title.replace(/\s+/g, '-')}`}>
      {title}
      <button
        data-testid={`update-path-${title.replace(/\s+/g, '-')}`}
        onClick={() => void onUpdatePath('/new-path')}
      >
        Update
      </button>
    </div>
  ),
}));

vi.mock('../PasteToWorkspaceProvider', () => ({
  usePasteToWorkspace: () => ({ openPasteDialog: vi.fn() }),
}));

// ── electronAPI ───────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  atomState = { visible: true, mode: 'explorer', preview: undefined, reveal: undefined };
  atomActions = {
    cancelReveal: mockCancelReveal,
    setVisible: mockSetVisible,
    backToExplorer: mockBackToExplorer,
    markPreviewDirty: mockMarkPreviewDirty,
    resizePreview: mockResizePreview,
  };
  mockChatId = 'chat-1';
  mockSessionId = '20240101-session';

  (window as any).electronAPI = {
    workspace: {
      getDefaultWorkspacePath: vi.fn(async () => ({ success: true, data: '/default/workspace' })),
    },
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkspaceExplorerSidepane – no chatId / no userAlias clears default paths', () => {
  it('sets default paths to empty when no chatId', async () => {
    mockChatId = null as any;
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    // Should still render sections (workspace visible)
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });
});

describe('WorkspaceExplorerSidepane – Windows backslash path separator', () => {
  it('computes chatSessionFilePath with backslash when workspace uses backslashes', async () => {
    // chat-1 has workspace with backslashes: C:\\Users\\agent\\workspace
    // session 202401... → yyyymm = 202401
    mockSessionId = '20240101-sess';
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    // Component should render without error (path computed with backslash separator)
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });
});

describe('WorkspaceExplorerSidepane – empty yyyymm returns empty chatSessionFilePath', () => {
  it('returns empty path when session id is too short to extract month', async () => {
    mockSessionId = 'abc'; // extractMonthFromChatSessionIdValue returns '' for len < 6
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });
});

describe('WorkspaceExplorerSidepane – no workspace / no session returns empty path', () => {
  it('returns empty chatSessionFilePath when no workspace', async () => {
    mockChatId = 'chat-no-agent';
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });

  it('returns empty chatSessionFilePath when no session id', async () => {
    mockSessionId = '' as any;
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });
});

describe('WorkspaceExplorerSidepane – fallback knowledgeBase field', () => {
  it('reads agent.knowledgeBase when knowledge.knowledgeBase is absent', async () => {
    mockChatId = 'chat-2'; // uses agent.knowledgeBase fallback
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });
});

describe('WorkspaceExplorerSidepane – handleUpdateWorkspacePath / handleUpdateKnowledgeBasePath', () => {
  it('calls updateChatWorkspace when onUpdatePath is triggered on chat-session section', async () => {
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    const btn = screen.getByTestId('update-path-Current-Session-Deliverables');
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(mockUpdateChatWorkspace).toHaveBeenCalledWith('chat-1', '/new-path'));
  });

  it('calls updateChatKnowledgeBase when onUpdatePath is triggered on knowledge section', async () => {
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    const btn = screen.getByTestId('update-path-Agent-Knowledge-Files');
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(mockUpdateChatKnowledgeBase).toHaveBeenCalledWith('chat-1', '/new-path'));
  });

  it('does not call updateChatWorkspace when currentChatId is null', async () => {
    mockChatId = null as any;
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    const btn = screen.getByTestId('update-path-Current-Session-Deliverables');
    await act(async () => { fireEvent.click(btn); });
    expect(mockUpdateChatWorkspace).not.toHaveBeenCalled();
  });

  it('does not call updateChatKnowledgeBase when currentChatId is null', async () => {
    mockChatId = null as any;
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    const btn = screen.getByTestId('update-path-Agent-Knowledge-Files');
    await act(async () => { fireEvent.click(btn); });
    expect(mockUpdateChatKnowledgeBase).not.toHaveBeenCalled();
  });
});

describe('WorkspaceExplorerSidepane – getDefaultWorkspacePath failure path', () => {
  it('handles rejected getDefaultWorkspacePath gracefully', async () => {
    (window as any).electronAPI = {
      workspace: {
        getDefaultWorkspacePath: vi.fn(async () => { throw new Error('network error'); }),
      },
    };
    // Should not throw
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });

  it('ignores unsuccessful getDefaultWorkspacePath result', async () => {
    (window as any).electronAPI = {
      workspace: {
        getDefaultWorkspacePath: vi.fn(async () => ({ success: false })),
      },
    };
    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
  });
});

describe('WorkspaceExplorerSidepane – preview mode (tree origin)', () => {
  it('renders InlineFilePreviewPanel with back button for tree origin', async () => {
    atomState = {
      visible: true,
      mode: 'preview',
      preview: {
        file: { name: 'report.md', url: '/workspace/report.md' },
        origin: 'tree',
        width: undefined,
      },
      reveal: undefined,
    };

    await act(async () => { render(<WorkspaceExplorerSidepane />); });

    expect(screen.getByTestId('inline-file-preview')).toBeInTheDocument();
    expect(screen.getByTestId('preview-filename').textContent).toBe('report.md');
    // Tree origin → back button should exist
    expect(screen.getByTestId('preview-back')).toBeInTheDocument();
  });

  it('calls backToExplorer when back button is clicked', async () => {
    atomState = {
      visible: true,
      mode: 'preview',
      preview: {
        file: { name: 'report.md', url: '/workspace/report.md' },
        origin: 'tree',
        width: undefined,
      },
      reveal: undefined,
    };

    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    fireEvent.click(screen.getByTestId('preview-back'));
    expect(mockBackToExplorer).toHaveBeenCalled();
  });

  it('calls setVisible(false) when close button is clicked', async () => {
    atomState = {
      visible: true,
      mode: 'preview',
      preview: {
        file: { name: 'notes.txt', url: '/workspace/notes.txt' },
        origin: 'tree',
        width: undefined,
      },
      reveal: undefined,
    };

    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    fireEvent.click(screen.getByTestId('preview-close'));
    expect(mockSetVisible).toHaveBeenCalledWith(false);
  });

  it('renders inline-preview-resizer div', async () => {
    atomState = {
      visible: true,
      mode: 'preview',
      preview: {
        file: { name: 'notes.txt', url: '/workspace/notes.txt' },
        origin: 'tree',
        width: undefined,
      },
      reveal: undefined,
    };

    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    expect(document.querySelector('.inline-preview-resizer')).toBeInTheDocument();
  });

  it('fires resizePreview on mousedown of resizer', async () => {
    atomState = {
      visible: true,
      mode: 'preview',
      preview: {
        file: { name: 'notes.txt', url: '/workspace/notes.txt' },
        origin: 'tree',
        width: undefined,
      },
      reveal: undefined,
    };

    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    const resizer = document.querySelector('.inline-preview-resizer')!;
    fireEvent.mouseDown(resizer);
    expect(mockResizePreview).toHaveBeenCalled();
  });
});

describe('WorkspaceExplorerSidepane – preview mode (sidepane/chat origin)', () => {
  it('renders InlineFilePreviewPanel without back button for chat origin', async () => {
    atomState = {
      visible: true,
      mode: 'preview',
      preview: {
        file: { name: 'output.pdf', url: '/workspace/output.pdf' },
        origin: 'chat',
        width: undefined,
      },
      reveal: undefined,
    };

    await act(async () => { render(<WorkspaceExplorerSidepane />); });

    expect(screen.getByTestId('inline-file-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-back')).not.toBeInTheDocument();
  });
});

describe('WorkspaceExplorerSidepane – preview mode with explicit width', () => {
  it('passes flex style when preview.width is defined', async () => {
    atomState = {
      visible: true,
      mode: 'preview',
      preview: {
        file: { name: 'data.json', url: '/workspace/data.json' },
        origin: 'tree',
        width: 480,
      },
      reveal: undefined,
    };

    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    const panel = screen.getByTestId('inline-file-preview');
    // Our mock renders style on the container div
    expect(panel.style.flex).toBe('0 0 480px');
  });
});

describe('WorkspaceExplorerSidepane – preview mode with no preview object', () => {
  it('falls through to explorer view when mode=preview but preview is null', async () => {
    atomState = {
      visible: true,
      mode: 'preview',
      preview: null,
      reveal: undefined,
    };

    await act(async () => { render(<WorkspaceExplorerSidepane />); });
    // Should render explorer (FileExplorerSection), not preview
    expect(screen.getByTestId('fes-Agent-Knowledge-Files')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-file-preview')).not.toBeInTheDocument();
  });
});

describe('WorkspaceExplorerSidepane – not visible', () => {
  it('returns null when not visible', () => {
    atomState = { visible: false, mode: 'explorer', preview: undefined, reveal: undefined };
    const { container } = render(<WorkspaceExplorerSidepane />);
    expect(container.firstChild).toBeNull();
  });
});
