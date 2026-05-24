/**
 * Regression tests for hookRegistry DANGEROUS_PATTERNS security blocklist.
 *
 * These tests verify that the validateHookCommand() function correctly blocks
 * dangerous commands (credential deletion, OAuth logout, browser profile access)
 * and allows safe commands through.
 */
import { hookRegistry } from '../hookRegistry';

// Mock child_process to prevent actual command execution
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock the unified logger
vi.mock('../../../unifiedLogger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const TEST_PLUGIN_ID = 'test-plugin';
const TEST_PLUGIN_PATH = '/tmp/test-plugin';

describe('hookRegistry DANGEROUS_PATTERNS validation', () => {
  beforeEach(() => {
    hookRegistry.clear();
  });

  /**
   * Helper: register a hook and execute it; return the result.
   * Blocked commands return success:false with an error containing "security policy".
   */
  const executeHook = async (command: string) => {
    hookRegistry.registerPluginHooks(TEST_PLUGIN_ID, TEST_PLUGIN_PATH, 'SessionStart', [
      { type: 'command', command, async: false },
    ]);
    const result = await hookRegistry.execute('SessionStart', {
      userAlias: 'testuser',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      workspacePath: '/tmp/workspace',
    });
    hookRegistry.clear();
    return result;
  };

  // --- Credential / token deletion ---
  it('blocks PowerShell Remove-Item targeting credential files', async () => {
    const result = await executeHook('Remove-Item -Force "$env:LOCALAPPDATA\\Microsoft\\TokenBroker\\credentials\\browserAuthTokenCache.enc"');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks rm targeting token files', async () => {
    const result = await executeHook('rm -f ~/.config/auth-token-cache');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks del targeting cookie files', async () => {
    const result = await executeHook('del /f C:\\Users\\user\\cookies.dat');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  // --- OAuth logout/revoke/signout URLs ---
  it('blocks commands with Microsoft OAuth logout URL', async () => {
    const result = await executeHook('curl https://login.microsoftonline.com/common/oauth2/logout');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks commands with Google logout URL', async () => {
    const result = await executeHook('curl https://accounts.google.com/Logout');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks commands with login.live.com logout', async () => {
    const result = await executeHook('curl https://login.live.com/oauth20_logout.srf');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks commands with generic /oauth2/revoke path', async () => {
    const result = await executeHook('curl https://example.com/oauth2/revoke?token=abc');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks commands with /oauth/signout path', async () => {
    const result = await executeHook('curl https://example.com/oauth/signout');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  // --- Browser profile directory access ---
  it('blocks commands targeting Windows Edge User Data directory', async () => {
    const result = await executeHook('Remove-Item -Recurse "C:\\\\Users\\\\user\\\\AppData\\\\Local\\\\Microsoft\\\\Edge\\\\User Data\\\\Default"');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks commands targeting macOS Chrome profile directory', async () => {
    const result = await executeHook('rm -rf ~/Library/Application Support/Google/Chrome/Default/Cookies');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks commands targeting macOS Edge profile directory', async () => {
    const result = await executeHook('rm -rf ~/Library/Application Support/Microsoft Edge/Default/Cookies');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  // --- Filesystem destruction ---
  it('blocks rm -rf /', async () => {
    const result = await executeHook('rm -rf /');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks shutdown commands', async () => {
    const result = await executeHook('shutdown -h now');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  // --- Empty command ---
  it('blocks empty commands', async () => {
    const result = await executeHook('   ');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/Empty hook command/);
  });

  // --- Safe commands should NOT be blocked ---
  // Note: safe commands will fail with exec mock but won't have "security policy" error
  it('does not block normal commands', async () => {
    const { exec } = await import('child_process');
    // Make exec call the callback with success
    (exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
      cb(null, 'ok', '');
    });

    const result = await executeHook('echo hello world');
    expect(result.allSucceeded).toBe(true);
    expect(result.results[0].error).toBeUndefined();
  });

  // --- format command: block real disk formatting, allow safe uses ---
  it('blocks format C: disk formatting command', async () => {
    const result = await executeHook('format C:');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks format C: wrapped in cmd /c', async () => {
    const result = await executeHook('cmd /c format C:');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks format D: wrapped in powershell -Command', async () => {
    const result = await executeHook('powershell -Command "format D:"');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks format.com C: (Windows executable name bypass)', async () => {
    const result = await executeHook('format.com C:');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('blocks cmd /c format.com C: (wrapper + .com extension)', async () => {
    const result = await executeHook('cmd /c format.com C:');
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].error).toMatch(/security policy/);
  });

  it('does not block commands with --output-format flag', async () => {
    const { exec } = await import('child_process');
    (exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
      cb(null, 'ok', '');
    });

    const result = await executeHook('python teams_channel.py read-channel --output-format json');
    expect(result.allSucceeded).toBe(true);
    expect(result.results[0].error).toBeUndefined();
  });
});
