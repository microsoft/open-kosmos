// @ts-nocheck
/**
 * Supplementary coverage tests for profileEntityCrud.
 * Uses the real isProfileV2 implementation (not the __isV2 mock used in
 * profileEntityCrud.test.ts) so skill / sub-agent branches are reachable.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Keep SubAgentFileManager mocked (it does real FS) ───────────────────────

const mockFM = {
  isCacheWarmed: vi.fn().mockReturnValue(false),
  markCacheWarmed: vi.fn(),
  scanAllAgents: vi.fn().mockResolvedValue([]),
  readAgentConfig: vi.fn().mockResolvedValue(null),
  writeAgentConfig: vi.fn().mockResolvedValue(undefined),
  deleteAgentDirectory: vi.fn().mockResolvedValue(undefined),
  invalidateAllCache: vi.fn(),
};

vi.mock('../../subAgent/subAgentFileManager', () => ({
  SubAgentFileManager: { getInstance: () => mockFM },
}));

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../profileSanitizer', () => ({
  clearSkillSnapshotsForAffectedChats: vi.fn().mockReturnValue(0),
}));

// ── Import real implementations ───────────────────────────────────────────────

import {
  addMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
  addSkill,
  updateSkill,
  deleteSkill,
  addSubAgent,
  updateSubAgent,
  deleteSubAgent,
  syncSubAgentIndex,
  getSubAgents,
} from '../profileEntityCrud';
import type { EntityCrudContext } from '../profileEntityCrud';
import type { ProfileV2, McpServerConfig } from '../types/profile';
import { clearSkillSnapshotsForAffectedChats } from '../profileSanitizer';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a profile that satisfies the real isProfileV2 check */
function makeV2Profile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    alias: 'alice',
    chats: [],
    mcp_servers: [],
    skills: [],
    sub_agents: [],
    ...overrides,
  } as unknown as ProfileV2;
}

function makeMcp(name = 'srv'): McpServerConfig {
  return { name, transport: 'stdio', command: '', args: [], env: {}, in_use: true } as McpServerConfig;
}

function makeCtx(profile?: ProfileV2): EntityCrudContext {
  const cache = new Map<string, ProfileV2>();
  if (profile) cache.set('alice', profile);
  return {
    cache,
    getProfileDirectoryPath: vi.fn().mockReturnValue('/profiles/alice'),
    readProfileFromFile: vi.fn().mockResolvedValue(null),
    writeProfileToFile: vi.fn().mockResolvedValue(true),
    notifyProfileDataManager: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFM.isCacheWarmed.mockReturnValue(false);
  mockFM.scanAllAgents.mockResolvedValue([]);
  mockFM.readAgentConfig.mockResolvedValue(null);
  (clearSkillSnapshotsForAffectedChats as any).mockReturnValue(0);
});

// ── MCP: load-from-file path ──────────────────────────────────────────────────

describe('addMcpServerConfig (file fallback)', () => {
  it('loads from file when not in cache', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);
    const result = await addMcpServerConfig(ctx, 'alice', makeMcp('new-srv'));
    expect(result).toBe(true);
  });

  it('returns false when writeProfileToFile returns false', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await addMcpServerConfig(ctx, 'alice', makeMcp('x'))).toBe(false);
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('io err'));
    expect(await addMcpServerConfig(ctx, 'alice', makeMcp('x'))).toBe(false);
  });
});

describe('updateMcpServerConfig (file fallback)', () => {
  it('loads from file when not in cache', async () => {
    const profile = makeV2Profile({ mcp_servers: [makeMcp('srv')] });
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);
    expect(await updateMcpServerConfig(ctx, 'alice', 'srv', { in_use: false })).toBe(true);
  });

  it('returns false when writeProfileToFile returns false', async () => {
    const profile = makeV2Profile({ mcp_servers: [makeMcp('srv')] });
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await updateMcpServerConfig(ctx, 'alice', 'srv', {})).toBe(false);
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('io err'));
    expect(await updateMcpServerConfig(ctx, 'alice', 'srv', {})).toBe(false);
  });
});

describe('deleteMcpServerConfig (file fallback)', () => {
  it('loads from file when not in cache', async () => {
    const profile = makeV2Profile({ mcp_servers: [makeMcp('srv')] });
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);
    expect(await deleteMcpServerConfig(ctx, 'alice', 'srv')).toBe(true);
  });

  it('returns false when writeProfileToFile returns false', async () => {
    const profile = makeV2Profile({ mcp_servers: [makeMcp('srv')] });
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await deleteMcpServerConfig(ctx, 'alice', 'srv')).toBe(false);
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('io err'));
    expect(await deleteMcpServerConfig(ctx, 'alice', 'srv')).toBe(false);
  });
});

// ── Skill CRUD (with real isProfileV2) ───────────────────────────────────────

