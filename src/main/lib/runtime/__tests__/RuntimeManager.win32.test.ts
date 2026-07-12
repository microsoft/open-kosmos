// @ts-nocheck
/**
 * RuntimeManager.win32.test.ts
 *
 * Covers branches gated on `os.platform()` returning 'win32', which other suites
 * (running on macOS/Linux) cannot reach because os.platform() is not spyable in ESM.
 * Here `os` is mocked module-wide to report win32-x64.
 *
 * Targets:
 *  - installBunDirectly: win32 path (no chmod, bun.exe verify) — lines around 1288/1298.
 *  - installUvDirectly: Windows StreamZip branch — lines 1386-1400, 1404, 1409-1410.
 *  - doInstallPythonVersion: statSync catch (line 972) and the non-win32 chmod block
 *    is skipped on win32 (covers the platform !== 'win32' false branch).
 */

import * as path from 'path';

const { testUserData, mockLogger, realOs, fsKnobs } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  return {
    testUserData: p.join(o.tmpdir(), 'openkosmos-test-RuntimeManager-win32'),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    realOs: o,
    // Mutable knob so a test can force fs.statSync to throw (ESM exports can't be spied).
    fsKnobs: { statSyncThrows: false, chmodSyncThrows: false, readdirThrowValue: undefined as unknown },
  };
});

// Mock fs so statSync can be made to throw on demand; everything else delegates to real fs.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: actual,
    statSync: (...args: any[]) => {
      if (fsKnobs.statSyncThrows) throw new Error('stat boom');
      return (actual.statSync as any)(...args);
    },
    chmodSync: (...args: any[]) => {
      if (fsKnobs.chmodSyncThrows) throw new Error('chmod boom');
      return (actual.chmodSync as any)(...args);
    },
    readdirSync: (...args: any[]) => {
      if (fsKnobs.readdirThrowValue !== undefined) throw fsKnobs.readdirThrowValue;
      return (actual.readdirSync as any)(...args);
    },
    existsSync: (...args: any[]) => {
      // While the readdir-throw test is active, force the UV-python dir guard
      // (`fs.existsSync(uvPythonDir)` in listPythonVersionsFast) to pass so the
      // code reaches the readdirSync throw. getUvPythonDir() keys off
      // process.platform (linux on CI), not the mocked os.platform(), so the real
      // ~/.local/share/uv/python may not exist on the runner — without this the
      // function would early-return [] before throwing. Scoped to the knob so no
      // other test/path is affected.
      if (fsKnobs.readdirThrowValue !== undefined) return true;
      return (actual.existsSync as any)(...args);
    },
  };
});

// Mock os to report win32-x64 while delegating tmpdir/homedir to the real os.
vi.mock('os', () => ({
  ...realOs,
  default: { ...realOs, platform: () => 'win32', arch: () => 'x64' },
  platform: () => 'win32',
  arch: () => 'x64',
  tmpdir: () => realOs.tmpdir(),
  homedir: () => realOs.homedir(),
}));

const mockIpcHandlers: Record<string, Function> = {};
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(testUserData),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    isPackaged: false,
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: {
    handle: vi.fn().mockImplementation((c: string, h: Function) => { mockIpcHandlers[c] = h; }),
    on: vi.fn(),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => mockLogger,
  getUnifiedLogger: () => mockLogger,
  createConsoleLogger: () => mockLogger,
}));

const mockCacheConfig = {
  runtimeEnvironment: { mode: 'system', bunVersion: '1.5.0', uvVersion: '0.7.0', pinnedPythonVersion: null },
};
vi.mock('../../userDataADO/appCacheManager', () => ({
  appCacheManager: {
    getConfig: vi.fn().mockImplementation(() => ({
      runtimeEnvironment: { ...mockCacheConfig.runtimeEnvironment },
    })),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../userDataADO/types/app', () => ({
  DEFAULT_RUNTIME_ENVIRONMENT: { mode: 'system', bunVersion: '1.5.0', uvVersion: '0.7.0', pinnedPythonVersion: null },
}));

const { mockExecuteCommand } = vi.hoisted(() => ({
  mockExecuteCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));
vi.mock('../../terminalManager', () => ({
  getTerminalManager: vi.fn().mockReturnValue({ executeCommand: mockExecuteCommand }),
}));

vi.mock('../../featureFlags', () => ({ isFeatureEnabled: vi.fn().mockReturnValue(false) }));
vi.mock('../../azureCli', () => ({
  getAzureCliManager: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue({ installed: false, loggedIn: false, version: null, path: null }),
    ensureInstalledWithConsent: vi.fn(), uninstall: vi.fn(),
  }),
}));
vi.mock('../LocalPythonMirror', () => ({
  LocalPythonMirror: {
    getInstance: vi.fn().mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(),
      getBaseUrlIfRunning: vi.fn().mockReturnValue(null),
    }),
  },
}));

