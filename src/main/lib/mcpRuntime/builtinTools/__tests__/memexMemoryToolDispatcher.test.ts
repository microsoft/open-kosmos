import { describe, it, expect, vi, beforeEach } from 'vitest';

type MockPrimaryAgent = {
  id?: string;
  name: string;
  knowledge: { knowledgeBase: string };
};

const {
  mockExecuteDetailed,
  mockExecute,
  mockGetChatConfig,
  mockGetMemexSettings,
  mockGetCurrentUserAlias,
  mockAgentIdOf,
  mockGetChatPrimaryAgent,
  mockGetChatWorkspace,
} = vi.hoisted(() => ({
  mockExecuteDetailed: vi.fn().mockResolvedValue({
    success: true,
    operation: 'capture',
    output: 'Captured memory card: sample',
  }),
  mockExecute: vi.fn().mockResolvedValue({
    success: true,
    operation: 'recall',
    output: 'recall output',
  }),
  mockGetChatConfig: vi.fn(),
  mockGetMemexSettings: vi.fn(() => ({ enabled: true })),
  mockGetCurrentUserAlias: vi.fn(() => 'alice'),
  mockAgentIdOf: vi.fn((agent: MockPrimaryAgent) => agent.id ?? `derived-${agent.name}`),
  mockGetChatPrimaryAgent: vi.fn<() => MockPrimaryAgent | undefined>(() => ({
    id: 'agent-1',
    name: 'Helper',
    knowledge: { knowledgeBase: '/tmp/kb' },
  })),
  mockGetChatWorkspace: vi.fn(() => '/tmp/workspace/chat-1'),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/userData') },
}));

vi.mock('../memexMemoryTool', () => ({
  MemexMemoryTool: {
    executeDetailed: (...args: unknown[]) => mockExecuteDetailed(...args),
    execute: (...args: unknown[]) => mockExecute(...args),
  },
}));

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: {
    getChatConfig: mockGetChatConfig,
    getCurrentUserAlias: mockGetCurrentUserAlias,
    getMemexSettings: mockGetMemexSettings,
  },
}));

vi.mock('../../../userDataADO/agentAccessor', () => ({
  agentIdOf: mockAgentIdOf,
  getChatPrimaryAgent: mockGetChatPrimaryAgent,
  getChatWorkspace: mockGetChatWorkspace,
}));

import { executeMemexMemoryTool } from '../memexMemoryToolDispatcher';

