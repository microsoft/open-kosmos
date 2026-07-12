/**
 * Supplementary coverage tests for shared profile entity write behavior.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { writeProfileThenCommitCache, type EntityCrudContext } from '../profileEntityCrud';
import type { ProfileV2 } from '../types/profile';

function makeV2Profile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    alias: 'alice',
    chats: [],
    mcp_servers: [],
    skills: [],
    hooksEnabled: false,
    ...overrides,
  } as unknown as ProfileV2;
}

function makeCtx(profile: ProfileV2): EntityCrudContext {
  return {
    cache: new Map([['alice', profile]]),
    getProfileDirectoryPath: vi.fn().mockReturnValue('/profiles/alice'),
    readProfileFromFile: vi.fn().mockResolvedValue(null),
    writeProfileToFile: vi.fn().mockResolvedValue(true),
    notifyProfileDataManager: vi.fn().mockResolvedValue(undefined),
  };
}

describe('profile entity write failure isolation', () => {
  it('does not commit a failed staged profile into the cache before a later successful write', async () => {
    const profile = makeV2Profile();
    const ctx = makeCtx(profile);
    vi.mocked(ctx.writeProfileToFile)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const failedProfile = { ...profile, hooksEnabled: true };
    expect(await writeProfileThenCommitCache(ctx, 'alice', profile, failedProfile, true)).toBe(false);
    expect(profile.hooksEnabled).toBe(false);
    expect(ctx.cache.get('alice')?.hooksEnabled).toBe(false);
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();

    const durableProfile = { ...profile, hooksEnabled: false, primaryChat: 'chat_durable' };
    expect(await writeProfileThenCommitCache(ctx, 'alice', profile, durableProfile, true)).toBe(true);

    const persistedBySecondWrite = vi.mocked(ctx.writeProfileToFile).mock.calls.at(-1)?.[1] as ProfileV2;
    expect(persistedBySecondWrite.hooksEnabled).toBe(false);
    expect(persistedBySecondWrite.primaryChat).toBe('chat_durable');
    expect(ctx.cache.get('alice')?.primaryChat).toBe('chat_durable');
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });
});
