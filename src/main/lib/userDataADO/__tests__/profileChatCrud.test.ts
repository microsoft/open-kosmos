import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
  getDefaultWorkspacePath: vi.fn((alias: string, chatId: string) =>
    `/mock/userData/profiles/${alias}/chat_workspaces/${chatId}`
  ),
  getAgentKnowledgePath: vi.fn((alias: string, agentId: string) =>
    `/mock/userData/profiles/${alias}/agents/${agentId}/knowledge`
  ),
  getDefaultAgentWorkspacePath: vi.fn((alias: string, name: string, source: string) =>
    `/mock/userData/profiles/${alias}/chat_workspaces/agent-${name.toLowerCase().replace(/\s+/g, '-')}-${source.toLowerCase()}`
  ),
  ensureWorkspaceExists: vi.fn(() => true),
  removeChatSessionsDirectory: vi.fn(() => true),
  removeDefaultWorkspaceDirectory: vi.fn(() => true),
  isDefaultWorkspacePath: vi.fn(() => true),
}));

vi.mock('../../../../shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: '1.0.0',
}));

vi.mock('../agentStoreManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agentStoreManager')>();
  // Wrap readAgent as a spy that defaults to the real implementation so the
  // direct-store fallback tier in updateChatAgent — and the store-durability gate
  // in syncChatAgentsToStore — can be exercised/simulated. Wrap deleteAgent as a
  // no-op spy so tests can assert stale-agent/chat-delete pruning without touching
  // `/mock`. Wrap writeAgent as a spy that DEFAULTS to durable success (no-op):
  // the real impl throws under the unwritable `/mock` store, which would make
  // every edit look like a failed store write now that syncChatAgentsToStore
  // surfaces thrown writes; tests that want to simulate a failed write override it
  // with `mockRejectedValue`. Keep every other store function real so
  // syncChatAgentsToStore behaves normally.
  return {
    ...actual,
    readAgent: vi.fn(actual.readAgent),
    deleteAgent: vi.fn(async () => {}),
    writeAgent: vi.fn(async () => {}),
  };
});

const mockSchedulerManager = vi.hoisted(() => ({
  getUserAlias: vi.fn(() => 'alice'),
  listJobs: vi.fn(async () => []),
  deleteJob: vi.fn(async () => true),
}));

vi.mock('../../scheduler/SchedulerManager', () => ({
  schedulerManager: mockSchedulerManager,
}));

vi.mock('../../scheduler/scheduleStore', () => ({
  ScheduleStore: {
    getInstance: vi.fn(() => ({
      getCurrentAlias: vi.fn(() => 'alice'),
      listJobs: vi.fn(async () => []),
      deleteJob: vi.fn(async () => true),
    })),
  },
}));

vi.mock('../scheduleSettingsManager', () => ({
  scheduleSettingsManager: {
    getAllJobs: vi.fn(async () => []),
    findJobLocation: vi.fn(async () => null),
    deleteScheduleJob: vi.fn(async () => true),
  },
}));

vi.mock('../../subAgent/subAgentTaskStore', () => ({
  SubAgentTaskStore: {
    getInstance: vi.fn(() => ({
      deleteTasksForChat: vi.fn(() => 0),
    })),
  },
}));

import {
  addChatConfig,
  updateChatConfig,
  deleteChatConfig,
  getChatConfig,
  getAllChatConfigs,
  updateChatAgent,
  ChatCrudContext,
} from '../profileChatCrud';
import { setHooksEnabled } from '../profileHookCrud';
import { setAccessorAgentResolver } from '../agentAccessor';
import { readAgent, deleteAgent, writeAgent } from '../agentStoreManager';
import { chatSkillSnapshotStore } from '../chatSkillSnapshotStore';
import { removeChatSessionsDirectory, removeDefaultWorkspaceDirectory } from '../pathUtils';
import { schedulerManager } from '../../scheduler/SchedulerManager';
import { scheduleSettingsManager } from '../scheduleSettingsManager';
import { SubAgentTaskStore } from '../../subAgent/subAgentTaskStore';
import type { ProfileV2, ChatConfig, ChatAgent } from '../types/profile';

