// @ts-nocheck
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

import {
  getConfirmationSettings,
  updateConfirmationSettings,
  getVoiceInputSettings,
  updateVoiceInputSettings,
  updatePrimaryChat,
  updateFreDone,
  getFreDone,
  getBrowserSettings,
  updateBrowserSettings,
  getComputerUseSettings,
  updateComputerUseSettings,
  getMemexSettings,
  updateMemexSettings,
  getCodingAgentSettings,
  updateCodingAgentSettings,
  getDevToolsMcpSettings,
  updateDevToolsMcpSettings,
  getSyncSettings,
  updateSyncSettings,
  SettingsCrudContext,
} from '../profileSettingsCrud';
import { setHooksEnabled } from '../profileHookCrud';
import type { ProfileV2 } from '../types/profile';

function makeProfile(alias = 'alice', overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0' as any,
    alias,
    primaryChat: 'c1',
    mcp_servers: [],
    skills: [],
    chats: [{ chat_id: 'c1', chat_type: 'single_agent', agent: { name: 'Test Agent' } as any }],
    'starred-chat-sessions': [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    freDone: false,
    ...overrides,
  } as ProfileV2;
}

function makeCtx(profile?: ProfileV2, alias = 'alice'): SettingsCrudContext {
  const cache = new Map<string, ProfileV2>();
  if (profile) cache.set(alias, profile);
  return {
    cache,
    readProfileFromFile: vi.fn(async () => null),
    writeProfileToFile: vi.fn(async () => true),
    notifyProfileDataManager: vi.fn(async () => {}),
  };
}

// ── Confirmation Settings ─────────────────────────────────────────────────────

describe('getConfirmationSettings', () => {
  it('returns defaults when profile not found', () => {
    const ctx = makeCtx();
    const result = getConfirmationSettings(ctx, 'alice');
    expect(result.inlineEditRegenerate).toBeDefined();
  });

  it('merges confirmationSettings from profile', () => {
    const profile = makeProfile('alice', {
      confirmationSettings: { inlineEditRegenerate: { skipConfirmation: true } },
    });
    const ctx = makeCtx(profile);
    const result = getConfirmationSettings(ctx, 'alice');
    expect(result.inlineEditRegenerate.skipConfirmation).toBe(true);
  });
});

describe('updateConfirmationSettings', () => {
  it('updates confirmation settings', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const result = await updateConfirmationSettings(ctx, 'alice', {
      inlineEditRegenerate: { skipConfirmation: true },
    });
    expect(result).toBe(true);
    expect(profile.confirmationSettings?.inlineEditRegenerate?.skipConfirmation).toBe(true);
  });

  it('does not let a failed settings write become durable through a later profile write', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any)
      .mockResolvedValueOnce(false)
      .mockImplementation(async (_alias: string, nextProfile: ProfileV2) => {
        ctx.cache.set('alice', nextProfile);
        return true;
      });

    expect(await updateConfirmationSettings(ctx, 'alice', {
      inlineEditRegenerate: { skipConfirmation: true },
    })).toBe(false);
    expect(profile.confirmationSettings).toBeUndefined();
    expect(ctx.notifyProfileDataManager).not.toHaveBeenCalled();

    // The Hooks master switch still persists through profile.json's shared
    // writeProfileThenCommitCache, so use it as the "later write" and confirm the
    // failed settings change did not leak into the next persisted snapshot.
    expect(await setHooksEnabled(ctx as any, 'alice', true)).toBe(true);

    const persisted = (ctx.writeProfileToFile as any).mock.calls.at(-1)?.[1] as ProfileV2;
    expect(persisted.confirmationSettings).toBeUndefined();
    expect(persisted.hooksEnabled).toBe(true);
  });
});

// ── Voice Input ───────────────────────────────────────────────────────────────

describe('getVoiceInputSettings', () => {
  it('returns defaults when not set', () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const result = getVoiceInputSettings(ctx, 'alice');
    expect(result).toBeDefined();
  });

  it('returns profile voiceInputSettings when set', () => {
    const profile = makeProfile('alice', {
      voiceInputSettings: { voiceInputEnabled: true, whisperModelSelected: 'tiny', recognitionLanguage: 'en', gpuAcceleration: false },
    });
    const ctx = makeCtx(profile);
    expect(getVoiceInputSettings(ctx, 'alice').voiceInputEnabled).toBe(true);
  });
});

