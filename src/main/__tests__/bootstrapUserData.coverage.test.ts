/**
 * bootstrapUserData side-effect coverage.
 *
 * The module runs its brand userData configuration at import time, so each test
 * resets the module registry, re-mocks electron with fresh spies, pins the
 * relevant process.env / process.platform, then dynamically imports the module
 * and asserts which app.* calls fired.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = [
  'OPENKOSMOS_TEST_USER_DATA_PATH',
  'OPENKOSMOS_USER_DATA_NAME',
  'APP_NAME',
  'USER_DATA_NAME',
  'APP_ID',
] as const;

const savedEnv: Record<string, string | undefined> = {};
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function makeAppMock() {
  const setName = vi.fn();
  const setPath = vi.fn();
  const setAppUserModelId = vi.fn();
  const getPath = vi.fn((key: string) => `/mock/${key}`);
  return { setName, setPath, setAppUserModelId, getPath };
}

async function importBootstrap(app: ReturnType<typeof makeAppMock>) {
  vi.resetModules();
  vi.doMock('electron', () => ({ app }));
  vi.doMock('fs', () => ({ existsSync: vi.fn(() => false), renameSync: vi.fn() }));
  await import('../bootstrapUserData');
}

describe('bootstrapUserData', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Snapshot + clear all env keys the module reads so each test starts clean.
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Default to a non-Windows platform so the AUMID block is skipped unless a
    // test explicitly opts in.
    setPlatform('darwin');
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    setPlatform(originalPlatform);
    vi.doUnmock('electron');
    vi.doUnmock('fs');
  });

  it('E2E override: sets name and userData path when OPENKOSMOS_TEST_USER_DATA_PATH and APP_NAME are set', async () => {
    process.env.OPENKOSMOS_TEST_USER_DATA_PATH = '/e2e/userData';
    process.env.APP_NAME = 'OpenKosmos';
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setName).toHaveBeenCalledWith('OpenKosmos');
    expect(app.setPath).toHaveBeenCalledWith('userData', '/e2e/userData');
    // Override path wins: getPath('appData') is never consulted.
    expect(app.getPath).not.toHaveBeenCalledWith('appData');
  });

  it('E2E override: sets only userData path when APP_NAME is absent', async () => {
    process.env.OPENKOSMOS_TEST_USER_DATA_PATH = '/e2e/userData';
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setName).not.toHaveBeenCalled();
    expect(app.setPath).toHaveBeenCalledWith('userData', '/e2e/userData');
  });

  it('brand path: uses OPENKOSMOS_USER_DATA_NAME runtime override when present', async () => {
    process.env.APP_NAME = 'OpenKosmos';
    process.env.OPENKOSMOS_USER_DATA_NAME = 'override-folder';
    process.env.USER_DATA_NAME = 'build-folder';
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setName).toHaveBeenCalledWith('OpenKosmos');
    expect(app.getPath).toHaveBeenCalledWith('appData');
    expect(app.setPath).toHaveBeenCalledWith('userData', '/mock/appData/override-folder');
  });

  it('runtime folder override bypasses migration even when it selects the default folder name', async () => {
    process.env.APP_NAME = 'OpenKosmos';
    process.env.OPENKOSMOS_USER_DATA_NAME = 'openkosmos-app';
    const app = makeAppMock();
    const existsSync = vi.fn(() => true);
    const renameSync = vi.fn();

    vi.resetModules();
    vi.doMock('electron', () => ({ app }));
    vi.doMock('fs', () => ({ existsSync, renameSync }));
    await import('../bootstrapUserData');

    expect(existsSync).not.toHaveBeenCalled();
    expect(renameSync).not.toHaveBeenCalled();
    expect(app.setPath).toHaveBeenCalledWith('userData', '/mock/appData/openkosmos-app');
  });

  it('brand path: falls back to USER_DATA_NAME when no runtime override', async () => {
    process.env.APP_NAME = 'OpenKosmos';
    process.env.USER_DATA_NAME = 'openkosmos-app';
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setPath).toHaveBeenCalledWith('userData', '/mock/appData/openkosmos-app');
  });

  it('migrates legacy user data when the OpenKosmos directory does not exist', async () => {
    process.env.APP_NAME = 'OpenKosmos';
    process.env.USER_DATA_NAME = 'openkosmos-app';
    const app = makeAppMock();
    const existsSync = vi.fn((candidate: string) => candidate.endsWith('/kosmos-app'));
    const renameSync = vi.fn();

    vi.resetModules();
    vi.doMock('electron', () => ({ app }));
    vi.doMock('fs', () => ({ existsSync, renameSync }));
    await import('../bootstrapUserData');

    expect(renameSync).toHaveBeenCalledWith(
      '/mock/appData/kosmos-app',
      '/mock/appData/openkosmos-app',
    );
    expect(app.setPath).toHaveBeenCalledWith('userData', '/mock/appData/openkosmos-app');
  });

  it('uses existing OpenKosmos data without touching legacy data', async () => {
    process.env.APP_NAME = 'OpenKosmos';
    process.env.USER_DATA_NAME = 'openkosmos-app';
    const app = makeAppMock();
    const existsSync = vi.fn(() => true);
    const renameSync = vi.fn();

    vi.resetModules();
    vi.doMock('electron', () => ({ app }));
    vi.doMock('fs', () => ({ existsSync, renameSync }));
    await import('../bootstrapUserData');

    expect(renameSync).not.toHaveBeenCalled();
    expect(app.setPath).toHaveBeenCalledWith('userData', '/mock/appData/openkosmos-app');
  });

  it('falls back to legacy data when migration fails', async () => {
    process.env.APP_NAME = 'OpenKosmos';
    process.env.USER_DATA_NAME = 'openkosmos-app';
    const app = makeAppMock();
    const existsSync = vi.fn((candidate: string) => candidate.endsWith('/kosmos-app'));
    const migrationError = new Error('permission denied');
    const renameSync = vi.fn(() => {
      throw migrationError;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.resetModules();
    vi.doMock('electron', () => ({ app }));
    vi.doMock('fs', () => ({ existsSync, renameSync }));
    await import('../bootstrapUserData');

    expect(app.setPath).toHaveBeenCalledWith('userData', '/mock/appData/kosmos-app');
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('continuing with the legacy path'),
      migrationError,
    );
  });

  it('brand path: falls back to the OpenKosmos default when no folder name is injected', async () => {
    process.env.APP_NAME = 'OpenKosmos';
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setPath).toHaveBeenCalledWith('userData', '/mock/appData/openkosmos-app');
  });

  it('no-op: makes no app calls when neither override nor APP_NAME present', async () => {
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setName).not.toHaveBeenCalled();
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.setAppUserModelId).not.toHaveBeenCalled();
  });

  it('Windows: sets the App User Model ID when on win32 with APP_ID', async () => {
    setPlatform('win32');
    process.env.APP_ID = 'com.openkosmos-ai-studio';
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setAppUserModelId).toHaveBeenCalledWith('com.openkosmos-ai-studio');
  });

  it('Windows: does not set AUMID when on win32 without APP_ID', async () => {
    setPlatform('win32');
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setAppUserModelId).not.toHaveBeenCalled();
  });

  it('non-Windows: does not set AUMID even when APP_ID is present', async () => {
    setPlatform('darwin');
    process.env.APP_ID = 'com.openkosmos-ai-studio';
    const app = makeAppMock();

    await importBootstrap(app);

    expect(app.setAppUserModelId).not.toHaveBeenCalled();
  });

  it('readRuntimeEnv: swallows errors when process.env access throws', async () => {
    const realEnv = process.env;
    // Replace process.env with a proxy that throws only for the first key the
    // module reads, exercising readRuntimeEnv's try/catch fallback to undefined.
    const throwingEnv = new Proxy(realEnv, {
      get(target, prop) {
        if (prop === 'OPENKOSMOS_TEST_USER_DATA_PATH') {
          throw new Error('env access boom');
        }
        return Reflect.get(target, prop);
      },
    });
    Object.defineProperty(process, 'env', { value: throwingEnv, configurable: true });
    const app = makeAppMock();

    try {
      await importBootstrap(app);
    } finally {
      Object.defineProperty(process, 'env', { value: realEnv, configurable: true });
    }

    // Fallback returned undefined → treated as no override; APP_NAME unset → no-op.
    expect(app.setPath).not.toHaveBeenCalled();
  });
});
