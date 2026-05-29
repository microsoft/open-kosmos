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

  it('blocks microsoftonline logout endpoint', async () => {
    await expect(
      ExecuteCommandTool.execute({
        ...VALID_ARGS_BASE,
        command: 'curl https://login.microsoftonline.com/tenant/logout',
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
    mockGetExecutionContext.mockReturnValue(null);
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
});

// ── normalizeTimeout ──────────────────────────────────────────────────────────
describe('ExecuteCommandTool — normalizeTimeout', () => {
  const normalize = (s: any, cmd: string) => (ExecuteCommandTool as any).normalizeTimeout(s, cmd);

  it('clamps 0 to 1 second', () => {
    expect(normalize(0, 'ls')).toBeGreaterThan(0);
  });

  it('clamps 9999 to 900 seconds (900000ms)', () => {
    expect(normalize(9999, 'ls')).toBe(900_000);
  });

  it('uses INTERACTIVE_AUTH_TIMEOUT for gh auth login even with explicit lower value', () => {
    expect(normalize(30, 'gh auth login')).toBe(900_000);
  });

  it('throws on Infinity', () => {
    expect(() => normalize(Infinity, 'ls')).toThrow('finite');
  });

  it('throws on NaN', () => {
    expect(() => normalize(NaN, 'ls')).toThrow('finite');
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

  it('extracts device code with label', () => {
    const hint = build('az login', 'device code ABCD-1234 enter it', '');
    expect(hint?.deviceCode).toBe('ABCD-1234');
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

  it('detects az login', () => {
    expect(isAuth('az login')).toBe(true);
    expect(family('az login')).toBe('az-login');
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