describe('updateVoiceInputSettings', () => {
  it('updates voice settings', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const result = await updateVoiceInputSettings(ctx, 'alice', { voiceInputEnabled: true } as any);
    expect(result).toBe(true);
  });
});

// ── PrimaryAgent ──────────────────────────────────────────────────────────────

describe('updatePrimaryChat', () => {
  it('updates primaryChat when chat exists', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const result = await updatePrimaryChat(ctx, 'alice', 'c1');
    // Already set, returns true (early exit)
    expect(result).toBe(true);
  });

  it('returns false when chat does not exist in chats', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updatePrimaryChat(ctx, 'alice', 'ghost_chat')).toBe(false);
  });
});

// ── FRE ───────────────────────────────────────────────────────────────────────

describe('getFreDone', () => {
  it('returns false when profile not found', () => {
    const ctx = makeCtx();
    expect(getFreDone(ctx, 'alice')).toBe(false);
  });

  it('returns freDone from profile', () => {
    const profile = makeProfile('alice', { freDone: true });
    const ctx = makeCtx(profile);
    expect(getFreDone(ctx, 'alice')).toBe(true);
  });
});

describe('updateFreDone', () => {
  it('updates freDone to true', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const result = await updateFreDone(ctx, 'alice', true);
    expect(result).toBe(true);
    expect(profile.freDone).toBe(true);
  });

  it('returns true early when value unchanged', async () => {
    const profile = makeProfile('alice', { freDone: true });
    const ctx = makeCtx(profile);
    const result = await updateFreDone(ctx, 'alice', true);
    expect(result).toBe(true);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
  });
});

// ── DevTools MCP ──────────────────────────────────────────────────────────────

describe('getDevToolsMcpSettings', () => {
  it('returns defaults when not set', () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(getDevToolsMcpSettings(ctx, 'alice')).toBeDefined();
  });
});

describe('updateDevToolsMcpSettings', () => {
  it('updates devtools MCP settings', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateDevToolsMcpSettings(ctx, 'alice', { enabled: true } as any)).toBe(true);
  });
});

// ── Sync Settings ─────────────────────────────────────────────────────────────

describe('getSyncSettings', () => {
  it('returns defaults when not set', () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(getSyncSettings(ctx, 'alice')).toBeDefined();
  });
});

describe('updateSyncSettings', () => {
  it('updates sync settings', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateSyncSettings(ctx, 'alice', { autoSync: true } as any)).toBe(true);
  });
});

// ── Error/fallback paths for get* functions ───────────────────────────────────

describe('getConfirmationSettings – error path', () => {
  it('returns defaults when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getConfirmationSettings(ctx, 'alice')).toBeDefined();
  });
});

describe('getVoiceInputSettings – error path', () => {
  it('returns defaults when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getVoiceInputSettings(ctx, 'alice')).toBeDefined();
  });
});

describe('getDevToolsMcpSettings – error path', () => {
  it('returns defaults when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getDevToolsMcpSettings(ctx, 'alice')).toBeDefined();
  });

  it('returns devToolsMcpSettings from profile when set', () => {
    const profile = makeProfile('alice', { devToolsMcpSettings: { enabled: true } as any });
    const ctx = makeCtx(profile);
    expect((getDevToolsMcpSettings(ctx, 'alice') as any).enabled).toBe(true);
  });
});

describe('getSyncSettings – error path', () => {
  it('returns defaults when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getSyncSettings(ctx, 'alice')).toBeDefined();
  });

  it('returns merged syncSettings from profile', () => {
    const profile = makeProfile('alice', { syncSettings: { autoSync: true } as any });
    const ctx = makeCtx(profile);
    expect((getSyncSettings(ctx, 'alice') as any).autoSync).toBe(true);
  });
});

describe('getFreDone – error path', () => {
  it('returns false when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getFreDone(ctx, 'alice')).toBe(false);
  });
});

// ── update* fallback paths — loads from file ─────────────────────────────────

