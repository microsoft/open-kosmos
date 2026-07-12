// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockProfileDataManagerSubscribe,
  mockProfileDataManagerGetCache,
  mockProfileDataManagerGetCurrentAgent,
  mockProfileDataManagerGetCurrentModel,
  mockProfileDataManagerGetAssignedMcpServers,
  mockProfileDataManagerInitialize,
  mockProfileDataManagerRefresh,
  mockProfileDataManagerIsDataStale,
  mockProfileDataManagerGetSkillsStats,
  mockProfileDataManagerGetSkillByName,
  mockProfileDataManagerGetCurrentAgentSkills,
  mockMcpClientCacheManagerSubscribe,
  mockMcpClientCacheManagerGetMCPServers,
  mockMcpClientCacheManagerGetMCPStats,
  mockMcpClientCacheManagerGetAllMCPTools,
  mockMcpClientCacheManagerGetMCPServerByName,
  mockMcpClientCacheManagerInitialize,
  mockAgentChatSessionSubscribe,
  mockAgentChatSessionGetCurrentChatId,
  mockChatOpsInitialize,
  mockChatOpsCleanup,
  mockChatOpsAddChatConfig,
  mockChatOpsUpdateChatConfig,
  mockChatOpsDeleteChatConfig,
  mockChatOpsUpdateChatAgent,
  mockAgentClientCacheManagerInitialize,
  mockAddServer,
  mockUpdateServer,
  mockDeleteServer,
  mockGetServerStatus,
  mockUserRef,
} = vi.hoisted(() => {
  const mockUserRef = { value: null as any };
  const mockProfileCache = {
    isInitialized: false,
    lastUpdated: 0,
    chats: [],
    skills: [],
    subAgents: [],
  };

  return {
    mockProfileDataManagerSubscribe: vi.fn(() => vi.fn()), // returns unsubscribe
    mockProfileDataManagerGetCache: vi.fn(() => ({ ...mockProfileCache })),
    mockProfileDataManagerGetCurrentAgent: vi.fn(() => null),
    mockProfileDataManagerGetCurrentModel: vi.fn(() => null),
    mockProfileDataManagerGetAssignedMcpServers: vi.fn(() => []),
    mockProfileDataManagerInitialize: vi.fn(async () => {}),
    mockProfileDataManagerRefresh: vi.fn(async () => {}),
    mockProfileDataManagerIsDataStale: vi.fn(() => false),
    mockProfileDataManagerGetSkillsStats: vi.fn(() => ({ total: 0 })),
    mockProfileDataManagerGetSkillByName: vi.fn(() => null),
    mockProfileDataManagerGetCurrentAgentSkills: vi.fn(() => []),
    mockMcpClientCacheManagerSubscribe: vi.fn(() => vi.fn()),
    mockMcpClientCacheManagerGetMCPServers: vi.fn(() => []),
    mockMcpClientCacheManagerGetMCPStats: vi.fn(() => ({
      totalServers: 0, connectedServers: 0, disconnectedServers: 0, errorServers: 0, totalTools: 0
    })),
    mockMcpClientCacheManagerGetAllMCPTools: vi.fn(() => []),
    mockMcpClientCacheManagerGetMCPServerByName: vi.fn(() => null),
    mockMcpClientCacheManagerInitialize: vi.fn(async () => {}),
    mockAgentChatSessionSubscribe: vi.fn(() => vi.fn()),
    mockAgentChatSessionGetCurrentChatId: vi.fn(() => null),
    mockChatOpsInitialize: vi.fn(),
    mockChatOpsCleanup: vi.fn(),
    mockChatOpsAddChatConfig: vi.fn(async () => ({ success: true })),
    mockChatOpsUpdateChatConfig: vi.fn(async () => ({ success: true })),
    mockChatOpsDeleteChatConfig: vi.fn(async () => ({ success: true })),
    mockChatOpsUpdateChatAgent: vi.fn(async () => ({ success: true })),
    mockAgentClientCacheManagerInitialize: vi.fn(async () => {}),
    mockAddServer: vi.fn(async () => ({ success: true })),
    mockUpdateServer: vi.fn(async () => ({ success: true })),
    mockDeleteServer: vi.fn(async () => ({ success: true })),
    mockGetServerStatus: vi.fn(async () => ({ success: true })),
    mockUserRef,
  };
});