const skillCfg = { name: 'skill1', description: 'desc', version: '1.0.0', source: 'IN-LIBRARY' as const };

describe('addSkill', () => {
  it('adds skill to V2 profile', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    expect(await addSkill(ctx, 'alice', skillCfg)).toBe(true);
    expect(profile.skills!.length).toBe(1);
  });

  it('updates existing skill by name', async () => {
    const profile = makeV2Profile({ skills: [{ name: 'skill1', description: 'old', version: '0.1', source: 'IN-LIBRARY' }] });
    const ctx = makeCtx(profile);
    await addSkill(ctx, 'alice', { ...skillCfg, description: 'new' });
    expect(profile.skills![0].description).toBe('new');
    expect(profile.skills!.length).toBe(1);
  });

  it('initializes skills array when absent', async () => {
    const profile = makeV2Profile();
    (profile as any).skills = undefined;
    const ctx = makeCtx(profile);
    expect(await addSkill(ctx, 'alice', skillCfg)).toBe(true);
  });

  it('returns false when profile not in cache and file returns null', async () => {
    const ctx = makeCtx();
    expect(await addSkill(ctx, 'alice', skillCfg)).toBe(false);
  });

  it('returns false when writeProfileToFile fails', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await addSkill(ctx, 'alice', skillCfg)).toBe(false);
  });

  it('logs when clearedCount > 0', async () => {
    (clearSkillSnapshotsForAffectedChats as any).mockReturnValueOnce(3);
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    expect(await addSkill(ctx, 'alice', skillCfg)).toBe(true);
    expect(clearSkillSnapshotsForAffectedChats).toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('boom'));
    expect(await addSkill(ctx, 'alice', skillCfg)).toBe(false);
  });

  it('reads from file when not in cache', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);
    expect(await addSkill(ctx, 'alice', skillCfg)).toBe(true);
  });
});

describe('updateSkill', () => {
  it('updates skill in V2 profile', async () => {
    const profile = makeV2Profile({ skills: [{ name: 'sk', description: 'old', version: '1.0.0', source: 'IN-LIBRARY' }] });
    const ctx = makeCtx(profile);
    expect(await updateSkill(ctx, 'alice', 'sk', { version: '2.0.0' })).toBe(true);
    expect(profile.skills![0].version).toBe('2.0.0');
  });

  it('returns false when skill not found', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    expect(await updateSkill(ctx, 'alice', 'missing', {})).toBe(false);
  });

  it('returns false when profile has no skills array', async () => {
    const profile = makeV2Profile();
    (profile as any).skills = undefined;
    const ctx = makeCtx(profile);
    expect(await updateSkill(ctx, 'alice', 'sk', {})).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await updateSkill(ctx, 'alice', 'sk', {})).toBe(false);
  });

  it('returns false when write fails', async () => {
    const profile = makeV2Profile({ skills: [{ name: 'sk', description: '', version: '1', source: 'IN-LIBRARY' }] });
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await updateSkill(ctx, 'alice', 'sk', {})).toBe(false);
  });

  it('logs when clearedCount > 0', async () => {
    (clearSkillSnapshotsForAffectedChats as any).mockReturnValueOnce(1);
    const profile = makeV2Profile({ skills: [{ name: 'sk', description: '', version: '1', source: 'IN-LIBRARY' }] });
    const ctx = makeCtx(profile);
    await updateSkill(ctx, 'alice', 'sk', {});
    expect(clearSkillSnapshotsForAffectedChats).toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('err'));
    expect(await updateSkill(ctx, 'alice', 'sk', {})).toBe(false);
  });
});

describe('deleteSkill', () => {
  it('deletes skill from V2 profile', async () => {
    const profile = makeV2Profile({ skills: [{ name: 'sk', description: '', version: '1', source: 'IN-LIBRARY' }] });
    const ctx = makeCtx(profile);
    expect(await deleteSkill(ctx, 'alice', 'sk')).toBe(true);
    expect(profile.skills!.length).toBe(0);
  });

  it('returns false when skill not found', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    expect(await deleteSkill(ctx, 'alice', 'missing')).toBe(false);
  });

  it('returns false when skills array missing', async () => {
    const profile = makeV2Profile();
    (profile as any).skills = undefined;
    const ctx = makeCtx(profile);
    expect(await deleteSkill(ctx, 'alice', 'sk')).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await deleteSkill(ctx, 'alice', 'sk')).toBe(false);
  });

  it('returns false when write fails', async () => {
    const profile = makeV2Profile({ skills: [{ name: 'sk', description: '', version: '1', source: 'IN-LIBRARY' }] });
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await deleteSkill(ctx, 'alice', 'sk')).toBe(false);
  });

  it('logs when clearedCount > 0', async () => {
    (clearSkillSnapshotsForAffectedChats as any).mockReturnValueOnce(2);
    const profile = makeV2Profile({ skills: [{ name: 'sk', description: '', version: '1', source: 'IN-LIBRARY' }] });
    const ctx = makeCtx(profile);
    await deleteSkill(ctx, 'alice', 'sk');
    expect(clearSkillSnapshotsForAffectedChats).toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('err'));
    expect(await deleteSkill(ctx, 'alice', 'sk')).toBe(false);
  });
});

