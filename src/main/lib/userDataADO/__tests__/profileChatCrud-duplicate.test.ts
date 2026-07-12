vi.mock('electron', async () => ({
  BrowserWindow: vi.fn(),
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));
vi.mock('fs');

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../pathUtils', async () => ({
  getDefaultWorkspacePath: vi.fn(() => '/mock/workspace'),
  getDefaultAgentWorkspacePath: vi.fn((_alias: string, name: string) => `/mock/workspace/agent-${name.toLowerCase().replace(/\s+/g, '-')}-on-device`),
  ensureWorkspaceExists: vi.fn(),
  removeChatSessionsDirectory: vi.fn(),
  removeDefaultWorkspaceDirectory: vi.fn(),
  isDefaultWorkspacePath: vi.fn(() => false),
  moveContentsToDirectory: vi.fn(),
}));

vi.mock('../chatSessionManager', async () => ({
  chatSessionManager: {
    loadChatSessions: vi.fn(),
    saveChatSession: vi.fn(),
  },
}));

vi.mock('../../../../shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  ...await vi.importActual('../../../../shared/constants/builtinSkills'),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

vi.mock('../../scheduler/SchedulerManager', async () => ({
  schedulerManager: {
    listJobs: vi.fn().mockResolvedValue([]),
    createJob: vi.fn().mockResolvedValue(true),
  },
}));

import { duplicateAgent } from '../agentDuplicator';
import { ProfileCacheManager } from '../profileCacheManager';
import type { ChatConfig, ProfileV2, ChatAgent } from '../types/profile';
import { schedulerManager } from '../../scheduler/SchedulerManager';

function createMockAgent(overrides: Partial<ChatAgent> = {}): ChatAgent {
  return {
    name: 'Test Agent',
    model: 'gpt-4o',
    system_prompt: 'You are a test agent.',
    source: 'ON-DEVICE',
    version: '1.0.0',
    workspace: '/mock/workspace/agent-test-agent-on-device',
    knowledge: { knowledgeBase: '/mock/workspace/agent-test-agent-on-device/knowledge' },
    mcp_servers: [],
    skills: [],
    ...overrides,
  } as ChatAgent;
}

function createMockProfile(chats: ChatConfig[]): ProfileV2 {
  return {
    version: 2 as any,
    alias: 'testuser',
    primaryAgent: 'Test Agent',
    chats,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    mcp_servers: [],
  } as ProfileV2;
}

function createMockProfileCacheManager(profile: ProfileV2) {
  const cache = new Map<string, ProfileV2>();
  cache.set('testuser', profile);

  const pcm = {
    getChatConfig: vi.fn((alias: string, chatId: string) => {
      const p = cache.get(alias);
      return p?.chats.find(c => c.chat_id === chatId) ?? null;
    }),
    addChatConfig: vi.fn(async (alias: string, chatConfig: ChatConfig) => {
      const p = cache.get(alias);
      if (!p) return false;
      if (chatConfig.agent && !chatConfig.agent.id) {
        chatConfig.agent.id = `agent_new_${chatConfig.agent.name.toLowerCase().replace(/\s+/g, '_')}`;
        chatConfig.agent_ids = [chatConfig.agent.id];
      }
      if (!chatConfig.workspace || chatConfig.workspace.trim() === '') {
        const name = chatConfig.agent?.name || 'default';
        chatConfig.workspace = `/mock/workspace/chat-${name.toLowerCase().replace(/\s+/g, '-')}`;
      }
      if (chatConfig.agent && chatConfig.workspace) {
        const path = require('path');
        const knowledge = chatConfig.agent.knowledge || { knowledgeBase: '' };
        if (!knowledge.knowledgeBase || knowledge.knowledgeBase.trim() === '') {
          knowledge.knowledgeBase = path.join('/mock/agents', chatConfig.agent.id || 'agent-new', 'knowledge');
        }
        chatConfig.agent.knowledge = knowledge;
      }
      p.chats.push(chatConfig);
      return true;
    }),
  } as unknown as ProfileCacheManager;

  return pcm;
}

describe('duplicateAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new agent with independent chat_id and chat workspace', async () => {
    const sourceChat: ChatConfig = {
      chat_id: 'chat_source_001',
      chat_type: 'single_agent',
      agent: createMockAgent({ id: 'agent_source_001' }),
      agent_ids: ['agent_source_001'],
    };
    const profile = createMockProfile([sourceChat]);
    const pcm = createMockProfileCacheManager(profile);

    const result = await duplicateAgent(pcm, 'testuser', 'chat_source_001', 'Duplicated Agent');

    expect(result.success).toBe(true);
    expect(result.newChatId).toBeDefined();
    expect(result.newChatId).not.toBe('chat_source_001');

    expect(profile.chats).toHaveLength(2);
    const newChat = profile.chats.find(c => c.chat_id === result.newChatId);
    expect(newChat).toBeDefined();
    expect(newChat!.agent!.name).toBe('Duplicated Agent');
    expect(newChat!.agent!.source).toBe('ON-DEVICE');
    expect(newChat!.agent!.id).toBe('agent_new_duplicated_agent');
    expect(newChat!.agent_ids).toEqual(['agent_new_duplicated_agent']);
    expect(newChat!.agent!.id).not.toBe(sourceChat.agent!.id);
    expect(newChat!.workspace).not.toBe(sourceChat.workspace);
    expect(newChat!.agent!.workspace).toBeUndefined();
  });

  it('returns error when source agent not found', async () => {
    const profile = createMockProfile([]);
    const pcm = createMockProfileCacheManager(profile);

    const result = await duplicateAgent(pcm, 'testuser', 'nonexistent', 'Copy');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('duplicates enabled scheduled tasks with new agentId', async () => {
    const sourceChat: ChatConfig = {
      chat_id: 'chat_source_003',
      chat_type: 'single_agent',
      agent: createMockAgent(),
    };
    const profile = createMockProfile([sourceChat]);
    const pcm = createMockProfileCacheManager(profile);

    vi.mocked(schedulerManager.listJobs).mockResolvedValue([
      {
        id: 'sched_20260512100000_orig_0001',
        name: 'Daily Report',
        description: 'Generate daily report',
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
        enabled: true,
        chat_id: 'chat_source_003',
        message: 'Generate the daily report',
        status: 'pending',
      },
      {
        id: 'sched_20260512100000_orig_0002',
        name: 'Disabled Task',
        description: 'This is disabled',
        scheduleType: 'cron',
        cronExpression: '0 10 * * *',
        enabled: false,
        chat_id: 'chat_source_003',
        message: 'Should not be duplicated',
        status: 'pending',
      },
    ] as any);

    const result = await duplicateAgent(pcm, 'testuser', 'chat_source_003', 'Copy Agent');

    expect(result.success).toBe(true);

    // Only 1 enabled job should be duplicated via schedulerManager.createJob
    expect(schedulerManager.createJob).toHaveBeenCalledTimes(1);
    const createCall = vi.mocked(schedulerManager.createJob).mock.calls[0][0] as any;
    expect(createCall.chat_id).toBe(result.newChatId);
    expect(createCall.name).toBe('Daily Report');
    expect(createCall.status).toBe('pending');
  });
});