vi.mock('../../../lib/userData', () => ({
  profileDataManager: {
    getCache: () => mockProfileDataManagerGetCache(),
    subscribe: (...a: any[]) => mockProfileDataManagerSubscribe(...a),
    getCurrentAgent: () => mockProfileDataManagerGetCurrentAgent(),
    getCurrentModel: () => mockProfileDataManagerGetCurrentModel(),
    getAssignedMcpServers: () => mockProfileDataManagerGetAssignedMcpServers(),
    initialize: (...a: any[]) => mockProfileDataManagerInitialize(...a),
    refresh: () => mockProfileDataManagerRefresh(),
    isDataStale: (...a: any[]) => mockProfileDataManagerIsDataStale(...a),
    getSkillsStats: () => mockProfileDataManagerGetSkillsStats(),
    getSkillByName: (...a: any[]) => mockProfileDataManagerGetSkillByName(...a),
    getCurrentAgentSkills: () => mockProfileDataManagerGetCurrentAgentSkills(),
  },
  ProfileCacheData: {},
}));

vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: {
    getMCPServers: () => mockMcpClientCacheManagerGetMCPServers(),
    getMCPStats: () => mockMcpClientCacheManagerGetMCPStats(),
    getAllMCPTools: () => mockMcpClientCacheManagerGetAllMCPTools(),
    getMCPServerByName: (...a: any[]) => mockMcpClientCacheManagerGetMCPServerByName(...a),
    initialize: () => mockMcpClientCacheManagerInitialize(),
    subscribe: (...a: any[]) => mockMcpClientCacheManagerSubscribe(...a),
  },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    subscribeToCurrentChatSessionId: (...a: any[]) => mockAgentChatSessionSubscribe(...a),
    getCurrentChatId: () => mockAgentChatSessionGetCurrentChatId(),
  },
}));

vi.mock('../../../lib/chat/chatOps', () => ({
  chatOps: {
    initialize: (...a: any[]) => mockChatOpsInitialize(...a),
    cleanup: () => mockChatOpsCleanup(),
    addChatConfig: (...a: any[]) => mockChatOpsAddChatConfig(...a),
    updateChatConfig: (...a: any[]) => mockChatOpsUpdateChatConfig(...a),
    deleteChatConfig: (...a: any[]) => mockChatOpsDeleteChatConfig(...a),
    updateChatAgent: (...a: any[]) => mockChatOpsUpdateChatAgent(...a),
  },
}));

vi.mock('../../../lib/agent', () => ({
  agentClientCacheManager: {
    initialize: (...a: any[]) => mockAgentClientCacheManagerInitialize(...a),
  },
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ user: mockUserRef.value }),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

// Mock electronAPI
const mockElectronAPI = {
  mcp: {
    addServer: (...a: any[]) => mockAddServer(...a),
    updateServer: (...a: any[]) => mockUpdateServer(...a),
    deleteServer: (...a: any[]) => mockDeleteServer(...a),
    getServerStatus: () => mockGetServerStatus(),
  },
};

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  ProfileDataProvider,
  useProfileData,
  useMCPServers,
  useProfileDataReady,
  useChats,
  useAgentConfig,
  useProfileDataRefresh,
  useSkills,
} from '../userDataProvider';

// ── Test helper: Consumer component ──────────────────────────────────────────

function TestConsumer({ hook }: { hook: () => any }) {
  const data = hook();
  return <div data-testid="data">{JSON.stringify(data)}</div>;
}