// ── Sub-Agent CRUD (with real isProfileV2) ────────────────────────────────────

const agentCfg = {
  name: 'my-agent',
  display_name: 'My Agent',
  description: 'desc',
  emoji: '🤖',
  version: '1.0.0',
  source: 'ON-DEVICE' as const,
  context_access: 'isolated' as const,
  system_prompt: 'hi',
};

describe('addSubAgent', () => {
  it('adds sub-agent to V2 profile', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    expect(await addSubAgent(ctx, 'alice', agentCfg)).toBe(true);
    expect((profile.sub_agents as any[]).length).toBe(1);
  });

  it('updates existing index entry when name matches', async () => {
    const profile = makeV2Profile({ sub_agents: [{ name: 'my-agent', version: '0.1', source: 'ON-DEVICE' }] });
    const ctx = makeCtx(profile);
    await addSubAgent(ctx, 'alice', { ...agentCfg, version: '2.0.0' });
    // version is taken from config
    expect((profile.sub_agents as any[])[0].version).toBe('2.0.0');
    expect((profile.sub_agents as any[]).length).toBe(1);
  });

  it('initializes sub_agents when absent', async () => {
    const profile = makeV2Profile();
    (profile as any).sub_agents = undefined;
    const ctx = makeCtx(profile);
    expect(await addSubAgent(ctx, 'alice', agentCfg)).toBe(true);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await addSubAgent(ctx, 'alice', agentCfg)).toBe(false);
  });

  it('returns false when write fails', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await addSubAgent(ctx, 'alice', agentCfg)).toBe(false);
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('err'));
    expect(await addSubAgent(ctx, 'alice', agentCfg)).toBe(false);
  });
});

describe('updateSubAgent', () => {
  it('updates agent with file fallback for missing config', async () => {
    const idx = { name: 'my-agent', version: '1.0.0', source: 'ON-DEVICE' };
    const profile = makeV2Profile({ sub_agents: [idx] });
    const ctx = makeCtx(profile);
    mockFM.readAgentConfig.mockResolvedValue(null); // forces default config creation
    expect(await updateSubAgent(ctx, 'alice', 'my-agent', { description: 'updated' })).toBe(true);
  });

  it('updates agent when readAgentConfig returns existing config', async () => {
    const idx = { name: 'my-agent', version: '1.0.0', source: 'ON-DEVICE' };
    const profile = makeV2Profile({ sub_agents: [idx] });
    const ctx = makeCtx(profile);
    mockFM.readAgentConfig.mockResolvedValue({ ...agentCfg });
    expect(await updateSubAgent(ctx, 'alice', 'my-agent', { version: '2.0.0' })).toBe(true);
  });

  it('returns false when sub-agent not found', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    expect(await updateSubAgent(ctx, 'alice', 'ghost', {})).toBe(false);
  });

  it('returns false when sub_agents missing', async () => {
    const profile = makeV2Profile();
    (profile as any).sub_agents = undefined;
    const ctx = makeCtx(profile);
    expect(await updateSubAgent(ctx, 'alice', 'a', {})).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await updateSubAgent(ctx, 'alice', 'a', {})).toBe(false);
  });

  it('returns false when write fails', async () => {
    const idx = { name: 'my-agent', version: '1.0.0', source: 'ON-DEVICE' };
    const profile = makeV2Profile({ sub_agents: [idx] });
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await updateSubAgent(ctx, 'alice', 'my-agent', {})).toBe(false);
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('err'));
    expect(await updateSubAgent(ctx, 'alice', 'a', {})).toBe(false);
  });
});

