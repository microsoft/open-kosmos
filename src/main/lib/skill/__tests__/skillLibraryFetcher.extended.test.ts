import * as path from 'path';

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('fs', async () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify({ skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] })),
  createWriteStream: vi.fn(),
}));

vi.mock('../../utils/urlUtils', async () => ({
  appendCacheBustingTimestamp: vi.fn((url: string) => url),
}));

vi.mock('../skillManager', async () => ({
  skillManager: {
    createTempDirectory: vi.fn(() => '/tmp/library-skill'),
    extractZip: vi.fn(async () => 'pdf'),
    validateSkillPackage: vi.fn(() => ({ valid: true })),
    checkSkillExists: vi.fn(() => null),
    installSkill: vi.fn(async () => ({ success: true })),
    cleanupTempDirectory: vi.fn(),
  },
}));

import { SkillLibraryFetcher } from '../skillLibraryFetcher';
import { skillManager } from '../skillManager';

describe('SkillLibraryFetcher — extended coverage', () => {
  let fetcher: any;

  beforeEach(() => {
    (SkillLibraryFetcher as unknown as { instance?: SkillLibraryFetcher }).instance = undefined;
    vi.clearAllMocks();
    (skillManager.checkSkillExists as Mock).mockReturnValue(null);
    (skillManager.installSkill as Mock).mockResolvedValue({ success: true });
    fetcher = SkillLibraryFetcher.getInstance();
  });

  // ─── addSkill ─────────────────────────────────────────────────────────────

  it('addSkill: returns error when library data unavailable', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({ success: false });
    const result = await fetcher.addSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to get library data/);
  });

  it('addSkill: returns error when skill not found in library', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [] },
    });
    const result = await fetcher.addSkill('nonexistent', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found in library/);
  });

  it('addSkill: returns error when skill already exists and overwrite=false', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });

    const result = await fetcher.addSkill('pdf', 'tester', { overwrite: false });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/);
  });

  it('addSkill: installs new skill successfully', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);

    const result = await fetcher.addSkill('pdf', 'tester');
    expect(result.success).toBe(true);
    expect(result.installAction).toBe('install');
    expect(result.skillVersion).toBe('2.0.0');
  });

  it('addSkill: updates skill when overwrite=true and skill exists', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);

    const result = await fetcher.addSkill('pdf', 'tester', { overwrite: true });
    expect(result.success).toBe(true);
    expect(result.installAction).toBe('update');
  });

  it('addSkill: returns error when validation fails', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: false, error: 'BAD_PKG' });

    const result = await fetcher.addSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BAD_PKG/);
  });

  it('addSkill: returns error when installSkill fails', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: true });
    (skillManager.installSkill as Mock).mockResolvedValue({ success: false, error: 'INSTALL_ERR' });

    const result = await fetcher.addSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/INSTALL_ERR/);
  });

  // ─── updateSkill ──────────────────────────────────────────────────────────

  it('updateSkill: returns error when library data unavailable', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({ success: false });
    const result = await fetcher.updateSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to get library data/);
  });

  it('updateSkill: returns error when skill not found in library', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [] },
    });
    const result = await fetcher.updateSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found in library/);
  });

  it('updateSkill: returns error when skill not installed for user', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    (skillManager.checkSkillExists as Mock).mockReturnValue(null);

    const result = await fetcher.updateSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not installed/);
  });

  it('updateSkill: returns error when validation fails', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: false, error: 'BAD_PKG' });

    const result = await fetcher.updateSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BAD_PKG/);
  });

  it('updateSkill: returns error when installSkill fails', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: true });
    (skillManager.installSkill as Mock).mockResolvedValue({ success: false, error: 'UPDATE_ERR' });

    const result = await fetcher.updateSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/UPDATE_ERR/);
  });

  // ─── getLibraryData ───────────────────────────────────────────────────────

  it('getLibraryData: falls back to local when remote fails', async () => {
    vi.spyOn(fetcher as any, 'fetchFromRemote').mockRejectedValue(new Error('Network error'));
    vi.spyOn(fetcher as any, 'loadFromLocal').mockResolvedValue({
      skills: [{ name: 'pdf', description: 'PDF', version: '1.0.0' }],
    });
    const result = await fetcher.getLibraryData();
    expect(result.success).toBe(true);
    expect(result.data.skills[0].name).toBe('pdf');
  });

  it('getLibraryData: returns error when both remote and local fail', async () => {
    vi.spyOn(fetcher as any, 'fetchFromRemote').mockRejectedValue(new Error('Network error'));
    vi.spyOn(fetcher as any, 'loadFromLocal').mockResolvedValue(null);
    const result = await fetcher.getLibraryData();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Remote fetch failed/);
  });

  // ─── validateSkill ────────────────────────────────────────────────────────

  it('validateSkill: returns error when library data unavailable', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({ success: false });
    const result = await fetcher.validateSkill('pdf', 'tester');
    expect(result.success).toBe(false);
  });

  it('validateSkill: returns error when skill not found in library', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [] },
    });
    const result = await fetcher.validateSkill('pdf', 'tester');
    expect(result.success).toBe(false);
  });

  it('validateSkill: succeeds and checks existing skill', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: true });
    (skillManager.checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.0.0' });

    const result = await fetcher.validateSkill('pdf', 'tester');
    expect(result.success).toBe(true);
    expect(result.hasExisting).toBe(true);
  });

  it('validateSkill: returns error when validation fails (cleanup branch)', async () => {
    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF', version: '2.0.0' }] },
    });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);
    (skillManager.validateSkillPackage as Mock).mockReturnValue({ valid: false, error: 'VALIDATE_FAIL' });

    const result = await fetcher.validateSkill('pdf', 'tester');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/VALIDATE_FAIL/);
    expect(skillManager.cleanupTempDirectory).toHaveBeenCalled();
  });
});
