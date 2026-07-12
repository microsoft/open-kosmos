/**
 * Coverage for ExecuteCommandTool's integration with the central no-response watchdog:
 * reportActivity on real output, AbortSignal honoring (idle watchdog / user cancel teardown),
 * the interactive-auth keepalive, and the non-auth backstop terminal timeout.
 */

// ── Module-level mocks (must come before any imports) ─────────────────────────

const {
  mockGetExecutionContext,
  mockCreateInstance,
  mockStartInstance,
  mockExecuteInstance,
  mockStopInstance,
  mockInstanceOn,
} = vi.hoisted(() => {
  const mockGetExecutionContext = vi.fn().mockReturnValue(null);
  const mockInstanceOn = vi.fn();
  const mockStartInstance = vi.fn().mockResolvedValue(undefined);
  const mockExecuteInstance = vi.fn().mockResolvedValue({
    stdout: 'hello',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    durationMs: 100,
    truncated: false,
  });
  const mockStopInstance = vi.fn().mockResolvedValue(undefined);
  const mockCreateInstance = vi.fn((_config?: Record<string, unknown>) => ({
    id: 'instance-1',
    on: mockInstanceOn,
    start: mockStartInstance,
    execute: mockExecuteInstance,
  }));
  return {
    mockGetExecutionContext,
    mockCreateInstance,
    mockStartInstance,
    mockExecuteInstance,
    mockStopInstance,
    mockInstanceOn,
  };
});

vi.mock('../../../runtime/RuntimeManager', () => ({
  RuntimeManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunTimeConfig: vi.fn().mockReturnValue({ mode: 'system' }),
      getBinPath: vi.fn().mockReturnValue('/mock/bin'),
      resolveCommand: vi.fn((cmd: string) => cmd),
    }),
  },
}));

vi.mock('../builtinToolsManager', () => ({
  BuiltinToolsManager: {
    getExecutionContext: mockGetExecutionContext,
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/mock-user-data'),
    getName: vi.fn().mockReturnValue('openkosmos'),
  },
}));

vi.mock('../../../terminalManager/PlatformConfigManager', () => ({
  PlatformConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getShellPath: vi.fn().mockReturnValue('/bin/bash'),
      getDefaultShell: vi.fn().mockReturnValue('bash'),
    }),
  },
}));

vi.mock('../../../terminalManager', () => ({
  getTerminalManager: vi.fn().mockReturnValue({
    createInstance: mockCreateInstance,
    stopInstance: mockStopInstance,
  }),
}));

vi.mock('../../../backgroundProcessManager', () => ({
  getBackgroundProcessManager: vi.fn().mockReturnValue({
    spawn: vi.fn(),
  }),
}));

vi.mock('../../../backgroundProcessManager/commandLineUtils', () => ({
  buildCommandLine: vi.fn((cmd: string, args?: string[]) =>
    args && args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd
  ),
}));

import { ExecuteCommandTool } from '../executeCommandTool';

const NO_RESPONSE_BACKSTOP_MS = 24 * 60 * 60 * 1000;
const INTERACTIVE_AUTH_KEEPALIVE_MS = 60_000;
const INTERACTIVE_AUTH_TIMEOUT_MS = 900_000;

const VALID_ARGS_BASE = {
  description: 'test command',
  command: 'echo hello',
  cwd: '/tmp',
};

const SUCCESS_RESULT = {
  stdout: '',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  durationMs: 1,
  truncated: false,
};

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    cancellationToken: { isCancellationRequested: false },
    registerCancellationHandler: vi.fn(() => ({ dispose: vi.fn() })),
    reportActivity: vi.fn(),
    ...overrides,
  };
}

function findHandler(event: string): ((chunk: string) => void) | undefined {
  const call = mockInstanceOn.mock.calls.find((c) => c[0] === event);
  return call?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetExecutionContext.mockReturnValue(null);
  mockStartInstance.mockResolvedValue(undefined);
  mockStopInstance.mockResolvedValue(undefined);
  mockExecuteInstance.mockResolvedValue({ ...SUCCESS_RESULT, stdout: 'hello' });
});

// ── reportActivity on real output ─────────────────────────────────────────────

describe('ExecuteCommandTool — reportActivity on output', () => {
  it('reports activity when the terminal emits stdout and stderr', async () => {
    const context = makeContext();
    mockGetExecutionContext.mockReturnValue(context);
    mockExecuteInstance.mockImplementation(async () => {
      findHandler('stdout')?.('chunk-out');
      findHandler('stderr')?.('chunk-err');
      return { ...SUCCESS_RESULT, stdout: 'chunk-out', stderr: 'chunk-err\n' };
    });

    await ExecuteCommandTool.execute(VALID_ARGS_BASE);

    expect(context.reportActivity).toHaveBeenCalledTimes(2);
  });

  it('uses the captured execution context instead of the mutable global context', async () => {
    const globalContext = makeContext();
    const capturedContext = makeContext();
    mockGetExecutionContext.mockReturnValue(globalContext);
    mockExecuteInstance.mockImplementation(async () => {
      findHandler('stdout')?.('chunk-out');
      return { ...SUCCESS_RESULT, stdout: 'chunk-out' };
    });

    await ExecuteCommandTool.execute(VALID_ARGS_BASE, { executionContext: capturedContext as any });

    expect(capturedContext.reportActivity).toHaveBeenCalledOnce();
    expect(globalContext.reportActivity).not.toHaveBeenCalled();
  });

  it('tolerates a context without reportActivity', async () => {
    const context = makeContext({ reportActivity: undefined });
    mockGetExecutionContext.mockReturnValue(context);
    mockExecuteInstance.mockImplementation(async () => {
      findHandler('stdout')?.('chunk-out');
      return { ...SUCCESS_RESULT, stdout: 'chunk-out' };
    });

    await expect(ExecuteCommandTool.execute(VALID_ARGS_BASE)).resolves.toBeDefined();
  });
});

