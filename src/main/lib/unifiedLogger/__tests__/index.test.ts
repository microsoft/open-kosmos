import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  resetGlobalLogger,
  createLogger,
  getGlobalLogger,
  initializeGlobalLogger,
  createConsoleLogger,
  createHighPerformanceLogger,
  createDebugLogger,
  isGlobalLoggerInitialized,
  getUnifiedLogger,
  getRefactoredLogger,
  DEFAULT_CONFIG,
  DEFAULT_REFACTORED_CONFIG,
} from '../index';
import { getCurrentLogFileName } from '../FileOperations';

describe('index.ts - createLogger variants and global logger', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let tempDir: string;

  beforeEach(async () => {
    process.env.NODE_ENV = 'production';
    resetGlobalLogger();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-index-test-'));
  });

  afterEach(async () => {
    resetGlobalLogger();
    process.env.NODE_ENV = originalNodeEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('isGlobalLoggerInitialized returns false before create', () => {
    expect(isGlobalLoggerInitialized()).toBe(false);
  });

  it('isGlobalLoggerInitialized returns true after createLogger', () => {
    createLogger({ LOGGER_DIRECTORY: tempDir, LOGGER_ENABLE_CONSOLE: false });
    expect(isGlobalLoggerInitialized()).toBe(true);
  });

  it('getGlobalLogger returns same instance on repeated calls', () => {
    const l1 = getGlobalLogger({ LOGGER_DIRECTORY: tempDir });
    const l2 = getGlobalLogger();
    expect(l1).toBe(l2);
  });

  it('getGlobalLogger with config calls updateConfig on existing logger', () => {
    const l1 = getGlobalLogger({ LOGGER_DIRECTORY: tempDir });
    const l2 = getGlobalLogger({ LOGGER_ENABLE_CONSOLE: false });
    expect(l1).toBe(l2);
    expect(l2.getConfig().LOGGER_ENABLE_CONSOLE).toBe(false);
  });

  it('initializeGlobalLogger initializes logger', () => {
    const logger = initializeGlobalLogger({ LOGGER_DIRECTORY: tempDir });
    expect(logger).toBeDefined();
    expect(logger.isInitialized).toBe(true);
  });

  it('initializeGlobalLogger calls initialize when not initialized', () => {
    // Simulate a logger where isInitialized=false but initialize exists
    const mockLogger = {
      initialize: vi.fn(),
      isInitialized: false,
      updateConfig: vi.fn(),
      getConfig: vi.fn().mockReturnValue({}),
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      log: vi.fn(), flushToDisk: vi.fn(), handleAppExit: vi.fn(),
      getStats: vi.fn(), getQueueStatus: vi.fn(), shutdown: vi.fn(),
    };
    // Replace globalLogger internals via getGlobalLogger return
    // We test this by checking the real implementation: once a logger exists
    // with isInitialized=false, initializeGlobalLogger calls initialize()
    const realLogger = createLogger({ LOGGER_DIRECTORY: tempDir });
    (realLogger as any).isInitialized = false;
    initializeGlobalLogger(); // should call initialize()
    expect((realLogger as any).isInitialized).toBe(true);
  });

  it('createConsoleLogger creates logger with console enabled', () => {
    const logger = createConsoleLogger();
    expect(logger).toBeDefined();
  });

  it('createHighPerformanceLogger creates logger', () => {
    const logger = createHighPerformanceLogger(tempDir);
    expect(logger).toBeDefined();
    expect(logger.getConfig().LOGGER_CACHE_MAX_SIZE).toBe(10000);
  });

  it('createHighPerformanceLogger without directory uses undefined', () => {
    const logger = createHighPerformanceLogger();
    expect(logger).toBeDefined();
  });

  it('createDebugLogger creates logger', () => {
    const logger = createDebugLogger();
    expect(logger).toBeDefined();
    expect(logger.getConfig().LOGGER_LEVELS).toContain('DEBUG');
  });

  it('getUnifiedLogger returns global logger', () => {
    const logger = getUnifiedLogger({ LOGGER_DIRECTORY: tempDir });
    expect(logger).toBeDefined();
  });

  it('getRefactoredLogger returns global logger', () => {
    const logger = getRefactoredLogger({ LOGGER_DIRECTORY: tempDir });
    expect(logger).toBeDefined();
  });

  it('DEFAULT_CONFIG and DEFAULT_REFACTORED_CONFIG are exported', () => {
    expect(DEFAULT_CONFIG).toBeDefined();
    expect(DEFAULT_REFACTORED_CONFIG).toBeDefined();
  });

  it('logger.log works', () => {
    const logger = createLogger({ LOGGER_DIRECTORY: tempDir, LOGGER_ENABLE_CONSOLE: false });
    expect(() => logger.log('INFO', 'msg', 'src')).not.toThrow();
  });

  it('logger.debug/info/warn/error work', () => {
    const logger = createLogger({ LOGGER_DIRECTORY: tempDir, LOGGER_ENABLE_CONSOLE: false });
    expect(() => {
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
    }).not.toThrow();
  });

  it('logger.getStats returns correct structure', () => {
    const logger = createLogger({ LOGGER_DIRECTORY: tempDir, LOGGER_ENABLE_CONSOLE: false });
    logger.info('msg');
    const stats = logger.getStats();
    expect(stats).toHaveProperty('totalLogsProcessed');
    expect(stats).toHaveProperty('pendingQueueSize');
    expect(stats).toHaveProperty('cacheQueueSize');
    expect(stats).toHaveProperty('pendingSaveQueueSize');
    expect(stats).toHaveProperty('totalFilesWritten');
    expect(stats).toHaveProperty('averageProcessingTime');
  });

  it('logger.getQueueStatus returns correct structure', () => {
    const logger = createLogger({ LOGGER_DIRECTORY: tempDir, LOGGER_ENABLE_CONSOLE: false });
    const qs = logger.getQueueStatus();
    expect(qs).toHaveProperty('pendingLogQueue');
    expect(qs).toHaveProperty('cacheQueue');
    expect(qs).toHaveProperty('pendingSaveQueue');
  });

  it('logger.updateConfig works', () => {
    const logger = createLogger({ LOGGER_DIRECTORY: tempDir, LOGGER_ENABLE_CONSOLE: false });
    logger.updateConfig({ LOGGER_ENABLE_CONSOLE: false });
    expect(logger.getConfig().LOGGER_ENABLE_CONSOLE).toBe(false);
  });

  it('logger.initialize is a no-op', () => {
    const logger = createLogger({ LOGGER_DIRECTORY: tempDir, LOGGER_ENABLE_CONSOLE: false });
    expect(() => (logger as any).initialize()).not.toThrow();
  });

  it('logger.shutdown calls handleAppExit', async () => {
    const logger = createLogger({ LOGGER_DIRECTORY: tempDir, LOGGER_ENABLE_CONSOLE: false });
    logger.info('before shutdown');
    await expect(logger.shutdown!()).resolves.not.toThrow();
  });

  it('logger.handleAppExit flushes and waits', async () => {
    const logger = createLogger({
      LOGGER_DIRECTORY: tempDir,
      LOGGER_ENABLE_CONSOLE: false,
      LOGGER_CACHE_MAX_SIZE: 100
    });
    logger.info('flush test');
    await expect(logger.handleAppExit()).resolves.not.toThrow();

    const logFile = path.join(tempDir, getCurrentLogFileName());
    const content = await fs.readFile(logFile, 'utf8');
    expect(content).toContain('flush test');
  });

  it('logger.flushToDisk writes to file', async () => {
    const logger = createLogger({
      LOGGER_DIRECTORY: tempDir,
      LOGGER_ENABLE_CONSOLE: false,
      LOGGER_CACHE_MAX_SIZE: 100
    });
    logger.info('flush test msg');
    await logger.flushToDisk();

    const logFile = path.join(tempDir, getCurrentLogFileName());
    const content = await fs.readFile(logFile, 'utf8');
    expect(content).toContain('flush test msg');
  });

  it('resetGlobalLogger resets all singletons', () => {
    createLogger({ LOGGER_DIRECTORY: tempDir });
    expect(isGlobalLoggerInitialized()).toBe(true);
    resetGlobalLogger();
    expect(isGlobalLoggerInitialized()).toBe(false);
  });
});
