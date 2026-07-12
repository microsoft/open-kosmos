import { describe, expect, it, vi } from 'vitest';

const baseFileOperations = {
  isDevelopmentLogEnvironment: vi.fn(() => true),
  getDefaultLogDirectory: vi.fn(() => '/workspace/dev-logs'),
  getCurrentLogFileName: vi.fn(() => 'openkosmos-dev-2026-01-01-00-00-00.log'),
  ensureLogDirectoryExists: vi.fn(() => Promise.resolve()),
  cleanupOldLogFiles: vi.fn(() => Promise.resolve()),
};

async function importDevLogger(overrides: Partial<typeof baseFileOperations> = {}) {
  vi.resetModules();
  const fileOperations = { ...baseFileOperations, ...overrides };
  const appendFile = vi.fn(() => Promise.resolve());

  vi.doMock('../../unifiedLogger/FileOperations', () => fileOperations);
  vi.doMock('fs/promises', () => ({ appendFile }));

  const mod = await import('../index');
  return { ...mod, fileOperations, appendFile };
}

describe('DevLogger additional coverage', () => {
  it('honors LOG_LEVEL from the environment', async () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';

    const { getDevLogger } = await importDevLogger();
    const logger = getDevLogger()!;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.handleLog({
      __openkosmos_log: true,
      level: 'DEBUG',
      source: 'EnvLevel',
      message: 'debug is enabled',
      timestamp: Date.now(),
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    if (original === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = original;
    }
  });

  it('returns null and keeps helpers as no-ops outside development logging mode', async () => {
    const { getDevLogger, attachDevLoggerToWindow, shutdownDevLogger } = await importDevLogger({
      isDevelopmentLogEnvironment: vi.fn(() => false),
    });

    expect(getDevLogger()).toBeNull();
    attachDevLoggerToWindow({ webContents: { on: vi.fn() } } as any);
    await expect(shutdownDevLogger()).resolves.toBeUndefined();
  });

  it('flushes immediately when the buffer reaches the max size', async () => {
    const { getDevLogger, appendFile } = await importDevLogger();
    const logger = getDevLogger()!;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    (logger as any).MAX_BUFFER_SIZE = 1;

    logger.handleLog({
      __openkosmos_log: true,
      level: 'INFO',
      source: 'ImmediateFlush',
      message: 'flush now',
      timestamp: Date.now(),
    });
    await vi.waitFor(() => {
      expect(appendFile).toHaveBeenCalledTimes(1);
    });
  });

  it('schedules a delayed flush when the buffer does not reach the max size', async () => {
    vi.useFakeTimers();
    const { getDevLogger, appendFile } = await importDevLogger();
    const logger = getDevLogger()!;
    vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.handleLog({
      __openkosmos_log: true,
      level: 'INFO',
      source: 'DelayedFlush',
      message: 'flush later',
      timestamp: Date.now(),
    });

    expect(appendFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(appendFile).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('maps every explicit color branch and the default branch', async () => {
    const { getDevLogger } = await importDevLogger();
    const logger = getDevLogger()!;

    expect((logger as any).getColorCode('DEBUG')).toBe('90');
    expect((logger as any).getColorCode('VERBOSE')).toBe('90');
    expect((logger as any).getColorCode('PERF')).toBe('35');
    expect((logger as any).getColorCode('SYSTEM')).toBe('32');
    expect((logger as any).getColorCode('UNKNOWN')).toBe('0');
  });

  it('drops console-message events that do not meet the log threshold', async () => {
    const { getDevLogger } = await importDevLogger();
    const logger = getDevLogger()!;
    let handler: ((event: any) => void) | undefined;
    const webContents = {
      on: vi.fn((_channel: string, fn: (event: any) => void) => {
        handler = fn;
      }),
    } as any;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.attachToWebContents(webContents);
    const initialCallCount = consoleSpy.mock.calls.length;
    handler?.({ message: '[Renderer] verbose', level: 'verbose' });

    expect(consoleSpy).toHaveBeenCalledTimes(initialCallCount);
    consoleSpy.mockRestore();
  });

  it('falls back to default console-message fields when they are missing or unknown', async () => {
    const { getDevLogger } = await importDevLogger();
    const logger = getDevLogger()!;
    let handler: ((event: any) => void) | undefined;
    const webContents = {
      on: vi.fn((_channel: string, fn: (event: any) => void) => {
        handler = fn;
      }),
    } as any;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.attachToWebContents(webContents);
    handler?.({});

    expect(consoleSpy.mock.calls.some(([message]) => String(message).includes('[R:Renderer]'))).toBe(true);
    consoleSpy.mockRestore();
  });
});
