import * as fs from 'fs';
import * as path from 'path';
import Module from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalRequire = Module.prototype.require;

const testState = vi.hoisted(() => ({
  profileDirectory: '',
  alias: 'legacy-user' as string | null,
  authThrows: false,
  encryptionAvailable: false,
  decryptValue: '',
}));

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => testState.encryptionAvailable),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn(() => testState.decryptValue),
}));

vi.mock('electron', () => ({ safeStorage }));

vi.mock('../../../auth/authManager', () => ({
  mainAuthManager: {
    getCurrentAuth: () => {
      if (testState.authThrows) throw new Error('auth unavailable');
      return testState.alias ? { ghcAuth: { alias: testState.alias } } : null;
    },
  },
}));

vi.mock('../../../userDataADO/pathUtils', () => ({
  getProfileDirectoryPath: () => testState.profileDirectory,
}));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../unifiedLogger', () => ({
  getUnifiedLogger: () => logger,
}));

import { OpenKosmosTokenCache, type OpenKosmosTokenCacheData } from '../OpenKosmosTokenCache';

function resetSingleton(): OpenKosmosTokenCache {
  (OpenKosmosTokenCache as unknown as { instance: OpenKosmosTokenCache | null }).instance = null;
  return OpenKosmosTokenCache.getInstance();
}

function credentialsPath(file: string): string {
  return path.join(testState.profileDirectory, 'credentials', file);
}

function writeFallback(value: unknown): string {
  const cachePath = credentialsPath('browserAuthTokenCache.json');
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(value));
  return cachePath;
}

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    serverName: 'public-server',
    serverUrl: 'https://mcp.example.test',
    accessToken: 'mcp-token',
    expiresAt: 1234,
    ...overrides,
  };
}

