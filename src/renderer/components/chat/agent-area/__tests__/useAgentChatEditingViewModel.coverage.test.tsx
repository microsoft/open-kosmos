/**
 * @vitest-environment happy-dom
 *
 * Branch-coverage tests for useAgentChatEditingViewModel that drive the hook
 * directly via renderHook. This reaches code paths the component-level tests
 * cannot, because the returned handlers (handleSave, handleSaveAll,
 * handleTabSwitch, handleBackToChat, handleTabDataChange) can be invoked
 * regardless of which tab component is currently mounted.
 *
 * Targets:
 * - handleTabSwitch no-op when chatId is missing (line 149)
 * - findCurrentChatAgent throws when chatId is missing (line 166)
 * - findCurrentChatAgent throws when the chat has no agent (line 168)
 * - handleSaveAll early return when there are no saveable changes (line 193)
 * - handleBackToChat navigates to the list when chatId is missing (line 217)
 */

import { renderHook, act } from '@testing-library/react';

const mockNavigate = vi.fn();
let mockTabParam: string | undefined = 'basic';
let mockChatId: string | undefined = 'chat-1';
const mockUseChats = vi.fn();
let mockCachedAgent: Record<string, unknown> | null = null;
const mockUseAgent = vi.fn(
  (_id: unknown, fallback: unknown) => mockCachedAgent ?? fallback ?? null,
);

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useParams: () => ({ chatId: mockChatId, '*': mockTabParam }),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../userData/userDataProvider', async () => ({
  useChats: () => mockUseChats(),
}));

vi.mock('../../../../lib/agent', async () => ({
  useAgent: (id: unknown, fallback: unknown) => mockUseAgent(id, fallback),
  chatAgentId: (chat: { agent?: { id?: string }; agent_ids?: string[] } | null | undefined) =>
    chat?.agent?.id ?? chat?.agent_ids?.[0],
  resolveChatAgent: (
    chat: { agent?: unknown; agents?: unknown[] } | null | undefined,
  ) => chat?.agent ?? chat?.agents?.[0] ?? null,
}));

vi.mock('../../../ui/ToastProvider', async () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../../lib/featureFlags', async () => ({
  useFeatureFlag: (_flag: string) => false,
}));

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { useAgentChatEditingViewModel } from '../useAgentChatEditingViewModel';

const baseAgent = {
  name: 'Test Agent',
  emoji: '🤖',
  role: '',
  model: 'gpt-4.1',
  mcp_servers: [],
  system_prompt: '',
  skills: [],
  hooks: [],
  workspace: '/ws',
  knowledge: { knowledgeBase: '/kb' },
  knowledgeBase: '/kb',
  version: '1.0.0',
  source: 'ON-DEVICE',
};

function makeChat(overrides: Record<string, unknown> = {}) {
  return { chat_id: 'chat-1', agent: { ...baseAgent }, chatSessions: [], ...overrides };
}

