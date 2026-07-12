import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
vi.mock('electron', async () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }));

vi.mock('../pathUtils', async () => ({
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

// Mock only the disk I/O of hooksFileStore; reuse the real pure helpers
// (sanitizeHookEntries / fingerprintHooks) so the dirty-check is exercised.
vi.mock('../hooksFileStore', async () => {
  const actual = await vi.importActual<typeof import('../hooksFileStore')>('../hooksFileStore');
  return {
    ...actual,
    readHooksFile: vi.fn(),
    writeHooksFile: vi.fn(async () => {}),
    loadHooksForProfile: vi.fn(),
  };
});

import { HooksConfigManager } from '../hooksConfigManager';
import {
  readHooksFile,
  writeHooksFile,
  loadHooksForProfile,
  sanitizeHookEntries,
} from '../hooksFileStore';
import type { HookDefinition } from '../types/profile';

const mockRead = vi.mocked(readHooksFile);
const mockWrite = vi.mocked(writeHooksFile);
const mockLoad = vi.mocked(loadHooksForProfile);

function makeHook(id: string, overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id,
    name: `Hook ${id}`,
    version: '1.0.0',
    remoteVersion: '',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWrite.mockResolvedValue(undefined);
  mockRead.mockResolvedValue(null);
});

describe('HooksConfigManager — singleton', () => {
  it('getInstance returns a stable singleton', () => {
    expect(HooksConfigManager.getInstance()).toBe(HooksConfigManager.getInstance());
  });
});

describe('HooksConfigManager.loadForAlias', () => {
  it('loads via hooksFileStore, caches the library and primes the fingerprint', async () => {
    const hooks = [makeHook('a')];
    mockLoad.mockResolvedValue({ hooks, needsProfileRewrite: true });
    const mgr = new HooksConfigManager();

    const result = await mgr.loadForAlias('alice', { hooks: [] });

    expect(result).toEqual({ hooks, needsProfileRewrite: true });
    expect(mockLoad).toHaveBeenCalledWith('/mock/userData/profiles/alice', { hooks: [] });
    expect(mgr.getHooks('alice')).toEqual(hooks);
    expect(mgr.hasHooksLoaded('alice')).toBe(true);
    expect(mgr.hasPersistedHooks('alice')).toBe(true);
  });
});

describe('HooksConfigManager — read API', () => {
  it('getHooks returns [] for an unknown alias and a defensive copy otherwise', async () => {
    const hooks = [makeHook('a')];
    mockLoad.mockResolvedValue({ hooks, needsProfileRewrite: false });
    const mgr = new HooksConfigManager();

    expect(mgr.getHooks('nobody')).toEqual([]);
    expect(mgr.hasHooksLoaded('nobody')).toBe(false);
    expect(mgr.hasPersistedHooks('nobody')).toBe(false);

    await mgr.loadForAlias('alice', {});
    const copy = mgr.getHooks('alice');
    expect(copy).toEqual(hooks);
    copy[0].enabled = false;
    expect(mgr.getHooks('alice')[0].enabled).toBe(true);
  });

  it('getHook returns a copy when found, undefined when missing or alias unknown', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('a')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(mgr.getHook('alice', 'a')).toMatchObject({ id: 'a' });
    expect(mgr.getHook('alice', 'missing')).toBeUndefined();
    expect(mgr.getHook('nobody', 'a')).toBeUndefined();
  });

  it('hasHook reflects presence and is false for an unknown alias', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('a')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(mgr.hasHook('alice', 'a')).toBe(true);
    expect(mgr.hasHook('alice', 'missing')).toBe(false);
    expect(mgr.hasHook('nobody', 'a')).toBe(false);
  });

  it('clearForAlias and clearAll drop cached libraries and fingerprints', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('a')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});
    await mgr.loadForAlias('bob', {});

    mgr.clearForAlias('alice');
    expect(mgr.getHooks('alice')).toEqual([]);
    expect(mgr.hasPersistedHooks('alice')).toBe(false);
    expect(mgr.getHooks('bob')).toHaveLength(1);

    mgr.clearAll();
    expect(mgr.getHooks('bob')).toEqual([]);
    expect(mgr.hasPersistedHooks('bob')).toBe(false);
  });
});

