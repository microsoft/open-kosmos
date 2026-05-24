vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue('C:\\test\\userData'),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined)
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}));

vi.mock('../../runtime/RuntimeManager', async () => ({
  RuntimeManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunTimeConfig: vi.fn().mockReturnValue({ mode: 'system' }),
      getBinPath: vi.fn().mockReturnValue('C:\\test\\bin'),
      resolveCommand: vi.fn((cmd: string) => cmd),
    }),
  },
}));

import { EventEmitter } from 'events';
import { TerminalInstance } from '../TerminalInstance';
import { TerminalConfig } from '../types';

class MockChildProcess extends EventEmitter {
  public killed = false;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public kill = vi.fn((signal?: string) => {
    this.killed = true;
    return signal !== 'SIGKILL';
  });
}

class TestableTerminalInstance extends TerminalInstance {
  public attachMockProcess(process: MockChildProcess): void {
    (this as any)._process = process;
    (this as any)._state = 'running';
  }

  public setBufferedOutput(stdout: string, stderr: string): void {
    (this as any).stdout = stdout;
    (this as any).stderr = stderr;
  }
}

function createConfig(timeoutMs?: number): TerminalConfig {
  return {
    command: 'ssh host "echo test"',
    args: [],
    cwd: 'C:\\test',
    type: 'command',
    shell: 'powershell',
    timeoutMs,
  };
}

describe('TerminalInstance execute lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves from close when the process closes normally', async () => {
    const instance = new TestableTerminalInstance(createConfig());
    const child = new MockChildProcess();
    instance.attachMockProcess(child);
    instance.setBufferedOutput('ok', '');

    const resultPromise = instance.execute();
    child.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
  });

  it('falls back to exit when close never arrives', async () => {
    const instance = new TestableTerminalInstance(createConfig());
    const child = new MockChildProcess();
    instance.attachMockProcess(child);
    instance.setBufferedOutput('', 'timed out');

    const resultPromise = instance.execute();
    child.emit('exit', null, 'SIGTERM');
    vi.advanceTimersByTime(50);

    await expect(resultPromise).resolves.toMatchObject({
      stderr: 'timed out',
      exitCode: null,
      timedOut: false,
    });
  });

  it('returns a timedOut result even when only exit arrives after timeout kill', async () => {
    const instance = new TestableTerminalInstance(createConfig(100));
    const child = new MockChildProcess();
    instance.attachMockProcess(child);

    const resultPromise = instance.execute();

    vi.advanceTimersByTime(100);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    child.emit('exit', null, 'SIGTERM');
    vi.advanceTimersByTime(50);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: null,
      timedOut: true,
    });
  });
});