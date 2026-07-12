// @ts-nocheck
/** @vitest-environment happy-dom */
/**
 * SyncSettingsContentView — coverage tests
 * Covers: validateRepoUrl branches, loading state, git-not-installed warning,
 * feature-flags warning, toggle sync, repo config section, sync actions, status check.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../../styles/ContentView.css', () => ({}));
vi.mock('../../styles/ToolbarSettingsView.css', () => ({}));
vi.mock('lucide-react', () => ({
  AlertCircle: () => <svg />,
  ExternalLink: () => <svg />,
  GitBranch: () => <svg />,
  ArrowDown: () => <svg />,
  ArrowUp: () => <svg />,
  GitMerge: () => <svg />,
  Loader2: () => <svg data-testid="loader" />,
}));

import SyncSettingsContentView from '../SyncSettingsContentView';
import type { SyncStatus } from '../SyncSettingsContentView';
import type { SyncSettings } from '../../../../main/lib/userDataADO/types/profile';

const defaultSettings: SyncSettings = {
  enabled: false,
  repoUrl: '',
  lastSyncTime: null,
};

const baseProps = {
  settings: defaultSettings,
  status: null as SyncStatus | null,
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
  repoUrlDraft: '',
  autoSetupStatus: 'idle' as const,
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

describe('SyncSettingsContentView', () => {
  it('shows loading indicator when isLoading is true', () => {
    render(<SyncSettingsContentView {...baseProps} isLoading={true} />);
    expect(screen.getByText('Loading sync settings...')).toBeTruthy();
  });

  it('shows Git Not Installed warning when gitInstalled is false', () => {
    render(<SyncSettingsContentView {...baseProps} gitInstalled={false} />);
    expect(screen.getByText('Git Not Installed')).toBeTruthy();
  });

  it('shows feature flag warning when git is installed but gitEnabled is false', () => {
    render(<SyncSettingsContentView {...baseProps} gitEnabled={false} />);
    expect(screen.getByText('Sync Feature Not Available')).toBeTruthy();
  });

  it('shows feature flag warning when syncEnabled is false', () => {
    render(<SyncSettingsContentView {...baseProps} syncEnabled={false} />);
    expect(screen.getByText('Sync Feature Not Available')).toBeTruthy();
  });

  it('renders the sync toggle checkbox', () => {
    render(<SyncSettingsContentView {...baseProps} />);
    expect(screen.getByText('Sync to GitHub')).toBeTruthy();
  });

  it('calls onToggleSync when checkbox is changed', () => {
    const onToggleSync = vi.fn();
    render(<SyncSettingsContentView {...baseProps} onToggleSync={onToggleSync} />);
    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);
    expect(onToggleSync).toHaveBeenCalled();
  });

  it('shows repo configuration when sync is enabled and canSync', () => {
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true }}
        repoUrlDraft="https://github.com/testuser/repo"
      />
    );
    expect(screen.getByText('GitHub Repository')).toBeTruthy();
  });

  it('shows validation error for invalid URL', () => {
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true }}
        repoUrlDraft="not-a-valid-url"
      />
    );
    expect(screen.getByText('Invalid GitHub repository URL format')).toBeTruthy();
  });

  it('accepts repository URLs for any GitHub owner', () => {
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true }}
        repoUrlDraft="https://github.com/someuser/repo"
      />
    );
    expect(screen.queryByText(/must end with/)).toBeNull();
  });

  it('shows "checking" auto-setup status message', () => {
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true }}
        repoUrlDraft="https://github.com/testuser/repo"
        autoSetupStatus="checking"
      />
    );
    expect(screen.getByText('Checking if repository exists...')).toBeTruthy();
  });

  it('shows "repo-not-found" auto-setup prompt', () => {
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true }}
        repoUrlDraft="https://github.com/testuser/repo"
        autoSetupStatus="repo-not-found"
      />
    );
    expect(screen.getByText(/Repository not found/)).toBeTruthy();
  });

  it('shows sync action buttons when repo is initialized', () => {
    const status: SyncStatus = { isInitialized: true, currentBranch: 'main', hasLocalChanges: null, hasRemoteChanges: null };
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true, repoUrl: 'https://github.com/testuser/repo' }}
        status={status}
        autoSetupStatus="done"
      />
    );
    expect(screen.getByText('Sync Actions')).toBeTruthy();
    expect(screen.getByText('Pull')).toBeTruthy();
    expect(screen.getByText('Push')).toBeTruthy();
  });

  it('calls onPull(false) when Pull is clicked', () => {
    const onPull = vi.fn();
    const status: SyncStatus = { isInitialized: true, currentBranch: 'main', hasLocalChanges: null, hasRemoteChanges: null };
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true, repoUrl: 'https://github.com/testuser/repo' }}
        status={status}
        autoSetupStatus="done"
        onPull={onPull}
      />
    );
    fireEvent.click(screen.getByText('Pull'));
    expect(onPull).toHaveBeenCalledWith(false);
  });

  it('calls onPush(true) when Force Push is clicked', () => {
    const onPush = vi.fn();
    const status: SyncStatus = { isInitialized: true, currentBranch: 'main', hasLocalChanges: null, hasRemoteChanges: null };
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true, repoUrl: 'https://github.com/testuser/repo' }}
        status={status}
        autoSetupStatus="done"
        onPush={onPush}
      />
    );
    fireEvent.click(screen.getByText('Force Push'));
    expect(onPush).toHaveBeenCalledWith(true);
  });

  it('shows Check Status and calls onCheckStatus', () => {
    const onCheckStatus = vi.fn();
    const status: SyncStatus = { isInitialized: true, currentBranch: 'main', hasLocalChanges: null, hasRemoteChanges: null };
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true, repoUrl: 'https://github.com/testuser/repo' }}
        status={status}
        autoSetupStatus="done"
        onCheckStatus={onCheckStatus}
      />
    );
    const buttons = screen.getAllByText('Check Status');
    const btn = buttons.find(el => el.tagName === 'BUTTON') ?? buttons[1];
    fireEvent.click(btn);
    expect(onCheckStatus).toHaveBeenCalled();
  });

  it('shows branch name in sync actions', () => {
    const status: SyncStatus = { isInitialized: true, currentBranch: 'feature-branch', hasLocalChanges: null, hasRemoteChanges: null };
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true, repoUrl: 'https://github.com/testuser/repo' }}
        status={status}
        autoSetupStatus="done"
      />
    );
    expect(screen.getByText('feature-branch')).toBeTruthy();
  });

  it('shows local/remote change indicators', () => {
    const status: SyncStatus = { isInitialized: true, currentBranch: 'main', hasLocalChanges: true, hasRemoteChanges: true };
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true, repoUrl: 'https://github.com/testuser/repo' }}
        status={status}
        autoSetupStatus="done"
      />
    );
    expect(screen.getByText('Local changes pending')).toBeTruthy();
    expect(screen.getByText('Remote changes available')).toBeTruthy();
  });

  it('shows last sync time when available', () => {
    const ts = new Date('2024-01-15T10:00:00Z').getTime();
    const status: SyncStatus = { isInitialized: true, currentBranch: 'main', hasLocalChanges: null, hasRemoteChanges: null };
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true, repoUrl: 'https://github.com/testuser/repo', lastSyncTime: ts }}
        status={status}
        autoSetupStatus="done"
      />
    );
    expect(screen.getByText(/Last synced:/)).toBeTruthy();
  });

  it('shows Checking... when isCheckingStatus', () => {
    const status: SyncStatus = { isInitialized: true, currentBranch: 'main', hasLocalChanges: null, hasRemoteChanges: null };
    render(
      <SyncSettingsContentView
        {...baseProps}
        settings={{ ...defaultSettings, enabled: true, repoUrl: 'https://github.com/testuser/repo' }}
        status={status}
        autoSetupStatus="done"
        isCheckingStatus={true}
      />
    );
    expect(screen.getByText('Checking...')).toBeTruthy();
  });
});
