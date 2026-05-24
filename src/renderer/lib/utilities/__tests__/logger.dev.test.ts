/**
 * Tests for Logger in development mode.
 * isDevelopment is captured at module load time, so we must set NODE_ENV
 * before importing and use vi.resetModules() to get a fresh module.
 */

let Logger: any;
let consoleSpy: { log: any; warn: any; error: any };

beforeAll(async () => {
  // Set development mode BEFORE importing the module
  vi.stubEnv('NODE_ENV', 'development');
  vi.resetModules();

  const mod = await import('../logger');
  Logger = mod.Logger;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

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

describe('Logger (development mode)', () => {
  it('debug logs in development mode', () => {
    const log = new Logger('[Test]');
    log.debug('debug info');
    expect(consoleSpy.log).toHaveBeenCalled();
  });

  it('verbose logs in development mode', () => {
    const log = new Logger('[Test]');
    log.verbose('verbose info');
    expect(consoleSpy.log).toHaveBeenCalled();
  });

  it('perf logs label without function in development mode', () => {
    const log = new Logger('[Test]');
    log.perf('operation');
    expect(consoleSpy.log).toHaveBeenCalled();
  });

  it('perf measures and logs function duration in development mode', () => {
    const log = new Logger('[Test]');
    const fn = vi.fn();
    log.perf('operation', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(consoleSpy.log).toHaveBeenCalled();
  });

  it('sends structured log via IPC when electronAPI is available', () => {
    const sendLog = vi.fn();
    (globalThis as any).window = {
      electronAPI: { logger: { sendLog } },
    };

    const log = new Logger('[Test]');
    log.info('hello', 'extra');
    expect(sendLog).toHaveBeenCalledTimes(1);
    const call = sendLog.mock.calls[0][0];
    expect(call.__openkosmos_log).toBe(true);
    expect(call.level).toBe('INFO');
    expect(call.source).toBe('Test');
    expect(call.args).toBeDefined();

    delete (globalThis as any).window;
  });

  it('sends structured log without args when only one argument', () => {
    const sendLog = vi.fn();
    (globalThis as any).window = {
      electronAPI: { logger: { sendLog } },
    };

    const log = new Logger('[Test]');
    log.info('single');
    const call = sendLog.mock.calls[0][0];
    expect(call.args).toBeUndefined();

    delete (globalThis as any).window;
  });
});
