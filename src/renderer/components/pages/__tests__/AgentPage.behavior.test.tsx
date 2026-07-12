/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authData: { userId: 'user1', token: 'token' } as any,
  needsFRE: false,
  profile: { primaryChat: 'chat-1' } as any,
  chats: [{ chat_id: 'chat-1', agent: { name: 'Kobi' } }] as any[],
  currentUserAlias: 'user1',
  currentChatId: null as string | null,
  currentChatSessionId: null as string | null,
  unsubscribe: vi.fn(),
  profileSubscriber: undefined as undefined | (() => void),
  startNewChatFor: vi.fn(
    async (
      _chatId: string,
      _sayHiMessageConfig?: unknown,
    ): Promise<{ success: boolean; chatSessionId?: string; error?: string }> => ({
      success: true,
      chatSessionId: 'session-1',
    }),
  ),
  navigate: vi.fn(),
  updateFreDone: vi.fn(async () => {}),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => state.navigate,
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ authData: state.authData }),
}));

vi.mock('../../layout/AppLayout', () => ({
  default: () => <div data-testid="app-layout" />,
}));

vi.mock('../../fre', () => ({
  FreOverlay: ({ onSkip }: { onSkip: () => void }) => (
    <button data-testid="fre-skip" onClick={onSkip}>
      Skip
    </button>
  ),
}));

vi.mock('../../../lib/userData', () => ({
  profileDataManager: {
    needsFRE: () => state.needsFRE,
    subscribe: (callback: () => void) => {
      state.profileSubscriber = callback;
      return state.unsubscribe;
    },
    getProfile: () => state.profile,
    getChatConfigs: () => state.chats,
    getCurrentUserAlias: () => state.currentUserAlias,
  },
}));

vi.mock('../../../lib/chat/startNewChatFor', () => ({
  startNewChatFor: (chatId: string, sayHiMessageConfig?: unknown) =>
    state.startNewChatFor(chatId, sayHiMessageConfig),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessagesWithStream: () => ({ messages: [], streamingMessageId: null }),
  CurrentSessionStatus: { use: () => ({ chatStatus: 'idle', chatSessionId: state.currentChatSessionId }) },
  useCurrentChatSessionId: () => state.currentChatSessionId,
  useCurrentChatId: () => state.currentChatId,
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => state.logger,
}));

function setupElectronAPI() {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      platform: 'darwin',
      getPlatformInfo: vi.fn(async () => ({ platform: 'darwin' })),
      profile: {
        updateFreDone: state.updateFreDone,
      },
    },
  });
}

async function renderFreshPage() {
  vi.resetModules();
  const { AgentPage } = await import('../AgentPage');
  return render(<AgentPage />);
}

describe('AgentPage behavior coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.authData = { userId: 'user1', token: 'token' };
    state.needsFRE = false;
    state.profile = { primaryChat: 'chat-1' };
    state.chats = [{ chat_id: 'chat-1', agent: { name: 'Kobi' } }];
    state.currentUserAlias = 'user1';
    state.currentChatId = null;
    state.currentChatSessionId = null;
    state.profileSubscriber = undefined;
    state.unsubscribe = vi.fn();
    state.startNewChatFor.mockResolvedValue({ success: true, chatSessionId: 'session-1' });
    state.navigate.mockReset();
    state.updateFreDone.mockResolvedValue(undefined);
    state.logger.debug.mockReset();
    state.logger.info.mockReset();
    state.logger.warn.mockReset();
    state.logger.error.mockReset();
    setupElectronAPI();
  });

  it('returns null when authData is missing', async () => {
    state.authData = null;
    const view = await renderFreshPage();
    expect(view.container).toBeEmptyDOMElement();
  });

  it('auto-selects the primary chat on startup and navigates to the new session', async () => {
    await renderFreshPage();

    await waitFor(() => {
      expect(state.startNewChatFor).toHaveBeenCalledWith('chat-1', undefined);
    });
    expect(state.navigate).toHaveBeenCalledWith('/agent/chat/chat-1/session-1', { replace: true });
  });

  it('skips startup selection when the profile is unavailable', async () => {
    state.profile = null;

    await renderFreshPage();

    await waitFor(() => {
      expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    });
    expect(state.startNewChatFor).not.toHaveBeenCalled();
  });

  it('skips startup selection when no chats are configured', async () => {
    state.chats = [];

    await renderFreshPage();

    await waitFor(() => {
      expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    });
    expect(state.startNewChatFor).not.toHaveBeenCalled();
  });

  it('falls back to the first chat when the configured primary chat is missing', async () => {
    state.profile = { primaryChat: 'missing-chat' };
    state.chats = [{ chat_id: 'fallback-chat', agent: { name: 'Fallback' } }];
    state.startNewChatFor.mockResolvedValue({ success: true, chatSessionId: 'fallback-session' });

    await renderFreshPage();

    await waitFor(() => {
      expect(state.startNewChatFor).toHaveBeenCalledWith('fallback-chat', undefined);
    });
    expect(state.navigate).toHaveBeenCalledWith('/agent/chat/fallback-chat/fallback-session', { replace: true });
  });

  it('skips navigation when no chat id can be resolved from the available chats', async () => {
    state.profile = { primaryChat: 'missing-chat' };
    state.chats = [{} as any];

    await renderFreshPage();

    await waitFor(() => {
      expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    });
    expect(state.startNewChatFor).not.toHaveBeenCalled();
  });

  it('logs a warning when the startup session bootstrap reports a failure', async () => {
    state.startNewChatFor.mockResolvedValue({ success: false, error: 'bootstrap failed' });

    await renderFreshPage();

    await waitFor(() => {
      expect(state.startNewChatFor).toHaveBeenCalledWith('chat-1', undefined);
    });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.logger.warn).toHaveBeenCalled();
  });

  it('initializes a chat session for the current chat when no session exists yet', async () => {
    state.needsFRE = true;
    state.currentChatId = 'chat-2';
    state.currentChatSessionId = null;
    state.startNewChatFor.mockResolvedValue({ success: true, chatSessionId: 'chat-2-session' });

    await renderFreshPage();

    await waitFor(() => {
      expect(state.startNewChatFor).toHaveBeenCalledWith('chat-2', undefined);
    });
  });

  it('does not initialize a new session when the current chat already has one', async () => {
    state.needsFRE = true;
    state.currentChatId = 'chat-2';
    state.currentChatSessionId = 'existing-session';

    await renderFreshPage();

    await waitFor(() => {
      expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    });
    expect(state.startNewChatFor).not.toHaveBeenCalled();
  });

  it('shows the FRE overlay and marks FRE as done when skipped', async () => {
    state.needsFRE = true;

    await renderFreshPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId('fre-skip'));
    });

    expect(state.updateFreDone).toHaveBeenCalledWith('user1', true);
  });

  it('renders the development monitor in development mode', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      await renderFreshPage();

      await waitFor(() => {
        expect(state.logger.debug).toHaveBeenCalled();
      });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
