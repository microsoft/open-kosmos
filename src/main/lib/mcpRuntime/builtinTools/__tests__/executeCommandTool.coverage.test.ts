/**
 * Additional coverage tests for ExecuteCommandTool
 * Targets uncovered branches: background mode, terminal execution path,
 * dangerous patterns, interactive auth, finalize result, and emitPartialResult.
 */

// ── Module-level mocks (must come before any imports) ─────────────────────────

const {
  mockGetExecutionContext,
  mockCreateInstance,
  mockStartInstance,
  mockExecuteInstance,
  mockStopInstance,
  mockSpawn,
  mockInstanceOn,
  mockGetRunTimeConfig,
  mockWaitForShimsReady,
  mockEnsurePythonPipAvailable,
} = vi.hoisted(() => {
  const mockGetExecutionContext = vi.fn().mockReturnValue(null);
  const mockGetRunTimeConfig = vi.fn().mockReturnValue({ mode: 'system' });
  const mockWaitForShimsReady = vi.fn().mockResolvedValue(undefined);
  const mockEnsurePythonPipAvailable = vi.fn().mockResolvedValue(true);
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
  const mockCreateInstance = vi.fn(() => ({
    id: 'instance-1',
    on: mockInstanceOn,
    start: mockStartInstance,
    execute: mockExecuteInstance,
  }));
  const mockSpawn = vi.fn().mockResolvedValue({ sessionId: 'bg-session-1', pid: 1234 });
  return {
    mockGetExecutionContext,
    mockCreateInstance,
    mockStartInstance,
    mockExecuteInstance,
    mockStopInstance,
    mockInstanceOn,
    mockSpawn,
    mockGetRunTimeConfig,
    mockWaitForShimsReady,
    mockEnsurePythonPipAvailable,
  };
});

vi.mock('../../../runtime/RuntimeManager', () => ({
  RuntimeManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunTimeConfig: mockGetRunTimeConfig,
      waitForShimsReady: mockWaitForShimsReady,
      ensurePythonPipAvailable: mockEnsurePythonPipAvailable,
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
    spawn: mockSpawn,
  }),
}));

vi.mock('../../../backgroundProcessManager/commandLineUtils', () => ({
  buildCommandLine: vi.fn((cmd: string, args?: string[]) =>
    args && args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd
  ),
}));

import { ExecuteCommandTool } from '../executeCommandTool';

const VALID_ARGS_BASE = {
  description: 'test command',
  command: 'echo hello',
  cwd: '/tmp',
};
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

// ── dangerous patterns ────────────────────────────────────────────────────────
describe('ExecuteCommandTool — dangerous pattern blocking', () => {
  it('blocks rm -rf command', async () => {
    await expect(
      ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, command: 'rm -rf /tmp/foo' })
    ).rejects.toThrow(/blocked by safety policy/);
  });

  it('blocks shutdown command', async () => {
    await expect(
      ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, command: 'shutdown -h now' })
    ).rejects.toThrow(/blocked by safety policy/);
  });

  it('blocks oauth2 revoke endpoint', async () => {
    await expect(
      ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, command: 'curl https://example.com/oauth2/revoke' })
    ).rejects.toThrow(/blocked by safety policy/);
  });

  it('blocks an identity-provider logout endpoint', async () => {
    await expect(
      ExecuteCommandTool.execute({
        ...VALID_ARGS_BASE,
        command: 'curl https://id.example.com/tenant/logout',
      })
    ).rejects.toThrow(/blocked by safety policy/);
  });

  it('blocks credential file deletion', async () => {
    await expect(
      ExecuteCommandTool.execute({
        ...VALID_ARGS_BASE,
        command: 'rm ~/.config/credential',
      })
    ).rejects.toThrow(/blocked by safety policy/);
  });
});

// ── background mode ───────────────────────────────────────────────────────────
describe('ExecuteCommandTool — background mode', () => {
  it('returns sessionId and pid for background execution', async () => {
    const result = await ExecuteCommandTool.execute({
      ...VALID_ARGS_BASE,
      background: true,
    });
    expect(result).toMatchObject({
      sessionId: 'bg-session-1',
      pid: 1234,
      background: true,
    });
    expect(mockSpawn).toHaveBeenCalled();
  });
});

