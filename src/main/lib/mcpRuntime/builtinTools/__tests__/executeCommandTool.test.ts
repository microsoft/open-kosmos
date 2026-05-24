import { ExecuteCommandTool } from '../executeCommandTool';

// Mock RuntimeManager to prevent async bun download that outlives the test suite
vi.mock('../../../runtime/RuntimeManager', async () => ({
  RuntimeManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunTimeConfig: vi.fn().mockReturnValue({ mode: 'system' }),
      getBinPath: vi.fn().mockReturnValue('/mock/bin'),
      resolveCommand: vi.fn((cmd: string) => cmd),
    }),
  },
}));

// Mock BuiltinToolsManager to provide execution context for execute()
vi.mock('../builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    getExecutionContext: vi.fn().mockReturnValue(null),
  },
}));

// Mock electron app for modules that call app.getPath at import time
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/mock-user-data'),
    getName: vi.fn().mockReturnValue('openkosmos'),
  },
}));

// Mock PlatformConfigManager which calls RuntimeManager.getInstance() at module level
vi.mock('../../../terminalManager/PlatformConfigManager', () => ({
  PlatformConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getShellPath: vi.fn().mockReturnValue('/bin/bash'),
      getDefaultShell: vi.fn().mockReturnValue('bash'),
    }),
  },
}));

// Mock terminalManager — not reached for blocked commands but needed for module load
vi.mock('../../../terminalManager', async () => ({
  getTerminalManager: vi.fn().mockReturnValue({
    executeCommand: vi.fn(),
    getOrCreateSession: vi.fn(),
  }),
}));

// Mock backgroundProcessManager
vi.mock('../../../backgroundProcessManager', async () => ({
  getBackgroundProcessManager: vi.fn().mockReturnValue({
    startProcess: vi.fn(),
  }),
}));

describe('ExecuteCommandTool timeout selection', () => {
  it('uses the standard default timeout for ordinary commands', () => {
    const timeoutMs = (ExecuteCommandTool as any).normalizeTimeout(undefined, 'pwd');
    expect(timeoutMs).toBe(60_000);
  });

  it('extends the default timeout for gh auth login', () => {
    const timeoutMs = (ExecuteCommandTool as any).normalizeTimeout(undefined, 'gh auth login -h github.com -p https -w');
    expect(timeoutMs).toBe(900_000);
  });

  it('extends the default timeout for other interactive auth commands', () => {
    const commands = [
      'gh auth refresh -h github.com -s repo',
      'npm login',
      'npm adduser',
      'pnpm login',
      'yarn npm login'
    ];

    for (const command of commands) {
      const timeoutMs = (ExecuteCommandTool as any).normalizeTimeout(undefined, command);
      expect(timeoutMs).toBe(900_000);
    }
  });

  it('enforces a 15-minute minimum even when gh auth login passes a shorter explicit timeout', () => {
    const timeoutMs = (ExecuteCommandTool as any).normalizeTimeout(120, 'gh auth login -h github.com -p https -w');
    expect(timeoutMs).toBe(900_000);
  });

  it('still respects longer explicit timeouts for interactive auth commands', () => {
    const timeoutMs = (ExecuteCommandTool as any).normalizeTimeout(900, 'gh auth login -h github.com -p https -w');
    expect(timeoutMs).toBe(900_000);
  });

  it('still respects explicit timeouts for ordinary commands', () => {
    const timeoutMs = (ExecuteCommandTool as any).normalizeTimeout(120, 'pwd');
    expect(timeoutMs).toBe(120_000);
  });

  it('extracts interactive auth hints from command output', () => {
    const hint = (ExecuteCommandTool as any).buildInteractiveAuthHint(
      'gh auth login -h github.com -p https -w',
      '',
      '! First copy your one-time code: 81ED-AB39\nOpen this URL to continue in your web browser: https://github.com/login/device\n',
      900_000,
      1_700_000_000_000
    );

    expect(hint).toEqual({
      commandFamily: 'gh-auth-login',
      deviceCode: '81ED-AB39',
      verificationUri: 'https://github.com/login/device',
      timeoutMs: 900_000,
      startedAt: 1_700_000_000_000
    });
  });

  it('replaces timed-out interactive auth details with a restart message', () => {
    const result = (ExecuteCommandTool as any).finalizeInteractiveAuthResult({
      stdout: '',
      stderr: '! First copy your one-time code: 81ED-AB39\nOpen this URL to continue in your web browser: https://github.com/login/device\n',
      exitCode: null,
      timedOut: true,
      durationMs: 120_000,
      cwd: '/tmp/session',
      shell: 'zsh',
      interactiveAuth: {
        commandFamily: 'gh-auth-login',
        deviceCode: '81ED-AB39',
        verificationUri: 'https://github.com/login/device',
        timeoutMs: 900_000,
        startedAt: 1_700_000_000_000,
      }
    }, 'timed_out');

    expect(result).toMatchObject({
      stderr: 'Authentication timed out before completion. Start the sign-in flow again to continue.',
      interactiveAuth: undefined,
      authInterruptedReason: 'timed_out',
      success: false,
      timedOut: true,
    });
  });

  it('replaces cancelled interactive auth details with a restart message', () => {
    const result = (ExecuteCommandTool as any).finalizeInteractiveAuthResult({
      stdout: '',
      stderr: '! First copy your one-time code: 81ED-AB39\nOpen this URL to continue in your web browser: https://github.com/login/device\n',
      exitCode: null,
      timedOut: false,
      durationMs: 2_000,
      cwd: '/tmp/session',
      shell: 'zsh',
      interactiveAuth: {
        commandFamily: 'gh-auth-login',
        deviceCode: '81ED-AB39',
        verificationUri: 'https://github.com/login/device',
        timeoutMs: 900_000,
        startedAt: 1_700_000_000_000,
      }
    }, 'cancelled');

    expect(result).toMatchObject({
      stderr: 'Authentication was canceled by the user. Start the sign-in flow again to continue.',
      interactiveAuth: undefined,
      authInterruptedReason: 'cancelled',
      success: false,
      exitCode: 130,
    });
  });
});

