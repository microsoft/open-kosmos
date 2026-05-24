// @vitest-environment happy-dom
const getProfileMock = vi.fn();
const onCacheUpdatedMock = vi.fn();

Object.defineProperty(global, 'window', {
  value: {},
  writable: true,
});

Object.defineProperty((global as any).window, 'electronAPI', {
  value: {
    profile: {
      getProfile: getProfileMock,
      onCacheUpdated: onCacheUpdatedMock,
      onAutoSelectChatSession: vi.fn(),
    },
    mcp: {
      onServerStatesUpdated: vi.fn(() => vi.fn()),
    },
    agentChat: {
      onStreamingChunk: vi.fn(),
      onStreamingMetrics: vi.fn(),
      onToolUse: vi.fn(),
      onToolResult: vi.fn(),
      onContextChange: vi.fn(),
      onInteractionRequest: vi.fn(),
      onInteractionProcessed: vi.fn(),
      onChatStatusChanged: vi.fn(),
    },
  },
  writable: true,
});

import { ProfileDataManager } from '../profileDataManager';

describe('ProfileDataManager.initialize', () => {
  const createProfile = () => ({
    alias: 'testuser',
    chats: [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          name: 'Kobi',
          role: 'Default Assistant',
          workspace: '',
          mcp_servers: [],
          skills: [],
        },
      },
    ],
    skills: [],
    sub_agents: [],
    mcp_servers: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (ProfileDataManager as any).instance = null;
  });

  afterEach(() => {
    (ProfileDataManager as any).instance = null;
  });

  it('ignores early profile pushes before userAlias is initialized', () => {
    const manager = ProfileDataManager.getInstance();
    const profile = createProfile();

    (manager as any).handleProfileCacheUpdate({
      alias: 'testuser',
      profile,
      timestamp: Date.now(),
    });

    expect(manager.getCache().isInitialized).toBe(false);
    expect(manager.getCache().profile).toBeNull();
  });

  it('hydrates cache from getProfile fallback when the initial push was missed', async () => {
    const manager = ProfileDataManager.getInstance();
    const profile = createProfile();

    // Simulate the original race: main process pushed profile before auth_set/userAlias init.
    (manager as any).handleProfileCacheUpdate({
      alias: 'testuser',
      profile,
      timestamp: Date.now() - 1000,
    });

    getProfileMock.mockResolvedValue({
      success: true,
      data: profile,
    });

    await manager.initialize('testuser');

    expect(getProfileMock).toHaveBeenCalledWith('testuser');
    expect(manager.getCache().isInitialized).toBe(true);
    expect(manager.getCache().profile).toEqual(profile);
    expect(manager.getCache().chats).toHaveLength(1);
  });
});