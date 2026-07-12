import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
vi.mock('electron', async () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }));

vi.mock('../pathUtils', async () => ({
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

// Mock only the disk I/O of skillsFileStore; reuse the real pure helpers
// (sanitizeSkillEntries / fingerprintSkills) so the dirty-check is exercised.
vi.mock('../skillsFileStore', async () => {
  const actual = await vi.importActual<typeof import('../skillsFileStore')>('../skillsFileStore');
  return {
    ...actual,
    readSkillsFile: vi.fn(),
    writeSkillsFile: vi.fn(async () => {}),
    loadSkillsForProfile: vi.fn(),
  };
});

import { SkillsConfigManager } from '../skillsConfigManager';
import {
  readSkillsFile,
  writeSkillsFile,
  loadSkillsForProfile,
  sanitizeSkillEntries,
} from '../skillsFileStore';
import type { SkillConfig } from '../types/profile';

const mockRead = vi.mocked(readSkillsFile);
const mockWrite = vi.mocked(writeSkillsFile);
const mockLoad = vi.mocked(loadSkillsForProfile);

function makeSkill(name: string, version = '1.0.0'): SkillConfig {
  return { name, description: `${name} desc`, version, remoteVersion: '', source: 'ON-DEVICE' };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWrite.mockResolvedValue(undefined);
  mockRead.mockResolvedValue(null);
});

describe('SkillsConfigManager — singleton', () => {
  it('getInstance returns a stable singleton', () => {
    expect(SkillsConfigManager.getInstance()).toBe(SkillsConfigManager.getInstance());
  });
});

describe('SkillsConfigManager.loadForAlias', () => {
  it('loads via skillsFileStore, caches the registry and primes the fingerprint', async () => {
    const skills = [makeSkill('a')];
    mockLoad.mockResolvedValue({ skills, needsProfileRewrite: true });
    const mgr = new SkillsConfigManager();

    const result = await mgr.loadForAlias('alice', { skills: [] });

    expect(result).toEqual({ skills, needsProfileRewrite: true });
    expect(mockLoad).toHaveBeenCalledWith('/mock/userData/profiles/alice', { skills: [] });
    expect(mgr.getSkills('alice')).toEqual(skills);
    expect(mgr.hasSkillsLoaded('alice')).toBe(true);
    expect(mgr.hasPersistedSkills('alice')).toBe(true);
  });
});

describe('SkillsConfigManager — read API', () => {
  it('getSkills returns [] for an unknown alias and a defensive copy otherwise', async () => {
    const skills = [makeSkill('a')];
    mockLoad.mockResolvedValue({ skills, needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();

    expect(mgr.getSkills('nobody')).toEqual([]);
    expect(mgr.hasSkillsLoaded('nobody')).toBe(false);
    expect(mgr.hasPersistedSkills('nobody')).toBe(false);

    await mgr.loadForAlias('alice', {});
    const copy = mgr.getSkills('alice');
    expect(copy).toEqual(skills);
    copy[0].version = 'mutated';
    expect(mgr.getSkills('alice')[0].version).toBe('1.0.0');
  });

  it('getSkill returns a copy when found, undefined when missing or alias unknown', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('a')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(mgr.getSkill('alice', 'a')).toMatchObject({ name: 'a' });
    expect(mgr.getSkill('alice', 'missing')).toBeUndefined();
    expect(mgr.getSkill('nobody', 'a')).toBeUndefined();
  });

  it('hasSkill reflects presence and is false for an unknown alias', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('a')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(mgr.hasSkill('alice', 'a')).toBe(true);
    expect(mgr.hasSkill('alice', 'missing')).toBe(false);
    expect(mgr.hasSkill('nobody', 'a')).toBe(false);
  });

  it('clearForAlias and clearAll drop cached registries and fingerprints', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('a')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});
    await mgr.loadForAlias('bob', {});

    mgr.clearForAlias('alice');
    expect(mgr.getSkills('alice')).toEqual([]);
    expect(mgr.hasPersistedSkills('alice')).toBe(false);
    expect(mgr.getSkills('bob')).toHaveLength(1);

    mgr.clearAll();
    expect(mgr.getSkills('bob')).toEqual([]);
    expect(mgr.hasPersistedSkills('bob')).toBe(false);
  });
});