function makeProfile(alias = 'alice'): ProfileV2 {
  return {
    version: '2.0.0' as any,
    alias,
    primaryChat: 'chat_001',
    mcp_servers: [],
    skills: [],
    chats: [],
    'starred-chat-sessions': [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as ProfileV2;
}

function makeAgent(overrides: Partial<ChatAgent> = {}): ChatAgent {
  return {
    name: 'Test Agent',
    model: 'gpt-4o',
    system_prompt: 'Hi',
    source: 'ON-DEVICE',
    version: '1.0.0',
    workspace: '/workspace',
    knowledge: { knowledgeBase: '/workspace/knowledge' },
    mcp_servers: [],
    skills: [],
    ...overrides,
  } as ChatAgent;
}

function makeChat(overrides: Partial<ChatConfig> = {}): ChatConfig {
  return {
    chat_id: 'chat_001',
    chat_type: 'single_agent',
    agent: makeAgent(),
    ...overrides,
  };
}

function makeCtx(profile?: ProfileV2, alias = 'alice'): ChatCrudContext {
  const cache = new Map<string, ProfileV2>();
  if (profile) cache.set(alias, profile);
  return {
    cache,
    readProfileFromFile: vi.fn(async () => null),
    writeProfileToFile: vi.fn(async () => true),
    notifyProfileDataManager: vi.fn(async () => {}),
    getProfileDirectoryPath: vi.fn((a: string) => `/mock/userData/profiles/${a}`),
  };
}

let realReadAgent: ((dir: string, id: string) => unknown) | null = null;

beforeEach(async () => {
  vi.clearAllMocks();
  // Restore readAgent to its real implementation before every test so a per-test
  // durability simulation (mockReturnValue) can never leak into a later test. The
  // real impl returns null under the unwritable /mock store, which is exactly what
  // the syncChatAgentsToStore durability gate needs to observe by default.
  if (!realReadAgent) {
    const actual = await vi.importActual<typeof import('../agentStoreManager')>('../agentStoreManager');
    realReadAgent = actual.readAgent as (dir: string, id: string) => unknown;
  }
  (readAgent as any).mockReset();
  (readAgent as any).mockImplementation(realReadAgent);
  // Reset writeAgent to its durable-success default so a per-test mockRejectedValue
  // (failed-store-write simulation) can never leak into a later test.
  (writeAgent as any).mockReset();
  (writeAgent as any).mockResolvedValue(undefined);
  (deleteAgent as any).mockReset();
  (deleteAgent as any).mockResolvedValue(undefined);
  (removeChatSessionsDirectory as any).mockReturnValue(true);
  (removeDefaultWorkspaceDirectory as any).mockReturnValue(true);
  mockSchedulerManager.getUserAlias.mockReturnValue('alice');
  mockSchedulerManager.listJobs.mockResolvedValue([]);
  mockSchedulerManager.deleteJob.mockResolvedValue(true);
  (scheduleSettingsManager.getAllJobs as any).mockResolvedValue([]);
  (scheduleSettingsManager.findJobLocation as any).mockResolvedValue(null);
  (scheduleSettingsManager.deleteScheduleJob as any).mockResolvedValue(true);
  (SubAgentTaskStore.getInstance as any).mockReturnValue({ deleteTasksForChat: vi.fn(() => 0) });
});

// ── addChatConfig ─────────────────────────────────────────────────────────────

describe('addChatConfig', () => {
  it('adds chat config to profile', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const result = await addChatConfig(ctx, 'alice', makeChat());
    expect(result).toBe(true);
    expect(profile.chats).toHaveLength(1);
  });

  it('stamps agent_ids from the inline agent carried id', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({ agent: makeAgent({ name: 'Kobi', source: 'ON-DEVICE', id: 'agent_fixed_kobi' }) });
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.agent_ids).toEqual(['agent_fixed_kobi']);
  });

  it('mints a stable UUID for a new inline agent that has no id', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({ agent: makeAgent({ name: 'Kobi', source: 'ON-DEVICE' }) });
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.agent_ids).toHaveLength(1);
    expect(chat.agent_ids![0]).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
    // The minted id is written back onto the inline agent (id-stable across renames).
    expect(chat.agent!.id).toBe(chat.agent_ids![0]);
  });

  it('stamps agent_ids from a multi-agent chat', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({ agents: [makeAgent({ name: 'A', id: 'agent_fixed_a' }), makeAgent({ name: 'B', source: 'IN-LIBRARY', id: 'agent_fixed_b' })] });
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.agent_ids).toEqual(['agent_fixed_a', 'agent_fixed_b']);
  });

  it('lets inline agents win over stale caller-supplied agent_ids', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    // Chat carries both an inline agent and a stale agent_ids value; the inline
    // agent's carried id is authoritative on create.
    const chat = makeChat({ agent: makeAgent({ name: 'Kobi', source: 'ON-DEVICE', id: 'agent_fixed_kobi' }), agent_ids: ['stale'] } as any);
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.agent_ids).toEqual(['agent_fixed_kobi']);
  });

  it('preserves caller-supplied agent_ids when the chat has no inline agent', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    // Reference-by-id only (no inline) must keep its ids without deleting the
    // shared store entries they point to.
    const chat = makeChat({ agent: undefined, agent_ids: ['agent-shared-on-device'] } as any);
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.agent_ids).toEqual(['agent-shared-on-device']);
  });

  it('leaves agent_ids unset when chat has no agent', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({ agent: undefined });
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.agent_ids).toBeUndefined();
  });

  it('returns false when chat_id already exists', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    expect(await addChatConfig(ctx, 'alice', makeChat())).toBe(false);
  });

  it('auto-sets workspace path (keyed by chat_id) when not provided', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({ chat_id: 'chat_001', agent: makeAgent({ workspace: '' }) });
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.workspace).toContain('chat_workspaces/chat_001');
    expect(chat.workspace).not.toContain('agent-');
    expect(chat.agent!.workspace).toBeUndefined();
  });

  it('keys the auto-set workspace by chat_id regardless of agent name/source', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    // A nameless agent yields no store ids, but the workspace is still keyed by
    // chat_id (not by agent identity), and agent_ids stays unset.
    const chat = makeChat({
      chat_id: 'chat_xyz',
      agent: makeAgent({ name: '', source: undefined, workspace: '' } as any),
    });

    await addChatConfig(ctx, 'alice', chat);

    expect(chat.workspace).toContain('chat_workspaces/chat_xyz');
    expect(chat.agent!.workspace).toBeUndefined();
    expect(chat.agent_ids).toBeUndefined();
  });

  it('adds configs without an agent', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const result = await addChatConfig(ctx, 'alice', makeChat({ agent: undefined }));
    expect(result).toBe(true);
    expect(profile.chats[0].agent).toBeUndefined();
  });

  it('auto-sets knowledgeBase to the agent store location when empty', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({
      agent: makeAgent({ name: 'Kobi', source: 'ON-DEVICE', workspace: '/ws', knowledge: { knowledgeBase: '' }, id: 'agent_fixed_kobi' }),
    });
    await addChatConfig(ctx, 'alice', chat);
    // Store-keyed: agents/{id}/knowledge rather than under the chat workspace.
    expect(chat.agent!.knowledge?.knowledgeBase).toContain('agents/agent_fixed_kobi/knowledge');
  });

  it('overrides caller-supplied knowledgeBase with the agent store location', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({
      agent: makeAgent({
        name: 'Legacy Agent',
        source: 'IN-LIBRARY',
        id: 'agent_fixed_legacy',
        knowledgeBase: '/remote/legacy/knowledge',
        knowledge: { knowledgeBase: '/remote/legacy/knowledge' },
      }),
    });

    await addChatConfig(ctx, 'alice', chat);

    expect(chat.agent!.knowledgeBase).toBeUndefined();
    expect(chat.agent!.knowledge?.knowledgeBase).toBe('/mock/userData/profiles/alice/agents/agent_fixed_legacy/knowledge');
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await addChatConfig(ctx, 'alice', makeChat())).toBe(false);
  });

  it('reads from file when not in cache', async () => {
    const profile = makeProfile();
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);
    const result = await addChatConfig(ctx, 'alice', makeChat());
    expect(result).toBe(true);
  });

  it('returns false for invalid profile shape', async () => {
    const ctx = makeCtx({ version: 'legacy' } as any);
    expect(await addChatConfig(ctx, 'alice', makeChat())).toBe(false);
  });

  it('returns false when cache access throws', async () => {
    const ctx = makeCtx();
    (ctx.cache as any).get = vi.fn(() => { throw new Error('cache failed'); });
    expect(await addChatConfig(ctx, 'alice', makeChat())).toBe(false);
  });

  it('does not mutate or notify when add persistence fails', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);

    expect(await addChatConfig(ctx, 'alice', makeChat())).toBe(false);

    expect(profile.chats).toHaveLength(0);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('fails the create (no profile write, no notify) when the agent store write throws', async () => {
    // A new chat's agent write failure leaves no resolvable agent.json, and
    // writeProfileToFile would strip the inline agent (store is SSOT), so persisting
    // would render the chat agent-less. Abort BEFORE the profile write instead.
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    (writeAgent as any).mockRejectedValue(new Error('disk full'));
    const chat = makeChat({ agent: makeAgent({ name: 'Kobi', source: 'ON-DEVICE', id: 'agent_fixed_kobi' }) });

    expect(await addChatConfig(ctx, 'alice', chat)).toBe(false);

    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
    expect(profile.chats).toHaveLength(0);
  });
});

