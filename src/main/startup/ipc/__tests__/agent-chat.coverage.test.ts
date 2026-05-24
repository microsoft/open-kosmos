/**
 * agent-chat.ts IPC handler coverage tests
 */

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockHandle, mockShowOpenDialog,
  mockInstance, mockAgentChatManager,
  mockImportChatSessionFromFile, mockInteractiveRequestManager,
} = vi.hoisted(() => {
  const mockInstance = {
    getAgentInfo: vi.fn().mockResolvedValue({ currentModel: 'gpt-4', chatId: 'chat1' }),
    getDisplayMessages: vi.fn().mockReturnValue([]),
    getChatSessionId: vi.fn().mockReturnValue('session1'),
    getChatId: vi.fn().mockReturnValue('chat1'),
    getChatStatus: vi.fn().mockReturnValue('idle'),
    getChatStatusInfo: vi.fn().mockReturnValue({ status: 'idle' }),
    setEventSender: vi.fn(),
    replaceFilePathInSession: vi.fn().mockResolvedValue({ success: true, replacedCount: 1 }),
    getCurrentChatSession: vi.fn().mockReturnValue({ id: 'session1' }),
  };

  const mockAgentChatManager = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getCurrentInstance: vi.fn().mockReturnValue(mockInstance),
    getChatHistory: vi.fn().mockReturnValue([]),
    startNewChatFor: vi.fn().mockResolvedValue(mockInstance),
    getCurrentActiveChatSessionId: vi.fn().mockReturnValue('session1'),
    getInstanceByChatSessionId: vi.fn().mockReturnValue(mockInstance),
    streamMessage: vi.fn().mockResolvedValue({ success: true }),
    retryChat: vi.fn().mockResolvedValue({ success: true }),
    editUserMessage: vi.fn().mockResolvedValue({ success: true }),
    canEditUserMessage: vi.fn().mockReturnValue({ success: true, canEdit: true }),
    cancelChatSession: vi.fn().mockResolvedValue({ success: true }),
    syncChatHistory: vi.fn(),
    refreshCurrentInstance: vi.fn().mockResolvedValue(mockInstance),
    switchToChatSession: vi.fn().mockResolvedValue(mockInstance),
    getCurrentContextTokenUsage: vi.fn().mockReturnValue({ total: 100 }),
    cancelActiveToolExecution: vi.fn().mockResolvedValue({ success: true }),
    removeInstanceByChatSession: vi.fn(),
    forkChatSession: vi.fn().mockResolvedValue({ success: true }),
  };

  return {
    mockHandle: vi.fn(),
    mockShowOpenDialog: vi.fn(),
    mockInstance,
    mockAgentChatManager,
    mockImportChatSessionFromFile: vi.fn().mockResolvedValue({ success: true }),
    mockInteractiveRequestManager: { resolveRequest: vi.fn().mockReturnValue(true) },
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  ipcMain: { handle: (...args: any[]) => mockHandle(...args) },
  dialog: {
    showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args),
  },
}));

