import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs ───────────────────────────────────────────────────────────────────
// The archive manager now reads the archive list from `profile.archived_chats`
// (cache, or a synchronous profile.json fallback) and writes it via the profile
// write path — it no longer maintains a standalone archive file.
const { mockExistsSync, mockReadFileSync, mockReadAgent, mockPersistNewChatAgents } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockReadAgent: vi.fn(),
  mockPersistNewChatAgents: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../agentStoreManager', () => ({
  readAgent: mockReadAgent,
}));

vi.mock('../agentExtraction', () => ({
  persistNewChatAgents: mockPersistNewChatAgents,
}));

vi.mock('../pathUtils', () => ({
  getDefaultWorkspacePath: vi.fn((alias: string, chatId: string) => `/profiles/${alias}/chat_workspaces/${chatId}`),
}));

vi.mock('../types/profile', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    isProfileV2: vi.fn().mockReturnValue(true),
    isBuiltinAgent: vi.fn().mockReturnValue(false),
  };
});

import {
  readArchivedAgents,
  archiveChatConfig,
  unarchiveChatConfig,
  getArchivedAgents,
  type ArchiveContext,
} from '../profileArchiveManager';
import { isProfileV2, isBuiltinAgent } from '../types/profile';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<ArchiveContext> = {}): ArchiveContext {
  const cache = new Map<string, any>();
  return {
    cache,
    getProfileDirectoryPath: vi.fn().mockReturnValue('/profiles/alice'),
    readProfileFromFile: vi.fn().mockResolvedValue(null),
    writeProfileToFile: vi.fn().mockResolvedValue(true),
    notifyProfileDataManager: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeProfile(
  chats: any[] = [],
  primaryChat = '',
  starredSessions: any[] = [],
  archivedChats?: any[],
): any {
  const profile: any = {
    version: 2,
    alias: 'alice',
    chats,
    primaryChat,
    'starred-chat-sessions': starredSessions,
  };
  if (archivedChats !== undefined) {
    profile.archived_chats = archivedChats;
  }
  return profile;
}

const BOTA = 'agent-bota-on-device';
const OTHER_CHAT = { chat_id: 'other', agent_ids: ['agent-other-on-device'] };

function withOtherChat(chat: any): any[] {
  return [{ ...OTHER_CHAT }, chat];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadAgent.mockImplementation((_dir: string, id: string) =>
    id === BOTA ? { id, name: 'BotA', source: 'ON-DEVICE' } : null,
  );
  // Default: the pre-archive durability persist succeeds and touches no sink.
  mockPersistNewChatAgents.mockResolvedValue([]);
  (isProfileV2 as any).mockReturnValue(true);
  (isBuiltinAgent as any).mockReturnValue(false);
});

// ── readArchivedAgents / getArchivedAgents ──────────────────────────────────────

describe('readArchivedAgents', () => {
  it('reads archived_chats from the cached profile (fs untouched)', () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [BOTA] }]));
    const result = readArchivedAgents(ctx, 'alice');
    expect(result[0].chat_id).toBe('c1');
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('returns [] when the cached profile has no archived_chats', () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([]));
    expect(readArchivedAgents(ctx, 'alice')).toEqual([]);
  });

  it('falls back to a synchronous profile.json read when uncached', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ archived_chats: [{ chat_id: 'c9', agent_ids: [BOTA] }] }));
    const ctx = makeCtx();
    expect(readArchivedAgents(ctx, 'alice')[0].chat_id).toBe('c9');
  });

  it('returns [] when profile.json is absent', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readArchivedAgents(makeCtx(), 'alice')).toEqual([]);
  });

  it('returns [] when profile.json has no archived_chats key', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ chats: [] }));
    expect(readArchivedAgents(makeCtx(), 'alice')).toEqual([]);
  });

  it('returns [] when the file read throws an Error', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => { throw new Error('boom'); });
    expect(readArchivedAgents(makeCtx(), 'alice')).toEqual([]);
  });

  it('returns [] when the file read throws a non-Error', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => { throw 'string-error'; });
    expect(readArchivedAgents(makeCtx(), 'alice')).toEqual([]);
  });

  it('hydrates the agent from the store by agent_ids', () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [BOTA] }]));
    expect((readArchivedAgents(ctx, 'alice')[0].agent as { name?: string } | undefined)?.name).toBe('BotA');
  });

  it('keeps an inline agent when there are no agent_ids, leaves entry when id unresolved', () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([], '', [], [
      { chat_id: 'a', agent: { name: 'Inline' } },
      { chat_id: 'b', agent_ids: ['missing'] },
    ]));
    const result = readArchivedAgents(ctx, 'alice');
    expect((result[0].agent as { name?: string }).name).toBe('Inline');
    expect(result[1].agent).toBeUndefined();
  });
});

