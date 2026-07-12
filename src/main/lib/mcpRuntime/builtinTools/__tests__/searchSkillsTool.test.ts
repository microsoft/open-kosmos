const mockGetCachedProfile = vi.fn();
const mockGetChatConfig = vi.fn();
const mockGetSkills = vi.fn();

vi.mock('../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedProfile: (...args: unknown[]) => mockGetCachedProfile(...args),
    getChatConfig: (...args: unknown[]) => mockGetChatConfig(...args),
  },
}));

vi.mock('../../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: {
    getSkills: (...args: unknown[]) => mockGetSkills(...args),
  },
}));

let executionContext: { userAlias: string; chatId?: string } | null = null;
vi.mock('../builtinToolsManager', () => ({
  BuiltinToolsManager: {
    getExecutionContext: () => executionContext,
  },
}));

import { SearchSkillsTool } from '../searchSkillsTool';

describe('SearchSkillsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executionContext = { userAlias: 'user', chatId: 'chat' };
    mockGetCachedProfile.mockReturnValue({});
    mockGetChatConfig.mockReturnValue({ agent: { skills: ['legacy-skill'] } });
    mockGetSkills.mockReturnValue([
      {
        name: 'legacy-skill',
        description: 'Installed from an older profile',
        version: '1.0.0',
        source: 'IN-LIBRARY',
        remoteVersion: '9.0.0',
      },
      {
        name: 'local-tool',
        description: 'Local helper',
        version: '2.0.0',
        source: 'ON-DEVICE',
      },
    ]);
  });

  it('defines an installed-only search tool', () => {
    const definition = SearchSkillsTool.getDefinition();
    expect(definition.name).toBe('search_skills');
    expect(definition.description).toContain('installed on this device');
  });

  it.each([undefined, '', '   ', 42])('rejects invalid query %p', async query => {
    const result = await SearchSkillsTool.execute({ query } as any);
    expect(result).toMatchObject({ success: false, error: 'INVALID_INPUT', results: [] });
  });

  it('rejects execution without an active user', async () => {
    executionContext = null;
    const result = await SearchSkillsTool.execute({ query: 'skill' });
    expect(result.error).toBe('NO_USER');
  });

  it('rejects execution without a loaded profile', async () => {
    mockGetCachedProfile.mockReturnValue(null);
    const result = await SearchSkillsTool.execute({ query: 'skill' });
    expect(result.error).toBe('NO_PROFILE');
  });

  it('searches local records and treats legacy metadata as inert', async () => {
    const result = await SearchSkillsTool.execute({ query: 'OLDER' });
    expect(result).toMatchObject({ success: true, total_count: 1 });
    expect(result.results[0]).toEqual({
      source: 'installed',
      metadata: {
        name: 'legacy-skill',
        description: 'Installed from an older profile',
        version: '1.0.0',
        applied_to_current_agent: true,
      },
    });
  });

  it('searches by name without requiring a chat context', async () => {
    executionContext = { userAlias: 'user' };
    const result = await SearchSkillsTool.execute({ query: 'local' });
    expect(result.results[0].metadata.applied_to_current_agent).toBe(false);
  });

  it('returns an empty successful result', async () => {
    mockGetSkills.mockReturnValue([]);
    const result = await SearchSkillsTool.execute({ query: 'missing' });
    expect(result).toMatchObject({ success: true, total_count: 0, results: [] });
  });
});
