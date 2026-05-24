// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * StatusBadges — coverage for AvailableToolsBadge, AvailableSkillsBadge, and StatusBadges.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';

// ── Hoisted mock variables ───────────────────────────────────────────────────
const { mockGetCurrentChatId, mockSubscribeToCurrentChatSessionId,
        mockGetChatConfigs, mockGetSkills, mockSubscribeProfile,
        mockGetAgentSpecificTools, mockUseMCPServers } = vi.hoisted(() => ({
  mockGetCurrentChatId: vi.fn(() => null),
  mockSubscribeToCurrentChatSessionId: vi.fn(() => () => {}),
  mockGetChatConfigs: vi.fn(() => []),
  mockGetSkills: vi.fn(() => []),
  mockSubscribeProfile: vi.fn(() => () => {}),
  mockGetAgentSpecificTools: vi.fn(() => []),
  mockUseMCPServers: vi.fn(() => ({ servers: [] })),
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useMCPServers: mockUseMCPServers,
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: mockGetCurrentChatId,
    subscribeToCurrentChatSessionId: mockSubscribeToCurrentChatSessionId,
  },
}));

vi.mock('../../../lib/userData', async () => ({
  profileDataManager: {
    getChatConfigs: mockGetChatConfigs,
    getSkills: mockGetSkills,
    subscribe: mockSubscribeProfile,
  },
}));

vi.mock('../../../lib/mcp/mcpClientCacheManager', async () => ({
  mcpClientCacheManager: {
    getAgentSpecificTools: mockGetAgentSpecificTools,
  },
}));

vi.mock('../ContextBadge', async () => ({
  default: () => <span data-testid="context-badge" />,
}));

vi.mock('../../ui/badge', async () => ({
  Badge: ({ children, onClick, title, className }: {
    children: React.ReactNode;
    onClick?: () => void;
    title?: string;
    className?: string;
  }) => (
    <span data-testid="badge" onClick={onClick} title={title} className={className}>
      {children}
    </span>
  ),
}));

import { StatusBadges } from '../StatusBadges';

describe('StatusBadges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentChatId.mockReturnValue(null);
    mockSubscribeToCurrentChatSessionId.mockReturnValue(() => {});
    mockSubscribeProfile.mockReturnValue(() => {});
    mockGetChatConfigs.mockReturnValue([]);
    mockGetSkills.mockReturnValue([]);
    mockGetAgentSpecificTools.mockReturnValue([]);
    mockUseMCPServers.mockReturnValue({ servers: [] });
  });

  it('renders all three badges', () => {
    render(<StatusBadges />);
    const badges = screen.getAllByTestId('badge');
    // skills badge + tools badge
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('context-badge')).toBeDefined();
  });

  it('shows tools: 0 when no chatId', () => {
    render(<StatusBadges />);
    expect(screen.getByText(/tools: 0/)).toBeDefined();
  });

  it('shows skills: 0 when no chatId', () => {
    render(<StatusBadges />);
    expect(screen.getByText(/skills: 0/)).toBeDefined();
  });

  it('shows tools count from mcpClientCacheManager when chatId available', () => {
    mockGetCurrentChatId.mockReturnValue('chat-1');
    mockGetChatConfigs.mockReturnValue([
      { chat_id: 'chat-1', agent: { mcp_servers: ['server1'] } }
    ]);
    mockGetAgentSpecificTools.mockReturnValue([{ name: 'tool1' }, { name: 'tool2' }]);

    render(<StatusBadges />);
    expect(screen.getByText(/tools: 2/)).toBeDefined();
  });

  it('shows skills count when chatId available and skills exist', () => {
    mockGetCurrentChatId.mockReturnValue('chat-1');
    mockGetChatConfigs.mockReturnValue([
      { chat_id: 'chat-1', agent: { skills: ['skill1', 'skill2'] } }
    ]);
    mockGetSkills.mockReturnValue([{ name: 'skill1' }, { name: 'skill2' }, { name: 'skill3' }]);

    render(<StatusBadges />);
    expect(screen.getByText(/skills: 2/)).toBeDefined();
  });

  it('calls onOpenMcpTools when tools badge clicked', () => {
    const onOpenMcpTools = vi.fn();
    render(<StatusBadges onOpenMcpTools={onOpenMcpTools} />);
    const badges = screen.getAllByTestId('badge');
    // tools badge is second badge
    const toolsBadge = badges.find(b => b.textContent?.includes('tools:'));
    expect(toolsBadge).toBeDefined();
    toolsBadge!.click();
    expect(onOpenMcpTools).toHaveBeenCalled();
  });

  it('calls onOpenSkills when skills badge clicked', () => {
    const onOpenSkills = vi.fn();
    render(<StatusBadges onOpenSkills={onOpenSkills} />);
    const skillsBadge = screen.getAllByTestId('badge').find(b => b.textContent?.includes('skills:'));
    expect(skillsBadge).toBeDefined();
    skillsBadge!.click();
    expect(onOpenSkills).toHaveBeenCalled();
  });

  it('handles chat with no agent gracefully', () => {
    mockGetCurrentChatId.mockReturnValue('chat-1');
    mockGetChatConfigs.mockReturnValue([
      { chat_id: 'chat-1' } // no agent
    ]);
    render(<StatusBadges />);
    expect(screen.getByText(/tools: 0/)).toBeDefined();
    expect(screen.getByText(/skills: 0/)).toBeDefined();
  });

  it('shows cursor-pointer class when handler provided', () => {
    render(<StatusBadges onOpenMcpTools={() => {}} onOpenSkills={() => {}} />);
    const badges = screen.getAllByTestId('badge');
    const toolsBadge = badges.find(b => b.textContent?.includes('tools:'));
    expect(toolsBadge?.className).toContain('cursor-pointer');
  });

  it('shows cursor-help class when no handler', () => {
    render(<StatusBadges />);
    const badges = screen.getAllByTestId('badge');
    const toolsBadge = badges.find(b => b.textContent?.includes('tools:'));
    expect(toolsBadge?.className).toContain('cursor-help');
  });

  it('subscribes to chat session changes', () => {
    render(<StatusBadges />);
    expect(mockSubscribeToCurrentChatSessionId).toHaveBeenCalled();
  });

  it('subscribes to profile data changes', () => {
    render(<StatusBadges />);
    expect(mockSubscribeProfile).toHaveBeenCalled();
  });

  it('updates tools count when subscription callback fires', () => {
    let sessionCallback: (() => void) | null = null;
    mockSubscribeToCurrentChatSessionId.mockImplementation((cb: () => void) => {
      sessionCallback = cb;
      return () => {};
    });
    mockGetCurrentChatId.mockReturnValue(null);
    mockGetChatConfigs.mockReturnValue([
      { chat_id: 'chat-2', agent: { mcp_servers: ['s1'] } }
    ]);
    mockGetAgentSpecificTools.mockReturnValue([{ name: 't1' }]);

    render(<StatusBadges />);
    expect(screen.getByText(/tools: 0/)).toBeDefined();

    // Simulate session change
    act(() => {
      mockGetCurrentChatId.mockReturnValue('chat-2');
      sessionCallback?.();
    });

    expect(screen.getByText(/tools: 1/)).toBeDefined();
  });
});
