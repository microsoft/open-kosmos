vi.mock('../chatSessionStore', async () => ({
  chatSessionStore: {
    saveSession: vi.fn(),
  },
}));

vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: {
    generateTitle: vi.fn(),
  },
}));

import { AgentChatSessionService, type AgentChatSessionServiceDeps } from '../agentChatSessionService';
import { chatSessionStore } from '../chatSessionStore';

function createService() {
  const currentChatSession = {
    chatSession_id: 'session-1',
    title: 'Existing Title',
    last_updated: '2026-04-05T00:00:00.000Z',
    chat_history: [],
    context_history: [],
    interaction_history: [],
  } as any;

  let saveChain: Promise<{ success: boolean; error?: string }> = Promise.resolve({ success: true });
  const executionOrder: string[] = [];
  let releaseFirstSave: (() => void) | null = null;

  const deps: AgentChatSessionServiceDeps = {
    getCurrentChatSession: () => currentChatSession,
    setCurrentChatSession: vi.fn(),
    getCurrentUserAlias: () => 'user',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    getAgentName: () => 'OpenKosmos',
    getFirstUserMessage: () => null,
    setFirstUserMessage: vi.fn(),
    getSchedulerMetadata: () => ({}),
    getMessagesToSave: () => [],
    setMessagesToSave: vi.fn(),
    getSaveChain: () => saveChain,
    setSaveChain: (next) => { saveChain = next; },
    addMessageToChatHistory: vi.fn(),
    addMessageToContext: vi.fn().mockResolvedValue(undefined),
    shouldTrackChatSessionActivatedForUserMessage: () => false,
    getChatSessionEntryTypeForUserMessage: () => 'continued',
    trackChatSessionActivated: vi.fn(),
    exitNewChatSessionState: vi.fn(),
    calculateAndNotifyContext: vi.fn().mockResolvedValue(undefined),
    startChat: vi.fn().mockResolvedValue(undefined),
    getDisplayMessages: () => [],
    getSkipPersistence: () => false,
  };

  (chatSessionStore.saveSession as Mock)
    .mockImplementationOnce(async () => {
      executionOrder.push('first');
      await new Promise<void>((resolve) => {
        releaseFirstSave = resolve;
      });
      return true;
    })
    .mockImplementationOnce(async () => {
      executionOrder.push('second');
      return true;
    });

  return {
    service: new AgentChatSessionService(deps),
    executionOrder,
    releaseFirstSave: () => releaseFirstSave?.(),
  };
}