// ── updateChatConfig ──────────────────────────────────────────────────────────

describe('updateChatConfig', () => {
  it('updates chat config fields', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const result = await updateChatConfig(ctx, 'alice', 'chat_001', { chat_type: 'multi_agent' });
    expect(result).toBe(true);
    expect(profile.chats[0].chat_type).toBe('multi_agent');
  });

  it('updates only the target chat config after persistence succeeds', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_id: 'chat_001', chat_type: 'single_agent' }));
    profile.chats.push(makeChat({ chat_id: 'chat_002', chat_type: 'single_agent' }));
    const ctx = makeCtx(profile);

    const result = await updateChatConfig(ctx, 'alice', 'chat_002', { chat_type: 'multi_agent' });

    expect(result).toBe(true);
    expect(profile.chats[0].chat_type).toBe('single_agent');
    expect(profile.chats[1].chat_type).toBe('multi_agent');
  });

  it('reads uncached profiles before staging chat config updates', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', { chat_type: 'multi_agent' });

    expect(result).toBe(true);
    expect(profile.chats[0].chat_type).toBe('multi_agent');
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('does not update cache or notify when chat config persistence fails', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_type: 'single_agent' }));
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', {
      chat_type: 'multi_agent',
      agents: [makeAgent({ name: 'Member', hooks: ['hook-a'] })],
    });

    expect(result).toBe(false);
    expect(profile.chats[0].chat_type).toBe('single_agent');
    expect(profile.chats[0].agents).toBeUndefined();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('returns false when chat not found', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateChatConfig(ctx, 'alice', 'no_chat', {})).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await updateChatConfig(ctx, 'alice', 'chat_001', {})).toBe(false);
  });

  it('returns false for invalid uncached profile shape', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue({ version: 'legacy' });
    expect(await updateChatConfig(ctx, 'alice', 'chat_001', {})).toBe(false);
  });

  it('returns false when chat config persistence throws', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockRejectedValue(new Error('disk full'));

    expect(await updateChatConfig(ctx, 'alice', 'chat_001', { chat_type: 'multi_agent' })).toBe(false);
    expect(profile.chats[0].chat_type).toBe('single_agent');
  });

  it('writes agent edits through to the store when the config update carries a single agent', async () => {
    // Regression: post-separation, an agent-bearing updateChatConfig (such as
    // single-agent skill apply/remove) must sync the inline
    // agent to `agents/{id}/agent.json` and re-stamp agent_ids — not silently
    // drop the edit the way a profile-only write would.
    const profile = makeProfile();
    profile.chats.push({ chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: [] });
    const ctx = makeCtx(profile);

    // Simulate a durable store write: the syncChatAgentsToStore durability gate
    // reads the just-written agent back; under the unwritable /mock store the real
    // writeAgent throws, so make readAgent report the id as persisted to exercise
    // the happy-path restamp.
    (readAgent as any).mockReturnValue(makeAgent({ name: 'Skilled', skills: ['docx'] }));

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', {
      agent: makeAgent({ name: 'Skilled', skills: ['docx'] }),
    });

    expect(result).toBe(true);
    // syncChatAgentsToStore re-stamped agent_ids from the inline agent, proving
    // the store write-through ran (a plain profile write would leave ids empty).
    expect(profile.chats[0].agent_ids).toEqual(['agent-skilled-on-device']);
  });

  it('fills empty knowledgeBase with the existing store id before writing updateChatConfig agents', async () => {
    const profile = makeProfile();
    profile.chats.push({ chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: ['agent_fixed_legacy'] });
    const ctx = makeCtx(profile);
    (readAgent as any).mockImplementation((_profileDir: string, id: string) =>
      id === 'agent_fixed_legacy' ? makeAgent({ name: 'Legacy Agent', id: 'agent_fixed_legacy' }) : null
    );

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', {
      agent: makeAgent({
        name: 'Legacy Agent',
        knowledgeBase: '',
        knowledge: { knowledgeBase: '' },
      }),
    });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.knowledgeBase).toBeUndefined();
    expect(profile.chats[0].agent?.knowledge?.knowledgeBase).toBe('/mock/userData/profiles/alice/agents/agent_fixed_legacy/knowledge');
  });

  it('ignores legacy workspace updates and keeps the derived chat workspace', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_id: 'chat_001', workspace: '/old-chat-workspace' }));
    const ctx = makeCtx(profile);
    (readAgent as any).mockReturnValue(makeAgent({ name: 'Moved' }));

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', {
      agent: makeAgent({ name: 'Moved', workspace: '/new-chat-workspace' }),
    });

    expect(result).toBe(true);
    expect(profile.chats[0].workspace).toBe('/mock/userData/profiles/alice/chat_workspaces/chat_001');
    expect(profile.chats[0].agent?.workspace).toBeUndefined();
  });

  it('writes agent edits through to the store when the config update carries a multi-agent list', async () => {
    const profile = makeProfile();
    profile.chats.push({ chat_id: 'chat_001', chat_type: 'multi_agent', agent_ids: [] });
    const ctx = makeCtx(profile);

    // Simulate a durable store write so the durability gate lets the restamp run.
    (readAgent as any).mockReturnValue(makeAgent({ name: 'Alpha' }));

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', {
      agents: [makeAgent({ name: 'Alpha' }), makeAgent({ name: 'Beta' })],
    });

    expect(result).toBe(true);
    expect(profile.chats[0].agent_ids).toEqual(['agent-alpha-on-device', 'agent-beta-on-device']);
  });

  it('does not touch the store for non-agent chat-field updates', async () => {
    // The guard must NOT fire when no agent/agents field is present: a chat-only
    // update (chat_type here) leaves the existing agent binding untouched.
    const profile = makeProfile();
    profile.chats.push({ chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: ['agent-preexisting-on-device'] });
    const ctx = makeCtx(profile);

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', { chat_type: 'multi_agent' });

    expect(result).toBe(true);
    expect(profile.chats[0].chat_type).toBe('multi_agent');
    expect(profile.chats[0].agent_ids).toEqual(['agent-preexisting-on-device']);
  });

  it('fails the edit (no prune, no strip, no re-stamp) when the replacement store write throws (data-loss guard)', async () => {
    // Regression: writeInlineAgentsToStore is best-effort and records an intended id
    // BEFORE the agents/{id}/agent.json write and swallows a write failure. Without a
    // durability gate, swapping agent A -> B where writeAgent(B) fails would compute
    // stale=[A], delete A's folder+knowledge, and stamp agent_ids=[B] — destroying A
    // while B was never written and binding the chat to a nonexistent agent. A thrown
    // store write is now surfaced (writeFailedSink), so the CRUD op FAILS before the
    // profile write: A is not pruned, agent_ids is unchanged, and the profile (whose
    // strip would otherwise drop the edited inline agent) is never written.
    const profile = makeProfile();
    profile.chats.push({ chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: ['agent-old-on-device'] });
    const ctx = makeCtx(profile);
    (writeAgent as any).mockRejectedValue(new Error('disk full'));

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', {
      agent: makeAgent({ name: 'New', id: 'agent-new-on-device' }),
    });

    expect(result).toBe(false);
    // The profile write (and its inline-stripping) is never reached.
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
    // No prune: the previous agent (and its knowledge) is untouched.
    expect(deleteAgent).not.toHaveBeenCalled();
    // No dangling stamp: the persisted chat still binds the durable, pre-edit agent.
    expect(profile.chats[0].agent_ids).toEqual(['agent-old-on-device']);
  });

  it('fails a same-id agent edit (no strip) when the store write throws, so the edit is not silently lost', async () => {
    // The most common edit: change an existing agent's content, id unchanged. If the
    // store write fails, the previous agent.json survives (atomic write), so readAgent
    // still returns the STALE copy — neither the durability gate nor
    // stripInlineChatAgentsForDisk can see the failure. Persisting the profile would
    // strip the edited inline agent and lose the edit on reload. The op must instead
    // fail so the editor stays dirty and the durable old content is intact.
    const profile = makeProfile();
    profile.chats.push({
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: makeAgent({ name: 'Old', id: 'agent-x' }),
      agent_ids: ['agent-x'],
    });
    const ctx = makeCtx(profile);
    // Stale old copy resolves (masks the failure from the readAgent gate) ...
    (readAgent as any).mockReturnValue(makeAgent({ name: 'Old', id: 'agent-x' }));
    // ... but the edit's store write throws.
    (writeAgent as any).mockRejectedValue(new Error('disk full'));

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'gpt-5.5' });

    expect(result).toBe(false);
    // Never reached the strip/persist, so the inline edit was not dropped from disk.
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
    expect(deleteAgent).not.toHaveBeenCalled();
    // The durable binding to the (old) agent is preserved.
    expect(profile.chats[0].agent_ids).toEqual(['agent-x']);
  });

  it('prunes the genuinely-removed agent when the replacement store write is durable', async () => {
    // Complement to the data-loss guard: when the replacement IS durably written,
    // the stale prune must still run so a genuine agent swap deletes the old store
    // entry and re-stamps agent_ids to the new id.
    const profile = makeProfile();
    profile.chats.push({ chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: ['agent-old-on-device'] });
    const ctx = makeCtx(profile);

    // Simulate a durable write for the replacement id so the durability gate passes.
    (readAgent as any).mockReturnValue(makeAgent({ name: 'New', id: 'agent-new-on-device' }));

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', {
      agent: makeAgent({ name: 'New', id: 'agent-new-on-device' }),
    });

    expect(result).toBe(true);
    expect(deleteAgent).toHaveBeenCalledWith('/mock/userData/profiles/alice', 'agent-old-on-device');
    expect(profile.chats[0].agent_ids).toEqual(['agent-new-on-device']);
  });

  it('does NOT prune the swapped-out agent when the profile write fails after a durable store write (ordering guard)', async () => {
    // Finding: syncChatAgentsToStore used to delete the stale agent BEFORE the caller's
    // writeProfileToFile committed. If that profile write then failed, the persisted
    // profile (and the in-memory cache, which is only advanced on success) still bound
    // the DELETED agent -> agent loss on reload. The prune is now deferred until after a
    // durable profile write, so a failed write must leave the old agent intact.
    const profile = makeProfile();
    profile.chats.push({ chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: ['agent-old-on-device'] });
    const ctx = makeCtx(profile);
    // Replacement is durably written (gate passes) ...
    (readAgent as any).mockReturnValue(makeAgent({ name: 'New', id: 'agent-new-on-device' }));
    // ... but the profile write fails.
    (ctx.writeProfileToFile as any).mockResolvedValue(false);

    const result = await updateChatConfig(ctx, 'alice', 'chat_001', {
      agent: makeAgent({ name: 'New', id: 'agent-new-on-device' }),
    });

    expect(result).toBe(false);
    // The stale prune must NOT have run — the old agent is preserved because the new
    // binding never reached disk.
    expect(deleteAgent).not.toHaveBeenCalled();
    // The cached profile still binds the original, undeleted agent.
    expect(profile.chats[0].agent_ids).toEqual(['agent-old-on-device']);
  });

  it('serializes multi-agent hook binding writes with the Hooks master-switch write', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({
      chat_type: 'multi_agent',
      agents: [makeAgent({ name: 'Member', hooks: [] })],
    }));
    const cache = new Map<string, ProfileV2>([['alice', profile]]);
    const writeProfileToFile = vi.fn(async (_alias: string, nextProfile: ProfileV2) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      cache.set('alice', nextProfile);
      return true;
    });
    const ctx = {
      cache,
      getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile,
      notifyProfileDataManager: vi.fn(async () => {}),
    };

    // The global Hook list moved to hooks.json, but the Hooks master switch
    // (hooksEnabled) stays in profile.json and still takes the shared profile write
    // lock. Pairing it with a concurrent multi-agent binding write proves neither
    // change clobbers the other (no lost update).
    const [configUpdated, switchToggled] = await Promise.all([
      updateChatConfig(ctx, 'alice', 'chat_001', {
        agents: [makeAgent({ name: 'Member', hooks: ['hook-a'] })],
      }),
      setHooksEnabled(ctx, 'alice', true),
    ]);

    expect(configUpdated).toBe(true);
    expect(switchToggled).toBe(true);
    expect(cache.get('alice')?.chats[0].agents?.[0].hooks).toEqual(['hook-a']);
    expect(cache.get('alice')?.hooksEnabled).toBe(true);
  });
});

