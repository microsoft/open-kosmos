/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for AppLayout.tsx
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AppLayout from '../AppLayout';

// ---- mock variables ----

const mockShowToast = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

const { mockDeleteConfirmActions } = vi.hoisted(() => ({
  mockDeleteConfirmActions: {
    showChatSession: vi.fn(),
  },
}));

const { mockRenameChatSessionActions } = vi.hoisted(() => ({
  mockRenameChatSessionActions: {
    show: vi.fn(),
  },
}));

const { mockInstallSkillActions } = vi.hoisted(() => ({
  mockInstallSkillActions: {
    setSkill: vi.fn(),
  },
}));

const { mockProfileDataManager } = vi.hoisted(() => ({
  mockProfileDataManager: {
    getCache: vi.fn().mockReturnValue({
      profile: { alias: 'test-user' },
    }),
  },
}));

const { mockAgentChatSessionCacheManager } = vi.hoisted(() => ({
  mockAgentChatSessionCacheManager: {
    getCurrentChatSessionId: vi.fn().mockReturnValue(null),
    getCurrentChatId: vi.fn().mockReturnValue(null),
  },
}));

const mockMoveFileToKnowledgeBase = vi.fn().mockResolvedValue({ success: true });

// ---- vi.mock calls (paths relative to __tests__ dir) ----

vi.mock('../../../styles/DropdownMenu.css', () => ({}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showToast: mockShowToast,
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({
    data: { chats: [], lastUpdated: Date.now() },
    chats: [],
  }),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatId: () => null,
  agentChatSessionCacheManager: mockAgentChatSessionCacheManager,
}));

vi.mock('../../../lib/userData', () => ({
  profileDataManager: mockProfileDataManager,
}));

vi.mock('../../../lib/chat/moveToKnowledgeBase', () => ({
  moveFileToKnowledgeBase: (...args: any[]) => mockMoveFileToKnowledgeBase(...args),
}));

vi.mock('../../overlay/DeleteOverlay', () => ({
  DeleteConfirmAtom: {
    useChange: () => mockDeleteConfirmActions,
  },
}));

vi.mock('../../overlay/RenameChatSessionOverlay', () => ({
  RenameChatSessionAtom: {
    useChange: () => mockRenameChatSessionActions,
  },
}));

vi.mock('../../skills/ApplySkillToAgentsDialog', () => ({
  ApplySkillDialogAtom: {
    useChange: () => mockInstallSkillActions,
  },
}));

vi.mock('../../overlay/ModifyMsgConfimOverlay', () => ({
  default: () => <div data-testid="modify-message-confirm" />,
}));

vi.mock('../LayoutProvider', () => ({
  LayoutProvider: ({ children }: any) => <div data-testid="layout-provider">{children}</div>,
}));

vi.mock('../AppLayoutContent', () => ({
  AppLayoutContent: ({ handleFileTreeNodeInstallSkill, handleFileTreeNodeMoveToKnowledge, currentKnowledgeBasePath }: any) => (
    <div data-testid="app-layout-content">
      <button onClick={() => handleFileTreeNodeMoveToKnowledge('/some/file.txt')}>Move to Knowledge</button>
      <button onClick={() => handleFileTreeNodeInstallSkill('/some/skill.ts')}>Install Skill</button>
      <span data-testid="kb-path">{currentKnowledgeBasePath}</span>
    </div>
  ),
}));

vi.mock('../../chat/workspace/PasteToWorkspaceProvider', () => ({
  PasteToWorkspaceProvider: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../../chat/workspace/SharePointSearchProvider', () => ({
  SharePointSearchProvider: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../../chat/workspace/TeamsChatSelectorProvider', () => ({
  TeamsChatSelectorProvider: ({ children }: any) => <div>{children}</div>,
}));

// ---- helpers ----

function setupElectronAPI() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      on: vi.fn().mockReturnValue(() => {}),
      profile: {
        setChatSessionStarred: vi.fn().mockResolvedValue({ success: true }),
      },
      skillLibrary: {
        installSkillFromFilePath: vi.fn().mockResolvedValue({
          success: true,
          skillName: 'my-skill',
          message: 'Installed',
          resolution: 'installed',
        }),
      },
      chatSessionOps: {
        downloadChatSession: vi.fn().mockResolvedValue({
          success: true,
          filePath: '/path/to/file.md',
          fileName: 'session.md',
        }),
      },
      workspace: {
        showInFolder: vi.fn(),
      },
    },
  });
}

