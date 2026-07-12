/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// ---- mocks ----

vi.mock('../SyncSettingsHeaderView', () => ({
  default: () => <div data-testid="sync-header">Header</div>,
}));

const mockContentProps: Record<string, unknown> = {};
vi.mock('../SyncSettingsContentView', () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(mockContentProps, props);
    return (
      <div data-testid="sync-content">
        <span data-testid="is-loading">{String(props.isLoading)}</span>
        <span data-testid="git-installed">{String(props.gitInstalled)}</span>
        <span data-testid="auto-setup">{String(props.autoSetupStatus)}</span>
        <span data-testid="repo-url">{String(props.repoUrlDraft)}</span>
      </div>
    );
  },
}));

vi.mock('../../styles/RuntimeSettings.css', () => ({}));

const mockFeatureFlag = vi.fn((flag: string) => {
  if (flag === 'openkosmosUseGit') return true;
  if (flag === 'openkosmosUseSync') return false;
  return false;
});
vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: (flag: string) => mockFeatureFlag(flag),
}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const mockGetProfile = vi.fn(() => ({ alias: 'testuser' }));
vi.mock('../../../lib/userData/profileDataManager', () => ({
  profileDataManager: {
    getProfile: () => mockGetProfile(),
  },
}));

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => <span data-testid="alert-circle" />,
}));

// ---- helpers ----

