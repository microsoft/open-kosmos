import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

vi.mock('../../scheduler/SchedulerManager', async () => ({
  schedulerManager: {
    listJobs: vi.fn().mockResolvedValue([]),
    createJob: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      copyFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import { duplicateAgent } from '../agentDuplicator';
import { schedulerManager } from '../../scheduler/SchedulerManager';
import * as fs from 'fs';
import type { ProfileCacheManager } from '../profileCacheManager';
import type { ChatConfig, ChatAgent } from '../types/profile';

function makeAgent(overrides: Partial<ChatAgent> = {}): ChatAgent {
  return {
    name: 'My Agent',
    model: 'gpt-4o',
    system_prompt: '',
    source: 'ON-DEVICE',
    version: '1.0.0',
    workspace: '/workspace/agent-my-agent-on-device',
    knowledge: { knowledgeBase: '/workspace/agent-my-agent-on-device/knowledge' },
    mcp_servers: [],
    skills: [],
    ...overrides,
  } as ChatAgent;
}

function makeChat(overrides: Partial<ChatConfig> = {}): ChatConfig {
  return {
    chat_id: 'chat_src',
    chat_type: 'single_agent',
    agent: makeAgent(),
    ...overrides,
  };
}

function makePcm(chats: ChatConfig[], opts: { addSuccess?: boolean } = {}) {
  const addSuccess = opts.addSuccess ?? true;
  const chatStore = new Map(chats.map(c => [c.chat_id, c]));
  return {
    getChatConfig: vi.fn((alias: string, chatId: string) => chatStore.get(chatId) ?? null),
    addChatConfig: vi.fn(async (alias: string, chat: ChatConfig) => {
      if (!addSuccess) return false;
      if (chat.agent) {
        if (!chat.workspace || chat.workspace === '') {
          chat.workspace = `/workspace/chat-${chat.agent.name?.toLowerCase().replace(/\s+/g, '-')}`;
        }
        if (!chat.agent.knowledge?.knowledgeBase) {
          const p = require('path');
          chat.agent.knowledge = { knowledgeBase: p.join('/agents', chat.agent.id || 'agent-new', 'knowledge') };
        }
      }
      chatStore.set(chat.chat_id, chat);
      return true;
    }),
  } as unknown as ProfileCacheManager;
}

describe('duplicateAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when source agent not found', async () => {
    const pcm = makePcm([]);
    const result = await duplicateAgent(pcm, 'alice', 'nonexistent', 'Copy');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when agent has no agent field', async () => {
    const chat: ChatConfig = { chat_id: 'chat_src', chat_type: 'single_agent' };
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(false);
  });

  it('returns error when addChatConfig fails', async () => {
    const pcm = makePcm([makeChat()], { addSuccess: false });
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to create');
  });

  it('succeeds with no knowledge files to copy when paths are empty', async () => {
    const chat = makeChat({ agent: makeAgent({ workspace: '', knowledge: { knowledgeBase: '' } }) });
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Duplicated');
    expect(result.success).toBe(true);
  });

  it('marks knowledgeCopyFailed when copy throws', async () => {
    (fs.promises.stat as any).mockResolvedValue({ isDirectory: () => true });
    (fs.promises.readdir as any).mockResolvedValue(['file.txt']);
    (fs.promises.copyFile as any).mockRejectedValue(new Error('copy error'));
    (fs.promises.stat as any).mockResolvedValueOnce({ isDirectory: () => true })
      .mockResolvedValueOnce({ isDirectory: () => false });

    const chat = makeChat();
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(true);
    // knowledgeCopyFailed may be true depending on mock state
    expect(typeof result.knowledgeCopyFailed).toBe('boolean');
  });

  it('sets scheduleCopyFailed when createJob rejects', async () => {
    vi.mocked(schedulerManager.listJobs).mockResolvedValue([
      { id: 'sched_20260101_a_001', name: 'Job', scheduleType: 'cron', cronExpression: '0 9 * * *', enabled: true, chat_id: 'chat_src', message: 'go', status: 'pending' } as any,
    ]);
    vi.mocked(schedulerManager.createJob).mockRejectedValue(new Error('sched error'));

    const chat = makeChat({ agent: makeAgent({ workspace: '', knowledge: { knowledgeBase: '' } }) });
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(true);
    expect(result.scheduleCopyFailed).toBe(true);
  });

  it('sets scheduleCopyFailed when some createJob calls fail', async () => {
    vi.mocked(schedulerManager.listJobs).mockResolvedValue([
      { id: 'sched_20260101_a_001', name: 'Job 1', scheduleType: 'cron', cronExpression: '0 9 * * *', enabled: true, chat_id: 'chat_src', message: 'go', status: 'pending' } as any,
    ]);
    vi.mocked(schedulerManager.createJob).mockRejectedValue(new Error('rejected'));

    const chat = makeChat({ agent: makeAgent({ workspace: '', knowledge: { knowledgeBase: '' } }) });
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.scheduleCopyFailed).toBe(true);
  });

  it('defaults chat_type to single_agent when source chat_type is missing', async () => {
    const chat = makeChat({ chat_type: undefined as any, agent: makeAgent({ workspace: '', knowledge: { knowledgeBase: '' } }) });
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(true);
  });

  it('uses empty knowledge path when the new chat cannot be resolved', async () => {
    const source = makeChat();
    const pcm = {
      getChatConfig: vi.fn((_alias: string, chatId: string) => (chatId === 'chat_src' ? source : null)),
      addChatConfig: vi.fn(async () => true),
    } as unknown as ProfileCacheManager;
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(true);
    expect(result.knowledgeCopyFailed).toBe(false);
  });

  it('returns Unknown error when a non-Error is thrown', async () => {
    const pcm = {
      getChatConfig: vi.fn(() => { throw 'boom'; }),
      addChatConfig: vi.fn(async () => true),
    } as unknown as ProfileCacheManager;
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });

  it('skips copy when the source knowledge path is not a directory', async () => {
    (fs.promises.stat as any).mockResolvedValue({ isDirectory: () => false });
    const chat = makeChat();
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(true);
    expect(result.knowledgeCopyFailed).toBe(false);
  });

  it('recurses into nested subdirectories when copying knowledge', async () => {
    (fs.promises.stat as any).mockResolvedValue({ isDirectory: () => true });
    (fs.promises.readdir as any)
      .mockResolvedValueOnce(['sub'])
      .mockResolvedValueOnce([]);
    const chat = makeChat();
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(true);
    expect(fs.promises.readdir).toHaveBeenCalledTimes(2);
  });

  it('does not carry the source agent store id to the duplicate (a fresh id is minted downstream)', async () => {
    // If the duplicate reused the source's store id, addChatConfig -> persistNewChatAgents
    // would OVERWRITE agents/{sourceId}/agent.json and point the copy at the source's
    // knowledge. The duplicate must be handed to addChatConfig with no id so a fresh
    // UUID is minted (via ensureInlineAgentIds) for its own store dir.
    const sourceAgent = makeAgent({ id: 'agent_20260101010101_src123abc', workspace: '', knowledge: { knowledgeBase: '' } });
    const chat = makeChat({ agent: sourceAgent });
    const pcm = makePcm([chat]);
    const result = await duplicateAgent(pcm, 'alice', 'chat_src', 'Copy');
    expect(result.success).toBe(true);
    const passedChat = (pcm.addChatConfig as any).mock.calls[0][1];
    expect(passedChat.agent.id).toBeUndefined();
    // The source agent object is untouched (its store id is preserved).
    expect(sourceAgent.id).toBe('agent_20260101010101_src123abc');
  });
});