// ---- tests ----

describe('AppLayout - rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('renders layout providers and content', () => {
    render(<AppLayout />);
    expect(screen.getByTestId('layout-provider')).toBeInTheDocument();
    expect(screen.getByTestId('app-layout-content')).toBeInTheDocument();
    expect(screen.getByTestId('modify-message-confirm')).toBeInTheDocument();
  });

  it('passes currentKnowledgeBasePath to AppLayoutContent', () => {
    render(<AppLayout />);
    expect(screen.getByTestId('kb-path')).toHaveTextContent('');
  });
});

describe('AppLayout - chatSession:delete event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('calls deleteConfirmActions.showChatSession on chatSession:delete event', async () => {
    render(<AppLayout />);
    window.dispatchEvent(
      new CustomEvent('chatSession:delete', { detail: { sessionId: 'sess-1' } })
    );
    await waitFor(() => {
      expect(mockDeleteConfirmActions.showChatSession).toHaveBeenCalledWith(
        'sess-1',
        expect.any(String),
        expect.any(Boolean),
      );
    });
  });
});

describe('AppLayout - chatSession:rename event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('calls renameChatSessionActions.show on chatSession:rename event', async () => {
    render(<AppLayout />);
    window.dispatchEvent(
      new CustomEvent('chatSession:rename', {
        detail: { chatId: 'chat-1', sessionId: 'sess-1', title: 'My Session' },
      })
    );
    await waitFor(() => {
      expect(mockRenameChatSessionActions.show).toHaveBeenCalledWith('chat-1', 'sess-1', 'My Session');
    });
  });
});

describe('AppLayout - chatSession:toggleStar event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('calls setChatSessionStarred on chatSession:toggleStar event', async () => {
    render(<AppLayout />);
    window.dispatchEvent(
      new CustomEvent('chatSession:toggleStar', {
        detail: { chatId: 'chat-1', sessionId: 'sess-1', starred: true },
      })
    );
    await waitFor(() => {
      expect((window.electronAPI as any).profile.setChatSessionStarred).toHaveBeenCalledWith(
        'test-user',
        'chat-1',
        'sess-1',
        true,
      );
    });
  });

  it('shows error when user not authenticated for star toggle', async () => {
    mockProfileDataManager.getCache.mockReturnValueOnce({ profile: { alias: null } });
    render(<AppLayout />);
    window.dispatchEvent(
      new CustomEvent('chatSession:toggleStar', {
        detail: { chatId: 'chat-1', sessionId: 'sess-1', starred: true },
      })
    );
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('User not authenticated');
    });
  });

  it('shows error when setChatSessionStarred fails', async () => {
    (window.electronAPI as any).profile.setChatSessionStarred.mockResolvedValueOnce({
      success: false,
      error: 'Star failed',
    });
    render(<AppLayout />);
    window.dispatchEvent(
      new CustomEvent('chatSession:toggleStar', {
        detail: { chatId: 'chat-1', sessionId: 'sess-1', starred: false },
      })
    );
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Star failed');
    });
  });
});

describe('AppLayout - chatSession:download event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('shows success toast with Open Folder action on successful download', async () => {
    render(<AppLayout />);
    window.dispatchEvent(
      new CustomEvent('chatSession:download', {
        detail: { chatId: 'chat-1', sessionId: 'sess-1', title: 'My Chat' },
      })
    );
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('session.md'),
        'success',
        undefined,
        expect.objectContaining({ persistent: true }),
      );
    });
  });

  it('shows error toast when download fails', async () => {
    (window.electronAPI as any).chatSessionOps.downloadChatSession.mockResolvedValueOnce({
      success: false,
      error: 'Download error',
    });
    render(<AppLayout />);
    window.dispatchEvent(
      new CustomEvent('chatSession:download', {
        detail: { chatId: 'chat-1', sessionId: 'sess-1', title: 'My Chat' },
      })
    );
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Download error');
    });
  });

  it('shows error when user not authenticated for download', async () => {
    mockProfileDataManager.getCache.mockReturnValueOnce({ profile: { alias: null } });
    render(<AppLayout />);
    window.dispatchEvent(
      new CustomEvent('chatSession:download', {
        detail: { chatId: 'chat-1', sessionId: 'sess-1', title: 'My Chat' },
      })
    );
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('User not authenticated');
    });
  });
});

