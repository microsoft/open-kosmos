const mockDeleteInstalledSkill = vi.fn();
const mockGetCachedProfile = vi.fn();

vi.mock('../../../skill/deleteInstalledSkill', async () => ({
  deleteInstalledSkill: (...args: unknown[]) => mockDeleteInstalledSkill(...args),
}));

vi.mock('../../../userDataADO', async () => ({
  profileCacheManager: {
    currentUserAlias: 'tester',
    getCachedProfile: (...args: unknown[]) => mockGetCachedProfile(...args),
  },
}));

import { UninstallSkillsTool } from '../uninstallSkillsTool';

describe('UninstallSkillsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedProfile.mockReturnValue({
      skills: [
        { name: 'pptx' },
        { name: 'skill-creator' },
      ],
    });
  });

  it('uninstalls removable skills and preserves builtin or missing entries as skipped', async () => {
    mockDeleteInstalledSkill.mockImplementation(async (_alias: string, skillName: string) => {
      if (skillName === 'skill-creator') {
        return { success: false, error: 'BUILTIN_SKILL' };
      }

      return { success: true };
    });

    const result = await UninstallSkillsTool.execute({
      skill_names: ['pptx', 'skill-creator', 'missing'],
    });

    expect(result.success).toBe(true);
    expect(mockDeleteInstalledSkill).toHaveBeenCalledWith('tester', 'pptx');
    expect(mockDeleteInstalledSkill).toHaveBeenCalledWith('tester', 'skill-creator');
    expect(result.uninstalled_skills).toEqual(['pptx']);
    expect(result.skipped_skills).toEqual([
      { skill_name: 'skill-creator', reason: 'BUILTIN_SKILL' },
      { skill_name: 'missing', reason: 'NOT_INSTALLED' },
    ]);
  });

  it('returns partial failure when a delete attempt fails', async () => {
    mockDeleteInstalledSkill.mockResolvedValue({ success: false, error: 'DELETE_PROFILE_FAILED' });

    const result = await UninstallSkillsTool.execute({
      skill_names: ['pptx'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_SKILLS_UNINSTALLED');
    expect(result.skipped_skills).toEqual([
      { skill_name: 'pptx', reason: 'DELETE_FAILED' },
    ]);
  });
});