describe('ExecuteCommandTool DANGEROUS_PATTERNS safety check', () => {
  const baseArgs = { timeoutSeconds: 10, description: 'test', cwd: '/tmp' };

  const expectBlocked = async (command: string, args?: string[]) => {
    await expect(
      ExecuteCommandTool.execute({ command, args, ...baseArgs } as any)
    ).rejects.toThrow(/blocked by safety policy/);
  };

  const expectNotBlocked = async (command: string) => {
    // Should NOT throw the safety policy error (may throw other errors like missing terminal)
    try {
      await ExecuteCommandTool.execute({ command, ...baseArgs } as any);
    } catch (e: any) {
      expect(e.message).not.toMatch(/blocked by safety policy/);
    }
  };

  // --- Credential / token deletion ---
  it('blocks PowerShell Remove-Item targeting credential files', async () => {
    await expectBlocked('Remove-Item', ['-Force', 'C:\\Users\\user\\AppData\\Local\\Microsoft\\TokenBroker\\credentials\\browserAuthTokenCache.enc']);
  });

  it('blocks rm targeting token files', async () => {
    await expectBlocked('rm -f ~/.config/auth-token-cache');
  });

  it('blocks del targeting cookie files', async () => {
    await expectBlocked('del /f C:\\Users\\user\\cookies.dat');
  });

  // --- OAuth logout/revoke/signout URLs ---
  it('blocks commands containing Microsoft OAuth logout URL', async () => {
    await expectBlocked('python -c "import requests; requests.get(\'https://login.microsoftonline.com/common/oauth2/logout\')"');
  });

  it('blocks commands containing Google logout URL', async () => {
    await expectBlocked('curl https://accounts.google.com/Logout');
  });

  it('blocks commands containing generic /oauth2/revoke path', async () => {
    await expectBlocked('curl https://example.com/oauth2/revoke?token=abc');
  });

  it('blocks commands containing /oauth/signout path', async () => {
    await expectBlocked('curl https://example.com/oauth/signout');
  });

  it('blocks login.live.com logout', async () => {
    await expectBlocked('curl https://login.live.com/oauth20_logout.srf');
  });

  // --- Browser profile directory access ---
  it('blocks commands targeting Windows Edge User Data directory', async () => {
    await expectBlocked('Remove-Item -Recurse "C:\\Users\\user\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Cookies"');
  });

  it('blocks commands targeting Windows Chrome User Data directory', async () => {
    // In Python/script strings, backslashes are escaped as \\
    await expectBlocked('python -c "import shutil; shutil.rmtree(\'C:\\\\Users\\\\user\\\\AppData\\\\Local\\\\Google\\\\Chrome\\\\User Data\\\\Default\')"');
  });

  it('blocks commands targeting macOS Chrome profile directory', async () => {
    await expectBlocked('rm -rf ~/Library/Application Support/Google/Chrome/Default/Cookies');
  });

  it('blocks commands targeting macOS Edge profile directory', async () => {
    await expectBlocked('rm -rf ~/Library/Application Support/Microsoft Edge/Default/Cookies');
  });

  // --- Args-based bypass prevention ---
  it('blocks dangerous patterns even when passed via args array', async () => {
    await expectBlocked('python', ['-c', 'import webbrowser; webbrowser.open("https://login.microsoftonline.com/common/oauth2/logout")']);
  });

  it('blocks credential deletion passed entirely in args', async () => {
    await expectBlocked('powershell', ['-Command', 'Remove-Item -Force "$env:LOCALAPPDATA\\Microsoft\\TokenBroker\\credentials\\tokenCache.enc"']);
  });

  // --- False positive avoidance ---
  it('does NOT block normal rm commands', async () => {
    await expectNotBlocked('rm temp_file.txt');
  });

  it('does NOT block commands that mention "token" in safe contexts', async () => {
    await expectNotBlocked('echo "your token is valid"');
  });

  // --- Existing filesystem destruction patterns ---
  it('blocks rm -rf /', async () => {
    await expectBlocked('rm -rf /');
  });

  it('blocks shutdown', async () => {
    await expectBlocked('shutdown -h now');
  });

  // --- format command: block real disk formatting, allow safe uses ---
  it('blocks format C: disk formatting command', async () => {
    await expectBlocked('format C:');
  });

  it('blocks format D: with leading whitespace', async () => {
    await expectBlocked('  format d:');
  });

  it('blocks format C: wrapped in cmd /c', async () => {
    await expectBlocked('cmd /c format C:');
  });

  it('blocks format D: wrapped in powershell -Command', async () => {
    await expectBlocked('powershell -Command "format D:"');
  });

  it('blocks format.com C: (Windows executable name bypass)', async () => {
    await expectBlocked('format.com C:');
  });

  it('blocks cmd /c format.com C: (wrapper + .com extension)', async () => {
    await expectBlocked('cmd /c format.com C:');
  });

  it('does NOT block commands with --output-format flag', async () => {
    await expectNotBlocked('python teams_channel.py read-channel --output-format json');
  });

  it('does NOT block commands with format in a subcommand argument', async () => {
    await expectNotBlocked('az resource list --output-format table');
  });
});