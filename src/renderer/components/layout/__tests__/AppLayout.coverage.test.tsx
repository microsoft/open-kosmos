/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for AppLayout.tsx
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AppLayout from '../AppLayout';

// ---- mock variables ----

const mockShowToast = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const i18nState = vi.hoisted(() => {
  const enMessages: Record<string, string> = {
    'common.openFolder': 'Open Folder',
    'common.unknownError': 'Unknown error',
    'common.userNotAuthenticated': 'User not authenticated',
    'chat.files.moveFileFailedWithError': 'Failed to move file: {error}',
    'chat.files.noKnowledgeBasePathConfigured': 'No knowledge base path configured',
    'chat.files.permissionDeniedMoveToKnowledgeBase': 'Permission denied when moving file to Agent Knowledge',
    'chat.files.replaceExistingConfirm': 'File "{name}" already exists. Replace it?',
    'chat.session.downloadFailed': 'Failed to download chat session',
    'chat.session.downloadSuccess': 'Downloaded chat session to {name}',
    'chat.session.starred': 'Session starred',
    'chat.session.starUpdateFailed': 'Failed to update chat session star state',
    'chat.session.unnamed': 'Unnamed session',
    'chat.session.unstarred': 'Session unstarred',
    'debugInfo.defaultFileName': 'debug info zip',
    'debugInfo.exportFailed': 'Failed to export debug info',
    'debugInfo.exportSuccess': 'Debug info exported to {name}',
    'skills.install.apiUnavailable': 'Skill install API is not available',
    'skills.install.failed': 'Failed to install skill: {error}',
    'skills.install.success': 'Skill "{name}" installed successfully',
  };
  const zhMessages: Record<string, string> = {
    ...enMessages,
    'chat.session.downloadSuccess': 'ZH downloaded chat session to {name}',
    'debugInfo.defaultFileName': 'ZH debug info zip',
    'debugInfo.exportSuccess': 'ZH debug info exported to {name}',
  };
  const interpolate = (template: string, params?: Record<string, unknown>) =>
    template.replace(/\{(\w+)\}/g, (_match, key) => String(params?.[key] ?? ''));
  const makeTranslator = (language: 'en' | 'zh') => (key: string, params?: Record<string, unknown>) =>
    interpolate((language === 'zh' ? zhMessages : enMessages)[key] ?? key, params);
  const listeners = new Set<() => void>();
  const state = {
    language: 'en' as 'en' | 'zh',
    listeners,
    translators: {
      en: makeTranslator('en'),
      zh: makeTranslator('zh'),
    },
    setLanguage(language: 'en' | 'zh') {
      state.language = language;
      listeners.forEach((listener) => listener());
    },
  };
  return state;
});

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

const { mockUseProfileData, mockUseCurrentChatId } = vi.hoisted(() => ({
  mockUseProfileData: vi.fn((): any => ({ data: { chats: [] as any[], lastUpdated: 1 }, chats: [] as any[] })),
  mockUseCurrentChatId: vi.fn((): string | null => null),
}));

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
  useProfileData: () => mockUseProfileData(),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatId: () => mockUseCurrentChatId(),
  agentChatSessionCacheManager: mockAgentChatSessionCacheManager,
}));

vi.mock('../../../lib/userData', () => ({
  profileDataManager: mockProfileDataManager,
}));

vi.mock('../../../lib/chat/moveToKnowledgeBase', () => ({
  moveFileToKnowledgeBase: (...args: any[]) => mockMoveFileToKnowledgeBase(...args),
}));

vi.mock('../../../lib/i18n/useI18n', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react');
  return {
    useI18n: () => {
      const [, forceRender] = ReactActual.useReducer((value: number) => value + 1, 0);
      ReactActual.useEffect(() => {
        const listener = () => forceRender();
        i18nState.listeners.add(listener);
        return () => {
          i18nState.listeners.delete(listener);
        };
      }, []);
      return {
        t: i18nState.translators[i18nState.language],
      };
    },
  };
});

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