// ── terminal execution ────────────────────────────────────────────────────────
describe('ExecuteCommandTool — terminal execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform(originalPlatform);
    mockGetExecutionContext.mockReturnValue(null);
    mockGetRunTimeConfig.mockReturnValue({ mode: 'system' });
    mockWaitForShimsReady.mockResolvedValue(undefined);
    mockEnsurePythonPipAvailable.mockResolvedValue(true);
    mockInstanceOn.mockImplementation(() => undefined);
    mockCreateInstance.mockImplementation(() => ({
      id: 'instance-1',
      on: mockInstanceOn,
      start: mockStartInstance,
      execute: mockExecuteInstance,
    }));
    mockExecuteInstance.mockResolvedValue({
      stdout: 'hello world',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: 50,
      truncated: false,
    });
  });

  it('executes command and returns stdout', async () => {
    const result = await ExecuteCommandTool.execute(VALID_ARGS_BASE) as any;
    expect(result.stdout).toBe('hello world');
    expect(result.exitCode).toBe(0);
    expect(result.success).toBeUndefined(); // ExecuteCommandToolResult has no 'success' field
  });

  it('returns timedOut=true when command times out', async () => {
    mockExecuteInstance.mockResolvedValue({
      stdout: '',
      stderr: 'timeout',
      exitCode: 1,
      timedOut: true,
      durationMs: 60000,
      truncated: false,
    });
    const result = await ExecuteCommandTool.execute(VALID_ARGS_BASE) as any;
    expect(result.timedOut).toBe(true);
  });

  it('returns shell from args', async () => {
    const result = await ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, shell: 'bash' }) as any;
    expect(result.shell).toBe('bash');
  });

  it('passes cwd through to result', async () => {
    const result = await ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, cwd: '/home/user' }) as any;
    expect(result.cwd).toBe('/home/user');
  });

  it('waits for app-managed shims before foreground Python commands in internal mode', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });

    await ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, command: 'python3 --version' });

    expect(mockWaitForShimsReady).toHaveBeenCalledTimes(1);
  });

  it('does not wait for app-managed shims before ordinary commands', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });

    await ExecuteCommandTool.execute({ ...VALID_ARGS_BASE, command: 'echo hello' });

    expect(mockWaitForShimsReady).not.toHaveBeenCalled();
  });

  it('repairs missing app-managed pip and retries the original command once', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });
    mockExecuteInstance
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '/tmp/python-venv/bin/python3: No module named pip',
        exitCode: 1,
        timedOut: false,
        durationMs: 20,
        truncated: false,
      })
      .mockResolvedValueOnce({
        stdout: 'installed',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 40,
        truncated: false,
      });

    const result = await ExecuteCommandTool.execute({
      ...VALID_ARGS_BASE,
      command: 'python3 -m pip install numpy',
    }) as any;

    expect(mockEnsurePythonPipAvailable).toHaveBeenCalledTimes(1);
    expect(mockCreateInstance).toHaveBeenCalledTimes(2);
    expect(mockExecuteInstance).toHaveBeenCalledTimes(2);
    expect(result.stdout).toBe('installed');
    expect(result.exitCode).toBe(0);
  });

  it('does not retry missing pip more than once when repair fails', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });
    mockEnsurePythonPipAvailable.mockResolvedValueOnce(false);
    mockExecuteInstance.mockResolvedValueOnce({
      stdout: '',
      stderr: 'No module named pip',
      exitCode: 1,
      timedOut: false,
      durationMs: 20,
      truncated: false,
    });

    const result = await ExecuteCommandTool.execute({
      ...VALID_ARGS_BASE,
      command: 'python3 -m pip install numpy',
    }) as any;

    expect(mockEnsurePythonPipAvailable).toHaveBeenCalledTimes(1);
    expect(mockExecuteInstance).toHaveBeenCalledTimes(1);
    expect(result.stderr).toBe('No module named pip');
    expect(result.exitCode).toBe(1);
  });

  it('does not repair missing pip when the first run was cancelled', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });
    const controller = new AbortController();
    controller.abort();
    mockExecuteInstance.mockResolvedValueOnce({
      stdout: '',
      stderr: 'No module named pip',
      exitCode: 1,
      timedOut: false,
      durationMs: 20,
      truncated: false,
    });

    const result = await ExecuteCommandTool.execute(
      {
        ...VALID_ARGS_BASE,
        command: 'python3 -m pip install numpy',
      },
      { signal: controller.signal, executionContext: null },
    ) as any;

    expect(mockEnsurePythonPipAvailable).not.toHaveBeenCalled();
    expect(mockExecuteInstance).toHaveBeenCalledTimes(1);
    expect(result.stderr).toBe('No module named pip');
  });

  it('does not repair missing pip for system-runtime commands', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'system' });
    mockExecuteInstance.mockResolvedValueOnce({
      stdout: '',
      stderr: 'No module named pip',
      exitCode: 1,
      timedOut: false,
      durationMs: 20,
      truncated: false,
    });

    const result = await ExecuteCommandTool.execute({
      ...VALID_ARGS_BASE,
      command: 'python3 -m pip install numpy',
    }) as any;

    expect(mockEnsurePythonPipAvailable).not.toHaveBeenCalled();
    expect(mockExecuteInstance).toHaveBeenCalledTimes(1);
    expect(result.stderr).toBe('No module named pip');
  });

  it('emits partial output for empty, truncated, and newline-terminated chunks', async () => {
    const handlers = new Map<string, (chunk: string) => void>();
    const eventSender = { send: vi.fn() };
    mockGetExecutionContext.mockReturnValue({
      eventSender,
      currentToolCallId: 'tool-call-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      reportActivity: vi.fn(),
      registerCancellationHandler: vi.fn(() => ({ dispose: vi.fn() })),
      cancellationToken: { isCancellationRequested: false },
    });
    mockInstanceOn.mockImplementation((event: string, cb: (chunk: string) => void) => {
      handlers.set(event, cb);
    });
    mockExecuteInstance.mockImplementation(async () => {
      handlers.get('stdout')?.('');
      handlers.get('stdout')?.('x'.repeat(9001));
      handlers.get('stderr')?.('warning\n');
      handlers.get('stderr')?.('next warning');
      return {
        stdout: 'done',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 50,
        truncated: true,
      };
    });

    const result = await ExecuteCommandTool.execute(VALID_ARGS_BASE) as any;

    expect(result.truncated).toBe(true);
    expect(eventSender.send).toHaveBeenCalledWith(
      'agentChat:streamingChunk',
      expect.objectContaining({
        type: 'tool_result',
      }),
    );
  });

  it('uses the non-Error fallback when terminal setup throws a non-Error value', async () => {
    mockCreateInstance.mockRejectedValueOnce('terminal-crashed');

    await expect(ExecuteCommandTool.execute(VALID_ARGS_BASE)).rejects.toThrow(
      'command execution failed: Unknown error',
    );
  });
});

