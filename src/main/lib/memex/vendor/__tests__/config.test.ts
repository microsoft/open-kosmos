import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  readConfig,
  findMemexrcUp,
  resolveMemexHome,
  warnIfEmptyCards,
} from '../lib/config';

// Direct unit tests for the vendored memex config loader. This is vendored from
// iamtouchskyer/memex but lives in our tree, so it is tested like any other
// first-party file (no allowlist exemption) against real temp directories.

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memex-config-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('readConfig', () => {
  it('returns defaults when no .memexrc exists', async () => {
    const cfg = await readConfig(home);
    expect(cfg).toEqual({ nestedSlugs: false });
  });

  it('returns defaults when .memexrc is invalid JSON', async () => {
    await writeFile(join(home, '.memexrc'), '{ not valid json', 'utf-8');
    const cfg = await readConfig(home);
    expect(cfg).toEqual({ nestedSlugs: false });
  });

  it('parses nestedSlugs, searchDirs, and extraLinkDirs from a valid file', async () => {
    await writeFile(
      join(home, '.memexrc'),
      JSON.stringify({
        nestedSlugs: true,
        searchDirs: ['a', 'b'],
        extraLinkDirs: ['refs'],
      }),
      'utf-8',
    );
    const cfg = await readConfig(home);
    expect(cfg.nestedSlugs).toBe(true);
    expect(cfg.searchDirs).toEqual(['a', 'b']);
    expect(cfg.extraLinkDirs).toEqual(['refs']);
  });

  it('coerces non-array searchDirs/extraLinkDirs to undefined and non-true nestedSlugs to false', async () => {
    await writeFile(
      join(home, '.memexrc'),
      JSON.stringify({ nestedSlugs: 'yes', searchDirs: 'a', extraLinkDirs: 42 }),
      'utf-8',
    );
    const cfg = await readConfig(home);
    expect(cfg.nestedSlugs).toBe(false);
    expect(cfg.searchDirs).toBeUndefined();
    expect(cfg.extraLinkDirs).toBeUndefined();
  });

  it('parses experimental.agenticMemory when explicitly true', async () => {
    await writeFile(
      join(home, '.memexrc'),
      JSON.stringify({ experimental: { agenticMemory: true } }),
      'utf-8',
    );
    const cfg = await readConfig(home);
    expect(cfg.experimental).toEqual({ agenticMemory: true });
  });

  it('drops experimental when agenticMemory is absent or not true', async () => {
    await writeFile(
      join(home, '.memexrc'),
      JSON.stringify({ experimental: { agenticMemory: false, other: 1 } }),
      'utf-8',
    );
    const cfg = await readConfig(home);
    expect(cfg.experimental).toBeUndefined();
  });

  it('drops experimental when the value is not an object', async () => {
    await writeFile(
      join(home, '.memexrc'),
      JSON.stringify({ experimental: ['array', 'not', 'object'] }),
      'utf-8',
    );
    const cfg = await readConfig(home);
    expect(cfg.experimental).toBeUndefined();
  });

  it('drops experimental when the value is null', async () => {
    await writeFile(
      join(home, '.memexrc'),
      JSON.stringify({ experimental: null }),
      'utf-8',
    );
    const cfg = await readConfig(home);
    expect(cfg.experimental).toBeUndefined();
  });
});

describe('findMemexrcUp', () => {
  it('finds a .memexrc in the starting directory', async () => {
    await writeFile(join(home, '.memexrc'), '{}', 'utf-8');
    const found = await findMemexrcUp(home);
    expect(found).toBe(home);
  });

  it('walks up to an ancestor containing .memexrc', async () => {
    await writeFile(join(home, '.memexrc'), '{}', 'utf-8');
    const nested = join(home, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });
    const found = await findMemexrcUp(nested);
    expect(found).toBe(home);
  });

  it('returns undefined when no .memexrc exists up to the root', async () => {
    const nested = join(home, 'x', 'y');
    await mkdir(nested, { recursive: true });
    const found = await findMemexrcUp(nested);
    expect(found).toBeUndefined();
  });
});

describe('resolveMemexHome', () => {
  const savedEnv = process.env.MEMEX_HOME;
  const savedCwd = process.cwd();

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.MEMEX_HOME;
    else process.env.MEMEX_HOME = savedEnv;
    process.chdir(savedCwd);
  });

  it('prefers the MEMEX_HOME environment variable', async () => {
    process.env.MEMEX_HOME = '/explicit/memex/home';
    expect(await resolveMemexHome()).toBe('/explicit/memex/home');
  });

  it('falls back to walk-up discovery from cwd when MEMEX_HOME is unset', async () => {
    delete process.env.MEMEX_HOME;
    await writeFile(join(home, '.memexrc'), '{}', 'utf-8');
    const nested = join(home, 'deep');
    await mkdir(nested, { recursive: true });
    process.chdir(nested);
    // process.cwd() resolves symlinks (e.g. macOS /var -> /private/var), so the
    // discovered home comes back as a realpath; compare against the realpath too.
    expect(await resolveMemexHome()).toBe(await realpath(home));
  });

  it('falls back to ~/.memex when neither env nor .memexrc is present', async () => {
    delete process.env.MEMEX_HOME;
    // A fresh temp dir with no .memexrc anywhere up the chain we control. When
    // walk-up discovery finds nothing, the function returns homedir()/.memex.
    const onlyDir = await mkdtemp(join(tmpdir(), 'memex-norc-'));
    process.chdir(onlyDir);
    expect(await resolveMemexHome()).toBe(join(homedir(), '.memex'));
    await rm(onlyDir, { recursive: true, force: true });
  });
});

describe('warnIfEmptyCards', () => {
  let writes: string[];
  let original: typeof process.stderr.write;

  beforeEach(() => {
    writes = [];
    original = process.stderr.write;
    // Capture stderr writes without printing during the test run.
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = original;
  });

  it('warns when the cards directory does not exist', async () => {
    await warnIfEmptyCards(home);
    expect(writes.join('')).toContain('cards directory not found');
  });

  it('warns when the cards directory is empty', async () => {
    await mkdir(join(home, 'cards'));
    await warnIfEmptyCards(home);
    expect(writes.join('')).toContain('cards directory is empty');
  });

  it('does not warn when the cards directory has entries', async () => {
    await mkdir(join(home, 'cards'));
    await writeFile(join(home, 'cards', 'note.md'), '# note', 'utf-8');
    await warnIfEmptyCards(home);
    expect(writes.join('')).toBe('');
  });
});