describe('HooksConfigManager.resolveFromDisk', () => {
  it('caches the file hooks and primes the fingerprint when hooks.json exists', async () => {
    mockRead.mockResolvedValue([makeHook('a')]);
    const mgr = new HooksConfigManager();

    await mgr.resolveFromDisk('alice');

    expect(mgr.getHooks('alice').map(h => h.id)).toEqual(['a']);
    expect(mgr.hasPersistedHooks('alice')).toBe(true);
  });

  it('caches the legacy slice and clears the fingerprint when hooks.json is absent', async () => {
    mockRead.mockResolvedValue(null);
    const mgr = new HooksConfigManager();

    await mgr.resolveFromDisk('alice', [makeHook('legacy')]);

    expect(mgr.getHooks('alice').map(h => h.id)).toEqual(['legacy']);
    expect(mgr.hasHooksLoaded('alice')).toBe(true);
    expect(mgr.hasPersistedHooks('alice')).toBe(false);
  });

  it('caches an empty library when absent and no legacy slice is supplied', async () => {
    mockRead.mockResolvedValue(null);
    const mgr = new HooksConfigManager();

    await mgr.resolveFromDisk('alice');

    expect(mgr.getHooks('alice')).toEqual([]);
    expect(mgr.hasHooksLoaded('alice')).toBe(true);
    expect(mgr.hasPersistedHooks('alice')).toBe(false);
  });
});

describe('HooksConfigManager.commitResolvedHooks', () => {
  it('skips the write when the committed library matches the primed fingerprint', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('a')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    await mgr.commitResolvedHooks('alice', [makeHook('a')]);

    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('writes hooks.json when the committed library differs', async () => {
    const mgr = new HooksConfigManager();

    await mgr.commitResolvedHooks('alice', [makeHook('a')]);

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mgr.hasPersistedHooks('alice')).toBe(true);
  });
});

describe('HooksConfigManager.addHook', () => {
  it('appends a new hook on a cold cache, persisting only hooks.json', async () => {
    mockRead.mockResolvedValue(null);
    const mgr = new HooksConfigManager();

    const ok = await mgr.addHook('alice', makeHook('writer'));

    expect(ok).toBe(true);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][0]).toBe('/mock/userData/profiles/alice');
    expect(mockWrite.mock.calls[0][1].map(h => h.id)).toEqual(['writer']);
    expect(mgr.getHooks('alice').map(h => h.id)).toEqual(['writer']);
    expect(mgr.hasPersistedHooks('alice')).toBe(true);
  });

  it('stamps createdAt/updatedAt server-side', async () => {
    mockRead.mockResolvedValue(null);
    const mgr = new HooksConfigManager();

    await mgr.addHook('alice', makeHook('writer', { createdAt: 'OLD', updatedAt: 'OLD' }));

    expect(mgr.getHook('alice', 'writer')!.createdAt).not.toBe('OLD');
    expect(mgr.getHook('alice', 'writer')!.updatedAt).not.toBe('OLD');
  });

  it('rejects a malformed hook definition (no write)', async () => {
    const mgr = new HooksConfigManager();

    expect(await mgr.addHook('alice', { id: '' } as HookDefinition)).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('rejects a duplicate id (no write)', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('dup')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.addHook('alice', makeHook('dup'))).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false and logs when hooks.json persistence throws', async () => {
    mockRead.mockResolvedValue(null);
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    const mgr = new HooksConfigManager();

    expect(await mgr.addHook('alice', makeHook('writer'))).toBe(false);
  });

  it('logs a warning through the onRetry hook on a transient write retry', async () => {
    mockRead.mockResolvedValue(null);
    mockWrite.mockImplementationOnce(async (_dir, _hooks, options) => {
      options?.onRetry?.({
        attempt: 1,
        error: Object.assign(new Error('locked'), { code: 'EPERM' }) as NodeJS.ErrnoException,
        delayMs: 20,
      });
    });
    const mgr = new HooksConfigManager();

    expect(await mgr.addHook('alice', makeHook('writer'))).toBe(true);
  });

  it('returns false when persistence rejects with a non-Error value', async () => {
    mockRead.mockResolvedValue(null);
    mockWrite.mockRejectedValueOnce('disk full string');
    const mgr = new HooksConfigManager();

    expect(await mgr.addHook('alice', makeHook('writer'))).toBe(false);
  });
});