// ── deleteChatConfig ──────────────────────────────────────────────────────────

describe('deleteChatConfig', () => {
  it('removes chat and replaces with default when it is the only chat', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const result = await deleteChatConfig(ctx, 'alice', 'chat_001');
    expect(result).toBe(true);
    expect(profile.chats).toHaveLength(1);
    expect(profile.chats[0].chat_id).not.toBe('chat_001');
  });

  it('seeds the replacement default chat into the store so the renderer can resolve it', async () => {
    // Regression: deleting the last chat replaces it with a fresh default chat that
    // carries only an inline agent (no agent_ids, nothing in the store). Without
    // seeding, writeProfileToFile keeps it un-stamped and buildRendererProfilePayload
    // strips the inline agent, so the pushed chat has no agent_ids and the renderer's
    // resolveChatAgent returns null (no default agent/model/tools) until a reload
    // self-heals. deleteChatConfig must seed it (persistNewChatAgents) like the
    // first-run create path, stamping agent_ids from the minted store id.
    const profile = makeProfile();
    profile.chats.push(makeChat()); // single non-builtin chat -> triggers the replacement
    const ctx = makeCtx(profile);

    const result = await deleteChatConfig(ctx, 'alice', 'chat_001');

    expect(result).toBe(true);
    const replacement = profile.chats[0];
    expect(replacement.chat_id).not.toBe('chat_001');
    expect(replacement.agent_ids).toHaveLength(1);
    expect(replacement.agent_ids![0]).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
    // The minted store id is written back onto the inline agent, so the cache copy
    // and the store agree on identity.
    expect(replacement.agent!.id).toBe(replacement.agent_ids![0]);
  });

  it('fails the last-chat deletion (keeps the original) when the replacement agent store write throws', async () => {
    // Deleting the last chat seeds a fresh default agent into the store. If that
    // write fails, proceeding would delete the original chat into an agent-less
    // default (agent_ids pointing at a missing agent.json after the inline strip).
    // Abort instead so the original chat stays intact.
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    (writeAgent as any).mockRejectedValue(new Error('disk full'));

    const result = await deleteChatConfig(ctx, 'alice', 'chat_001');

    expect(result).toBe(false);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
    // The original chat is preserved (not replaced by a broken default).
    expect(profile.chats).toHaveLength(1);
    expect(profile.chats[0].chat_id).toBe('chat_001');
  });

  it('does not seed a replacement when other chats remain (only splices)', async () => {
    // The seeding branch must be gated on the last-chat replacement path: deleting one
    // of several chats simply removes it, and the surviving chats are left untouched.
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_id: 'chat_001' }));
    const survivor = makeChat({ chat_id: 'chat_002', agent: makeAgent({ name: 'Agent 2' }) });
    profile.chats.push(survivor);
    const ctx = makeCtx(profile);

    await deleteChatConfig(ctx, 'alice', 'chat_001');

    expect(profile.chats).toHaveLength(1);
    expect(profile.chats[0].chat_id).toBe('chat_002');
    // The survivor keeps whatever binding it had; the delete path did not stamp new ids on it.
    expect(profile.chats[0].agent_ids).toBeUndefined();
  });

  it('splices chat when multiple chats exist', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_id: 'chat_001' }));
    profile.chats.push(makeChat({ chat_id: 'chat_002', agent: makeAgent({ name: 'Agent 2' }) }));
    const ctx = makeCtx(profile);
    await deleteChatConfig(ctx, 'alice', 'chat_001');
    expect(profile.chats).toHaveLength(1);
    expect(profile.chats[0].chat_id).toBe('chat_002');
  });

  it('cleans chat-owned resources and deletes the unshared agent after durable profile deletion', async () => {
    const ownedAgent = makeAgent({ id: 'agent-owned' });
    setAccessorAgentResolver((ids) => (ids.includes('agent-owned') ? [ownedAgent] : []));
    try {
      const profile = makeProfile();
      profile.chats.push(makeChat({
        chat_id: 'chat_001',
        agent: undefined,
        agent_ids: ['agent-owned'],
      }));
      profile.chats.push(makeChat({
        chat_id: 'chat_002',
        agent: makeAgent({ id: 'agent-other', name: 'Other' }),
        agent_ids: ['agent-other'],
      }));
      const ctx = makeCtx(profile);
      const deleteSubAgentTasksForChat = vi.fn(() => 1);
      mockSchedulerManager.listJobs.mockResolvedValue([{ id: 'sched-1' }, { id: 'sched-2' }] as any);
      (SubAgentTaskStore.getInstance as any).mockReturnValue({ deleteTasksForChat: deleteSubAgentTasksForChat });

      const result = await deleteChatConfig(ctx, 'alice', 'chat_001');

      expect(result).toBe(true);
      expect(profile.chats.map(chat => chat.chat_id)).toEqual(['chat_002']);
      expect(removeChatSessionsDirectory).toHaveBeenCalledWith('alice', 'chat_001');
      expect(removeDefaultWorkspaceDirectory).toHaveBeenCalledWith('alice', 'chat_001');
      expect(schedulerManager.listJobs).toHaveBeenCalledWith('chat_001');
      expect(schedulerManager.deleteJob).toHaveBeenCalledWith('sched-1');
      expect(schedulerManager.deleteJob).toHaveBeenCalledWith('sched-2');
      expect(deleteSubAgentTasksForChat).toHaveBeenCalledWith('alice', 'chat_001');
      expect(deleteAgent).toHaveBeenCalledWith('/mock/userData/profiles/alice', 'agent-owned');
      expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
    } finally {
      setAccessorAgentResolver(null);
    }
  });

  it('does not delete an agent that is still referenced by another chat', async () => {
    const sharedAgent = makeAgent({ id: 'agent-shared' });
    setAccessorAgentResolver((ids) => (ids.includes('agent-shared') ? [sharedAgent] : []));
    try {
      const profile = makeProfile();
      profile.chats.push(makeChat({
        chat_id: 'chat_001',
        agent: undefined,
        agent_ids: ['agent-shared'],
      }));
      profile.chats.push(makeChat({
        chat_id: 'chat_002',
        agent: undefined,
        agent_ids: ['agent-shared'],
      }));
      const ctx = makeCtx(profile);

      expect(await deleteChatConfig(ctx, 'alice', 'chat_001')).toBe(true);

      expect(deleteAgent).not.toHaveBeenCalledWith('/mock/userData/profiles/alice', 'agent-shared');
      expect(profile.chats.map(chat => chat.chat_id)).toEqual(['chat_002']);
    } finally {
      setAccessorAgentResolver(null);
    }
  });

  it('cleans schedule settings directly when the runtime scheduler is on a different alias', async () => {
    const ownedAgent = makeAgent({ id: 'agent-owned' });
    setAccessorAgentResolver((ids) => (ids.includes('agent-owned') ? [ownedAgent] : []));
    try {
      const profile = makeProfile();
      profile.chats.push(makeChat({
        chat_id: 'chat_001',
        agent: undefined,
        agent_ids: ['agent-owned'],
      }));
      profile.chats.push(makeChat({ chat_id: 'chat_002', agent: makeAgent({ id: 'agent-other', name: 'Other' }), agent_ids: ['agent-other'] }));
      const ctx = makeCtx(profile);
      mockSchedulerManager.getUserAlias.mockReturnValue('bob');
      (scheduleSettingsManager.getAllJobs as any).mockResolvedValue([
        { id: 'sched-1', chat_id: 'chat_001' },
        { id: 'sched-other', chat_id: 'chat_002' },
      ]);
      (scheduleSettingsManager.findJobLocation as any).mockResolvedValue({ monthKey: '202607' });

      expect(await deleteChatConfig(ctx, 'alice', 'chat_001')).toBe(true);

      expect(scheduleSettingsManager.getAllJobs).toHaveBeenCalledWith('alice');
      expect(scheduleSettingsManager.findJobLocation).toHaveBeenCalledWith('alice', 'sched-1');
      expect(scheduleSettingsManager.deleteScheduleJob).toHaveBeenCalledWith('alice', '202607', 'sched-1');
      expect(scheduleSettingsManager.findJobLocation).not.toHaveBeenCalledWith('alice', 'sched-other');
    } finally {
      setAccessorAgentResolver(null);
    }
  });

  it('continues deletion when post-profile resource cleanup hooks fail', async () => {
    const ownedAgent = makeAgent({ id: 'agent-owned' });
    setAccessorAgentResolver((ids) => (ids.includes('agent-owned') ? [ownedAgent] : []));
    try {
      const profile = makeProfile();
      profile.chats.push(makeChat({
        chat_id: 'chat_001',
        agent: undefined,
        agent_ids: ['agent-owned'],
      }));
      profile.chats.push(makeChat({ chat_id: 'chat_002', agent: makeAgent({ id: 'agent-other', name: 'Other' }), agent_ids: ['agent-other'] }));
      const ctx = makeCtx(profile);
      (ctx.getProfileDirectoryPath as any).mockReturnValue('/dev/null');
      mockSchedulerManager.listJobs.mockRejectedValue(new Error('scheduler failed'));
      (SubAgentTaskStore.getInstance as any).mockImplementation(() => {
        throw 'sub-agent cleanup failed';
      });
      (deleteAgent as any).mockRejectedValue('agent cleanup failed');

      const result = await deleteChatConfig(ctx, 'alice', 'chat_001');

      expect(result).toBe(true);
      expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
    } finally {
      setAccessorAgentResolver(null);
    }
  });

  it('skips memex directory cleanup for an unsafe chat id', async () => {
    const unsafeChatId = '../evil';
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_id: unsafeChatId, agent: makeAgent({ id: 'agent-owned' }), agent_ids: ['agent-owned'] }));
    profile.chats.push(makeChat({ chat_id: 'chat_002', agent: makeAgent({ id: 'agent-other', name: 'Other' }), agent_ids: ['agent-other'] }));
    const ctx = makeCtx(profile);

    expect(await deleteChatConfig(ctx, 'alice', unsafeChatId)).toBe(true);
  });

  it('returns false when chat not found', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await deleteChatConfig(ctx, 'alice', 'no_chat')).toBe(false);
  });

  it('returns false when trying to delete builtin agent (Kobi)', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ agent: makeAgent({ name: 'Kobi' }) }));
    const ctx = makeCtx(profile);
    expect(await deleteChatConfig(ctx, 'alice', 'chat_001')).toBe(false);
  });

  it('blocks deleting a built-in agent resolved from an agent_ids-only cached chat', async () => {
    // Regression: the cached profile strips inline chat.agent, so the built-in guard
    // must resolve the agent name through the accessor/registry (getChatPrimaryAgent)
    // instead of reading chatToDelete.agent?.name — otherwise a separated chat bound
    // to a built-in agent would be deletable.
    const kobi = makeAgent({ name: 'Kobi' });
    setAccessorAgentResolver((ids) => (ids.includes('agent-kobi-on-device') ? [kobi] : []));
    try {
      const profile = makeProfile();
      profile.chats.push({ chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: ['agent-kobi-on-device'] });
      const ctx = makeCtx(profile);
      expect(await deleteChatConfig(ctx, 'alice', 'chat_001')).toBe(false);
    } finally {
      setAccessorAgentResolver(null);
    }
  });

  it('reads uncached profiles before deleting chats', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);

    const result = await deleteChatConfig(ctx, 'alice', 'chat_001');

    expect(result).toBe(true);
    expect(profile.chats[0].chat_id).not.toBe('chat_001');
  });

  it('returns false when uncached delete profile is missing or invalid', async () => {
    const missingCtx = makeCtx();
    expect(await deleteChatConfig(missingCtx, 'alice', 'chat_001')).toBe(false);

    const invalidCtx = makeCtx();
    (invalidCtx.readProfileFromFile as any).mockResolvedValue({ version: 'legacy' });
    expect(await deleteChatConfig(invalidCtx, 'alice', 'chat_001')).toBe(false);
  });

  it('continues deletion when directory cleanup fails', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    (removeChatSessionsDirectory as any).mockReturnValue(false);
    (removeDefaultWorkspaceDirectory as any).mockReturnValue(false);

    const result = await deleteChatConfig(ctx, 'alice', 'chat_001');

    expect(result).toBe(true);
  });

  it('returns false when delete throws', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockRejectedValue(new Error('disk full'));

    expect(await deleteChatConfig(ctx, 'alice', 'chat_001')).toBe(false);
  });

  it('does not mutate, cleanup, or notify when delete persistence fails', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);

    expect(await deleteChatConfig(ctx, 'alice', 'chat_001')).toBe(false);

    expect(profile.chats[0].chat_id).toBe('chat_001');
    expect(removeChatSessionsDirectory).not.toHaveBeenCalled();
    expect(removeDefaultWorkspaceDirectory).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });
});

