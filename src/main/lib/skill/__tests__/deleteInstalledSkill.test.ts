const mockDeleteSkill = vi.fn();
const mockExistsSync = vi.fn();
const mockRmSync = vi.fn();
const mockLstatSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockGetPath = vi.fn();

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    deleteSkill: (...args: unknown[]) => mockDeleteSkill(...args),
  },
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  isBuiltinSkill: (skillName: string) => skillName === 'skill-creator',
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: 1,
  BUILTIN_SKILL_CHANGELOG: { 1: ['skill-creator'] },
}));

vi.mock('../../plugin/bridges/skillBridge', async () => ({
  isPluginSkill: vi.fn(() => false),
}));

vi.mock('fs', async () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  lstatSync: (...args: unknown[]) => mockLstatSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

vi.mock('electron', async () => ({
  app: {
    getPath: (...args: unknown[]) => mockGetPath(...args),
  },
}));

import { deleteInstalledSkill } from '../deleteInstalledSkill';

describe('deleteInstalledSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPath.mockReturnValue('/tmp/user-data');
    mockExistsSync.mockReturnValue(true);
    mockRmSync.mockImplementation(() => undefined);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false });
  });

  it('deletes from profile and removes the skill directory when present', async () => {
    mockDeleteSkill.mockResolvedValue(true);

    const result = await deleteInstalledSkill('tester', 'pptx');

    expect(result.success).toBe(true);
    expect(mockDeleteSkill).toHaveBeenCalledWith('tester', 'pptx');
    // lstatSync should be called to check for symlinks before removal
    expect(mockLstatSync).toHaveBeenCalled();
    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining('profiles/tester/skills/pptx'.replace(/\//g, require('path').sep)),
      { recursive: true, force: true },
    );
  });

  it('does not allow builtin skills to be deleted', async () => {
    const result = await deleteInstalledSkill('tester', 'skill-creator');

    expect(result.success).toBe(false);
    expect(result.error).toBe('BUILTIN_SKILL');
    expect(mockDeleteSkill).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('stops when profile deletion fails', async () => {
    mockDeleteSkill.mockResolvedValue(false);

    const result = await deleteInstalledSkill('tester', 'pptx');

    expect(result.success).toBe(false);
    expect(result.error).toBe('DELETE_PROFILE_FAILED');
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('returns success even when the skill directory is already missing', async () => {
    mockDeleteSkill.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);

    const result = await deleteInstalledSkill('tester', 'pptx');

    expect(result.success).toBe(true);
    expect(result.removedFromDisk).toBe(false);
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});