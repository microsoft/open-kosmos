/**
 * mcpFileStore.test.ts
 *
 * Unit tests for the standalone `mcp.json` read/serialize/write boundary. These
 * run against a real temp directory so the fs interaction is exercised end to
 * end (missing file, valid file, corrupt read, corrupt parse, invalid shape,
 * version fallback, serialize guard, and write round-trip).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  MCP_FILE_VERSION,
  serializeMcpFile,
  fingerprintMcpServers,
  readMcpFile,
  writeMcpFile,
} from '../mcpFileStore';
import type { McpServerConfig } from '../types/profile';

const TS = '2026-01-01T00:00:00.000Z';
const TS2 = '2026-02-02T12:34:56.000Z';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-file-store-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'srv',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { TOKEN: 'x' },
    url: '',
    in_use: true,
    version: '1.0.0',
    remoteVersion: '',
    source: 'ON-DEVICE',
    ...overrides,
  } as McpServerConfig;
}

describe('serializeMcpFile', () => {
  it('wraps installed server configs in the versioned envelope with the given updatedAt', () => {
    const out = serializeMcpFile([makeServer()], TS);
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(MCP_FILE_VERSION);
    expect(parsed.updatedAt).toBe(TS);
    expect(parsed.mcp_servers).toHaveLength(1);
    expect(parsed.mcp_servers[0].name).toBe('srv');
  });

  it('is pretty-printed (2-space indentation) and deterministic for the same inputs', () => {
    const a = serializeMcpFile([makeServer()], TS);
    const b = serializeMcpFile([makeServer()], TS);
    expect(a).toBe(b);
    expect(a).toContain('\n  "version"');
    expect(a).toContain('\n  "updatedAt"');
  });

  it('embeds whatever updatedAt the caller supplies', () => {
    expect(JSON.parse(serializeMcpFile([], TS2)).updatedAt).toBe(TS2);
  });

  it('falls back to an empty array when given a non-array', () => {
    const out = serializeMcpFile(undefined as unknown as McpServerConfig[], TS);
    expect(JSON.parse(out)).toEqual({ version: MCP_FILE_VERSION, updatedAt: TS, mcp_servers: [] });
  });
});

describe('fingerprintMcpServers', () => {
  it('is stable for identical installed server configs and excludes updatedAt', () => {
    const a = fingerprintMcpServers([makeServer()]);
    const b = fingerprintMcpServers([makeServer()]);
    expect(a).toBe(b);
    // The fingerprint must NOT contain a timestamp, so the same installed server configs hash
    // equal no matter when it is written.
    expect(a).not.toContain('updatedAt');
    expect(a).toContain('mcp_servers');
  });

  it('differs when installed server content changes', () => {
    const a = fingerprintMcpServers([makeServer({ name: 'a' })]);
    const b = fingerprintMcpServers([makeServer({ name: 'b' })]);
    expect(a).not.toBe(b);
  });

  it('treats a non-array as an empty installed server set', () => {
    expect(fingerprintMcpServers(undefined as unknown as McpServerConfig[])).toBe(
      fingerprintMcpServers([]),
    );
  });
});

describe('readMcpFile', () => {
  it('returns {file:null, corrupt:false} when the file does not exist', async () => {
    const result = await readMcpFile(path.join(tmpDir, 'missing.json'));
    expect(result).toEqual({ file: null, corrupt: false });
  });

  it('returns parsed installed server configs for a valid file', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, serializeMcpFile([makeServer()], TS));

    const { file, corrupt } = await readMcpFile(filePath);
    expect(corrupt).toBe(false);
    expect(file).not.toBeNull();
    expect(file!.version).toBe(MCP_FILE_VERSION);
    expect(file!.updatedAt).toBe(TS);
    expect(file!.mcp_servers).toHaveLength(1);
    expect(file!.mcp_servers[0].name).toBe('srv');
    expect(file!.mcp_servers[0].in_use).toBe(true);
  });

  it('flags corrupt when the path exists but cannot be read', async () => {
    // A directory at the path makes fs.promises.readFile throw EISDIR while
    // existsSync still reports the path as present.
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.mkdirSync(filePath);

    const result = await readMcpFile(filePath);
    expect(result).toEqual({ file: null, corrupt: true });
  });

  it('flags corrupt for malformed JSON', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, '{ this is not json');

    const result = await readMcpFile(filePath);
    expect(result).toEqual({ file: null, corrupt: true });
  });

  it('flags corrupt when the JSON is null', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, 'null');

    const result = await readMcpFile(filePath);
    expect(result).toEqual({ file: null, corrupt: true });
  });

  it('flags corrupt when the JSON is not an object', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, '42');

    const result = await readMcpFile(filePath);
    expect(result).toEqual({ file: null, corrupt: true });
  });

  it('flags corrupt when mcp_servers is missing or not an array', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: '1.0', mcp_servers: 'nope' }));

    const result = await readMcpFile(filePath);
    expect(result).toEqual({ file: null, corrupt: true });
  });

  it('flags corrupt when mcp_servers contains a null entry', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: '1.0', mcp_servers: [null] }));

    const result = await readMcpFile(filePath);
    expect(result).toEqual({ file: null, corrupt: true });
  });

  it('flags corrupt when mcp_servers mixes a valid object with a primitive entry', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({ version: '1.0', mcp_servers: [{ name: 'ok', command: 'node' }, 42] }),
    );

    const result = await readMcpFile(filePath);
    expect(result).toEqual({ file: null, corrupt: true });
  });

  it('falls back to the default version when version is missing', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, JSON.stringify({ mcp_servers: [] }));

    const { file, corrupt } = await readMcpFile(filePath);
    expect(corrupt).toBe(false);
    expect(file!.version).toBe(MCP_FILE_VERSION);
    expect(file!.mcp_servers).toEqual([]);
  });

  it('falls back to the default version when version is not a string', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: 7, mcp_servers: [] }));

    const { file } = await readMcpFile(filePath);
    expect(file!.version).toBe(MCP_FILE_VERSION);
  });

  it('falls back to an empty updatedAt when it is missing', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: MCP_FILE_VERSION, mcp_servers: [] }));

    const { file } = await readMcpFile(filePath);
    expect(file!.updatedAt).toBe('');
  });

  it('falls back to an empty updatedAt when it is not a string', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: MCP_FILE_VERSION, updatedAt: 123, mcp_servers: [] }));

    const { file } = await readMcpFile(filePath);
    expect(file!.updatedAt).toBe('');
  });
});

describe('writeMcpFile', () => {
  it('writes a file that reads back identically', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    const servers = [makeServer(), makeServer({ name: 'other', in_use: false })];

    await writeMcpFile(filePath, servers, TS);

    const onDisk = fs.readFileSync(filePath, 'utf-8');
    expect(onDisk).toBe(serializeMcpFile(servers, TS));

    const { file, corrupt } = await readMcpFile(filePath);
    expect(corrupt).toBe(false);
    expect(file!.updatedAt).toBe(TS);
    expect(file!.mcp_servers).toHaveLength(2);
    expect(file!.mcp_servers.map((s) => s.name)).toEqual(['srv', 'other']);
  });

  it('overwrites an existing file atomically', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await writeMcpFile(filePath, [makeServer({ name: 'first' })], TS);
    await writeMcpFile(filePath, [makeServer({ name: 'second' })], TS2);

    const { file } = await readMcpFile(filePath);
    expect(file!.mcp_servers).toHaveLength(1);
    expect(file!.mcp_servers[0].name).toBe('second');
    expect(file!.updatedAt).toBe(TS2);
    // No leftover temp files in the directory.
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