// ─── fs mock (prevent real fs calls from transitive deps) ─────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi.fn().mockReturnValue({ isDirectory: () => false, size: 0 }),
  readdirSync: vi.fn().mockReturnValue([]),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  promises: {
    readFile: vi.fn().mockResolvedValue('{}'),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── agentChatManager mock ────────────────────────────────────────────────────

vi.mock('../../../lib/chat/agentChatManager', () => ({
  agentChatManager: mockAgentChatManager,
}));

// ─── analyticsManager mock ────────────────────────────────────────────────────

vi.mock('../../../lib/analytics', () => ({
  analyticsManager: {
    recordChatMessageSent: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── importChatSessionFromFile mock ───────────────────────────────────────────

vi.mock('../../../lib/userDataADO/index', () => ({
  importChatSessionFromFile: (...args: any[]) => mockImportChatSessionFromFile(...args),
}));

// ─── interactiveRequestManager mock ──────────────────────────────────────────

vi.mock('../../../lib/chat/interactiveRequestManager', () => ({
  interactiveRequestManager: mockInteractiveRequestManager,
}));

// ─── lazy logger mock ─────────────────────────────────────────────────────────

const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
vi.mock('../lazy', () => ({
  getAdvancedLogger: () => mockLogger,
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

import registerAgentChat from '../agent-chat';

type HandlerFn = (event: any, ...args: any[]) => Promise<any>;

function buildCtx(overrides: Record<string, any> = {}): any {
  return {
    mainWindow: { id: 1 } as any,
    currentUserAlias: 'testuser',
    ...overrides,
  };
}

function registerAndCollect(ctx: any): Map<string, HandlerFn> {
  const handlers = new Map<string, HandlerFn>();
  mockHandle.mockImplementation((channel: string, fn: HandlerFn) => {
    handlers.set(channel, fn);
  });
  registerAgentChat(ctx);
  return handlers;
}

const fakeEvent = {
  sender: { isDestroyed: () => false, send: vi.fn() },
} as any;

// ─── tests ────────────────────────────────────────────────────────────────────

describe('agent-chat IPC handlers', () => {
  let handlers: Map<string, HandlerFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentChatManager.getCurrentInstance.mockReturnValue(mockInstance);
    mockAgentChatManager.getCurrentActiveChatSessionId.mockReturnValue('session1');
    mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(mockInstance);
    mockInstance.getChatStatus.mockReturnValue('idle');
    handlers = registerAndCollect(buildCtx());
  });

  // ── agentChat:initialize ──────────────────────────────────────────────────

  describe('agentChat:initialize', () => {
    it('initializes successfully', async () => {
      const result = await handlers.get('agentChat:initialize')!(fakeEvent, 'user1');
      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockAgentChatManager.initialize.mockRejectedValue(new Error('init error'));
      const result = await handlers.get('agentChat:initialize')!(fakeEvent, 'user1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('init error');
    });
  });

  // ── agentChat:getCurrentInstance ──────────────────────────────────────────

  describe('agentChat:getCurrentInstance', () => {
    it('returns agent info when instance exists', async () => {
      const result = await handlers.get('agentChat:getCurrentInstance')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns null data when no instance', async () => {
      mockAgentChatManager.getCurrentInstance.mockReturnValue(null);
      const result = await handlers.get('agentChat:getCurrentInstance')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.getCurrentInstance.mockImplementation(() => { throw new Error('err'); });
      const result = await handlers.get('agentChat:getCurrentInstance')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:getChatHistory ──────────────────────────────────────────────

  describe('agentChat:getChatHistory', () => {
    it('returns chat history', async () => {
      const result = await handlers.get('agentChat:getChatHistory')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.getChatHistory.mockImplementation(() => { throw new Error('err'); });
      const result = await handlers.get('agentChat:getChatHistory')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:getDisplayMessages ──────────────────────────────────────────

  describe('agentChat:getDisplayMessages', () => {
    it('returns messages', async () => {
      const result = await handlers.get('agentChat:getDisplayMessages')!(fakeEvent);
      expect(result.success).toBe(true);
    });

    it('returns error when no instance', async () => {
      mockAgentChatManager.getCurrentInstance.mockReturnValue(null);
      const result = await handlers.get('agentChat:getDisplayMessages')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:startNewChatFor ─────────────────────────────────────────────

  describe('agentChat:startNewChatFor', () => {
    it('returns session id on success', async () => {
      const result = await handlers.get('agentChat:startNewChatFor')!(fakeEvent, 'chat1');
      expect(result.success).toBe(true);
      expect(result.chatSessionId).toBe('session1');
    });

    it('returns failure when no instance returned', async () => {
      mockAgentChatManager.startNewChatFor.mockResolvedValue(null);
      const result = await handlers.get('agentChat:startNewChatFor')!(fakeEvent, 'chat1');
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.startNewChatFor.mockRejectedValue(new Error('err'));
      const result = await handlers.get('agentChat:startNewChatFor')!(fakeEvent, 'chat1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:streamMessage ───────────────────────────────────────────────

  describe('agentChat:streamMessage', () => {
    it('streams message successfully', async () => {
      const result = await handlers.get('agentChat:streamMessage')!(fakeEvent, { content: 'hello' });
      expect(result.success).toBe(true);
    });

    it('returns error when no active session', async () => {
      mockAgentChatManager.getCurrentActiveChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:streamMessage')!(fakeEvent, { content: 'hello' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No current chat session/);
    });

    it('returns error when no instance', async () => {
      mockAgentChatManager.getCurrentInstance.mockReturnValue(null);
      const result = await handlers.get('agentChat:streamMessage')!(fakeEvent, { content: 'hello' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No current agent instance/);
    });

    it('returns error when chat is not idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('streaming');
      const result = await handlers.get('agentChat:streamMessage')!(fakeEvent, { content: 'hello' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/streaming/);
    });

    it('uses targetChatSessionId when provided', async () => {
      const result = await handlers.get('agentChat:streamMessage')!(fakeEvent, { content: 'hello' }, 'session2');
      expect(mockAgentChatManager.getInstanceByChatSessionId).toHaveBeenCalledWith('session2');
    });

    it('handles HTTP error codes', async () => {
      const err = Object.assign(new Error('unauthorized'), { statusCode: 401 });
      mockAgentChatManager.streamMessage.mockRejectedValue(err);
      const result = await handlers.get('agentChat:streamMessage')!(fakeEvent, { content: 'hello' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/HTTP 401/);
    });
  });

  // ── agentChat:retryChat ───────────────────────────────────────────────────

  describe('agentChat:retryChat', () => {
    it('retries successfully', async () => {
      const result = await handlers.get('agentChat:retryChat')!(fakeEvent, 'session1');
      expect(result.success).toBe(true);
    });

    it('returns error when no session', async () => {
      mockAgentChatManager.getCurrentActiveChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:retryChat')!(fakeEvent, '');
      expect(result.success).toBe(false);
    });

    it('returns error when no instance', async () => {
      mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:retryChat')!(fakeEvent, 'session1');
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.retryChat.mockRejectedValue(new Error('retry error'));
      const result = await handlers.get('agentChat:retryChat')!(fakeEvent, 'session1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:editUserMessage ─────────────────────────────────────────────

  describe('agentChat:editUserMessage', () => {
    it('edits successfully', async () => {
      const result = await handlers.get('agentChat:editUserMessage')!(fakeEvent, 'session1', 'msg1', { content: 'updated' });
      expect(result.success).toBe(true);
    });

    it('returns error when no session', async () => {
      mockAgentChatManager.getCurrentActiveChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:editUserMessage')!(fakeEvent, '', 'msg1', {});
      expect(result.success).toBe(false);
    });

    it('returns error when no instance', async () => {
      mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:editUserMessage')!(fakeEvent, 'session1', 'msg1', {});
      expect(result.success).toBe(false);
    });

    it('clears event sender in finally', async () => {
      await handlers.get('agentChat:editUserMessage')!(fakeEvent, 'session1', 'msg1', {});
      expect(mockInstance.setEventSender).toHaveBeenLastCalledWith(null);
    });
  });

  // ── agentChat:canEditUserMessage ──────────────────────────────────────────

  describe('agentChat:canEditUserMessage', () => {
    it('returns result', async () => {
      const result = await handlers.get('agentChat:canEditUserMessage')!(fakeEvent, 'session1', 'msg1');
      expect(result).toBeDefined();
    });

    it('returns error when no session', async () => {
      mockAgentChatManager.getCurrentActiveChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:canEditUserMessage')!(fakeEvent, '', 'msg1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:cancelChat ──────────────────────────────────────────────────

  describe('agentChat:cancelChat', () => {
    it('cancels successfully', async () => {
      const result = await handlers.get('agentChat:cancelChat')!(fakeEvent, 'chat1');
      expect(result.success).toBe(true);
    });

    it('returns error when no active session', async () => {
      mockAgentChatManager.getCurrentActiveChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:cancelChat')!(fakeEvent, 'chat1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:syncChatHistory ─────────────────────────────────────────────

  describe('agentChat:syncChatHistory', () => {
    it('syncs successfully', async () => {
      const result = await handlers.get('agentChat:syncChatHistory')!(fakeEvent, []);
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.syncChatHistory.mockImplementation(() => { throw new Error('sync error'); });
      const result = await handlers.get('agentChat:syncChatHistory')!(fakeEvent, []);
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:getCurrentChatId ────────────────────────────────────────────

  describe('agentChat:getCurrentChatId', () => {
    it('returns chat id', async () => {
      const result = await handlers.get('agentChat:getCurrentChatId')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toBe('chat1');
    });

    it('returns null when no instance', async () => {
      mockAgentChatManager.getCurrentInstance.mockReturnValue(null);
      const result = await handlers.get('agentChat:getCurrentChatId')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  // ── agentChat:refreshCurrentInstance ─────────────────────────────────────

  describe('agentChat:refreshCurrentInstance', () => {
    it('refreshes and returns agent info', async () => {
      const result = await handlers.get('agentChat:refreshCurrentInstance')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns error when refresh returns null', async () => {
      mockAgentChatManager.refreshCurrentInstance.mockResolvedValue(null);
      const result = await handlers.get('agentChat:refreshCurrentInstance')!(fakeEvent);
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.refreshCurrentInstance.mockRejectedValue(new Error('refresh error'));
      const result = await handlers.get('agentChat:refreshCurrentInstance')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:switchToChatSession ─────────────────────────────────────────

  describe('agentChat:switchToChatSession', () => {
    it('switches and returns agent info', async () => {
      const result = await handlers.get('agentChat:switchToChatSession')!(fakeEvent, 'chat1', 'session1');
      expect(result.success).toBe(true);
    });

    it('returns error when switch returns null', async () => {
      mockAgentChatManager.switchToChatSession.mockResolvedValue(null);
      const result = await handlers.get('agentChat:switchToChatSession')!(fakeEvent, 'chat1', 'session1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:getChatStatusInfo ───────────────────────────────────────────

  describe('agentChat:getChatStatusInfo', () => {
    it('returns status info', async () => {
      const result = await handlers.get('agentChat:getChatStatusInfo')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: 'idle' });
    });

    it('returns error when no instance', async () => {
      mockAgentChatManager.getCurrentInstance.mockReturnValue(null);
      const result = await handlers.get('agentChat:getChatStatusInfo')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:getCurrentContextTokenUsage ────────────────────────────────

  describe('agentChat:getCurrentContextTokenUsage', () => {
    it('returns token usage', async () => {
      const result = await handlers.get('agentChat:getCurrentContextTokenUsage')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ total: 100 });
    });

    it('returns error when no usage', async () => {
      mockAgentChatManager.getCurrentContextTokenUsage.mockReturnValue(null);
      const result = await handlers.get('agentChat:getCurrentContextTokenUsage')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:cancelChatSession ───────────────────────────────────────────

  describe('agentChat:cancelChatSession', () => {
    it('cancels session', async () => {
      const result = await handlers.get('agentChat:cancelChatSession')!(fakeEvent, 'session1');
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.cancelChatSession.mockRejectedValue(new Error('cancel error'));
      const result = await handlers.get('agentChat:cancelChatSession')!(fakeEvent, 'session1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:cancelActiveToolExecution ──────────────────────────────────

  describe('agentChat:cancelActiveToolExecution', () => {
    it('cancels tool execution', async () => {
      const result = await handlers.get('agentChat:cancelActiveToolExecution')!(fakeEvent, 'session1');
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.cancelActiveToolExecution.mockRejectedValue(new Error('err'));
      const result = await handlers.get('agentChat:cancelActiveToolExecution')!(fakeEvent, 'session1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:removeAgentChatInstance ────────────────────────────────────

  describe('agentChat:removeAgentChatInstance', () => {
    it('removes instance', async () => {
      const result = await handlers.get('agentChat:removeAgentChatInstance')!(fakeEvent, 'session1');
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.removeInstanceByChatSession.mockImplementation(() => { throw new Error('err'); });
      const result = await handlers.get('agentChat:removeAgentChatInstance')!(fakeEvent, 'session1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:forkChatSession ─────────────────────────────────────────────

  describe('agentChat:forkChatSession', () => {
    it('forks session', async () => {
      const result = await handlers.get('agentChat:forkChatSession')!(fakeEvent, 'chat1', 'session1');
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockAgentChatManager.forkChatSession.mockRejectedValue(new Error('fork error'));
      const result = await handlers.get('agentChat:forkChatSession')!(fakeEvent, 'chat1', 'session1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:importChatSession ───────────────────────────────────────────

  describe('agentChat:importChatSession', () => {
    it('returns error when no user alias', async () => {
      const h = registerAndCollect(buildCtx({ currentUserAlias: null }));
      const result = await h.get('agentChat:importChatSession')!(fakeEvent, 'chat1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No current user alias/);
    });

    it('returns error when no main window', async () => {
      const h = registerAndCollect(buildCtx({ mainWindow: null }));
      const result = await h.get('agentChat:importChatSession')!(fakeEvent, 'chat1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No main window/);
    });

    it('returns error when dialog canceled (new API)', async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      const result = await handlers.get('agentChat:importChatSession')!(fakeEvent, 'chat1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/canceled/);
    });

    it('imports file successfully (new API)', async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/path/session.json'] });
      mockImportChatSessionFromFile.mockResolvedValue({ success: true });
      const result = await handlers.get('agentChat:importChatSession')!(fakeEvent, 'chat1');
      expect(result.success).toBe(true);
      expect(mockImportChatSessionFromFile).toHaveBeenCalledWith('testuser', 'chat1', '/path/session.json');
    });

    it('handles old API format — empty array', async () => {
      mockShowOpenDialog.mockResolvedValue([]);
      const result = await handlers.get('agentChat:importChatSession')!(fakeEvent, 'chat1');
      expect(result.success).toBe(false);
    });

    it('handles old API format — with path', async () => {
      mockShowOpenDialog.mockResolvedValue(['/path/session.json']);
      mockImportChatSessionFromFile.mockResolvedValue({ success: true });
      const result = await handlers.get('agentChat:importChatSession')!(fakeEvent, 'chat1');
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockShowOpenDialog.mockRejectedValue(new Error('dialog error'));
      const result = await handlers.get('agentChat:importChatSession')!(fakeEvent, 'chat1');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:replaceFilePathInSession ────────────────────────────────────

  describe('agentChat:replaceFilePathInSession', () => {
    it('replaces file path', async () => {
      const result = await handlers.get('agentChat:replaceFilePathInSession')!(fakeEvent, '/old', '/new');
      expect(result.success).toBe(true);
    });

    it('returns error when no instance', async () => {
      mockAgentChatManager.getCurrentInstance.mockReturnValue(null);
      const result = await handlers.get('agentChat:replaceFilePathInSession')!(fakeEvent, '/old', '/new');
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      mockInstance.replaceFilePathInSession.mockRejectedValue(new Error('replace error'));
      const result = await handlers.get('agentChat:replaceFilePathInSession')!(fakeEvent, '/old', '/new');
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:getCurrentChatSession ──────────────────────────────────────

  describe('agentChat:getCurrentChatSession', () => {
    it('returns current session', async () => {
      const result = await handlers.get('agentChat:getCurrentChatSession')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'session1' });
    });

    it('returns error when no instance', async () => {
      mockAgentChatManager.getCurrentInstance.mockReturnValue(null);
      const result = await handlers.get('agentChat:getCurrentChatSession')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── agentChat:sendInteractionResponse ────────────────────────────────────

  describe('agentChat:sendInteractionResponse', () => {
    it('resolves interaction successfully', async () => {
      mockInteractiveRequestManager.resolveRequest.mockReturnValue(true);
      const result = await handlers.get('agentChat:sendInteractionResponse')!(fakeEvent, {
        interactionId: 'i1',
        chatSessionId: 'session1',
        requestType: 'confirm',
        action: 'accept',
      });
      expect(result.success).toBe(true);
    });

    it('returns error when no pending request', async () => {
      mockInteractiveRequestManager.resolveRequest.mockReturnValue(false);
      const result = await handlers.get('agentChat:sendInteractionResponse')!(fakeEvent, {
        chatSessionId: 'session1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No pending interactive request/);
    });

    it('returns error on exception', async () => {
      mockInteractiveRequestManager.resolveRequest.mockImplementation(() => { throw new Error('resolve error'); });
      const result = await handlers.get('agentChat:sendInteractionResponse')!(fakeEvent, {});
      expect(result.success).toBe(false);
    });
  });
});