describe('AgentChatSessionService saveChain', () => {
  it('serializes consecutive save requests through saveChain', async () => {
    const { service, executionOrder, releaseFirstSave } = createService();

    const firstSave = service.saveChatSession();
    const secondSave = service.saveChatSession();
    await Promise.resolve();
    releaseFirstSave();
    await Promise.all([firstSave, secondSave]);

    expect(executionOrder).toEqual(['first', 'second']);
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeSimpleDeps(overrides: Partial<AgentChatSessionServiceDeps> = {}): {
  deps: AgentChatSessionServiceDeps;
  currentChatSession: any;
  saveChain: { value: Promise<{ success: boolean; error?: string }> };
} {
  const currentChatSession: any = {
    chatSession_id: 'session-1',
    title: 'New Chat',
    last_updated: '2026-04-05T00:00:00.000Z',
    chat_history: [],
    context_history: [],
    interaction_history: [],
  };

  const saveChain = { value: Promise.resolve({ success: true }) };

  const deps: AgentChatSessionServiceDeps = {
    getCurrentChatSession: () => currentChatSession,
    setCurrentChatSession: vi.fn((s) => { Object.assign(currentChatSession, s ?? {}); }),
    getCurrentUserAlias: () => 'user',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    getAgentName: () => 'OpenKosmos',
    getFirstUserMessage: () => null,
    setFirstUserMessage: vi.fn(),
    getSchedulerMetadata: () => ({}),
    getMessagesToSave: () => [],
    setMessagesToSave: vi.fn(),
    getSaveChain: () => saveChain.value,
    setSaveChain: (next) => { saveChain.value = next; },
    addMessageToChatHistory: vi.fn((msg) => { currentChatSession.chat_history.push(msg); }),
    addMessageToContext: vi.fn().mockResolvedValue(undefined),
    shouldTrackChatSessionActivatedForUserMessage: () => false,
    getChatSessionEntryTypeForUserMessage: () => 'continued',
    trackChatSessionActivated: vi.fn(),
    exitNewChatSessionState: vi.fn(),
    calculateAndNotifyContext: vi.fn().mockResolvedValue(undefined),
    startChat: vi.fn().mockResolvedValue(undefined),
    getDisplayMessages: () => [],
    getSkipPersistence: () => false,
    ...overrides,
  };

  return { deps, currentChatSession, saveChain };
}

// ─── saveChatSession ────────────────────────────────────────────────────────

describe('AgentChatSessionService.saveChatSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns success:true immediately when skipPersistence is true', async () => {
    const { deps } = makeSimpleDeps({ getSkipPersistence: () => true });
    const service = new AgentChatSessionService(deps);
    const result = await service.saveChatSession();
    expect(result).toEqual({ success: true });
    expect(chatSessionStore.saveSession).not.toHaveBeenCalled();
  });

  it('returns failure when there is no current chat session', async () => {
    const { deps } = makeSimpleDeps({ getCurrentChatSession: () => null });
    const service = new AgentChatSessionService(deps);
    const result = await service.saveChatSession();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No current ChatSession/);
  });

  it('returns failure when user alias is empty', async () => {
    const { deps } = makeSimpleDeps({ getCurrentUserAlias: () => '' });
    const service = new AgentChatSessionService(deps);
    const result = await service.saveChatSession();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No user alias/);
  });

  it('returns failure when chat ID is empty', async () => {
    const { deps } = makeSimpleDeps({ getChatId: () => '' });
    const service = new AgentChatSessionService(deps);
    const result = await service.saveChatSession();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No chat ID/);
  });

  it('calls chatSessionStore.saveSession with the correct arguments', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);

    const result = await service.saveChatSession();
    expect(result.success).toBe(true);
    expect(chatSessionStore.saveSession).toHaveBeenCalledWith(
      'user',
      'chat-1',
      expect.objectContaining({ chatSession_id: 'session-1' }),
      expect.objectContaining({ chatSession_id: 'session-1' }),
    );
  });

  it('returns failure when chatSessionStore.saveSession returns false', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(false);
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const result = await service.saveChatSession();
    expect(result.success).toBe(false);
  });

  it('returns failure when chatSessionStore.saveSession throws', async () => {
    (chatSessionStore.saveSession as Mock).mockRejectedValue(new Error('disk full'));
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const result = await service.saveChatSession();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disk full/);
  });

  it('generates a time-based placeholder title when firstUserMessage is set and title is "New Chat"', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    // Prevent async title generation from overwriting the placeholder
    const { ChatSessionTitleLlmSummarizer } = await import('../../llm/chatSessionTitleLlmSummarizer') as any;
    (ChatSessionTitleLlmSummarizer.generateTitle as Mock).mockReturnValue(new Promise(() => {})); // never resolves

    const userMsg = { id: 'u1', role: 'user', timestamp: Date.now(), content: [{ type: 'text', text: 'hello' }] } as any;
    const { deps, currentChatSession } = makeSimpleDeps({ getFirstUserMessage: () => userMsg });
    const service = new AgentChatSessionService(deps);

    await service.saveChatSession();

    expect(currentChatSession.title).toMatch(/^Chat \d{2}:\d{2}$/);
    expect(deps.setFirstUserMessage).toHaveBeenCalledWith(null);
  });
});

// ─── createChatSession ──────────────────────────────────────────────────────

describe('AgentChatSessionService.createChatSession', () => {
  it('throws when chatSession_id is not provided', () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    expect(() => service.createChatSession({})).toThrow('chatSession_id must be provided');
  });

  it('creates a session with the provided title and initialMessage', () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const initialMsg = { id: 'u1', role: 'user', timestamp: 1000, content: [{ type: 'text', text: 'hi' }] } as any;

    service.createChatSession({ chatSession_id: 'new-session', title: 'My Chat', initialMessage: initialMsg });

    expect(deps.setCurrentChatSession).toHaveBeenCalledWith(
      expect.objectContaining({
        chatSession_id: 'new-session',
        title: 'My Chat',
        chat_history: [initialMsg],
        context_history: [initialMsg],
      }),
    );
  });

  it('defaults to "New Chat" when no title is provided', () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    service.createChatSession({ chatSession_id: 'new-session' });
    expect(deps.setCurrentChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New Chat', chat_history: [] }),
    );
  });
});