describe('AppLayout - app:debugInfoDownloaded event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('registers app:debugInfoDownloaded handler via electronAPI.on', () => {
    render(<AppLayout />);
    expect((window.electronAPI as any).on).toHaveBeenCalledWith(
      'app:debugInfoDownloaded',
      expect.any(Function),
    );
  });

  it('shows success toast when debug info downloaded', () => {
    let capturedCallback: (result: any) => void = () => {};
    (window.electronAPI as any).on.mockImplementation((event: string, cb: any) => {
      if (event === 'app:debugInfoDownloaded') {
        capturedCallback = cb;
      }
      return () => {};
    });

    render(<AppLayout />);
    capturedCallback({ success: true, filePath: '/path/debug.zip', fileName: 'debug.zip' });

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('debug.zip'),
      'success',
      undefined,
      expect.objectContaining({ persistent: true }),
    );
  });

  it('shows error when debug info download fails', () => {
    let capturedCallback: (result: any) => void = () => {};
    (window.electronAPI as any).on.mockImplementation((event: string, cb: any) => {
      if (event === 'app:debugInfoDownloaded') {
        capturedCallback = cb;
      }
      return () => {};
    });

    render(<AppLayout />);
    capturedCallback({ success: false, error: 'Export failed' });

    expect(mockShowError).toHaveBeenCalledWith('Export failed');
  });
});

describe('AppLayout - handleFileTreeNodeMoveToKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('shows alert when no knowledge base path configured', async () => {
    const alertMock = vi.fn();
    window.alert = alertMock;
    render(<AppLayout />);
    const btn = screen.getByRole('button', { name: 'Move to Knowledge' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('No knowledge base path'));
    });
  });

  it('does not call moveFileToKnowledgeBase when no KB path set', () => {
    render(<AppLayout />);
    expect(mockMoveFileToKnowledgeBase).not.toHaveBeenCalled();
  });
});

describe('AppLayout - handleFileTreeNodeInstallSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('calls installSkillFromFilePath when Install Skill clicked', async () => {
    render(<AppLayout />);
    const btn = screen.getByRole('button', { name: 'Install Skill' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect((window.electronAPI as any).skillLibrary.installSkillFromFilePath).toHaveBeenCalledWith(
        '/some/skill.ts',
        expect.any(Object),
      );
    });
  });

  it('shows success toast after skill install', async () => {
    render(<AppLayout />);
    const btn = screen.getByRole('button', { name: 'Install Skill' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith('Installed');
    });
  });

  it('shows error when installSkillFromFilePath not available', async () => {
    (window.electronAPI as any).skillLibrary = undefined;
    render(<AppLayout />);
    const btn = screen.getByRole('button', { name: 'Install Skill' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('not available'));
    });
  });

  it('shows error when installSkillFromFilePath fails', async () => {
    (window.electronAPI as any).skillLibrary.installSkillFromFilePath.mockResolvedValueOnce({
      success: false,
      error: 'Install failed',
    });
    render(<AppLayout />);
    const btn = screen.getByRole('button', { name: 'Install Skill' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Install failed', 'error', undefined, expect.objectContaining({ persistent: true }));
    });
  });

  it('shows ApplySkillDialog when resolution is installed_but_needs_target_selection', async () => {
    (window.electronAPI as any).skillLibrary.installSkillFromFilePath.mockResolvedValueOnce({
      success: true,
      skillName: 'target-skill',
      message: 'Installed',
      resolution: 'installed_but_needs_target_selection',
    });
    render(<AppLayout />);
    const btn = screen.getByRole('button', { name: 'Install Skill' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockInstallSkillActions.setSkill).toHaveBeenCalledWith('target-skill');
    });
  });

  it('shows error when installSkillFromFilePath throws', async () => {
    (window.electronAPI as any).skillLibrary.installSkillFromFilePath.mockRejectedValueOnce(
      new Error('Crash')
    );
    render(<AppLayout />);
    const btn = screen.getByRole('button', { name: 'Install Skill' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Crash'));
    });
  });
});