describe('HooksConfigManager.updateHook', () => {
  it('updates an existing hook, preserving id/createdAt and refreshing updatedAt', async () => {
    mockLoad.mockResolvedValue({
      hooks: [makeHook('writer', { createdAt: 'CREATED', updatedAt: 'OLD' }), makeHook('reader')],
      needsProfileRewrite: false,
    });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateHook('alice', 'writer', { enabled: false, name: 'renamed' })).toBe(true);
    const updated = mgr.getHook('alice', 'writer')!;
    expect(updated).toMatchObject({ id: 'writer', createdAt: 'CREATED', enabled: false, name: 'renamed' });
    expect(updated.updatedAt).not.toBe('OLD');
    expect(mgr.getHook('alice', 'reader')!.enabled).toBe(true);
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('resolves from disk on a cold cache before updating', async () => {
    mockRead.mockResolvedValue([makeHook('writer')]);
    const mgr = new HooksConfigManager();

    expect(await mgr.updateHook('alice', 'writer', { enabled: false })).toBe(true);
    expect(mockRead).toHaveBeenCalledWith('/mock/userData/profiles/alice');
  });

  it('returns false when the hook does not exist (no write)', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('other')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateHook('alice', 'writer', { enabled: false })).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false when the merged hook would be structurally invalid (no write)', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('writer')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateHook('alice', 'writer', { enabled: 'x' as unknown as boolean })).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false and logs when persistence throws', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('writer')], needsProfileRewrite: false });
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateHook('alice', 'writer', { enabled: false })).toBe(false);
  });

  it('returns false when persistence rejects with a non-Error value', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('writer')], needsProfileRewrite: false });
    mockWrite.mockRejectedValueOnce('disk full string');
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateHook('alice', 'writer', { enabled: false })).toBe(false);
  });
});

describe('HooksConfigManager.deleteHook', () => {
  it('removes an existing hook', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('writer'), makeHook('reader')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.deleteHook('alice', 'writer')).toBe(true);
    expect(mgr.getHooks('alice').map(h => h.id)).toEqual(['reader']);
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('resolves from disk on a cold cache before deleting', async () => {
    mockRead.mockResolvedValue([makeHook('writer')]);
    const mgr = new HooksConfigManager();

    expect(await mgr.deleteHook('alice', 'writer')).toBe(true);
    expect(mgr.getHooks('alice')).toEqual([]);
  });

  it('returns false when the hook does not exist (no write)', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('other')], needsProfileRewrite: false });
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.deleteHook('alice', 'writer')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false and logs when persistence throws', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('writer')], needsProfileRewrite: false });
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.deleteHook('alice', 'writer')).toBe(false);
  });

  it('returns false when persistence rejects with a non-Error value', async () => {
    mockLoad.mockResolvedValue({ hooks: [makeHook('writer')], needsProfileRewrite: false });
    mockWrite.mockRejectedValueOnce('disk full string');
    const mgr = new HooksConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.deleteHook('alice', 'writer')).toBe(false);
  });
});

describe('HooksConfigManager — write serialization', () => {
  it('serializes concurrent writes for the same alias', async () => {
    mockRead.mockResolvedValue(null);
    let active = 0;
    let maxActive = 0;
    mockWrite.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
    });
    const mgr = new HooksConfigManager();

    await Promise.all([
      mgr.addHook('alice', makeHook('a')),
      mgr.addHook('alice', makeHook('b')),
      mgr.addHook('alice', makeHook('c')),
    ]);

    expect(maxActive).toBe(1);
    expect(sanitizeHookEntries(mgr.getHooks('alice')).map(h => h.id).sort()).toEqual(['a', 'b', 'c']);
  });
});
