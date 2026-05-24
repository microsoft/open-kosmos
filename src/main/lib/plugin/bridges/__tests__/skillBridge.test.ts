/**
 * Tests for skillBridge — injectPluginSkills, removePluginSkills, isPluginSkill.
 */

// ── hoisted mocks ───────────────────────────────────────────────────────────

const {
  mockAddSkill,
  mockDeleteInstalledSkill,
  mockExistsSync,
  mockMkdirSync,
  mockLstatSync,
  mockReadlinkSync,
  mockUnlinkSync,
  mockRmSync,
  mockSymlinkSync,
  mockGetPath,
} = vi.hoisted(() => {
  return {
    mockAddSkill: vi.fn(),
    mockDeleteInstalledSkill: vi.fn(),
    mockExistsSync: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockLstatSync: vi.fn(),
    mockReadlinkSync: vi.fn(),
    mockUnlinkSync: vi.fn(),
    mockRmSync: vi.fn(),
    mockSymlinkSync: vi.fn(),
    mockGetPath: vi.fn().mockReturnValue('/userData'),
  };
});

vi.mock('../../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('electron', () => ({
  app: { getPath: mockGetPath },
}));

vi.mock('../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: { addSkill: mockAddSkill },
}));

vi.mock('../../../skill/deleteInstalledSkill', () => ({
  deleteInstalledSkill: mockDeleteInstalledSkill,
}));

vi.mock('../../../skill/skillManager', () => ({
  skillManager: {},
}));

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    lstatSync: (...args: any[]) => mockLstatSync(...args),
    readlinkSync: (...args: any[]) => mockReadlinkSync(...args),
    unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
    rmSync: (...args: any[]) => mockRmSync(...args),
    symlinkSync: (...args: any[]) => mockSymlinkSync(...args),
  },
  existsSync: (...args: any[]) => mockExistsSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  lstatSync: (...args: any[]) => mockLstatSync(...args),
  readlinkSync: (...args: any[]) => mockReadlinkSync(...args),
  unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
  rmSync: (...args: any[]) => mockRmSync(...args),
  symlinkSync: (...args: any[]) => mockSymlinkSync(...args),
}));

// ── Import SUT after mocks ──────────────────────────────────────────────────

import { injectPluginSkills, removePluginSkills, isPluginSkill } from '../skillBridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(id = 'my-plugin', skillPaths: string[] = [], injectedSkills: string[] = []): any {
  return {
    id,
    manifest: { name: id, version: '1.2.0', description: 'Test', author: { name: 'T' } },
    path: `/plugins/packages/${id}`,
    enabled: true,
    resolvedSkillPaths: skillPaths,
    injectedSkills,
    injectedMcpServers: [],
  };
}

// ---------------------------------------------------------------------------
// Tests: isPluginSkill
// ---------------------------------------------------------------------------

