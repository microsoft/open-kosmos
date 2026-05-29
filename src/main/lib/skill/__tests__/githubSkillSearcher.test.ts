import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { searchGitHubSkills, clearLocalIndexCache } from '../githubSkillSearcher';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

vi.mock('jszip', () => ({ default: { loadAsync: vi.fn() } }));

vi.mock('../skillManager', () => ({
  skillManager: {
    parseSkillMarkdown: vi.fn((content: string) => {
      const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!match) return { metadata: null };
      const lines = match[1].split('\n');
      const meta: Record<string, string> = {};
      for (const line of lines) {
        const [k, ...rest] = line.split(':');
        if (k && rest.length) meta[k.trim()] = rest.join(':').trim().replace(/^"(.*)"$/, '$1');
      }
      return { metadata: meta.name ? meta : null };
    }),
  },
}));

// Stub ensureRepoLocal so searchGitHubSkills uses our temp dirs instead of downloading
let repoLocalDirs: Map<string, string>;

vi.mock('https', () => ({ get: vi.fn() }));

function createSkillDir(root: string, skillName: string, description: string): string {
  const dir = path.join(root, skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: "${description}"\n---\nBody`,
    'utf-8',
  );
  return dir;
}

function createTimestamp(root: string): void {
  fs.writeFileSync(path.join(root, '.download-timestamp'), String(Date.now()), 'utf-8');
}

describe('githubSkillSearcher', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-skill-test-'));
    repoLocalDirs = new Map();
    clearLocalIndexCache();
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function setupRepo(owner: string, repo: string, skills: Array<{ name: string; desc: string }>): string {
    const repoDir = path.join(tempRoot, `${owner}__${repo}`);
    fs.mkdirSync(repoDir, { recursive: true });
    createTimestamp(repoDir);
    for (const s of skills) {
      createSkillDir(repoDir, s.name, s.desc);
    }
    // Point getReposRoot to our temp dir so repoLocalDir resolves correctly
    repoLocalDirs.set(`${owner}/${repo}`, repoDir);
    return repoDir;
  }

  describe('indexLocalRepo (via searchGitHubSkills)', () => {
    it('finds skills by folder name match', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      createSkillDir(repoDir, 'web-search', 'Search the web');
      createSkillDir(repoDir, 'file-reader', 'Read files');

      // Mock electron app.getPath to return our tempRoot so repoLocalDir resolves
      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results = await searchGitHubSkills('web-search', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('web-search');
    });

    it('finds skills by description match', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      createSkillDir(repoDir, 'my-tool', 'Automate browser testing');
      createSkillDir(repoDir, 'other-tool', 'Something else');

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results = await searchGitHubSkills('browser testing', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('my-tool');
      expect(results[0].description).toBe('Automate browser testing');
    });

    it('skips hidden directories', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      createSkillDir(path.join(repoDir, '.hidden'), 'secret-skill', 'Hidden skill');
      createSkillDir(repoDir, 'visible-skill', 'Visible skill');

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results = await searchGitHubSkills('skill', 10);
      const names = results.map(r => r.name);
      expect(names).toContain('visible-skill');
      expect(names).not.toContain('secret-skill');
    });

    it('skips node_modules directories', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      createSkillDir(path.join(repoDir, 'node_modules'), 'pkg-skill', 'From node_modules');
      createSkillDir(repoDir, 'real-skill', 'A real skill');

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results = await searchGitHubSkills('skill', 10);
      const names = results.map(r => r.name);
      expect(names).toContain('real-skill');
      expect(names).not.toContain('pkg-skill');
    });

    it('finds nested skills in subdirectories', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      createSkillDir(path.join(repoDir, 'category', 'subcategory'), 'deep-skill', 'Deeply nested');

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results = await searchGitHubSkills('deep-skill', 5);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('deep-skill');
    });

    it('uses in-memory cache on repeated calls', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      createSkillDir(repoDir, 'cached-skill', 'Cached');

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results1 = await searchGitHubSkills('cached-skill', 5);
      expect(results1.length).toBeGreaterThanOrEqual(1);

      // Remove the skill from disk — cache should still return it
      fs.rmSync(path.join(repoDir, 'cached-skill'), { recursive: true, force: true });

      const results2 = await searchGitHubSkills('cached-skill', 5);
      expect(results2.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('readLocalSkillDescription', () => {
    it('falls back to lowercase skill.md', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      const skillDir = path.join(repoDir, 'lowercase-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'skill.md'),
        '---\nname: lowercase-skill\ndescription: "Lowercase variant"\n---\n',
        'utf-8',
      );

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results = await searchGitHubSkills('lowercase variant', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].description).toBe('Lowercase variant');
    });

    it('returns empty string when no SKILL.md exists', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      const emptyDir = path.join(repoDir, 'empty-dir');
      fs.mkdirSync(emptyDir, { recursive: true });
      // No SKILL.md — this directory won't be indexed as a skill
      // so we expect 0 results
      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results = await searchGitHubSkills('empty-dir', 5);
      expect(results.length).toBe(0);
    });
  });

  describe('searchGitHubSkills', () => {
    it('respects maxResults and stops early', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      for (let i = 0; i < 10; i++) {
        createSkillDir(repoDir, `test-skill-${i}`, `Test skill number ${i}`);
      }

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      const results = await searchGitHubSkills('test-skill', 3);
      expect(results.length).toBe(3);
    });

    it('reuses cached description from matching phase', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      createSkillDir(repoDir, 'unique-name', 'Matches by unique description keyword');

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      // Search by description — should cache the description
      const results = await searchGitHubSkills('unique description keyword', 5);
      expect(results.length).toBe(1);
      expect(results[0].description).toBe('Matches by unique description keyword');
    });

    it('throws when all repos fail', async () => {
      const electron = await import('electron');
      // Point to a non-existent dir with no timestamp — ensureRepoLocal will try to download and fail
      vi.spyOn(electron.app, 'getPath').mockReturnValue(path.join(tempRoot, 'nonexistent'));

      clearLocalIndexCache();
      await expect(searchGitHubSkills('anything', 5)).rejects.toThrow('All GitHub skill repos failed');
    });

    it('returns partial results when one repo fails', async () => {
      const repoDir = path.join(tempRoot, 'github-skill-repos', 'anthropics__skills');
      fs.mkdirSync(repoDir, { recursive: true });
      createTimestamp(repoDir);
      createSkillDir(repoDir, 'partial-result', 'Works from one repo');

      const electron = await import('electron');
      vi.spyOn(electron.app, 'getPath').mockReturnValue(tempRoot);
      clearLocalIndexCache();

      // Second repo (sickn33) will fail because its dir doesn't exist and download is mocked
      const results = await searchGitHubSkills('partial-result', 5);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('partial-result');
    });
  });
});