describe('OpenKosmosTokenCache', () => {
  beforeEach(() => {
    testState.profileDirectory = fs.mkdtempSync(path.join(process.cwd(), '.openkosmos-token-cache-'));
    testState.alias = 'legacy-user';
    testState.authThrows = false;
    testState.encryptionAvailable = false;
    testState.decryptValue = '';
    safeStorage.isEncryptionAvailable.mockClear();
    safeStorage.encryptString.mockClear();
    safeStorage.decryptString.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
    vi.spyOn(Module.prototype, 'require').mockImplementation(function (this: NodeModule, id: string) {
      if (id === 'electron') return { safeStorage };
      return originalRequire.call(this, id);
    });
    resetSingleton();
  });

  afterEach(() => {
    fs.rmSync(testState.profileDirectory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('preserves MCP OAuth entries while removing every legacy tenant credential locally', async () => {
    const cachePath = writeFallback({
      version: 1,
      updatedAt: 100,
      account: { username: 'legacy@example.invalid' },
      graph: { accessToken: 'legacy-graph-token' },
      chatsvc: { accessToken: 'legacy-chat-token' },
      skypeApi: { accessToken: 'legacy-skype-token' },
      substrate: { accessToken: 'legacy-substrate-token' },
      azureDevOps: { accessToken: 'legacy-provider-token' },
      refresh: { refreshToken: 'legacy-refresh-token' },
      region: 'legacy-region',
      mcpOAuth: {
        server: validEntry({
          refreshToken: 'refresh',
          scope: 'read',
          clientId: 'client',
          clientSecret: 'secret',
          stepUpScope: 'admin',
          discoveryState: {
            authorizationServerUrl: 'https://auth.example.test',
            resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth',
          },
        }),
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const loaded = await OpenKosmosTokenCache.getInstance().load();

    expect(loaded?.mcpOAuth?.server).toEqual(validEntry({
      refreshToken: 'refresh',
      scope: 'read',
      clientId: 'client',
      clientSecret: 'secret',
      stepUpScope: 'admin',
      discoveryState: {
        authorizationServerUrl: 'https://auth.example.test',
        resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth',
      },
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf8'))).toEqual({
      version: 1,
      updatedAt: 100,
      mcpOAuth: { server: loaded?.mcpOAuth?.server },
    });
  });

  it.each([
    null,
    'invalid',
    { version: 2, updatedAt: 1 },
    { version: 1, updatedAt: 'yesterday' },
    { version: 1, updatedAt: Number.NaN },
  ])('rejects malformed root cache payload %#', async (payload) => {
    writeFallback(payload);
    expect(await OpenKosmosTokenCache.getInstance().load()).toBeNull();
  });

  it('drops invalid map keys, entries, optional strings, and malformed discovery metadata', async () => {
    writeFallback({
      version: 1,
      updatedAt: 10,
      mcpOAuth: {
        '': validEntry(),
        missingName: validEntry({ serverName: '' }),
        badUrl: validEntry({ serverUrl: 42 }),
        badToken: validEntry({ accessToken: null }),
        badExpiry: validEntry({ expiresAt: Number.POSITIVE_INFINITY }),
        scalar: 'not-an-entry',
        valid: validEntry({
          refreshToken: ' ',
          scope: 2,
          clientId: '',
          clientSecret: null,
          stepUpScope: [],
          discoveryState: { authorizationServerUrl: '', resourceMetadataUrl: 'orphaned' },
        }),
      },
    });

    expect(await OpenKosmosTokenCache.getInstance().load()).toEqual({
      version: 1,
      updatedAt: 10,
      mcpOAuth: { valid: validEntry() },
    });
  });

  it('drops empty and non-object OAuth maps', async () => {
    writeFallback({ version: 1, updatedAt: 10, mcpOAuth: [] });
    expect(await OpenKosmosTokenCache.getInstance().load()).toEqual({ version: 1, updatedAt: 10 });

    resetSingleton();
    writeFallback({ version: 1, updatedAt: 11, mcpOAuth: { bad: null } });
    expect(await OpenKosmosTokenCache.getInstance().load()).toEqual({ version: 1, updatedAt: 11 });
  });

  it('saves, clones, reads, replaces, and deletes profile-scoped OAuth entries', async () => {
    const cache = OpenKosmosTokenCache.getInstance();
    const input: OpenKosmosTokenCacheData = {
      version: 1,
      updatedAt: 0,
      mcpOAuth: { first: validEntry() },
    };
    await cache.save(input);
    input.mcpOAuth!.first.accessToken = 'mutated-outside';

    const firstRead = await cache.load();
    firstRead!.mcpOAuth!.first.accessToken = 'mutated-clone';
    expect((await cache.getMcpOAuth('first'))?.accessToken).toBe('mcp-token');
    expect(await cache.getMcpOAuth('missing')).toBeNull();

    await cache.setMcpOAuth('second', validEntry({ serverName: 'second', accessToken: '' }));
    expect((await cache.load())?.mcpOAuth).toEqual({
      first: validEntry(),
      second: validEntry({ serverName: 'second', accessToken: '' }),
    });

    await cache.deleteMcpOAuth('missing');
    await cache.deleteMcpOAuth('first');
    expect((await cache.load())?.mcpOAuth).toHaveProperty('second');
    await cache.deleteMcpOAuth('second');
    expect((await cache.load())?.mcpOAuth).toBeUndefined();
  });

  it('serializes concurrent writers without losing either server entry', async () => {
    const cache = OpenKosmosTokenCache.getInstance();
    await Promise.all([
      cache.setMcpOAuth('one', validEntry({ serverName: 'one' })),
      cache.setMcpOAuth('two', validEntry({ serverName: 'two' })),
    ]);
    expect(Object.keys((await cache.load())!.mcpOAuth!).sort()).toEqual(['one', 'two']);
  });

  it('persists encrypted data, removes plaintext, and reloads a sanitized encrypted legacy cache', async () => {
    testState.encryptionAvailable = true;
    const fallbackPath = writeFallback({ version: 1, updatedAt: 1 });
    const cache = OpenKosmosTokenCache.getInstance();
    await cache.save({ version: 1, updatedAt: 1, mcpOAuth: { server: validEntry() } });

    expect(safeStorage.encryptString).toHaveBeenCalled();
    expect(fs.existsSync(credentialsPath('browserAuthTokenCache.enc'))).toBe(true);
    expect(fs.existsSync(fallbackPath)).toBe(false);

    const legacyEncrypted = {
      version: 1,
      updatedAt: 22,
      graph: { accessToken: 'removed' },
      mcpOAuth: { server: validEntry() },
    };
    testState.decryptValue = JSON.stringify(legacyEncrypted);
    resetSingleton();
    const loaded = await OpenKosmosTokenCache.getInstance().load();
    expect(loaded).toEqual({
      version: 1,
      updatedAt: 22,
      mcpOAuth: { server: validEntry() },
    });
    expect(safeStorage.encryptString).toHaveBeenLastCalledWith(JSON.stringify(loaded, null, 2));
  });

  it('returns null and logs when persisted JSON or encrypted content cannot be read', async () => {
    writeFallback('{broken-json');
    fs.writeFileSync(credentialsPath('browserAuthTokenCache.json'), '{broken-json');
    expect(await OpenKosmosTokenCache.getInstance().load()).toBeNull();
    expect(logger.warn).toHaveBeenCalled();

    testState.encryptionAvailable = true;
    testState.decryptValue = '{broken-encrypted';
    fs.writeFileSync(credentialsPath('browserAuthTokenCache.enc'), 'ciphertext');
    resetSingleton();
    expect(await OpenKosmosTokenCache.getInstance().load()).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('keeps memory behavior but skips load, save, and clear persistence without an alias', async () => {
    testState.alias = null;
    const cache = resetSingleton();
    expect(await cache.load()).toBeNull();
    await cache.save({ version: 1, updatedAt: 1 });
    await cache.clear();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no active profile alias'), 'load');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no active profile alias'), 'save');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no active profile alias'), 'clear');
  });

  it('handles auth lookup failures as a missing alias', async () => {
    testState.authThrows = true;
    expect(await resetSingleton().load()).toBeNull();
  });

  it('clears both encrypted and plaintext cache files', async () => {
    fs.mkdirSync(path.dirname(credentialsPath('x')), { recursive: true });
    fs.writeFileSync(credentialsPath('browserAuthTokenCache.enc'), 'encrypted');
    fs.writeFileSync(credentialsPath('browserAuthTokenCache.json'), '{}');
    await OpenKosmosTokenCache.getInstance().clear();
    expect(fs.existsSync(credentialsPath('browserAuthTokenCache.enc'))).toBe(false);
    expect(fs.existsSync(credentialsPath('browserAuthTokenCache.json'))).toBe(false);
  });

  it('continues accepting writes after a failed serialized operation', async () => {
    const cache = OpenKosmosTokenCache.getInstance();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    await expect(cache.setMcpOAuth('bad', validEntry())).rejects.toThrow(
      'Invalid MCP OAuth cache payload',
    );
    nowSpy.mockReturnValue(100);
    await cache.setMcpOAuth('good', validEntry());
    expect(await cache.getMcpOAuth('good')).toEqual(validEntry());
  });
});