// ─── generateFallbackTitle ──────────────────────────────────────────────────

describe('AgentChatSessionService.generateFallbackTitle', () => {
  it('returns first 4 words of the message', () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    expect(service.generateFallbackTitle('one two three four five')).toBe('one two three four');
  });

  it('truncates titles longer than 50 chars', () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const longWord = 'a'.repeat(55);
    const result = service.generateFallbackTitle(longWord);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('falls back to time-based title for very short messages', () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const result = service.generateFallbackTitle('hi');
    expect(result).toMatch(/^Chat \d{2}:\d{2}$/);
  });
});

// ─── validateUserMessageEditable ────────────────────────────────────────────

describe('AgentChatSessionService.validateUserMessageEditable', () => {
  it('returns canEdit:false when there is no current session', () => {
    const { deps } = makeSimpleDeps({ getCurrentChatSession: () => null });
    const service = new AgentChatSessionService(deps);
    const result = service.validateUserMessageEditable('any-id');
    expect(result.canEdit).toBe(false);
    expect(result.error).toMatch(/No current ChatSession/);
  });

  it('returns canEdit:false when messageId is not found in chat_history', () => {
    const { deps, currentChatSession } = makeSimpleDeps();
    currentChatSession.chat_history = [
      { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hi' }] },
    ];
    currentChatSession.context_history = [...currentChatSession.chat_history];
    const service = new AgentChatSessionService(deps);
    const result = service.validateUserMessageEditable('not-there');
    expect(result.canEdit).toBe(false);
    expect(result.error).toMatch(/no longer available/);
  });

  it('returns canEdit:false when messageId is missing from context_history', () => {
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hi' }] };
    const { deps, currentChatSession } = makeSimpleDeps();
    currentChatSession.chat_history = [msg];
    currentChatSession.context_history = []; // removed from context (compressed)
    const service = new AgentChatSessionService(deps);
    const result = service.validateUserMessageEditable('u1');
    expect(result.canEdit).toBe(false);
    expect(result.error).toMatch(/compressed/);
  });

  it('returns canEdit:true with correct indices when message is in both histories', () => {
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hi' }] };
    const { deps, currentChatSession } = makeSimpleDeps();
    currentChatSession.chat_history = [msg];
    currentChatSession.context_history = [msg];
    const service = new AgentChatSessionService(deps);
    const result = service.validateUserMessageEditable('u1');
    expect(result.canEdit).toBe(true);
    expect(result.targetUserIndex).toBe(0);
    expect(result.targetContextUserIndex).toBe(0);
    expect(result.targetUserMessage).toBe(msg);
  });
});

// ─── generateChatSessionTitle ────────────────────────────────────────────────

describe('AgentChatSessionService.generateChatSessionTitle', () => {
  let ChatSessionTitleLlmSummarizer: any;

  beforeAll(async () => {
    ({ ChatSessionTitleLlmSummarizer } = await import('../../llm/chatSessionTitleLlmSummarizer') as any);
  });

  beforeEach(() => vi.clearAllMocks());

  it('sets the LLM-generated title when generation succeeds', async () => {
    (ChatSessionTitleLlmSummarizer.generateTitle as Mock).mockResolvedValue({ success: true, title: 'LLM Title' });
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps, currentChatSession } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const userMsg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'Explain caching' }] } as any;
    await service.generateChatSessionTitle(userMsg);
    expect(currentChatSession.title).toBe('LLM Title');
  });

  it('falls back to generateFallbackTitle when generation fails', async () => {
    (ChatSessionTitleLlmSummarizer.generateTitle as Mock).mockResolvedValue({ success: false });
    const { deps, currentChatSession } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const userMsg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'Explain caching strategies' }] } as any;
    await service.generateChatSessionTitle(userMsg);
    expect(currentChatSession.title).toBe('Explain caching strategies');
  });

  it('falls back to generateFallbackTitle when generation throws', async () => {
    (ChatSessionTitleLlmSummarizer.generateTitle as Mock).mockRejectedValue(new Error('LLM down'));
    const { deps, currentChatSession } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const userMsg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'What is Redis' }] } as any;
    await service.generateChatSessionTitle(userMsg);
    // Title is a fallback — should not be 'New Chat'
    expect(currentChatSession.title).not.toBe('New Chat');
  });

  it('does nothing when there is no current chat session', async () => {
    const { deps } = makeSimpleDeps({ getCurrentChatSession: () => null });
    const service = new AgentChatSessionService(deps);
    const userMsg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hello' }] } as any;
    // Should not throw
    await expect(service.generateChatSessionTitle(userMsg)).resolves.toBeUndefined();
  });
});