function renderWithProvider(ui: React.ReactElement) {
  // Set up window.electronAPI
  (window as any).electronAPI = mockElectronAPI;
  return render(<ProfileDataProvider>{ui}</ProfileDataProvider>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfileDataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRef.value = null;
    mockProfileDataManagerGetCache.mockReturnValue({
      isInitialized: false,
      lastUpdated: 0,
      chats: [],
      skills: [],
      subAgents: [],
    });
    mockProfileDataManagerSubscribe.mockReturnValue(vi.fn());
    mockMcpClientCacheManagerSubscribe.mockReturnValue(vi.fn());
    mockAgentChatSessionSubscribe.mockReturnValue(vi.fn());
    (window as any).electronAPI = mockElectronAPI;
  });

  // ── Rendering & context ────────────────────────────────────────────────────

  it('renders children', () => {
    render(
      <ProfileDataProvider>
        <div data-testid="child">hello</div>
      </ProfileDataProvider>
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('throws when useProfileData is used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer hook={useProfileData} />)).toThrow(
      'useProfileData must be used within a ProfileDataProvider'
    );
    consoleSpy.mockRestore();
  });

  // ── Initialization with authenticated user ──────────────────────────────────

  it('initializes profileDataManager when user is present and data not initialized', async () => {
    mockUserRef.value = { login: 'testuser' };
    renderWithProvider(<div />);
    await waitFor(() => {
      expect(mockProfileDataManagerInitialize).toHaveBeenCalledWith('testuser');
    });
  });

  it('syncs agent state after initialization', async () => {
    mockUserRef.value = { login: 'testuser' };
    const mockAgent = { name: 'agent1', role: 'assistant', emoji: '🤖' } as any;
    mockProfileDataManagerGetCurrentAgent.mockReturnValue(mockAgent);
    mockProfileDataManagerGetCurrentModel.mockReturnValue('gpt-4');
    mockProfileDataManagerGetAssignedMcpServers.mockReturnValue([{ name: 'mcp1' }]);
    renderWithProvider(<div />);
    await waitFor(() => {
      expect(mockProfileDataManagerGetCurrentAgent).toHaveBeenCalled();
    });
  });

  it('does not initialize when user is absent', () => {
    mockUserRef.value = null;
    renderWithProvider(<div />);
    expect(mockProfileDataManagerInitialize).not.toHaveBeenCalled();
  });

  it('does not initialize when data is already initialized', () => {
    mockUserRef.value = { login: 'user' };
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: true, lastUpdated: 0, chats: [], skills: [] });
    renderWithProvider(<div />);
    expect(mockProfileDataManagerInitialize).not.toHaveBeenCalled();
  });

  // ── subscribe/unsubscribe lifecycle ──────────────────────────────────────

  it('calls chatOps.initialize when user is present', async () => {
    mockUserRef.value = { login: 'testuser' };
    renderWithProvider(<div />);
    await waitFor(() => {
      expect(mockChatOpsInitialize).toHaveBeenCalledWith('testuser');
    });
  });

  it('calls agentClientCacheManager.initialize when user is present', async () => {
    mockUserRef.value = { login: 'testuser' };
    renderWithProvider(<div />);
    await waitFor(() => {
      expect(mockAgentClientCacheManagerInitialize).toHaveBeenCalledWith('testuser');
    });
  });

  it('calls chatOps.cleanup on unmount', async () => {
    mockUserRef.value = { login: 'user' };
    const { unmount } = renderWithProvider(<div />);
    unmount();
    expect(mockChatOpsCleanup).toHaveBeenCalled();
  });

  it('calls mcpClientCacheManager.initialize', async () => {
    renderWithProvider(<div />);
    await waitFor(() => {
      expect(mockMcpClientCacheManagerInitialize).toHaveBeenCalled();
    });
  });

  it('subscribes to profile data changes', () => {
    renderWithProvider(<div />);
    expect(mockProfileDataManagerSubscribe).toHaveBeenCalled();
  });

  it('calls unsubscribe for profile data on unmount', () => {
    const unsubscribeMock = vi.fn();
    mockProfileDataManagerSubscribe.mockReturnValue(unsubscribeMock);
    const { unmount } = renderWithProvider(<div />);
    unmount();
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it('calls unsubscribe for MCP state on unmount', () => {
    const unsubscribeMock = vi.fn();
    mockMcpClientCacheManagerSubscribe.mockReturnValue(unsubscribeMock);
    const { unmount } = renderWithProvider(<div />);
    unmount();
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  // ── Profile data subscription callback ────────────────────────────────────

  it('updates state when profileDataManager fires subscribe callback', async () => {
    let callback: ((data: any) => void) | undefined;
    mockProfileDataManagerSubscribe.mockImplementation((cb) => {
      callback = cb;
      return vi.fn();
    });

    renderWithProvider(<div />);

    const newData = { isInitialized: true, lastUpdated: 9999, chats: ['chat1'], skills: [] };
    act(() => {
      callback!(newData);
    });

    // Just verify it didn't crash
    expect(mockProfileDataManagerGetCurrentAgent).toHaveBeenCalled();
  });

  it('detects agent config change and updates state', async () => {
    const initialAgent = { name: 'a', role: 'r', emoji: '🤖', system_prompt: 'p', version: 1, remoteVersion: 1, skills: [] } as any;
    mockProfileDataManagerGetCurrentAgent.mockReturnValue(initialAgent);

    let callback: ((data: any) => void) | undefined;
    mockProfileDataManagerSubscribe.mockImplementation((cb) => {
      callback = cb;
      return vi.fn();
    });

    renderWithProvider(<div />);

    const updatedAgent = { ...initialAgent, name: 'b' };
    mockProfileDataManagerGetCurrentAgent.mockReturnValue(updatedAgent);
    act(() => {
      callback!({ isInitialized: true, lastUpdated: 1, chats: [], skills: [] });
    });
    // No crash expected
  });

  it('handles profile updates when agent, model, and MCP assignments are unchanged', async () => {
    mockUserRef.value = { login: 'testuser' };
    const stableAgent = {
      name: 'stable',
      role: 'assistant',
      emoji: '🤖',
      system_prompt: 'prompt',
      version: 1,
      remoteVersion: 2,
      skills: [{ name: 'skill-a' }],
    } as any;
    const stableServers = [{ name: 'mcp1' }];
    const callbacks: Array<(data: any) => void> = [];
    mockAgentChatSessionGetCurrentChatId.mockReturnValue(null);
    mockProfileDataManagerGetCurrentAgent.mockReturnValue(stableAgent);
    mockProfileDataManagerGetCurrentModel.mockReturnValue('gpt-4o');
    mockProfileDataManagerGetAssignedMcpServers.mockReturnValue(stableServers);
    mockProfileDataManagerSubscribe.mockImplementation((cb) => {
      callbacks.push(cb);
      return vi.fn();
    });

    renderWithProvider(<TestConsumer hook={useProfileData} />);

    await waitFor(() => {
      expect(mockProfileDataManagerInitialize).toHaveBeenCalledWith('testuser');
    });

    act(() => {
      callbacks.at(-1)!({ isInitialized: true, lastUpdated: 0, chats: [], skills: [] });
    });

    await waitFor(() => {
      expect(callbacks.length).toBeGreaterThan(1);
    });

    const stableCallback = callbacks.at(-1)!;
    act(() => {
      stableCallback({ isInitialized: true, lastUpdated: 0, chats: [], skills: [] });
    });
    act(() => {
      stableCallback({ isInitialized: true, lastUpdated: 1, chats: ['chat-1'], skills: [] });
    });

    expect(mockProfileDataManagerGetCurrentAgent).toHaveBeenCalled();
  });

  it('triggers chat session change handler via agentChatSession subscribe', async () => {
    let chatCallback: (() => void) | undefined;
    mockAgentChatSessionSubscribe.mockImplementation((cb) => {
      chatCallback = cb;
      return vi.fn();
    });

    renderWithProvider(<div />);

    mockAgentChatSessionGetCurrentChatId.mockReturnValue('new-chat-id');
    act(() => {
      chatCallback!();
    });
    // No crash
  });

  it('handles mcpClientCacheManager.initialize error gracefully', async () => {
    mockMcpClientCacheManagerInitialize.mockRejectedValue(new Error('init failed'));
    // Should not throw
    await act(async () => {
      renderWithProvider(<div />);
    });
  });

  it('handles agentClientCacheManager.initialize error gracefully', async () => {
    mockUserRef.value = { login: 'testuser' };
    mockAgentClientCacheManagerInitialize.mockRejectedValue(new Error('agent init failed'));
    // Should not throw; the rejected initialize is caught and logged.
    await act(async () => {
      renderWithProvider(<div />);
    });
    await waitFor(() => {
      expect(mockAgentClientCacheManagerInitialize).toHaveBeenCalledWith('testuser');
    });
  });

  // ── MCP state update subscription ────────────────────────────────────────

  it('updates mcpServers when MCP subscription fires', async () => {
    let mcpCallback: ((data: any) => void) | undefined;
    mockMcpClientCacheManagerSubscribe.mockImplementation((cb) => {
      mcpCallback = cb;
      return vi.fn();
    });

    renderWithProvider(<div />);

    const newServers = [{ name: 'srv1', status: 'connected' }];
    act(() => {
      mcpCallback!({ servers: newServers });
    });
    expect(mockMcpClientCacheManagerGetMCPStats).toHaveBeenCalled();
  });

  // ── MCP server methods ────────────────────────────────────────────────────

  it('addMCPServer calls electronAPI.mcp.addServer and returns success', async () => {
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.addMCPServer({ name: 'srv', transport: 'stdio' } as any);
    expect(success).toBe(true);
    expect(mockAddServer).toHaveBeenCalled();
  });

  it('addMCPServer returns false when electronAPI reports failure', async () => {
    mockAddServer.mockResolvedValue({ success: false });
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.addMCPServer({ name: 'srv', transport: 'stdio' } as any);
    expect(success).toBe(false);
  });

  it('addMCPServer returns false on exception', async () => {
    mockAddServer.mockRejectedValue(new Error('network error'));
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.addMCPServer({ name: 'srv' } as any);
    expect(success).toBe(false);
  });

  it('updateMCPServer calls electronAPI.mcp.updateServer', async () => {
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.updateMCPServer('srv', { command: 'node' });
    expect(success).toBe(true);
    expect(mockUpdateServer).toHaveBeenCalled();
  });

  it('updateMCPServer returns false when electronAPI reports failure', async () => {
    mockUpdateServer.mockResolvedValue({ success: false });
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.updateMCPServer('srv', { command: 'node' });
    expect(success).toBe(false);
  });

  it('updateMCPServer returns false on exception', async () => {
    mockUpdateServer.mockRejectedValue(new Error('err'));
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.updateMCPServer('srv', {});
    expect(success).toBe(false);
  });

  it('deleteMCPServer calls electronAPI.mcp.deleteServer', async () => {
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.deleteMCPServer('srv');
    expect(success).toBe(true);
    expect(mockDeleteServer).toHaveBeenCalled();
  });

  it('deleteMCPServer returns false when electronAPI reports failure', async () => {
    mockDeleteServer.mockResolvedValue({ success: false });
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.deleteMCPServer('srv');
    expect(success).toBe(false);
  });

  it('deleteMCPServer returns false on exception', async () => {
    mockDeleteServer.mockRejectedValue(new Error('err'));
    const { result } = renderHookWithProvider(() => useProfileData());
    const success = await result.deleteMCPServer('srv');
    expect(success).toBe(false);
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  it('refresh calls profileDataManager.refresh when user is present', async () => {
    mockUserRef.value = { login: 'user' };
    const { result } = renderHookWithProvider(() => useProfileData());
    await result.refresh();
    expect(mockProfileDataManagerRefresh).toHaveBeenCalled();
  });

  it('refresh is no-op when no user', async () => {
    const { result } = renderHookWithProvider(() => useProfileData());
    await result.refresh();
    expect(mockProfileDataManagerRefresh).not.toHaveBeenCalled();
  });

  // ── refreshMCPRuntimeInfo ─────────────────────────────────────────────────

  it('refreshMCPRuntimeInfo calls getServerStatus', async () => {
    const { result } = renderHookWithProvider(() => useProfileData());
    await result.refreshMCPRuntimeInfo();
    expect(mockGetServerStatus).toHaveBeenCalled();
  });

  it('refreshMCPRuntimeInfo handles error gracefully', async () => {
    mockGetServerStatus.mockRejectedValue(new Error('status error'));
    const { result } = renderHookWithProvider(() => useProfileData());
    await expect(result.refreshMCPRuntimeInfo()).resolves.not.toThrow();
  });

  it('refreshMCPRuntimeInfo handles failed response', async () => {
    mockGetServerStatus.mockResolvedValue({ success: false });
    const { result } = renderHookWithProvider(() => useProfileData());
    await result.refreshMCPRuntimeInfo();
    // No crash expected
  });
});

// ── Hook tests ────────────────────────────────────────────────────────────────

/** Render a hook within the provider and return the hook result */
function renderHookWithProvider<T>(hook: () => T): { result: T } {
  let result: T;
  function Consumer() {
    result = hook();
    return null;
  }
  render(
    <ProfileDataProvider>
      <Consumer />
    </ProfileDataProvider>
  );
  return { get result() { return result!; } };
}

describe('useMCPServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: true, lastUpdated: 0, chats: [], skills: [] });
    mockProfileDataManagerSubscribe.mockReturnValue(vi.fn());
    mockMcpClientCacheManagerSubscribe.mockReturnValue(vi.fn());
    mockAgentChatSessionSubscribe.mockReturnValue(vi.fn());
    (window as any).electronAPI = mockElectronAPI;
  });

  it('returns servers and stats', () => {
    const servers = [{ name: 's', status: 'connected' }] as any;
    const stats = { totalServers: 1, connectedServers: 1, disconnectedServers: 0, errorServers: 0, totalTools: 0 };
    mockMcpClientCacheManagerGetMCPServers.mockReturnValue(servers);
    mockMcpClientCacheManagerGetMCPStats.mockReturnValue(stats);
    const { result } = renderHookWithProvider(() => useMCPServers());
    expect(result.servers).toEqual(servers);
    expect(result.stats).toEqual(stats);
  });

  it('returns getAllMCPTools result', () => {
    mockMcpClientCacheManagerGetAllMCPTools.mockReturnValue([{ name: 'tool1' }] as any);
    const { result } = renderHookWithProvider(() => useMCPServers());
    expect(result.tools).toHaveLength(1);
  });


  it('getServerByName returns server from cache', () => {
    const server = { name: 'srv', status: 'connected' } as any;
    mockMcpClientCacheManagerGetMCPServerByName.mockReturnValue(server);
    const { result } = renderHookWithProvider(() => useMCPServers());
    expect(result.getServerByName('srv')).toEqual(server);
  });

  it('refreshRuntimeInfo calls refreshMCPRuntimeInfo', async () => {
    const { result } = renderHookWithProvider(() => useMCPServers());
    await result.refreshRuntimeInfo();
    expect(mockGetServerStatus).toHaveBeenCalled();
  });
});

describe('useProfileDataReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileDataManagerSubscribe.mockReturnValue(vi.fn());
    mockMcpClientCacheManagerSubscribe.mockReturnValue(vi.fn());
    mockAgentChatSessionSubscribe.mockReturnValue(vi.fn());
    (window as any).electronAPI = mockElectronAPI;
  });

  it('returns isReady=false when not initialized', () => {
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: false, lastUpdated: 0, chats: [], skills: [] });
    const { result } = renderHookWithProvider(() => useProfileDataReady());
    expect(result.isReady).toBe(false);
    expect(result.isInitialized).toBe(false);
  });

  it('returns isReady=true when initialized and not loading', () => {
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: true, lastUpdated: 0, chats: [], skills: [] });
    const { result } = renderHookWithProvider(() => useProfileDataReady());
    expect(result.isReady).toBe(true);
  });
});

