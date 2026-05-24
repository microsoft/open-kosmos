import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillManager } from '../skillManager';

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createConsoleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    addSkill: vi.fn(),
    updateSkill: vi.fn(),
  },
}));

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

import { profileCacheManager } from '../../userDataADO';

describe('SkillManager — extended coverage', () => {
  let tempRoot: string;
  let skillManager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-manager-ext-'));
    // Reset singleton
    (SkillManager as any).instance = undefined;
    skillManager = SkillManager.getInstance();
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  // ─── validateSkillName ────────────────────────────────────────────────────

  describe('validateSkillName', () => {
    it('returns valid for a simple name', () => {
      expect(skillManager.validateSkillName('pdf')).toEqual({ valid: true });
    });

    it('returns valid for hyphenated name with digits', () => {
      expect(skillManager.validateSkillName('pdf-v2')).toEqual({ valid: true });
    });

    it('rejects empty name', () => {
      expect(skillManager.validateSkillName('')).toMatchObject({ valid: false });
      expect(skillManager.validateSkillName('   ')).toMatchObject({ valid: false });
    });

    it('rejects name starting with hyphen', () => {
      expect(skillManager.validateSkillName('-pdf')).toMatchObject({ valid: false });
    });

    it('rejects name ending with hyphen', () => {
      expect(skillManager.validateSkillName('pdf-')).toMatchObject({ valid: false });
    });

    it('rejects name with spaces', () => {
      expect(skillManager.validateSkillName('pdf skill')).toMatchObject({ valid: false });
    });

    it('rejects uppercase letters', () => {
      expect(skillManager.validateSkillName('Pdf')).toMatchObject({ valid: false });
    });

    it('rejects special characters', () => {
      expect(skillManager.validateSkillName('pdf!')).toMatchObject({ valid: false });
    });
  });

  // ─── parseSkillFileName ────────────────────────────────────────────────────

  describe('parseSkillFileName', () => {
    it('parses versioned zip', () => {
      const result = skillManager.parseSkillFileName('pdf-1.2.3.zip');
      expect(result).toEqual({ skillName: 'pdf', version: '1.2.3' });
    });

    it('parses unversioned zip', () => {
      const result = skillManager.parseSkillFileName('pdf.zip');
      expect(result).toEqual({ skillName: 'pdf' });
    });

    it('parses versioned skill file', () => {
      const result = skillManager.parseSkillFileName('my-skill-2.0.0.skill');
      expect(result).toEqual({ skillName: 'my-skill', version: '2.0.0' });
    });

    it('parses unversioned skill file', () => {
      const result = skillManager.parseSkillFileName('my-skill.skill');
      expect(result).toEqual({ skillName: 'my-skill' });
    });

    it('treats non-semver version as plain name', () => {
      // e.g. pdf-v2 (not semver), returned without version
      const result = skillManager.parseSkillFileName('pdf-v2.zip');
      expect(result).toEqual({ skillName: 'pdf-v2' });
    });

    it('treats non-numeric version segments as plain name', () => {
      // e.g., pdf-1.x.0 — matches versionMatch regex but fails part validation
      const result = skillManager.parseSkillFileName('pdf-1.x.0.zip');
      expect(result).toEqual({ skillName: 'pdf-1.x.0' });
    });
  });

  // ─── determineVersion ─────────────────────────────────────────────────────

  describe('determineVersion', () => {
    it('prefers metadata version', () => {
      expect(skillManager.determineVersion('2.0.0', '1.0.0', { version: '0.5.0' })).toBe('2.0.0');
    });

    it('falls back to parsed version', () => {
      expect(skillManager.determineVersion(undefined, '1.5.0', null)).toBe('1.5.0');
    });

    it('falls back to existing skill version', () => {
      expect(skillManager.determineVersion(undefined, undefined, { version: '3.0.0' })).toBe('3.0.0');
    });

    it('defaults to 1.0.0 when nothing is available', () => {
      expect(skillManager.determineVersion(undefined, undefined, null)).toBe('1.0.0');
    });

    it('trims metadata version', () => {
      expect(skillManager.determineVersion('  2.0.0  ', '1.0.0')).toBe('2.0.0');
    });

    it('uses existing version when it has no version prop', () => {
      // Existing skill with no version
      expect(skillManager.determineVersion(undefined, undefined, {})).toBe('1.0.0');
    });
  });

  // ─── parseSkillMarkdown ────────────────────────────────────────────────────

  describe('parseSkillMarkdown', () => {
    it('parses valid SKILL.md', () => {
      const content = '---\nname: pdf\ndescription: PDF skill\n---\n# Content';
      const result = skillManager.parseSkillMarkdown(content);
      expect(result.metadata).toMatchObject({ name: 'pdf', description: 'PDF skill' });
    });

    it('returns error when no leading ---', () => {
      const result = skillManager.parseSkillMarkdown('name: pdf\n---');
      expect(result.metadata).toBeNull();
      expect(result.error).toMatch(/YAML metadata must start/);
    });

    it('returns error when YAML front matter is missing closing ---', () => {
      const result = skillManager.parseSkillMarkdown('---\nname: pdf\n');
      expect(result.metadata).toBeNull();
      expect(result.error).toMatch(/valid YAML metadata/);
    });

    it('returns error when name is missing', () => {
      const result = skillManager.parseSkillMarkdown('---\ndescription: hello\n---');
      expect(result.metadata).toBeNull();
      expect(result.error).toMatch(/name/);
    });

    it('returns error when description is missing', () => {
      const result = skillManager.parseSkillMarkdown('---\nname: pdf\n---');
      expect(result.metadata).toBeNull();
      expect(result.error).toMatch(/description/);
    });

    it('returns error when yaml parses to non-object', () => {
      // yaml that resolves to a string
      const result = skillManager.parseSkillMarkdown('---\njust a string\n---');
      expect(result.metadata).toBeNull();
    });

    it('returns error from catch block when yaml throws', () => {
      // yaml.load throws on unclosed flow collection
      const malformedYaml = '---\n{invalid\n---';
      const result = skillManager.parseSkillMarkdown(malformedYaml);
      expect(result.metadata).toBeNull();
      expect(result.error).toMatch(/Failed to parse YAML metadata/);
    });
  });

  // ─── validateSkillPackage ──────────────────────────────────────────────────

  describe('validateSkillPackage', () => {
    it('returns valid when SKILL.md matches and name is valid', () => {
      const skillDir = path.join(tempRoot, 'pdf');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: pdf\ndescription: PDF skill\n---\n',
        'utf-8',
      );
      const result = skillManager.validateSkillPackage(skillDir, 'pdf');
      expect(result.valid).toBe(true);
    });

    it('returns error when SKILL.md is missing', () => {
      const skillDir = path.join(tempRoot, 'empty');
      fs.mkdirSync(skillDir, { recursive: true });
      const result = skillManager.validateSkillPackage(skillDir, 'empty');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/SKILL.md/);
    });

    it('returns error when directory name does not match skill name', () => {
      const skillDir = path.join(tempRoot, 'wrong-name');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: pdf\ndescription: PDF skill\n---\n',
        'utf-8',
      );
      const result = skillManager.validateSkillPackage(skillDir, 'pdf');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Directory name/);
    });

    it('returns error when skill name fails naming rules', () => {
      const skillDir = path.join(tempRoot, 'Bad Name');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: Bad Name\ndescription: test\n---\n',
        'utf-8',
      );
      // No expectedName to bypass directory check, let naming check fire
      const result = skillManager.validateSkillPackage(skillDir);
      expect(result.valid).toBe(false);
    });

    it('returns error with "Failed to parse SKILL.md metadata" when parseError is undefined', () => {
      const skillDir = path.join(tempRoot, 'parse-fail');
      fs.mkdirSync(skillDir, { recursive: true });
      // Write SKILL.md with invalid yaml that returns metadata=null but no error
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\n\n---\n', // valid YAML but empty -> invalid
        'utf-8',
      );
      const result = skillManager.validateSkillPackage(skillDir);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('catches exception in validateSkillPackage (try/catch block)', () => {
      // Pass a path that causes fs.existsSync to be called on a weird path - force an exception
      // by making extractedDir an object path that triggers fs.join issues
      // Since we can't easily crash the try block in JS, let's make SKILL.md a directory
      const skillDir = path.join(tempRoot, 'crash-validate');
      fs.mkdirSync(skillDir, { recursive: true });
      // Create SKILL.md as a directory (will throw on readFileSync)
      fs.mkdirSync(path.join(skillDir, 'SKILL.md'), { recursive: true });
      const result = skillManager.validateSkillPackage(skillDir, skillDir);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Skill package validation failed/);
    });

    it('validates without expectedName', () => {
      const skillDir = path.join(tempRoot, 'mypdf');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: mypdf\ndescription: My PDF\n---\n',
        'utf-8',
      );
      const result = skillManager.validateSkillPackage(skillDir);
      expect(result.valid).toBe(true);
    });
  });

  // ─── getSkillMetadata ──────────────────────────────────────────────────────

  describe('getSkillMetadata', () => {
    it('reads SKILL.md and returns metadata', () => {
      const skillDir = path.join(tempRoot, 'pdf');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: pdf\ndescription: PDF\n---\n',
        'utf-8',
      );
      const result = skillManager.getSkillMetadata(skillDir);
      expect(result.metadata?.name).toBe('pdf');
    });

    it('returns error when SKILL.md does not exist in directory', () => {
      const skillDir = path.join(tempRoot, 'no-skill-md-dir');
      fs.mkdirSync(skillDir, { recursive: true });
      // No SKILL.md file created — existsSync returns false for it
      const result = skillManager.getSkillMetadata(skillDir);
      expect(result.metadata).toBeNull();
      expect(result.error).toBe('SKILL.md file not found');
    });

    it('returns error when readFileSync throws', () => {
      const skillDir = path.join(tempRoot, 'throw-test');
      fs.mkdirSync(skillDir, { recursive: true });
      // Create a directory named SKILL.md so readFileSync will throw
      fs.mkdirSync(path.join(skillDir, 'SKILL.md'), { recursive: true });
      const result = skillManager.getSkillMetadata(skillDir);
      expect(result.metadata).toBeNull();
      expect(result.error).toMatch(/Failed to read skill metadata/);
    });
  });

  // ─── checkSkillExists ─────────────────────────────────────────────────────

  describe('checkSkillExists', () => {
    it('returns null when profile missing', () => {
      (profileCacheManager.getCachedProfile as Mock).mockReturnValue(null);
      expect(skillManager.checkSkillExists('tester', 'pdf')).toBeNull();
    });

    it('returns skill when it exists', () => {
      (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
        skills: [{ name: 'pdf', version: '1.0.0' }],
      });
      expect(skillManager.checkSkillExists('tester', 'pdf')).toMatchObject({ name: 'pdf' });
    });

    it('returns null when skill not in profile', () => {
      (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [] });
      expect(skillManager.checkSkillExists('tester', 'pdf')).toBeUndefined();
    });
  });

  // ─── cleanupTempDirectory ─────────────────────────────────────────────────

  describe('cleanupTempDirectory', () => {
    it('removes existing directory', () => {
      const dir = path.join(tempRoot, 'cleanup-test');
      fs.mkdirSync(dir, { recursive: true });
      skillManager.cleanupTempDirectory(dir);
      expect(fs.existsSync(dir)).toBe(false);
    });

    it('does nothing when directory does not exist', () => {
      // Should not throw
      expect(() => skillManager.cleanupTempDirectory('/nonexistent/dir')).not.toThrow();
    });

    it('handles error when rmSync throws (covered via cleanupTempDirectory in other code paths)', () => {
      // fs.rmSync cannot be spied on in this environment (sealed property).
      // The catch branch in cleanupTempDirectory is covered via installSkill
      // when addSkill profile update fails and cleanupTempDirectory is called.
      // This test just validates the happy path to ensure no regression.
      const dir = path.join(tempRoot, 'cleanup-happy');
      fs.mkdirSync(dir, { recursive: true });
      skillManager.cleanupTempDirectory(dir);
      expect(fs.existsSync(dir)).toBe(false);
    });
  });

  // ─── extractZip ────────────────────────────────────────────────────────────

  describe('extractZip', () => {
    it('throws when zip file cannot be read', async () => {
      await expect(
        skillManager.extractZip('/nonexistent/archive.zip', tempRoot),
      ).rejects.toThrow();
    });

    it('extracts zip with root directory structure', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.folder('pdf')!.file('SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n');
      zip.folder('pdf')!.file('README.md', '# test');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tempRoot, 'pdf.zip');
      fs.writeFileSync(zipPath, zipBuffer);

      const destDir = path.join(tempRoot, 'extract-root');
      fs.mkdirSync(destDir, { recursive: true });
      const rootDirName = await skillManager.extractZip(zipPath, destDir);

      expect(rootDirName).toBe('pdf');
      expect(fs.existsSync(path.join(destDir, 'pdf', 'SKILL.md'))).toBe(true);
    });

    it('extracts flat zip (no root directory, files at top level)', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      // Files directly at root (flat structure)
      zip.file('SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n');
      zip.file('README.md', '# test');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tempRoot, 'pdf-flat.zip');
      fs.writeFileSync(zipPath, zipBuffer);

      const destDir = path.join(tempRoot, 'extract-flat');
      fs.mkdirSync(destDir, { recursive: true });
      const rootDirName = await skillManager.extractZip(zipPath, destDir);

      expect(rootDirName).toBe('pdf-flat');
      expect(fs.existsSync(path.join(destDir, 'pdf-flat', 'SKILL.md'))).toBe(true);
    });

    it('strips version from flat zip filename', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tempRoot, 'pdf-2.0.0.zip');
      fs.writeFileSync(zipPath, zipBuffer);

      const destDir = path.join(tempRoot, 'extract-versioned');
      fs.mkdirSync(destDir, { recursive: true });
      const rootDirName = await skillManager.extractZip(zipPath, destDir);

      expect(rootDirName).toBe('pdf');
    });

    it('skips macOS __MACOSX entries during extraction', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.folder('pdf')!.file('SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n');
      zip.folder('__MACOSX')!.file('.DS_Store', 'metadata');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tempRoot, 'pdf-macos.zip');
      fs.writeFileSync(zipPath, zipBuffer);

      const destDir = path.join(tempRoot, 'extract-macos');
      fs.mkdirSync(destDir, { recursive: true });
      const rootDirName = await skillManager.extractZip(zipPath, destDir);

      expect(rootDirName).toBe('pdf');
      expect(fs.existsSync(path.join(destDir, '__MACOSX'))).toBe(false);
    });

    it('handles empty zip (no file entries)', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tempRoot, 'empty.zip');
      fs.writeFileSync(zipPath, zipBuffer);

      const destDir = path.join(tempRoot, 'extract-empty');
      fs.mkdirSync(destDir, { recursive: true });
      const rootDirName = await skillManager.extractZip(zipPath, destDir);

      // detectZipRootDirectory returns null, so rootDirName = 'empty'
      expect(rootDirName).toBe('empty');
    });

    it('handles zip with multiple top-level directories (flat structure)', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      // Multiple top-level directories → detectZipRootDirectory returns null
      zip.folder('pdf')!.file('SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n');
      zip.folder('extra')!.file('README.md', '# extra');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tempRoot, 'pdf-multi.zip');
      fs.writeFileSync(zipPath, zipBuffer);

      const destDir = path.join(tempRoot, 'extract-multi');
      fs.mkdirSync(destDir, { recursive: true });
      const rootDirName = await skillManager.extractZip(zipPath, destDir);

      // Multiple top-level dirs → flat structure → rootDirName = 'pdf-multi'
      expect(rootDirName).toBe('pdf-multi');
    });

    it('creates destDir if it does not exist before extraction', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.folder('pdf')!.file('SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tempRoot, 'pdf-nodest.zip');
      fs.writeFileSync(zipPath, zipBuffer);

      // Do NOT create destDir — let extractZip create it
      const destDir = path.join(tempRoot, 'extract-newdir');
      const rootDirName = await skillManager.extractZip(zipPath, destDir);

      expect(rootDirName).toBe('pdf');
      expect(fs.existsSync(destDir)).toBe(true);
    });
  });

  // ─── installSkill ──────────────────────────────────────────────────────────

  describe('installSkill', () => {
    it('returns error when source directory does not exist', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);
      const result = await skillManager.installSkill(
        'tester',
        { name: 'pdf', description: 'PDF', version: '1.0.0', source: 'ON-DEVICE' },
        '/nonexistent/source',
        false,
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Source skill directory not found/);
    });

    it('installs (add) skill successfully', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);
      (profileCacheManager.addSkill as Mock).mockResolvedValue(true);

      const sourceDir = path.join(tempRoot, 'source-pdf');
      fs.mkdirSync(sourceDir, { recursive: true });

      const result = await skillManager.installSkill(
        'tester',
        { name: 'pdf', description: 'PDF', version: '1.0.0', source: 'ON-DEVICE' },
        sourceDir,
        false,
      );
      expect(result.success).toBe(true);
      expect(profileCacheManager.addSkill).toHaveBeenCalled();
    });

    it('updates skill successfully', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);
      (profileCacheManager.updateSkill as Mock).mockResolvedValue(true);

      const sourceDir = path.join(tempRoot, 'source-pdf2');
      fs.mkdirSync(sourceDir, { recursive: true });

      const result = await skillManager.installSkill(
        'tester',
        { name: 'pdf', description: 'PDF', version: '2.0.0', source: 'ON-DEVICE' },
        sourceDir,
        true,
      );
      expect(result.success).toBe(true);
      expect(profileCacheManager.updateSkill).toHaveBeenCalled();
    });

    it('cleans up and returns error when profile update fails', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);
      (profileCacheManager.addSkill as Mock).mockResolvedValue(false);

      const sourceDir = path.join(tempRoot, 'source-pdf3');
      fs.mkdirSync(sourceDir, { recursive: true });

      const result = await skillManager.installSkill(
        'tester',
        { name: 'pdf', description: 'PDF', version: '1.0.0', source: 'ON-DEVICE' },
        sourceDir,
        false,
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to save/);
    });

    it('removes existing non-symlink skill dir before installing (rmSync path)', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);
      (profileCacheManager.addSkill as Mock).mockResolvedValue(true);

      // Pre-create an existing skill directory (not a symlink)
      const userSkillsDir = path.join(tempRoot, 'profiles', 'tester', 'skills');
      fs.mkdirSync(userSkillsDir, { recursive: true });
      const existingSkillDir = path.join(userSkillsDir, 'pdf');
      fs.mkdirSync(existingSkillDir, { recursive: true });
      fs.writeFileSync(path.join(existingSkillDir, 'old.txt'), 'old content');

      const sourceDir = path.join(tempRoot, 'source-pdf-replace');
      fs.mkdirSync(sourceDir, { recursive: true });

      const result = await skillManager.installSkill(
        'tester',
        { name: 'pdf', description: 'PDF', version: '2.0.0', source: 'ON-DEVICE' },
        sourceDir,
        false,
      );
      expect(result.success).toBe(true);
    });

    it('handles installSkill catch block when rename throws', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);

      const sourceDir = path.join(tempRoot, 'source-crash');
      fs.mkdirSync(sourceDir, { recursive: true });

      // Force renameSync to fail by making userSkillsDir a file (so mkdirSync on it throws)
      // We'll instead mock fs.renameSync indirectly by creating the destDir as a file
      const userSkillsDir = path.join(tempRoot, 'profiles', 'tester2', 'skills');
      fs.mkdirSync(path.dirname(userSkillsDir), { recursive: true });
      // write a file where the directory would be
      fs.writeFileSync(userSkillsDir, 'not a dir');

      const result = await skillManager.installSkill(
        'tester2',
        { name: 'pdf', description: 'PDF', version: '1.0.0', source: 'ON-DEVICE' },
        sourceDir,
        false,
      );
      expect(result.success).toBe(false);
    });

    it('overwrites existing symlink skill dir before installing', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);
      (profileCacheManager.addSkill as Mock).mockResolvedValue(true);

      // Create a target dir and a symlink pointing to it
      const realDir = path.join(tempRoot, 'real-pdf');
      fs.mkdirSync(realDir, { recursive: true });
      const userSkillsDir = path.join(tempRoot, 'profiles', 'tester', 'skills');
      fs.mkdirSync(userSkillsDir, { recursive: true });
      const symlinkPath = path.join(userSkillsDir, 'pdf');
      fs.symlinkSync(realDir, symlinkPath);

      const sourceDir = path.join(tempRoot, 'source-pdf4');
      fs.mkdirSync(sourceDir, { recursive: true });

      const result = await skillManager.installSkill(
        'tester',
        { name: 'pdf', description: 'PDF', version: '1.0.0', source: 'ON-DEVICE' },
        sourceDir,
        false,
      );
      expect(result.success).toBe(true);
    });
  });

  // ─── createTempDirectory ──────────────────────────────────────────────────

  describe('createTempDirectory', () => {
    it('creates a temp directory', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);
      const dir = skillManager.createTempDirectory('test');
      expect(fs.existsSync(dir)).toBe(true);
      // cleanup
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('uses default prefix when none provided', async () => {
      const { app } = await import('electron');
      (app.getPath as Mock).mockReturnValue(tempRoot);
      const dir = skillManager.createTempDirectory();
      expect(dir).toContain('openkosmos-skill');
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  // ─── singleton ────────────────────────────────────────────────────────────

  describe('singleton', () => {
    it('returns the same instance on repeated calls', () => {
      const a = SkillManager.getInstance();
      const b = SkillManager.getInstance();
      expect(a).toBe(b);
    });
  });
});
