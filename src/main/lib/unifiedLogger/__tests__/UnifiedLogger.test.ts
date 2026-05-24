import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createLogger, resetGlobalLogger } from '../index';
import { getCurrentLogFileName } from '../FileOperations';

describe('UnifiedLogger manual flush', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let tempDir: string;

  beforeEach(async () => {
    process.env.NODE_ENV = 'production';
    resetGlobalLogger();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-unified-logger-test-'));
  });

  afterEach(async () => {
    resetGlobalLogger();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes low-volume logs to disk when manually flushed before the cache object is full', async () => {
    const logger = createLogger({
      LOGGER_DIRECTORY: tempDir,
      LOGGER_CACHE_MAX_SIZE: 100,
      LOGGER_ENABLE_CONSOLE: false,
    });

    logger.info('setEnabled entry', 'SyncIPC');
    logger.info('setEnabled result', 'SyncIPC');

    await logger.flushToDisk();

    const logFile = path.join(tempDir, getCurrentLogFileName());
    const content = await fs.readFile(logFile, 'utf8');

    expect(content).toContain('[SyncIPC] setEnabled entry');
    expect(content).toContain('[SyncIPC] setEnabled result');
  });

  it('keeps existing logger references valid when config is updated later', async () => {
    const firstDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-unified-logger-first-'));
    const secondDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-unified-logger-second-'));

    try {
      const earlyLogger = createLogger({
        LOGGER_DIRECTORY: firstDir,
        LOGGER_CACHE_MAX_SIZE: 100,
        LOGGER_ENABLE_CONSOLE: false,
      });

      const configuredLogger = createLogger({ LOGGER_DIRECTORY: secondDir });

      expect(configuredLogger).toBe(earlyLogger);

      earlyLogger.info('push entry', 'SyncIPC');
      await configuredLogger.flushToDisk();

      const logFile = path.join(secondDir, getCurrentLogFileName());
      const content = await fs.readFile(logFile, 'utf8');

      expect(content).toContain('[SyncIPC] push entry');
    } finally {
      await Promise.all([
        fs.rm(firstDir, { recursive: true, force: true }),
        fs.rm(secondDir, { recursive: true, force: true }),
      ]);
    }
  });
});
