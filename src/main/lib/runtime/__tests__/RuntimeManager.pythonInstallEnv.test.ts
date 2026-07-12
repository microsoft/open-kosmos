import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

const { testUserData, mockLogger, mockSpawn } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  return {
    testUserData: p.join(o.tmpdir(), 'openkosmos-test-python-install-env'),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockSpawn: vi.fn(),
  };
});

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue(testUserData),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    isPackaged: false,
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
      runtimeEnvironment: {
        mode: 'system',
        bunVersion: '1.3.6',
        uvVersion: '0.6.17',
        pinnedPythonVersion: null,
      },
    }),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../userDataADO/types/app', async () => ({
  DEFAULT_RUNTIME_ENVIRONMENT: {
    mode: 'system',
    bunVersion: '1.3.6',
    uvVersion: '0.6.17',
    pinnedPythonVersion: null,
  },
}));

vi.mock('../../terminalManager', async () => ({
  getTerminalManager: () => ({
    executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  }),
}));

vi.mock('node-stream-zip', async () => ({}));

vi.mock('../LocalPythonMirror', async () => ({
  LocalPythonMirror: {
    getInstance: () => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      getBaseUrlIfRunning: vi.fn().mockReturnValue(null),
    }),
  },
}));

vi.mock('../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  exec: vi.fn(),
  execSync: vi.fn(),
}));

import { RuntimeManager } from '../RuntimeManager';

beforeEach(() => {
  (RuntimeManager as any).instance = undefined;
  fs.rmSync(testUserData, { recursive: true, force: true });
  fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(testUserData, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'), '');
  mockSpawn.mockReset();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockLogger.debug.mockClear();
});

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

describe('RuntimeManager.doInstallPythonVersion environment', () => {
  it('does not pass a possibly broken active VIRTUAL_ENV to uv python install', async () => {
    const manager = RuntimeManager.getInstance() as any;
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    });

    await manager.doInstallPythonVersion('3.10.12');

    expect(mockSpawn).toHaveBeenCalledWith(
      path.join(testUserData, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'),
      ['python', 'install', '3.10.12'],
      expect.objectContaining({
        env: expect.not.objectContaining({ VIRTUAL_ENV: expect.any(String) }),
      }),
    );
  });
});
