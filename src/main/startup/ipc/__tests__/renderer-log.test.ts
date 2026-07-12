import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockOn = vi.fn();
const mockHandleLog = vi.fn();
const mockGetDevLogger = vi.fn<() => { handleLog: typeof mockHandleLog } | null>(
  () => ({ handleLog: mockHandleLog }),
);

vi.mock('electron', () => ({
  ipcMain: {
    on: (...args: any[]) => mockOn(...args),
  },
}));

vi.mock('../../../lib/devLogger', () => ({
  getDevLogger: () => mockGetDevLogger(),
}));

function getRegisteredHandler(): Function {
  const call = mockOn.mock.calls.find(([channel]) => channel === 'logger:rendererLog');
  if (!call) {
    throw new Error('logger:rendererLog handler was not registered');
  }
  return call[1];
}

describe('renderer log IPC', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalArgv = [...process.argv];

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv.splice(0, process.argv.length, ...originalArgv.filter((arg) => arg !== '--dev'));
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.argv.splice(0, process.argv.length, ...originalArgv);
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('forwards structured renderer logs when the app is launched with --dev', async () => {
    process.argv.push('--dev');
    const log = { __openkosmos_log: true, level: 'INFO', message: 'renderer ready' };

    const { registerRendererLogIPC } = await import('../renderer-log');
    registerRendererLogIPC();
    await getRegisteredHandler()({}, log);

    expect(mockGetDevLogger).toHaveBeenCalledTimes(1);
    expect(mockHandleLog).toHaveBeenCalledWith(log);
  });

  it('does not forward renderer logs outside development logging mode', async () => {
    const log = { __openkosmos_log: true, level: 'INFO', message: 'renderer ready' };

    const { registerRendererLogIPC } = await import('../renderer-log');
    registerRendererLogIPC();
    await getRegisteredHandler()({}, log);

    expect(mockGetDevLogger).not.toHaveBeenCalled();
    expect(mockHandleLog).not.toHaveBeenCalled();
  });

  it('does not forward unstructured renderer logs in development logging mode', async () => {
    process.argv.push('--dev');

    const { registerRendererLogIPC } = await import('../renderer-log');
    registerRendererLogIPC();
    await getRegisteredHandler()({}, { message: 'plain console output' });

    expect(mockGetDevLogger).not.toHaveBeenCalled();
    expect(mockHandleLog).not.toHaveBeenCalled();
  });

  it('does not call handleLog when development mode is enabled but no DevLogger exists', async () => {
    process.argv.push('--dev');
    mockGetDevLogger.mockReturnValueOnce(null);
    const injectedIpc = { on: vi.fn((channel: string, handler: Function) => mockOn(channel, handler)) } as any;

    const { registerRendererLogIPC } = await import('../renderer-log');
    registerRendererLogIPC(injectedIpc);
    await getRegisteredHandler()({}, { __openkosmos_log: true, level: 'INFO', message: 'hello' });

    expect(injectedIpc.on).toHaveBeenCalledWith('logger:rendererLog', expect.any(Function));
    expect(mockHandleLog).not.toHaveBeenCalled();
  });
});

export {};