// ── getDefinition ─────────────────────────────────────────────────────────────
describe('ExecuteCommandTool — getDefinition', () => {
  it('returns correct tool name', () => {
    const def = ExecuteCommandTool.getDefinition();
    expect(def.name).toBe('execute_command');
  });

  it('requires description, command, cwd', () => {
    const required = ExecuteCommandTool.getDefinition().inputSchema.required;
    expect(required).toContain('description');
    expect(required).toContain('command');
    expect(required).toContain('cwd');
  });

  it('describes the Windows default shell on win32', () => {
    setPlatform('win32');

    expect(ExecuteCommandTool.getDefinition().description).toContain('Default shell: powershell');

    setPlatform(originalPlatform);
  });
});

describe('ExecuteCommandTool — app-managed Python command helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });
    mockEnsurePythonPipAvailable.mockResolvedValue(true);
  });

  it('recognizes Python, pip, and uv pip commands', () => {
    const isPythonOrPip = (cmd: string) => (ExecuteCommandTool as any).isPythonOrPipCommand(cmd);

    expect(isPythonOrPip('python -m pip install numpy')).toBe(true);
    expect(isPythonOrPip('pip install numpy')).toBe(true);
    expect(isPythonOrPip('pip3 install numpy')).toBe(true);
    expect(isPythonOrPip('uv pip install numpy')).toBe(true);
    expect(isPythonOrPip('')).toBe(false);
  });

  it('does not attempt pip repair for non-Python commands', async () => {
    await expect((ExecuteCommandTool as any).repairMissingPipForCommand('echo hello')).resolves.toBe(false);

    expect(mockEnsurePythonPipAvailable).not.toHaveBeenCalled();
  });

  it('logs and returns false when pip repair throws a non-Error value', async () => {
    mockEnsurePythonPipAvailable.mockRejectedValueOnce('repair-crashed');

    await expect((ExecuteCommandTool as any).repairMissingPipForCommand('python3 -m pip install numpy')).resolves.toBe(false);
  });
});

