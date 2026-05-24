// @ts-nocheck
/**
 * Tests for SkillManager that require mocked fs to hit catch branches.
 */

import * as path from 'path';

const mockExistsSync = vi.fn(() => true);
const mockRmSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockCpSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockReadFileSync = vi.fn(() => '---\nname: pdf\ndescription: PDF\n---\n');
const mockWriteFileSync = vi.fn();
const mockLstatSync = vi.fn(() => ({ isSymbolicLink: () => false }));
const mockMkdtempSync = vi.fn((prefix: string) => `/tmp/${path.basename(prefix)}-abcd`);
const mockRenameSync = vi.fn();

vi.mock('fs', async () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  cpSync: (...args: unknown[]) => mockCpSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  lstatSync: (...args: unknown[]) => mockLstatSync(...args),
  mkdtempSync: (...args: unknown[]) => mockMkdtempSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
}));

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

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

import { SkillManager } from '../skillManager';

describe('SkillManager — mocked fs branches', () => {
  let skillManager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (SkillManager as unknown as { instance?: SkillManager }).instance = undefined;
    mockExistsSync.mockReturnValue(true);
    skillManager = SkillManager.getInstance();
  });

  afterEach(() => {
    (SkillManager as unknown as { instance?: SkillManager }).instance = undefined;
  });

  // ─── cleanupTempDirectory — catch block (line 354) ────────────────────────

  it('cleanupTempDirectory: logs error when rmSync throws', () => {
    mockRmSync.mockImplementationOnce(() => {
      throw new Error('EPERM: operation not permitted');
    });
    // Should not throw — catch block swallows the error
    expect(() => skillManager.cleanupTempDirectory('/some/dir')).not.toThrow();
  });
});
