import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
vi.mock('electron', async () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }));
vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

// The hook *list* now lives in HooksConfigManager (hooks.json); the CRUD wrappers
// delegate to it. Mock it so these tests assert the delegation + gating + notify
// contract rather than re-testing the manager's own persistence (covered in
// hooksConfigManager.test.ts). The Hooks master switch stays in profile.json, so
// isHooksEnabled/setHooksEnabled are still exercised against the cached profile.
const hooksManagerMock = vi.hoisted(() => ({
  getHooks: vi.fn(() => [] as unknown[]),
  addHook: vi.fn(async () => true),
  updateHook: vi.fn(async () => true),
  deleteHook: vi.fn(async () => true),
}));

vi.mock('../hooksConfigManager', async () => ({
  hooksConfigManager: hooksManagerMock,
}));

import { getHooks, isHooksEnabled, setHooksEnabled, addHook, updateHook, deleteHook } from '../profileHookCrud';
import type { EntityCrudContext } from '../profileEntityCrud';
import type { ProfileV2, HookDefinition } from '../types/profile';

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0' as ProfileV2['version'],
    alias: 'alice',
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    chats: [],
    'starred-chat-sessions': [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ProfileV2;
}

function makeContext(
  profile?: ProfileV2,
  overrides: Partial<EntityCrudContext> = {},
): { ctx: EntityCrudContext; cache: Map<string, ProfileV2> } {
  const cache = new Map<string, ProfileV2>();
  if (profile) cache.set('alice', profile);
  const ctx: EntityCrudContext = {
    cache,
    getProfileDirectoryPath: (a: string) => `/mock/userData/profiles/${a}`,
    readProfileFromFile: vi.fn(async () => null),
    writeProfileToFile: vi.fn(async () => true),
    notifyProfileDataManager: vi.fn(async () => {}),
    ...overrides,
  };
  return { ctx, cache };
}

function validHook(id = 'h1'): HookDefinition {
  return {
    id,
    name: `Hook ${id}`,
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hooksManagerMock.getHooks.mockReturnValue([]);
  hooksManagerMock.addHook.mockResolvedValue(true);
  hooksManagerMock.updateHook.mockResolvedValue(true);
  hooksManagerMock.deleteHook.mockResolvedValue(true);
});

describe('getHooks', () => {
  it('delegates to HooksConfigManager (hooks.json), not the cached profile', () => {
    hooksManagerMock.getHooks.mockReturnValue([validHook()]);
    const { ctx } = makeContext(makeProfile());
    expect(getHooks(ctx, 'alice')).toHaveLength(1);
    expect(hooksManagerMock.getHooks).toHaveBeenCalledWith('alice');
  });

  it('returns [] when the manager has no hooks for the alias', () => {
    hooksManagerMock.getHooks.mockReturnValue([]);
    const { ctx } = makeContext();
    expect(getHooks(ctx, 'alice')).toEqual([]);
  });
});

describe('hooks master switch (stays in profile.json)', () => {
  it('returns true only when the cached profile has hooksEnabled true', () => {
    expect(isHooksEnabled(makeContext(makeProfile({ hooksEnabled: true })).ctx, 'alice')).toBe(true);
    expect(isHooksEnabled(makeContext(makeProfile({ hooksEnabled: false })).ctx, 'alice')).toBe(false);
    expect(isHooksEnabled(makeContext().ctx, 'alice')).toBe(false);
  });

  it('returns false when the cached value is not a V2 profile', () => {
    const { ctx, cache } = makeContext();
    cache.set('alice', {} as ProfileV2);
    expect(isHooksEnabled(ctx, 'alice')).toBe(false);
  });

  it('persists hooksEnabled on the profile and does not touch hooks.json', async () => {
    const { ctx, cache } = makeContext(makeProfile({ hooksEnabled: false }));
    expect(await setHooksEnabled(ctx, 'alice', true)).toBe(true);
    expect(cache.get('alice')?.hooksEnabled).toBe(true);
    expect(ctx.writeProfileToFile).toHaveBeenCalledWith('alice', expect.objectContaining({ hooksEnabled: true }));
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
    expect(hooksManagerMock.addHook).not.toHaveBeenCalled();
  });

  it('reads the profile from disk when setting hooksEnabled and the cache is empty', async () => {
    const fileProfile = makeProfile({ hooksEnabled: false });
    const { ctx, cache } = makeContext(undefined, { readProfileFromFile: vi.fn(async () => fileProfile) });
    expect(await setHooksEnabled(ctx, 'alice', true)).toBe(true);
    expect(cache.get('alice')?.hooksEnabled).toBe(true);
  });

  it('returns false when setting hooksEnabled without a profile', async () => {
    const { ctx } = makeContext();
    expect(await setHooksEnabled(ctx, 'alice', true)).toBe(false);
  });

  it('returns false when loading the profile for hooksEnabled throws', async () => {
    const errorCtx = makeContext(undefined, {
      readProfileFromFile: vi.fn(async () => {
        throw new Error('read failed');
      }),
    }).ctx;
    expect(await setHooksEnabled(errorCtx, 'alice', true)).toBe(false);

    const stringErrorCtx = makeContext(undefined, {
      readProfileFromFile: vi.fn(async () => {
        throw 'read failed string';
      }),
    }).ctx;
    expect(await setHooksEnabled(stringErrorCtx, 'alice', true)).toBe(false);
  });

  it('returns false when persisting hooksEnabled fails', async () => {
    const { ctx, cache } = makeContext(makeProfile({ hooksEnabled: false }), { writeProfileToFile: vi.fn(async () => false) });
    expect(await setHooksEnabled(ctx, 'alice', true)).toBe(false);
    expect(cache.get('alice')?.hooksEnabled).toBe(false);
  });
});

