import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs ───────────────────────────────────────────────────────────────────
const { mockExistsSync, mockMkdirSync, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
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
  getArchivedAgentsFilePath,
  readArchivedAgents,
  writeArchivedAgents,
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

function makeProfile(chats: any[] = [], primaryAgent = ''): any {
  return {
    version: 2,
    alias: 'alice',
    chats,
    primaryAgent,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getArchivedAgentsFilePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('creates archive dir if it does not exist', () => {
    const ctx = makeCtx();
    const result = getArchivedAgentsFilePath(ctx, 'alice');
    expect(mockMkdirSync).toHaveBeenCalledWith('/profiles/alice/archive', { recursive: true });
    expect(result).toContain('archived_agents.json');
  });

  it('skips mkdir when archive dir already exists', () => {
    mockExistsSync.mockReturnValue(true);
    const ctx = makeCtx();
    getArchivedAgentsFilePath(ctx, 'alice');
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe('readArchivedAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('returns empty array when file does not exist', () => {
    mockExistsSync
      .mockReturnValueOnce(true)  // archive dir
      .mockReturnValueOnce(false); // file
    const ctx = makeCtx();
    expect(readArchivedAgents(ctx, 'alice')).toEqual([]);
  });

  it('returns archived_agents from file', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ archived_agents: [{ chat_id: 'c1' }] }));
    const ctx = makeCtx();
    const result = readArchivedAgents(ctx, 'alice');
    expect(result).toEqual([{ chat_id: 'c1' }]);
  });

  it('returns empty array when file has no archived_agents key', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({}));
    const ctx = makeCtx();
    expect(readArchivedAgents(ctx, 'alice')).toEqual([]);
  });

  it('returns empty array when file read throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => { throw new Error('read error'); });
    const ctx = makeCtx();
    expect(readArchivedAgents(ctx, 'alice')).toEqual([]);
  });
});

describe('writeArchivedAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('writes data and returns true', () => {
    const ctx = makeCtx();
    const result = writeArchivedAgents(ctx, 'alice', [{ chat_id: 'c1' }]);
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('returns false when write throws', () => {
    mockWriteFileSync.mockImplementation(() => { throw new Error('write error'); });
    const ctx = makeCtx();
    const result = writeArchivedAgents(ctx, 'alice', []);
    expect(result).toBe(false);
  });
});

describe('getArchivedAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ archived_agents: [{ chat_id: 'c1' }] }));
  });

  it('delegates to readArchivedAgents', () => {
    const ctx = makeCtx();
    const result = getArchivedAgents(ctx, 'alice');
    expect(result).toEqual([{ chat_id: 'c1' }]);
  });
});

describe('archiveChatConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ archived_agents: [] }));
    mockWriteFileSync.mockReturnValue(undefined);
    (isProfileV2 as any).mockReturnValue(true);
    (isBuiltinAgent as any).mockReturnValue(false);
  });

  it('returns false when profile not in cache and readProfileFromFile returns null', async () => {
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue(null) });
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(false);
  });

  it('returns false when profile not isProfileV2', async () => {
    (isProfileV2 as any).mockReturnValue(false);
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue({ version: 1 }) });
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(false);
  });

  it('returns false when chat not found', async () => {
    const profile = makeProfile([{ chat_id: 'other', agent: { name: 'MyAgent' } }]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(false);
  });

  it('returns false when agent is a builtin agent', async () => {
    (isBuiltinAgent as any).mockReturnValue(true);
    const profile = makeProfile([{ chat_id: 'c1', agent: { name: 'Kobi' } }]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(false);
  });

  it('returns false when agent is the primary agent', async () => {
    const profile = makeProfile([{ chat_id: 'c1', agent: { name: 'PrimaryBot' } }], 'PrimaryBot');
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(false);
  });

  it('returns false when writeArchivedAgents fails', async () => {
    mockWriteFileSync.mockImplementation(() => { throw new Error('disk full'); });
    const profile = makeProfile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(false);
  });

  it('archives successfully from cache', async () => {
    const profile = makeProfile([{ chat_id: 'c1', chat_type: 'single_agent', agent: { name: 'BotA' } }]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(true);
    expect(ctx.writeProfileToFile).toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
    // Chat removed from profile
    expect(profile.chats).toHaveLength(0);
  });

  it('archives successfully when profile loaded from file', async () => {
    const profile = makeProfile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue(profile) });
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(true);
  });

  it('archives chat with no agent (chat_type defaults to single_agent)', async () => {
    const profile = makeProfile([{ chat_id: 'c1' }]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(true);
  });

  it('returns false when writeProfileToFile returns false', async () => {
    const profile = makeProfile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const ctx = makeCtx({ writeProfileToFile: vi.fn().mockResolvedValue(false) });
    ctx.cache.set('alice', profile);
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(false);
  });

  it('returns false on unexpected exception', async () => {
    const ctx = makeCtx({
      readProfileFromFile: vi.fn().mockRejectedValue(new Error('unexpected')),
    });
    const result = await archiveChatConfig(ctx, 'alice', 'c1');
    expect(result).toBe(false);
  });
});

describe('unarchiveChatConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockWriteFileSync.mockReturnValue(undefined);
    (isProfileV2 as any).mockReturnValue(true);
  });

  function setArchiveFile(entries: any[]) {
    mockReadFileSync.mockReturnValue(JSON.stringify({ archived_agents: entries }));
  }

  it('returns error when archived chat not found', async () => {
    setArchiveFile([]);
    const ctx = makeCtx();
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when profile not found in file', async () => {
    setArchiveFile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue(null) });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/profile not found/i);
  });

  it('returns error when profile is not isProfileV2', async () => {
    (isProfileV2 as any).mockReturnValue(false);
    setArchiveFile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue({ version: 1 }) });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid profile/i);
  });

  it('returns success when chat already exists in profile (deduplication)', async () => {
    setArchiveFile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const profile = makeProfile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
  });

  it('returns error on agent name conflict', async () => {
    setArchiveFile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const profile = makeProfile([{ chat_id: 'other', agent: { name: 'bota' } }]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('BotA');
  });

  it('unarchives successfully from cache', async () => {
    setArchiveFile([{ chat_id: 'c1', chat_type: 'single_agent', agent: { name: 'BotA' } }]);
    const profile = makeProfile([]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
    expect(profile.chats).toHaveLength(1);
    expect(profile.chats[0].chat_id).toBe('c1');
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('unarchives chat with no agent', async () => {
    setArchiveFile([{ chat_id: 'c1' }]);
    const profile = makeProfile([]);
    const ctx = makeCtx();
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
  });

  it('returns error when writeProfileToFile fails', async () => {
    setArchiveFile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const profile = makeProfile([]);
    const ctx = makeCtx({ writeProfileToFile: vi.fn().mockResolvedValue(false) });
    ctx.cache.set('alice', profile);
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/write profile/i);
  });

  it('returns error on unexpected exception', async () => {
    setArchiveFile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const ctx = makeCtx({
      readProfileFromFile: vi.fn().mockRejectedValue(new Error('disk error')),
    });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('disk error');
  });

  it('uses profile from file when not in cache', async () => {
    setArchiveFile([{ chat_id: 'c1', agent: { name: 'BotA' } }]);
    const profile = makeProfile([]);
    const ctx = makeCtx({ readProfileFromFile: vi.fn().mockResolvedValue(profile) });
    const result = await unarchiveChatConfig(ctx, 'alice', 'c1');
    expect(result.success).toBe(true);
  });
});