describe('deleteSubAgent', () => {
  it('deletes agent and removes from chat sub_agents', async () => {
    const idx = { name: 'my-agent', version: '1.0.0', source: 'ON-DEVICE' };
    const profile = makeV2Profile({
      sub_agents: [idx],
      chats: [{ chat_id: 'c1', agent: { sub_agents: ['my-agent', 'other'] } }] as any,
    });
    const ctx = makeCtx(profile);
    expect(await deleteSubAgent(ctx, 'alice', 'my-agent')).toBe(true);
    expect((profile.sub_agents as any[]).length).toBe(0);
    expect((profile.chats[0] as any).agent.sub_agents).not.toContain('my-agent');
  });

  it('continues when deleteAgentDirectory throws', async () => {
    mockFM.deleteAgentDirectory.mockRejectedValue(new Error('fs'));
    const idx = { name: 'my-agent', version: '1.0.0', source: 'ON-DEVICE' };
    const profile = makeV2Profile({ sub_agents: [idx] });
    const ctx = makeCtx(profile);
    expect(await deleteSubAgent(ctx, 'alice', 'my-agent')).toBe(true);
  });

  it('returns false when agent not found', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    expect(await deleteSubAgent(ctx, 'alice', 'missing')).toBe(false);
  });

  it('returns false when sub_agents missing', async () => {
    const profile = makeV2Profile();
    (profile as any).sub_agents = undefined;
    const ctx = makeCtx(profile);
    expect(await deleteSubAgent(ctx, 'alice', 'a')).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await deleteSubAgent(ctx, 'alice', 'a')).toBe(false);
  });

  it('returns false when write fails', async () => {
    const idx = { name: 'my-agent', version: '1.0.0', source: 'ON-DEVICE' };
    const profile = makeV2Profile({ sub_agents: [idx] });
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValue(false);
    expect(await deleteSubAgent(ctx, 'alice', 'my-agent')).toBe(false);
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockRejectedValue(new Error('err'));
    expect(await deleteSubAgent(ctx, 'alice', 'a')).toBe(false);
  });
});

describe('syncSubAgentIndex', () => {
  it('does nothing when profile not found in cache or file', async () => {
    const ctx = makeCtx();
    await expect(syncSubAgentIndex(ctx, 'alice')).resolves.toBeUndefined();
  });

  it('adds disk agents missing from index', async () => {
    mockFM.scanAllAgents.mockResolvedValue([{ ...agentCfg }]);
    const profile = makeV2Profile({ sub_agents: [] });
    const ctx = makeCtx(profile);
    await syncSubAgentIndex(ctx, 'alice');
    expect(ctx.writeProfileToFile).toHaveBeenCalled();
  });

  it('removes stale index entries not on disk', async () => {
    mockFM.scanAllAgents.mockResolvedValue([]);
    const profile = makeV2Profile({ sub_agents: [{ name: 'stale', version: '1.0.0', source: 'ON-DEVICE' }] });
    const ctx = makeCtx(profile);
    await syncSubAgentIndex(ctx, 'alice');
    expect(ctx.writeProfileToFile).toHaveBeenCalled();
  });

  it('skips write when no changes', async () => {
    mockFM.scanAllAgents.mockResolvedValue([{ ...agentCfg }]);
    const profile = makeV2Profile({ sub_agents: [{ name: 'my-agent', version: '1.0.0', source: 'ON-DEVICE' }] });
    const ctx = makeCtx(profile);
    await syncSubAgentIndex(ctx, 'alice');
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
  });

  it('handles exception gracefully', async () => {
    mockFM.invalidateAllCache.mockImplementation(() => { throw new Error('crash'); });
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    await expect(syncSubAgentIndex(ctx, 'alice')).resolves.toBeUndefined();
  });
});

describe('getSubAgents extra paths', () => {
  it('returns empty when cache is empty', async () => {
    const ctx = makeCtx();
    expect(await getSubAgents(ctx)).toEqual([]);
  });

  it('returns inline sub_agents when scan is empty and inline has system_prompt', async () => {
    const inlineAgent = { ...agentCfg };
    const profile = makeV2Profile({ sub_agents: [inlineAgent] });
    const ctx = makeCtx(profile);
    mockFM.isCacheWarmed.mockReturnValue(false);
    mockFM.scanAllAgents.mockResolvedValue([]);
    const result = await getSubAgents(ctx);
    expect(result).toHaveLength(1);
  });

  it('returns disk agents when scan returns agents', async () => {
    mockFM.scanAllAgents.mockResolvedValue([agentCfg]);
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    const result = await getSubAgents(ctx);
    expect(result).toHaveLength(1);
  });

  it('reads agent configs from warmed cache', async () => {
    const idx = { name: 'my-agent', version: '1.0.0', source: 'ON-DEVICE' };
    const profile = makeV2Profile({ sub_agents: [idx] });
    const ctx = makeCtx(profile);
    mockFM.isCacheWarmed.mockReturnValue(true);
    mockFM.readAgentConfig.mockResolvedValue(agentCfg);
    const result = await getSubAgents(ctx);
    expect(result).toHaveLength(1);
  });

  it('falls back to profile.sub_agents on error', async () => {
    mockFM.isCacheWarmed.mockImplementation(() => { throw new Error('crash'); });
    const profile = makeV2Profile({ sub_agents: [agentCfg] });
    const ctx = makeCtx(profile);
    const result = await getSubAgents(ctx);
    expect(Array.isArray(result)).toBe(true);
  });
});
