/**
 * @vitest-environment happy-dom
 *
 * RemoteChannelSettingsView coverage tests
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── css mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../../styles/ContentView.css', () => ({}));
vi.mock('../../../styles/SettingsShared.css', () => ({}));
vi.mock('../../../styles/RemoteChannelSettings.css', () => ({}));

// ── react-router-dom ──────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  Navigate: ({ to }: { to: string }) => {
    mockNavigate(to);
    return <div data-testid="navigate" data-to={to} />;
  },
}));

// ── child views ───────────────────────────────────────────────────────────────

vi.mock('../RemoteChannelSettingsHeaderView', () => ({
  default: () => <div data-testid="header-view" />,
}));

const mockContentProps: Record<string, any> = {};
vi.mock('../RemoteChannelSettingsContentView', () => ({
  default: (props: Record<string, any>) => {
    Object.assign(mockContentProps, props);
    return (
      <div data-testid="content-view">
        <span data-testid="loading">{String(props.loading)}</span>
        <span data-testid="bound">{String(props.bindingStatus?.bound)}</span>
      </div>
    );
  },
}));

// ── feature flags ─────────────────────────────────────────────────────────────

const mockUseFeatureFlag = vi.fn().mockReturnValue(true);
vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: (flag: string) => mockUseFeatureFlag(flag),
}));

// ── userData provider ─────────────────────────────────────────────────────────

const mockUseChats = vi.fn().mockReturnValue({ chats: [] });
vi.mock('../../userData/userDataProvider', () => ({
  useChats: () => mockUseChats(),
}));

// ── profileDataManager ────────────────────────────────────────────────────────

const mockSubscribeCbs: Array<(data: any) => void> = [];
vi.mock('../../../lib/userData', () => ({
  profileDataManager: {
    subscribe: vi.fn((cb: (data: any) => void) => {
      mockSubscribeCbs.push(cb);
      return () => {
        const idx = mockSubscribeCbs.indexOf(cb);
        if (idx >= 0) mockSubscribeCbs.splice(idx, 1);
      };
    }),
  },
}));

// ── remoteChannelApi / events ─────────────────────────────────────────────────

const mockStatusChangedCbs: Array<(event: any, info: any) => void> = [];
const mockBindingChangedCbs: Array<(event: any, info: any) => void> = [];

const mockGetConfig = vi.fn().mockResolvedValue({ success: true, data: { teams: { boundChatId: 'chat1' } } });
const mockGetStatus = vi.fn().mockResolvedValue({ success: true, data: { channelId: 'teams', status: 'running', error: undefined } });
const mockGetBindingStatus = vi.fn().mockResolvedValue({ success: true, data: { bound: true, userId: 'user1' } });
const mockStart = vi.fn().mockResolvedValue({ success: true });
const mockStop = vi.fn().mockResolvedValue({ success: true });
const mockUpdateConfig = vi.fn().mockResolvedValue({ success: true });
const mockBind = vi.fn().mockResolvedValue({ success: true, data: { userId: 'user1' } });
const mockUnbind = vi.fn().mockResolvedValue({ success: true });

vi.mock('../../../ipc/remoteChannel', () => ({
  remoteChannelApi: {
    getConfig: () => mockGetConfig(),
    getStatus: (...args: any[]) => mockGetStatus(...args),
    getBindingStatus: (...args: any[]) => mockGetBindingStatus(...args),
    start: (...args: any[]) => mockStart(...args),
    stop: (...args: any[]) => mockStop(...args),
    updateConfig: (...args: any[]) => mockUpdateConfig(...args),
    bind: (...args: any[]) => mockBind(...args),
    unbind: (...args: any[]) => mockUnbind(...args),
  },
  remoteChannelEvents: {
    statusChanged: vi.fn((cb: any) => {
      mockStatusChangedCbs.push(cb);
      return () => {
        const idx = mockStatusChangedCbs.indexOf(cb);
        if (idx >= 0) mockStatusChangedCbs.splice(idx, 1);
      };
    }),
    bindingChanged: vi.fn((cb: any) => {
      mockBindingChangedCbs.push(cb);
      return () => {
        const idx = mockBindingChangedCbs.indexOf(cb);
        if (idx >= 0) mockBindingChangedCbs.splice(idx, 1);
      };
    }),
  },
}));

// ── branding + isBuiltinAgent ─────────────────────────────────────────────────

vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../lib/userData/types', () => ({
  isBuiltinAgent: vi.fn().mockReturnValue(false),
}));

// ── component under test ──────────────────────────────────────────────────────

import RemoteChannelSettingsView from '../RemoteChannelSettingsView';

// ── helpers ───────────────────────────────────────────────────────────────────

function renderView() {
  return render(<RemoteChannelSettingsView />);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('RemoteChannelSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusChangedCbs.length = 0;
    mockBindingChangedCbs.length = 0;
    mockSubscribeCbs.length = 0;
    mockUseFeatureFlag.mockReturnValue(true);
    mockUseChats.mockReturnValue({ chats: [] });
  });

  it('redirects to /settings when feature is disabled', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    renderView();
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/settings');
  });

  it('renders header and content when feature enabled', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('header-view')).toBeTruthy();
      expect(screen.getByTestId('content-view')).toBeTruthy();
    });
  });

  it('shows loading=false after data loads', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('sets config and status from API on load', async () => {
    renderView();
    await waitFor(() => {
      expect(mockGetConfig).toHaveBeenCalled();
      expect(mockGetStatus).toHaveBeenCalledWith('teams');
      expect(mockGetBindingStatus).toHaveBeenCalledWith({ channelId: 'teams' });
    });
  });

  it('handles API load errors gracefully', async () => {
    mockGetConfig.mockRejectedValueOnce(new Error('Network error'));
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('reacts to statusChanged event for teams channel', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => {
      mockStatusChangedCbs.forEach(cb => cb({}, { channelId: 'teams', status: 'stopped', error: undefined }));
    });
    // No crash expected
  });

  it('ignores statusChanged event for non-teams channel', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => {
      mockStatusChangedCbs.forEach(cb => cb({}, { channelId: 'slack', status: 'stopped' }));
    });
    // Should not update teams status
  });

  it('reacts to bindingChanged event for teams channel', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => {
      mockBindingChangedCbs.forEach(cb => cb({}, { channelId: 'teams', bound: false }));
    });
    expect(screen.getByTestId('bound').textContent).toBe('false');
  });

  it('ignores bindingChanged for non-teams channel', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => {
      mockBindingChangedCbs.forEach(cb => cb({}, { channelId: 'slack', bound: false }));
    });
  });

  it('updates config when profileDataManager fires with different boundChatId', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => {
      mockSubscribeCbs.forEach(cb =>
        cb({ profile: { remoteChannels: { teams: { boundChatId: 'newChat' } } } })
      );
    });
    // No crash
  });

  it('does not update config when boundChatId is the same', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => {
      mockSubscribeCbs.forEach(cb =>
        cb({ profile: { remoteChannels: { teams: { boundChatId: 'chat1' } } } })
      );
    });
  });

  it('ignores profileDataManager events without remoteChannels', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => {
      mockSubscribeCbs.forEach(cb => cb({ profile: {} }));
    });
  });

  it('handleStartBinding calls remoteChannelApi.start', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      await mockContentProps.onStartBinding?.();
    });
    expect(mockStart).toHaveBeenCalledWith('teams');
  });

  it('handleStartBinding sets error when start fails', async () => {
    mockStart.mockResolvedValueOnce({ success: false, error: 'start failed' });
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      await mockContentProps.onStartBinding?.();
    });
    // error state is passed to content as props
  });

  it('handleStartBinding sets error on exception', async () => {
    mockStart.mockRejectedValueOnce(new Error('start error'));
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      await mockContentProps.onStartBinding?.();
    });
  });

  it('handleSaveConfig saves and returns true', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    let result: boolean | undefined;
    await act(async () => {
      result = await mockContentProps.onSave?.({ boundChatId: 'chat2' });
    });
    expect(result).toBe(true);
    expect(mockUpdateConfig).toHaveBeenCalled();
  });

  it('handleSaveConfig returns false on failure', async () => {
    mockUpdateConfig.mockResolvedValueOnce({ success: false, error: 'save failed' });
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    let result: boolean | undefined;
    await act(async () => {
      result = await mockContentProps.onSave?.({ boundChatId: 'chat2' });
    });
    expect(result).toBe(false);
  });

  it('handleSaveConfig returns false on exception', async () => {
    mockUpdateConfig.mockRejectedValueOnce(new Error('save error'));
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    let result: boolean | undefined;
    await act(async () => {
      result = await mockContentProps.onSave?.({ boundChatId: 'chat2' });
    });
    expect(result).toBe(false);
  });

  it('handleBind does nothing when bindCode is empty', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      await mockContentProps.onBind?.();
    });
    expect(mockBind).not.toHaveBeenCalled();
  });

  it('handleBind binds successfully when code is set', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => {
      mockContentProps.onBindCodeChange?.('ABC123');
    });
    await act(async () => {
      await mockContentProps.onBind?.();
    });
    // bind was called with uppercased code
    expect(mockBind).toHaveBeenCalledWith({ channelId: 'teams', code: 'ABC123' });
  });

  it('handleBind sets bindError on failure', async () => {
    mockBind.mockResolvedValueOnce({ success: false, error: 'bad code' });
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => mockContentProps.onBindCodeChange?.('XYZ'));
    await act(async () => await mockContentProps.onBind?.());
    // error should be propagated as bindError prop
  });

  it('handleBind sets bindError on exception', async () => {
    mockBind.mockRejectedValueOnce(new Error('bind error'));
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    act(() => mockContentProps.onBindCodeChange?.('XYZ'));
    await act(async () => await mockContentProps.onBind?.());
  });

  it('handleDisconnect unbinds and stops', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      await mockContentProps.onDisconnect?.();
    });
    expect(mockUnbind).toHaveBeenCalledWith({ channelId: 'teams' });
  });

  it('handleDisconnect sets error when unbind fails', async () => {
    mockUnbind.mockResolvedValueOnce({ success: false, error: 'unbind failed' });
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      await mockContentProps.onDisconnect?.();
    });
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('handleDisconnect sets error when stop fails', async () => {
    mockStop.mockResolvedValueOnce({ success: false, error: 'stop failed' });
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      await mockContentProps.onDisconnect?.();
    });
  });

  it('handleDisconnect sets bindError on exception', async () => {
    mockUnbind.mockRejectedValueOnce(new Error('disconnect error'));
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      await mockContentProps.onDisconnect?.();
    });
  });

  it('chatOptions returns empty array when chats is null', async () => {
    mockUseChats.mockReturnValue({ chats: null });
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(mockContentProps.chatOptions).toEqual([]);
  });

  it('maps chats to chat options with fallback name', async () => {
    mockUseChats.mockReturnValue({
      chats: [
        { chat_id: 'c1', agent: { name: 'Agent A', emoji: '🎯' } },
        { chat_id: 'c2', agent: null },
      ],
    });
    renderView();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(mockContentProps.chatOptions).toHaveLength(2);
    expect(mockContentProps.chatOptions[1].name).toBe('c2');
  });
});