// StreamZip mock (configurable per test)
const { mockZipEntries, mockZipExtract, mockZipClose } = vi.hoisted(() => ({
  mockZipEntries: vi.fn().mockResolvedValue({}),
  mockZipExtract: vi.fn().mockResolvedValue(undefined),
  mockZipClose: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node-stream-zip', () => ({
  default: { async: function (_o: any) { return { entries: mockZipEntries, extract: mockZipExtract, close: mockZipClose }; } },
}));

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn: mockSpawn, execSync: vi.fn() }));

const { mockHttpsGet } = vi.hoisted(() => ({ mockHttpsGet: vi.fn() }));
vi.mock('https', () => ({ get: (...a: any[]) => mockHttpsGet(...a) }));

import * as fs from 'fs';
import { RuntimeManager } from '../RuntimeManager';

function resetManager() {
  (RuntimeManager as any).instance = undefined;
  return RuntimeManager.getInstance();
}

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mockIpcHandlers)) delete mockIpcHandlers[k];
  mockZipEntries.mockResolvedValue({});
  mockZipExtract.mockResolvedValue(undefined);
  mockZipClose.mockResolvedValue(undefined);
  mockSpawn.mockReset();
  fsKnobs.statSyncThrows = false;
});

describe('installBunDirectly on win32', () => {
  it('extracts bun.exe and verifies installation (no chmod on win32)', async () => {
    const manager = resetManager();
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    vi.spyOn(manager as any, 'downloadWithRedirects').mockResolvedValue(undefined);

    mockZipEntries.mockResolvedValue({
      // Directory entry exercises the `if (!entry.isDirectory)` false branch.
      'bun-windows-x64/': { isDirectory: true, name: 'bun-windows-x64/' },
      'bun-windows-x64/bun.exe': { isDirectory: false, name: 'bun-windows-x64/bun.exe' },
    });
    mockZipExtract.mockImplementation(async (_name: string, outPath: string) => {
      fs.writeFileSync(outPath, 'MZ');
    });

    await expect((manager as any).installBunDirectly('1.5.0')).resolves.toBeUndefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Successfully installed Bun'),
      'RuntimeManager',
    );
    fs.rmSync(path.join(binDir, 'bun.exe'), { force: true });
  });

  it('throws when bun.exe is missing after extraction', async () => {
    const manager = resetManager();
    fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
    vi.spyOn(manager as any, 'downloadWithRedirects').mockResolvedValue(undefined);
    mockZipEntries.mockResolvedValue({ 'noise.txt': { isDirectory: false, name: 'noise.txt' } });
    await expect((manager as any).installBunDirectly('1.5.0')).rejects.toThrow(/Bun binary not found/);
  });
});

