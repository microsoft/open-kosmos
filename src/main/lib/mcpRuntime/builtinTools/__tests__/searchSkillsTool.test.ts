/**
 * Unit tests for SearchSkillsTool
 *
 * Covers four search sources: installed skills, Skill Library, ClawHub, GitHub repos.
 * All sources run in parallel. Verifies ordering, deduplication, applied status,
 * and error resilience.
 */

// ---------- dependency mocks ----------

const mockGetLibraryData = vi.fn();
vi.mock('../../../skill/skillLibraryFetcher', async () => ({
  SkillLibraryFetcher: {
    getInstance: () => ({ getLibraryData: mockGetLibraryData }),
  },
}));

const mockSearchGitHubSkills = vi.fn();
vi.mock('../../../skill/githubSkillSearcher', async () => ({
  searchGitHubSkills: (...args: unknown[]) => mockSearchGitHubSkills(...args),
}));

const mockSearchClawHubSkills = vi.fn();
vi.mock('../../../skill/clawHubSkillSearcher', async () => ({
  searchClawHubSkills: (...args: unknown[]) => mockSearchClawHubSkills(...args),
}));

const mockGetCachedProfile = vi.fn();
const mockGetChatConfig = vi.fn();
vi.mock('../../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getCachedProfile: (...args: unknown[]) => mockGetCachedProfile(...args),
    getChatConfig: (...args: unknown[]) => mockGetChatConfig(...args),
  },
}));

let mockExecutionContext: any = null;
vi.mock('../builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    getExecutionContext: () => mockExecutionContext,
  },
}));

// Import after mocks are set up
import { SearchSkillsTool } from '../searchSkillsTool';

// ---------- helpers ----------

function setExecutionContext(userAlias = 'test-user', chatId = 'chat-1') {
  mockExecutionContext = { chatId, userAlias, chatSessionId: 'session-1' };
}

function profileWithSkills(skills: Array<{ name: string; description: string; version: string; source: 'IN-LIBRARY' | 'ON-DEVICE' }>) {
  return { skills };
}

// ---------- setup ----------

beforeEach(() => {
  vi.clearAllMocks();
  mockExecutionContext = null;
  mockGetLibraryData.mockResolvedValue({ success: false });
  mockSearchGitHubSkills.mockResolvedValue([]);
  mockSearchClawHubSkills.mockResolvedValue([]);
  mockGetCachedProfile.mockReturnValue(null);
  mockGetChatConfig.mockReturnValue(null);
});

// ---------- getDefinition ----------

describe('SearchSkillsTool.getDefinition', () => {
  it('returns correct tool name and schema', () => {
    const def = SearchSkillsTool.getDefinition();
    expect(def.name).toBe('search_skills');
    expect(def.inputSchema.required).toContain('query');
  });
});

// ---------- input validation ----------

