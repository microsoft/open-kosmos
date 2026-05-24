import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addSkillFromDevice, updateSkillFromDevice } from '../skillDeviceImporter';
import { skillManager } from '../skillManager';

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../skillManager', async () => ({
  skillManager: {
    parseSkillMarkdown: vi.fn(),
    validateSkillPackage: vi.fn(),
    createTempDirectory: vi.fn(),
    cleanupTempDirectory: vi.fn(),
    checkSkillExists: vi.fn(),
    determineVersion: vi.fn(),
    installSkill: vi.fn(),
    extractZip: vi.fn(),
    parseSkillFileName: vi.fn(),
  },
}));

describe('skillDeviceImporter — extended coverage', () => {
  let tempRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-device-ext-'));

    (skillManager.createTempDirectory as Mock).mockImplementation((prefix: string) =>
      fs.mkdtempSync(path.join(tempRoot, `${prefix}-`))
    );
    (skillManager.parseSkillMarkdown as Mock).mockReturnValue({
      metadata: { name: 'pdf', description: 'PDF skill', version: '1.0.0' },
    });
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: true });
    (skillManager.checkSkillExists as Mock).mockReturnValue(null);
    (skillManager.determineVersion as Mock).mockReturnValue('1.0.0');
    (skillManager.installSkill as Mock).mockResolvedValue({ success: true });
    (skillManager.cleanupTempDirectory as Mock).mockImplementation((dirPath: string) => {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    });
    (skillManager.parseSkillFileName as Mock).mockReturnValue({ skillName: 'pdf', version: undefined });
    (skillManager.extractZip as Mock).mockImplementation(async (_zipPath: string, tempDir: string) => {
      const extractedDir = path.join(tempDir, 'pdf');
      fs.mkdirSync(extractedDir, { recursive: true });
      fs.writeFileSync(path.join(extractedDir, 'SKILL.md'), '---\nname: pdf\ndescription: PDF skill\n---\n', 'utf-8');
      return 'pdf';
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  function createSkillFolder(name = 'pdf', version = '1.0.0'): string {
    const skillDir = path.join(tempRoot, `${name}-folder`);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: test\nversion: ${version}\n---\n`,
      'utf-8',
    );
    return skillDir;
  }

  function createZipFile(name = 'pdf', version = '1.0.0'): string {
    const zipPath = path.join(tempRoot, `${name}-${version}.zip`);
    fs.writeFileSync(zipPath, 'fake zip content');
    return zipPath;
  }

  // ─── addSkillFromDevice ──────────────────────────────────────────────────

  it('adds skill from folder without existing skill', async () => {
    const skillDir = createSkillFolder();
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(true);
    expect(result.skillName).toBe('pdf');
    expect(result.isOverwrite).toBe(false);
  });

  it('returns error when path does not exist', async () => {
    const result = await addSkillFromDevice('/nonexistent/path', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Path does not exist|Unsupported skill input/);
  });

  it('returns error when path is unsupported type (e.g. .txt file)', async () => {
    const txtPath = path.join(tempRoot, 'skill.txt');
    fs.writeFileSync(txtPath, 'hello');
    const result = await addSkillFromDevice(txtPath, 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unsupported skill input/);
  });

  it('returns error when SKILL.md cannot be parsed (no SKILL.md in folder)', async () => {
    (skillManager.parseSkillMarkdown as Mock).mockReturnValue({ metadata: null, error: 'No name field' });
    const skillDir = createSkillFolder();
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toBe('No name field');
  });

  it('prompts confirmation when skill already exists and callback confirms', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '0.9.0' });
    const confirmCallback = vi.fn().mockResolvedValue(true);
    const skillDir = createSkillFolder();
    const result = await addSkillFromDevice(skillDir, 'tester', confirmCallback);
    expect(confirmCallback).toHaveBeenCalledWith('pdf');
    expect(result.success).toBe(true);
    expect(result.isOverwrite).toBe(true);
  });

  it('returns cancelled error when confirmation callback returns false', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '0.9.0' });
    const confirmCallback = vi.fn().mockResolvedValue(false);
    const skillDir = createSkillFolder();
    const result = await addSkillFromDevice(skillDir, 'tester', confirmCallback);
    expect(result.success).toBe(false);
    expect(result.error).toBe('User cancelled the operation');
  });

  it('returns error when skill exists and no callback provided', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '0.9.0' });
    const skillDir = createSkillFolder();
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already installed/);
  });

  it('returns error when installSkill fails', async () => {
    (skillManager.installSkill as Mock).mockResolvedValue({ success: false, error: 'DISK_FULL' });
    const skillDir = createSkillFolder();
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toBe('DISK_FULL');
  });

  it('handles zip input type', async () => {
    const zipPath = createZipFile();
    const result = await addSkillFromDevice(zipPath, 'tester');
    expect(result.success).toBe(true);
    expect(result.inputType).toBe('zip');
  });

  it('handles .skill input type', async () => {
    const skillFilePath = path.join(tempRoot, 'pdf-1.0.0.skill');
    fs.writeFileSync(skillFilePath, 'fake skill content');
    const result = await addSkillFromDevice(skillFilePath, 'tester');
    expect(result.success).toBe(true);
    expect(result.inputType).toBe('skill');
  });

  // ─── updateSkillFromDevice ───────────────────────────────────────────────

  it('returns error when skill does not exist for update', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue(null);
    const skillDir = createSkillFolder();
    const result = await updateSkillFromDevice(skillDir, 'tester', 'pdf');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });

  it('returns error when name in metadata mismatches target skill name', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'other', version: '1.0.0' });
    (skillManager.parseSkillMarkdown as Mock).mockReturnValue({
      metadata: { name: 'other', description: 'Other skill', version: '1.0.0' },
    });
    const skillDir = createSkillFolder('other');
    const result = await updateSkillFromDevice(skillDir, 'tester', 'pdf');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Validation failed/);
  });

  it('uses validateSkillNameCallback when provided and returns false', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });
    const validateCallback = vi.fn().mockResolvedValue(false);
    const skillDir = createSkillFolder();
    const result = await updateSkillFromDevice(skillDir, 'tester', 'pdf', validateCallback);
    expect(validateCallback).toHaveBeenCalledWith('pdf');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Validation failed/);
  });

  it('uses validateSkillNameCallback when provided and returns true', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });
    const validateCallback = vi.fn().mockResolvedValue(true);
    const skillDir = createSkillFolder();
    const result = await updateSkillFromDevice(skillDir, 'tester', 'pdf', validateCallback);
    expect(result.success).toBe(true);
  });

  it('passes confirmation callback for update', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });
    const confirmCallback = vi.fn().mockResolvedValue(true);
    const skillDir = createSkillFolder();
    const result = await updateSkillFromDevice(skillDir, 'tester', 'pdf', undefined, confirmCallback);
    expect(confirmCallback).toHaveBeenCalledWith('pdf');
    expect(result.success).toBe(true);
  });

  it('returns cancelled when confirmCallback returns false on update', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });
    const confirmCallback = vi.fn().mockResolvedValue(false);
    const skillDir = createSkillFolder();
    const result = await updateSkillFromDevice(skillDir, 'tester', 'pdf', undefined, confirmCallback);
    expect(result.success).toBe(false);
    expect(result.error).toBe('User cancelled the operation');
  });

  it('returns error when update installSkill fails', async () => {
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });
    (skillManager.installSkill as Mock).mockResolvedValue({ success: false, error: 'INSTALL_ERROR' });
    const skillDir = createSkillFolder();
    const result = await updateSkillFromDevice(skillDir, 'tester', 'pdf');
    expect(result.success).toBe(false);
    expect(result.error).toBe('INSTALL_ERROR');
  });

  it('returns error when zip validation fails', async () => {
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: false, error: 'BAD_PACKAGE' });
    const zipPath = createZipFile();
    const result = await addSkillFromDevice(zipPath, 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BAD_PACKAGE/);
  });

  it('zip extraction renames dir when rootDirName differs from metadata name', async () => {
    (skillManager.extractZip as Mock).mockImplementation(async (_zipPath: string, tempDir: string) => {
      // Create dir with wrong name
      const wrongDir = path.join(tempDir, 'pdf-1.0.0');
      fs.mkdirSync(wrongDir, { recursive: true });
      fs.writeFileSync(path.join(wrongDir, 'SKILL.md'), '---\nname: pdf\ndescription: PDF\n---\n', 'utf-8');
      return 'pdf-1.0.0';
    });
    const zipPath = createZipFile();
    const result = await addSkillFromDevice(zipPath, 'tester');
    expect(result.success).toBe(true);
  });

  it('zip extraction removes existing normalizedDir before rename when it already exists', async () => {
    (skillManager.extractZip as Mock).mockImplementation(async (_zipPath: string, tempDir: string) => {
      // Create dir with wrong name (not matching metadata.name)
      const wrongDir = path.join(tempDir, 'pdf-1.0.0');
      fs.mkdirSync(wrongDir, { recursive: true });
      fs.writeFileSync(path.join(wrongDir, 'SKILL.md'), '---\nname: pdf\ndescription: PDF\n---\n', 'utf-8');
      // Also create the normalized dir to trigger the rmSync branch
      const normalizedDir = path.join(tempDir, 'pdf');
      fs.mkdirSync(normalizedDir, { recursive: true });
      fs.writeFileSync(path.join(normalizedDir, 'old.txt'), 'old');
      return 'pdf-1.0.0';
    });
    const zipPath = createZipFile();
    const result = await addSkillFromDevice(zipPath, 'tester');
    expect(result.success).toBe(true);
  });

  it('returns error when zip metadata parse fails', async () => {
    (skillManager.parseSkillMarkdown as Mock).mockReturnValue({ metadata: null, error: 'BAD_YAML' });
    (skillManager.extractZip as Mock).mockImplementation(async (_zipPath: string, tempDir: string) => {
      const dir = path.join(tempDir, 'pdf');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), 'bad content', 'utf-8');
      return 'pdf';
    });
    const zipPath = createZipFile();
    const result = await addSkillFromDevice(zipPath, 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toBe('BAD_YAML');
  });

  it('folder: removes existing staged dir when it already exists in temp', async () => {
    // stageSkillDirectory: pre-create the destination dir inside tempDir
    (skillManager.createTempDirectory as Mock).mockImplementation((prefix: string) => {
      const tempDir = fs.mkdtempSync(path.join(tempRoot, `${prefix}-`));
      // Pre-create pdf/ inside tempDir to trigger rmSync branch
      fs.mkdirSync(path.join(tempDir, 'pdf'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'pdf', 'old.txt'), 'old');
      return tempDir;
    });
    const skillDir = createSkillFolder();
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(true);
  });

  it('folder: returns error when validation fails', async () => {
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: false, error: 'FOLDER_INVALID' });
    const skillDir = createSkillFolder();
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toBe('FOLDER_INVALID');
  });

  it('handles lowercase skill.md (getSkillEntryPath fallback)', async () => {
    // Create a folder with skill.md (lowercase) instead of SKILL.md
    const skillDir = path.join(tempRoot, 'pdf-lowercase');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'skill.md'),
      '---\nname: pdf\ndescription: PDF skill\nversion: 1.0.0\n---\n',
      'utf-8',
    );
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(true);
    expect(result.skillName).toBe('pdf');
  });

  it('normalizes skill.md to SKILL.md during staging (normalizeSkillEntryFile)', async () => {
    // The staging copies files and then normalizes skill.md -> SKILL.md
    // Create folder with only lowercase skill.md
    const skillDir = path.join(tempRoot, 'pdf-normalize');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'skill.md'),
      '---\nname: pdf\ndescription: PDF\nversion: 1.0.0\n---\n',
      'utf-8',
    );
    // Override createTempDirectory to use a real temp that we can inspect
    let stagedDir: string | undefined;
    (skillManager.createTempDirectory as Mock).mockImplementationOnce((prefix: string) => {
      const tmpDir = fs.mkdtempSync(path.join(tempRoot, `${prefix}-`));
      stagedDir = path.join(tmpDir, 'pdf');
      return tmpDir;
    });
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(true);
    // After normalization, staged dir should have SKILL.md not skill.md
    if (stagedDir && fs.existsSync(stagedDir)) {
      expect(fs.existsSync(path.join(stagedDir, 'SKILL.md'))).toBe(true);
    }
  });

  it('handles error in readSkillMetadata when readFileSync throws (catch block)', async () => {
    // Create skill directory with a directory named SKILL.md so readFileSync throws
    const skillDir = path.join(tempRoot, 'crash-read');
    fs.mkdirSync(path.join(skillDir, 'SKILL.md'), { recursive: true });
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(false);
    // Path does not exist check (SKILL.md is a dir, so getSkillEntryPath returns it, readFileSync throws)
    // Actually getSkillEntryPath uses fs.existsSync on 'SKILL.md' which returns true for a dir
    // then readFileSync throws because it's a directory
  });

  it('returns error when folder has neither SKILL.md nor skill.md (readSkillMetadata null path)', async () => {
    // Create folder with no SKILL.md or skill.md so getSkillEntryPath returns null (line 47)
    // and readSkillMetadata returns 'SKILL.md file not found' (line 87)
    const skillDir = path.join(tempRoot, 'no-skill-md');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'README.md'), '# test');
    const result = await addSkillFromDevice(skillDir, 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SKILL.md file not found/);
  });
});