describe('useChats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: true, lastUpdated: 0, chats: ['c1', 'c2'] as any, skills: [] });
    mockProfileDataManagerSubscribe.mockReturnValue(vi.fn());
    mockMcpClientCacheManagerSubscribe.mockReturnValue(vi.fn());
    mockAgentChatSessionSubscribe.mockReturnValue(vi.fn());
    (window as any).electronAPI = mockElectronAPI;
  });

  it('returns chats array', () => {
    const { result } = renderHookWithProvider(() => useChats());
    expect(result.chats).toEqual(['c1', 'c2']);
  });

  it('addChat delegates to chatOps', async () => {
    const { result } = renderHookWithProvider(() => useChats());
    await result.addChat({ name: 'new' } as any);
    expect(mockChatOpsAddChatConfig).toHaveBeenCalledWith({ name: 'new' });
  });

  it('updateChat delegates to chatOps', async () => {
    const { result } = renderHookWithProvider(() => useChats());
    await result.updateChat('chat-id', { name: 'updated' } as any);
    expect(mockChatOpsUpdateChatConfig).toHaveBeenCalledWith('chat-id', { name: 'updated' });
  });

  it('updateChatAgent delegates to chatOps', async () => {
    const { result } = renderHookWithProvider(() => useChats());
    await result.updateChatAgent('chat-id', { name: 'Renamed' } as any);
    expect(mockChatOpsUpdateChatAgent).toHaveBeenCalledWith('chat-id', { name: 'Renamed' });
  });

  it('deleteChat delegates to chatOps', async () => {
    const { result } = renderHookWithProvider(() => useChats());
    await result.deleteChat('chat-id');
    expect(mockChatOpsDeleteChatConfig).toHaveBeenCalledWith('chat-id');
  });
});