function makeSyncAPI(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getSettings: vi.fn().mockResolvedValue({ enabled: false, repoUrl: '', lastSyncTime: null }),
    getStatus: vi.fn().mockResolvedValue({ isInitialized: true, currentBranch: 'main' }),
    setEnabled: vi.fn().mockResolvedValue({ success: true }),
    setRepoUrl: vi.fn().mockResolvedValue({ success: true }),
    validateRepoUrl: vi.fn().mockResolvedValue({ success: true }),
    initialize: vi.fn().mockResolvedValue({ success: true }),
    pull: vi.fn().mockResolvedValue({ success: true }),
    push: vi.fn().mockResolvedValue({ success: true }),
    merge: vi.fn().mockResolvedValue({ success: true }),
    checkExternalKnowledgeBases: vi.fn().mockResolvedValue({ success: true, externalKnowledgeBases: [] }),
    copyKnowledgeBasesToProfile: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function makeRuntimeAPI() {
  return {
    checkGitVersion: vi.fn().mockResolvedValue({ installed: true, version: '2.40.0' }),
  };
}

function setup(syncOverrides?: Partial<Record<string, unknown>>) {
  (window as any).electronAPI = {
    runtime: makeRuntimeAPI(),
    sync: makeSyncAPI(syncOverrides),
  };
}

// ---- tests ----

import SyncSettingsView from '../SyncSettingsView';

describe('SyncSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureFlag.mockImplementation((flag: string) => {
      if (flag === 'openkosmosUseGit') return true;
      if (flag === 'openkosmosUseSync') return false;
      return false;
    });
    mockGetProfile.mockReturnValue({ alias: 'testuser' });
    setup();
  });

  it('renders header and content', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('sync-header')).toBeTruthy();
      expect(screen.getByTestId('sync-content')).toBeTruthy();
    });
  });

  it('checks git version on mount', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect((window as any).electronAPI.runtime.checkGitVersion).toHaveBeenCalled();
    });
  });

  it('sets gitInstalled=true when git is installed', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('git-installed').textContent).toBe('true');
    });
  });

  it('stops loading when git is not installed', async () => {
    (window as any).electronAPI.runtime.checkGitVersion = vi.fn().mockResolvedValue({ installed: false });
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });
  });

  it('stops early when gitEnabled is false', async () => {
    mockFeatureFlag.mockImplementation(() => false);
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });
    expect((window as any).electronAPI.runtime.checkGitVersion).not.toHaveBeenCalled();
  });

  it('loads sync settings and sets repo url draft', async () => {
    (window as any).electronAPI.sync.getSettings = vi.fn().mockResolvedValue({
      enabled: true,
      repoUrl: 'https://github.com/testuser/openkosmos-sync',
      lastSyncTime: null,
    });
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('repo-url').textContent).toBe('https://github.com/testuser/openkosmos-sync');
    });
  });

  it('does not call sync API when no alias', async () => {
    mockGetProfile.mockReturnValue({ alias: '' });
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });
    expect((window as any).electronAPI.sync.getSettings).not.toHaveBeenCalled();
  });

  it('runs auto-setup when syncEnabled=true', async () => {
    mockFeatureFlag.mockImplementation((flag: string) => {
      if (flag === 'openkosmosUseGit') return true;
      if (flag === 'openkosmosUseSync') return true;
      return false;
    });
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect((window as any).electronAPI.sync.validateRepoUrl).toHaveBeenCalled();
    });
  });

  it('sets autoSetupStatus to repo-not-found when validation fails', async () => {
    mockFeatureFlag.mockImplementation((flag: string) => {
      if (flag === 'openkosmosUseGit') return true;
      if (flag === 'openkosmosUseSync') return true;
      return false;
    });
    (window as any).electronAPI.sync.validateRepoUrl = vi.fn().mockResolvedValue({ success: false, error: 'Not found' });
    render(<SyncSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('auto-setup').textContent).toBe('repo-not-found');
    });
  });

  it('handleToggleSync calls sync.setEnabled and shows toast', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onToggleSync).toBe('function'));
    await act(async () => {
      await (mockContentProps.onToggleSync as (v: boolean) => Promise<void>)(true);
    });
    expect((window as any).electronAPI.sync.setEnabled).toHaveBeenCalledWith(true);
    expect(mockShowSuccess).toHaveBeenCalledWith('Sync enabled');
  });

  it('handleToggleSync shows error on failure', async () => {
    (window as any).electronAPI.sync.setEnabled = vi.fn().mockRejectedValue(new Error('fail'));
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onToggleSync).toBe('function'));
    await act(async () => {
      await (mockContentProps.onToggleSync as (v: boolean) => Promise<void>)(false);
    });
    expect(mockShowError).toHaveBeenCalledWith('Failed to update sync setting');
  });

  it('handleSaveRepo validates and saves repo URL', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onSaveRepo).toBe('function'));
    await act(async () => {
      await (mockContentProps.onSaveRepo as () => Promise<void>)();
    });
    expect((window as any).electronAPI.sync.validateRepoUrl).toHaveBeenCalled();
    expect((window as any).electronAPI.sync.setRepoUrl).toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalledWith('Repository validated and saved');
  });

  it('handleSaveRepo shows error when validation fails', async () => {
    (window as any).electronAPI.sync.validateRepoUrl = vi.fn().mockResolvedValue({ success: false, error: 'Bad URL' });
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onSaveRepo).toBe('function'));
    await act(async () => {
      await (mockContentProps.onSaveRepo as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Bad URL');
  });

  it('handleInitializeRepo initializes and reloads status', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onInitializeRepo).toBe('function'));
    await act(async () => {
      await (mockContentProps.onInitializeRepo as () => Promise<void>)();
    });
    expect((window as any).electronAPI.sync.initialize).toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalledWith('Repository initialized successfully');
  });

  it('handlePull calls sync.pull with force=false', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onPull).toBe('function'));
    await act(async () => {
      await (mockContentProps.onPull as (f: boolean) => Promise<void>)(false);
    });
    expect((window as any).electronAPI.sync.pull).toHaveBeenCalledWith(false);
    expect(mockShowSuccess).toHaveBeenCalledWith('Pull completed');
  });

  it('handlePull shows error on failure', async () => {
    (window as any).electronAPI.sync.pull = vi.fn().mockResolvedValue({ success: false, error: 'Pull error' });
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onPull).toBe('function'));
    await act(async () => {
      await (mockContentProps.onPull as (f: boolean) => Promise<void>)(false);
    });
    expect(mockShowError).toHaveBeenCalledWith('Pull error');
  });

  it('handlePush calls sync.push directly when no external KBs', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onPush).toBe('function'));
    await act(async () => {
      await (mockContentProps.onPush as (f: boolean, n: boolean) => Promise<void>)(false, true);
    });
    expect((window as any).electronAPI.sync.push).toHaveBeenCalledWith(false, true);
    expect(mockShowSuccess).toHaveBeenCalledWith('Push completed');
  });

  it('handlePush opens dialog when external KBs found', async () => {
    (window as any).electronAPI.sync.checkExternalKnowledgeBases = vi.fn().mockResolvedValue({
      success: true,
      externalKnowledgeBases: [{ chatId: 'c1', agentId: 'a1', agentName: 'Agent1', knowledgeBase: '/external/kb' }],
    });
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onPush).toBe('function'));
    await act(async () => {
      await (mockContentProps.onPush as (f: boolean) => Promise<void>)(false);
    });
    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('handleMerge calls merge then push', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onMerge).toBe('function'));
    await act(async () => {
      await (mockContentProps.onMerge as () => Promise<void>)();
    });
    expect((window as any).electronAPI.sync.merge).toHaveBeenCalled();
    expect((window as any).electronAPI.sync.push).toHaveBeenCalledWith(true, false);
    expect(mockShowSuccess).toHaveBeenCalledWith('Rebase completed — pushing...');
  });

  it('handleCheckStatus calls sync.getStatus and shows success', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onCheckStatus).toBe('function'));
    await act(async () => {
      await (mockContentProps.onCheckStatus as () => Promise<void>)();
    });
    expect((window as any).electronAPI.sync.getStatus).toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalledWith('Status updated');
  });

  it('handleConfirmRepoCreated validates, saves, and initializes', async () => {
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onConfirmRepoCreated).toBe('function'));
    await act(async () => {
      await (mockContentProps.onConfirmRepoCreated as () => Promise<void>)();
    });
    expect((window as any).electronAPI.sync.validateRepoUrl).toHaveBeenCalled();
    expect((window as any).electronAPI.sync.setRepoUrl).toHaveBeenCalled();
    expect((window as any).electronAPI.sync.initialize).toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalledWith('Repository connected and initialized!');
  });

  it('handleConfirmRepoCreated shows error when repo not found', async () => {
    (window as any).electronAPI.sync.validateRepoUrl = vi.fn().mockResolvedValue({ success: false });
    render(<SyncSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onConfirmRepoCreated).toBe('function'));
    await act(async () => {
      await (mockContentProps.onConfirmRepoCreated as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Repository not found. Please create it on GitHub first.');
  });

  it('handles missing sync API gracefully', async () => {
    (window as any).electronAPI.sync = undefined;
    render(<SyncSettingsView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
  });
});
