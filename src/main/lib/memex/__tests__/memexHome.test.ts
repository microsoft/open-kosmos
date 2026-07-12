import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { buildAgentMemexHome, buildMemexHome, buildProfileMemexHome, ensureHome } from '../memexHome';

const tmpRoots: string[] = [];

async function makeTmpUserData(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'memex-home-'));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('buildMemexHome', () => {
  it('composes the per-agent tree under profiles/<alias>/agents/<agentId>/memory', () => {
    const home = buildMemexHome('/data', 'alice', 'agent-1');
    expect(home.root).toBe(path.join('/data', 'profiles', 'alice', 'agents', 'agent-1', 'memory'));
    expect(home.cardsDir).toBe(path.join(home.root, 'cards'));
    expect(home.archiveDir).toBe(path.join(home.root, 'archive'));
  });

  it('buildAgentMemexHome matches the backwards-compatible buildMemexHome path', () => {
    expect(buildAgentMemexHome('/data', 'alice', 'agent-1')).toEqual(
      buildMemexHome('/data', 'alice', 'agent-1'),
    );
  });

  it('isolates memory by agentId (different agents -> different roots)', () => {
    const a = buildMemexHome('/data', 'alice', 'agent-1');
    const b = buildMemexHome('/data', 'alice', 'agent-2');
    expect(a.root).not.toBe(b.root);
  });

  describe('buildProfileMemexHome', () => {
    it('composes the shared profile-memory tree under profiles/<alias>/profile-memory', () => {
      const home = buildProfileMemexHome('/data', 'alice');
      expect(home.root).toBe(path.join('/data', 'profiles', 'alice', 'profile-memory'));
      expect(home.cardsDir).toBe(path.join(home.root, 'cards'));
      expect(home.archiveDir).toBe(path.join(home.root, 'archive'));
    });

    it('isolates profile memory by alias', () => {
      const a = buildProfileMemexHome('/data', 'alice');
      const b = buildProfileMemexHome('/data', 'bob');
      expect(a.root).not.toBe(b.root);
    });

    it('throws when userDataDir is empty', () => {
      expect(() => buildProfileMemexHome('', 'alice')).toThrow(/userDataDir is required/);
    });

    it('throws when alias is empty', () => {
      expect(() => buildProfileMemexHome('/data', '')).toThrow(/alias is required/);
    });

    for (const [label, value] of [
      ['absolute path', '/abs'],
      ['forward-slash separator', 'a/b'],
      ['back-slash separator', 'a\\b'],
      ['dot segment', '.'],
      ['dot-dot traversal', '..'],
    ] as Array<[string, string]>) {
      it(`throws when alias is a ${label} (${JSON.stringify(value)})`, () => {
        expect(() => buildProfileMemexHome('/data', value)).toThrow(/alias must be a single path segment/);
      });
    }
  });

  it('isolates memory by alias (different users → different roots)', () => {
    const a = buildMemexHome('/data', 'alice', 'agent-1');
    const b = buildMemexHome('/data', 'bob', 'agent-1');
    expect(a.root).not.toBe(b.root);
  });

  it('throws when userDataDir is empty', () => {
    expect(() => buildMemexHome('', 'alice', 'agent-1')).toThrow(/userDataDir is required/);
  });

  it('throws when alias is empty', () => {
    expect(() => buildMemexHome('/data', '', 'agent-1')).toThrow(/alias is required/);
  });

  it('throws when agentId is empty', () => {
    expect(() => buildMemexHome('/data', 'alice', '')).toThrow(/agentId is required/);
  });

  // ── path-traversal guard ──────────────────────────────────────────────────
  // alias and agentId are interpolated into the home path; a separator, a
  // `.`/`..` segment, or an absolute path would let one agent escape into
  // another agent's (or user's) memory tree. Each case targets a distinct OR
  // arm of assertSafeSegment, asserted for BOTH the alias and agentId positions.
  const malicious: Array<[string, string]> = [
    ['absolute path', '/abs'],
    ['forward-slash separator', 'a/b'],
    ['back-slash separator', 'a\\b'],
    ['dot segment', '.'],
    ['dot-dot traversal', '..'],
  ];

  for (const [label, value] of malicious) {
    it(`throws when alias is a ${label} (${JSON.stringify(value)})`, () => {
      expect(() => buildMemexHome('/data', value, 'agent-1')).toThrow(/alias must be a single path segment/);
    });

    it(`throws when agentId is a ${label} (${JSON.stringify(value)})`, () => {
      expect(() => buildMemexHome('/data', 'alice', value)).toThrow(/agentId must be a single path segment/);
    });
  }

  it('rejects a realistic agentId traversal payload', () => {
    expect(() =>
      buildMemexHome('/data', 'alice', '../../bob/agents/agent-x/memory'),
    ).toThrow(/agentId must be a single path segment/);
  });

  it('accepts a realistic agentId and alias (no separators or traversal)', () => {
    const home = buildMemexHome('/data', 'sample-user', 'agent_20260609114803_dev-1_5val9ka8s');
    expect(home.root).toBe(
      path.join('/data', 'profiles', 'sample-user', 'agents', 'agent_20260609114803_dev-1_5val9ka8s', 'memory'),
    );
  });
});

describe('ensureHome', () => {
  it('creates the cards directory tree', async () => {
    const userData = await makeTmpUserData();
    const home = buildMemexHome(userData, 'alice', 'agent-1');
    await ensureHome(home);
    const s = await stat(home.cardsDir);
    expect(s.isDirectory()).toBe(true);
  });

  it('is idempotent (second call does not throw)', async () => {
    const userData = await makeTmpUserData();
    const home = buildMemexHome(userData, 'alice', 'agent-1');
    await ensureHome(home);
    await expect(ensureHome(home)).resolves.toBeUndefined();
  });
});