describe('useAgentConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: true, lastUpdated: 0, chats: [], skills: [] });
    mockProfileDataManagerSubscribe.mockReturnValue(vi.fn());
    mockMcpClientCacheManagerSubscribe.mockReturnValue(vi.fn());
    mockAgentChatSessionSubscribe.mockReturnValue(vi.fn());
    mockAgentChatSessionGetCurrentChatId.mockReturnValue('chat-1');
    mockChatOpsUpdateChatAgent.mockResolvedValue({ success: true });
    (window as any).electronAPI = mockElectronAPI;
  });


  it('updateModel calls chatOps.updateChatAgent', async () => {
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateModel('gpt-4o');
    expect(mockChatOpsUpdateChatAgent).toHaveBeenCalledWith('chat-1', { model: 'gpt-4o' });
    expect(res.success).toBe(true);
  });

  it('updateModel returns error when no currentChatId', async () => {
    mockAgentChatSessionGetCurrentChatId.mockReturnValue(null);
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateModel('gpt-4o');
    expect(res.success).toBe(false);
    expect(res.error).toBe('No current chat');
  });

  it('updateModel handles exception', async () => {
    mockChatOpsUpdateChatAgent.mockRejectedValue(new Error('update failed'));
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateModel('gpt-4');
    expect(res.success).toBe(false);
    expect(res.error).toBe('update failed');
  });

  it('updateModel stringifies non-Error exceptions', async () => {
    mockChatOpsUpdateChatAgent.mockRejectedValue('update failed');
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateModel('gpt-4');
    expect(res.success).toBe(false);
    expect(res.error).toBe('update failed');
  });

  it('updateMcpServers calls chatOps.updateChatAgent', async () => {
    const { result } = renderHookWithProvider(() => useAgentConfig());
    await result.updateMcpServers([{ name: 'mcp' }] as any);
    expect(mockChatOpsUpdateChatAgent).toHaveBeenCalledWith('chat-1', { mcp_servers: [{ name: 'mcp' }] });
  });

  it('updateMcpServers returns error when no currentChatId', async () => {
    mockAgentChatSessionGetCurrentChatId.mockReturnValue(null);
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateMcpServers([]);
    expect(res.success).toBe(false);
  });

  it('updateMcpServers handles exception', async () => {
    mockChatOpsUpdateChatAgent.mockRejectedValue(new Error('mcp update failed'));
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateMcpServers([]);
    expect(res.success).toBe(false);
  });

  it('updateMcpServers stringifies non-Error exceptions', async () => {
    mockChatOpsUpdateChatAgent.mockRejectedValue('mcp update failed');
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateMcpServers([]);
    expect(res.success).toBe(false);
    expect(res.error).toBe('mcp update failed');
  });

  it('updateConfig calls chatOps.updateChatAgent', async () => {
    const { result } = renderHookWithProvider(() => useAgentConfig());
    await result.updateConfig({ name: 'new-name' } as any);
    expect(mockChatOpsUpdateChatAgent).toHaveBeenCalledWith('chat-1', { name: 'new-name' });
  });

  it('updateConfig returns error when no currentChatId', async () => {
    mockAgentChatSessionGetCurrentChatId.mockReturnValue(null);
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateConfig({});
    expect(res.success).toBe(false);
  });

  it('updateConfig handles exception', async () => {
    mockChatOpsUpdateChatAgent.mockRejectedValue(new Error('config update failed'));
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateConfig({});
    expect(res.success).toBe(false);
  });

  it('updateConfig stringifies non-Error exceptions', async () => {
    mockChatOpsUpdateChatAgent.mockRejectedValue('config update failed');
    const { result } = renderHookWithProvider(() => useAgentConfig());
    const res = await result.updateConfig({});
    expect(res.success).toBe(false);
    expect(res.error).toBe('config update failed');
  });

  it('subscribes to chat session id changes', () => {
    renderHookWithProvider(() => useAgentConfig());
    expect(mockAgentChatSessionSubscribe).toHaveBeenCalled();
  });

  it('updates currentChatId when chat session changes', async () => {
    const chatCallbacks: Array<() => void> = [];
    mockAgentChatSessionSubscribe.mockImplementation((cb) => {
      chatCallbacks.push(cb);
      return vi.fn();
    });
    const { result } = renderHookWithProvider(() => useAgentConfig());
    mockAgentChatSessionGetCurrentChatId.mockReturnValue('chat-2');
    act(() => { chatCallbacks.forEach((callback) => callback()); });
    await waitFor(() => {
      expect(mockAgentChatSessionGetCurrentChatId).toHaveBeenCalled();
    });
    await result.updateModel('m');
    expect(mockChatOpsUpdateChatAgent).toHaveBeenCalledWith(expect.any(String), { model: 'm' });
  });
});

