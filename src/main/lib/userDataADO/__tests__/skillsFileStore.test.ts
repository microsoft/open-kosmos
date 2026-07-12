import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SKILLS_FILE_NAME,
  getSkillsFilePath,
  isRetiredPluginSkillEntry,
  loadSkillsForProfile,
  readSkillsFile,
  sanitizeSkillEntries,
  writeSkillsFile,
} from '../skillsFileStore';
import { SKILLS_FILE_VERSION, SkillConfig } from '../types/profile';

function makeSkill(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    name: 'demo',
    description: 'demo skill',
    version: '1.2.3',
    remoteVersion: '',
    source: 'ON-DEVICE',
    ...overrides,
  };
}

describe('skillsFileStore', () => {
  let profileDir: string;

  beforeEach(() => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-store-'));
  });

  afterEach(() => {
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  function readRawSkillsFile(): { version: string; updatedAt: string; skills: SkillConfig[] } {
    return JSON.parse(fs.readFileSync(getSkillsFilePath(profileDir), 'utf-8'));
  }

  describe('getSkillsFilePath', () => {
    it('joins the profile directory with skills.json', () => {
      expect(getSkillsFilePath('/tmp/profiles/alice')).toBe(path.join('/tmp/profiles/alice', SKILLS_FILE_NAME));
      expect(SKILLS_FILE_NAME).toBe('skills.json');
    });
  });

  describe('sanitizeSkillEntries', () => {
    it('returns [] for non-array input', () => {
      expect(sanitizeSkillEntries(undefined)).toEqual([]);
      expect(sanitizeSkillEntries(null)).toEqual([]);
      expect(sanitizeSkillEntries('nope')).toEqual([]);
      expect(sanitizeSkillEntries({ skills: [] })).toEqual([]);
    });

    it('drops entries that are not objects or lack a usable name', () => {
      const result = sanitizeSkillEntries([
        null,
        'string',
        42,
        {},
        { name: '' },
        { name: '   ' },
        { name: 'keep' },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('keep');
    });

    it('fills defaults for missing fields', () => {
      const [entry] = sanitizeSkillEntries([{ name: 'foo' }]);
      expect(entry).toEqual({
        name: 'foo',
        description: '',
        version: '1.0.0',
        remoteVersion: '',
        source: 'ON-DEVICE',
      });
    });

    it('preserves IN-LIBRARY and coerces non-IN-LIBRARY sources to ON-DEVICE', () => {
      const result = sanitizeSkillEntries([
        { name: 'a', source: 'IN-LIBRARY' },
        { name: 'b', source: 'ON-DEVICE' },
        { name: 'c', source: 'WHATEVER' },
        { name: 'd' },
      ]);
      expect(result.map(s => s.source)).toEqual(['IN-LIBRARY', 'ON-DEVICE', 'ON-DEVICE', 'ON-DEVICE']);
    });

    it('drops orphaned plugin skills carrying the retired source: PLUGIN', () => {
      const result = sanitizeSkillEntries([
        { name: 'plugin--foo--bar', source: 'PLUGIN' },
        { name: 'keep', source: 'ON-DEVICE' },
        { name: 'lib', source: 'IN-LIBRARY' },
      ]);
      expect(result.map(s => s.name)).toEqual(['keep', 'lib']);
      expect(result.map(s => s.source)).toEqual(['ON-DEVICE', 'IN-LIBRARY']);
    });

    it('drops orphaned plugin skills by plugin-- name even when source was coerced', () => {
      const result = sanitizeSkillEntries([
        { name: 'plugin--foo--bar', source: 'ON-DEVICE' },
        { name: 'plugin--foo--baz' },
        { name: 'keep', source: 'ON-DEVICE' },
      ]);
      expect(result.map(s => s.name)).toEqual(['keep']);
    });
  });

  describe('isRetiredPluginSkillEntry', () => {
    it('returns false for non-object entries', () => {
      expect(isRetiredPluginSkillEntry(null)).toBe(false);
      expect(isRetiredPluginSkillEntry(undefined)).toBe(false);
      expect(isRetiredPluginSkillEntry('plugin--foo--bar')).toBe(false);
      expect(isRetiredPluginSkillEntry(42)).toBe(false);
    });

    it('returns true for the retired PLUGIN source', () => {
      expect(isRetiredPluginSkillEntry({ name: 'whatever', source: 'PLUGIN' })).toBe(true);
    });

    it('returns true for the plugin-- name convention regardless of source', () => {
      expect(isRetiredPluginSkillEntry({ name: 'plugin--foo--bar', source: 'ON-DEVICE' })).toBe(true);
      expect(isRetiredPluginSkillEntry({ name: 'plugin--foo--bar' })).toBe(true);
    });

    it('returns false for normal skills and nameless entries', () => {
      expect(isRetiredPluginSkillEntry({ name: 'real', source: 'ON-DEVICE' })).toBe(false);
      expect(isRetiredPluginSkillEntry({ name: 'real', source: 'IN-LIBRARY' })).toBe(false);
      expect(isRetiredPluginSkillEntry({ source: 'ON-DEVICE' })).toBe(false);
    });

    it('coerces non-string and empty version/description/remoteVersion', () => {
      const [entry] = sanitizeSkillEntries([
        { name: 'foo', description: 123, version: '', remoteVersion: 5 },
      ]);
      expect(entry.description).toBe('');
      expect(entry.version).toBe('1.0.0');
      expect(entry.remoteVersion).toBe('');
    });

    it('keeps provided valid values', () => {
      const [entry] = sanitizeSkillEntries([makeSkill({ name: 'x', version: '9.9.9', remoteVersion: '8.8.8', source: 'IN-LIBRARY' })]);
      expect(entry).toEqual({
        name: 'x',
        description: 'demo skill',
        version: '9.9.9',
        remoteVersion: '8.8.8',
        source: 'IN-LIBRARY',
      });
    });
  });

  describe('writeSkillsFile', () => {
    it('writes a versioned payload with sanitized skills', async () => {
      await writeSkillsFile(profileDir, [makeSkill({ name: 'one' }), { name: '' } as SkillConfig]);
      const raw = readRawSkillsFile();
      expect(raw.version).toBe(SKILLS_FILE_VERSION);
      expect(typeof raw.updatedAt).toBe('string');
      expect(raw.skills).toHaveLength(1);
      expect(raw.skills[0].name).toBe('one');
    });

    it('creates the profile directory when missing', async () => {
      const nested = path.join(profileDir, 'deep', 'child');
      await writeSkillsFile(nested, [makeSkill()]);
      expect(fs.existsSync(getSkillsFilePath(nested))).toBe(true);
    });
  });

  describe('readSkillsFile', () => {
    it('returns null when the file does not exist', async () => {
      expect(await readSkillsFile(profileDir)).toBeNull();
    });

    it('returns sanitized skills when the file is valid', async () => {
      await writeSkillsFile(profileDir, [makeSkill({ name: 'alpha' })]);
      const skills = await readSkillsFile(profileDir);
      expect(skills).not.toBeNull();
      expect(skills!.map(s => s.name)).toEqual(['alpha']);
    });

    it('backs up and returns null when the file is invalid JSON', async () => {
      fs.writeFileSync(getSkillsFilePath(profileDir), '{ not json', 'utf-8');
      expect(await readSkillsFile(profileDir)).toBeNull();
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('skills.json.corrupt-'));
      expect(backups).toHaveLength(1);
      expect(fs.existsSync(getSkillsFilePath(profileDir))).toBe(false);
    });

    it('backs up and returns null when the shape is wrong (no skills array)', async () => {
      fs.writeFileSync(getSkillsFilePath(profileDir), JSON.stringify({ version: '2.0.0', skills: 'oops' }), 'utf-8');
      expect(await readSkillsFile(profileDir)).toBeNull();
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('skills.json.corrupt-'));
      expect(backups).toHaveLength(1);
    });

    it('backs up and returns null when an element is a primitive (structurally broken)', async () => {
      fs.writeFileSync(
        getSkillsFilePath(profileDir),
        JSON.stringify({ version: '2.0.0', skills: [null, 'oops', 42] }),
        'utf-8',
      );
      expect(await readSkillsFile(profileDir)).toBeNull();
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('skills.json.corrupt-'));
      expect(backups).toHaveLength(1);
    });

    it('drops nameless objects via the sanitizer without treating the file as corrupt', async () => {
      fs.writeFileSync(
        getSkillsFilePath(profileDir),
        JSON.stringify({ version: '2.0.0', skills: [{ description: 'x' }, makeSkill({ name: 'keep' })] }),
        'utf-8',
      );
      const skills = await readSkillsFile(profileDir);
      expect(skills).not.toBeNull();
      expect(skills!.map(s => s.name)).toEqual(['keep']);
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('skills.json.corrupt-'));
      expect(backups).toHaveLength(0);
    });
  });

  describe('loadSkillsForProfile', () => {
    it('migrates legacy inline skills when skills.json is missing', async () => {
      const result = await loadSkillsForProfile(profileDir, {
        skills: [makeSkill({ name: 'legacy', source: 'IN-LIBRARY' })],
      });
      expect(result.needsProfileRewrite).toBe(true);
      expect(result.skills.map(s => s.name)).toEqual(['legacy']);
      expect(fs.existsSync(getSkillsFilePath(profileDir))).toBe(true);
      expect(readRawSkillsFile().skills[0].name).toBe('legacy');
    });

    it('writes an empty skills.json for a fresh profile with no legacy skills', async () => {
      const result = await loadSkillsForProfile(profileDir, {});
      expect(result.needsProfileRewrite).toBe(true);
      expect(result.skills).toEqual([]);
      expect(readRawSkillsFile().skills).toEqual([]);
    });

    it('keeps skills.json authoritative but rewrites profile to strip a lingering legacy inline slice', async () => {
      await writeSkillsFile(profileDir, [makeSkill({ name: 'stored' })]);
      const result = await loadSkillsForProfile(profileDir, {
        skills: [makeSkill({ name: 'ignored-legacy' })],
      });
      expect(result.needsProfileRewrite).toBe(true);
      expect(result.skills.map(s => s.name)).toEqual(['stored']);
    });

    it('does not request a rewrite when skills.json is authoritative and no legacy inline remains', async () => {
      await writeSkillsFile(profileDir, [makeSkill({ name: 'stored' })]);
      const result = await loadSkillsForProfile(profileDir, {});
      expect(result.needsProfileRewrite).toBe(false);
      expect(result.skills.map(s => s.name)).toEqual(['stored']);
    });

    it('is idempotent: a second load of the stripped profile does not request a rewrite', async () => {
      const first = await loadSkillsForProfile(profileDir, { skills: [makeSkill({ name: 'x' })] });
      expect(first.needsProfileRewrite).toBe(true);
      // After the first migration strips profile.json, the re-read profile carries no inline skills.
      const second = await loadSkillsForProfile(profileDir, {});
      expect(second.needsProfileRewrite).toBe(false);
      expect(second.skills.map(s => s.name)).toEqual(['x']);
    });

    it('re-requests the profile rewrite while a legacy inline slice still lingers', async () => {
      const first = await loadSkillsForProfile(profileDir, { skills: [makeSkill({ name: 'x' })] });
      expect(first.needsProfileRewrite).toBe(true);
      // Simulates a prior migration whose profile.json strip failed: the inline slice persists,
      // so every subsequent load must keep asking to finish stripping it.
      const second = await loadSkillsForProfile(profileDir, { skills: [makeSkill({ name: 'x' })] });
      expect(second.needsProfileRewrite).toBe(true);
      expect(second.skills.map(s => s.name)).toEqual(['x']);
    });

    it('recovers from a corrupt skills.json by backing up and re-deriving from legacy skills', async () => {
      fs.writeFileSync(getSkillsFilePath(profileDir), 'totally broken', 'utf-8');
      const result = await loadSkillsForProfile(profileDir, {
        skills: [makeSkill({ name: 'recovered' })],
      });
      expect(result.needsProfileRewrite).toBe(true);
      expect(result.skills.map(s => s.name)).toEqual(['recovered']);
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('skills.json.corrupt-'));
      expect(backups).toHaveLength(1);
      expect(readRawSkillsFile().skills[0].name).toBe('recovered');
    });

    it('round-trips skills written then loaded', async () => {
      const skills = [makeSkill({ name: 'a' }), makeSkill({ name: 'b', source: 'ON-DEVICE' })];
      await writeSkillsFile(profileDir, skills);
      const result = await loadSkillsForProfile(profileDir, {});
      expect(result.skills).toEqual(skills);
    });

    it('durably rewrites skills.json to drop retired plugin skills it still held', async () => {
      // Write a raw sidecar still carrying plugin entries (writeSkillsFile would
      // sanitize them away, so we bypass it to simulate a pre-removal file).
      fs.writeFileSync(
        getSkillsFilePath(profileDir),
        JSON.stringify({
          version: SKILLS_FILE_VERSION,
          updatedAt: '2020-01-01T00:00:00.000Z',
          skills: [
            { name: 'plugin--foo--bar', description: '', version: '1.0.0', remoteVersion: '', source: 'PLUGIN' },
            { name: 'plugin--foo--legacy', description: '', version: '1.0.0', remoteVersion: '', source: 'ON-DEVICE' },
            makeSkill({ name: 'keep' }),
          ],
        }),
        'utf-8',
      );
      const result = await loadSkillsForProfile(profileDir, {});
      expect(result.skills.map(s => s.name)).toEqual(['keep']);
      // The sidecar was healed on disk: plugin entries are gone, not just filtered on read.
      const raw = readRawSkillsFile();
      expect(raw.skills.map(s => s.name)).toEqual(['keep']);
      expect(raw.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('does not rewrite skills.json when it holds no retired plugin skills', async () => {
      const original = JSON.stringify({
        version: SKILLS_FILE_VERSION,
        updatedAt: '2020-01-01T00:00:00.000Z',
        skills: [makeSkill({ name: 'keep' })],
      });
      fs.writeFileSync(getSkillsFilePath(profileDir), original, 'utf-8');
      await loadSkillsForProfile(profileDir, {});
      // No plugin entries → no heal write → the file (including updatedAt) is untouched.
      expect(fs.readFileSync(getSkillsFilePath(profileDir), 'utf-8')).toBe(original);
    });
  });
});