// ─── addMessageToSession ────────────────────────────────────────────────────

describe('AgentChatSessionService.addMessageToSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when there is no current chat session', async () => {
    const { deps } = makeSimpleDeps({ getCurrentChatSession: () => null });
    const service = new AgentChatSessionService(deps);
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hi' }] } as any;
    await expect(service.addMessageToSession(msg)).rejects.toThrow('currentChatSession must be initialized');
  });

  it('adds a user message to chat history and context', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps, currentChatSession } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hello' }] } as any;

    await service.addMessageToSession(msg);

    expect(deps.addMessageToChatHistory).toHaveBeenCalledWith(msg);
    expect(deps.addMessageToContext).toHaveBeenCalledWith(msg);
  });

  it('sets firstUserMessage on the first user message', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'first' }] } as any;

    await service.addMessageToSession(msg);

    expect(deps.setFirstUserMessage).toHaveBeenCalledWith(msg);
  });

  it('throws when messagesToSave exceeds 2 entries', async () => {
    let messages: any[] = [];
    const { deps } = makeSimpleDeps({
      getMessagesToSave: () => messages,
      setMessagesToSave: vi.fn((m) => { messages = m; }),
    });
    // Pre-populate with 2 messages so the 3rd push triggers the guard
    messages = [
      { id: 'a', role: 'assistant', content: [] },
      { id: 'b', role: 'tool', content: [] },
    ];
    const service = new AgentChatSessionService(deps);
    const msg = { id: 'c', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hi' }] } as any;

    await expect(service.addMessageToSession(msg)).rejects.toThrow('MessageToSave only allow');
  });

  it('does not save immediately for assistant messages with tool_calls', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    let messages: any[] = [];
    const { deps } = makeSimpleDeps({
      getMessagesToSave: () => messages,
      setMessagesToSave: vi.fn((m) => { messages = m; }),
    });
    const service = new AgentChatSessionService(deps);
    const msg = {
      id: 'a1', role: 'assistant', timestamp: 1,
      content: [{ type: 'text', text: '' }],
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'exec', arguments: '{}' } }],
    } as any;

    await service.addMessageToSession(msg);

    // Save should not have been called (deferred until tool result arrives)
    expect(chatSessionStore.saveSession).not.toHaveBeenCalled();
  });
});

// ─── replaceFilePathInSession ────────────────────────────────────────────────

describe('AgentChatSessionService.replaceFilePathInSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns failure when there is no current session', async () => {
    const { deps } = makeSimpleDeps({ getCurrentChatSession: () => null });
    const service = new AgentChatSessionService(deps);
    const result = await service.replaceFilePathInSession('/old', '/new');
    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(0);
  });

  it('replaces file paths in text content parts', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps, currentChatSession } = makeSimpleDeps();
    currentChatSession.chat_history = [
      {
        id: 'u1', role: 'user', timestamp: 1,
        content: [{ type: 'text', text: 'See /old/path/file.txt for details' }],
      },
    ];
    currentChatSession.context_history = [];
    const service = new AgentChatSessionService(deps);
    const result = await service.replaceFilePathInSession('/old/path/file.txt', '/new/path/file.txt');
    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);
    expect(currentChatSession.chat_history[0].content[0].text).toContain('/new/path/file.txt');
  });

  it('replaces file paths in tool_call arguments', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps, currentChatSession } = makeSimpleDeps();
    currentChatSession.chat_history = [
      {
        id: 'a1', role: 'assistant', timestamp: 1,
        content: [{ type: 'text', text: '' }],
        tool_calls: [{ id: 'tc1', function: { name: 'read_file', arguments: '{"filePath":"/old/file.txt"}' } }],
      },
    ];
    currentChatSession.context_history = [];
    const service = new AgentChatSessionService(deps);
    const result = await service.replaceFilePathInSession('/old/file.txt', '/new/file.txt');
    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);
    expect(currentChatSession.chat_history[0].tool_calls[0].function.arguments).toContain('/new/file.txt');
  });
});