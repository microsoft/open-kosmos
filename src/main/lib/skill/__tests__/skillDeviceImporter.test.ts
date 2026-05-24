import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { updateSkillFromDevice } from '../skillDeviceImporter';
import { skillManager } from '../skillManager';

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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

describe('skillDeviceImporter.updateSkillFromDevice', () => {
  let tempRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-device-importer-test-'));

    (skillManager.createTempDirectory as Mock).mockImplementation((prefix: string) => (
      fs.mkdtempSync(path.join(tempRoot, `${prefix}-`))
    ));
    (skillManager.parseSkillMarkdown as Mock).mockImplementation((content: string) => {
      const versionMatch = content.match(/version:\s*"?([^\n"]+)"?/);

      return {
        metadata: {
          name: 'pdf',
          description: 'PDF skill',
          version: versionMatch?.[1] ?? '2.0.0',
        },
      };
    });
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: true });
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.5.0' });
    (skillManager.determineVersion as Mock).mockImplementation((metadataVersion?: string) => metadataVersion ?? '2.0.0');
    (skillManager.installSkill as Mock).mockResolvedValue({ success: true });
    (skillManager.cleanupTempDirectory as Mock).mockImplementation((dirPath: string) => {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  function createSkillFolder(version: string): { skillDir: string; skillMdPath: string } {
    const skillDir = path.join(tempRoot, `pdf-${version}`);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      skillMdPath,
      `---\nname: pdf\ndescription: PDF skill\nversion: ${version}\n---\n`,
      'utf-8',
    );
    fs.writeFileSync(path.join(skillDir, 'README.md'), '# test', 'utf-8');

    return { skillDir, skillMdPath };
  }

  it('updates a skill from a folder path', async () => {
    const { skillDir } = createSkillFolder('2.3.0');

    const result = await updateSkillFromDevice(skillDir, 'tester', 'pdf');

    expect(result).toEqual({
      success: true,
      skillName: 'pdf',
      skillVersion: '2.3.0',
      inputType: 'folder',
    });
    expect(skillManager.installSkill).toHaveBeenCalledWith(
      'tester',
      expect.objectContaining({
        name: 'pdf',
        description: 'PDF skill',
        version: '2.3.0',
        source: 'ON-DEVICE',
      }),
      expect.any(String),
      true,
    );
    const installPath = (skillManager.installSkill as Mock).mock.calls[0][2] as string;
    expect(path.basename(installPath)).toBe('pdf');
  });

  it('rejects a direct SKILL.md path', async () => {
    const { skillMdPath } = createSkillFolder('2.4.0');

    const result = await updateSkillFromDevice(skillMdPath, 'tester', 'pdf');

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining('Unsupported skill input'),
    });
    expect(skillManager.installSkill).not.toHaveBeenCalled();
  });
});