describe('updateConfirmationSettings – loads from file', () => {
  it('loads from file when not cached', async () => {
    const profile = makeProfile();
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => profile),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateConfirmationSettings(ctx, 'alice', {})).toBe(true);
  });

  it('returns false when file returns null', async () => {
    const ctx = makeCtx();
    expect(await updateConfirmationSettings(ctx, 'alice', {})).toBe(false);
  });

  it('uses existing confirmationSettings when present', async () => {
    const profile = makeProfile('alice', {
      confirmationSettings: { inlineEditRegenerate: { skipConfirmation: false } },
    });
    const ctx = makeCtx(profile);
    const result = await updateConfirmationSettings(ctx, 'alice', {
      inlineEditRegenerate: { skipConfirmation: true },
    });
    expect(result).toBe(true);
  });
});

describe('updateVoiceInputSettings – fallback paths', () => {
  it('loads from file when not cached', async () => {
    const profile = makeProfile();
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => profile),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateVoiceInputSettings(ctx, 'alice', {})).toBe(true);
  });

  it('uses existing voiceInputSettings when present', async () => {
    const profile = makeProfile('alice', {
      voiceInputSettings: { voiceInputEnabled: false, whisperModelSelected: 'tiny', recognitionLanguage: 'en', gpuAcceleration: false },
    });
    const ctx = makeCtx(profile);
    expect(await updateVoiceInputSettings(ctx, 'alice', { voiceInputEnabled: true } as any)).toBe(true);
  });
});

describe('updateDevToolsMcpSettings – fallback paths', () => {
  it('uses existing devToolsMcpSettings when present', async () => {
    const profile = makeProfile('alice', { devToolsMcpSettings: { enabled: false } as any });
    const ctx = makeCtx(profile);
    expect(await updateDevToolsMcpSettings(ctx, 'alice', { enabled: true } as any)).toBe(true);
  });

  it('loads from file when not cached', async () => {
    const profile = makeProfile();
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => profile),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateDevToolsMcpSettings(ctx, 'alice', {})).toBe(true);
  });
});

describe('updateSyncSettings – fallback paths', () => {
  it('uses existing syncSettings when present', async () => {
    const profile = makeProfile('alice', { syncSettings: { autoSync: false } as any });
    const ctx = makeCtx(profile);
    expect(await updateSyncSettings(ctx, 'alice', { autoSync: true } as any)).toBe(true);
  });

  it('loads from file when not cached', async () => {
    const profile = makeProfile();
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => profile),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateSyncSettings(ctx, 'alice', {})).toBe(true);
  });
});

describe('updatePrimaryChat – file load path', () => {
  it('loads from file when not in cache', async () => {
    const profile = makeProfile();
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => profile),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    // Chat exists in chats
    expect(await updatePrimaryChat(ctx, 'alice', 'c1')).toBe(true);
  });

  it('writes profile when primary chat changes', async () => {
    const profile = makeProfile('alice', {
      chats: [
        { chat_id: 'c1', chat_type: 'single_agent', agent: { name: 'Agent A' } as any },
        { chat_id: 'c2', chat_type: 'single_agent', agent: { name: 'Agent B' } as any },
      ],
      primaryChat: 'c1',
    });
    const ctx = makeCtx(profile);
    const result = await updatePrimaryChat(ctx, 'alice', 'c2');
    expect(result).toBe(true);
    expect(profile.primaryChat).toBe('c2');
  });
});

describe('updateFreDone – file load path', () => {
  it('loads from file when not in cache', async () => {
    const profile = makeProfile('alice', { freDone: false });
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => profile),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateFreDone(ctx, 'alice', true)).toBe(true);
  });

  it('returns false when file returns null', async () => {
    const ctx = makeCtx();
    expect(await updateFreDone(ctx, 'alice', true)).toBe(false);
  });
});

// ── isProfileV2 false paths (covers "return false" branches when profile loaded from file is invalid) ──

describe('update* – returns false when file profile fails isProfileV2', () => {
  // A "profile" that has authProvider field fails isProfileV2
  function makeInvalidProfile(): any {
    return { authProvider: 'msal', alias: 'alice' } as any;
  }

  it('updateConfirmationSettings returns false for invalid profile', async () => {
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => makeInvalidProfile()),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateConfirmationSettings(ctx, 'alice', {})).toBe(false);
  });

  it('updateVoiceInputSettings returns false for invalid profile', async () => {
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => makeInvalidProfile()),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateVoiceInputSettings(ctx, 'alice', {})).toBe(false);
  });

  it('updateDevToolsMcpSettings returns false for invalid profile', async () => {
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => makeInvalidProfile()),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateDevToolsMcpSettings(ctx, 'alice', {})).toBe(false);
  });

  it('updateSyncSettings returns false for invalid profile', async () => {
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => makeInvalidProfile()),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateSyncSettings(ctx, 'alice', {})).toBe(false);
  });

  it('updatePrimaryChat returns false for invalid profile loaded from file', async () => {
    const ctx: SettingsCrudContext = {
      cache: new Map(),
      readProfileFromFile: vi.fn(async () => makeInvalidProfile()),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updatePrimaryChat(ctx, 'alice', 'c1')).toBe(false);
  });
});