// ── getChatConfig ─────────────────────────────────────────────────────────────

describe('getChatConfig', () => {
  it('returns chat config when found', () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const result = getChatConfig(ctx, 'alice', 'chat_001');
    expect(result?.chat_id).toBe('chat_001');
  });

  it('returns null when chat not found', () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(getChatConfig(ctx, 'alice', 'no_chat')).toBeNull();
  });

  it('returns null when profile not found', () => {
    const ctx = makeCtx();
    expect(getChatConfig(ctx, 'alice', 'chat_001')).toBeNull();
  });

  it('returns null when cache lookup throws', () => {
    const ctx = makeCtx();
    (ctx.cache as any).get = vi.fn(() => { throw new Error('cache failed'); });
    expect(getChatConfig(ctx, 'alice', 'chat_001')).toBeNull();
  });
});

// ── getAllChatConfigs ──────────────────────────────────────────────────────────

describe('getAllChatConfigs', () => {
  it('returns all chats', () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_id: 'c1' }));
    profile.chats.push(makeChat({ chat_id: 'c2' }));
    const ctx = makeCtx(profile);
    expect(getAllChatConfigs(ctx, 'alice')).toHaveLength(2);
  });

  it('returns empty array when profile not found', () => {
    const ctx = makeCtx();
    expect(getAllChatConfigs(ctx, 'alice')).toEqual([]);
  });

  it('returns empty array when cache lookup throws', () => {
    const ctx = makeCtx();
    (ctx.cache as any).get = vi.fn(() => { throw new Error('cache failed'); });
    expect(getAllChatConfigs(ctx, 'alice')).toEqual([]);
  });
});