describe('SkillsConfigManager.resolveFromDisk', () => {
  it('caches the file skills and primes the fingerprint when skills.json exists', async () => {
    mockRead.mockResolvedValue([makeSkill('a')]);
    const mgr = new SkillsConfigManager();

    await mgr.resolveFromDisk('alice');

    expect(mgr.getSkills('alice').map(s => s.name)).toEqual(['a']);
    expect(mgr.hasPersistedSkills('alice')).toBe(true);
  });

  it('caches the legacy slice and clears the fingerprint when skills.json is absent', async () => {
    mockRead.mockResolvedValue(null);
    const mgr = new SkillsConfigManager();

    await mgr.resolveFromDisk('alice', [makeSkill('legacy')]);

    expect(mgr.getSkills('alice').map(s => s.name)).toEqual(['legacy']);
    expect(mgr.hasSkillsLoaded('alice')).toBe(true);
    expect(mgr.hasPersistedSkills('alice')).toBe(false);
  });

  it('strips retired plugin skills from the legacy slice when skills.json is absent', async () => {
    mockRead.mockResolvedValue(null);
    const mgr = new SkillsConfigManager();

    await mgr.resolveFromDisk('alice', [
      makeSkill('legacy-kept'),
      { ...makeSkill('ghost'), source: 'PLUGIN' as any },
    ]);

    // Sanitized on load: the registry getSkills() exposes (and the renderer payload
    // re-injects) has no orphaned plugin skill, even before any skills.json write.
    expect(mgr.getSkills('alice').map(s => s.name)).toEqual(['legacy-kept']);
  });

  it('caches an empty registry when absent and no legacy slice is supplied', async () => {
    mockRead.mockResolvedValue(null);
    const mgr = new SkillsConfigManager();

    await mgr.resolveFromDisk('alice');

    expect(mgr.getSkills('alice')).toEqual([]);
    expect(mgr.hasSkillsLoaded('alice')).toBe(true);
    expect(mgr.hasPersistedSkills('alice')).toBe(false);
  });
});

describe('SkillsConfigManager.addSkill', () => {
  it('appends a new skill on a cold cache, persisting only skills.json', async () => {
    mockRead.mockResolvedValue(null);
    const mgr = new SkillsConfigManager();

    const ok = await mgr.addSkill('alice', makeSkill('writer'));

    expect(ok).toBe(true);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][0]).toBe('/mock/userData/profiles/alice');
    expect(mockWrite.mock.calls[0][1].map(s => s.name)).toEqual(['writer']);
    expect(mgr.getSkills('alice').map(s => s.name)).toEqual(['writer']);
    expect(mgr.hasPersistedSkills('alice')).toBe(true);
  });

  it('updates config in place when the skill already exists', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('writer', '1.0.0'), makeSkill('reader')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    const ok = await mgr.addSkill('alice', makeSkill('writer', '2.0.0'));

    expect(ok).toBe(true);
    const persisted = mockWrite.mock.calls[0][1];
    expect(persisted).toHaveLength(2);
    expect(persisted.find(s => s.name === 'writer')!.version).toBe('2.0.0');
    expect(persisted.find(s => s.name === 'reader')!.version).toBe('1.0.0');
    expect(mgr.getSkill('alice', 'writer')!.version).toBe('2.0.0');
  });

  it('skips the write when the resulting registry is byte-identical (dirty-check)', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('writer', '1.0.0')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    const ok = await mgr.addSkill('alice', makeSkill('writer', '1.0.0'));

    expect(ok).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false and logs when skills.json persistence throws', async () => {
    mockRead.mockResolvedValue(null);
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    const mgr = new SkillsConfigManager();

    expect(await mgr.addSkill('alice', makeSkill('writer'))).toBe(false);
  });

  it('logs a warning through the onRetry hook on a transient write retry', async () => {
    mockRead.mockResolvedValue(null);
    mockWrite.mockImplementationOnce(async (_dir, _skills, options) => {
      options?.onRetry?.({
        attempt: 1,
        error: Object.assign(new Error('locked'), { code: 'EPERM' }) as NodeJS.ErrnoException,
        delayMs: 20,
      });
    });
    const mgr = new SkillsConfigManager();

    expect(await mgr.addSkill('alice', makeSkill('writer'))).toBe(true);
  });

  it('returns false when persistence rejects with a non-Error value', async () => {
    mockRead.mockResolvedValue(null);
    mockWrite.mockRejectedValueOnce('disk full string');
    const mgr = new SkillsConfigManager();

    expect(await mgr.addSkill('alice', makeSkill('writer'))).toBe(false);
  });
});