// ── catch block coverage for update* functions ────────────────────────────────

describe('update* – catch block coverage', () => {
  it('updateDevToolsMcpSettings returns false when writeProfileToFile throws', async () => {
    const profile = makeProfile();
    const ctx: SettingsCrudContext = {
      cache: new Map([['alice', profile]]),
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => { throw new Error('disk error'); }),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateDevToolsMcpSettings(ctx, 'alice', {})).toBe(false);
  });

  it('updateSyncSettings returns false when writeProfileToFile throws', async () => {
    const profile = makeProfile();
    const ctx: SettingsCrudContext = {
      cache: new Map([['alice', profile]]),
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => { throw new Error('disk error'); }),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(await updateSyncSettings(ctx, 'alice', {})).toBe(false);
  });
});

// ── Browser (per-profile feature switch) ──────────────────────────────────────

describe('getBrowserSettings', () => {
  it('returns defaults (disabled) when not set', () => {
    const ctx = makeCtx(makeProfile());
    expect(getBrowserSettings(ctx, 'alice').enabled).toBe(false);
  });

  it('returns browser settings from profile when set', () => {
    const ctx = makeCtx(makeProfile('alice', { browser: { enabled: true } }));
    expect(getBrowserSettings(ctx, 'alice').enabled).toBe(true);
  });

  it('returns defaults when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getBrowserSettings(ctx, 'alice').enabled).toBe(false);
  });
});

describe('updateBrowserSettings', () => {
  it('updates browser settings on an existing profile', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateBrowserSettings(ctx, 'alice', { enabled: true })).toBe(true);
    expect(profile.browser?.enabled).toBe(true);
  });

  it('merges onto defaults when profile has no browser block', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateBrowserSettings(ctx, 'alice', {})).toBe(true);
    expect(profile.browser?.enabled).toBe(false);
  });

  it('returns false when the profile cannot be loaded', async () => {
    const ctx = makeCtx();
    expect(await updateBrowserSettings(ctx, 'alice', { enabled: true })).toBe(false);
  });

  it('returns false when the write throws', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockRejectedValue(new Error('disk'));
    expect(await updateBrowserSettings(ctx, 'alice', { enabled: true })).toBe(false);
  });
});

// ── Computer Use (per-profile feature switch) ─────────────────────────────────

describe('getComputerUseSettings', () => {
  it('returns defaults (disabled) when not set', () => {
    const ctx = makeCtx(makeProfile());
    expect(getComputerUseSettings(ctx, 'alice').enabled).toBe(false);
  });

  it('returns computer use settings from profile when set', () => {
    const ctx = makeCtx(
      makeProfile('alice', { computerUse: { enabled: true, requireConfirmation: false, alwaysAllowedApps: ['Safari'] } }),
    );
    const settings = getComputerUseSettings(ctx, 'alice');
    expect(settings.enabled).toBe(true);
    expect(settings.requireConfirmation).toBe(false);
    expect(settings.alwaysAllowedApps).toEqual(['Safari']);
  });

  it('returns defaults when cached computer use settings are malformed', () => {
    const ctx = makeCtx(
      makeProfile('alice', {
        computerUse: {
          enabled: 'true',
          requireConfirmation: false,
          alwaysAllowedApps: ['Safari'],
        } as any,
      }),
    );
    expect(getComputerUseSettings(ctx, 'alice')).toEqual({
      enabled: false,
      requireConfirmation: true,
      alwaysAllowedApps: [],
    });
  });

  it('returns defaults when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getComputerUseSettings(ctx, 'alice').enabled).toBe(false);
  });
});

