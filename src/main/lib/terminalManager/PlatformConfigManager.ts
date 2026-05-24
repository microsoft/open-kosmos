/**
 * Platform configuration manager.
 * Handles terminal configuration differences between Windows and macOS.
 */

import { ShellType, ShellProfile, PlatformConfig } from './types';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { app } from 'electron';
import { RuntimeManager } from '../runtime/RuntimeManager';

/**
 * Platform-specific shell configurations.
 */
const PLATFORM_CONFIGS: Partial<Record<NodeJS.Platform, PlatformConfig>> = {
  win32: {
    shells: {
      powershell: {
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true
      },
      cmd: {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s'],
        supportsPersistent: false
      },
      bash: {
        command: 'bash.exe', // WSL or Git Bash
        args: ['-l'],
        supportsPersistent: true
      },
      sh: {
        command: 'sh.exe',
        args: [],
        supportsPersistent: false
      },
      zsh: {
        command: 'zsh.exe', // WSL or Git Bash
        args: ['-l'],
        supportsPersistent: true
      }
    },
    defaultShell: 'powershell',
    pathSeparator: ';',
    executableExtensions: ['.exe', '.cmd', '.bat', '.com']
  },

  darwin: {
    shells: {
      zsh: {
        command: '/bin/zsh',
        args: ['-l', '-i'],  // interactive login shell — ensures ~/.zshrc is loaded
        supportsPersistent: true
      },
      bash: {
        command: '/bin/bash',
        args: ['-l', '-i'],  // interactive login shell — ensures ~/.bash_profile and ~/.bashrc are loaded
        supportsPersistent: true
      },
      sh: {
        command: '/bin/sh',
        args: ['-l'],  // load at least the login configuration
        supportsPersistent: false
      },
      powershell: {
        command: 'pwsh', // PowerShell Core
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true
      },
      cmd: {
        command: '/bin/sh', // Fallback to sh
        args: ['-l', '-c'],  // run command after loading configuration
        supportsPersistent: false
      }
    },
    defaultShell: 'zsh',
    pathSeparator: ':',
    executableExtensions: ['']
  },

  linux: {
    shells: {
      bash: {
        command: '/bin/bash',
        args: ['-l', '-i'],  // interactive login shell
        supportsPersistent: true
      },
      zsh: {
        command: '/bin/zsh',
        args: ['-l', '-i'],  // interactive login shell
        supportsPersistent: true
      },
      sh: {
        command: '/bin/sh',
        args: ['-l'],  // load at least the login configuration
        supportsPersistent: false
      },
      powershell: {
        command: 'pwsh',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true
      },
      cmd: {
        command: '/bin/sh',
        args: ['-l', '-c'],  // run command after loading configuration
        supportsPersistent: false
      }
    },
    defaultShell: 'bash',
    pathSeparator: ':',
    executableExtensions: ['']
  }
};

/**
 * Platform configuration manager.
 */
export class PlatformConfigManager {
  private static instance: PlatformConfigManager;
  private config: PlatformConfig;
  private shellAvailabilityCache = new Map<string, boolean>();

  private constructor() {
    this.config = PLATFORM_CONFIGS[process.platform] || PLATFORM_CONFIGS.linux!;
  }

  public static getInstance(): PlatformConfigManager {
    if (!PlatformConfigManager.instance) {
      PlatformConfigManager.instance = new PlatformConfigManager();
    }
    return PlatformConfigManager.instance;
  }

  /**
   * Returns the current platform configuration.
   */
  public getConfig(): PlatformConfig {
    return this.config;
  }

  /**
   * Returns the default shell for the current platform.
   */
  public getDefaultShell(): ShellType {
    return this.config.defaultShell;
  }

  /**
   * Returns the shell profile for the given shell type.
   */
  public getShellProfile(shell?: ShellType): ShellProfile {
    const shellType = shell || this.config.defaultShell;
    return this.config.shells[shellType] || this.config.shells[this.config.defaultShell];
  }

  public async getRunnableShellProfile(shell?: ShellType): Promise<{ shellType: ShellType; profile: ShellProfile; fallbackReason?: string }> {
    const requestedShell = shell || this.config.defaultShell;
    const requestedProfile = this.getShellProfile(requestedShell);

    if (await this.isShellCommandAvailable(requestedProfile.command)) {
      return { shellType: requestedShell, profile: requestedProfile };
    }

    const defaultShell = this.config.defaultShell;
    const defaultProfile = this.getShellProfile(defaultShell);
    if (requestedShell !== defaultShell && await this.isShellCommandAvailable(defaultProfile.command)) {
      return {
        shellType: defaultShell,
        profile: defaultProfile,
        fallbackReason: `Shell '${requestedShell}' is unavailable; falling back to '${defaultShell}'.`
      };
    }

    return {
      shellType: requestedShell,
      profile: requestedProfile,
      fallbackReason: `Shell '${requestedShell}' command '${requestedProfile.command}' is unavailable.`
    };
  }

