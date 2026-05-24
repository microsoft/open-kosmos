import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

vi.mock('../../subAgent/subAgentFileManager', async () => ({
  SubAgentFileManager: {
    getInstance: vi.fn(() => ({
      isCacheWarmed: vi.fn(() => false),
      scanAllAgents: vi.fn(async () => []),
      markCacheWarmed: vi.fn(),
      readAgentConfig: vi.fn(async () => null),
      writeAgentConfig: vi.fn(async () => {}),
      deleteAgentDirectory: vi.fn(async () => {}),
      invalidateAllCache: vi.fn(),
    })),
  },
}));

import {
  addMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
  addSkill,
  updateSkill,
  deleteSkill,
  getSubAgentIndex,
  addSubAgent,
  updateSubAgent,
  deleteSubAgent,
  getSubAgents,
  syncSubAgentIndex,
  EntityCrudContext,
} from '../profileEntityCrud';
import type { ProfileV2, McpServerConfig } from '../types/profile';

function makeProfile(alias = 'alice'): ProfileV2 {
  return {
    version: '2.0.0' as any,
    alias,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    sub_agents: [],
    chats: [],
    'starred-chat-sessions': [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as ProfileV2;
}

function makeContext(profile?: ProfileV2, alias = 'alice'): EntityCrudContext {
  const cache = new Map<string, ProfileV2>();
  if (profile) cache.set(alias, profile);

  return {
    cache,
    getProfileDirectoryPath: (a: string) => `/mock/userData/profiles/${a}`,
    readProfileFromFile: vi.fn(async () => null),
    writeProfileToFile: vi.fn(async () => true),
    notifyProfileDataManager: vi.fn(async () => {}),
  };
}

// ── MCP Server CRUD ───────────────────────────────────────────────────────────

describe('addMcpServerConfig', () => {
  it('adds a new MCP server to the profile', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    const server: McpServerConfig = { name: 'my-server', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE' };

    const result = await addMcpServerConfig(ctx, 'alice', server);
    expect(result).toBe(true);
    expect(profile.mcp_servers).toHaveLength(1);
    expect(profile.mcp_servers[0].name).toBe('my-server');
  });

  it('returns false when server with same name already exists', async () => {
    const profile = makeProfile();
    profile.mcp_servers = [{ name: 'my-server', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);
    const server: McpServerConfig = { name: 'my-server', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE' };

    expect(await addMcpServerConfig(ctx, 'alice', server)).toBe(false);
  });

  it('returns false when profile not found in cache or file', async () => {
    const ctx = makeContext(); // no profile in cache
    const server: McpServerConfig = { name: 'server', transport: 'stdio', command: '', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE' };
    expect(await addMcpServerConfig(ctx, 'alice', server)).toBe(false);
  });

  it('reads profile from file when not in cache', async () => {
    const profile = makeProfile();
    const ctx = makeContext(); // no cache
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);
    const server: McpServerConfig = { name: 'srv', transport: 'stdio', command: '', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE' };
    const result = await addMcpServerConfig(ctx, 'alice', server);
    expect(result).toBe(true);
  });
});

describe('updateMcpServerConfig', () => {
  it('updates an existing MCP server', async () => {
    const profile = makeProfile();
    profile.mcp_servers = [{ name: 'srv', transport: 'stdio', command: 'old', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);

    const result = await updateMcpServerConfig(ctx, 'alice', 'srv', { command: 'new' });
    expect(result).toBe(true);
    expect(profile.mcp_servers[0].command).toBe('new');
  });

  it('returns false when server not found', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    expect(await updateMcpServerConfig(ctx, 'alice', 'nonexistent', {})).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeContext();
    expect(await updateMcpServerConfig(ctx, 'alice', 'srv', {})).toBe(false);
  });
});

describe('deleteMcpServerConfig', () => {
  it('removes a server from the profile', async () => {
    const profile = makeProfile();
    profile.mcp_servers = [{ name: 'srv', transport: 'stdio', command: '', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);

    const result = await deleteMcpServerConfig(ctx, 'alice', 'srv');
    expect(result).toBe(true);
    expect(profile.mcp_servers).toHaveLength(0);
  });

  it('returns false when server not found', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    expect(await deleteMcpServerConfig(ctx, 'alice', 'ghost')).toBe(false);
  });
});

// ── Skill CRUD ────────────────────────────────────────────────────────────────

describe('addSkill', () => {
  it('adds a new skill', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    const result = await addSkill(ctx, 'alice', { name: 'my-skill', description: 'desc', version: '1.0.0', source: 'ON-DEVICE' });
    expect(result).toBe(true);
    expect(profile.skills).toHaveLength(1);
  });

  it('updates existing skill when same name added', async () => {
    const profile = makeProfile();
    profile.skills = [{ name: 'my-skill', description: 'old', version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);
    await addSkill(ctx, 'alice', { name: 'my-skill', description: 'new', version: '2.0.0', source: 'ON-DEVICE' });
    expect(profile.skills[0].version).toBe('2.0.0');
    expect(profile.skills).toHaveLength(1);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeContext();
    expect(await addSkill(ctx, 'alice', { name: 'sk', description: '', version: '1.0', source: 'ON-DEVICE' })).toBe(false);
  });
});

describe('updateSkill', () => {
  it('updates an existing skill', async () => {
    const profile = makeProfile();
    profile.skills = [{ name: 'sk', description: 'old', version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);
    const result = await updateSkill(ctx, 'alice', 'sk', { version: '2.0.0' });
    expect(result).toBe(true);
    expect(profile.skills[0].version).toBe('2.0.0');
  });

  it('returns false when skill not found', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    expect(await updateSkill(ctx, 'alice', 'ghost', { version: '2.0' })).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeContext();
    expect(await updateSkill(ctx, 'alice', 'sk', {})).toBe(false);
  });
});

describe('deleteSkill', () => {
  it('removes an existing skill', async () => {
    const profile = makeProfile();
    profile.skills = [{ name: 'sk', description: '', version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);
    const result = await deleteSkill(ctx, 'alice', 'sk');
    expect(result).toBe(true);
    expect(profile.skills).toHaveLength(0);
  });

  it('returns false when skill not found', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    expect(await deleteSkill(ctx, 'alice', 'ghost')).toBe(false);
  });
});

// ── Sub-Agent CRUD ─────────────────────────────────────────────────────────────

describe('getSubAgentIndex', () => {
  it('returns sub_agents for given alias', () => {
    const profile = makeProfile();
    (profile.sub_agents as any) = [{ name: 'sa', version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);
    const result = getSubAgentIndex(ctx, 'alice');
    expect(result).toHaveLength(1);
  });

  it('returns empty array when profile not found', () => {
    const ctx = makeContext();
    expect(getSubAgentIndex(ctx, 'alice')).toEqual([]);
  });

  it('iterates cache when alias not provided', () => {
    const profile = makeProfile();
    (profile.sub_agents as any) = [{ name: 'sa', version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);
    const result = getSubAgentIndex(ctx);
    expect(result).toHaveLength(1);
  });

  it('returns empty when cache is empty and no alias', () => {
    const ctx = makeContext();
    expect(getSubAgentIndex(ctx)).toEqual([]);
  });
});

describe('addSubAgent', () => {
  it('adds a sub-agent index entry', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    const result = await addSubAgent(ctx, 'alice', {
      name: 'my-sub-agent',
      description: 'desc',
      system_prompt: 'Hi',
    });
    expect(result).toBe(true);
    expect((profile.sub_agents as any[])).toHaveLength(1);
  });

  it('updates existing sub-agent index entry when name exists', async () => {
    const profile = makeProfile();
    (profile.sub_agents as any) = [{ name: 'my-sa', version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);
    await addSubAgent(ctx, 'alice', {
      name: 'my-sa',
      description: '',
      system_prompt: '',
    });
    expect((profile.sub_agents as any[])![0].version).toBe('1.0.0');
  });

  it('returns false when profile not found', async () => {
    const ctx = makeContext();
    expect(await addSubAgent(ctx, 'alice', {
      name: 'sa',
      description: '',
      system_prompt: '',
    })).toBe(false);
  });
});

describe('updateSubAgent', () => {
  it('updates existing sub-agent', async () => {
    const profile = makeProfile();
    (profile.sub_agents as any) = [{ name: 'my-sa', version: '1.0.0', source: 'ON-DEVICE' }];
    const ctx = makeContext(profile);
    const result = await updateSubAgent(ctx, 'alice', 'my-sa', { description: 'updated' });
    expect(result).toBe(true);
  });

  it('returns false when sub-agent not found', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    expect(await updateSubAgent(ctx, 'alice', 'ghost', {})).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeContext();
    expect(await updateSubAgent(ctx, 'alice', 'sa', {})).toBe(false);
  });
});

describe('deleteSubAgent', () => {
  it('removes sub-agent from index and chat references', async () => {
    const profile = makeProfile();
    (profile.sub_agents as any) = [{ name: 'my-sa', version: '1.0.0', source: 'ON-DEVICE' }];
    profile.chats = [{
      chat_id: 'c1',
      chat_type: 'single_agent',
      agent: { sub_agents: ['my-sa', 'other'] } as any,
    }];
    const ctx = makeContext(profile);
    const result = await deleteSubAgent(ctx, 'alice', 'my-sa');
    expect(result).toBe(true);
    expect(profile.chats[0].agent!.sub_agents).not.toContain('my-sa');
  });

  it('returns false when sub-agent not found', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    expect(await deleteSubAgent(ctx, 'alice', 'ghost')).toBe(false);
  });
});

describe('getSubAgents', () => {
  it('returns empty array when cache is empty', async () => {
    const ctx = makeContext();
    const result = await getSubAgents(ctx);
    expect(result).toEqual([]);
  });

  it('scans disk agents when cache is not warmed', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    const result = await getSubAgents(ctx);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('syncSubAgentIndex', () => {
  it('does nothing when profile not found', async () => {
    const ctx = makeContext();
    await expect(syncSubAgentIndex(ctx, 'alice')).resolves.toBeUndefined();
  });

  it('syncs sub-agent index from disk', async () => {
    const profile = makeProfile();
    const ctx = makeContext(profile);
    await syncSubAgentIndex(ctx, 'alice');
    // No error expected
  });
});