describe('updateComputerUseSettings', () => {
  it('updates computer use settings on an existing profile', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateComputerUseSettings(ctx, 'alice', { enabled: true })).toBe(true);
    expect(profile.computerUse?.enabled).toBe(true);
  });

  it('merges onto defaults when profile has no computerUse block', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateComputerUseSettings(ctx, 'alice', {})).toBe(true);
    expect(profile.computerUse?.enabled).toBe(false);
  });

  it('returns false when the profile cannot be loaded', async () => {
    const ctx = makeCtx();
    expect(await updateComputerUseSettings(ctx, 'alice', { enabled: true })).toBe(false);
  });

  it('returns false when the write throws', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockRejectedValue(new Error('disk'));
    expect(await updateComputerUseSettings(ctx, 'alice', { enabled: true })).toBe(false);
  });

  it('rejects a non-array allowlist before caching', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(
      await updateComputerUseSettings(ctx, 'alice', { alwaysAllowedApps: 'oops' as unknown as string[] }),
    ).toBe(false);
    expect(profile.computerUse).toBeUndefined();
  });

  it('rejects non-string allowlist entries before caching', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateComputerUseSettings(ctx, 'alice', {
      enabled: true,
      alwaysAllowedApps: ['Safari', '  ', 42, '', 'Notes'] as unknown as string[],
    })).toBe(false);
    expect(profile.computerUse).toBeUndefined();
  });

  it('rejects invalid boolean fields before caching', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateComputerUseSettings(ctx, 'alice', {
      enabled: 'yes' as unknown as boolean,
    })).toBe(false);
    expect(profile.computerUse).toBeUndefined();
  });

  it('keeps a valid allowlist intact', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    await updateComputerUseSettings(ctx, 'alice', { alwaysAllowedApps: ['Edge'] });
    expect(profile.computerUse?.alwaysAllowedApps).toEqual(['Edge']);
  });

  it('normalizes malformed cached settings before merging a valid patch', async () => {
    const profile = makeProfile('alice', {
      computerUse: {
        enabled: 'true',
        requireConfirmation: 'false',
        alwaysAllowedApps: 'Safari',
      } as any,
    });
    const ctx = makeCtx(profile);
    expect(await updateComputerUseSettings(ctx, 'alice', { enabled: true })).toBe(true);
    expect(profile.computerUse).toEqual({
      enabled: true,
      requireConfirmation: true,
      alwaysAllowedApps: [],
    });
  });
});

// ── Memex (per-profile feature switch) ────────────────────────────────────────

describe('getMemexSettings', () => {
  it('returns defaults (disabled) when not set', () => {
    const ctx = makeCtx(makeProfile());
    expect(getMemexSettings(ctx, 'alice').enabled).toBe(false);
  });

  it('returns memex settings from profile when set', () => {
    const ctx = makeCtx(makeProfile('alice', { memex: { enabled: true } }));
    expect(getMemexSettings(ctx, 'alice').enabled).toBe(true);
  });

  it('returns defaults when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getMemexSettings(ctx, 'alice').enabled).toBe(false);
  });
});

describe('updateMemexSettings', () => {
  it('updates memex settings on an existing profile', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateMemexSettings(ctx, 'alice', { enabled: true })).toBe(true);
    expect(profile.memex?.enabled).toBe(true);
  });

  it('merges onto defaults when profile has no memex block', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateMemexSettings(ctx, 'alice', {})).toBe(true);
    expect(profile.memex?.enabled).toBe(false);
  });

  it('returns false when the profile cannot be loaded', async () => {
    const ctx = makeCtx();
    expect(await updateMemexSettings(ctx, 'alice', { enabled: true })).toBe(false);
  });

  it('returns false when the write throws', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockRejectedValue(new Error('disk'));
    expect(await updateMemexSettings(ctx, 'alice', { enabled: true })).toBe(false);
  });
});

// ── Coding Agent ──────────────────────────────────────────────────────────────

