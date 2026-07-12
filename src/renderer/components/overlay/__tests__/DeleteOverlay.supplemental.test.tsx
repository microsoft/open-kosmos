// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WithStore } from '@/atom';

const mockNavigate = vi.hoisted(() => vi.fn());
const mockLocation = vi.hoisted(() => ({ pathname: '/agent/chat/agent-1/session-1' }));
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockDeleteChatSession = vi.hoisted(() => vi.fn());
const mockStartNewChatFor = vi.hoisted(() => vi.fn());
const mockGetCurrentChatId = vi.hoisted(() => vi.fn());
const mockProfileCache = vi.hoisted(() => ({
  profile: { alias: 'user', primaryChat: 'agent-1' },
  chats: [],
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('@renderer/components/ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('@renderer/lib/chat/chatOps', () => ({
  chatOps: { deleteChatConfig: vi.fn() },
}));

vi.mock('@renderer/lib/chat/chatSessionOps', () => ({
  deleteChatSession: mockDeleteChatSession,
}));

vi.mock('@renderer/lib/chat/startNewChatFor', () => ({
  startNewChatFor: mockStartNewChatFor,
}));

vi.mock('@renderer/lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: mockGetCurrentChatId,
  },
}));

vi.mock('@renderer/lib/userData/profileDataManager', () => ({
  profileDataManager: {
    refresh: vi.fn().mockResolvedValue(undefined),
    getCache: vi.fn(() => mockProfileCache),
  },
}));

vi.mock('@renderer/lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../lib/i18n', () => ({
  translate: (_language: string, key: string, params?: Record<string, string>) => `${key}:${params?.name ?? params?.error ?? ''}`,
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => `${key}:${params?.name ?? params?.error ?? ''}`,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

import { DeleteOverlay, DeleteConfirmAtom } from '../DeleteOverlay';

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function ChatSessionController() {
  const [, actions] = DeleteConfirmAtom.use();
  return (
    <button
      data-testid="open"
      onClick={() => actions.showChatSession('session-1', 'Current Session', true)}
      type="button"
    >
      open
    </button>
  );
}

function DirectConfirmHarness() {
  const [, actions] = DeleteConfirmAtom.use();
  return (
    <>
      <button
        data-testid="open-agent"
        onClick={() => actions.showAgent('agent-1', 'Agent Name')}
        type="button"
      >
        open-agent
      </button>
      <button
        data-testid="confirm-agent"
        onClick={() => actions.confirm({ showSuccess: mockShowSuccess, showError: mockShowError } as any, mockNavigate, '/settings/agents')}
        type="button"
      >
        confirm-agent
      </button>
    </>
  );
}

describe('DeleteOverlay supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockStartNewChatFor.mockResolvedValue({ success: true, chatSessionId: 'session-2' });
    mockDeleteChatSession.mockResolvedValue({ success: false });
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        agentChat: {
          removeAgentChatInstance: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  });

  it('renders the current-session warning and falls back to unknown error when deletion fails without details', async () => {
    wrap(
      <>
        <ChatSessionController />
        <DeleteOverlay />
      </>,
    );

    fireEvent.click(screen.getByTestId('open'));
    expect(screen.getByText('overlay.delete.currentSessionWarning:')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.delete:' }));
    });

    await waitFor(() => {
      expect(mockStartNewChatFor).toHaveBeenCalledWith('agent-1');
    });
    expect(mockDeleteChatSession).toHaveBeenCalledWith('user', 'agent-1', 'session-1');
    expect(mockShowError).toHaveBeenCalledWith('overlay.delete.sessionFailed:common.unknownError:');
  });

  it('uses the fallback translator when confirm is triggered directly without a custom t function', async () => {
    const mockDeleteChatConfig = await import('@renderer/lib/chat/chatOps').then((module) => module.chatOps.deleteChatConfig as any);
    mockDeleteChatConfig.mockResolvedValue({ success: true });
    mockGetCurrentChatId.mockReturnValue('other-chat');

    wrap(
      <>
        <DirectConfirmHarness />
        <DeleteOverlay />
      </>,
    );

    fireEvent.click(screen.getByTestId('open-agent'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-agent'));
    });

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith('"Agent Name" deleted successfully');
    });
  });

  it('evaluates the latest chat-id list when the primary agent cannot be resolved', async () => {
    const profileDataManager = await import('@renderer/lib/userData/profileDataManager').then((module) => module.profileDataManager as any);
    const mockDeleteChatConfig = await import('@renderer/lib/chat/chatOps').then((module) => module.chatOps.deleteChatConfig as any);
    mockDeleteChatConfig.mockResolvedValue({ success: true });
    mockGetCurrentChatId.mockReturnValue('other-chat');
    mockLocation.pathname = '/agent/chat/agent-1/session-1';
    profileDataManager.getCache.mockReturnValue({
      profile: { alias: 'user', primaryChat: 'missing-primary' },
      chats: [{}, { chat_id: undefined }],
    });

    wrap(
      <>
        <DirectConfirmHarness />
        <DeleteOverlay />
      </>,
    );

    fireEvent.click(screen.getByTestId('open-agent'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-agent'));
    });

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalled();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