// ---- helpers ----

function setupElectronAPI() {
  i18nState.language = 'en';
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      on: vi.fn().mockReturnValue(() => {}),
      profile: {
        setChatSessionStarred: vi.fn().mockResolvedValue({ success: true }),
      },
      skills: {
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

  it('does not re-subscribe listeners when only language changes', async () => {
    let capturedDebugInfoDownloaded: (result: any) => void = () => {};
    (window.electronAPI as any).on.mockImplementation((event: string, cb: any) => {
      if (event === 'app:debugInfoDownloaded') {
        capturedDebugInfoDownloaded = cb;
      }
      return () => {};
    });
    mockUseCurrentChatId.mockReturnValue(null);
    mockUseProfileData.mockReturnValue({ data: { chats: [], lastUpdated: 1 }, chats: [] });
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');

    render(<AppLayout />);
    expect(addListenerSpy.mock.calls.filter(([event]) => event === 'chatSession:download')).toHaveLength(1);
    expect((window.electronAPI as any).on).toHaveBeenCalledTimes(1);

    addListenerSpy.mockClear();
    removeListenerSpy.mockClear();
    (window.electronAPI as any).on.mockClear();
    mockShowToast.mockClear();

    act(() => {
      i18nState.setLanguage('zh');
    });

    expect(addListenerSpy).not.toHaveBeenCalled();
    expect(removeListenerSpy).not.toHaveBeenCalled();
    expect((window.electronAPI as any).on).not.toHaveBeenCalled();

    capturedDebugInfoDownloaded({ success: true, filePath: '/tmp/debug.zip' });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('ZH debug info zip'),
      'success',
      undefined,
      expect.objectContaining({ persistent: true }),
    );

    addListenerSpy.mockRestore();
    removeListenerSpy.mockRestore();
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
      expect((window.electronAPI as any).skills.installSkillFromFilePath).toHaveBeenCalledWith(
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
    (window.electronAPI as any).skills = undefined;
    render(<AppLayout />);
    const btn = screen.getByRole('button', { name: 'Install Skill' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('not available'));
    });
  });

  it('shows error when installSkillFromFilePath fails', async () => {
    (window.electronAPI as any).skills.installSkillFromFilePath.mockResolvedValueOnce({
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
    (window.electronAPI as any).skills.installSkillFromFilePath.mockResolvedValueOnce({
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
    (window.electronAPI as any).skills.installSkillFromFilePath.mockRejectedValueOnce(
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

// ---- additional branch/function coverage ----

const DEFAULT_PROFILE_DATA = { data: { chats: [], lastUpdated: 1 }, chats: [] };

describe('AppLayout - currentKnowledgeBasePath resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mockUseCurrentChatId.mockReturnValue(null);
    mockUseProfileData.mockReturnValue(DEFAULT_PROFILE_DATA);
  });

  it('resolves the nested knowledgeBase for the current chat', () => {
    const chats = [{ chat_id: 'chat-1', agent: { knowledge: { knowledgeBase: '/kb/nested' } } }];
    mockUseCurrentChatId.mockReturnValue('chat-1');
    mockUseProfileData.mockReturnValue({ data: { chats, lastUpdated: 2 }, chats });
    render(<AppLayout />);
    expect(screen.getByTestId('kb-path')).toHaveTextContent('/kb/nested');
  });

  it('falls back to the deprecated flat knowledgeBase', () => {
    const chats = [{ chat_id: 'chat-1', agent: { knowledgeBase: '/kb/flat' } }];
    mockUseCurrentChatId.mockReturnValue('chat-1');
    mockUseProfileData.mockReturnValue({ data: { chats, lastUpdated: 3 }, chats });
    render(<AppLayout />);
    expect(screen.getByTestId('kb-path')).toHaveTextContent('/kb/flat');
  });

  it('resolves to an empty string when the agent has no knowledgeBase', () => {
    const chats = [{ chat_id: 'chat-1', agent: { name: 'A' } }];
    mockUseCurrentChatId.mockReturnValue('chat-1');
    mockUseProfileData.mockReturnValue({ data: { chats, lastUpdated: 4 }, chats });
    render(<AppLayout />);
    expect(screen.getByTestId('kb-path').textContent).toBe('');
  });
});

describe('AppLayout - move to knowledge with a configured KB path', () => {
  const chats = [{ chat_id: 'chat-1', agent: { knowledge: { knowledgeBase: '/kb' } } }];

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    window.alert = vi.fn();
    mockUseCurrentChatId.mockReturnValue('chat-1');
    mockUseProfileData.mockReturnValue({ data: { chats, lastUpdated: 5 }, chats });
  });

  const clickMove = () => fireEvent.click(screen.getByRole('button', { name: 'Move to Knowledge' }));

  it('alerts permission-denied for an EACCES failure result', async () => {
    mockMoveFileToKnowledgeBase.mockResolvedValueOnce({ success: false, error: 'EACCES: denied' });
    render(<AppLayout />);
    clickMove();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Permission denied')));
  });

  it('alerts a generic failure for a non-EACCES error result', async () => {
    mockMoveFileToKnowledgeBase.mockResolvedValueOnce({ success: false, error: 'disk full' });
    render(<AppLayout />);
    clickMove();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to move file: disk full')));
  });

  it('does not alert when the user cancelled the replacement', async () => {
    mockMoveFileToKnowledgeBase.mockResolvedValueOnce({ success: false, error: 'User cancelled replacement' });
    render(<AppLayout />);
    clickMove();
    await waitFor(() => expect(mockMoveFileToKnowledgeBase).toHaveBeenCalled());
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('alerts permission-denied when the move throws an EACCES Error', async () => {
    mockMoveFileToKnowledgeBase.mockRejectedValueOnce(new Error('EACCES boom'));
    render(<AppLayout />);
    clickMove();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Permission denied')));
  });

  it('alerts a generic failure when the move throws a non-EACCES Error', async () => {
    mockMoveFileToKnowledgeBase.mockRejectedValueOnce(new Error('kaboom'));
    render(<AppLayout />);
    clickMove();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to move file: kaboom')));
  });

  it('stringifies a non-Error thrown by the move', async () => {
    mockMoveFileToKnowledgeBase.mockRejectedValueOnce('plain string');
    render(<AppLayout />);
    clickMove();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to move file: plain string')));
  });
});

describe('AppLayout - install skill extra branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mockUseCurrentChatId.mockReturnValue(null);
    mockUseProfileData.mockReturnValue(DEFAULT_PROFILE_DATA);
  });

  it('uses the default success message when none is provided', async () => {
    (window.electronAPI as any).skills.installSkillFromFilePath.mockResolvedValueOnce({
      success: true, skillName: 'sk', resolution: 'installed',
    });
    render(<AppLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Install Skill' }));
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Skill "sk" installed successfully'));
  });

  it('dispatches the folder-explorer refresh after installing', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    (window.electronAPI as any).skills.installSkillFromFilePath.mockResolvedValueOnce({
      success: true, skillName: 'sk', message: 'ok', resolution: 'installed',
    });
    render(<AppLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Install Skill' }));
    await waitFor(
      () => expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'skills:refreshFolderExplorer' })),
      { timeout: 2000 },
    );
    dispatchSpy.mockRestore();
  });

  it('shows "Unknown error" when a non-Error is thrown during install', async () => {
    (window.electronAPI as any).skills.installSkillFromFilePath.mockRejectedValueOnce('string-crash');
    render(<AppLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Install Skill' }));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to install skill: Unknown error'));
  });
});