describe('getCodingAgentSettings', () => {
  it('returns default (claude) when profile has no codingAgentSettings', () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(getCodingAgentSettings(ctx, 'alice').cli).toBe('claude');
    expect(getCodingAgentSettings(ctx, 'alice').enabled).toBe(false);
  });

  it('back-fills enabled=false for a legacy profile that only stored cli', () => {
    const profile = makeProfile('alice', { codingAgentSettings: { cli: 'gemini' } as any });
    const ctx = makeCtx(profile);
    expect(getCodingAgentSettings(ctx, 'alice').enabled).toBe(false);
  });

  it('returns the persisted enabled flag merged over defaults', () => {
    const profile = makeProfile('alice', { codingAgentSettings: { enabled: true, cli: 'codex' } as any });
    const ctx = makeCtx(profile);
    const settings = getCodingAgentSettings(ctx, 'alice');
    expect(settings.enabled).toBe(true);
    expect(settings.cli).toBe('codex');
  });

  it('returns the persisted cli merged over defaults', () => {
    const profile = makeProfile('alice', { codingAgentSettings: { cli: 'gemini' } as any });
    const ctx = makeCtx(profile);
    expect(getCodingAgentSettings(ctx, 'alice').cli).toBe('gemini');
  });

  it('defaults invalid persisted coding agent fields', () => {
    const profile = makeProfile('alice', { codingAgentSettings: { enabled: 'yes', cli: 'vim' } as any });
    const ctx = makeCtx(profile);
    expect(getCodingAgentSettings(ctx, 'alice')).toEqual({ enabled: false, cli: 'claude' });
  });

  it('returns default when no profile is cached', () => {
    const ctx = makeCtx();
    expect(getCodingAgentSettings(ctx, 'alice').cli).toBe('claude');
  });

  it('returns default when cached object is not a V2 profile', () => {
    const ctx: SettingsCrudContext = {
      cache: new Map<string, any>([['alice', { alias: 'alice' }]]) as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getCodingAgentSettings(ctx, 'alice').cli).toBe('claude');
  });

  it('returns default when cache.get throws', () => {
    const ctx: SettingsCrudContext = {
      cache: { get: () => { throw new Error('boom'); } } as any,
      readProfileFromFile: vi.fn(async () => null),
      writeProfileToFile: vi.fn(async () => true),
      notifyProfileDataManager: vi.fn(async () => {}),
    };
    expect(getCodingAgentSettings(ctx, 'alice').cli).toBe('claude');
  });
});

describe('updateCodingAgentSettings', () => {
  it('persists a new cli selection and returns true', async () => {
    const profile = makeProfile('alice', { codingAgentSettings: { cli: 'claude' } as any });
    const ctx = makeCtx(profile);
    const ok = await updateCodingAgentSettings(ctx, 'alice', { cli: 'codex' });
    expect(ok).toBe(true);
    expect((ctx.writeProfileToFile as any).mock.calls[0][1].codingAgentSettings.cli).toBe('codex');
  });

  it('falls back to defaults when profile has no prior codingAgentSettings', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const ok = await updateCodingAgentSettings(ctx, 'alice', { cli: 'copilot' });
    expect(ok).toBe(true);
    expect((ctx.writeProfileToFile as any).mock.calls[0][1].codingAgentSettings.cli).toBe('copilot');
  });

  it('persists the enabled master switch while preserving cli', async () => {
    const profile = makeProfile('alice', { codingAgentSettings: { enabled: false, cli: 'gemini' } as any });
    const ctx = makeCtx(profile);
    const ok = await updateCodingAgentSettings(ctx, 'alice', { enabled: true });
    expect(ok).toBe(true);
    const written = (ctx.writeProfileToFile as any).mock.calls[0][1].codingAgentSettings;
    expect(written.enabled).toBe(true);
    expect(written.cli).toBe('gemini');
  });

  it('rejects invalid cli values before writing', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const ok = await updateCodingAgentSettings(ctx, 'alice', { cli: 'vim' } as any);
    expect(ok).toBe(false);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
  });

  it('rejects invalid enabled values before writing', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const ok = await updateCodingAgentSettings(ctx, 'alice', { enabled: 'yes' } as any);
    expect(ok).toBe(false);
    expect(ctx.writeProfileToFile).not.toHaveBeenCalled();
  });

  it('returns false when no profile is found', async () => {
    const ctx = makeCtx();
    expect(await updateCodingAgentSettings(ctx, 'alice', { cli: 'gemini' })).toBe(false);
  });

  it('returns false when persistence fails', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    (ctx.writeProfileToFile as any).mockResolvedValueOnce(false);
    expect(await updateCodingAgentSettings(ctx, 'alice', { cli: 'gemini' })).toBe(false);
  });
});
