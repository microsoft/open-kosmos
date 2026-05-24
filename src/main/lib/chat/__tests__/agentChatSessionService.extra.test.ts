/**
 * Additional coverage tests for AgentChatSessionService
 * Targets uncovered branches: editUserMessage, replaceFilePathInSession (file/office/others/image types),
 * addMessageToSession (orphaned tool message), generateChatSessionTitle (empty text)
 */

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

vi.mock('../agentChatToolMessageSanitizer', async () => ({
  isToolMessageOrphaned: vi.fn(() => false),
}));

vi.mock('../../cancellation', async () => ({
  CancellationError: class CancellationError extends Error {
    constructor(msg: string) { super(msg); this.name = 'CancellationError'; }
  },
  CancellationToken: class CancellationToken {},
}));

import { AgentChatSessionService, type AgentChatSessionServiceDeps } from '../agentChatSessionService';
import { chatSessionStore } from '../chatSessionStore';
import { isToolMessageOrphaned } from '../agentChatToolMessageSanitizer';

function makeSimpleDeps(overrides: Partial<AgentChatSessionServiceDeps> = {}): {
  deps: AgentChatSessionServiceDeps;
  currentChatSession: any;
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
    getDisplayMessages: () => [{ id: 'u1', role: 'user' } as any],
    getSkipPersistence: () => false,
    ...overrides,
  };

  return { deps, currentChatSession };
}

// ─── editUserMessage ────────────────────────────────────────────────────────

describe('AgentChatSessionService.editUserMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws CancellationError when token is already cancelled', async () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const token = { isCancellationRequested: true } as any;
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hi' }] } as any;
    await expect(service.editUserMessage('u1', msg, token)).rejects.toThrow('cancelled');
  });

  it('throws when there is no current chat session', async () => {
    const { deps } = makeSimpleDeps({ getCurrentChatSession: () => null });
    const service = new AgentChatSessionService(deps);
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hi' }] } as any;
    await expect(service.editUserMessage('u1', msg)).rejects.toThrow('No current ChatSession');
  });

  it('throws when edited message has no user content (empty text only)', async () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const emptyMsg = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [{ type: 'text', text: '   ' }],
    } as any;
    await expect(service.editUserMessage('u1', emptyMsg)).rejects.toThrow('empty');
  });

  it('throws when validation fails (message not found)', async () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hello' }] } as any;
    // chat_history is empty — validation will fail
    await expect(service.editUserMessage('u1', msg)).rejects.toThrow();
  });

  it('completes edit and returns display messages when message is found', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const userMsg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'original' }] };
    const { deps, currentChatSession } = makeSimpleDeps();
    currentChatSession.chat_history = [userMsg];
    currentChatSession.context_history = [userMsg];
    const service = new AgentChatSessionService(deps);

    const updatedMsg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'updated' }] } as any;
    const result = await service.editUserMessage('u1', updatedMsg);
    expect(Array.isArray(result)).toBe(true);
    expect(deps.startChat).toHaveBeenCalled();
  });

  it('resets title to New Chat and setFirstUserMessage when editing the first message (index 0)', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const userMsg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'first' }] };
    const { deps, currentChatSession } = makeSimpleDeps();
    currentChatSession.chat_history = [userMsg];
    currentChatSession.context_history = [userMsg];
    currentChatSession.title = 'Old Title';
    const service = new AgentChatSessionService(deps);

    const updatedMsg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'new first' }] } as any;
    await service.editUserMessage('u1', updatedMsg);
    expect(currentChatSession.title).toBe('New Chat');
    expect(deps.setFirstUserMessage).toHaveBeenCalled();
  });

  it('content with only thinking-type parts is treated as empty', async () => {
    const { deps } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const msg = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [{ type: 'thinking', thinking: 'internal reasoning' }],
    } as any;
    await expect(service.editUserMessage('u1', msg)).rejects.toThrow('empty');
  });
});

// ─── replaceFilePathInSession — file/office/others/image types ───────────────

