// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mocks ──────────────────────────────────────────────────────────────

const {
  mockNavigate,
  mockLocation,
  mockChats,
  mockProfileData,
  mockCurrentChatId,
  mockCurrentChatSessionId,
  mockSubscribeToCurrentChatSessionId,
  mockGetCurrentChatId,
  mockGetChatSessionCache,
  mockOnChatStatusChanged,
  mockShowSuccess,
  mockShowError,
  mockBrandName,
} = vi.hoisted(() => {
  const mockNavigate = vi.fn();
  const mockLocation = { pathname: '/agent/chat/chat-1' };
  const mockChats: any[] = [];
  const mockProfileData = { profile: { primaryAgent: 'Kobi' } };
  const mockCurrentChatId = { value: null as string | null };
  const mockCurrentChatSessionId = { value: null as string | null };
  let _subscriber: ((id: string | null) => void) | null = null;

  const mockSubscribeToCurrentChatSessionId = vi.fn((cb: (id: string | null) => void) => {
    _subscriber = cb;
    return () => { _subscriber = null; };
  });
  const mockGetCurrentChatId = vi.fn(() => mockCurrentChatId.value);
  const mockGetChatSessionCache = vi.fn(() => null);
  const mockOnChatStatusChanged = vi.fn(() => vi.fn());
  const mockShowSuccess = vi.fn();
  const mockShowError = vi.fn();
  const mockBrandName = { value: 'kosmos' };

  return {
    mockNavigate,
    mockLocation,
    mockChats,
    mockProfileData,
    mockCurrentChatId,
    mockCurrentChatSessionId,
    mockSubscribeToCurrentChatSessionId,
    mockGetCurrentChatId,
    mockGetChatSessionCache,
    mockOnChatStatusChanged,
    mockShowSuccess,
    mockShowError,
    mockBrandName,
  };
});

// ── vi.mock calls ──────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({
    chats: mockChats,
    data: mockProfileData,
  }),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: () => mockCurrentChatId.value,
    getCurrentChatSessionId: () => mockCurrentChatSessionId.value,
    subscribeToCurrentChatSessionId: mockSubscribeToCurrentChatSessionId,
    getChatSessionCache: mockGetChatSessionCache,
  },
}));

vi.mock('../../chat/agent-area/AgentList', () => ({
  default: ({ chats, onSelectChat, onSearchActiveChange }: any) => (
    <div data-testid="agent-list" data-chat-count={chats?.length ?? 0}>
      <button data-testid="select-chat-btn" onClick={() => onSelectChat?.('chat-1')}>Select</button>
      {onSearchActiveChange && (
        <button data-testid="toggle-search" onClick={() => onSearchActiveChange(true)}>SearchOn</button>
      )}
    </div>
  ),
}));

vi.mock('../../ui/navigation/NavItem', () => ({
  default: ({ label, onClick, onKeyDown, isActive }: any) => (
    <button data-testid="nav-item" onClick={onClick} onKeyDown={onKeyDown} data-active={isActive}>
      {label}
    </button>
  ),
}));

vi.mock('../../ui/Divider', () => ({
  default: () => <hr data-testid="divider" />,
}));

vi.mock('../../../lib/userData/types', () => ({
  isBuiltinAgent: (name: string) => name?.toLowerCase() === 'kobi' || name?.toLowerCase() === 'pm agent',
}));

vi.mock('@shared/constants/branding', () => ({
  get BRAND_NAME() { return mockBrandName.value; },
}));

// ── import after mocks ────────────────────────────────────────────────────────