describe('AppLayout - delete confirm resolves the session title', () => {
  const chats = [{ chat_id: 'chat-1', chatSessions: [{ chatSession_id: 'sess-1', title: 'My Session' }] }];

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mockUseCurrentChatId.mockReturnValue(null);
    mockUseProfileData.mockReturnValue({ data: { chats, lastUpdated: 6 }, chats });
    mockAgentChatSessionCacheManager.getCurrentChatId.mockReturnValue('chat-1');
    mockAgentChatSessionCacheManager.getCurrentChatSessionId.mockReturnValue('sess-1');
  });

  it('looks up the session title from the current chat', async () => {
    render(<AppLayout />);
    window.dispatchEvent(new CustomEvent('chatSession:delete', { detail: { sessionId: 'sess-1' } }));
    await waitFor(() =>
      expect(mockDeleteConfirmActions.showChatSession).toHaveBeenCalledWith('sess-1', 'My Session', true),
    );
  });
});

describe('AppLayout - toggleStar extra branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mockUseCurrentChatId.mockReturnValue(null);
    mockUseProfileData.mockReturnValue(DEFAULT_PROFILE_DATA);
  });

  it('shows "Session unstarred" when unstarring succeeds', async () => {
    render(<AppLayout />);
    window.dispatchEvent(new CustomEvent('chatSession:toggleStar', { detail: { chatId: 'c', sessionId: 's', starred: false } }));
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Session unstarred'));
  });

  it('falls back to a default error when the star toggle fails without a message', async () => {
    (window.electronAPI as any).profile.setChatSessionStarred.mockResolvedValueOnce({ success: false });
    render(<AppLayout />);
    window.dispatchEvent(new CustomEvent('chatSession:toggleStar', { detail: { chatId: 'c', sessionId: 's', starred: true } }));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to update chat session star state'));
  });
});

