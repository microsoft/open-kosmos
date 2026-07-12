// @ts-nocheck
// @vitest-environment happy-dom
/**
 * Coverage tests for DuplicateAgentOverlay — the confirm (duplicate) atom flows
 * and the duplicate-name detection branch, which overlays.test.tsx does not reach.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { mockToast, mockDuplicateChatConfig, mockRefresh, mockChatsRef } = vi.hoisted(() => {
  const mockToast = {
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  };
  const mockDuplicateChatConfig = vi.fn(() => Promise.resolve({ success: true }));
  const mockRefresh = vi.fn(() => Promise.resolve());
  const mockChatsRef = { value: [] as any[] };
  return { mockToast, mockDuplicateChatConfig, mockRefresh, mockChatsRef };
});

vi.mock('@renderer/components/ui/ToastProvider', () => ({
  useToast: () => mockToast,
}));

vi.mock('@renderer/components/userData/userDataProvider', () => ({
  useProfileData: () => ({ chats: mockChatsRef.value }),
}));
vi.mock('../userData/userDataProvider', () => ({
  useProfileData: () => ({ chats: mockChatsRef.value }),
}));

vi.mock('@renderer/lib/chat/chatOps', () => ({
  chatOps: { duplicateChatConfig: mockDuplicateChatConfig },
}));

vi.mock('@renderer/lib/userData/profileDataManager', () => ({
  profileDataManager: { refresh: mockRefresh },
}));

import { WithStore } from '@/atom';
import { DuplicateAgentOverlay, DuplicateAgentAtom } from '../DuplicateAgentOverlay';

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function Controller({ chatId = 'chat-1', agentName = 'Agent' } = {}) {
  const [, actions] = DuplicateAgentAtom.use();
  return (
    <>
      <button data-testid="open" onClick={() => actions.show(chatId, agentName)}>
        Open
      </button>
      <button data-testid="set-empty" onClick={() => actions.setNewName('')}>
        Empty
      </button>
      <button data-testid="confirm-direct" onClick={() => actions.confirm(mockToast)}>
        Confirm
      </button>
    </>
  );
}

describe('DuplicateAgentOverlay — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatsRef.value = [];
    mockDuplicateChatConfig.mockResolvedValue({ success: true });
  });

  it('renders nothing when closed', () => {
    wrap(<DuplicateAgentOverlay />);
    expect(screen.queryByText('Duplicate Agent')).not.toBeInTheDocument();
  });

  it('closes on Escape (onOpenChange)', async () => {
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    expect(screen.getByText('Duplicate Agent')).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByText('Duplicate Agent')).not.toBeInTheDocument();
  });

  it('duplicates successfully and shows success (no warnings)', async () => {
    mockDuplicateChatConfig.mockResolvedValue({ success: true, data: {} });
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    });
    expect(mockDuplicateChatConfig).toHaveBeenCalledWith('chat-1', 'Agent Copy');
    expect(mockToast.showSuccess).toHaveBeenCalledWith('Agent "Agent Copy" created successfully!');
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByText('Duplicate Agent')).not.toBeInTheDocument();
  });

  it('shows a warning when knowledge/schedule copy failed', async () => {
    mockDuplicateChatConfig.mockResolvedValue({
      success: true,
      data: { knowledgeCopyFailed: true, scheduleCopyFailed: true },
    });
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    });
    expect(mockToast.showWarning).toHaveBeenCalledWith(
      'Agent "Agent Copy" created, but knowledge files and scheduled tasks could not be copied.',
    );
  });

  it('shows error when duplicate fails (with returned error)', async () => {
    mockDuplicateChatConfig.mockResolvedValue({ success: false, error: 'boom' });
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    });
    expect(mockToast.showError).toHaveBeenCalledWith('boom');
  });

  it('shows default error when duplicate fails without an error message', async () => {
    mockDuplicateChatConfig.mockResolvedValue({ success: false });
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    });
    expect(mockToast.showError).toHaveBeenCalledWith('Failed to duplicate agent');
  });

  it('shows error message when duplicate throws an Error', async () => {
    mockDuplicateChatConfig.mockRejectedValue(new Error('explode'));
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    });
    expect(mockToast.showError).toHaveBeenCalledWith('Failed to duplicate agent: explode');
  });

  it('shows generic error when duplicate throws a non-Error', async () => {
    mockDuplicateChatConfig.mockRejectedValue('weird');
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    });
    expect(mockToast.showError).toHaveBeenCalledWith('Failed to duplicate agent: Unknown error');
  });

  it('flags a duplicate name, shows the warning, and disables Duplicate', async () => {
    mockChatsRef.value = [{ agent: { name: 'My Agent Copy' } }];
    wrap(
      <>
        <Controller chatId="chat-1" agentName="My Agent" />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    expect(screen.getByText('⚠️ Agent name already exists')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled();
  });

  it('does not flag a duplicate when the trimmed name is empty', async () => {
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    });
    expect(screen.queryByText('⚠️ Agent name already exists')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled();
  });

  it('rejects confirm with an empty name (invalid data guard)', async () => {
    wrap(
      <>
        <Controller />
        <DuplicateAgentOverlay />
      </>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByTestId('set-empty')); });
    await act(async () => { fireEvent.click(screen.getByTestId('confirm-direct')); });
    expect(mockToast.showError).toHaveBeenCalledWith('Invalid agent data for duplication');
    expect(mockDuplicateChatConfig).not.toHaveBeenCalled();
    expect(screen.queryByText('Duplicate Agent')).not.toBeInTheDocument();
  });
});
