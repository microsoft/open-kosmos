/**
 * Extra coverage for ExecuteCommandTool — validateArgs all branches,
 * getDangerousPatternReason categorisation, getDefinition, buildCommandLine,
 * and normalizeTimeout edge cases.
 */

vi.mock('../../../runtime/RuntimeManager', async () => ({
  RuntimeManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunTimeConfig: vi.fn().mockReturnValue({ mode: 'system' }),
      getBinPath: vi.fn().mockReturnValue('/mock/bin'),
      resolveCommand: vi.fn((cmd: string) => cmd),
    }),
  },
}));

vi.mock('../builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    getExecutionContext: vi.fn().mockReturnValue(null),
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

vi.mock('../../../terminalManager', async () => ({
  getTerminalManager: vi.fn().mockReturnValue({
    executeCommand: vi.fn(),
    getOrCreateSession: vi.fn(),
  }),
}));

vi.mock('../../../backgroundProcessManager', async () => ({
  getBackgroundProcessManager: vi.fn().mockReturnValue({
    startProcess: vi.fn(),
  }),
}));

import { ExecuteCommandTool } from '../executeCommandTool';

// ---------------------------------------------------------------------------
// validateArgs
// ---------------------------------------------------------------------------

describe('ExecuteCommandTool.validateArgs', () => {
  const validate = (args: any) => (ExecuteCommandTool as any).validateArgs(args);

  it('returns invalid when args is null', () => {
    const r = validate(null);
    expect(r.isValid).toBe(false);
  });

  it('returns invalid when args is a string', () => {
    const r = validate('hello');
    expect(r.isValid).toBe(false);
  });

  it('returns invalid when description is missing', () => {
    const r = validate({ command: 'ls', cwd: '/tmp' });
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/description/);
  });

  it('returns invalid when description is whitespace only', () => {
    const r = validate({ description: '   ', command: 'ls', cwd: '/tmp' });
    expect(r.isValid).toBe(false);
  });

  it('returns invalid when command is missing', () => {
    const r = validate({ description: 'test', cwd: '/tmp' });
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/command/);
  });

  it('returns invalid when command is empty string', () => {
    const r = validate({ description: 'test', command: '', cwd: '/tmp' });
    expect(r.isValid).toBe(false);
  });

  it('returns invalid when cwd is missing', () => {
    const r = validate({ description: 'test', command: 'ls' });
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/cwd/);
  });

  it('returns invalid when cwd is whitespace only', () => {
    const r = validate({ description: 'test', command: 'ls', cwd: '  ' });
    expect(r.isValid).toBe(false);
  });

  it('returns invalid when args is not an array', () => {
    const r = validate({ description: 'test', command: 'ls', cwd: '/tmp', args: 'bad' });
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/args must be an array/);
  });

  it('returns invalid when args contains non-string entry', () => {
    const r = validate({ description: 'test', command: 'ls', cwd: '/tmp', args: [42] });
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/each arg/);
  });

  it('returns invalid when timeoutSeconds is Infinity', () => {
    const r = validate({ description: 'test', command: 'ls', cwd: '/tmp', timeoutSeconds: Infinity });
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/finite/);
  });

  it('returns invalid when timeoutSeconds is zero', () => {
    const r = validate({ description: 'test', command: 'ls', cwd: '/tmp', timeoutSeconds: 0 });
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/greater than zero/);
  });

  it('returns invalid when timeoutSeconds is negative', () => {
    const r = validate({ description: 'test', command: 'ls', cwd: '/tmp', timeoutSeconds: -5 });
    expect(r.isValid).toBe(false);
  });

  it('returns invalid for unsupported shell', () => {
    const r = validate({ description: 'test', command: 'ls', cwd: '/tmp', shell: 'fish' });
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/shell must be one of/);
  });

  it('accepts valid args', () => {
    const r = validate({
      description: 'run ls',
      command: 'ls',
      cwd: '/tmp',
      args: ['-la'],
      timeoutSeconds: 30,
      shell: 'bash',
    });
    expect(r.isValid).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('accepts all allowed shells', () => {
    for (const shell of ['powershell', 'cmd', 'bash', 'sh', 'zsh']) {
      const r = validate({ description: 'd', command: 'c', cwd: '/tmp', shell });
      expect(r.isValid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeTimeout — edge cases
// ---------------------------------------------------------------------------

describe('ExecuteCommandTool.normalizeTimeout', () => {
  const normalizeTimeout = (s: any, cmd: string) =>
    (ExecuteCommandTool as any).normalizeTimeout(s, cmd);

  it('throws when timeoutSeconds is NaN', () => {
    expect(() => normalizeTimeout(NaN, 'ls')).toThrow('timeoutSeconds must be a finite number');
  });

  it('clamps to 1s minimum (input 0.1)', () => {
    expect(normalizeTimeout(0.1, 'ls')).toBe(1000);
  });

  it('clamps to 900s maximum (input 999)', () => {
    expect(normalizeTimeout(999, 'ls')).toBe(900_000);
  });

  it('floors fractional seconds', () => {
    expect(normalizeTimeout(30.9, 'ls')).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// getDangerousPatternReason
// ---------------------------------------------------------------------------

describe('ExecuteCommandTool.getDangerousPatternReason', () => {
  const getReason = (pattern: RegExp) =>
    (ExecuteCommandTool as any).getDangerousPatternReason(pattern);

  it('returns credential message for token/cookie pattern', () => {
    const reason = getReason(/credential|token|cookie|auth.*cache/i);
    expect(reason).toMatch(/credential/i);
  });

  it('returns OAuth logout message for microsoftonline pattern', () => {
    const reason = getReason(/login\.microsoftonline\.com\/.*\/logout/i);
    expect(reason).toMatch(/OAuth logout|destructive/i);
  });

  it('returns OAuth logout message for live.com logout pattern', () => {
    const reason = getReason(/login\.live\.com\/.*logout/i);
    expect(reason).toMatch(/OAuth logout|destructive/i);
  });

  it('returns OAuth logout message for google logout', () => {
    const reason = getReason(/accounts\.google\.com\/Logout/i);
    expect(reason).toMatch(/OAuth logout|destructive/i);
  });

  it('returns OAuth logout message for /oauth2/revoke pattern', () => {
    const reason = getReason(/\/oauth2?\/(?:logout|revoke|signout)/i);
    expect(reason).toMatch(/OAuth logout|destructive/i);
  });

  it('returns browser profile message for Edge/Chrome User Data', () => {
    const reason = getReason(/(?:Microsoft\\\\Edge|Google\\\\Chrome)\\\\User Data/i);
    expect(reason).toMatch(/browser profile/i);
  });

  it('returns browser profile message for macOS Application Support', () => {
    const reason = getReason(/Application Support\/(?:Microsoft Edge|Google\/Chrome)/i);
    expect(reason).toMatch(/browser profile/i);
  });

  it('returns fallback message for rm -rf pattern', () => {
    const reason = getReason(/rm\s+-rf\s+\/?/i);
    expect(reason).toMatch(/destructive/i);
  });
});

// ---------------------------------------------------------------------------
// getDefinition
// ---------------------------------------------------------------------------

describe('ExecuteCommandTool.getDefinition', () => {
  it('returns a definition with name execute_command', () => {
    const def = ExecuteCommandTool.getDefinition();
    expect(def.name).toBe('execute_command');
    expect(def.description).toBeTruthy();
  });

  it('has required inputSchema fields', () => {
    const def = ExecuteCommandTool.getDefinition();
    expect(def.inputSchema.required).toContain('command');
    expect(def.inputSchema.required).toContain('cwd');
    expect(def.inputSchema.required).toContain('description');
  });

  it('lists platform info in description', () => {
    const def = ExecuteCommandTool.getDefinition();
    expect(def.description).toMatch(/Platform:/);
  });
});

// ---------------------------------------------------------------------------
// isInteractiveAuthCommand
// ---------------------------------------------------------------------------

describe('ExecuteCommandTool.isInteractiveAuthCommand', () => {
  const isInteractive = (cmd: string) =>
    (ExecuteCommandTool as any).isInteractiveAuthCommand(cmd);

  it('returns true for gh auth login', () => {
    expect(isInteractive('gh auth login -h github.com')).toBe(true);
  });

  it('returns false for gh auth status', () => {
    expect(isInteractive('gh auth status')).toBe(false);
  });

  it('returns false for ordinary commands', () => {
    expect(isInteractive('npm install')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractDeviceCode edge cases
// ---------------------------------------------------------------------------

describe('ExecuteCommandTool.extractDeviceCode', () => {
  const extract = (s: string) => (ExecuteCommandTool as any).extractDeviceCode(s);

  it('extracts labeled device code', () => {
    expect(extract('Your device code: ABCD-1234')).toBe('ABCD-1234');
  });

  it('extracts generic XX-XX pattern', () => {
    expect(extract('Copy this code: EFGH-5678 and go to the URL')).toBe('EFGH-5678');
  });

  it('returns undefined when no code present', () => {
    expect(extract('No code here')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractVerificationUri edge cases
// ---------------------------------------------------------------------------

describe('ExecuteCommandTool.extractVerificationUri', () => {
  const extract = (s: string) => (ExecuteCommandTool as any).extractVerificationUri(s);

  it('extracts https URI', () => {
    expect(extract('Visit https://github.com/login/device')).toBe('https://github.com/login/device');
  });

  it('extracts http URI', () => {
    expect(extract('Visit http://localhost:3000/auth')).toBe('http://localhost:3000/auth');
  });

  it('returns undefined when no URL', () => {
    expect(extract('No URL here')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// execute — invalid args throw
// ---------------------------------------------------------------------------

describe('ExecuteCommandTool.execute — validation errors', () => {
  it('throws when description is missing', async () => {
    await expect(
      ExecuteCommandTool.execute({ command: 'ls', cwd: '/tmp' } as any),
    ).rejects.toThrow(/Invalid execute_command arguments/);
  });

  it('throws when command is empty', async () => {
    await expect(
      ExecuteCommandTool.execute({ description: 'test', command: '', cwd: '/tmp' } as any),
    ).rejects.toThrow(/Invalid execute_command arguments/);
  });

  it('throws when timeoutSeconds is Infinity (validation)', async () => {
    await expect(
      ExecuteCommandTool.execute({
        description: 'test',
        command: 'ls',
        cwd: '/tmp',
        timeoutSeconds: Infinity,
      } as any),
    ).rejects.toThrow(/Invalid execute_command arguments/);
  });
});