describe('useProfileDataRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: true, lastUpdated: 0, chats: [], skills: [] });
    mockProfileDataManagerSubscribe.mockReturnValue(vi.fn());
    mockMcpClientCacheManagerSubscribe.mockReturnValue(vi.fn());
    mockAgentChatSessionSubscribe.mockReturnValue(vi.fn());
    (window as any).electronAPI = mockElectronAPI;
  });

  it('returns refresh, refreshMCPRuntimeInfo, isLoading, isDataStale', () => {
    const { result } = renderHookWithProvider(() => useProfileDataRefresh());
    expect(result.refresh).toBeDefined();
    expect(result.refreshMCPRuntimeInfo).toBeDefined();
    expect(result.isDataStale).toBeDefined();
  });

  it('isDataStale calls profileDataManager.isDataStale', () => {
    mockProfileDataManagerIsDataStale.mockReturnValue(true);
    const { result } = renderHookWithProvider(() => useProfileDataRefresh());
    expect(result.isDataStale(5000)).toBe(true);
  });
});

describe('useSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileDataManagerSubscribe.mockReturnValue(vi.fn());
    mockMcpClientCacheManagerSubscribe.mockReturnValue(vi.fn());
    mockAgentChatSessionSubscribe.mockReturnValue(vi.fn());
    mockProfileDataManagerGetSkillsStats.mockReturnValue({ total: 1 });
    mockProfileDataManagerGetSkillByName.mockReturnValue({ name: 'skill-a' });
    mockProfileDataManagerGetCurrentAgentSkills.mockReturnValue([{ name: 'skill-a' }]);
    (window as any).electronAPI = mockElectronAPI;
  });

  it('returns skills from profile data and delegates skill helpers', () => {
    const skills = [{ name: 'skill-a' }];
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: true, lastUpdated: 0, chats: [], skills });
    const { result } = renderHookWithProvider(() => useSkills());

    expect(result.skills).toEqual(skills);
    expect(result.stats).toEqual({ total: 1 });
    expect(result.getSkillByName('skill-a')).toEqual({ name: 'skill-a' });
    expect(result.getCurrentAgentSkills()).toEqual([{ name: 'skill-a' }]);
    expect(mockProfileDataManagerGetSkillByName).toHaveBeenCalledWith('skill-a');
  });

  it('falls back to an empty skills array when profile data omits skills', () => {
    mockProfileDataManagerGetCache.mockReturnValue({ isInitialized: true, lastUpdated: 0, chats: [] });
    const { result } = renderHookWithProvider(() => useSkills());

    expect(result.skills).toEqual([]);
  });
});