describe('executeMemexMemoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChatConfig.mockReturnValue({ chat_id: 'chat-1' });
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    mockGetCurrentUserAlias.mockReturnValue('alice');
    mockAgentIdOf.mockImplementation((agent: MockPrimaryAgent) => agent.id ?? `derived-${agent.name}`);
    mockGetChatPrimaryAgent.mockReturnValue({
      id: 'agent-1',
      name: 'Helper',
      knowledge: { knowledgeBase: '/tmp/kb' },
    });
    mockGetChatWorkspace.mockReturnValue('/tmp/workspace/chat-1');
  });

  it('passes the persisted chat-session path with chat id and month into capture context', async () => {
    await executeMemexMemoryTool({
      operation: 'capture',
      description: 'Remember current user preference',
      mode: 'remember',
      title: 'Preference',
      body: 'Use concise answers.',
      category: 'preference',
      source_type: 'chat-session',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
      currentUserMessageId: 'user-1',
      chatHistory: [],
    });

    expect(mockExecuteDetailed).toHaveBeenCalledOnce();
    expect(mockExecuteDetailed.mock.calls[0][1]).toMatchObject({
      userAlias: 'alice',
      agentId: 'agent-1',
      chatId: 'chat-1',
      agentName: 'Helper',
      captureContext: {
        chatSessionFilePath: '/tmp/userData/profiles/alice/chat_sessions/chat-1/202607/chatSession_20260708101011_device_abcdefghi.json',
        chatSessionFilesPath: '/tmp/workspace/chat-1/202607/chatSession_20260708101011_device_abcdefghi',
        sourceAgentId: 'agent-1',
        sourceAgentName: 'Helper',
      },
    });
  });

  it('uses the current alias to return the disabled tool error before context resolution', async () => {
    mockGetCurrentUserAlias.mockReturnValue('bob');
    mockGetMemexSettings.mockReturnValue({ enabled: false });

    const result = await executeMemexMemoryTool({ operation: 'recall' }, undefined);

    expect(mockGetMemexSettings).toHaveBeenCalledWith('bob');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disabled');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns a context error when enabled but no execution context is captured', async () => {
    const result = await executeMemexMemoryTool({ operation: 'recall' }, undefined);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No execution context');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('skips current-agent resolution for profile-memory scope and uses the read path', async () => {
    await executeMemexMemoryTool({ operation: 'search', scope: 'profile-memory', query: 'preference' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });

    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute.mock.calls[0][1]).toMatchObject({
      userAlias: 'alice',
      chatId: 'chat-1',
      agentId: undefined,
      captureContext: undefined,
    });
  });

  it('passes sub-agent identity into non-capture tool context', async () => {
    await executeMemexMemoryTool({ operation: 'archive', slug: 'old-card' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: true,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });

    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute.mock.calls[0][1]).toMatchObject({
      userAlias: 'alice',
      agentId: 'agent-1',
      chatId: 'chat-1',
      isSubAgent: true,
    });
  });

  it('returns an error when current-agent memory has no primary agent', async () => {
    mockGetChatPrimaryAgent.mockReturnValue(undefined);

    const result = await executeMemexMemoryTool({ operation: 'recall' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No primary agent');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('uses the same primary agent for memory id, knowledge root, and capture provenance', async () => {
    mockGetChatConfig.mockReturnValue({ chat_id: 'chat-1', agent_ids: ['list-agent'], agent: { id: 'lead-agent', name: 'Lead', knowledge: { knowledgeBase: '/tmp/lead-kb' } } });
    mockGetChatPrimaryAgent.mockReturnValue({
      id: 'lead-agent',
      name: 'Lead',
      knowledge: { knowledgeBase: '/tmp/lead-kb' },
    });

    await executeMemexMemoryTool({ operation: 'capture', mode: 'remember', title: 'T', body: 'B', category: 'decision', source_type: 'knowledge-file' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });

    expect(mockAgentIdOf).toHaveBeenCalledWith(expect.objectContaining({ id: 'lead-agent', name: 'Lead' }));
    expect(mockExecuteDetailed.mock.calls[0][1]).toMatchObject({
      agentId: 'lead-agent',
      agentName: 'Lead',
      captureContext: {
        knowledgeBasePath: '/tmp/lead-kb',
        sourceAgentId: 'lead-agent',
        sourceAgentName: 'Lead',
      },
    });
  });

  it('omits optional capture paths when session id or workspace month cannot be resolved', async () => {
    mockGetChatWorkspace.mockReturnValue(undefined as any);

    await executeMemexMemoryTool({ operation: 'capture', mode: 'remember', title: 'T', body: 'B', category: 'decision', source_type: 'knowledge-file' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: undefined,
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    } as any);

    expect(mockExecuteDetailed).toHaveBeenCalledOnce();
    expect(mockExecuteDetailed.mock.calls[0][1].captureContext).toMatchObject({
      chatSessionFilePath: undefined,
      chatSessionFilesPath: undefined,
    });
  });

  it('omits deliverables path when no workspace is available for a valid session id', async () => {
    mockGetChatWorkspace.mockReturnValue(undefined as any);

    await executeMemexMemoryTool({ operation: 'capture', mode: 'remember', title: 'T', body: 'B', category: 'decision', source_type: 'knowledge-file' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });

    expect(mockExecuteDetailed.mock.calls[0][1].captureContext.chatSessionFilesPath).toBeUndefined();
  });

  it('does not stamp source-agent metadata for profile-memory capture and supports legacy knowledgeBase', async () => {
    mockGetChatPrimaryAgent.mockReturnValue({
      id: 'agent-1',
      name: 'Helper',
      knowledgeBase: '/tmp/legacy-kb',
    } as any);

    await executeMemexMemoryTool({ operation: 'capture', scope: 'profile-memory', mode: 'remember', title: 'T', body: 'B', category: 'preference', source_type: 'chat-session' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });

    expect(mockExecuteDetailed.mock.calls[0][1].captureContext).toMatchObject({
      knowledgeBasePath: '/tmp/legacy-kb',
      sourceAgentId: undefined,
      sourceAgentName: undefined,
    });
  });

  it('includes tool errors and hints in the MCP text result', async () => {
    mockExecute.mockResolvedValueOnce({
      success: false,
      operation: 'search',
      error: 'Search failed',
      hint: 'Try another query',
    });

    const result = await executeMemexMemoryTool({ operation: 'search', query: 'x' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Search failed');
    expect(result.content[0].text).toContain('Try another query');
  });

  it('falls back to empty success output and unknown error text', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, operation: 'recall' });
    const success = await executeMemexMemoryTool({ operation: 'recall' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });
    expect(success).toEqual({ content: [{ type: 'text', text: '' }], isError: false });

    mockExecute.mockResolvedValueOnce({ success: false, operation: 'recall' });
    const failure = await executeMemexMemoryTool({ operation: 'recall' }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260708101011_device_abcdefghi',
      isSubAgent: false,
      cancellationToken: {} as any,
      getParentContextSummary: async () => '',
    });
    expect(failure.content[0].text).toBe('Unknown error');
  });
});