describe('input validation', () => {
  it.each([
    { label: 'missing query', args: {} },
    { label: 'empty string', args: { query: '' } },
    { label: 'whitespace only', args: { query: '   ' } },
    { label: 'non-string', args: { query: 123 } },
  ])('rejects $label', async ({ args }) => {
    const result = await SearchSkillsTool.execute(args as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });
});

// ---------- installed skills source ----------

describe('installed skills search', () => {
  it('returns installed skills matching by name', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'code-review', description: 'Review code', version: '1.0.0', source: 'IN-LIBRARY' },
      { name: 'web-search', description: 'Search the web', version: '2.0.0', source: 'ON-DEVICE' },
    ]));

    const result = await SearchSkillsTool.execute({ query: 'code' });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe('installed');
    expect(result.results[0].metadata.name).toBe('code-review');
    expect(result.results[0].metadata.install_source).toBe('IN-LIBRARY');
  });

  it('returns installed skills matching by description', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'my-tool', description: 'Analyzes pull requests', version: '1.0.0', source: 'ON-DEVICE' },
    ]));

    const result = await SearchSkillsTool.execute({ query: 'pull request' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].metadata.name).toBe('my-tool');
  });

  it('marks applied_to_current_agent correctly', async () => {
    setExecutionContext('test-user', 'chat-1');
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'skill-A', description: 'Skill A', version: '1.0.0', source: 'IN-LIBRARY' },
      { name: 'skill-B', description: 'Skill B', version: '1.0.0', source: 'IN-LIBRARY' },
    ]));
    mockGetChatConfig.mockReturnValue({
      agent: { skills: ['skill-A'] },
    });

    const result = await SearchSkillsTool.execute({ query: 'skill' });

    expect(result.results).toHaveLength(2);
    const skillA = result.results.find(r => r.metadata.name === 'skill-A');
    const skillB = result.results.find(r => r.metadata.name === 'skill-B');
    expect(skillA?.metadata.applied_to_current_agent).toBe(true);
    expect(skillB?.metadata.applied_to_current_agent).toBe(false);
  });

  it('handles no execution context gracefully', async () => {
    // No execution context set — installed search should be skipped silently
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'lib-skill', description: 'From library', version: '1.0.0', contact: 'x' }] },
    });

    const result = await SearchSkillsTool.execute({ query: 'lib' });

    expect(result.success).toBe(true);
    // Should still get library results
    expect(result.results.some(r => r.source === 'library')).toBe(true);
    // No installed results
    expect(result.results.some(r => r.source === 'installed')).toBe(false);
  });

  it('handles profile with no skills array', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue({ /* no skills field */ });

    const result = await SearchSkillsTool.execute({ query: 'anything' });

    expect(result.success).toBe(true);
    expect(result.results.filter(r => r.source === 'installed')).toHaveLength(0);
  });
});

// ---------- library source ----------

describe('library search', () => {
  it('returns library skills matching query', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: {
        skills: [
          { name: 'code-review', description: 'Review code changes', version: '2.0.0', contact: 'team@test.com' },
          { name: 'deploy-tool', description: 'Deploy apps', version: '1.0.0', contact: 'ops@test.com' },
        ],
      },
    });

    const result = await SearchSkillsTool.execute({ query: 'review' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe('library');
    expect(result.results[0].metadata.name).toBe('code-review');
    expect(result.results[0].metadata.contact).toBe('team@test.com');
  });

  it('deduplicates library results against installed skills', async () => {
    setExecutionContext();
    // Same skill name installed and in library
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'code-review', description: 'Review code', version: '1.0.0', source: 'IN-LIBRARY' },
    ]));
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: {
        skills: [
          { name: 'code-review', description: 'Review code changes', version: '2.0.0', contact: 'team@test.com' },
          { name: 'code-gen', description: 'Generate code', version: '1.0.0', contact: 'dev@test.com' },
        ],
      },
    });

    const result = await SearchSkillsTool.execute({ query: 'code' });

    // 'code-review' should only appear once (as installed), 'code-gen' as library
    const installed = result.results.filter(r => r.source === 'installed');
    const library = result.results.filter(r => r.source === 'library');
    expect(installed).toHaveLength(1);
    expect(installed[0].metadata.name).toBe('code-review');
    expect(library).toHaveLength(1);
    expect(library[0].metadata.name).toBe('code-gen');
  });
});

// ---------- github source ----------