describe('isPluginSkill', () => {
  it('returns true for plugin-namespaced skills', () => {
    expect(isPluginSkill('plugin--my-plugin--greet')).toBe(true);
  });

  it('returns false for regular skills', () => {
    expect(isPluginSkill('greet')).toBe(false);
    expect(isPluginSkill('my-skill')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPluginSkill('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: injectPluginSkills
// ---------------------------------------------------------------------------

describe('injectPluginSkills', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
    mockLstatSync.mockReset();
    mockReadlinkSync.mockReset();
    mockUnlinkSync.mockReset();
    mockSymlinkSync.mockReset();
    mockAddSkill.mockReset();
    mockGetPath.mockReturnValue('/userData');
  });

  it('returns empty array when plugin has no skill paths', async () => {
    const plugin = makePlugin('p', []);
    // User skills dir does not exist
    mockExistsSync.mockReturnValue(false);
    const result = await injectPluginSkills(plugin, 'alice');
    expect(result).toEqual([]);
  });

  it('skips skill paths that do not exist on disk', async () => {
    const plugin = makePlugin('p', ['/plugins/packages/p/skills/greet']);
    // skills dir exists; skill path does not
    mockExistsSync.mockImplementation((p: string) => p.includes('/userData/') ? false : false);
    const result = await injectPluginSkills(plugin, 'alice');
    expect(result).toEqual([]);
  });

  it('creates user skills dir if missing', async () => {
    const plugin = makePlugin('p', ['/plugins/packages/p/skills/greet']);
    // userSkillsDir missing, skillDir exists
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes('userData')) return false;
      return true; // skill dir exists
    });
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false });
    mockAddSkill.mockResolvedValue(undefined);

    await injectPluginSkills(plugin, 'alice');
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('alice/skills'), expect.any(Object));
  });

  it('creates symlink and registers skill when path is new', async () => {
    const plugin = makePlugin('p', ['/plugins/packages/p/skills/greet']);
    mockExistsSync.mockImplementation((p: string) => {
      // userSkillsDir exists; linkPath does not
      if (p.includes('plugin--p--greet')) return false;
      return true;
    });
    mockAddSkill.mockResolvedValue(undefined);

    const result = await injectPluginSkills(plugin, 'alice');
    expect(mockSymlinkSync).toHaveBeenCalledWith(
      '/plugins/packages/p/skills/greet',
      expect.stringContaining('plugin--p--greet'),
      'junction',
    );
    expect(mockAddSkill).toHaveBeenCalled();
    expect(result).toEqual(['plugin--p--greet']);
  });

  it('skips re-creating symlink when it already points to the correct target', async () => {
    const plugin = makePlugin('p', ['/plugins/packages/p/skills/greet']);
    mockExistsSync.mockReturnValue(true);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true });
    // readlink returns same path as target
    mockReadlinkSync.mockReturnValue('/plugins/packages/p/skills/greet');
    mockAddSkill.mockResolvedValue(undefined);

    await injectPluginSkills(plugin, 'alice');
    expect(mockSymlinkSync).not.toHaveBeenCalled();
    expect(mockAddSkill).toHaveBeenCalled();
  });

  it('removes stale symlink and re-creates when pointing elsewhere', async () => {
    const plugin = makePlugin('p', ['/plugins/packages/p/skills/greet']);
    mockExistsSync.mockReturnValue(true);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true });
    mockReadlinkSync.mockReturnValue('/old/location');
    mockAddSkill.mockResolvedValue(undefined);

    await injectPluginSkills(plugin, 'alice');
    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockSymlinkSync).toHaveBeenCalled();
  });

  it('removes real directory (old copy-based artifact) before creating symlink', async () => {
    const plugin = makePlugin('p', ['/plugins/packages/p/skills/greet']);
    mockExistsSync.mockReturnValue(true);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false });
    mockAddSkill.mockResolvedValue(undefined);

    await injectPluginSkills(plugin, 'alice');
    expect(mockRmSync).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
    expect(mockSymlinkSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: removePluginSkills
// ---------------------------------------------------------------------------

describe('removePluginSkills', () => {
  beforeEach(() => {
    mockDeleteInstalledSkill.mockReset();
  });

  it('calls deleteInstalledSkill for each injected skill', async () => {
    const plugin = makePlugin('p', [], ['plugin--p--greet', 'plugin--p--farewell']);
    mockDeleteInstalledSkill.mockResolvedValue({ success: true });

    await removePluginSkills(plugin, 'alice');
    expect(mockDeleteInstalledSkill).toHaveBeenCalledTimes(2);
    expect(mockDeleteInstalledSkill).toHaveBeenCalledWith('alice', 'plugin--p--greet', { pluginBypass: true });
    expect(mockDeleteInstalledSkill).toHaveBeenCalledWith('alice', 'plugin--p--farewell', { pluginBypass: true });
  });

  it('does nothing when there are no injected skills', async () => {
    const plugin = makePlugin('p', [], []);
    await removePluginSkills(plugin, 'alice');
    expect(mockDeleteInstalledSkill).not.toHaveBeenCalled();
  });

  it('continues removing remaining skills when one fails', async () => {
    const plugin = makePlugin('p', [], ['plugin--p--s1', 'plugin--p--s2']);
    mockDeleteInstalledSkill
      .mockResolvedValueOnce({ success: false, error: 'not found' })
      .mockResolvedValueOnce({ success: true });

    await removePluginSkills(plugin, 'alice');
    expect(mockDeleteInstalledSkill).toHaveBeenCalledTimes(2);
  });

  it('handles deleteInstalledSkill throwing without propagating', async () => {
    const plugin = makePlugin('p', [], ['plugin--p--bad']);
    mockDeleteInstalledSkill.mockRejectedValue(new Error('disk error'));

    // Should not throw
    await expect(removePluginSkills(plugin, 'alice')).resolves.toBeUndefined();
  });
});