describe('AppLayout - download extra branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mockUseCurrentChatId.mockReturnValue(null);
    mockUseProfileData.mockReturnValue(DEFAULT_PROFILE_DATA);
  });

  it('reveals the downloaded file from the Open Folder toast action', async () => {
    render(<AppLayout />);
    window.dispatchEvent(new CustomEvent('chatSession:download', { detail: { chatId: 'c', sessionId: 's', title: 't' } }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const call = mockShowToast.mock.calls.find((c: any[]) => c[1] === 'success');
    (call![3] as any).actions[0].onClick();
    expect((window.electronAPI as any).workspace.showInFolder).toHaveBeenCalledWith('/path/to/file.md');
  });

  it('falls back to a default error when download fails without a message', async () => {
    (window.electronAPI as any).chatSessionOps.downloadChatSession.mockResolvedValueOnce({ success: false });
    render(<AppLayout />);
    window.dispatchEvent(new CustomEvent('chatSession:download', { detail: { chatId: 'c', sessionId: 's', title: 't' } }));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to download chat session'));
  });
});

describe('AppLayout - debug info extra branches', () => {
  let captured: (result: any) => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mockUseCurrentChatId.mockReturnValue(null);
    mockUseProfileData.mockReturnValue(DEFAULT_PROFILE_DATA);
    captured = () => {};
    (window.electronAPI as any).on.mockImplementation((event: string, cb: any) => {
      if (event === 'app:debugInfoDownloaded') captured = cb;
      return () => {};
    });
  });

  it('defaults the file name and reveals the debug zip from the Open Folder action', () => {
    render(<AppLayout />);
    captured({ success: true, filePath: '/tmp/debug.zip' });
    const call = mockShowToast.mock.calls.find((c: any[]) => c[1] === 'success');
    expect(call![0]).toContain('debug info zip');
    (call![3] as any).actions[0].onClick();
    expect((window.electronAPI as any).workspace.showInFolder).toHaveBeenCalledWith('/tmp/debug.zip');
  });

  it('falls back to a default error when export fails without a message', () => {
    render(<AppLayout />);
    captured({ success: false });
    expect(mockShowError).toHaveBeenCalledWith('Failed to export debug info');
  });
});
