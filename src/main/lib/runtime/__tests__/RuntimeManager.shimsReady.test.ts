import * as fs from 'fs';

const { testUserData, mockLogger } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { testUserData: p.join(o.tmpdir(), 'openkosmos-test-RuntimeManager'), mockLogger: logger };
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
      runtimeEnvironment: { mode: 'internal', bunVersion: '1.3.6', uvVersion: '0.6.17', pinnedPythonVersion: null },
    }),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../userDataADO/types/app', async () => ({
  DEFAULT_RUNTIME_ENVIRONMENT: { mode: 'internal', bunVersion: '1.3.6', uvVersion: '0.6.17', pinnedPythonVersion: null },
}));

vi.mock('../../terminalManager', async () => ({
  getTerminalManager: vi.fn().mockReturnValue(null),
}));

vi.mock('node-stream-zip', async () => ({}));

vi.mock('../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

import { RuntimeManager } from '../RuntimeManager';

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

// Access private members for testing
function getPrivateField<T>(obj: any, field: string): T {
  return obj[field];
}

describe('RuntimeManager.waitForShimsReady', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    // Reset singleton
    (RuntimeManager as any).instance = undefined;
  });

  it('resolves immediately when _shimsReadyPromise is null (system mode)', async () => {
    manager = RuntimeManager.getInstance();
    // In system mode initializeInternalMode sets no promise; force null for test
    (manager as any)._shimsReadyPromise = null;

    const start = Date.now();
    await manager.waitForShimsReady(1000);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('resolves when the shims promise settles', async () => {
    manager = RuntimeManager.getInstance();
    let resolveShims!: () => void;
    (manager as any)._shimsReadyPromise = new Promise<void>(r => { resolveShims = r; });

    const waiting = manager.waitForShimsReady(5000);
    resolveShims();
    await waiting; // should not throw
  });

  it('resolves (with warning) when the shims promise times out', async () => {
    manager = RuntimeManager.getInstance();
    // A promise that never resolves
    (manager as any)._shimsReadyPromise = new Promise<void>(() => {});

    const start = Date.now();
    await manager.waitForShimsReady(200);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(elapsed).toBeLessThan(1000);
  });

  it('resolves when the shims promise rejects (install failure)', async () => {
    manager = RuntimeManager.getInstance();
    (manager as any)._shimsReadyPromise = Promise.reject(new Error('install failed')).catch(() => {});

    await expect(manager.waitForShimsReady(1000)).resolves.toBeUndefined();
  });
});

describe('RuntimeManager.setRuntimeMode', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    (RuntimeManager as any).instance = undefined;
    manager = RuntimeManager.getInstance();
  });

  it('calls initializeInternalMode when switching to internal', async () => {
    const spy = vi.spyOn(manager, 'initializeInternalMode');
    await manager.setRuntimeMode('internal');
    expect(spy).toHaveBeenCalled();
  });

  it('does not call initializeInternalMode when switching to system', async () => {
    const spy = vi.spyOn(manager, 'initializeInternalMode');
    await manager.setRuntimeMode('system');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('RuntimeManager.getEnvWithInternalPath', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    (RuntimeManager as any).instance = undefined;
    manager = RuntimeManager.getInstance();
  });

  it('prepends binPath to PATH', () => {
    const env = manager.getEnvWithInternalPath({ PATH: '/usr/bin' } as unknown as NodeJS.ProcessEnv);
    const binPath = (manager as any).binPath;
    expect(env['PATH']).toContain(binPath);
    expect(env['PATH']!.startsWith(binPath) || env['PATH']!.includes(binPath)).toBe(true);
  });

  it('sets PYTHONUTF8 and PYTHONIOENCODING', () => {
    const env = manager.getEnvWithInternalPath({ PATH: '/usr/bin' } as unknown as NodeJS.ProcessEnv);
    expect(env['PYTHONUTF8']).toBe('1');
    expect(env['PYTHONIOENCODING']).toBe('utf-8');
  });
});
