// @ts-nocheck
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

describe('deleteInstalledSkill — extended coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPath.mockReturnValue('/tmp/user-data');
    mockExistsSync.mockReturnValue(true);
    mockRmSync.mockImplementation(() => undefined);
    mockUnlinkSync.mockImplementation(() => undefined);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false });
  });

  it('removes symlink via unlinkSync instead of rmSync', async () => {
    mockDeleteSkill.mockResolvedValue(true);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true });

    const result = await deleteInstalledSkill('tester', 'pptx');

    expect(result.success).toBe(true);
    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('returns DELETE_FILES_FAILED when rmSync throws', async () => {
    mockDeleteSkill.mockResolvedValue(true);
    mockRmSync.mockImplementation(() => { throw new Error('Permission denied'); });

    const result = await deleteInstalledSkill('tester', 'pptx');

    expect(result.success).toBe(false);
    expect(result.error).toBe('DELETE_FILES_FAILED');
    expect(result.removedFromDisk).toBe(false);
  });
});