// ── updateChatAgent ───────────────────────────────────────────────────────────

describe('updateChatAgent', () => {
  it('updates agent fields', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'gpt-4o-mini' });
    expect(result).toBe(true);
    expect(profile.chats[0].agent?.model).toBe('gpt-4o-mini');
  });

  it('fills missing knowledgeBase on agent updates with the agent store location', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({
      agent: makeAgent({
        id: 'agent_fixed_pm',
        name: 'PM Agent',
        knowledgeBase: '',
        knowledge: { knowledgeBase: '' },
      }),
    }));
    const ctx = makeCtx(profile);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { version: '1.2.3' });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.knowledgeBase).toBeUndefined();
    expect(profile.chats[0].agent?.knowledge?.knowledgeBase).toBe('/mock/userData/profiles/alice/agents/agent_fixed_pm/knowledge');
  });

  it('returns false when profile is missing from cache', async () => {
    const ctx = makeCtx();
    expect(await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'gpt-4o-mini' })).toBe(false);
  });

  it('creates a default agent when a chat has no agent', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ agent: undefined }));
    const ctx = makeCtx(profile);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { name: 'New Agent', workspace: '/new-workspace' });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.name).toBe('New Agent');
    expect(profile.chats[0].workspace).toBe('/mock/userData/profiles/alice/chat_workspaces/chat_001');
    expect(profile.chats[0].agent?.workspace).toBeUndefined();
  });

  it('persists an agent version change', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ agent: makeAgent({ version: '1.0.0' }) }));
    const ctx = makeCtx(profile);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { version: '2.0.0' });

    expect(result).toBe(true);
  });

  it('restores the prior version when persistence fails', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ agent: makeAgent({ version: '1.0.0' }) }));
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { version: '2.0.0' });

    expect(result).toBe(false);
    expect(profile.chats[0].agent?.version).toBe('1.0.0');
  });

  it('leaves primaryChat unchanged when renaming an agent', async () => {
    const profile = makeProfile();
    profile.primaryChat = 'chat_001';
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { name: 'Renamed Secondary' });

    expect(result).toBe(true);
    // primaryChat is keyed by the stable chat_id, so a rename never mutates it.
    expect(profile.primaryChat).toBe('chat_001');
    expect(profile.chats[0].agent?.name).toBe('Renamed Secondary');
  });

  it('returns false without cache mutation when agent persistence throws', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ agent: makeAgent({ hooks: [] }) }));
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockRejectedValue(new Error('disk full'));

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { hooks: ['hook-a'] });

    expect(result).toBe(false);
    expect(profile.chats[0].agent?.hooks).toEqual([]);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('does not activate agent hook bindings in cache when agent update persistence fails', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ agent: makeAgent({ hooks: [] }) }));
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { hooks: ['hook-a'] });

    expect(result).toBe(false);
    expect(profile.chats[0].agent?.hooks).toEqual([]);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('serializes single-agent hook binding writes with the Hooks master-switch write', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ agent: makeAgent({ hooks: [] }) }));
    const cache = new Map<string, ProfileV2>([['alice', profile]]);
    const writeProfileToFile = vi.fn(async (_alias: string, nextProfile: ProfileV2) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      cache.set('alice', nextProfile);
      return true;
    });
    const ctx = {
      cache,
      getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile,
      notifyProfileDataManager: vi.fn(async () => {}),
    };

    // hooksEnabled stays in profile.json and shares the profile write lock, so a
    // concurrent single-agent binding write and master-switch toggle must serialize
    // without losing either change.
    const [agentUpdated, switchToggled] = await Promise.all([
      updateChatAgent(ctx, 'alice', 'chat_001', { hooks: ['hook-a'] }),
      setHooksEnabled(ctx, 'alice', true),
    ]);

    expect(agentUpdated).toBe(true);
    expect(switchToggled).toBe(true);
    expect(cache.get('alice')?.chats[0].agent?.hooks).toEqual(['hook-a']);
    expect(cache.get('alice')?.hooksEnabled).toBe(true);
  });

  it('returns false when chat not found', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateChatAgent(ctx, 'alice', 'no_chat', {})).toBe(false);
  });

  it('does not churn primaryChat when the primary chat agent is renamed', async () => {
    const profile = makeProfile();
    profile.primaryChat = 'chat_001';
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    await updateChatAgent(ctx, 'alice', 'chat_001', { name: 'Renamed Agent' });
    // The primary chat mapping stays pinned to the chat_id after a rename.
    expect(profile.primaryChat).toBe('chat_001');
  });

  it('clears the in-memory skill snapshot when skills change', async () => {
    const profile = makeProfile();
    const chat = makeChat({ agent: makeAgent({ skills: ['skill-a'] }) });
    profile.chats.push(chat);
    const ctx = makeCtx(profile);
    chatSkillSnapshotStore.set('alice', 'chat_001', {
      binding_signature: 'sig', registry_signature: '', prompt: '', skills: [], generated_at: '',
    });
    await updateChatAgent(ctx, 'alice', 'chat_001', { skills: ['skill-b'] });
    expect(chatSkillSnapshotStore.get('alice', 'chat_001')).toBeUndefined();
  });

  it('keeps the in-memory skill snapshot when skills unchanged', async () => {
    const profile = makeProfile();
    const chat = makeChat({ agent: makeAgent({ skills: ['skill-a'] }) });
    profile.chats.push(chat);
    const ctx = makeCtx(profile);
    chatSkillSnapshotStore.set('alice', 'chat_001', {
      binding_signature: 'sig', registry_signature: '', prompt: '', skills: [], generated_at: '',
    });
    await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'gpt-4o-mini' });
    expect(chatSkillSnapshotStore.get('alice', 'chat_001')).toBeDefined();
    chatSkillSnapshotStore.clear('alice', 'chat_001');
  });
});

