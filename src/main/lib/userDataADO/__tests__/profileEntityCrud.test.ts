import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));


const mcpManagerMock = vi.hoisted(() => ({
  addServer: vi.fn(async () => true),
  updateServer: vi.fn(async () => true),
  deleteServer: vi.fn(async () => true),
}));

vi.mock('../mcpConfigManager', async () => ({
  mcpConfigManager: mcpManagerMock,
}));

const skillsManagerMock = vi.hoisted(() => ({
  addSkill: vi.fn(async () => true),
  updateSkill: vi.fn(async () => true),
  deleteSkill: vi.fn(async () => true),
}));

vi.mock('../skillsConfigManager', async () => ({
  skillsConfigManager: skillsManagerMock,
}));

const chatSnapshotStoreMock = vi.hoisted(() => ({
  invalidateAffectedChats: vi.fn(() => 0),
}));

vi.mock('../chatSkillSnapshotStore', async () => ({
  chatSkillSnapshotStore: chatSnapshotStoreMock,
}));

import {
  addMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
  addSkillConfig,
  updateSkillConfig,
  deleteSkillConfig,
  EntityCrudContext,
} from '../profileEntityCrud';
import type { ProfileV2, McpServerConfig } from '../types/profile';
import type { AddSkillInput } from '../skillsConfigManager';