describe('addHook', () => {
  it('returns false (and never calls the manager) when the profile is missing', async () => {
    const { ctx } = makeContext();
    expect(await addHook(ctx, 'alice', validHook())).toBe(false);
    expect(hooksManagerMock.addHook).not.toHaveBeenCalled();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('delegates to the manager and notifies the renderer on success', async () => {
    const { ctx } = makeContext(makeProfile());
    const hook = validHook();
    expect(await addHook(ctx, 'alice', hook)).toBe(true);
    expect(hooksManagerMock.addHook).toHaveBeenCalledWith('alice', hook);
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('loads the profile from disk (seeding the gate) before delegating', async () => {
    const fileProfile = makeProfile();
    const { ctx, cache } = makeContext(undefined, { readProfileFromFile: vi.fn(async () => fileProfile) });
    expect(await addHook(ctx, 'alice', validHook())).toBe(true);
    expect(cache.get('alice')).toBe(fileProfile);
    expect(hooksManagerMock.addHook).toHaveBeenCalled();
  });

  it('returns false without notifying when the manager rejects the add', async () => {
    hooksManagerMock.addHook.mockResolvedValue(false);
    const { ctx } = makeContext(makeProfile());
    expect(await addHook(ctx, 'alice', validHook())).toBe(false);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });
});

describe('updateHook', () => {
  it('returns false (and never calls the manager) when the profile is missing', async () => {
    const { ctx } = makeContext();
    expect(await updateHook(ctx, 'alice', 'h1', { enabled: false })).toBe(false);
    expect(hooksManagerMock.updateHook).not.toHaveBeenCalled();
  });

  it('delegates to the manager and notifies the renderer on success', async () => {
    const { ctx } = makeContext(makeProfile());
    expect(await updateHook(ctx, 'alice', 'h1', { enabled: false, name: 'renamed' })).toBe(true);
    expect(hooksManagerMock.updateHook).toHaveBeenCalledWith('alice', 'h1', { enabled: false, name: 'renamed' });
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('returns false without notifying when the manager rejects the update', async () => {
    hooksManagerMock.updateHook.mockResolvedValue(false);
    const { ctx } = makeContext(makeProfile());
    expect(await updateHook(ctx, 'alice', 'h1', { enabled: false })).toBe(false);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });
});

describe('deleteHook', () => {
  it('returns false (and never calls the manager) when the profile is missing', async () => {
    const { ctx } = makeContext();
    expect(await deleteHook(ctx, 'alice', 'h1')).toBe(false);
    expect(hooksManagerMock.deleteHook).not.toHaveBeenCalled();
  });

  it('delegates to the manager and notifies the renderer on success', async () => {
    const { ctx } = makeContext(makeProfile());
    expect(await deleteHook(ctx, 'alice', 'h1')).toBe(true);
    expect(hooksManagerMock.deleteHook).toHaveBeenCalledWith('alice', 'h1');
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('returns false without notifying when the manager rejects the delete', async () => {
    hooksManagerMock.deleteHook.mockResolvedValue(false);
    const { ctx } = makeContext(makeProfile());
    expect(await deleteHook(ctx, 'alice', 'h1')).toBe(false);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();
  });
});