  /**
   * Returns whether the given shell supports persistent connections.
   */
  public isShellPersistent(shell?: ShellType): boolean {
    const profile = this.getShellProfile(shell);
    return profile.supportsPersistent;
  }

  public async isShellCommandAvailable(command: string): Promise<boolean> {
    if (!command || command.trim() === '') {
      return false;
    }

    const cacheKey = `${process.platform}:${command}`;
    const cached = this.shellAvailabilityCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let available = false;

    if (path.isAbsolute(command)) {
      try {
        await fs.access(command, fsSync.constants.F_OK | fsSync.constants.X_OK);
        available = true;
      } catch {
        available = false;
      }
    } else {
      const resolved = await this.resolveCommandPath(command);
      available = resolved !== command;

      if (!available && process.platform === 'win32') {
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const comspec = process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe');
        const normalizedCommand = command.toLowerCase();
        if (normalizedCommand === 'powershell.exe') {
          available = true;
        } else if (normalizedCommand === 'cmd.exe') {
          available = comspec.toLowerCase().endsWith('cmd.exe');
        }
      }
    }

    this.shellAvailabilityCache.set(cacheKey, available);
    return available;
  }

  /**
   * Resolves the full path to a command, handling platform differences.
   */
  public async resolveCommandPath(command: string, cwd?: string): Promise<string> {
    // On Windows, return the command as-is (delegated to findWindowsExecutable)
    if (process.platform === 'win32') {
      return await this.findWindowsExecutable(command, cwd);
    }

    // Unix-like systems: search for the executable
    return await this.findUnixExecutable(command, cwd);
  }

  /**
   * Finds an executable on Windows by searching PATH with known extensions.
   */
  private async findWindowsExecutable(command: string, cwd?: string): Promise<string> {
    const pathEnv = process.env.PATH || '';
    const searchPaths = pathEnv.split(this.config.pathSeparator);

    if (cwd) {
      searchPaths.unshift(cwd);
    }

    // Check whether the command already has an extension
    const hasExtension = this.config.executableExtensions.some(ext =>
      ext === '' ? !command.includes('.') : command.toLowerCase().endsWith(ext.toLowerCase())
    );

    const extensions = hasExtension ? [''] : this.config.executableExtensions;

    for (const dir of searchPaths) {
      for (const ext of extensions) {
        const fullPath = path.join(dir, command + ext);
        try {
          await fs.access(fullPath, fs.constants.F_OK | fs.constants.X_OK);
          return fullPath;
        } catch {
          // keep searching
        }
      }
    }

    return command; // return original command and let the system handle it
  }

  /**
   * Finds an executable on Unix-like systems.
   */
  private async findUnixExecutable(command: string, cwd?: string): Promise<string> {
    // If the command contains a path separator, return it as-is
    if (command.includes('/')) {
      return command;
    }

    // If the command contains shell operators (&&, ||, |, ;), it is a compound command — let the shell handle it
    if (/[&|;]/.test(command)) {
      return command; // return original command and let the shell handle it
    }

    // Extract the actual command name (ignore arguments)
    const baseCommand = command.split(/\s+/)[0];

    // If the command is just the base name (no arguments), search for it on PATH
    if (baseCommand === command) {
      // Try `which` first
      try {
        const result = execSync(`which "${baseCommand}"`, {
          encoding: 'utf8',
          env: this.getEnhancedEnvironment() as NodeJS.ProcessEnv,
          timeout: 5000
        }).trim();

        if (result && result.length > 0 && !result.includes('\n')) {
          return result;
        }
      } catch {
        // `which` failed — fall back to manual search
      }

      // Manually search common paths
      const searchPaths = this.getCommonUnixPaths(baseCommand);

      for (const execPath of searchPaths) {
        try {
          await fs.access(execPath, fs.constants.F_OK | fs.constants.X_OK);
          return execPath;
        } catch {
          // keep searching
        }
      }
    }

    // If the command has arguments or the path was not found, return the original
    return command;
  }