function makeProfile(alias = 'alice'): ProfileV2 {
  return {
    version: '2.0.0' as any,
    alias,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
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

describe('MCP server CRUD delegation', () => {
  function makeMcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
    return {
      name: 'srv',
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: {},
      url: '',
      in_use: false,
      source: 'ON-DEVICE',
      ...overrides,
    } as McpServerConfig;
  }

  beforeEach(() => {
    mcpManagerMock.addServer.mockClear();
    mcpManagerMock.updateServer.mockClear();
    mcpManagerMock.deleteServer.mockClear();
    mcpManagerMock.addServer.mockResolvedValue(true);
    mcpManagerMock.updateServer.mockResolvedValue(true);
    mcpManagerMock.deleteServer.mockResolvedValue(true);
  });

  it('addMcpServerConfig adds via the manager and notifies when a cached profile exists', async () => {
    const ctx = makeContext(makeProfile());
    const ok = await addMcpServerConfig(ctx, 'alice', makeMcpServer({ name: 'added' }));

    expect(ok).toBe(true);
    expect(mcpManagerMock.addServer).toHaveBeenCalledWith('alice', expect.objectContaining({ name: 'added' }));
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('addMcpServerConfig loads the profile from disk on a cache miss, then caches it', async () => {
    const profile = makeProfile();
    const ctx = makeContext();
    vi.mocked(ctx.readProfileFromFile).mockResolvedValue(profile);

    const ok = await addMcpServerConfig(ctx, 'alice', makeMcpServer());

    expect(ok).toBe(true);
    expect(ctx.readProfileFromFile).toHaveBeenCalledWith('alice');
    expect(ctx.cache.get('alice')).toBe(profile);
  });

  it('addMcpServerConfig returns false without mutating when no profile exists', async () => {
    const ctx = makeContext();
    const ok = await addMcpServerConfig(ctx, 'ghost', makeMcpServer());

    expect(ok).toBe(false);
    expect(mcpManagerMock.addServer).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('addMcpServerConfig does not notify when the manager reports no change', async () => {
    mcpManagerMock.addServer.mockResolvedValue(false);
    const ctx = makeContext(makeProfile());

    const ok = await addMcpServerConfig(ctx, 'alice', makeMcpServer());

    expect(ok).toBe(false);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('updateMcpServerConfig updates via the manager and fires an immediate notify', async () => {
    const ctx = makeContext(makeProfile());
    const ok = await updateMcpServerConfig(ctx, 'alice', 'srv', { in_use: true });

    expect(ok).toBe(true);
    expect(mcpManagerMock.updateServer).toHaveBeenCalledWith('alice', 'srv', { in_use: true });
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('updateMcpServerConfig returns false (no notify) when the manager reports no change', async () => {
    mcpManagerMock.updateServer.mockResolvedValue(false);
    const ctx = makeContext(makeProfile());

    const ok = await updateMcpServerConfig(ctx, 'alice', 'srv', { in_use: true });

    expect(ok).toBe(false);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('updateMcpServerConfig returns false when no profile exists', async () => {
    const ctx = makeContext();
    const ok = await updateMcpServerConfig(ctx, 'ghost', 'srv', { in_use: true });

    expect(ok).toBe(false);
    expect(mcpManagerMock.updateServer).not.toHaveBeenCalled();
  });

  it('deleteMcpServerConfig deletes via the manager and notifies', async () => {
    const ctx = makeContext(makeProfile());
    const ok = await deleteMcpServerConfig(ctx, 'alice', 'srv');

    expect(ok).toBe(true);
    expect(mcpManagerMock.deleteServer).toHaveBeenCalledWith('alice', 'srv');
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('deleteMcpServerConfig does not notify when the manager reports no change', async () => {
    mcpManagerMock.deleteServer.mockResolvedValue(false);
    const ctx = makeContext(makeProfile());

    const ok = await deleteMcpServerConfig(ctx, 'alice', 'srv');

    expect(ok).toBe(false);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('deleteMcpServerConfig returns false when no profile exists', async () => {
    const ctx = makeContext();
    const ok = await deleteMcpServerConfig(ctx, 'ghost', 'srv');

    expect(ok).toBe(false);
    expect(mcpManagerMock.deleteServer).not.toHaveBeenCalled();
  });
});

// ── Skill CRUD ──────────────────────────────────────────────────────────────────

describe('Skill CRUD delegation', () => {
  function makeSkill(overrides: Partial<AddSkillInput> = {}): AddSkillInput {
    return {
      name: 'pptx',
      description: 'Create slides',
      version: '1.0.0',
      remoteVersion: '',
      source: 'ON-DEVICE',
      ...overrides,
    };
  }

  beforeEach(() => {
    skillsManagerMock.addSkill.mockClear();
    skillsManagerMock.updateSkill.mockClear();
    skillsManagerMock.deleteSkill.mockClear();
    skillsManagerMock.addSkill.mockResolvedValue(true);
    skillsManagerMock.updateSkill.mockResolvedValue(true);
    skillsManagerMock.deleteSkill.mockResolvedValue(true);
    chatSnapshotStoreMock.invalidateAffectedChats.mockClear();
    chatSnapshotStoreMock.invalidateAffectedChats.mockReturnValue(0);
  });

  it('addSkillConfig adds via the manager, invalidates affected snapshots, and notifies', async () => {
    chatSnapshotStoreMock.invalidateAffectedChats.mockReturnValue(1);
    const profile = makeProfile();
    const ctx = makeContext(profile);

    const ok = await addSkillConfig(ctx, 'alice', makeSkill({ name: 'added' }));

    expect(ok).toBe(true);
    expect(skillsManagerMock.addSkill).toHaveBeenCalledWith('alice', expect.objectContaining({ name: 'added' }));
    expect(chatSnapshotStoreMock.invalidateAffectedChats).toHaveBeenCalledWith('alice', profile.chats, ['added']);
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('addSkillConfig still notifies when no snapshots were invalidated (cleared === 0)', async () => {
    chatSnapshotStoreMock.invalidateAffectedChats.mockReturnValue(0);
    const ctx = makeContext(makeProfile());

    const ok = await addSkillConfig(ctx, 'alice', makeSkill());

    expect(ok).toBe(true);
    expect(chatSnapshotStoreMock.invalidateAffectedChats).toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('addSkillConfig loads the profile from disk on a cache miss, then caches it', async () => {
    const profile = makeProfile();
    const ctx = makeContext();
    vi.mocked(ctx.readProfileFromFile).mockResolvedValue(profile);

    const ok = await addSkillConfig(ctx, 'alice', makeSkill());

    expect(ok).toBe(true);
    expect(ctx.readProfileFromFile).toHaveBeenCalledWith('alice');
    expect(ctx.cache.get('alice')).toBe(profile);
  });

  it('addSkillConfig returns false without mutating when no profile exists', async () => {
    const ctx = makeContext();
    const ok = await addSkillConfig(ctx, 'ghost', makeSkill());

    expect(ok).toBe(false);
    expect(skillsManagerMock.addSkill).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('addSkillConfig does not notify when the manager reports no change', async () => {
    skillsManagerMock.addSkill.mockResolvedValue(false);
    const ctx = makeContext(makeProfile());

    const ok = await addSkillConfig(ctx, 'alice', makeSkill());

    expect(ok).toBe(false);
    expect(chatSnapshotStoreMock.invalidateAffectedChats).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('addSkillConfig skips snapshot invalidation when the cached profile is not V2', async () => {
    const nonV2 = { ...makeProfile(), authProvider: 'github' } as unknown as ProfileV2;
    const ctx = makeContext(nonV2);

    const ok = await addSkillConfig(ctx, 'alice', makeSkill());

    expect(ok).toBe(true);
    expect(chatSnapshotStoreMock.invalidateAffectedChats).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('updateSkillConfig updates via the manager, invalidates snapshots, and fires an immediate notify', async () => {
    chatSnapshotStoreMock.invalidateAffectedChats.mockReturnValue(2);
    const profile = makeProfile();
    const ctx = makeContext(profile);

    const ok = await updateSkillConfig(ctx, 'alice', 'pptx', { version: '2.0.0' });

    expect(ok).toBe(true);
    expect(skillsManagerMock.updateSkill).toHaveBeenCalledWith('alice', 'pptx', { version: '2.0.0' });
    expect(chatSnapshotStoreMock.invalidateAffectedChats).toHaveBeenCalledWith('alice', profile.chats, ['pptx']);
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('updateSkillConfig returns false (no notify) when the manager reports no change', async () => {
    skillsManagerMock.updateSkill.mockResolvedValue(false);
    const ctx = makeContext(makeProfile());

    const ok = await updateSkillConfig(ctx, 'alice', 'pptx', { version: '2.0.0' });

    expect(ok).toBe(false);
    expect(chatSnapshotStoreMock.invalidateAffectedChats).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('updateSkillConfig returns false when no profile exists', async () => {
    const ctx = makeContext();
    const ok = await updateSkillConfig(ctx, 'ghost', 'pptx', { version: '2.0.0' });

    expect(ok).toBe(false);
    expect(skillsManagerMock.updateSkill).not.toHaveBeenCalled();
  });

  it('deleteSkillConfig deletes via the manager, invalidates snapshots, and fires an immediate notify', async () => {
    chatSnapshotStoreMock.invalidateAffectedChats.mockReturnValue(1);
    const profile = makeProfile();
    const ctx = makeContext(profile);

    const ok = await deleteSkillConfig(ctx, 'alice', 'pptx');

    expect(ok).toBe(true);
    expect(skillsManagerMock.deleteSkill).toHaveBeenCalledWith('alice', 'pptx');
    expect(chatSnapshotStoreMock.invalidateAffectedChats).toHaveBeenCalledWith('alice', profile.chats, ['pptx']);
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('deleteSkillConfig does not notify when the manager reports no change', async () => {
    skillsManagerMock.deleteSkill.mockResolvedValue(false);
    const ctx = makeContext(makeProfile());

    const ok = await deleteSkillConfig(ctx, 'alice', 'pptx');

    expect(ok).toBe(false);
    expect(chatSnapshotStoreMock.invalidateAffectedChats).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('deleteSkillConfig returns false when no profile exists', async () => {
    const ctx = makeContext();
    const ok = await deleteSkillConfig(ctx, 'ghost', 'pptx');

    expect(ok).toBe(false);
    expect(skillsManagerMock.deleteSkill).not.toHaveBeenCalled();
  });
});