describe('installUvDirectly on win32 (StreamZip branch)', () => {
  it('extracts uv.exe / uvx.exe and verifies installation', async () => {
    const manager = resetManager();
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    vi.spyOn(manager as any, 'downloadWithRedirects').mockResolvedValue(undefined);

    mockZipEntries.mockResolvedValue({
      'uv.exe': { isDirectory: false, name: 'uv.exe' },
      'uvx.exe': { isDirectory: false, name: 'uvx.exe' },
      'dir/': { isDirectory: true, name: 'dir/' },
    });
    mockZipExtract.mockImplementation(async (_name: string, outPath: string) => {
      fs.writeFileSync(outPath, 'MZ');
    });

    await expect((manager as any).installUvDirectly('0.7.0')).resolves.toBeUndefined();
    expect(mockZipExtract).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Successfully installed uv'),
      'RuntimeManager',
    );
    fs.rmSync(path.join(binDir, 'uv.exe'), { force: true });
    fs.rmSync(path.join(binDir, 'uvx.exe'), { force: true });
  });

  it('throws when uv.exe is missing after extraction', async () => {
    const manager = resetManager();
    fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
    vi.spyOn(manager as any, 'downloadWithRedirects').mockResolvedValue(undefined);
    mockZipEntries.mockResolvedValue({ 'irrelevant.dll': { isDirectory: false, name: 'irrelevant.dll' } });
    await expect((manager as any).installUvDirectly('0.7.0')).rejects.toThrow(/uv binary not found/);
  });
});

describe('doInstallPythonVersion statSync catch on win32', () => {
  const originalPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('warns but proceeds when statSync throws', async () => {
    // isInstalled/getBinaryPath key off process.platform (not os.platform()), so pin it.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const manager = resetManager();
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'uv.exe'), 'MZ');

    fsKnobs.statSyncThrows = true;

    // Spawn resolves successfully (code 0) so doInstallPythonVersion resolves.
    const listeners: Record<string, Function[]> = { close: [], error: [] };
    const child = {
      pid: 1,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((e: string, cb: Function) => { (listeners[e] ||= []).push(cb); }),
    };
    mockSpawn.mockReturnValue(child);
    const p = (manager as any).doInstallPythonVersion('3.12.9');
    setImmediate(() => listeners.close.forEach((cb) => cb(0, null)));
    await expect(p).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not stat uv binary'),
      'RuntimeManager',
      expect.anything(),
    );
    fsKnobs.statSyncThrows = false;
    fs.rmSync(path.join(binDir, 'uv.exe'), { force: true });
  });
});

// ── non-win32 branches reachable here (default darwin process.platform) ───────

describe('doInstallPythonVersion chmod catch (non-win32)', () => {
  it('warns but proceeds when chmodSync on the uv binary throws', async () => {
    // process.platform stays at the host default (darwin/linux) so the
    // `process.platform !== 'win32'` chmod block runs and its catch fires.
    const manager = resetManager();
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    if (process.platform === 'win32') return; // only meaningful off-win32
    fs.writeFileSync(path.join(binDir, uvBin), 'MZ');

    fsKnobs.chmodSyncThrows = true;

    const listeners: Record<string, Function[]> = { close: [], error: [] };
    const child = {
      pid: 1,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((e: string, cb: Function) => { (listeners[e] ||= []).push(cb); }),
    };
    mockSpawn.mockReturnValue(child);
    const p = (manager as any).doInstallPythonVersion('3.12.9');
    setImmediate(() => listeners.close.forEach((cb) => cb(0, null)));
    await expect(p).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not set executable permissions on uv binary'),
      'RuntimeManager',
      expect.anything(),
    );
    fsKnobs.chmodSyncThrows = false;
    fs.rmSync(path.join(binDir, uvBin), { force: true });
  });
});

describe('listPythonVersionsFast readdir error (non-Error throw)', () => {
  it('logs String(err) and returns [] when readdirSync throws a non-Error', () => {
    // os is mocked to win32 -> getUvPythonDir reads %APPDATA%; point it at an existing dir.
    const prev = process.env.APPDATA;
    const uvRoot = path.join(testUserData, 'readdir-throw');
    process.env.APPDATA = uvRoot;
    fs.mkdirSync(path.join(uvRoot, 'uv', 'python'), { recursive: true });

    const manager = resetManager();
    fsKnobs.readdirThrowValue = 'readdir-string-failure';
    const results = manager.listPythonVersionsFast();
    expect(results).toEqual([]);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error during fast Python scan'),
      'RuntimeManager',
      expect.objectContaining({ error: 'readdir-string-failure' }),
    );

    fsKnobs.readdirThrowValue = undefined;
    fs.rmSync(uvRoot, { recursive: true, force: true });
    if (prev === undefined) delete process.env.APPDATA; else process.env.APPDATA = prev;
  });
});
