/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WithStore } from '@/atom';

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({
    authData: { ghcAuth: { alias: 'demo-user' } },
  }),
}));

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
  getAnchoredDropdownPosition: vi.fn().mockReturnValue({ top: 12, left: 24, triggerTop: 8, triggerRight: 120 }),
  ANCHORED_DROPDOWN_SIZE_PRESETS: {
    chatSessionMenu: { estimatedWidth: 200, estimatedHeight: 200 },
    scheduledChatSessionMenu: { estimatedWidth: 200, estimatedHeight: 200 },
  },
}));

const renderMenu = async (source: 'default' | 'schedule' = 'default') => {
  const { default: ChatSessionDropdownMenu, ChatSessionMenuAtom: chatSessionMenuAtom } = await import('../ChatSessionDropdownMenu');

  const Wrapper = () => {
    const actions = chatSessionMenuAtom.useChange();
    React.useEffect(() => {
      const btn = document.createElement('button');
      if (source === 'schedule') {
        btn.dataset.chatSessionMenuSource = 'schedule';
      }
      document.body.appendChild(btn);
      actions.toggle('chat-1', 'session-1', 'Session', btn);
      return () => { document.body.removeChild(btn); };
    }, []);
    return <ChatSessionDropdownMenu />;
  };

  const renderResult = render(<WithStore><Wrapper /></WithStore>);
  return { ...renderResult };
};

describe('ChatSessionDropdownMenu – Copy File Path', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        chatSessionOps: {
          getChatSessionFilePath: vi.fn().mockResolvedValue({
            success: true,
            filePath: '/tmp/chat-session.json',
          }),
        },
      },
    });

    Object.defineProperty(global.navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows Copy File Path in the default menu', async () => {
    await renderMenu();
    expect(screen.getByText('Copy File Path')).toBeInTheDocument();
  });

  it('hides Copy File Path in the schedule menu', async () => {
    await renderMenu('schedule');
    expect(screen.queryByText('Copy File Path')).not.toBeInTheDocument();
  });

  it('copies the chat session file path to the clipboard', async () => {
    await renderMenu();

    fireEvent.click(screen.getByText('Copy File Path'));

    await waitFor(() => {
      expect(window.electronAPI?.chatSessionOps?.getChatSessionFilePath).toHaveBeenCalledWith(
        'demo-user',
        'chat-1',
        'session-1',
      );
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/tmp/chat-session.json');
    });
  });

  it('does not copy when getChatSessionFilePath returns failure', async () => {
    (window.electronAPI!.chatSessionOps!.getChatSessionFilePath as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
    });

    await renderMenu();
    fireEvent.click(screen.getByText('Copy File Path'));

    await waitFor(() => {
      expect(window.electronAPI?.chatSessionOps?.getChatSessionFilePath).toHaveBeenCalled();
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('handles error from getChatSessionFilePath gracefully', async () => {
    (window.electronAPI!.chatSessionOps!.getChatSessionFilePath as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('IPC error'),
    );

    await renderMenu();
    fireEvent.click(screen.getByText('Copy File Path'));

    // Should not throw — the error is caught internally
    await waitFor(() => {
      expect(window.electronAPI?.chatSessionOps?.getChatSessionFilePath).toHaveBeenCalled();
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
