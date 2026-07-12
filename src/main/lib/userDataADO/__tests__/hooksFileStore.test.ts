import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HOOKS_FILE_NAME,
  getHooksFilePath,
  fingerprintHooks,
  loadHooksForProfile,
  readHooksFile,
  sanitizeHookEntries,
  writeHooksFile,
} from '../hooksFileStore';
import { HOOKS_FILE_VERSION, HookDefinition } from '../types/profile';

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: 'h1',
    name: 'Hook h1',
    version: '1.0.0',
    remoteVersion: '',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('hooksFileStore', () => {
  let profileDir: string;

  beforeEach(() => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-store-'));
  });

  afterEach(() => {
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  function readRawHooksFile(): { version: string; updatedAt: string; hooks: HookDefinition[] } {
    return JSON.parse(fs.readFileSync(getHooksFilePath(profileDir), 'utf-8'));
  }

  describe('getHooksFilePath', () => {
    it('joins the profile directory with hooks.json', () => {
      expect(getHooksFilePath('/tmp/profiles/alice')).toBe(path.join('/tmp/profiles/alice', HOOKS_FILE_NAME));
      expect(HOOKS_FILE_NAME).toBe('hooks.json');
    });
  });

  describe('sanitizeHookEntries', () => {
    it('returns [] for non-array input', () => {
      expect(sanitizeHookEntries(undefined)).toEqual([]);
      expect(sanitizeHookEntries(null)).toEqual([]);
      expect(sanitizeHookEntries('nope')).toEqual([]);
      expect(sanitizeHookEntries({ hooks: [] })).toEqual([]);
    });

    it('drops entries lacking an id, a valid event, or a valid action', () => {
      const result = sanitizeHookEntries([
        null,
        'string',
        { id: '', event: 'PreToolUse', action: { type: 'command', command: 'x' } },
        { id: 'bad-event', event: 'Nope', action: { type: 'command', command: 'x' } },
        { id: 'bad-action', event: 'PreToolUse', action: { type: 'command' } },
        makeHook({ id: 'keep' }),
      ]);
      expect(result.map(h => h.id)).toEqual(['keep']);
    });

    it('drops duplicate ids, keeping the first occurrence', () => {
      const result = sanitizeHookEntries([
        makeHook({ id: 'dup', name: 'first' }),
        makeHook({ id: 'dup', name: 'second' }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('first');
    });

    it('round-trips a fully specified hook unchanged', () => {
      expect(sanitizeHookEntries([makeHook()])).toEqual([makeHook()]);
    });
  });

  describe('writeHooksFile', () => {
    it('writes a versioned payload with sanitized hooks', async () => {
      await writeHooksFile(profileDir, [
        makeHook({ id: 'one' }),
        { id: '', event: 'PreToolUse', action: { type: 'command', command: 'x' } } as HookDefinition,
      ]);
      const raw = readRawHooksFile();
      expect(raw.version).toBe(HOOKS_FILE_VERSION);
      expect(typeof raw.updatedAt).toBe('string');
      expect(raw.hooks).toHaveLength(1);
      expect(raw.hooks[0].id).toBe('one');
    });

    it('creates the profile directory when missing', async () => {
      const nested = path.join(profileDir, 'deep', 'child');
      await writeHooksFile(nested, [makeHook()]);
      expect(fs.existsSync(getHooksFilePath(nested))).toBe(true);
    });
  });

  describe('readHooksFile', () => {
    it('returns null when the file does not exist', async () => {
      expect(await readHooksFile(profileDir)).toBeNull();
    });

    it('returns sanitized hooks when the file is valid', async () => {
      await writeHooksFile(profileDir, [makeHook({ id: 'alpha' })]);
      const hooks = await readHooksFile(profileDir);
      expect(hooks).not.toBeNull();
      expect(hooks!.map(h => h.id)).toEqual(['alpha']);
    });

    it('backs up and returns null when the file is invalid JSON', async () => {
      fs.writeFileSync(getHooksFilePath(profileDir), '{ not json', 'utf-8');
      expect(await readHooksFile(profileDir)).toBeNull();
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('hooks.json.corrupt-'));
      expect(backups).toHaveLength(1);
      expect(fs.existsSync(getHooksFilePath(profileDir))).toBe(false);
    });

    it('backs up and returns null when the shape is wrong (no hooks array)', async () => {
      fs.writeFileSync(getHooksFilePath(profileDir), JSON.stringify({ version: '1.0.0', hooks: 'oops' }), 'utf-8');
      expect(await readHooksFile(profileDir)).toBeNull();
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('hooks.json.corrupt-'));
      expect(backups).toHaveLength(1);
    });

    it('backs up and returns null when an element is a primitive (structurally broken)', async () => {
      fs.writeFileSync(
        getHooksFilePath(profileDir),
        JSON.stringify({ version: '1.0.0', hooks: [null, 'oops', 42] }),
        'utf-8',
      );
      expect(await readHooksFile(profileDir)).toBeNull();
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('hooks.json.corrupt-'));
      expect(backups).toHaveLength(1);
    });

    it('drops malformed objects via the sanitizer without treating the file as corrupt', async () => {
      fs.writeFileSync(
        getHooksFilePath(profileDir),
        JSON.stringify({ version: '1.0.0', hooks: [{ description: 'x' }, makeHook({ id: 'keep' })] }),
        'utf-8',
      );
      const hooks = await readHooksFile(profileDir);
      expect(hooks).not.toBeNull();
      expect(hooks!.map(h => h.id)).toEqual(['keep']);
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('hooks.json.corrupt-'));
      expect(backups).toHaveLength(0);
    });
  });

  describe('fingerprintHooks', () => {
    it('is stable for the same hooks and excludes the file-level updatedAt', () => {
      const a = fingerprintHooks([makeHook()]);
      const b = fingerprintHooks([makeHook()]);
      expect(a).toBe(b);
    });

    it('changes when a hook content field (including per-hook updatedAt) changes', () => {
      const base = fingerprintHooks([makeHook()]);
      expect(fingerprintHooks([makeHook({ enabled: false })])).not.toBe(base);
      expect(fingerprintHooks([makeHook({ updatedAt: '2099-01-01T00:00:00Z' })])).not.toBe(base);
    });

    it('treats a non-array as an empty library', () => {
      expect(fingerprintHooks(undefined as unknown as HookDefinition[])).toBe(
        fingerprintHooks([]),
      );
    });
  });

  describe('loadHooksForProfile', () => {
    it('migrates legacy inline hooks when hooks.json is missing', async () => {
      const result = await loadHooksForProfile(profileDir, {
        hooks: [makeHook({ id: 'legacy', source: 'IN-LIBRARY' })],
      });
      expect(result.needsProfileRewrite).toBe(true);
      expect(result.hooks.map(h => h.id)).toEqual(['legacy']);
      expect(fs.existsSync(getHooksFilePath(profileDir))).toBe(true);
      expect(readRawHooksFile().hooks[0].id).toBe('legacy');
    });

    it('writes an empty hooks.json for a fresh profile with no legacy hooks', async () => {
      const result = await loadHooksForProfile(profileDir, {});
      expect(result.needsProfileRewrite).toBe(true);
      expect(result.hooks).toEqual([]);
      expect(readRawHooksFile().hooks).toEqual([]);
    });

    it('keeps hooks.json authoritative but rewrites profile to strip a lingering legacy inline slice', async () => {
      await writeHooksFile(profileDir, [makeHook({ id: 'stored' })]);
      const result = await loadHooksForProfile(profileDir, {
        hooks: [makeHook({ id: 'ignored-legacy' })],
      });
      expect(result.needsProfileRewrite).toBe(true);
      expect(result.hooks.map(h => h.id)).toEqual(['stored']);
    });

    it('does not request a rewrite when hooks.json is authoritative and no legacy inline remains', async () => {
      await writeHooksFile(profileDir, [makeHook({ id: 'stored' })]);
      const result = await loadHooksForProfile(profileDir, {});
      expect(result.needsProfileRewrite).toBe(false);
      expect(result.hooks.map(h => h.id)).toEqual(['stored']);
    });

    it('is idempotent: a second load of the stripped profile does not request a rewrite', async () => {
      const first = await loadHooksForProfile(profileDir, { hooks: [makeHook({ id: 'x' })] });
      expect(first.needsProfileRewrite).toBe(true);
      const second = await loadHooksForProfile(profileDir, {});
      expect(second.needsProfileRewrite).toBe(false);
      expect(second.hooks.map(h => h.id)).toEqual(['x']);
    });

    it('re-requests the profile rewrite while a legacy inline slice still lingers', async () => {
      const first = await loadHooksForProfile(profileDir, { hooks: [makeHook({ id: 'x' })] });
      expect(first.needsProfileRewrite).toBe(true);
      const second = await loadHooksForProfile(profileDir, { hooks: [makeHook({ id: 'x' })] });
      expect(second.needsProfileRewrite).toBe(true);
      expect(second.hooks.map(h => h.id)).toEqual(['x']);
    });

    it('recovers from a corrupt hooks.json by backing up and re-deriving from legacy hooks', async () => {
      fs.writeFileSync(getHooksFilePath(profileDir), 'totally broken', 'utf-8');
      const result = await loadHooksForProfile(profileDir, {
        hooks: [makeHook({ id: 'recovered' })],
      });
      expect(result.needsProfileRewrite).toBe(true);
      expect(result.hooks.map(h => h.id)).toEqual(['recovered']);
      const backups = fs.readdirSync(profileDir).filter(f => f.includes('hooks.json.corrupt-'));
      expect(backups).toHaveLength(1);
      expect(readRawHooksFile().hooks[0].id).toBe('recovered');
    });

    it('round-trips hooks written then loaded', async () => {
      const hooks = [makeHook({ id: 'a' }), makeHook({ id: 'b', source: 'IN-LIBRARY' })];
      await writeHooksFile(profileDir, hooks);
      const result = await loadHooksForProfile(profileDir, {});
      expect(result.hooks).toEqual(hooks);
    });
  });
});