// ── buildInteractiveAuthHint ──────────────────────────────────────────────────
describe('ExecuteCommandTool — buildInteractiveAuthHint', () => {
  const build = (cmd: string, stdout: string, stderr: string) =>
    (ExecuteCommandTool as any).buildInteractiveAuthHint(cmd, stdout, stderr, 60000, Date.now());

  it('returns undefined for non-auth commands', () => {
    expect(build('ls', '', '')).toBeUndefined();
  });

  it('returns hint for gh auth login', () => {
    const hint = build('gh auth login', 'Visit https://github.com/login\nCode: ABCD-1234', '');
    expect(hint).toBeDefined();
    expect(hint.commandFamily).toBe('gh-auth-login');
    expect(hint.verificationUri).toContain('https://');
  });

  it('returns hint for npm adduser', () => {
    const hint = build('npm adduser', '', '');
    expect(hint?.commandFamily).toBe('npm-adduser');
  });
});

// ── interactive auth finalizeInteractiveAuthResult ────────────────────────────
describe('ExecuteCommandTool — finalizeInteractiveAuthResult', () => {
  const finalize = (result: any, reason: any) =>
    (ExecuteCommandTool as any).finalizeInteractiveAuthResult(result, reason);

  it('returns result unchanged when no interactiveAuth', () => {
    const r = { stdout: 'ok', stderr: '', exitCode: 0, timedOut: false };
    expect(finalize(r, 'cancelled')).toEqual(r);
  });

  it('clears stdout/stderr for cancelled reason', () => {
    const r = { stdout: 'some output', stderr: '', interactiveAuth: {}, timedOut: false };
    const out = finalize(r, 'cancelled');
    expect(out.stdout).toBe('');
    expect(out.success).toBe(false);
    expect(out.exitCode).toBe(130);
  });

  it('sets timedOut=true for timed_out reason', () => {
    const r = { stdout: '', stderr: '', interactiveAuth: {}, timedOut: false, exitCode: 1 };
    const out = finalize(r, 'timed_out');
    expect(out.timedOut).toBe(true);
  });

  it('does not alter result when reason is null', () => {
    const r = { stdout: 'x', stderr: '', interactiveAuth: {} };
    expect(finalize(r, null)).toEqual(r);
  });
});

// ── isInteractiveAuthCommand / getInteractiveAuthCommandFamily ────────────────
describe('ExecuteCommandTool — auth command detection', () => {
  const isAuth = (cmd: string) => (ExecuteCommandTool as any).isInteractiveAuthCommand(cmd);
  const family = (cmd: string) => (ExecuteCommandTool as any).getInteractiveAuthCommandFamily(cmd);

  it('detects gh auth refresh', () => {
    expect(isAuth('gh auth refresh')).toBe(true);
    expect(family('gh auth refresh')).toBe('gh-auth-refresh');
  });

  it('detects npm login', () => {
    expect(isAuth('npm login')).toBe(true);
    expect(family('npm login')).toBe('npm-login');
  });

  it('detects pnpm login', () => {
    expect(isAuth('pnpm login')).toBe(true);
    expect(family('pnpm login')).toBe('pnpm-login');
  });

  it('detects yarn npm login', () => {
    expect(isAuth('yarn npm login')).toBe(true);
    expect(family('yarn npm login')).toBe('yarn-npm-login');
  });

  it('returns false for normal commands', () => {
    expect(isAuth('echo hello')).toBe(false);
    expect(family('echo hello')).toBeNull();
  });
});
