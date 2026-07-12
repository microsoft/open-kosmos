// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFeatureFlag, mockShowSuccess, mockShowError, mockLoggerError, mockGetProfile, mockContentProps } = vi.hoisted(() => ({
  mockFeatureFlag: vi.fn((flag: string) => {
    if (flag === 'openkosmosUseGit') return true;
    if (flag === 'openkosmosUseSync') return false;
    return false;
  }),
  mockShowSuccess: vi.fn(),
  mockShowError: vi.fn(),
  mockLoggerError: vi.fn(),
  mockGetProfile: vi.fn(() => ({ alias: 'testuser' })),
  mockContentProps: {} as Record<string, unknown>,
}));

vi.mock('../SyncSettingsHeaderView', () => ({
  default: () => <div data-testid="sync-header">Header</div>,
}));

vi.mock('../SyncSettingsContentView', () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(mockContentProps, props);
    return (
      <div data-testid="sync-content">
        <span data-testid="is-loading">{String(props.isLoading)}</span>
        <span data-testid="auto-setup">{String(props.autoSetupStatus)}</span>
        <span data-testid="repo-url">{String(props.repoUrlDraft)}</span>
      </div>
    );
  },
}));

vi.mock('../../styles/RuntimeSettings.css', () => ({}));

vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: (flag: string) => mockFeatureFlag(flag),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: mockLoggerError,
    info: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: () => ({
    debug: vi.fn(),
    error: mockLoggerError,
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

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

function makeRuntimeAPI(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    checkGitVersion: vi.fn().mockResolvedValue({ installed: true, version: '2.40.0' }),
    ...overrides,
  };
}

function setup(syncOverrides?: Partial<Record<string, unknown>>, runtimeOverrides?: Partial<Record<string, unknown>>) {
  (window as any).electronAPI = {
    runtime: makeRuntimeAPI(runtimeOverrides),
    sync: makeSyncAPI(syncOverrides),
  };
}

async function renderAndWait() {
  render(<SyncSettingsView />);
  await waitFor(() => expect(screen.getByTestId('sync-content')).toBeTruthy());
  await waitFor(() => expect(typeof mockContentProps.onPush).toBe('function'));
}

import SyncSettingsView from '../SyncSettingsView';

describe('SyncSettingsView hexcov coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockContentProps).forEach(key => delete mockContentProps[key]);
    mockFeatureFlag.mockImplementation((flag: string) => {
      if (flag === 'openkosmosUseGit') return true;
      if (flag === 'openkosmosUseSync') return false;
      return false;
    });
    mockGetProfile.mockReturnValue({ alias: 'testuser' });
    setup();
  });

  it('auto-setup handles missing settings, saves the repo, and initializes when needed', async () => {
    mockFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosUseGit' || flag === 'openkosmosUseSync');
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ isInitialized: false, currentBranch: 'main' })
      .mockResolvedValueOnce({ isInitialized: true, currentBranch: 'main' });
    setup({ getSettings: vi.fn().mockResolvedValue(null), getStatus });

    render(<SyncSettingsView />);

    await waitFor(() => expect(screen.getByTestId('auto-setup').textContent).toBe('done'));
    expect((window as any).electronAPI.sync.setEnabled).toHaveBeenCalledWith(true);
    expect((window as any).electronAPI.sync.setRepoUrl).toHaveBeenCalledWith('https://github.com/testuser/openkosmos-sync');
    expect((window as any).electronAPI.sync.initialize).toHaveBeenCalled();
  });

  it('logs load failures and clears loading', async () => {
    setup(undefined, { checkGitVersion: vi.fn().mockRejectedValue(new Error('git failed')) });

    render(<SyncSettingsView />);

    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    expect(mockLoggerError).toHaveBeenCalledWith('[SyncSettingsView] Failed to load sync settings:', expect.any(Error));
  });

  it('shows save errors for failed saves and thrown saves', async () => {
    await renderAndWait();
    await act(async () => {
      (mockContentProps.onRepoUrlChange as (url: string) => void)('https://github.com/testuser/openkosmos-sync');
    });

    (window as any).electronAPI.sync.setRepoUrl = vi.fn().mockResolvedValue({ success: false, error: 'Cannot save' });
    await act(async () => {
      await (mockContentProps.onSaveRepo as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Cannot save');

    (window as any).electronAPI.sync.setRepoUrl = vi.fn().mockRejectedValue(new Error('boom'));
    await act(async () => {
      await (mockContentProps.onSaveRepo as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Failed to save repository URL');
  });

  it('shows initialize errors for failed and thrown initialize calls', async () => {
    await renderAndWait();

    (window as any).electronAPI.sync.initialize = vi.fn().mockResolvedValue({ success: false, error: 'Init failed' });
    await act(async () => {
      await (mockContentProps.onInitializeRepo as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Init failed');

    (window as any).electronAPI.sync.initialize = vi.fn().mockRejectedValue(new Error('init boom'));
    await act(async () => {
      await (mockContentProps.onInitializeRepo as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Failed to initialize repository');
  });

  it('shows pull errors for thrown pull calls', async () => {
    await renderAndWait();
    (window as any).electronAPI.sync.pull = vi.fn().mockRejectedValue(new Error('pull boom'));

    await act(async () => {
      await (mockContentProps.onPull as (force: boolean) => Promise<void>)(true);
    });

    expect(mockShowError).toHaveBeenCalledWith('Pull failed');
  });

  it('shows push errors for failed and thrown push calls', async () => {
    await renderAndWait();

    (window as any).electronAPI.sync.push = vi.fn().mockResolvedValue({ success: false, error: 'Push rejected' });
    await act(async () => {
      await (mockContentProps.onPush as (force: boolean) => Promise<void>)(true);
    });
    expect(mockShowError).toHaveBeenCalledWith('Push rejected');

    (window as any).electronAPI.sync.push = vi.fn().mockRejectedValue(new Error('push boom'));
    await act(async () => {
      await (mockContentProps.onPush as (force: boolean) => Promise<void>)(false);
    });
    expect(mockShowError).toHaveBeenCalledWith('Push failed');
  });

  it('continues push when external knowledge base checking throws', async () => {
    await renderAndWait();
    (window as any).electronAPI.sync.checkExternalKnowledgeBases = vi.fn().mockRejectedValue(new Error('check boom'));

    await act(async () => {
      await (mockContentProps.onPush as (force: boolean, needCommit?: boolean) => Promise<void>)(false, false);
    });

    expect((window as any).electronAPI.sync.push).toHaveBeenCalledWith(false, false);
  });

  it('returns from push and confirm handlers when sync API is missing', async () => {
    await renderAndWait();
    (window as any).electronAPI.sync = undefined;

    await act(async () => {
      await (mockContentProps.onPush as (force: boolean) => Promise<void>)(false);
      await (mockContentProps.onConfirmRepoCreated as () => Promise<void>)();
    });

    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('shows merge errors for failed and thrown merge calls', async () => {
    await renderAndWait();

    (window as any).electronAPI.sync.merge = vi.fn().mockResolvedValue({ success: false, error: 'Merge rejected' });
    await act(async () => {
      await (mockContentProps.onMerge as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Merge rejected');

    (window as any).electronAPI.sync.merge = vi.fn().mockRejectedValue(new Error('merge boom'));
    await act(async () => {
      await (mockContentProps.onMerge as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Merge failed');
  });

  it('copies external knowledge bases before pushing', async () => {
    setup({
      checkExternalKnowledgeBases: vi.fn().mockResolvedValue({
        success: true,
        externalKnowledgeBases: [{ chatId: 'c1', agentId: 'a1', agentName: 'Agent One', knowledgeBase: '/workspace/kb' }],
      }),
    });
    await renderAndWait();

    await act(async () => {
      await (mockContentProps.onPush as (force: boolean, needCommit?: boolean) => Promise<void>)(true, false);
    });
    expect(screen.getByText('Agent One')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Copy to Profile & Push'));
    });

    expect((window as any).electronAPI.sync.copyKnowledgeBasesToProfile).toHaveBeenCalledWith([
      { chatId: 'c1', agentId: 'a1', knowledgeBase: '/workspace/kb' },
    ]);
    expect((window as any).electronAPI.sync.push).toHaveBeenCalledWith(true, false);
    expect(mockShowSuccess).toHaveBeenCalledWith('Knowledge bases copied to profile');
  });

  it('shows copy errors when copying external knowledge bases fails or throws', async () => {
    setup({
      checkExternalKnowledgeBases: vi.fn().mockResolvedValue({
        success: true,
        externalKnowledgeBases: [{ chatId: 'c1', agentId: 'a1', agentName: 'Agent One', knowledgeBase: '/workspace/kb' }],
      }),
      copyKnowledgeBasesToProfile: vi.fn().mockResolvedValue({ success: false, error: 'Copy failed' }),
    });
    await renderAndWait();

    await act(async () => {
      await (mockContentProps.onPush as (force: boolean) => Promise<void>)(false);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Copy to Profile & Push'));
    });
    expect(mockShowError).toHaveBeenCalledWith('Copy failed');

    (window as any).electronAPI.sync.copyKnowledgeBasesToProfile = vi.fn().mockRejectedValue(new Error('copy boom'));
    await act(async () => {
      fireEvent.click(screen.getByText('Copy to Profile & Push'));
    });
    expect(mockShowError).toHaveBeenCalledWith('Failed to copy knowledge bases');
  });

  it('ignores external knowledge bases and pushes with pending options', async () => {
    setup({
      checkExternalKnowledgeBases: vi.fn().mockResolvedValue({
        success: true,
        externalKnowledgeBases: [{ chatId: 'c1', agentId: 'a1', agentName: 'Agent One', knowledgeBase: '/workspace/kb' }],
      }),
    });
    await renderAndWait();

    await act(async () => {
      await (mockContentProps.onPush as (force: boolean, needCommit?: boolean) => Promise<void>)(true, false);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Ignore & Push'));
    });

    expect((window as any).electronAPI.sync.push).toHaveBeenCalledWith(true, false);
  });

  it('shows status errors when status checking throws', async () => {
    await renderAndWait();
    (window as any).electronAPI.sync.getStatus = vi.fn().mockRejectedValue(new Error('status boom'));

    await act(async () => {
      await (mockContentProps.onCheckStatus as () => Promise<void>)();
    });

    expect(mockShowError).toHaveBeenCalledWith('Failed to check status');
  });

  it('covers successful alternate labels and default error fallbacks', async () => {
    await renderAndWait();
    await act(async () => {
      await (mockContentProps.onToggleSync as (enabled: boolean) => Promise<void>)(false);
    });
    expect(mockShowSuccess).toHaveBeenCalledWith('Sync disabled');

    await act(async () => {
      await (mockContentProps.onPull as (force: boolean) => Promise<void>)(true);
    });
    expect(mockShowSuccess).toHaveBeenCalledWith('Force pull completed');

    await act(async () => {
      (mockContentProps.onRepoUrlChange as (url: string) => void)('https://github.com/testuser/openkosmos-sync');
    });

    (window as any).electronAPI.sync.validateRepoUrl = vi.fn().mockResolvedValue({ success: false });
    await act(async () => {
      await (mockContentProps.onSaveRepo as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Repository validation failed');

    (window as any).electronAPI.sync.validateRepoUrl = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI.sync.setRepoUrl = vi.fn().mockResolvedValue({ success: false });
    await act(async () => {
      await (mockContentProps.onSaveRepo as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Failed to save repository URL');

    (window as any).electronAPI.sync.initialize = vi.fn().mockResolvedValue({ success: false });
    await act(async () => {
      await (mockContentProps.onInitializeRepo as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Failed to initialize repository');

    (window as any).electronAPI.sync.pull = vi.fn().mockResolvedValue({ success: false });
    await act(async () => {
      await (mockContentProps.onPull as (force: boolean) => Promise<void>)(false);
    });
    expect(mockShowError).toHaveBeenCalledWith('Pull failed');

    (window as any).electronAPI.sync.push = vi.fn().mockResolvedValue({ success: false });
    await act(async () => {
      await (mockContentProps.onPush as (force: boolean) => Promise<void>)(false);
    });
    expect(mockShowError).toHaveBeenCalledWith('Push failed');

    (window as any).electronAPI.sync.merge = vi.fn().mockResolvedValue({ success: false });
    await act(async () => {
      await (mockContentProps.onMerge as () => Promise<void>)();
    });
    expect(mockShowError).toHaveBeenCalledWith('Merge failed');
  });

  it('returns without side effects from handlers when sync disappears', async () => {
    await renderAndWait();
    (window as any).electronAPI.sync = undefined;

    await act(async () => {
      await (mockContentProps.onToggleSync as (enabled: boolean) => Promise<void>)(true);
      await (mockContentProps.onSaveRepo as () => Promise<void>)();
      await (mockContentProps.onInitializeRepo as () => Promise<void>)();
      await (mockContentProps.onPull as (force: boolean) => Promise<void>)(false);
      await (mockContentProps.onMerge as () => Promise<void>)();
      await (mockContentProps.onCheckStatus as () => Promise<void>)();
    });

    expect(screen.getByTestId('sync-content')).toBeTruthy();
  });

  it('covers auto-setup branches for an existing configured repo', async () => {
    mockFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosUseGit' || flag === 'openkosmosUseSync');
    setup({
      getSettings: vi.fn().mockResolvedValue({
        enabled: true,
        repoUrl: 'https://github.com/testuser/openkosmos-sync',
        lastSyncTime: null,
      }),
      getStatus: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ isInitialized: true, currentBranch: 'main' }),
    });

    render(<SyncSettingsView />);

    await waitFor(() => expect(screen.getByTestId('auto-setup').textContent).toBe('done'));
    expect((window as any).electronAPI.sync.setEnabled).not.toHaveBeenCalled();
    expect((window as any).electronAPI.sync.setRepoUrl).not.toHaveBeenCalled();
  });

  it('uses default copy error and handles missing sync from external KB dialog actions', async () => {
    setup({
      checkExternalKnowledgeBases: vi.fn().mockResolvedValue({
        success: true,
        externalKnowledgeBases: [{ chatId: 'c1', agentId: 'a1', agentName: 'Agent One', knowledgeBase: '/workspace/kb' }],
      }),
      copyKnowledgeBasesToProfile: vi.fn().mockResolvedValue({ success: false }),
    });
    await renderAndWait();

    await act(async () => {
      await (mockContentProps.onPush as (force: boolean, needCommit?: boolean) => Promise<void>)(false, true);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Copy to Profile & Push'));
    });
    expect(mockShowError).toHaveBeenCalledWith('Failed to copy knowledge bases');

    (window as any).electronAPI.sync = undefined;
    await act(async () => {
      fireEvent.click(screen.getByText('Copy to Profile & Push'));
    });
    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('runs dialog ignore when sync disappears before executePush', async () => {
    setup({
      checkExternalKnowledgeBases: vi.fn().mockResolvedValue({
        success: true,
        externalKnowledgeBases: [{ chatId: 'c1', agentId: 'a1', agentName: 'Agent One', knowledgeBase: '/workspace/kb' }],
      }),
    });
    await renderAndWait();

    await act(async () => {
      await (mockContentProps.onPush as (force: boolean, needCommit?: boolean) => Promise<void>)(false, true);
    });
    (window as any).electronAPI.sync = undefined;
    await act(async () => {
      fireEvent.click(screen.getByText('Ignore & Push'));
    });

    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('covers confirm repo created save and init fallbacks', async () => {
    await renderAndWait();
    await act(async () => {
      (mockContentProps.onRepoUrlChange as (url: string) => void)('https://github.com/testuser/openkosmos-sync');
    });

    (window as any).electronAPI.sync.setRepoUrl = vi.fn().mockResolvedValue({ success: false });
    (window as any).electronAPI.sync.initialize = vi.fn().mockResolvedValue({ success: false });
    (window as any).electronAPI.sync.getStatus = vi.fn().mockResolvedValue(null);
    await act(async () => {
      await (mockContentProps.onConfirmRepoCreated as () => Promise<void>)();
    });

    expect((window as any).electronAPI.sync.initialize).toHaveBeenCalled();
    expect(mockShowSuccess).not.toHaveBeenCalledWith('Repository connected and initialized!');
  });

});