describe('AgentChatSessionService.replaceFilePathInSession — content type coverage', () => {
  beforeEach(() => vi.clearAllMocks());

  async function replaceInMsg(message: any) {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps, currentChatSession } = makeSimpleDeps();
    currentChatSession.chat_history = [message];
    currentChatSession.context_history = [];
    const service = new AgentChatSessionService(deps);
    return service.replaceFilePathInSession('/old/file.txt', '/new/file.txt');
  }

  it('replaces path in file-type content part', async () => {
    const msg = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [{ type: 'file', file: { filePath: '/old/file.txt' } }],
    };
    const result = await replaceInMsg(msg);
    expect(result.replacedCount).toBe(1);
    expect(msg.content[0].file.filePath).toBe('/new/file.txt');
  });

  it('replaces path in office-type content part', async () => {
    const msg = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [{ type: 'office', file: { filePath: '/old/file.txt' } }],
    };
    const result = await replaceInMsg(msg);
    expect(result.replacedCount).toBe(1);
    expect(msg.content[0].file.filePath).toBe('/new/file.txt');
  });

  it('replaces path in others-type content part', async () => {
    const msg = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [{ type: 'others', file: { filePath: '/old/file.txt' } }],
    };
    const result = await replaceInMsg(msg);
    expect(result.replacedCount).toBe(1);
    expect(msg.content[0].file.filePath).toBe('/new/file.txt');
  });

  it('replaces path in image-type content part (image_url.url)', async () => {
    const msg = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [{ type: 'image', image_url: { url: '/old/file.txt' } }],
    };
    const result = await replaceInMsg(msg);
    expect(result.replacedCount).toBe(1);
    expect(msg.content[0].image_url.url).toBe('/new/file.txt');
  });

  it('does not replace in file-type when path does not match', async () => {
    const msg = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [{ type: 'file', file: { filePath: '/other/path.txt' } }],
    };
    const result = await replaceInMsg(msg);
    expect(result.replacedCount).toBe(0);
  });

  it('handles message.content that is not an array', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps, currentChatSession } = makeSimpleDeps();
    // message with string content — should skip gracefully
    currentChatSession.chat_history = [{ id: 'u1', role: 'user', timestamp: 1, content: 'plain string' }];
    currentChatSession.context_history = [];
    const service = new AgentChatSessionService(deps);
    const result = await service.replaceFilePathInSession('/old', '/new');
    expect(result.replacedCount).toBe(0);
    expect(result.success).toBe(true);
  });
});

// ─── addMessageToSession — orphaned tool message ────────────────────────────

describe('AgentChatSessionService.addMessageToSession — orphaned tool message', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects orphaned tool message silently', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    (isToolMessageOrphaned as Mock).mockReturnValueOnce(true);

    const { deps, currentChatSession } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);
    const toolMsg = {
      id: 't1', role: 'tool', tool_call_id: 'tc1', name: 'read_file',
      timestamp: 1, content: [{ type: 'text', text: 'result' }],
    } as any;

    await service.addMessageToSession(toolMsg);

    expect(deps.addMessageToChatHistory).not.toHaveBeenCalled();
    // saveSession should NOT be called for orphaned tool messages
    const calls = (chatSessionStore.saveSession as Mock).mock.calls;
    expect(calls.length).toBe(0);
  });
});

// ─── generateChatSessionTitle — empty text path ────────────────────────────

describe('AgentChatSessionService.generateChatSessionTitle — empty message text', () => {
  it('returns early when user message has no text content', async () => {
    const { ChatSessionTitleLlmSummarizer } = await import('../../llm/chatSessionTitleLlmSummarizer') as any;
    const { deps, currentChatSession } = makeSimpleDeps();
    const service = new AgentChatSessionService(deps);

    // Message with no text content
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [] } as any;
    await service.generateChatSessionTitle(msg);

    // Title should not be changed (returns early)
    expect(ChatSessionTitleLlmSummarizer.generateTitle).not.toHaveBeenCalled();
    expect(currentChatSession.title).toBe('New Chat');
  });
});

// ─── addMessageToSession — first user message tracking ────────────────────────────

describe('AgentChatSessionService.addMessageToSession — tracking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls trackChatSessionActivated when shouldTrack returns true', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps } = makeSimpleDeps({
      shouldTrackChatSessionActivatedForUserMessage: () => true,
      getChatSessionEntryTypeForUserMessage: () => 'new',
    });
    const service = new AgentChatSessionService(deps);
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hello' }] } as any;

    await service.addMessageToSession(msg);
    // Allow microtasks to flush
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(deps.trackChatSessionActivated).toHaveBeenCalledWith(msg, 'new');
  });

  it('calls exitNewChatSessionState on first user message save success', async () => {
    (chatSessionStore.saveSession as Mock).mockResolvedValue(true);
    const { deps, currentChatSession } = makeSimpleDeps();
    // Ensure it IS the first user message (empty history before push)
    currentChatSession.chat_history = [];
    const service = new AgentChatSessionService(deps);
    const msg = { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'first msg' }] } as any;

    await service.addMessageToSession(msg);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(deps.exitNewChatSessionState).toHaveBeenCalled();
  });
});
