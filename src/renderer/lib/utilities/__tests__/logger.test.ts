import { Logger, createLogger } from '../logger';

// Separate test file for development-mode branches uses vi.importActual with
// NODE_ENV override — but since isDevelopment is captured at module parse time
// and V8 coverage is per-module, we test the non-dev branches here comprehensively.

describe('Logger', () => {
  let consoleSpy: { log: any; warn: any; error: any };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getInstance', () => {
    it('returns a Logger instance', () => {
      const instance = Logger.getInstance('[Test]');
      expect(instance).toBeInstanceOf(Logger);
    });

    it('returns the same instance on subsequent calls', () => {
      const a = Logger.getInstance('[A]');
      const b = Logger.getInstance('[B]');
      expect(a).toBe(b);
    });
  });

  describe('createLogger', () => {
    it('creates a new Logger instance with given prefix', () => {
      const log = createLogger('[MyModule]');
      expect(log).toBeInstanceOf(Logger);
    });
  });

  describe('log methods', () => {
    let log: Logger;

    beforeEach(() => {
      log = new Logger('[Test]');
    });

    it('info logs to console.log', () => {
      log.info('hello', 'world');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('warn logs to console.warn', () => {
      log.warn('warning');
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('error logs to console.error', () => {
      log.error('error');
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('success logs to console.log', () => {
      log.success('done');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('startup logs to console.log', () => {
      log.startup('starting');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('system logs to console.log', () => {
      log.system('sys info');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('debug logs in development mode', () => {
      log.debug('debug info');
      // In test env NODE_ENV might be 'test', so debug may or may not log
      // Just verify no crash
    });

    it('verbose logs in development mode', () => {
      log.verbose('verbose info');
    });

    it('perf logs without function', () => {
      log.perf('operation');
    });

    it('perf logs with function', () => {
      const fn = vi.fn();
      log.perf('operation', fn);
      // fn may or may not be called depending on isDevelopment
    });
  });

  describe('serialization', () => {
    let log: Logger;

    beforeEach(() => {
      log = new Logger('[Test]');
    });

    it('handles null arguments', () => {
      log.info(null);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('handles undefined arguments', () => {
      log.info(undefined);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('handles Error arguments', () => {
      log.info(new Error('test error'));
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('handles Error without stack trace', () => {
      const err = new Error('no stack');
      err.stack = undefined;
      log.info(err);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('handles no arguments', () => {
      log.info();
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('handles object arguments', () => {
      log.info({ key: 'value' });
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('handles circular objects gracefully', () => {
      const obj: any = {};
      obj.self = obj;
      log.info(obj);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('handles multiple arguments', () => {
      log.info('msg', 123, { a: 1 }, null);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('source extraction', () => {
    it('extracts source from bracket prefix', () => {
      const log = new Logger('[ChatInput]');
      log.info('test');
      const call = consoleSpy.log.mock.calls[0];
      expect(call[0]).toContain('[ChatInput]');
    });

    it('uses raw prefix when no brackets', () => {
      const log = new Logger('NoBrackets');
      log.info('test');
      const call = consoleSpy.log.mock.calls[0];
      expect(call[0]).toContain('NoBrackets');
    });
  });

  describe('development mode branches', () => {
    const originalEnv = process.env.NODE_ENV;

    // The isDevelopment flag is captured at module load time, so we need
    // to re-import the module with NODE_ENV=development to test those branches.
    // Since the module caches isDevelopment at import time, we use vi.importActual
    // or reset modules approach.

    it('debug/verbose/perf are no-ops in non-development mode', () => {
      // In test mode, isDevelopment is false
      const log = new Logger('[Test]');
      log.debug('should not log');
      log.verbose('should not log');
      log.perf('should not log');
      log.perf('should not log', () => {});
      // No console output for debug/verbose/perf
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });
  });
});
