// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
vi.mock('../../styles/ContentView.css', () => ({}));
vi.mock('../../styles/ToolbarSettingsView.css', () => ({}));
vi.mock('lucide-react', () => ({
  AlertCircle: () => <svg data-testid="alert-icon" />,
  ExternalLink: () => <svg data-testid="external-link" />,
  GitBranch: () => <svg data-testid="git-branch" />,
  ArrowDown: () => <svg data-testid="arrow-down" />,
  ArrowUp: () => <svg data-testid="arrow-up" />,
  GitMerge: () => <svg data-testid="git-merge" />,
  Loader2: () => <svg data-testid="loader" />,
}));

import SyncSettingsContentView from '../SyncSettingsContentView';
import type { SyncStatus } from '../SyncSettingsContentView';

const settings = {
  enabled: true,
  repoUrl: 'https://github.com/testuser/openkosmos-sync',
  lastSyncTime: null,
};

const initializedStatus: SyncStatus = {
  isInitialized: true,
  currentBranch: 'main',
  hasLocalChanges: false,
  hasRemoteChanges: false,
};

const baseProps = {
  settings,
  status: initializedStatus,
  gitInstalled: true,
  gitEnabled: true,
  syncEnabled: true,
  userAlias: 'testuser',
  isLoading: false,
  isPulling: false,
  isPushing: false,
  isMerging: false,
  isCheckingStatus: false,
  isValidating: false,
  repoUrlDraft: 'https://github.com/testuser/openkosmos-sync',
  autoSetupStatus: 'done' as const,
  onToggleSync: vi.fn(),
  onRepoUrlChange: vi.fn(),
  onSaveRepo: vi.fn(),
  onPull: vi.fn(),
  onPush: vi.fn(),
  onMerge: vi.fn(),
  onInitializeRepo: vi.fn(),
  onCheckStatus: vi.fn(),
  onConfirmRepoCreated: vi.fn(),
};

describe('SyncSettingsContentView hexcov coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to runtime settings from the git missing warning', () => {
    render(<SyncSettingsContentView {...baseProps} gitInstalled={false} />);

    fireEvent.click(screen.getByText('Go to Runtime Settings'));

    expect(mockNavigate).toHaveBeenCalledWith('/settings/runtime');
  });

  it('propagates repository URL edits and enables save for changed valid URLs', () => {
    const onRepoUrlChange = vi.fn();
    const onSaveRepo = vi.fn();
    render(
      <SyncSettingsContentView
        {...baseProps}
        repoUrlDraft="https://github.com/testuser/other-sync"
        onRepoUrlChange={onRepoUrlChange}
        onSaveRepo={onSaveRepo}
      />
    );

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'git@github.com:testuser/other-sync.git' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(onRepoUrlChange).toHaveBeenCalledWith('git@github.com:testuser/other-sync.git');
    expect(onSaveRepo).toHaveBeenCalledTimes(1);
  });

  it('runs every sync action button handler and renders idle status chips', () => {
    const onPull = vi.fn();
    const onPush = vi.fn();
    const onMerge = vi.fn();
    render(
      <SyncSettingsContentView
        {...baseProps}
        status={initializedStatus}
        onPull={onPull}
        onPush={onPush}
        onMerge={onMerge}
      />
    );

    fireEvent.click(screen.getByText('Pull'));
    fireEvent.click(screen.getByText('Force Pull'));
    fireEvent.click(screen.getByText('Push'));
    fireEvent.click(screen.getByText('Force Push'));
    fireEvent.click(screen.getAllByText('Merge & Push').find(el => el.tagName === 'BUTTON'));

    expect(onPull).toHaveBeenNthCalledWith(1, false);
    expect(onPull).toHaveBeenNthCalledWith(2, true);
    expect(onPush).toHaveBeenNthCalledWith(1, false);
    expect(onPush).toHaveBeenNthCalledWith(2, true);
    expect(onMerge).toHaveBeenCalledTimes(1);
  });

  it('shows initialization and busy labels without firing disabled actions', () => {
    const onInitializeRepo = vi.fn();
    const onPull = vi.fn();
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...settings, repoUrl: 'https://github.com/testuser/openkosmos-sync' }}
        status={{ ...initializedStatus, isInitialized: false }}
        isLoading={true}
        onInitializeRepo={onInitializeRepo}
        onPull={onPull}
      />
    );

    const initializeButton = screen.getByText('Initialize');
    fireEvent.click(initializeButton);

    expect(initializeButton).toBeDisabled();
    expect(onInitializeRepo).not.toHaveBeenCalled();
    expect(screen.queryByText('Pull')).toBeNull();
  });

  it('renders validating and in-progress action states', () => {
    render(
      <SyncSettingsContentView
        {...baseProps}
        repoUrlDraft="https://github.com/testuser/other-sync"
        isValidating={true}
        isPulling={true}
        isPushing={true}
        isMerging={true}
      />
    );

    expect(screen.getByText('Validating...')).toBeDisabled();
    expect(screen.getByText('Pulling...')).toBeDisabled();
    expect(screen.getByText('Pushing...')).toBeDisabled();
    expect(screen.getByText('Merging...')).toBeDisabled();
  });

  it('covers mixed local and remote status chip branches', () => {
    const { unmount } = render(
      <SyncSettingsContentView
        {...baseProps}
        status={{ ...initializedStatus, hasLocalChanges: true, hasRemoteChanges: false }}
      />
    );
    expect(screen.getByText('Local changes pending')).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();

    unmount();
    render(
      <SyncSettingsContentView
        {...baseProps}
        status={{ ...initializedStatus, hasLocalChanges: false, hasRemoteChanges: true }}
      />
    );
    expect(screen.getByText('No local changes')).toBeTruthy();
    expect(screen.getByText('Remote changes available')).toBeTruthy();
  });

});
