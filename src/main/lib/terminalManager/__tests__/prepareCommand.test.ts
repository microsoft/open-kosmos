/**
 * Unit tests for TerminalInstance.prepareCommand() PowerShell handling
 *
 * These test cases are derived from actual failures in:
 * - .vscode/debug/分析 YouTube 视频.json
 * - .vscode/debug/YouTube Podcast Analysis.json
 *
 * The bug: Commands like `python scripts/download_audio.py "url"` were being
 * incorrectly wrapped as `& "python scripts/download_audio.py url"`, causing
 * PowerShell to treat the entire string as a single command name.
 */

// Mock electron app before any imports
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

// Mock RuntimeManager
vi.mock('../../runtime/RuntimeManager', async () => ({
  runtimeManager: {
    getMode: vi.fn().mockReturnValue('system'),
    isInternal: vi.fn().mockReturnValue(false),
    getBinPath: vi.fn().mockReturnValue('C:\\test\\bin'),
    resolveCommand: vi.fn((cmd: string) => cmd)
  }
}));

// Mock PlatformConfigManager for testing
vi.mock('../PlatformConfigManager', async () => ({
  PlatformConfigManager: {
    getInstance: () => ({
      getRunnableShellProfile: async (shell?: string) => ({
        shellType: shell || 'powershell',
        profile: {
          command: 'powershell.exe',
          args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
          supportsPersistent: true
        }
      }),
      getShellProfile: (shell?: string) => ({
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true
      }),
      getDefaultShell: () => 'powershell',
      getConfig: () => ({
        shells: {
          powershell: {
            command: 'powershell.exe',
            args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
            supportsPersistent: true
          }
        },
        defaultShell: 'powershell',
        pathSeparator: ';',
        executableExtensions: ['.exe', '.cmd', '.bat', '.com']
      })
    })
  }
}));

import { TerminalInstance } from '../TerminalInstance';
import { TerminalConfig } from '../types';

// Helper to create a valid TerminalConfig
function createConfig(command: string, shell: 'powershell' | 'cmd' | 'bash' = 'powershell'): TerminalConfig {
  return {
    command,
    args: [],
    cwd: 'C:\\test',
    type: 'command',
    shell
  };
}

// Test helper to extract the prepared command
class TestableTerminalInstance extends TerminalInstance {
  public async testPrepareCommand(): Promise<{ executable: string; args: string[]; shell: boolean }> {
    // Access the private method via reflection for testing
    return (this as any).prepareCommand('');
  }

  public async testPrepareCommandWithOverride(shellType: string): Promise<{ executable: string; args: string[]; shell: boolean }> {
    return (this as any).prepareCommand('', undefined, shellType);
  }

  public testCreateMissingCwdPrefix(originalCwd: string, shellCommand: string): string {
    return (this as any).createMissingCwdPrefix(originalCwd, shellCommand);
  }

  public testParseCommandString(command: string): { executable: string; inlineArgs: string } {
    return (this as any).parseCommandString(command);
  }

  public testCreateShellWrapper(command: string, shellType?: string): string {
    return (this as any).createShellWrapper(command, shellType);
  }
}