describe('github search', () => {
  it('returns github skills', async () => {
    mockSearchGitHubSkills.mockResolvedValue([
      { name: 'gh-skill', description: 'From GitHub', url: 'https://github.com/repo/gh-skill', repo: 'test/repo', local_folder: '/tmp/gh-skill' },
    ]);

    const result = await SearchSkillsTool.execute({ query: 'gh' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe('github');
    expect(result.results[0].metadata.local_folder).toBe('/tmp/gh-skill');
    expect(result.results[0].metadata.repo).toBe('test/repo');
  });
});

// ---------- ordering ----------

describe('result ordering', () => {
  it('returns installed → library → clawhub → github', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'search-tool', description: 'A search tool', version: '1.0.0', source: 'ON-DEVICE' },
    ]));
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: {
        skills: [
          { name: 'search-lib', description: 'Library search skill', version: '1.0.0', contact: 'a' },
        ],
      },
    });
    mockSearchClawHubSkills.mockResolvedValue([
      { name: 'search-claw', slug: 'search-claw', description: 'ClawHub search skill', version: '1.0.0', score: 3.5, url: 'https://clawhub.ai/skills/search-claw', local_folder: '/tmp/claw' },
    ]);
    mockSearchGitHubSkills.mockResolvedValue([
      { name: 'search-gh', description: 'GitHub search skill', url: 'u', repo: 'r', local_folder: '/tmp/x' },
    ]);

    const result = await SearchSkillsTool.execute({ query: 'search' });

    expect(result.results).toHaveLength(4);
    expect(result.results[0].source).toBe('installed');
    expect(result.results[1].source).toBe('library');
    expect(result.results[2].source).toBe('clawhub');
    expect(result.results[3].source).toBe('github');
  });
});

// ---------- error resilience ----------

describe('error resilience', () => {
  it('returns library+github results when installed source throws', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockImplementation(() => { throw new Error('DB error'); });
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'lib-s', description: 'Lib', version: '1.0.0', contact: '' }] },
    });

    const result = await SearchSkillsTool.execute({ query: 'lib' });

    expect(result.success).toBe(true);
    expect(result.results.some(r => r.source === 'library')).toBe(true);
    expect(result.results.some(r => r.source === 'installed')).toBe(false);
  });

  it('returns installed+github results when library throws', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'my-skill', description: 'Test', version: '1.0.0', source: 'ON-DEVICE' },
    ]));
    mockGetLibraryData.mockRejectedValue(new Error('CDN down'));
    mockSearchGitHubSkills.mockResolvedValue([
      { name: 'my-gh', description: 'GH skill test', url: 'u', repo: 'r', local_folder: '/tmp/g' },
    ]);

    const result = await SearchSkillsTool.execute({ query: 'my' });

    expect(result.success).toBe(true);
    expect(result.results.some(r => r.source === 'installed')).toBe(true);
    expect(result.results.some(r => r.source === 'github')).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('CDN down')]));
  });

  it('returns installed+library results when github throws', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'demo', description: 'A demo skill', version: '1.0.0', source: 'IN-LIBRARY' },
    ]));
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'demo-lib', description: 'Demo from lib', version: '1.0.0', contact: '' }] },
    });
    mockSearchGitHubSkills.mockRejectedValue(new Error('rate limited'));

    const result = await SearchSkillsTool.execute({ query: 'demo' });

    expect(result.success).toBe(true);
    expect(result.results.some(r => r.source === 'installed')).toBe(true);
    expect(result.results.some(r => r.source === 'library')).toBe(true);
    expect(result.results.some(r => r.source === 'github')).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('rate limited')]));
  });

  it('returns empty when all sources fail', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockImplementation(() => { throw new Error('err'); });
    mockGetLibraryData.mockRejectedValue(new Error('err'));
    mockSearchClawHubSkills.mockRejectedValue(new Error('err'));
    mockSearchGitHubSkills.mockRejectedValue(new Error('err'));

    const result = await SearchSkillsTool.execute({ query: 'anything' });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.total_count).toBe(0);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThanOrEqual(3);
    expect(result.message).toContain('Some sources failed');
  });
});

// ---------- no matches ----------

describe('no matches', () => {
  it('returns success with zero results when nothing matches', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'alpha', description: 'Alpha skill', version: '1.0.0', source: 'IN-LIBRARY' },
    ]));
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'beta', description: 'Beta skill', version: '1.0.0', contact: '' }] },
    });
    mockSearchGitHubSkills.mockResolvedValue([]);

    const result = await SearchSkillsTool.execute({ query: 'zzzzz' });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.message).toContain('No skills found');
  });
});

// ---------- case insensitive ----------