  /**
   * Returns common executable search paths for Unix systems.
   */
  private getCommonUnixPaths(command: string): string[] {
    const baseCommand = command.split(' ')[0];
    const home = homedir();

    return [
      `/opt/homebrew/bin/${baseCommand}`,         // Homebrew (Apple Silicon)
      `/usr/local/bin/${baseCommand}`,            // Homebrew (Intel) / manual install
      `/usr/bin/${baseCommand}`,                  // system commands
      `/bin/${baseCommand}`,                      // base system commands
      `/usr/sbin/${baseCommand}`,                 // system administration commands
      `/sbin/${baseCommand}`,                     // base system administration commands
      `${home}/.local/bin/${baseCommand}`,        // user-local installs
      `${home}/.cargo/bin/${baseCommand}`,        // Rust/Cargo installs
      `${home}/.npm-global/bin/${baseCommand}`,   // npm global installs
      `${home}/.pyenv/shims/${baseCommand}`,      // pyenv-managed Python
      `${home}/.nvm/current/bin/${baseCommand}`,  // nvm-managed Node.js
      `/Library/Frameworks/Python.framework/Versions/Current/bin/${baseCommand}`, // Python.org install
      `/opt/miniconda3/bin/${baseCommand}`,       // Miniconda
      `/opt/anaconda3/bin/${baseCommand}`,        // Anaconda
    ];
  }

  /**
   * Returns the bin path under the user data directory.
   * Used to store custom executables (bun, node, npm, npx, pip, python, python3, uv, uvx).
   */
  private getUserDataBinPath(): string | null {
    try {
      const userDataPath = app.getPath('userData');
      return path.join(userDataPath, 'bin');
    } catch {
      // app is not yet initialized — return null
      return null;
    }
  }

  /**
   * Returns enhanced environment variables.
   * @param includeBinPath Whether to include the user data bin path (true in internal mode, false in system mode).
   */
  public getEnhancedEnvironment(includeBinPath: boolean = true): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;

    // Remove npm_config_prefix to avoid conflicts with nvm in subprocesses.
    // Homebrew node sets this, but it's incompatible with nvm. Only strip in
    // internal runtime mode (includeBinPath=true); system mode preserves the
    // user's original environment.
    if (includeBinPath) {
      delete env['npm_config_prefix'];
    }

    // Retrieve the user data bin path (only added when includeBinPath is true)
    const userDataBinPath = includeBinPath ? this.getUserDataBinPath() : null;

    // Windows handling
    if (process.platform === 'win32') {
      // Find the existing Path variable (case-insensitive) to avoid creating a duplicate PATH that drops system entries
      const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';

      // Prepend the bin directory to PATH (internal mode only)
      if (userDataBinPath) {
        env[pathKey] = userDataBinPath + this.config.pathSeparator + (env[pathKey] || '');
      }
      // Add pinned Python version (internal mode only)
      if (includeBinPath) {
        this.addPinnedPythonVersion(env);
      }
      // When internal-runtime shims are on PATH, prevent Windows from
      // resolving .cmd/.exe from CWD before PATH. Without this, stale
      // shims in the user's home directory (from prior bun/npm global
      // installs) shadow our internal runtime shims.
      if (includeBinPath) {
        env['NoDefaultCurrentDirectoryInExePath'] = '1';
      }
      return env;
    }

    // Unix systems: enhance PATH and environment variables
    const home = homedir();
    const pathComponents = [
      userDataBinPath,                        // 🔥 user data bin (highest priority, internal mode only)
      '/opt/homebrew/bin',                    // Homebrew (Apple Silicon)
      '/opt/homebrew/sbin',
      '/usr/local/bin',                       // Homebrew (Intel) / manual installs
      '/usr/local/sbin',
      '/usr/bin',                             // system commands
      '/bin',                                 // base system commands
      '/usr/sbin',                            // system administration commands
      '/sbin',                                // base system administration commands
      `${home}/.local/bin`,                   // user-local installs
      `${home}/.cargo/bin`,                   // Rust/Cargo installs
      `${home}/.npm-global/bin`,              // npm global installs
      `${home}/.pyenv/shims`,                 // pyenv-managed Python
      `${home}/.nvm/current/bin`,             // nvm-managed Node.js
      '/Library/Frameworks/Python.framework/Versions/Current/bin', // Python.org install
      '/opt/miniconda3/bin',                  // Miniconda
      '/opt/anaconda3/bin',                   // Anaconda
      env.PATH || ''                          // original PATH
    ];

    const enhancedEnv = {
      ...env,
      PATH: pathComponents.filter(p => p).join(this.config.pathSeparator),
      HOME: env.HOME || home,
      USER: env.USER || 'user',
      SHELL: env.SHELL || '/bin/bash',
      TMPDIR: env.TMPDIR || '/tmp',
      LANG: env.LANG || 'en_US.UTF-8'
    };

    // Add environment manager variables
    this.addEnvironmentManagerVars(enhancedEnv, home);

    // Add RuntimeManager pinned Python version (internal mode only)
    if (includeBinPath) {
      this.addPinnedPythonVersion(enhancedEnv);
    }

