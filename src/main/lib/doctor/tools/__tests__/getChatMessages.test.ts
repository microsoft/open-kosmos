import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetCurrentAuth, mockEnsureLoaded, mockGetSessionFile } = vi.hoisted(() => ({
  mockGetCurrentAuth: vi.fn(),
  mockEnsureLoaded: vi.fn(),
  mockGetSessionFile: vi.fn(),
}));

vi.mock('../../../auth/authManager', () => ({
  mainAuthManager: {
    getCurrentAuth: mockGetCurrentAuth,
  },
}));

vi.mock('../../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    ensureLoaded: mockEnsureLoaded,
    getSessionFile: mockGetSessionFile,
  },
}));

import { executeGetChatMessages, getChatMessagesToolDef } from '../getChatMessages';

function makeFile(overrides = {}) {
  return {
    chatSession_id: 'sess-1',
    title: 'Test',
    last_updated: '',
    chat_history: [
      { id: 'u1', role: 'user', timestamp: 1000, content: [{ type: 'text', text: 'hi' }] },
    ],
    context_history: [],
    interaction_history: [],
    ...overrides,
  };
}

describe('getChatMessagesToolDef', () => {
  it('has correct name', () => {
    expect(getChatMessagesToolDef.function.name).toBe('get_chat_messages');
  });
});

describe('executeGetChatMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentAuth.mockReturnValue({ ghcAuth: { alias: 'user1' } });
  });

  it('returns error when agentId is missing', async () => {
    const r = JSON.parse(await executeGetChatMessages({ agentId: '', chatSessionId: 's1', messageIndices: [0] }));
    expect(r.error).toBeDefined();
  });

  it('returns error when chatSessionId is missing', async () => {
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: '', messageIndices: [0] }));
    expect(r.error).toBeDefined();
  });

  it('returns error when messageIndices is empty', async () => {
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [] }));
    expect(r.error).toContain('non-empty array');
  });

  it('returns error when messageIndices contains negative index', async () => {
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [-1] }));
    expect(r.error).toContain('Invalid index');
  });

  it('returns error when messageIndices contains float', async () => {
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [1.5] }));
    expect(r.error).toContain('Invalid index');
  });

  it('returns error when too many indices (after dedupe)', async () => {
    const indices = Array.from({ length: 11 }, (_, i) => i);
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: indices }));
    expect(r.error).toContain('Too many indices');
  });

  it('returns error for invalid view value', async () => {
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [0], view: 'bad' as any }));
    expect(r.error).toContain('Invalid view');
  });

  it('returns error when no active user alias', async () => {
    mockGetCurrentAuth.mockReturnValue(null);
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [0] }));
    expect(r.error).toContain('No active user alias');
  });

  it('returns error when session not found', async () => {
    mockEnsureLoaded.mockResolvedValue(null);
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [0] }));
    expect(r.error).toContain('not found');
  });

  it('returns error when session file not found', async () => {
    mockEnsureLoaded.mockResolvedValue({ some: 'aggregate' });
    mockGetSessionFile.mockReturnValue(null);
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [0] }));
    expect(r.error).toContain('not found');
  });

  it('returns messages successfully for valid args', async () => {
    mockEnsureLoaded.mockResolvedValue({ some: 'aggregate' });
    mockGetSessionFile.mockReturnValue(makeFile());
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [0] }));
    expect(r.view).toBe('ui');
    expect(Array.isArray(r.results)).toBe(true);
  });

  it('deduplicates and sorts indices', async () => {
    mockEnsureLoaded.mockResolvedValue({ some: 'aggregate' });
    mockGetSessionFile.mockReturnValue(makeFile());
    // Provide duplicates
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [0, 0, 0] }));
    expect(r.results).toHaveLength(1); // deduped
  });

  it('uses llm view when specified', async () => {
    mockEnsureLoaded.mockResolvedValue({ some: 'aggregate' });
    mockGetSessionFile.mockReturnValue(makeFile());
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [0], view: 'llm' }));
    expect(r.view).toBe('llm');
  });

  it('returns error on exception', async () => {
    mockEnsureLoaded.mockRejectedValue(new Error('DB failure'));
    const r = JSON.parse(await executeGetChatMessages({ agentId: 'a1', chatSessionId: 's1', messageIndices: [0] }));
    expect(r.error).toContain('DB failure');
  });
});