// ── terminal timeout: auth bounded vs non-auth backstop ───────────────────────

describe('ExecuteCommandTool — terminal timeout selection', () => {
  it('uses the far backstop for non-auth commands', async () => {
    await ExecuteCommandTool.execute(VALID_ARGS_BASE);
    expect(mockCreateInstance.mock.calls[0]?.[0]?.timeoutMs).toBe(NO_RESPONSE_BACKSTOP_MS);
  });

  it('keeps the bounded auth window for interactive-auth commands', async () => {
    await ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, command: 'gh auth login' });
    expect(mockCreateInstance.mock.calls[0]?.[0]?.timeoutMs).toBe(INTERACTIVE_AUTH_TIMEOUT_MS);
  });
});

// ── AbortSignal honoring ──────────────────────────────────────────────────────

describe('ExecuteCommandTool — AbortSignal honoring', () => {
  it('stops the terminal immediately when the signal is already aborted', async () => {
    await ExecuteCommandTool.execute(VALID_ARGS_BASE, { signal: AbortSignal.abort() });
    expect(mockStopInstance).toHaveBeenCalledWith('instance-1', true);
  });

  it('stops the terminal when the signal aborts mid-execution', async () => {
    const controller = new AbortController();
    let resolveExec: (value: unknown) => void = () => {};
    mockExecuteInstance.mockReturnValue(new Promise((resolve) => { resolveExec = resolve; }));

    const promise = ExecuteCommandTool.execute(VALID_ARGS_BASE, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    resolveExec({ ...SUCCESS_RESULT });
    await promise;

    expect(mockStopInstance).toHaveBeenCalledWith('instance-1', true);
  });

  it('runs without a signal when options are omitted', async () => {
    await expect(ExecuteCommandTool.execute(VALID_ARGS_BASE)).resolves.toBeDefined();
  });
});

// ── interactive-auth keepalive ────────────────────────────────────────────────

describe('ExecuteCommandTool — interactive-auth keepalive', () => {
  it('pins the watchdog at a steady cadence while waiting, then stops on completion', async () => {
    vi.useFakeTimers();
    try {
      const context = makeContext();
      mockGetExecutionContext.mockReturnValue(context);
      let resolveExec: (value: unknown) => void = () => {};
      mockExecuteInstance.mockReturnValue(new Promise((resolve) => { resolveExec = resolve; }));

      const promise = ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, command: 'gh auth login' });
      await vi.advanceTimersByTimeAsync(0);
      expect(context.reportActivity).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(INTERACTIVE_AUTH_KEEPALIVE_MS);
      expect(context.reportActivity).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(INTERACTIVE_AUTH_KEEPALIVE_MS);
      expect(context.reportActivity).toHaveBeenCalledTimes(2);

      resolveExec({ ...SUCCESS_RESULT });
      await vi.advanceTimersByTimeAsync(0);
      await promise;

      const callsAfterCompletion = context.reportActivity.mock.calls.length;
      await vi.advanceTimersByTimeAsync(INTERACTIVE_AUTH_KEEPALIVE_MS * 3);
      expect(context.reportActivity).toHaveBeenCalledTimes(callsAfterCompletion);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not arm the keepalive for non-auth commands', async () => {
    vi.useFakeTimers();
    try {
      const context = makeContext();
      mockGetExecutionContext.mockReturnValue(context);
      let resolveExec: (value: unknown) => void = () => {};
      mockExecuteInstance.mockReturnValue(new Promise((resolve) => { resolveExec = resolve; }));

      const promise = ExecuteCommandTool.execute(VALID_ARGS_BASE);
      await vi.advanceTimersByTimeAsync(INTERACTIVE_AUTH_KEEPALIVE_MS * 3);
      expect(context.reportActivity).not.toHaveBeenCalled();

      resolveExec({ ...SUCCESS_RESULT });
      await vi.advanceTimersByTimeAsync(0);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── early cancellation cleanup ────────────────────────────────────────────────

describe('ExecuteCommandTool — early cancellation cleanup', () => {
  it('clears keepalive and signal listener when cancellation is already requested', async () => {
    const context = makeContext({ cancellationToken: { isCancellationRequested: true } });
    mockGetExecutionContext.mockReturnValue(context);
    const controller = new AbortController();

    await expect(
      ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, command: 'gh auth login' }, { signal: controller.signal })
    ).rejects.toThrow(/command execution failed/);

    expect(mockStopInstance).toHaveBeenCalledWith('instance-1', true);
    // start/execute must never run once cancellation is already requested
    expect(mockStartInstance).not.toHaveBeenCalled();
    expect(mockExecuteInstance).not.toHaveBeenCalled();
  });

  it('handles early cancellation for a non-auth command without a signal', async () => {
    const context = makeContext({ cancellationToken: { isCancellationRequested: true } });
    mockGetExecutionContext.mockReturnValue(context);

    await expect(
      ExecuteCommandTool.execute(VALID_ARGS_BASE)
    ).rejects.toThrow(/command execution failed/);

    expect(mockStopInstance).toHaveBeenCalledWith('instance-1', true);
    expect(mockStartInstance).not.toHaveBeenCalled();
    expect(mockExecuteInstance).not.toHaveBeenCalled();
  });
});
