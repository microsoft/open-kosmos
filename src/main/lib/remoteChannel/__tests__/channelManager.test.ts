vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'kosmos',
  APP_NAME: 'OpenKosmos',
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    syncStarredChatSessionIndex: vi.fn().mockResolvedValue(undefined),
    updateRemoteChannelsConfig: vi.fn().mockResolvedValue(undefined),
    forceNotifyProfileDataManager: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    patchMetadata: vi.fn(),
    renameSession: vi.fn(),
    ensureLoaded: vi.fn(),
    getAllSessions: vi.fn(),
    createSession: vi.fn(),
  },
}));

vi.mock('../../chat/agentChatManager', () => ({
  AgentChatManager: { getInstance: vi.fn(() => ({ updateSessionTitle: vi.fn() })) },
  agentChatManager: {
    switchToChatSession: vi.fn().mockResolvedValue(undefined),
    generateChatSessionId: vi.fn(() => 'sess-new'),
    getInstanceByChatSessionId: vi.fn(() => null),
    streamMessage: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

vi.mock('../../userDataADO/types/profile', () => ({
  isBuiltinAgent: vi.fn(() => false),
}));

vi.mock('../../userDataADO/chatSessionManager', () => ({
  chatSessionManager: {
    getChatSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    getChatSessionFile: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../agentBridge/sessionPersistence', () => ({
  loadSessionMap: vi.fn().mockResolvedValue(new Map()),
  createPersistScheduler: vi.fn(() => ({ schedule: vi.fn(), cancel: vi.fn() })),
  pruneSessionMap: vi.fn(),
  persistSessionMap: vi.fn().mockResolvedValue(undefined),
  getSessionMapPath: vi.fn(() => '/tmp/sessions.json'),
}));

vi.mock('../agentBridge/attachmentPipeline', () => ({
  downloadAndBuildParts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../agentBridge/sessionLifecycle', () => ({
  demoteSession: vi.fn().mockResolvedValue(undefined),
  demoteOrphanedSessions: vi.fn().mockResolvedValue(undefined),
  registerRemoteSession: vi.fn().mockResolvedValue(undefined),
  resolveChatId: vi.fn(() => 'default-chat'),
  updateRemoteSessionTitle: vi.fn().mockResolvedValue(undefined),
  markSessionAsRemote: vi.fn().mockResolvedValue(undefined),
}));

const mockAgentBridgeInstance = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  handleInboundMessage: vi.fn().mockResolvedValue({ text: 'reply', replyToConversationId: 'u1' }),
  removeSessionByChatSessionId: vi.fn(() => null),
  clearSessionsForChannel: vi.fn(),
  handleChannelUnbound: vi.fn().mockResolvedValue(undefined),
  getSessionMap: vi.fn(() => new Map()),
  destroy: vi.fn(),
}));

vi.mock('../agentBridge/index', () => ({
  AgentBridge: {
    getInstance: vi.fn(() => mockAgentBridgeInstance),
  },
}));

vi.mock('../credentialStore', () => ({
  credentialStore: {
    getCredential: vi.fn().mockResolvedValue(null),
    setCredential: vi.fn().mockResolvedValue(undefined),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    hasCredential: vi.fn().mockResolvedValue(false),
  },
}));

import { RemoteChannelManager } from '../channelManager';
import { credentialStore } from '../credentialStore';
import { AgentBridge } from '../agentBridge/index';

function resetInstance() {
  (RemoteChannelManager as any).instance = undefined;
}

function createMockPlugin(id = 'test-channel') {
  return {
    id,
    meta: { label: 'Test' },
    capabilities: { chatTypes: ['direct'], media: false },
    config: { isConfigured: vi.fn(() => true), isEnabled: vi.fn(() => true) },
    gateway: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      bind: vi.fn().mockResolvedValue({ success: true, userId: 'u1' }),
      unbind: vi.fn().mockResolvedValue(undefined),
    },
    outbound: {
      textChunkLimit: 1000,
      sendText: vi.fn().mockResolvedValue(undefined),
      sendProactive: vi.fn().mockResolvedValue(undefined),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('RemoteChannelManager', () => {
  beforeEach(async () => {
    resetInstance();
    vi.clearAllMocks();
    // Restore stable mock implementations after clearAllMocks
    mockAgentBridgeInstance.initialize.mockResolvedValue(undefined);
    mockAgentBridgeInstance.handleInboundMessage.mockResolvedValue({ text: 'reply', replyToConversationId: 'u1' });
    mockAgentBridgeInstance.removeSessionByChatSessionId.mockReturnValue(null);
    mockAgentBridgeInstance.handleChannelUnbound.mockResolvedValue(undefined);
    mockAgentBridgeInstance.getSessionMap.mockReturnValue(new Map());
    const manager = RemoteChannelManager.getInstance();
    await manager.initialize('user1');
  });

  afterEach(() => {
    resetInstance();
  });

  it('getInstance returns singleton', () => {
    const a = RemoteChannelManager.getInstance();
    const b = RemoteChannelManager.getInstance();
    expect(a).toBe(b);
  });

  it('getAlias returns initialized alias', () => {
    expect(RemoteChannelManager.getInstance().getAlias()).toBe('user1');
  });

  it('registerPlugin adds plugin and initializes status', () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    const status = manager.getChannelStatus('ch1');
    expect(status?.status).toBe('stopped');
  });

  it('startChannel calls plugin.gateway.start', async () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await manager.startChannel('ch1');
    expect(plugin.gateway.start).toHaveBeenCalled();
  });

  it('startChannel does nothing for unknown plugin', async () => {
    const manager = RemoteChannelManager.getInstance();
    await expect(manager.startChannel('unknown')).resolves.not.toThrow();
  });

  it('startChannel skips if already starting', async () => {
    const plugin = createMockPlugin('ch1');
    plugin.gateway.start = vi.fn().mockImplementation(async () => {
      // do nothing — status will be set to 'starting' before this resolves
    });
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await manager.startChannel('ch1');
    const status = manager.getChannelStatus('ch1');
    // After start() resolves, status stays 'starting' (mock does not call onStatusChange)
    // Second start should be skipped
    await manager.startChannel('ch1');
    expect(plugin.gateway.start).toHaveBeenCalledTimes(1);
  });

  it('stopChannel calls plugin.gateway.stop', async () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await manager.startChannel('ch1');
    await manager.stopChannel('ch1');
    expect(plugin.gateway.stop).toHaveBeenCalled();
  });

  it('stopChannel does nothing for unknown plugin', async () => {
    await expect(RemoteChannelManager.getInstance().stopChannel('unknown')).resolves.not.toThrow();
  });

  it('stopChannel handles stop error gracefully', async () => {
    const plugin = createMockPlugin('ch1');
    plugin.gateway.stop = vi.fn().mockRejectedValue(new Error('stop failed'));
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await expect(manager.stopChannel('ch1')).resolves.not.toThrow();
  });

  it('restartChannel calls stop then start', async () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await manager.restartChannel('ch1');
    expect(plugin.gateway.stop).toHaveBeenCalled();
    expect(plugin.gateway.start).toHaveBeenCalled();
  });

  it('getAllChannelStatus returns all statuses', () => {
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(createMockPlugin('ch1') as any);
    manager.registerPlugin(createMockPlugin('ch2') as any);
    const all = manager.getAllChannelStatus();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('setStatusChangeListener is called on status change', async () => {
    const plugin = createMockPlugin('ch1');
    const onStatusChange = vi.fn();
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    manager.setStatusChangeListener(onStatusChange);
    await manager.startChannel('ch1');
    expect(onStatusChange).toHaveBeenCalled();
  });

  it('setBindingChangeListener is called on bind', async () => {
    const plugin = createMockPlugin('ch1');
    const onBindChange = vi.fn();
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    manager.setBindingChangeListener(onBindChange);
    await manager.bind('ch1', 'my-code');
    expect(onBindChange).toHaveBeenCalledWith({ channelId: 'ch1', bound: true });
  });

  it('bind throws if plugin not found', async () => {
    await expect(RemoteChannelManager.getInstance().bind('unknown', 'code')).rejects.toThrow();
  });

  it('bind throws if bind fails', async () => {
    const plugin = createMockPlugin('ch1');
    plugin.gateway.bind = vi.fn().mockResolvedValue({ success: false, error: 'bad code' });
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await expect(manager.bind('ch1', 'code')).rejects.toThrow('bad code');
  });

  it('unbind calls gateway.unbind and handles channel unbound', async () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await manager.unbind('ch1');
    expect(plugin.gateway.unbind).toHaveBeenCalled();
  });

  it('unbind throws if plugin not found', async () => {
    await expect(RemoteChannelManager.getInstance().unbind('unknown')).rejects.toThrow();
  });

  it('sendTyping calls plugin outbound.sendTyping', () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    manager.sendTyping('ch1');
    expect(plugin.outbound.sendTyping).toHaveBeenCalled();
  });

  it('sendTyping is no-op for unknown channel', () => {
    expect(() => RemoteChannelManager.getInstance().sendTyping('unknown')).not.toThrow();
  });

  it('notifySessionDeleted does nothing when session not found', async () => {
    (AgentBridge.getInstance().removeSessionByChatSessionId as any).mockReturnValue(null);
    await expect(RemoteChannelManager.getInstance().notifySessionDeleted('s1')).resolves.not.toThrow();
  });

  it('notifySessionDeleted notifies user when session found', async () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    (AgentBridge.getInstance().removeSessionByChatSessionId as any).mockReturnValue({ channelId: 'ch1', userId: 'u1' });
    await manager.notifySessionDeleted('s1');
    expect(plugin.outbound.sendProactive).toHaveBeenCalled();
  });

  it('notifyBoundUser sends to running channels', async () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);

    // Simulate running status by calling onStatusChange
    const ctx = (plugin.gateway.start as any).mock;
    // Instead, directly manipulate statusMap via startChannel with status callback
    // Use private method approach via side-effect
    (plugin.gateway.start as any).mockImplementation(async (context: any) => {
      context.onStatusChange('running');
    });
    await manager.startChannel('ch1');

    (credentialStore.getCredential as any).mockResolvedValue('user-bound-id');
    await manager.notifyBoundUser('user1', 'hello');
    expect(plugin.outbound.sendProactive).toHaveBeenCalledWith('user-bound-id', 'hello');
  });

  it('notifyBoundUser skips channels not running', async () => {
    const plugin = createMockPlugin('ch1');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    // Status remains 'stopped'
    (credentialStore.getCredential as any).mockResolvedValue('u1');
    await manager.notifyBoundUser('user1', 'hello');
    expect(plugin.outbound.sendProactive).not.toHaveBeenCalled();
  });

  it('notifyBoundUser is no-op for empty alias or text', async () => {
    await expect(RemoteChannelManager.getInstance().notifyBoundUser('', 'hello')).resolves.not.toThrow();
    await expect(RemoteChannelManager.getInstance().notifyBoundUser('user1', '')).resolves.not.toThrow();
  });

  it('stopAll stops all plugins', async () => {
    const p1 = createMockPlugin('ch1');
    const p2 = createMockPlugin('ch2');
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(p1 as any);
    manager.registerPlugin(p2 as any);
    await manager.stopAll();
    expect(p1.gateway.stop).toHaveBeenCalled();
    expect(p2.gateway.stop).toHaveBeenCalled();
  });

  it('destroy clears all state', () => {
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(createMockPlugin('ch1') as any);
    manager.destroy();
    expect(manager.getAllChannelStatus().length).toBe(0);
  });

  it('onUnbound callback demotes sessions and notifies binding change', async () => {
    const plugin = createMockPlugin('ch1');
    const onBindChange = vi.fn();
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    manager.setBindingChangeListener(onBindChange);

    let capturedCtx: any;
    (plugin.gateway.start as any).mockImplementation(async (ctx: any) => {
      capturedCtx = ctx;
    });
    await manager.startChannel('ch1');
    capturedCtx.onUnbound('user-removed');

    expect(AgentBridge.getInstance().handleChannelUnbound).toHaveBeenCalledWith('ch1');
    expect(onBindChange).toHaveBeenCalledWith({ channelId: 'ch1', bound: false });
  });

  it('startChannel sets error status when plugin.gateway.start throws', async () => {
    const plugin = createMockPlugin('ch1');
    plugin.gateway.start = vi.fn().mockRejectedValue(new Error('connect fail'));
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await manager.startChannel('ch1');
    const status = manager.getChannelStatus('ch1');
    expect(status?.status).toBe('error');
    expect(status?.error).toContain('connect fail');
  });

  it('inbound message: duplicate activityId is ignored', async () => {
    const plugin = createMockPlugin('ch1');
    let capturedCtx: any;
    plugin.gateway.start = vi.fn().mockImplementation(async (ctx) => { capturedCtx = ctx; });
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await manager.startChannel('ch1');

    const msg = {
      channelId: 'ch1', activityId: 'dup-1', text: 'hi',
      userId: 'u1', conversationId: 'conv', timestamp: Date.now(),
    };
    capturedCtx.onInboundMessage(msg);
    // Call again with same activityId
    await new Promise(r => setTimeout(r, 10));
    capturedCtx.onInboundMessage(msg);
    // AgentBridge.handleInboundMessage should be called only once
    await new Promise(r => setTimeout(r, 10));
    expect(AgentBridge.getInstance().handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  it('inbound message: sends reply text and handles chunking', async () => {
    const plugin = createMockPlugin('ch1');
    plugin.outbound.textChunkLimit = 10;
    let capturedCtx: any;
    plugin.gateway.start = vi.fn().mockImplementation(async (ctx) => { capturedCtx = ctx; });
    (AgentBridge.getInstance().handleInboundMessage as any).mockResolvedValue({
      text: 'Hello World!', replyToConversationId: 'u1',
    });
    const manager = RemoteChannelManager.getInstance();
    manager.registerPlugin(plugin as any);
    await manager.startChannel('ch1');

    capturedCtx.onInboundMessage({
      channelId: 'ch1', activityId: 'act-x', text: 'hi',
      userId: 'u1', conversationId: 'conv', timestamp: Date.now(),
    });
    await new Promise(r => setTimeout(r, 20));
    // Text is 12 chars with limit 10, so 2 chunks
    expect(plugin.outbound.sendText).toHaveBeenCalledTimes(2);
  });
});