// ── updateChatAgent: agent-id-only resolution (data-loss guard) ───────────────

describe('updateChatAgent agent-id-only resolution (data-loss guard)', () => {
  afterEach(() => setAccessorAgentResolver(null));

  function idsOnlyChat(chat_id: string, ids: string[]): ChatConfig {
    return { chat_id, chat_type: 'single_agent', agent_ids: ids };
  }

  it('updates the resolved agent (not DEFAULT) and preserves its id when the cached chat is agent_ids-only', async () => {
    // Regression for the 2026-06-30 data loss: a model-only edit on a migrated
    // (agent_ids-only) chat must not fall back to DEFAULT_CHAT_AGENT, which would
    // rename the agent to "Kobi", re-stamp agent_ids to agent-kobi-on-device, and
    // prune the chat's real agent from the store.
    const openkosmos = makeAgent({
      name: 'OpenKosmos',
      source: 'ON-DEVICE',
      model: 'claude-opus-4.7-1m-internal',
      skills: ['docx', 'pptx'],
    });
    setAccessorAgentResolver((ids) => (ids.includes('agent-openkosmos-on-device') ? [openkosmos] : []));
    const profile = makeProfile();
    profile.chats.push(idsOnlyChat('chat_001', ['agent-openkosmos-on-device']));
    const ctx = makeCtx(profile);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'claude-opus-4.7' });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.name).toBe('OpenKosmos');
    expect(profile.chats[0].agent?.model).toBe('claude-opus-4.7');
    expect(profile.chats[0].agent?.skills).toEqual(['docx', 'pptx']);
    expect(profile.chats[0].agent_ids).toEqual(['agent-openkosmos-on-device']);
  });

  it('updates the primary agent without dropping secondary agents in an agent_ids-only multi-agent chat', async () => {
    const primary = makeAgent({
      id: 'agent-primary-on-device',
      name: 'Primary',
      source: 'ON-DEVICE',
      model: 'old-primary-model',
    });
    const secondary = makeAgent({
      id: 'agent-secondary-on-device',
      name: 'Secondary',
      source: 'ON-DEVICE',
      model: 'secondary-model',
    });
    setAccessorAgentResolver((ids) => ids
      .map((id) => id === primary.id ? primary : id === secondary.id ? secondary : null)
      .filter((agent): agent is ChatAgent => agent !== null));
    (readAgent as any).mockImplementation((_dir: string, id: string) =>
      id === primary.id ? primary : id === secondary.id ? secondary : null
    );
    const profile = makeProfile();
    profile.chats.push({
      chat_id: 'chat_001',
      chat_type: 'multi_agent',
      agent_ids: ['agent-primary-on-device', 'agent-secondary-on-device'],
    });
    const ctx = makeCtx(profile);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'new-primary-model' });

    expect(result).toBe(true);
    expect(profile.chats[0].agent_ids).toEqual(['agent-primary-on-device', 'agent-secondary-on-device']);
    expect(profile.chats[0].agents?.map((agent) => agent.name)).toEqual(['Primary', 'Secondary']);
    expect(profile.chats[0].agents?.[0].model).toBe('new-primary-model');
    expect(profile.chats[0].agents?.[1].model).toBe('secondary-model');
    expect(deleteAgent).not.toHaveBeenCalledWith('/mock/userData/profiles/alice', 'agent-secondary-on-device');
  });

  it('resolves the primary agent from an inline agents[] list when .agent is absent', async () => {
    const primary = makeAgent({ name: 'OpenKosmos', source: 'ON-DEVICE', skills: ['docx'] });
    const profile = makeProfile();
    profile.chats.push({ chat_id: 'chat_001', chat_type: 'single_agent', agents: [primary] });
    const ctx = makeCtx(profile);

    // Simulate a durable store write so the durability gate lets agent_ids restamp.
    (readAgent as any).mockReturnValue(primary);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'gpt-5.5' });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.name).toBe('OpenKosmos');
    expect(profile.chats[0].agent?.model).toBe('gpt-5.5');
    expect(profile.chats[0].agent_ids).toEqual(['agent-openkosmos-on-device']);
  });

  it('falls back to a direct store read when the registry resolver is empty', async () => {
    setAccessorAgentResolver(() => []);
    (readAgent as any).mockReturnValueOnce(
      makeAgent({ name: 'OpenKosmos', source: 'ON-DEVICE', skills: ['pptx'] }),
    );
    const profile = makeProfile();
    profile.chats.push(idsOnlyChat('chat_001', ['agent-openkosmos-on-device']));
    const ctx = makeCtx(profile);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'gpt-5.5' });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.name).toBe('OpenKosmos');
    expect(profile.chats[0].agent?.skills).toEqual(['pptx']);
    expect(profile.chats[0].agent_ids).toEqual(['agent-openkosmos-on-device']);
  });

  it('creates a DEFAULT-based agent only when no existing agent can be resolved', async () => {
    setAccessorAgentResolver(() => []);
    (readAgent as any).mockReturnValueOnce(null);
    const profile = makeProfile();
    profile.chats.push(idsOnlyChat('chat_001', ['ghost-id']));
    const ctx = makeCtx(profile);

    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { name: 'Brand New', model: 'gpt-5.5' });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.name).toBe('Brand New');
    expect(profile.chats[0].agent?.model).toBe('gpt-5.5');
  });
});