describe('getArchivedAgents', () => {
  it('delegates to readArchivedAgents', () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [BOTA] }]));
    expect(getArchivedAgents(ctx, 'alice')[0].chat_id).toBe('c1');
  });

  it('returns [] when nothing is archived and profile is uncached', () => {
    mockExistsSync.mockReturnValue(false);
    expect(getArchivedAgents(makeCtx(), 'alice')).toEqual([]);
  });
});

// ── archiveChatConfig ───────────────────────────────────────────────────────────

describe('archiveChatConfig', () => {
  it('returns false when profile not in cache and readProfileFromFile returns null', async () => {
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue(null) });
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
  });

  it('returns false when profile is not isProfileV2', async () => {
    (isProfileV2 as any).mockReturnValue(false);
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue({ version: 1 }) });
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
  });

  it('returns false when the chat is not found', async () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([{ chat_id: 'other', agent: { name: 'MyAgent' } }]));
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
  });

  it('returns false when the agent is a builtin agent', async () => {
    (isBuiltinAgent as any).mockReturnValue(true);
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([{ chat_id: 'c1', agent: { name: 'Kobi' } }]));
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
  });

  it('returns false when the chat is the primary chat', async () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([{ chat_id: 'c1', agent: { name: 'PrimaryBot' } }], 'c1'));
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
  });

  it('returns false when primaryChat is unset and the target is the implicit first chat', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([
      { chat_id: 'c1', agent: { name: 'BotA' } },
      { chat_id: 'c2', agent: { name: 'BotB' } },
    ]);
    ctx.cache.set('alice', profile);

    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
    expect(profile.chats.map((chat: any) => chat.chat_id)).toEqual(['c1', 'c2']);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
  });

  it('returns false when archiving would leave the profile with no active chats', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    ctx.cache.set('alice', profile);

    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
    expect(profile.chats).toHaveLength(1);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('archives from cache: moves chat into archived_chats with agent_ids and no inline agent', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(withOtherChat({ chat_id: 'c1', chat_type: 'single_agent', agent: { name: 'BotA' } }));
    ctx.cache.set('alice', profile);

    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(true);
    expect(profile.chats).toEqual([OTHER_CHAT]);
    expect(profile.archived_chats).toHaveLength(1);

    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    const entry = written.archived_chats[0];
    expect(entry.chat_id).toBe('c1');
    expect(entry.agent_ids).toEqual([BOTA]);
    expect(entry.agent).toBeUndefined();
    expect(typeof entry.archived_at).toBe('string');
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('omits chat workspace from the archived chat entry', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(withOtherChat({ chat_id: 'c1', chat_type: 'single_agent', workspace: '/chat-workspace', agent: { name: 'BotA' } }));
    ctx.cache.set('alice', profile);

    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(true);

    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    expect(written.archived_chats[0].workspace).toBeUndefined();
  });

  it('persists the chat inline agents into the store before archiving (durability)', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(withOtherChat({ chat_id: 'c1', agent: { name: 'BotA' } }));
    ctx.cache.set('alice', profile);

    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(true);
    // The pre-archive persist ran with the target chat and a failure sink.
    expect(mockPersistNewChatAgents).toHaveBeenCalledTimes(1);
    const [dirArg, chatArg, sinkArg] = mockPersistNewChatAgents.mock.calls[0];
    expect(dirArg).toBe('/profiles/alice');
    expect(chatArg.chat_id).toBe('c1');
    expect(Array.isArray(sinkArg)).toBe(true);
  });

  it('aborts (keeps the chat active, no write/notify) when the pre-archive store write fails', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(withOtherChat({ chat_id: 'c1', agent: { name: 'BotA' } }));
    ctx.cache.set('alice', profile);
    // Simulate agents/{id}/agent.json write failing: push the id into the sink so
    // the inline fallback is the last copy and archiving id-only would lose it.
    mockPersistNewChatAgents.mockImplementation(async (_dir: string, _chat: any, sink?: string[]) => {
      sink?.push(BOTA);
      return [];
    });

    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
    // Chat stays active with its inline fallback; nothing archived/persisted/notified.
    expect(profile.chats).toHaveLength(2);
    expect(profile.archived_chats).toBeUndefined();
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('appends to an existing archived_chats list', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(
      withOtherChat({ chat_id: 'c1', agent: { name: 'BotA' } }),
      '', [],
      [{ chat_id: 'old', agent_ids: ['agent-old-on-device'] }],
    );
    ctx.cache.set('alice', profile);

    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(true);
    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    expect(written.archived_chats.map((e: any) => e.chat_id)).toEqual(['old', 'c1']);
  });

  it('archives successfully when the profile is loaded from file', async () => {
    const profile = makeProfile(withOtherChat({ chat_id: 'c1', agent: { name: 'BotA' } }));
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue(profile) });
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(true);
  });

  it('returns false when the target chat has no agent ids', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(withOtherChat({ chat_id: 'c1' }));
    ctx.cache.set('alice', profile);

    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
    expect(profile.chats).toHaveLength(2);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
  });

  it('returns false when writeProfileToFile returns false (chat preserved)', async () => {
    const profile = makeProfile(withOtherChat({ chat_id: 'c1', agent: { name: 'BotA' } }));
    const ctx = makeCtx({ writeProfileToFile: vi.fn().mockResolvedValue(false) });
    ctx.cache.set('alice', profile);
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
    expect(profile.chats).toHaveLength(2);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('returns false on an unexpected exception', async () => {
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockRejectedValue(new Error('unexpected')) });
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
  });

  it('includes starred sessions in the archived entry', async () => {
    const starred = [
      { chatId: 'c1', chatSessionId: 'cs1', title: 'Session 1', lastUpdated: '2026-01-01', agentName: 'BotA' },
      { chatId: 'c1', chatSessionId: 'cs2', title: 'Session 2', lastUpdated: '2026-01-02', agentName: 'BotA' },
    ];
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile(withOtherChat({ chat_id: 'c1', agent: { name: 'BotA' } }), '', starred));
    await archiveChatConfig(ctx, 'alice', 'c1');
    const entry = (ctx.writeProfileToFile as any).mock.calls[0][1].archived_chats[0];
    expect(entry.starred_sessions).toEqual(starred);
  });

  it('omits starred_sessions when the chat has none', async () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile(
      withOtherChat({ chat_id: 'c1', agent: { name: 'BotA' } }),
      '',
      [{ chatId: 'other', chatSessionId: 'cs1', title: 'Other', lastUpdated: '2026-01-01', agentName: 'X' }],
    ));
    await archiveChatConfig(ctx, 'alice', 'c1');
    const entry = (ctx.writeProfileToFile as any).mock.calls[0][1].archived_chats[0];
    expect(entry.starred_sessions).toBeUndefined();
  });

  it('archives when the profile has no starred-chat-sessions key at all', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(withOtherChat({ chat_id: 'c1', agent: { name: 'BotA' } }));
    delete profile['starred-chat-sessions'];
    ctx.cache.set('alice', profile);
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(true);
    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    expect(written.archived_chats[0].starred_sessions).toBeUndefined();
    expect(written['starred-chat-sessions']).toEqual([]);
  });

  it('returns false when the thrown value is a non-Error', async () => {
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockRejectedValue('string-error') });
    expect(await archiveChatConfig(ctx, 'alice', 'c1')).toBe(false);
  });
});

