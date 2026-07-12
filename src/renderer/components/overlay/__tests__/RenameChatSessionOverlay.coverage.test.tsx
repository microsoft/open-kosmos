// @ts-nocheck
// @vitest-environment happy-dom
/**
 * Coverage tests for RenameChatSessionOverlay — the confirm (rename) atom flows
 * (success, failure, no-alias, throw) and Escape, which overlays.test.tsx omits.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { mockToast, mockGetCache } = vi.hoisted(() => {
  const mockToast = {
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  };
  const mockGetCache = vi.fn(() => ({ profile: { alias: 'user' } }));
  return { mockToast, mockGetCache };
});

vi.mock('@renderer/components/ui/ToastProvider', () => ({
  useToast: () => mockToast,
}));

vi.mock('@renderer/lib/userData/profileDataManager', () => ({
  profileDataManager: { getCache: mockGetCache },
}));

import { WithStore } from '@/atom';
import { RenameChatSessionOverlay, RenameChatSessionAtom } from '../RenameChatSessionOverlay';

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function Controller({ chatId = 'chat-1', sessionId = 'session-1', title = 'Old Name' } = {}) {
  const [, actions] = RenameChatSessionAtom.use();
  return (
    <button data-testid="open" onClick={() => actions.show(chatId, sessionId, title)}>
      Open
    </button>
  );
}

describe('RenameChatSessionOverlay — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCache.mockReturnValue({ profile: { alias: 'user' } });
    (window as any).electronAPI = {
      profile: {
        renameChatSession: vi.fn(() => Promise.resolve({ success: true })),
      },
    };
  });

  it('renames successfully and shows success (Rename button)', async () => {
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Title' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    });
    expect(window.electronAPI.profile.renameChatSession).toHaveBeenCalledWith(
      'user',
      'chat-1',
      'session-1',
      'New Title',
    );
    expect(mockToast.showSuccess).toHaveBeenCalledWith('Chat session renamed successfully');
    expect(screen.queryByText('Rename Chat Session')).not.toBeInTheDocument();
  });

  it('shows error when the rename API reports failure', async () => {
    (window as any).electronAPI.profile.renameChatSession = vi.fn(() =>
      Promise.resolve({ success: false, error: 'nope' }),
    );
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    });
    expect(mockToast.showError).toHaveBeenCalledWith('nope');
  });

  it('shows a default error when failure has no error message', async () => {
    (window as any).electronAPI.profile.renameChatSession = vi.fn(() =>
      Promise.resolve({ success: false }),
    );
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    });
    expect(mockToast.showError).toHaveBeenCalledWith('Failed to rename chat session');
  });

  it('shows error when the user is not authenticated (no alias)', async () => {
    mockGetCache.mockReturnValue({ profile: {} });
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    });
    expect(mockToast.showError).toHaveBeenCalledWith('User not authenticated');
    expect(window.electronAPI.profile.renameChatSession).not.toHaveBeenCalled();
  });

  it('shows error when the rename API throws', async () => {
    (window as any).electronAPI.profile.renameChatSession = vi.fn(() =>
      Promise.reject(new Error('boom')),
    );
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    });
    expect(mockToast.showError).toHaveBeenCalledWith('Failed to rename chat session');
  });

  it('confirms via the Enter key', async () => {
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    const input = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(mockToast.showSuccess).toHaveBeenCalled();
  });

  it('does not confirm on Enter when the title is blank', async () => {
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    const input = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(window.electronAPI.profile.renameChatSession).not.toHaveBeenCalled();
  });

  it('closes via Escape (onOpenChange)', async () => {
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    expect(screen.getByText('Rename Chat Session')).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByText('Rename Chat Session')).not.toBeInTheDocument();
  });

  it('closes on Cancel', async () => {
    wrap(
      <>
        <Controller />
        <RenameChatSessionOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByText('Rename Chat Session')).not.toBeInTheDocument();
  });
});
