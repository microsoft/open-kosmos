/**
 * mcpConfigManager.test.ts
 *
 * Unit tests for `McpConfigManager`, the runtime owner of installed global MCP
 * servers (`mcp.json`). These run against a real temp profiles directory with the
 * real atomic writer / file store so the in-memory cache, the load handoff
 * (`resolveFromDisk` / `commitResolvedServers`), the dirty-checked write with its
 * own `updatedAt`, the CRUD mutators, corrupt-file backup, and the per-alias write
 * lock are all exercised end to end.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Capture the real rename before any spy replaces it, so a simulated transient
// rename failure can still recover on retry.
const realRename = fs.promises.rename.bind(fs.promises);

const pathState = vi.hoisted(() => ({ root: '' }));

const loggerState = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: () => loggerState,
}));

// Redirect the manager's mcp.json location into a per-test temp directory and
// create the alias directory (the real getProfileDirectoryPath also ensures it,
// and the atomic writer does NOT create parent directories itself).
vi.mock('../pathUtils', () => {
  const nodePath = require('path');
  const nodeFs = require('fs');
  return {
    getProfileDirectoryPath: (alias: string) => {
      const dir = nodePath.join(pathState.root, 'profiles', alias);
      nodeFs.mkdirSync(dir, { recursive: true });
      return dir;
    },
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mcpConfigManager, McpConfigManager } from '../mcpConfigManager';
import {
  MCP_FILE_VERSION,
  serializeMcpFile,
  writeMcpFile,
} from '../mcpFileStore';
import { sanitizeMcpServerList } from '../profileSanitizer';
import type { McpServerConfig } from '../types/profile';

function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'srv',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: {},
    url: '',
    in_use: true,
    version: '1.0.0',
    remoteVersion: '',
    source: 'ON-DEVICE',
    ...overrides,
  } as McpServerConfig;
}

function mcpDir(alias: string): string {
  return path.join(pathState.root, 'profiles', alias);
}

function mcpPath(alias: string): string {
  return path.join(mcpDir(alias), 'mcp.json');
}

function ensureDir(alias: string): void {
  fs.mkdirSync(mcpDir(alias), { recursive: true });
}

function readMcp(alias: string): { version: string; updatedAt: string; mcp_servers: McpServerConfig[] } {
  return JSON.parse(fs.readFileSync(mcpPath(alias), 'utf-8'));
}

beforeEach(() => {
  loggerState.warn.mockClear();
  loggerState.error.mockClear();
  loggerState.info.mockClear();
  loggerState.debug.mockClear();
  mcpConfigManager.clearCache();
  pathState.root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-mgr-'));
});

afterEach(() => {
  mcpConfigManager.clearCache();
  vi.restoreAllMocks();
  fs.rmSync(pathState.root, { recursive: true, force: true });
});

describe('McpConfigManager — synchronous reads', () => {
  it('returns an empty installed server set and null server info when an alias is not loaded', () => {
    expect(mcpConfigManager.getServers('nobody')).toEqual([]);
    expect(mcpConfigManager.getServerInfo('nobody', 'srv')).toBeNull();
    expect(mcpConfigManager.hasServersLoaded('nobody')).toBe(false);
    expect(mcpConfigManager.hasPersistedServers('nobody')).toBe(false);
  });

  it('returns cached servers, finds by name, and reports a missing name as null', async () => {
    await mcpConfigManager.commitResolvedServers('alice', [
      makeServer({ name: 'a' }),
      makeServer({ name: 'b' }),
    ]);

    expect(mcpConfigManager.hasServersLoaded('alice')).toBe(true);
    expect(mcpConfigManager.hasPersistedServers('alice')).toBe(true);
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['a', 'b']);
    expect(mcpConfigManager.getServerInfo('alice', 'b')?.name).toBe('b');
    // Loaded, but no server with that name → null (distinct from the not-loaded case).
    expect(mcpConfigManager.getServerInfo('alice', 'missing')).toBeNull();
  });
});

describe('McpConfigManager — resolveFromDisk (load handoff)', () => {
  it('caches the servers from a present, valid mcp.json and primes the fingerprint', async () => {
    ensureDir('alice');
    await writeMcpFile(mcpPath('alice'), [makeServer({ name: 'fromDisk' })], '2020-01-01T00:00:00.000Z');

    await mcpConfigManager.resolveFromDisk('alice');

    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['fromDisk']);

    // Fingerprint was primed from disk: committing identical installed server configs is a
    // no-op, so the file (and its updatedAt) is left untouched.
    const writeSpy = vi.spyOn(fs.promises, 'writeFile');
    await mcpConfigManager.commitResolvedServers('alice', sanitizeMcpServerList([makeServer({ name: 'fromDisk' })]));
    expect(writeSpy.mock.calls.filter(([p]) => String(p).includes('mcp.json'))).toHaveLength(0);
    expect(readMcp('alice').updatedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('strips retired plugin servers from a present mcp.json on load so getServers never exposes them', async () => {
    ensureDir('grace');
    // mcp.json on disk carries a normal server plus an orphaned plugin-injected one
    // (serializeMcpFile writes the slice verbatim, so the plugin entry reaches disk).
    await writeMcpFile(
      mcpPath('grace'),
      [makeServer({ name: 'kept' }), makeServer({ name: 'plugin--demo--ghost', source: 'PLUGIN' as any })],
      '2020-01-01T00:00:00.000Z',
    );

    await mcpConfigManager.resolveFromDisk('grace');

    // Sanitized on load: the cache the renderer payload re-injects has no plugin server.
    expect(mcpConfigManager.getServers('grace').map(s => s.name)).toEqual(['kept']);
  });

  it('seeds the cache from the legacy slice when mcp.json is absent and forces the next write', async () => {
    expect(fs.existsSync(mcpPath('bob'))).toBe(false);

    await mcpConfigManager.resolveFromDisk('bob', [makeServer({ name: 'legacy' })]);

    expect(mcpConfigManager.hasServersLoaded('bob')).toBe(true);
    expect(mcpConfigManager.getServers('bob').map(s => s.name)).toEqual(['legacy']);

    // Fingerprint was cleared (absent file) → committing the seed actually writes.
    await mcpConfigManager.commitResolvedServers('bob', mcpConfigManager.getServers('bob'));
    expect(fs.existsSync(mcpPath('bob'))).toBe(true);
    expect(readMcp('bob').mcp_servers.map(s => s.name)).toEqual(['legacy']);
  });

  it('caches an empty installed server set when mcp.json is absent and no legacy slice is provided', async () => {
    await mcpConfigManager.resolveFromDisk('carol');

    expect(mcpConfigManager.hasServersLoaded('carol')).toBe(true);
    expect(mcpConfigManager.getServers('carol')).toEqual([]);
  });

  it('backs up a corrupt mcp.json, caches an empty installed server set, and logs the backup', async () => {
    ensureDir('dora');
    fs.writeFileSync(mcpPath('dora'), '{ not valid json');

    await mcpConfigManager.resolveFromDisk('dora');

    expect(mcpConfigManager.getServers('dora')).toEqual([]);
    const backups = fs.readdirSync(mcpDir('dora')).filter(f => f.startsWith('mcp.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(mcpDir('dora'), backups[0]), 'utf-8'))).toMatchObject({
      backupRedaction: { reason: 'invalid-json-omitted', originalFileName: 'mcp.json' },
    });
    expect(loggerState.error).toHaveBeenCalledWith(
      expect.stringContaining('backed up redacted content'),
      'resolveFromDisk',
      expect.objectContaining({ alias: 'dora' }),
    );
  });

  it('does not throw and loads empty when backing up a corrupt mcp.json fails', async () => {
    ensureDir('erin');
    fs.writeFileSync(mcpPath('erin'), '{ not valid json');
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('write failed'));

    await mcpConfigManager.resolveFromDisk('erin');

    expect(mcpConfigManager.getServers('erin')).toEqual([]);
    const backups = fs.readdirSync(mcpDir('erin')).filter(f => f.startsWith('mcp.json.corrupt-'));
    expect(backups).toHaveLength(0);
    expect(loggerState.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to back up'),
      'resolveFromDisk',
      expect.objectContaining({ alias: 'erin', error: 'write failed' }),
    );
  });

  it('stringifies a non-Error backup failure when backing up a corrupt mcp.json', async () => {
    ensureDir('fred');
    fs.writeFileSync(mcpPath('fred'), '{ not valid json');
    // Reject with a non-Error value to exercise the String(error) fallback.
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce('disk gone');

    await mcpConfigManager.resolveFromDisk('fred');

    expect(mcpConfigManager.getServers('fred')).toEqual([]);
    expect(loggerState.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to back up'),
      'resolveFromDisk',
      expect.objectContaining({ alias: 'fred', error: 'disk gone' }),
    );
  });
});

describe('McpConfigManager — commitResolvedServers (dirty-checked persist)', () => {
  it('seeds mcp.json when the alias has no prior fingerprint', async () => {
    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'seed' })]);

    const onDisk = readMcp('alice');
    expect(onDisk.version).toBe(MCP_FILE_VERSION);
    expect(onDisk.mcp_servers.map(s => s.name)).toEqual(['seed']);
    expect(onDisk.updatedAt).not.toBe('');
  });

  it('skips the rewrite (and timestamp bump) when installed servers are unchanged', async () => {
    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'keep' })]);
    const firstUpdatedAt = readMcp('alice').updatedAt;

    const writeSpy = vi.spyOn(fs.promises, 'writeFile');
    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'keep' })]);

    expect(writeSpy.mock.calls.filter(([p]) => String(p).includes('mcp.json'))).toHaveLength(0);
    expect(readMcp('alice').updatedAt).toBe(firstUpdatedAt);
  });

  it('rewrites mcp.json and advances its own updatedAt when installed servers change', async () => {
    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'before' })]);
    const beforeUpdatedAt = readMcp('alice').updatedAt;
    await new Promise(resolve => setTimeout(resolve, 2));

    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'after' })]);

    const afterFile = readMcp('alice');
    expect(afterFile.mcp_servers.map(s => s.name)).toEqual(['after']);
    expect(afterFile.updatedAt).not.toBe(beforeUpdatedAt);
  });

  it('sanitizes installed server configs before persisting (drops unknown fields, fills defaults)', async () => {
    await mcpConfigManager.commitResolvedServers('alice', [
      { name: 'dirty', bogusField: 'nope' } as unknown as McpServerConfig,
    ]);

    const onDisk = readMcp('alice').mcp_servers[0];
    expect((onDisk as unknown as Record<string, unknown>).bogusField).toBeUndefined();
    expect(onDisk.transport).toBe('stdio');
    expect(onDisk.source).toBe('ON-DEVICE');
    expect(onDisk.in_use).toBe(false);
    // The in-memory cache reflects the same sanitized shape.
    expect((mcpConfigManager.getServers('alice')[0] as unknown as Record<string, unknown>).bogusField).toBeUndefined();
  });

  it('tolerates malformed installed server configs (null/primitive entries) without throwing', async () => {
    await expect(
      mcpConfigManager.commitResolvedServers('alice', [
        null,
        undefined,
        42,
        makeServer({ name: 'good' }),
      ] as unknown as McpServerConfig[]),
    ).resolves.toBeUndefined();

    const onDisk = readMcp('alice');
    expect(onDisk.mcp_servers.map(s => s.name)).toEqual(['good']);
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['good']);
  });

  it('preserves oauth and headers config through sanitization (round-trip)', async () => {
    const oauth = {
      clientId: 'client-123',
      clientSecret: 'shh',
      callbackPort: 40000,
      setupInstructions: ['Visit {setupUrl}', 'Paste {redirectUri}'],
    };
    const headers = { Authorization: 'Bearer abc' };
    await mcpConfigManager.commitResolvedServers('alice', [
      makeServer({ name: 'authful', transport: 'StreamableHttp', oauth, headers }),
    ]);

    const onDisk = readMcp('alice').mcp_servers[0];
    expect(onDisk.oauth).toEqual(oauth);
    expect(onDisk.headers).toEqual(headers);
    // The in-memory cache reflects the same preserved shape.
    expect(mcpConfigManager.getServers('alice')[0].oauth).toEqual(oauth);
  });
});

describe('McpConfigManager — CRUD', () => {
  it('adds a server and rejects a duplicate name', async () => {
    expect(await mcpConfigManager.addServer('alice', makeServer({ name: 'a' }))).toBe(true);
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['a']);

    // Duplicate name → false, installed server configs unchanged.
    expect(await mcpConfigManager.addServer('alice', makeServer({ name: 'a', command: 'other' }))).toBe(false);
    expect(mcpConfigManager.getServers('alice')).toHaveLength(1);
    expect(readMcp('alice').mcp_servers).toHaveLength(1);
  });

  it('loads from disk on a cold add (ensureLoaded) before mutating', async () => {
    ensureDir('alice');
    await writeMcpFile(mcpPath('alice'), [makeServer({ name: 'existing' })], '2020-01-01T00:00:00.000Z');
    // Cache is cold for this alias (no resolveFromDisk yet).
    expect(mcpConfigManager.hasServersLoaded('alice')).toBe(false);

    expect(await mcpConfigManager.addServer('alice', makeServer({ name: 'added' }))).toBe(true);

    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['existing', 'added']);
    expect(readMcp('alice').mcp_servers.map(s => s.name)).toEqual(['existing', 'added']);
  });

  it('updates an existing server and returns false for a missing one', async () => {
    await mcpConfigManager.addServer('alice', makeServer({ name: 'a', command: 'old' }));
    await mcpConfigManager.addServer('alice', makeServer({ name: 'b', command: 'keep' }));

    expect(await mcpConfigManager.updateServer('alice', 'a', { command: 'new' })).toBe(true);
    expect(mcpConfigManager.getServerInfo('alice', 'a')?.command).toBe('new');
    // A non-matching server is passed through untouched (identity map arm).
    expect(mcpConfigManager.getServerInfo('alice', 'b')?.command).toBe('keep');

    expect(await mcpConfigManager.updateServer('alice', 'ghost', { command: 'x' })).toBe(false);
  });

  it('deletes an existing server and returns false for a missing one', async () => {
    await mcpConfigManager.addServer('alice', makeServer({ name: 'a' }));
    await mcpConfigManager.addServer('alice', makeServer({ name: 'b' }));

    expect(await mcpConfigManager.deleteServer('alice', 'a')).toBe(true);
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['b']);

    expect(await mcpConfigManager.deleteServer('alice', 'ghost')).toBe(false);
    expect(readMcp('alice').mcp_servers.map(s => s.name)).toEqual(['b']);
  });

  it('toggles in_use and returns false for a missing server', async () => {
    await mcpConfigManager.addServer('alice', makeServer({ name: 'a', in_use: false }));
    await mcpConfigManager.addServer('alice', makeServer({ name: 'b', in_use: false }));

    expect(await mcpConfigManager.setServerInUse('alice', 'a', true)).toBe(true);
    expect(mcpConfigManager.getServerInfo('alice', 'a')?.in_use).toBe(true);
    // A non-matching server is passed through untouched (identity map arm).
    expect(mcpConfigManager.getServerInfo('alice', 'b')?.in_use).toBe(false);
    expect(readMcp('alice').mcp_servers.find(s => s.name === 'a')?.in_use).toBe(true);

    expect(await mcpConfigManager.setServerInUse('alice', 'ghost', true)).toBe(false);
  });
});

describe('McpConfigManager — singleton', () => {
  it('returns the same instance on repeated getInstance calls', () => {
    // The module-level export already created the instance, so this exercises the
    // already-initialized branch of getInstance.
    expect(McpConfigManager.getInstance()).toBe(mcpConfigManager);
    expect(McpConfigManager.getInstance()).toBe(McpConfigManager.getInstance());
  });
});

describe('McpConfigManager — clearCache', () => {
  it('clears a single alias without touching others', async () => {
    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'a' })]);
    await mcpConfigManager.commitResolvedServers('bob', [makeServer({ name: 'b' })]);

    mcpConfigManager.clearCache('alice');

    expect(mcpConfigManager.hasServersLoaded('alice')).toBe(false);
    expect(mcpConfigManager.hasServersLoaded('bob')).toBe(true);
  });

  it('clears every alias when called with no argument', async () => {
    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'a' })]);
    await mcpConfigManager.commitResolvedServers('bob', [makeServer({ name: 'b' })]);

    mcpConfigManager.clearCache();

    expect(mcpConfigManager.hasServersLoaded('alice')).toBe(false);
    expect(mcpConfigManager.hasServersLoaded('bob')).toBe(false);
  });

  it('re-clearing the fingerprint forces the next commit to rewrite after a reload', async () => {
    ensureDir('alice');
    await writeMcpFile(mcpPath('alice'), [makeServer({ name: 'a' })], '2020-01-01T00:00:00.000Z');
    await mcpConfigManager.resolveFromDisk('alice');

    mcpConfigManager.clearCache('alice');
    // After clearing, a cold update reloads from disk, mutates, and rewrites.
    expect(await mcpConfigManager.updateServer('alice', 'a', { command: 'changed' })).toBe(true);
    expect(readMcp('alice').mcp_servers[0].command).toBe('changed');
  });
});

describe('McpConfigManager — write serialization and retry', () => {
  it('logs and recovers from a transient rename failure during persist', async () => {
    const failedOnce = new Set<string>();
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      const target = String(to);
      if (target.includes('mcp.json') && !failedOnce.has(target)) {
        failedOnce.add(target);
        const err: NodeJS.ErrnoException = new Error('busy');
        err.code = 'EBUSY';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'serverX' })]);

    expect(readMcp('alice').mcp_servers[0].name).toBe('serverX');
    expect(loggerState.warn).toHaveBeenCalledWith(
      expect.stringContaining('Transient mcp.json rename failure'),
      'persistServers',
      expect.objectContaining({ alias: 'alice', code: 'EBUSY' }),
    );
  });

  it('does not mutate the runtime cache when a required mcp.json write fails', async () => {
    ensureDir('alice');
    await writeMcpFile(mcpPath('alice'), [makeServer({ name: 'persisted' })], '2020-01-01T00:00:00.000Z');
    await mcpConfigManager.resolveFromDisk('alice');

    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'mcp.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    await expect(mcpConfigManager.addServer('alice', makeServer({ name: 'unsaved' }))).rejects.toThrow('disk full');
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['persisted']);
    expect(readMcp('alice').mcp_servers.map(s => s.name)).toEqual(['persisted']);

    renameSpy.mockRestore();
    await expect(mcpConfigManager.addServer('alice', makeServer({ name: 'unsaved' }))).resolves.toBe(true);
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['persisted', 'unsaved']);
    expect(readMcp('alice').mcp_servers.map(s => s.name)).toEqual(['persisted', 'unsaved']);
  });

  it('serializes concurrent writes to the same alias without losing updates', async () => {
    // Two concurrent adds on one alias exercise the per-alias write lock: the
    // second waits for the first, and the lock map is updated/cleared correctly.
    const [first, second] = await Promise.all([
      mcpConfigManager.addServer('alice', makeServer({ name: 'a' })),
      mcpConfigManager.addServer('alice', makeServer({ name: 'b' })),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(mcpConfigManager.getServers('alice').map(s => s.name).sort()).toEqual(['a', 'b']);
    expect(readMcp('alice').mcp_servers.map(s => s.name).sort()).toEqual(['a', 'b']);
  });
});

describe('mcpFileStore serialize parity', () => {
  it('persists the canonical mcp.json shape produced by serializeMcpFile', async () => {
    await mcpConfigManager.commitResolvedServers('alice', [makeServer({ name: 'a' })]);
    const onDisk = readMcp('alice');
    const expected = JSON.parse(
      serializeMcpFile(sanitizeMcpServerList([makeServer({ name: 'a' })]), onDisk.updatedAt),
    );
    expect(onDisk).toEqual(expected);
  });
});