describe('TerminalInstance PowerShell command handling', () => {
  const originalPlatform = process.platform;

  beforeAll(() => {
    // Mock Windows platform
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  describe('parseCommandString', () => {
    it('should parse simple command with arguments', () => {
      const command = 'python scripts/download_audio.py "https://youtube.com/watch?v=123"';
      const config = createConfig(command);
      const instance = new TestableTerminalInstance(config);

      const result = instance.testParseCommandString(command);

      expect(result.executable).toBe('python');
      expect(result.inlineArgs).toBe('scripts/download_audio.py "https://youtube.com/watch?v=123"');
    });

    it('should parse quoted executable path', () => {
      const command = '"C:\\Program Files\\Python\\python.exe" scripts/test.py';
      const config = createConfig(command);
      const instance = new TestableTerminalInstance(config);

      const result = instance.testParseCommandString(command);

      expect(result.executable).toBe('"C:\\Program Files\\Python\\python.exe"');
      expect(result.inlineArgs).toBe('scripts/test.py');
    });

    it('should parse command without arguments', () => {
      const command = 'python';
      const config = createConfig(command);
      const instance = new TestableTerminalInstance(config);

      const result = instance.testParseCommandString(command);

      expect(result.executable).toBe('python');
      expect(result.inlineArgs).toBe('');
    });

    it('should parse Get-ChildItem with quoted path', () => {
      const command = 'Get-ChildItem "C:\\Users\\test\\path with spaces"';
      const config = createConfig(command);
      const instance = new TestableTerminalInstance(config);

      const result = instance.testParseCommandString(command);

      expect(result.executable).toBe('Get-ChildItem');
      expect(result.inlineArgs).toBe('"C:\\Users\\test\\path with spaces"');
    });
  });

  describe('prepareCommand - actual failure cases from chat logs', () => {
    /**
     * Case 1: From "Analyze YouTube Video.json"
     * Original command: python scripts/download_audio.py "https://www.youtube.com/watch?v=6y1fcHUOHZI"
     *
     * BEFORE fix: & "python scripts/download_audio.py https://..." (WRONG - whole string as command)
     * AFTER fix: python scripts/download_audio.py "https://..." (CORRECT)
     */
    it('should NOT wrap python + script path in quotes', async () => {
      const config = createConfig('python scripts/download_audio.py "https://www.youtube.com/watch?v=6y1fcHUOHZI"');
      const instance = new TestableTerminalInstance(config);

      const result = await instance.testPrepareCommand();

      // The command passed to -Command should NOT have quotes around python
      const fullCommand = result.args[result.args.length - 1];

      // Should NOT start with & " (call operator + quoted command)
      expect(fullCommand).not.toMatch(/^& "python/);

      // Should be passed as-is or with proper argument quoting
      expect(fullCommand).toContain('python');
      expect(fullCommand).toContain('scripts/download_audio.py');
    });

    /**
     * Case 2: From "Analyze YouTube Video.json"
     * Original command: Get-ChildItem "C:\Users\v-fuchenyu\AppData\Roaming\openkosmos-app\..."
     *
     * BEFORE fix: & "Get-ChildItem ..." (WRONG)
     * AFTER fix: Get-ChildItem "..." (CORRECT)
     */
    it('should NOT wrap Get-ChildItem cmdlet in quotes', async () => {
      const config = createConfig('Get-ChildItem "C:\\Users\\v-fuchenyu\\AppData\\Roaming\\openkosmos-app\\profiles"');
      const instance = new TestableTerminalInstance(config);

      const result = await instance.testPrepareCommand();
      const fullCommand = result.args[result.args.length - 1];

      // Should NOT wrap Get-ChildItem in quotes
      expect(fullCommand).not.toMatch(/^& "Get-ChildItem/);
      expect(fullCommand).toContain('Get-ChildItem');
    });

    /**
     * Case 3: From "Analyze YouTube Video.json"
     * Original command: dir "C:\Users\..."
     *
     * BEFORE fix: & "dir ..." (WRONG)
     * AFTER fix: dir "..." (CORRECT)
     */
    it('should NOT wrap dir command in quotes', async () => {
      const config = createConfig('dir "C:\\Users\\v-fuchenyu\\AppData\\Roaming\\openkosmos-app"');
      const instance = new TestableTerminalInstance(config);

      const result = await instance.testPrepareCommand();
      const fullCommand = result.args[result.args.length - 1];

      expect(fullCommand).not.toMatch(/^& "dir/);
    });

    /**
     * Case 4: Executable with spaces in path SHOULD be quoted with &
     * Example: "C:\Program Files\Python\python.exe" -V
     */
    it('SHOULD add & for quoted executable paths with spaces', async () => {
      const config = createConfig('"C:\\Program Files\\Python\\python.exe" -V');
      const instance = new TestableTerminalInstance(config);

      const result = await instance.testPrepareCommand();
      const fullCommand = result.args[result.args.length - 1];

      // This case SHOULD have the & operator because the executable itself is quoted
      expect(fullCommand).toMatch(/^& /);
      expect(fullCommand).toContain('"C:\\Program Files\\Python\\python.exe"');
    });

    /**
     * Case 5: Simple command without paths
     */
    it('should handle simple commands without modification', async () => {
      const config = createConfig('python --version');
      const instance = new TestableTerminalInstance(config);

      const result = await instance.testPrepareCommand();
      const fullCommand = result.args[result.args.length - 1];

      expect(fullCommand).not.toMatch(/^& "/);
      expect(fullCommand).toBe('python --version');
    });
  });

  describe('PowerShell -Command argument format', () => {
    it('should use -Command not -c for PowerShell', async () => {
      const config = createConfig('python test.py');
      const instance = new TestableTerminalInstance(config);

      const result = await instance.testPrepareCommand();

      expect(result.args).toContain('-Command');
      expect(result.args).not.toContain('-c');
    });
  });

  describe('shell wrapper fallback environment', () => {
    it('uses the effective fallback shell when building Unix shell wrappers', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const config = createConfig('node -v', 'bash');
      const instance = new TestableTerminalInstance(config);

      const fullCommand = instance.testCreateShellWrapper('node -v', 'zsh');

      expect(fullCommand).toContain('.zshrc');
      expect(fullCommand).not.toContain('.profile');
    });
  });

  describe('missing cwd prefix generation', () => {
    it('uses Set-Location for PowerShell when cwd is missing', () => {
      const instance = new TestableTerminalInstance(createConfig('python test.py'));

      const prefix = instance.testCreateMissingCwdPrefix('C:\\missing path\\session', 'powershell.exe');

      expect(prefix).toBe('Set-Location -LiteralPath "C:\\missing path\\session"; ');
    });

    it('uses cmd-compatible cd /d prefix for cmd.exe', () => {
      const instance = new TestableTerminalInstance(createConfig('dir', 'cmd'));

      const prefix = instance.testCreateMissingCwdPrefix('C:\\missing path\\session', 'cmd.exe');

      expect(prefix).toBe('cd /d "C:\\missing path\\session" && ');
    });
  });
});
