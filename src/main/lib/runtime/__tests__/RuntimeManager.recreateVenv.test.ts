import * as fs from 'fs';
import * as path from 'path';

const { testUserData, mockLogger, mockExecuteCommand } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  return {
    testUserData: p.join(o.tmpdir(), 'openkosmos-test-recreateVenv'),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockExecuteCommand: vi.fn(),
  };
});

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue(testUserData),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => mockLogger,
  getUnifiedLogger: () => mockLogger,
  createConsoleLogger: () => mockLogger,
}));

vi.mock('../../userDataADO/appCacheManager', async () => ({
  appCacheManager: {
    getConfig: vi.fn().mockReturnValue({
      runtimeEnvironment: { mode: 'internal', bunVersion: '1.3.6', uvVersion: '0.6.17', pinnedPythonVersion: '3.10.12' },
    }),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../userDataADO/types/app', async () => ({
  DEFAULT_RUNTIME_ENVIRONMENT: { mode: 'internal', bunVersion: '1.3.6', uvVersion: '0.6.17', pinnedPythonVersion: null },
}));

vi.mock('../../terminalManager', async () => ({
  getTerminalManager: () => ({ executeCommand: mockExecuteCommand }),
}));

vi.mock('node-stream-zip', async () => ({}));

vi.mock('../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

import { RuntimeManager } from '../RuntimeManager';

beforeEach(() => {
  (RuntimeManager as any).instance = undefined;
  mockExecuteCommand.mockReset();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockLogger.debug.mockClear();
});

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

describe('RuntimeManager.recreateVenv', () => {
  it('uses full path to uv binary, not bare "uv"', async () => {
    const manager = RuntimeManager.getInstance();
    const binPath = (manager as any).binPath;
    const uvPath = path.join(binPath, process.platform === 'win32' ? 'uv.exe' : 'uv');

    // Create a fake uv binary so existsSync passes
    fs.mkdirSync(binPath, { recursive: true });
    fs.writeFileSync(uvPath, '');

    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

    await (manager as any).recreateVenv('3.10.12');

    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteCommand.mock.calls[0][0];
    // Must be full path, not bare "uv"
    expect(callArgs.command).toBe(uvPath);
    expect(path.isAbsolute(callArgs.command)).toBe(true);

    fs.rmSync(uvPath);
  });

  it('quotes uv path when it contains spaces', async () => {
    const manager = RuntimeManager.getInstance();
    // Override binPath to a path with spaces
    const spacePath = path.join(testUserData, 'path with spaces', 'bin');
    (manager as any).binPath = spacePath;
    const uvPath = path.join(spacePath, process.platform === 'win32' ? 'uv.exe' : 'uv');

    fs.mkdirSync(spacePath, { recursive: true });
    fs.writeFileSync(uvPath, '');

    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

    await (manager as any).recreateVenv('3.10.12');

    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteCommand.mock.calls[0][0];
    // Path with spaces must be quoted
    expect(callArgs.command).toBe(`"${uvPath}"`);

    fs.rmSync(spacePath, { recursive: true });
  });

  it('skips venv creation when uv binary does not exist', async () => {
    const manager = RuntimeManager.getInstance();

    await (manager as any).recreateVenv('3.10.12');

    expect(mockExecuteCommand).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('uv binary not found'),
      'RuntimeManager'
    );
  });

  it('deduplicates concurrent venv creation attempts', async () => {
    const manager = RuntimeManager.getInstance();
    const binPath = (manager as any).binPath;
    const uvPath = path.join(binPath, process.platform === 'win32' ? 'uv.exe' : 'uv');

    fs.mkdirSync(binPath, { recursive: true });
    fs.writeFileSync(uvPath, '');

    // Make executeCommand take some time
    mockExecuteCommand.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ exitCode: 0, stdout: '', stderr: '' }), 50))
    );

    // Fire 3 concurrent recreateVenv calls
    const p1 = (manager as any).recreateVenv('3.10.12');
    const p2 = (manager as any).recreateVenv('3.10.12');
    const p3 = (manager as any).recreateVenv('3.10.12');

    await Promise.all([p1, p2, p3]);

    // Only one actual executeCommand call despite 3 concurrent requests
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('already in progress'),
      'RuntimeManager'
    );

    fs.rmSync(uvPath);
  });

  it('rebuilds venv when concurrent call requests a different Python version', async () => {
    const manager = RuntimeManager.getInstance();
    const binPath = (manager as any).binPath;
    const uvPath = path.join(binPath, process.platform === 'win32' ? 'uv.exe' : 'uv');

    fs.mkdirSync(binPath, { recursive: true });
    fs.writeFileSync(uvPath, '');

    mockExecuteCommand.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ exitCode: 0, stdout: '', stderr: '' }), 50))
    );

    // Fire concurrent calls with different versions
    const p1 = (manager as any).recreateVenv('3.10.12');
    const p2 = (manager as any).recreateVenv('3.12.0');

    await Promise.all([p1, p2]);

    // Should have 2 executeCommand calls — one for each version
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    // Second call should use the new version
    const secondCallArgs = mockExecuteCommand.mock.calls[1][0].args;
    expect(secondCallArgs).toEqual(expect.arrayContaining(['3.12.0']));

    fs.rmSync(uvPath);
  });

  it('serializes multiple waiters behind an older rebuild with different versions', async () => {
    const manager = RuntimeManager.getInstance();
    const binPath = (manager as any).binPath;
    const uvPath = path.join(binPath, process.platform === 'win32' ? 'uv.exe' : 'uv');

    fs.mkdirSync(binPath, { recursive: true });
    fs.writeFileSync(uvPath, '');

    mockExecuteCommand.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ exitCode: 0, stdout: '', stderr: '' }), 50))
    );

    // A starts 3.10, B and C both request 3.12 while A is running
    const pA = (manager as any).recreateVenv('3.10.12');
    const pB = (manager as any).recreateVenv('3.12.0');
    const pC = (manager as any).recreateVenv('3.12.0');

    await Promise.all([pA, pB, pC]);

    // A builds 3.10, then one of B/C builds 3.12, the other joins
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    const lastCallArgs = mockExecuteCommand.mock.calls[1][0].args;
    expect(lastCallArgs).toEqual(expect.arrayContaining(['3.12.0']));

    fs.rmSync(uvPath);
  });

  it('clears dedup lock after venv creation fails', async () => {
    const manager = RuntimeManager.getInstance();
    const binPath = (manager as any).binPath;
    const uvPath = path.join(binPath, process.platform === 'win32' ? 'uv.exe' : 'uv');

    fs.mkdirSync(binPath, { recursive: true });
    fs.writeFileSync(uvPath, '');

    // First call fails
    mockExecuteCommand.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'uv not found' });
    await (manager as any).recreateVenv('3.10.12');

    // Second call should execute (not be deduped)
    mockExecuteCommand.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    await (manager as any).recreateVenv('3.10.12');

    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);

    fs.rmSync(uvPath);
  });
});
