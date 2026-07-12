/**
 * @vitest-environment happy-dom
 */

import { renderHook, waitFor } from '@testing-library/react';

const mockNavigate = vi.fn();
let mockTabParam: string | undefined = 'basic';
let mockChatId: string | undefined = 'chat-1';
const mockUseChats = vi.fn();
const mockUseAgent = vi.fn((_id: unknown, fallback: unknown) => fallback ?? null);
const i18nState = vi.hoisted(() => ({
  t: ((key: string) => key) as (key: string, params?: Record<string, unknown>) => string,
}));

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
  resolveChatAgent: (chat: { agent?: unknown; agents?: unknown[] } | null | undefined) =>
    chat?.agent ?? chat?.agents?.[0] ?? null,
}));

vi.mock('../../../ui/ToastProvider', async () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../../lib/featureFlags', async () => ({
  useFeatureFlag: () => false,
}));

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({ language: 'en', setLanguage: vi.fn(), t: i18nState.t }),
}));

import { useAgentChatEditingViewModel } from '../useAgentChatEditingViewModel';

const baseAgent = {
  id: 'agent-1',
  name: 'Test Agent',
  emoji: '🤖',
  role: '',
  model: 'gpt-4.1',
  mcp_servers: [],
  system_prompt: '',
  skills: [],
  hooks: [],
  workspace: '/agent-workspace',
  knowledge: { knowledgeBase: '/kb' },
  knowledgeBase: '/kb',
  version: '1.0.0',
  source: 'ON-DEVICE',
};

function makeChat() {
  return {
    chat_id: 'chat-1',
    agent: { ...baseAgent },
    agent_ids: ['agent-1'],
    workspace: '/chat-workspace',
    chatSessions: [],
  };
}

describe('useAgentChatEditingViewModel i18n stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabParam = 'basic';
    mockChatId = 'chat-1';
    i18nState.t = (key: string) => key;
    mockUseChats.mockReturnValue({
      chats: [makeChat()],
      updateChat: vi.fn(),
      updateChatAgent: vi.fn(),
    });
  });

  it('does not rebuild agent editor data when only the active language changes', async () => {
    const { result, rerender } = renderHook(() => useAgentChatEditingViewModel());

    await waitFor(() => expect(result.current.agentData?.name).toBe('Test Agent'));
    const initialAgentData = result.current.agentData;

    i18nState.t = (key: string) => `zh:${key}`;
    rerender();

    expect(result.current.agentData).toBe(initialAgentData);
  });
});
