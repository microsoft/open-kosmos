// @ts-nocheck
// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { mockShowSuccess, mockShowError, mockProfileDataManager } = vi.hoisted(() => {
  const mockShowSuccess = vi.fn();
  const mockShowError = vi.fn();
  const mockProfileDataManager = {
    refresh: vi.fn(() => Promise.resolve()),
    getCache: vi.fn(() => ({ profile: { alias: 'user' }, chats: [] })),
  };
  return { mockShowSuccess, mockShowError, mockProfileDataManager };
});

vi.mock('@renderer/components/ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('@renderer/lib/userData/profileDataManager', () => ({
  profileDataManager: mockProfileDataManager,
}));

vi.mock('@renderer/lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { WithStore } from '@/atom';
import { ArchiveOverlay, ArchiveConfirmAtom } from '../ArchiveOverlay';

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function Controller({ chatId = 'agent-1', agentName = 'TestAgent' } = {}) {
  const [, actions] = ArchiveConfirmAtom.use();
  return (
    <button data-testid="open" onClick={() => actions.show(chatId, agentName)}>
      Open
    </button>
  );
}

describe('ArchiveOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      profile: {
        archiveChatConfig: vi.fn(() => Promise.resolve({ success: true })),
      },
    };
  });

  it('does not render when closed', () => {
    wrap(<ArchiveOverlay />);
    expect(screen.queryByRole('heading', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('renders confirmation dialog when shown', async () => {
    wrap(
      <>
        <Controller chatId="c1" agentName="MyAgent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });

    expect(screen.getByRole('heading', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByText('MyAgent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('closes dialog on cancel', async () => {
    wrap(
      <>
        <Controller />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });

    expect(screen.queryByRole('heading', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('closes dialog when Escape is pressed', async () => {
    wrap(
      <>
        <Controller />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    expect(screen.getByRole('heading', { name: 'Archive' })).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });

    expect(screen.queryByRole('heading', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('archives agent on confirm and shows success', async () => {
    wrap(
      <>
        <Controller chatId="agent-1" agentName="TestAgent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archive' })); });

    expect(window.electronAPI.profile.archiveChatConfig).toHaveBeenCalledWith('agent-1');
    expect(mockShowSuccess).toHaveBeenCalledWith('"TestAgent" archived successfully');
    expect(mockProfileDataManager.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('shows error when archive fails', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn(() =>
      Promise.resolve({ success: false, error: 'DB error' }),
    );

    wrap(
      <>
        <Controller chatId="agent-1" agentName="Agent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archive' })); });

    expect(mockShowError).toHaveBeenCalledWith('Failed to archive: DB error');
  });

  it('shows error when archiveChatConfig throws', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn(() =>
      Promise.reject(new Error('network')),
    );

    wrap(
      <>
        <Controller chatId="agent-1" agentName="Agent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archive' })); });

    expect(mockShowError).toHaveBeenCalledWith('Failed to archive: network');
  });

  it('shows error when archive API is not available', async () => {
    (window as any).electronAPI = { profile: {} };

    wrap(
      <>
        <Controller chatId="agent-1" agentName="Agent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archive' })); });

    expect(mockShowError).toHaveBeenCalledWith('Archive API not available');
  });

  it('does nothing when confirm is called with no chatId', async () => {
    wrap(<ArchiveOverlay />);
    expect(screen.queryByRole('heading', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('shows error with fallback message for non-Error throws', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn(() =>
      Promise.reject('string error'),
    );

    wrap(
      <>
        <Controller chatId="agent-1" agentName="Agent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archive' })); });

    expect(mockShowError).toHaveBeenCalledWith('Failed to archive: Unknown error');
  });

  it('shows error with fallback when result has no error message', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn(() =>
      Promise.resolve({ success: false }),
    );

    wrap(
      <>
        <Controller chatId="agent-1" agentName="Agent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archive' })); });

    expect(mockShowError).toHaveBeenCalledWith('Failed to archive: Unknown error');
  });

  it('disables confirm button and shows loading text during submission', async () => {
    let resolveArchive: (v: any) => void;
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn(
      () => new Promise(r => { resolveArchive = r; }),
    );

    wrap(
      <>
        <Controller chatId="agent-1" agentName="TestAgent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });

    // Click confirm — should disable and show loading text
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Archive' })); });
    await act(async () => { await Promise.resolve(); });

    const btn = screen.getByRole('button', { name: /archiving/i });
    expect(btn).toBeDisabled();

    // Resolve the pending archive
    await act(async () => { resolveArchive!({ success: true }); });
  });

  it('prevents duplicate submission on rapid double-click', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn(
      () => new Promise(r => setTimeout(() => r({ success: true }), 50)),
    );

    wrap(
      <>
        <Controller chatId="agent-1" agentName="TestAgent" />
        <ArchiveOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });

    const archiveBtn = screen.getByRole('button', { name: 'Archive' });
    await act(async () => {
      fireEvent.click(archiveBtn);
      fireEvent.click(archiveBtn);
    });

    // Wait for the archive to complete
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    expect(window.electronAPI.profile.archiveChatConfig).toHaveBeenCalledTimes(1);
  });
});
