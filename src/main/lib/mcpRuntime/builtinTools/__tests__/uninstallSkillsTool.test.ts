const mockDeleteInstalledSkill = vi.fn();
const mockGetCachedProfile = vi.fn();
const mockGetSkills = vi.fn();
const mockGetSkill = vi.fn();
const mockHasSkill = vi.fn();
let mockCurrentUserAlias: string | null = 'tester';

vi.mock('../../../skill/deleteInstalledSkill', async () => ({
  deleteInstalledSkill: (...args: unknown[]) => mockDeleteInstalledSkill(...args),
}));

vi.mock('../../../userDataADO', async () => ({
  profileCacheManager: {
    get currentUserAlias() {
      return mockCurrentUserAlias;
    },
    getCachedProfile: (...args: unknown[]) => mockGetCachedProfile(...args),
  },
}));

vi.mock('../../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: {
    getSkills: (...args: unknown[]) => mockGetSkills(...args),
    getSkill: (...args: unknown[]) => mockGetSkill(...args),
    hasSkill: (...args: unknown[]) => mockHasSkill(...args),
  },
}));

import { UninstallSkillsTool } from '../uninstallSkillsTool';

describe('UninstallSkillsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUserAlias = 'tester';
    mockGetCachedProfile.mockReturnValue({});
    mockGetSkills.mockReturnValue([
      { name: 'pptx', description: 'Presentation skill', version: '1.0.0', remoteVersion: '1.0.0', source: 'IN-LIBRARY' },
      { name: 'skill-creator', description: 'Create skills', version: '1.0.0', remoteVersion: '1.0.0', source: 'ON-DEVICE' },
    ]);
    mockGetSkill.mockReturnValue(undefined);
    mockHasSkill.mockReturnValue(false);
  });

  it('exposes a deprecated tool definition', () => {
    const def = UninstallSkillsTool.getDefinition();
    expect(def.name).toBe('uninstall_skills');
    expect(def.inputSchema.required).toEqual(['skill_names']);
  });

  it('rejects input that normalizes to no skill names', async () => {
    const result = await UninstallSkillsTool.execute({ skill_names: ['  ', undefined as unknown as string] });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
    expect(mockDeleteInstalledSkill).not.toHaveBeenCalled();
  });

  it('rejects when no user session is active', async () => {
    mockCurrentUserAlias = null;

    const result = await UninstallSkillsTool.execute({ skill_names: ['pptx'] });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_USER_SESSION');
  });

  it('rejects when the current profile is not cached', async () => {
    mockGetCachedProfile.mockReturnValue(null);

    const result = await UninstallSkillsTool.execute({ skill_names: ['pptx'] });

    expect(result.success).toBe(false);
    expect(result.error).toBe('PROFILE_NOT_FOUND');
  });

  it('uninstalls multiple skills and pluralizes the success message', async () => {
    mockDeleteInstalledSkill.mockResolvedValue({ success: true });

    const result = await UninstallSkillsTool.execute({ skill_names: ['pptx', 'skill-creator'] });

    expect(result.success).toBe(true);
    expect(result.uninstalled_count).toBe(2);
    expect(result.message).toContain('Uninstalled 2 skills');
    expect(result.error).toBeUndefined();
  });

  it('reports PARTIAL_FAILURE when some deletes succeed and others fail', async () => {
    mockDeleteInstalledSkill.mockImplementation(async (_alias: string, skillName: string) =>
      skillName === 'pptx' ? { success: true } : { success: false, error: 'DELETE_PROFILE_FAILED' },
    );

    const result = await UninstallSkillsTool.execute({ skill_names: ['pptx', 'skill-creator'] });

    expect(result.success).toBe(false);
    expect(result.error).toBe('PARTIAL_FAILURE');
    expect(result.uninstalled_skills).toEqual(['pptx']);
    expect(result.skipped_skills).toEqual([{ skill_name: 'skill-creator', reason: 'DELETE_FAILED' }]);
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