// ── unarchiveChatConfig ─────────────────────────────────────────────────────────

describe('unarchiveChatConfig', () => {
  it('returns error when the archived chat is not found', async () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([], '', [], []));
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when the profile is not found', async () => {
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue(null) });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/profile not found/i);
  });

  it('returns error when the profile is not isProfileV2', async () => {
    (isProfileV2 as any).mockReturnValue(false);
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue({ version: 1 }) });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid profile/i);
  });

  it('drops the archived record when the chat already exists (deduplication)', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(
      [{ chat_id: 'c1', agent_ids: [BOTA] }],
      '', [],
      [{ chat_id: 'c1', agent_ids: [BOTA] }],
    );
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    expect(written.archived_chats).toEqual([]);
  });

  it('returns error when the chat-already-exists write fails', async () => {
    const ctx = makeCtx({ writeProfileToFile: vi.fn().mockResolvedValue(false) });
    ctx.cache.set('alice', makeProfile(
      [{ chat_id: 'c1', agent_ids: [BOTA] }],
      '', [],
      [{ chat_id: 'c1', agent_ids: [BOTA] }],
    ));
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/write profile/i);
  });

  it('restores a chat that shares an agent with an active chat (shared-agent model)', async () => {
    // Two chats reference the SAME stored agent id (shared). Restoring the
    // archived one must succeed — a shared/collision agent name no longer blocks
    // restore, since agents are keyed by stable id, not name.
    const ctx = makeCtx();
    const profile = makeProfile(
      [{ chat_id: 'other', agent_ids: [BOTA] }],
      '', [],
      [{ chat_id: 'c1', agent_ids: [BOTA] }],
    );
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    expect(profile.chats.map((c: any) => c.chat_id)).toEqual(['other', 'c1']);
    expect(profile.chats[1].agent_ids).toEqual([BOTA]);
    expect(profile.archived_chats).toEqual([]);
  });

  it('unarchives from cache and restores the chat with derived agent_ids', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', chat_type: 'single_agent', agent_ids: [BOTA] }]);
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    expect(profile.chats).toHaveLength(1);
    expect(profile.chats[0].chat_id).toBe('c1');
    expect(profile.chats[0].agent_ids).toEqual([BOTA]);
    expect(profile.chats[0].agent).toBeUndefined();
    expect(profile.archived_chats).toEqual([]);
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('restores the chat with a derived workspace path', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', chat_type: 'single_agent', agent_ids: [BOTA], workspace: '/chat-workspace' }]);
    ctx.cache.set('alice', profile);

    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');

    expect(result.success).toBe(true);
    expect(profile.chats[0].workspace).toBe('/profiles/alice/chat_workspaces/c1');
    expect(profile.archived_chats).toEqual([]);
  });

  it('prefers explicit agent_ids on the archived entry, filtering blanks', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [BOTA, '', 7] }]);
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    expect(profile.chats[0].agent_ids).toEqual([BOTA]);
  });

  it('returns error instead of restoring an agent-less archived entry', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [] }]);
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/without agent ids/i);
    expect(profile.chats).toEqual([]);
    expect(profile.archived_chats).toEqual([{ chat_id: 'c1', agent_ids: [] }]);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
  });

  it('returns error instead of restoring archived entries with missing store agents', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: ['missing-agent'] }]);
    ctx.cache.set('alice', profile);

    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing agents/i);
    expect(profile.chats).toEqual([]);
    expect(profile.archived_chats).toEqual([{ chat_id: 'c1', agent_ids: ['missing-agent'] }]);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
  });

  it('still drops a stale agent-less archived record when the chat already exists', async () => {
    const ctx = makeCtx();
    const profile = makeProfile(
      [{ chat_id: 'c1', agent_ids: [BOTA] }],
      '', [],
      [{ chat_id: 'c1', agent_ids: [] }],
    );
    ctx.cache.set('alice', profile);

    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');

    expect(result.success).toBe(true);
    expect(profile.chats).toHaveLength(1);
    expect(profile.archived_chats).toEqual([]);
  });

  it('returns error when writeProfileToFile fails (chat not restored)', async () => {
    const ctx = makeCtx({ writeProfileToFile: vi.fn().mockResolvedValue(false) });
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [BOTA] }]);
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/write profile/i);
    expect(profile.chats).toHaveLength(0);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('returns error on an unexpected exception', async () => {
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockRejectedValue(new Error('disk error')) });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('disk error');
  });

  it('uses the profile from file when not in cache', async () => {
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [BOTA] }]);
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue(profile) });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
  });

  it('restores starred sessions from the archived entry', async () => {
    const starred = [
      { chatId: 'c1', chatSessionId: 'cs1', title: 'Session 1', lastUpdated: '2026-01-01', agentName: 'BotA' },
    ];
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [BOTA], starred_sessions: starred }]));
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    expect(written['starred-chat-sessions']).toEqual(starred);
  });

  it('merges restored starred sessions with existing ones', async () => {
    const existingStarred = [
      { chatId: 'c2', chatSessionId: 'cs0', title: 'Existing', lastUpdated: '2026-01-01', agentName: 'Other' },
    ];
    const restoredStarred = [
      { chatId: 'c1', chatSessionId: 'cs1', title: 'Restored', lastUpdated: '2026-01-02', agentName: 'BotA' },
    ];
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([], '', existingStarred, [{ chat_id: 'c1', agent_ids: [BOTA], starred_sessions: restoredStarred }]));
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    expect(written['starred-chat-sessions']).toEqual([...existingStarred, ...restoredStarred]);
  });

  it('does not modify starred-chat-sessions when the archived entry has none', async () => {
    const existingStarred = [
      { chatId: 'c2', chatSessionId: 'cs0', title: 'Keep', lastUpdated: '2026-01-01', agentName: 'Other' },
    ];
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([], '', existingStarred, [{ chat_id: 'c1', agent_ids: [BOTA] }]));
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    expect(written['starred-chat-sessions']).toEqual(existingStarred);
  });

  it('returns not-found when archived_chats is not an array', async () => {
    const ctx = makeCtx();
    ctx.cache.set('alice', makeProfile([])); // no archived_chats key => undefined
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('derives agent_ids from the inline agent name when the entry has no agent_ids array', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', agent: { name: 'Derived' } }]);
    ctx.cache.set('alice', profile);
    mockReadAgent.mockImplementation((_dir: string, id: string) =>
      id === 'agent-derived-on-device' ? { id, name: 'Derived', source: 'ON-DEVICE' } : null,
    );
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    expect(profile.chats[0].agent_ids).toEqual(['agent-derived-on-device']);
  });

  it('unarchives when the profile has no starred-chat-sessions key at all', async () => {
    const ctx = makeCtx();
    const profile = makeProfile([], '', [], [{ chat_id: 'c1', agent_ids: [BOTA] }]);
    delete profile['starred-chat-sessions'];
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    const written = (ctx.writeProfileToFile as any).mock.calls[0][1];
    expect(written['starred-chat-sessions']).toEqual([]);
  });

  it('returns an Unknown error when the thrown value is a non-Error', async () => {
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockRejectedValue('string-error') });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown error/i);
  });
});
