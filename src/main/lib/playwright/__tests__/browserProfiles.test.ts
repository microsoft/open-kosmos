import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserProfileManager } from '../browserProfiles';

// Stub the logger so it doesn't hit real log infrastructure
vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('BrowserProfileManager', () => {
  let tmpBase: string;
  let manager: BrowserProfileManager;

  beforeEach(() => {
    // Create a unique temp dir per test so tests are isolated
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bpm-test-'));
    // Monkey-patch the baseDir to our temp directory
    manager = new BrowserProfileManager();
    (manager as any).baseDir = path.join(tmpBase, 'openkosmos-playwright-profiles');
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('getProfilePath returns a path under baseDir', () => {
    const p = manager.getProfilePath('teams-auth');
    expect(p).toContain('teams-auth');
    expect(p).toContain('openkosmos-playwright-profiles');
  });

  it('profileExists returns false when profile directory does not exist', () => {
    expect(manager.profileExists('nonexistent')).toBe(false);
  });

  it('ensureProfileDir creates the directory and returns its path', () => {
    const profilePath = manager.ensureProfileDir('my-profile');
    expect(fs.existsSync(profilePath)).toBe(true);
    expect(fs.statSync(profilePath).isDirectory()).toBe(true);
  });

  it('profileExists returns true after ensureProfileDir', () => {
    manager.ensureProfileDir('my-profile');
    expect(manager.profileExists('my-profile')).toBe(true);
  });

  it('ensureProfileDir is idempotent (no error if called twice)', () => {
    manager.ensureProfileDir('my-profile');
    expect(() => manager.ensureProfileDir('my-profile')).not.toThrow();
  });

  it('listProfiles returns empty array when base directory does not exist', () => {
    expect(manager.listProfiles()).toEqual([]);
  });

  it('listProfiles returns created profiles', () => {
    manager.ensureProfileDir('profile-a');
    manager.ensureProfileDir('profile-b');
    const profiles = manager.listProfiles();
    expect(profiles).toContain('profile-a');
    expect(profiles).toContain('profile-b');
    expect(profiles).toHaveLength(2);
  });

  it('listProfiles only returns directories (ignores files)', () => {
    manager.ensureProfileDir('dir-profile');
    const baseDir = (manager as any).baseDir;
    // Create a plain file in the base dir
    fs.writeFileSync(path.join(baseDir, 'notaprofile.txt'), 'data');
    const profiles = manager.listProfiles();
    expect(profiles).toContain('dir-profile');
    expect(profiles).not.toContain('notaprofile.txt');
  });

  it('deleteProfile removes the profile directory', async () => {
    const profilePath = manager.ensureProfileDir('to-delete');
    expect(fs.existsSync(profilePath)).toBe(true);
    await manager.deleteProfile('to-delete');
    expect(fs.existsSync(profilePath)).toBe(false);
  });

  it('deleteProfile does not throw if profile does not exist', async () => {
    await expect(manager.deleteProfile('ghost-profile')).resolves.not.toThrow();
  });

  it('listProfiles excludes deleted profiles', async () => {
    manager.ensureProfileDir('keep');
    manager.ensureProfileDir('remove');
    await manager.deleteProfile('remove');
    const profiles = manager.listProfiles();
    expect(profiles).toContain('keep');
    expect(profiles).not.toContain('remove');
  });
});