describe('useAgentChatEditingViewModel — branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabParam = 'basic';
    mockChatId = 'chat-1';
    mockCachedAgent = null;
  });

  it('handleTabSwitch does nothing when chatId is missing', () => {
    mockChatId = undefined;
    mockUseChats.mockReturnValue({ chats: [], updateChat: vi.fn() });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    act(() => {
      result.current.handleTabSwitch('mcp');
    });

    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/settings/mcp_servers'));
  });

  it('handleSave rejects with "No chat ID found" when chatId is missing', async () => {
    mockChatId = undefined;
    mockUseChats.mockReturnValue({ chats: [], updateChat: vi.fn() });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    await act(async () => {
      await expect(result.current.handleSave({ name: 'X' })).rejects.toThrow('No chat ID found for update operation');
    });
  });

  it('handleSave rejects with "Agent not found" when the chat has no agent', async () => {
    mockChatId = 'chat-1';
    mockUseChats.mockReturnValue({
      chats: [{ chat_id: 'chat-1', agent: undefined, chatSessions: [] }],
      updateChat: vi.fn(),
    });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    await act(async () => {
      await expect(result.current.handleSave({ name: 'X' })).rejects.toThrow('Agent not found');
    });
  });

  it('handleSaveAll returns early without calling updateChatAgent when there are no pending changes', async () => {
    const updateChatAgent = vi.fn().mockResolvedValue({ success: true });
    mockUseChats.mockReturnValue({ chats: [makeChat()], updateChat: vi.fn(), updateChatAgent });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    expect(result.current.canSaveAll).toBe(false);

    await act(async () => {
      await result.current.handleSaveAll();
    });

    expect(updateChatAgent).not.toHaveBeenCalled();
  });

  it('handleSave persists through the store-aware updateChatAgent path, not updateChatConfig', async () => {
    // Regression guard: editing an agent must write agents/{id}/agent.json via
    // updateChatAgent (which calls syncChatAgentsToStore). Routing through
    // updateChat (updateChatConfig) merges an inline agent into profile.json that
    // is then stripped on write, so agent.json is never updated.
    const updateChat = vi.fn().mockResolvedValue({ success: true });
    const updateChatAgent = vi.fn().mockResolvedValue({ success: true });
    mockUseChats.mockReturnValue({ chats: [makeChat()], updateChat, updateChatAgent });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    await act(async () => {
      await result.current.handleSave({ name: 'Renamed Agent' });
    });

    expect(updateChatAgent).toHaveBeenCalledTimes(1);
    const [chatIdArg, agentPayload] = updateChatAgent.mock.calls[0];
    expect(chatIdArg).toBe('chat-1');
    expect(agentPayload).toMatchObject({ name: 'Renamed Agent' });
    expect(updateChat).not.toHaveBeenCalled();
  });

  it('handleSave persists workspace changes on the chat, not the agent payload', async () => {
    const updateChat = vi.fn().mockResolvedValue({ success: true });
    const updateChatAgent = vi.fn().mockResolvedValue({ success: true });
    mockUseChats.mockReturnValue({
      chats: [makeChat({ workspace: '/old-chat-workspace' })],
      updateChat,
      updateChatAgent,
    });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    await act(async () => {
      await result.current.handleSave({ workspace: '/new-chat-workspace' });
    });

    expect(updateChatAgent).toHaveBeenCalledTimes(1);
    expect(updateChatAgent.mock.calls[0][1].workspace).toBeUndefined();
    expect(updateChat).toHaveBeenCalledWith('chat-1', { workspace: '/new-chat-workspace' });
  });

  it('handleSave surfaces chat workspace update failures', async () => {
    const updateChat = vi.fn().mockResolvedValue({ success: false, error: 'workspace denied' });
    const updateChatAgent = vi.fn().mockResolvedValue({ success: true });
    mockUseChats.mockReturnValue({
      chats: [makeChat({ workspace: '/old-chat-workspace' })],
      updateChat,
      updateChatAgent,
    });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    await act(async () => {
      await expect(result.current.handleSave({ workspace: '/blocked' })).rejects.toThrow('workspace denied');
    });

    expect(updateChatAgent.mock.calls[0][1].workspace).toBeUndefined();
    expect(updateChat).toHaveBeenCalledWith('chat-1', { workspace: '/blocked' });
  });

  it('handleSaveAll persists through the store-aware updateChatAgent path', async () => {
    const updateChat = vi.fn().mockResolvedValue({ success: true });
    const updateChatAgent = vi.fn().mockResolvedValue({ success: true });
    mockUseChats.mockReturnValue({ chats: [makeChat()], updateChat, updateChatAgent });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    act(() => {
      result.current.handleTabDataChange('basic', { name: 'Bulk Renamed' }, true);
    });
    await act(async () => {
      await result.current.handleSaveAll();
    });

    expect(updateChatAgent).toHaveBeenCalledTimes(1);
    const [chatIdArg, agentPayload] = updateChatAgent.mock.calls[0];
    expect(chatIdArg).toBe('chat-1');
    expect(agentPayload).toMatchObject({ name: 'Bulk Renamed' });
    expect(updateChat).not.toHaveBeenCalled();
  });

  it('handleSaveAll surfaces chat workspace update failures', async () => {
    const updateChat = vi.fn().mockResolvedValue({ success: false, error: 'workspace denied' });
    const updateChatAgent = vi.fn().mockResolvedValue({ success: true });
    mockUseChats.mockReturnValue({ chats: [makeChat()], updateChat, updateChatAgent });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    act(() => {
      result.current.handleTabDataChange('knowledge', { workspace: '/blocked' }, true);
    });
    await act(async () => {
      await result.current.handleSaveAll();
    });

    expect(updateChatAgent.mock.calls[0][1].workspace).toBeUndefined();
    expect(updateChat).toHaveBeenCalledWith('chat-1', { workspace: '/blocked' });
    expect(result.current.error).toContain('workspace denied');
  });

  it('resolves the edited agent from the normalized cache by agent id, not the inline facade', () => {
    // Phase 3a decoupling: the editor's baseline comes from
    // agentClientCacheManager (via useAgent) keyed by the chat's agent id, so it
    // survives removal of the inline chat.agent recompose facade.
    mockCachedAgent = { ...baseAgent, name: 'Cache Agent', id: 'agent_cache_1' };
    mockUseChats.mockReturnValue({
      chats: [makeChat({ agent: { ...baseAgent, name: 'Inline Agent', id: 'agent_cache_1' }, agent_ids: ['agent_cache_1'] })],
      updateChat: vi.fn(),
      updateChatAgent: vi.fn(),
    });

    const { result } = renderHook(() => useAgentChatEditingViewModel());

    // useAgent is queried with the inline agent's id (preferred over agent_ids).
    expect(mockUseAgent).toHaveBeenCalledWith('agent_cache_1', expect.objectContaining({ name: 'Inline Agent' }));
    // The rendered baseline reflects the cache entry, not the inline facade.
    expect(result.current.agentData?.name).toBe('Cache Agent');
  });

  it('falls back to agent_ids[0] for the cache key when the inline agent has no id', () => {
    mockCachedAgent = null; // cache miss -> useAgent returns the inline fallback
    mockUseChats.mockReturnValue({
      chats: [makeChat({ agent: { ...baseAgent, name: 'No-Id Agent' }, agent_ids: ['agent_from_ids'] })],
      updateChat: vi.fn(),
      updateChatAgent: vi.fn(),
    });

    const { result } = renderHook(() => useAgentChatEditingViewModel());

    // The inline agent carries no id, so the cache key comes from agent_ids[0].
    expect(mockUseAgent).toHaveBeenCalledWith('agent_from_ids', expect.objectContaining({ name: 'No-Id Agent' }));
    // Cache miss -> the inline fallback still renders (compat shim).
    expect(result.current.agentData?.name).toBe('No-Id Agent');
  });

  it('handleBackToChat navigates to the chat list when chatId is missing', () => {
    mockChatId = undefined;
    mockUseChats.mockReturnValue({ chats: [], updateChat: vi.fn() });

    const { result } = renderHook(() => useAgentChatEditingViewModel());
    act(() => {
      result.current.handleBackToChat();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat');
  });
});