import NavigationSection from '../NavigationSection';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeChat(id: string, agentName: string, chatSessions: any[] = []) {
  return {
    chat_id: id,
    chat_type: 'single_agent',
    agent: { name: agentName, emoji: '🤖' },
    chatSessions,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBrandName.value = 'kosmos';
  mockLocation.pathname = '/agent/chat/chat-1';
  mockChats.length = 0;
  mockCurrentChatId.value = null;
  mockCurrentChatSessionId.value = null;

  (window as any).electronAPI = {
    agentChat: {
      onChatStatusChanged: mockOnChatStatusChanged,
    },
  };
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('NavigationSection — basic render (kosmos)', () => {
  it('renders the New Agent nav item', () => {
    render(<NavigationSection />);
    expect(screen.getByTestId('nav-item')).toHaveTextContent('New Agent');
  });

  it('renders divider and agent list', () => {
    render(<NavigationSection />);
    expect(screen.getByTestId('divider')).toBeInTheDocument();
    expect(screen.getByTestId('agent-list')).toBeInTheDocument();
  });
});

describe('NavigationSection — handleNewAgent (kosmos)', () => {
  it('navigates to /agent/chat/creation when not already in creation view', () => {
    mockLocation.pathname = '/agent/chat/chat-1';
    render(<NavigationSection />);
    fireEvent.click(screen.getByTestId('nav-item'));
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation');
  });

  it('navigates with replace when already in creation view', () => {
    mockLocation.pathname = '/agent/chat/creation';
    render(<NavigationSection />);
    fireEvent.click(screen.getByTestId('nav-item'));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/agent/chat/creation',
      expect.objectContaining({ replace: true }),
    );
  });

  it('handles Enter key on nav item', () => {
    mockLocation.pathname = '/agent/chat/chat-1';
    render(<NavigationSection />);
    fireEvent.keyDown(screen.getByTestId('nav-item'), { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation');
  });

  it('handles Space key on nav item', () => {
    mockLocation.pathname = '/agent/chat/chat-1';
    render(<NavigationSection />);
    fireEvent.keyDown(screen.getByTestId('nav-item'), { key: ' ' });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation');
  });
});

describe('NavigationSection — chat selection', () => {
  it('navigates to chat route when a chat is selected', () => {
    mockChats.push(makeChat('chat-1', 'My Agent'));
    render(<NavigationSection />);
    fireEvent.click(screen.getByTestId('select-chat-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1', expect.objectContaining({ state: expect.any(Object) }));
  });
});

describe('NavigationSection — agent search hides divider', () => {
  it('hides divider and builtin section when search is active', () => {
    mockChats.push(makeChat('chat-kobi', 'Kobi'));
    render(<NavigationSection />);
    // Initially divider is visible
    expect(screen.getByTestId('divider')).toBeInTheDocument();
    // Trigger search active
    fireEvent.click(screen.getByTestId('toggle-search'));
    expect(screen.queryByTestId('divider')).not.toBeInTheDocument();
  });
});

describe('NavigationSection — builtin agents (kosmos)', () => {
  it('shows builtin agent list below divider when Kobi chat exists', () => {
    mockChats.push(makeChat('chat-kobi', 'Kobi'));
    render(<NavigationSection />);
    // Two agent-list elements: main + builtin
    const lists = screen.getAllByTestId('agent-list');
    expect(lists.length).toBe(2);
  });

  it('does not show second agent list when no builtin agents', () => {
    mockChats.push(makeChat('chat-custom', 'Custom Agent'));
    render(<NavigationSection />);
    const lists = screen.getAllByTestId('agent-list');
    expect(lists.length).toBe(1);
  });
});

describe('NavigationSection — subscribeToCurrentChatSessionId', () => {
  it('updates currentChatSessionId on subscription callback', () => {
    render(<NavigationSection />);
    expect(mockSubscribeToCurrentChatSessionId).toHaveBeenCalled();
    // Fire the subscription callback
    const cb = mockSubscribeToCurrentChatSessionId.mock.calls[0][0];
    act(() => {
      cb('new-session-id');
    });
    // No crash expected; just verify it runs without error
  });
});

describe('NavigationSection — onChatStatusChanged listener', () => {
  it('does not crash when electronAPI.agentChat.onChatStatusChanged is absent', () => {
    (window as any).electronAPI = {};
    expect(() => render(<NavigationSection />)).not.toThrow();
  });
});