describe('case-insensitive matching', () => {
  it('matches installed skill name regardless of case', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'Code-Review', description: 'Reviews code', version: '1.0.0', source: 'IN-LIBRARY' },
    ]));

    const result = await SearchSkillsTool.execute({ query: 'CODE-REVIEW' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].metadata.name).toBe('Code-Review');
  });

  it('matches library skill description regardless of case', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'tool', description: 'Generates TypeScript Code', version: '1.0.0', contact: '' }] },
    });

    const result = await SearchSkillsTool.execute({ query: 'typescript' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe('library');
  });
});

// ---------- clawhub source ----------

describe('clawhub search', () => {
  it('returns clawhub skills with metadata', async () => {
    mockSearchClawHubSkills.mockResolvedValue([
      { name: 'pptx-tool', slug: 'pptx-tool', description: 'Create PPTX files', version: '1.0.1', score: 3.8, url: 'https://clawhub.ai/skills/pptx-tool', local_folder: '/tmp/clawhub/pptx-tool' },
    ]);

    const result = await SearchSkillsTool.execute({ query: 'pptx' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe('clawhub');
    expect(result.results[0].metadata.name).toBe('pptx-tool');
    expect(result.results[0].metadata.url).toBe('https://clawhub.ai/skills/pptx-tool');
    expect(result.results[0].metadata.local_folder).toBe('/tmp/clawhub/pptx-tool');
    expect(result.results[0].metadata.score).toBe(3.8);
  });

  it('deduplicates clawhub results against installed and library', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'shared-skill', description: 'Shared skill', version: '1.0.0', source: 'IN-LIBRARY' },
    ]));
    mockSearchClawHubSkills.mockResolvedValue([
      { name: 'shared-skill', slug: 'shared-skill', description: 'Shared skill from ClawHub', version: '2.0.0', score: 3.0, url: 'https://clawhub.ai/skills/shared-skill', local_folder: '/tmp/claw' },
      { name: 'unique-claw', slug: 'unique-claw', description: 'Only on ClawHub', version: '1.0.0', score: 2.5, url: 'https://clawhub.ai/skills/unique-claw', local_folder: '/tmp/claw2' },
    ]);

    const result = await SearchSkillsTool.execute({ query: 'skill' });

    const clawhubResults = result.results.filter(r => r.source === 'clawhub');
    expect(clawhubResults).toHaveLength(1);
    expect(clawhubResults[0].metadata.name).toBe('unique-claw');
  });

  it('continues when clawhub search fails', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'local-skill', description: 'A local skill', version: '1.0.0', source: 'ON-DEVICE' },
    ]));
    mockSearchClawHubSkills.mockRejectedValue(new Error('ClawHub timeout'));

    const result = await SearchSkillsTool.execute({ query: 'local' });

    expect(result.success).toBe(true);
    expect(result.results.some(r => r.source === 'installed')).toBe(true);
    expect(result.results.some(r => r.source === 'clawhub')).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('ClawHub timeout')]));
  });
});

// ---------- parallel execution ----------

describe('parallel execution', () => {
  it('all four sources run concurrently', async () => {
    setExecutionContext();
    mockGetCachedProfile.mockReturnValue(profileWithSkills([
      { name: 'inst-a', description: 'Installed A', version: '1.0.0', source: 'ON-DEVICE' },
    ]));
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'lib-a', description: 'Library A', version: '1.0.0', contact: '' }] },
    });
    mockSearchClawHubSkills.mockResolvedValue([
      { name: 'claw-a', slug: 'claw-a', description: 'ClawHub A', version: '1.0.0', score: 3.0, url: 'u', local_folder: '/tmp/c' },
    ]);
    mockSearchGitHubSkills.mockResolvedValue([
      { name: 'gh-a', description: 'GitHub A', url: 'u', repo: 'r', local_folder: '/tmp/g' },
    ]);

    const result = await SearchSkillsTool.execute({ query: 'a' });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(4);
    expect(result.results.map(r => r.source)).toEqual(['installed', 'library', 'clawhub', 'github']);
  });
});