    return enhancedEnv;
  }

  /**
   * Adds environment manager variables (pyenv, nvm, rbenv, nodenv, Rust, Go, Homebrew).
   */
  private addEnvironmentManagerVars(env: Record<string, string>, home: string): void {
    // pyenv
    if (!env.PYENV_ROOT) {
      env.PYENV_ROOT = `${home}/.pyenv`;
    }

    // nvm
    if (!env.NVM_DIR) {
      env.NVM_DIR = `${home}/.nvm`;
    }

    // rbenv (Ruby version management)
    if (!env.RBENV_ROOT) {
      env.RBENV_ROOT = `${home}/.rbenv`;
    }

    // nodenv (Node.js version management)
    if (!env.NODENV_ROOT) {
      env.NODENV_ROOT = `${home}/.nodenv`;
    }

    // Rust
    if (!env.CARGO_HOME) {
      env.CARGO_HOME = `${home}/.cargo`;
    }
    if (!env.RUSTUP_HOME) {
      env.RUSTUP_HOME = `${home}/.rustup`;
    }

    // Go
    if (!env.GOPATH) {
      env.GOPATH = `${home}/go`;
    }

    // Homebrew (macOS)
    if (process.platform === 'darwin') {
      if (!env.HOMEBREW_PREFIX) {
        // Detect Apple Silicon
        const isAppleSilicon = process.arch === 'arm64';
        env.HOMEBREW_PREFIX = isAppleSilicon ? '/opt/homebrew' : '/usr/local';
      }
      if (!env.HOMEBREW_CELLAR) {
        env.HOMEBREW_CELLAR = `${env.HOMEBREW_PREFIX}/Cellar`;
      }
      if (!env.HOMEBREW_REPOSITORY) {
        env.HOMEBREW_REPOSITORY = `${env.HOMEBREW_PREFIX}/Homebrew`;
      }
    }
  }

  /**
   * Adds RuntimeManager's pinned Python version and venv path to the environment.
   *
   * - UV_PYTHON:   tells uv which Python version to use
   * - VIRTUAL_ENV: tells uv pip install / python to discover the venv at
   *                {userData}/python-venv/ regardless of cwd
   */
  private addPinnedPythonVersion(env: Record<string, string>): void {
    try {
      const runtimeManager = RuntimeManager.getInstance();
      const config = runtimeManager.getRunTimeConfig();

      if (config.pinnedPythonVersion && config.pinnedPythonVersion.trim().length > 0) {
        // UV_PYTHON sets the Python interpreter version — can be a version number like "3.12" or a full path
        env['UV_PYTHON'] = config.pinnedPythonVersion;
      }

      // Point VIRTUAL_ENV to {userData}/python-venv so that `uv pip install`,
      // `python`, and any subprocess discover the venv regardless of cwd.
      // Without this, uv searches for .venv from cwd upward, which fails in
      // packaged apps where cwd is "/" (macOS) or "C:\Windows\System32" (Windows).
      const venvPath = runtimeManager.getVenvPath();
      if (venvPath) {
        env['VIRTUAL_ENV'] = venvPath;
      }
    } catch {
      // RuntimeManager is not yet initialized — ignore
    }
  }

  /**
   * Parses the contents of an environment file into key-value pairs.
   */
  public parseEnvFile(content: string): Array<[string, string]> {
    const result: Array<[string, string]> = [];
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }

      const key = trimmed.substring(0, equalIndex).trim();
      const value = trimmed.substring(equalIndex + 1).trim();

      // Strip surrounding quotes
      const unquotedValue = value.replace(/^["']|["']$/g, '');
      result.push([key, unquotedValue]);
    }

    return result;
  }

  /**
   * Expands a tilde path to an absolute path.
   */
  public untildify(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(homedir(), filePath.slice(2));
    }
    return filePath;
  }

  /**
   * Formats subprocess arguments (handles Windows CVE-2024-27980).
   */
  public async formatSubprocessArguments(
    executable: string,
    args: readonly string[],
    cwd?: string,
    env?: Record<string, string | undefined>
  ): Promise<{ executable: string; args: string[]; shell: boolean }> {
    if (process.platform !== 'win32') {
      return { executable, args: [...args], shell: false };
    }

    // Windows special handling
    const windowsShellScriptRe = /\.(bat|cmd)$/i;
    const found = await this.findWindowsExecutable(executable, cwd);

    if (found && windowsShellScriptRe.test(found)) {
      const quote = (s: string) => s.includes(' ') ? `"${s}"` : s;
      return {
        executable: quote(found),
        args: args.map(quote),
        shell: true,
      };
    }

    return { executable, args: [...args], shell: false };
  }
}