describe('SkillsConfigManager.updateSkill', () => {
  it('updates an existing skill', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('writer', '1.0.0'), makeSkill('reader')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateSkill('alice', 'writer', { version: '2.0.0' })).toBe(true);
    expect(mgr.getSkill('alice', 'writer')!.version).toBe('2.0.0');
    expect(mgr.getSkill('alice', 'reader')!.version).toBe('1.0.0');
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('resolves from disk on a cold cache before updating', async () => {
    mockRead.mockResolvedValue([makeSkill('writer', '1.0.0')]);
    const mgr = new SkillsConfigManager();

    expect(await mgr.updateSkill('alice', 'writer', { version: '2.0.0' })).toBe(true);
    expect(mockRead).toHaveBeenCalledWith('/mock/userData/profiles/alice');
  });

  it('returns false when the skill does not exist (no write)', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('other')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateSkill('alice', 'writer', { version: '2.0.0' })).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false and logs when persistence throws', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('writer')], needsProfileRewrite: false });
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateSkill('alice', 'writer', { version: '2.0.0' })).toBe(false);
  });

  it('returns false when persistence rejects with a non-Error value', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('writer')], needsProfileRewrite: false });
    mockWrite.mockRejectedValueOnce('disk full string');
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.updateSkill('alice', 'writer', { version: '2.0.0' })).toBe(false);
  });
});

describe('SkillsConfigManager.deleteSkill', () => {
  it('removes an existing skill', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('writer'), makeSkill('reader')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.deleteSkill('alice', 'writer')).toBe(true);
    expect(mgr.getSkills('alice').map(s => s.name)).toEqual(['reader']);
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('resolves from disk on a cold cache before deleting', async () => {
    mockRead.mockResolvedValue([makeSkill('writer')]);
    const mgr = new SkillsConfigManager();

    expect(await mgr.deleteSkill('alice', 'writer')).toBe(true);
    expect(mgr.getSkills('alice')).toEqual([]);
  });

  it('returns false when the skill does not exist (no write)', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('other')], needsProfileRewrite: false });
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.deleteSkill('alice', 'writer')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false and logs when persistence throws', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('writer')], needsProfileRewrite: false });
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.deleteSkill('alice', 'writer')).toBe(false);
  });

  it('returns false when persistence rejects with a non-Error value', async () => {
    mockLoad.mockResolvedValue({ skills: [makeSkill('writer')], needsProfileRewrite: false });
    mockWrite.mockRejectedValueOnce('disk full string');
    const mgr = new SkillsConfigManager();
    await mgr.loadForAlias('alice', {});

    expect(await mgr.deleteSkill('alice', 'writer')).toBe(false);
  });
});

describe('SkillsConfigManager — write serialization', () => {
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
    const mgr = new SkillsConfigManager();

    await Promise.all([
      mgr.addSkill('alice', makeSkill('a')),
      mgr.addSkill('alice', makeSkill('b')),
      mgr.addSkill('alice', makeSkill('c')),
    ]);

    expect(maxActive).toBe(1);
    expect(sanitizeSkillEntries(mgr.getSkills('alice')).map(s => s.name).sort()).toEqual(['a', 'b', 'c']);
  });
});
