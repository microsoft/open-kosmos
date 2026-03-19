/**
 * Platform Configuration Manager
 * Handles terminal configuration differences between Windows and macOS
 */

import { ShellType, ShellProfile, PlatformConfig } from './types';
import * as path from 'path';
import * as fs from 'fs/promises';
import { homedir } from 'os';
import { app } from 'electron';

/**
 * Platform-specific shell configuration
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
        args: ['-l', '-i'],  // Interactive login shell, ensures ~/.zshrc is loaded
        supportsPersistent: true
      },
      bash: {
        command: '/bin/bash',
        args: ['-l', '-i'],  // Interactive login shell, ensures ~/.bash_profile and ~/.bashrc are loaded
        supportsPersistent: true
      },
      sh: {
        command: '/bin/sh',
        args: ['-l'],  // At least load login configuration
        supportsPersistent: false
      },
      powershell: {
        command: 'pwsh', // PowerShell Core
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true
      },
      cmd: {
        command: '/bin/sh', // Fallback to sh
        args: ['-l', '-c'],  // Load configuration then execute command
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
        args: ['-l', '-i'],  // Interactive login shell
        supportsPersistent: true
      },
      zsh: {
        command: '/bin/zsh',
        args: ['-l', '-i'],  // Interactive login shell
        supportsPersistent: true
      },
      sh: {
        command: '/bin/sh',
        args: ['-l'],  // At least load login configuration
        supportsPersistent: false
      },
      powershell: {
        command: 'pwsh',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true
      },
      cmd: {
        command: '/bin/sh',
        args: ['-l', '-c'],  // Load configuration then execute command
        supportsPersistent: false
      }
    },
    defaultShell: 'bash',
    pathSeparator: ':',
    executableExtensions: ['']
  }
};

/**
 * Platform configuration manager
 */
export class PlatformConfigManager {
  private static instance: PlatformConfigManager;
  private config: PlatformConfig;
  
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
   * Get current platform configuration
   */
  public getConfig(): PlatformConfig {
    return this.config;
  }
  
  /**
   * Get the default shell
   */
  public getDefaultShell(): ShellType {
    return this.config.defaultShell;
  }
  
  /**
   * Get shell profile configuration
   */
  public getShellProfile(shell?: ShellType): ShellProfile {
    const shellType = shell || this.config.defaultShell;
    return this.config.shells[shellType] || this.config.shells[this.config.defaultShell];
  }
  
  /**
   * Check if shell supports persistent connections
   */
  public isShellPersistent(shell?: ShellType): boolean {
    const profile = this.getShellProfile(shell);
    return profile.supportsPersistent;
  }
  
  /**
   * Resolve command path, handling platform differences
   */
  public async resolveCommandPath(command: string, cwd?: string): Promise<string> {
    // Windows returns the original command directly
    if (process.platform === 'win32') {
      return await this.findWindowsExecutable(command, cwd);
    }
    
    // Unix-like systems need to find the executable
    return await this.findUnixExecutable(command, cwd);
  }
  
  /**
   * Find an executable on Windows
   */
  private async findWindowsExecutable(command: string, cwd?: string): Promise<string> {
    const pathEnv = process.env.PATH || '';
    const searchPaths = pathEnv.split(this.config.pathSeparator);
    
    if (cwd) {
      searchPaths.unshift(cwd);
    }
    
    // Check if it already has an extension
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
          // Continue searching
        }
      }
    }
    
    return command; // Return original command, let the system handle it
  }
  
  /**
   * Find an executable on Unix systems
   */
  private async findUnixExecutable(command: string, cwd?: string): Promise<string> {
    // If the command contains a path separator, return directly
    if (command.includes('/')) {
      return command;
    }
    
    // If the command contains shell operators (&&, ||, |, ;), it's a compound command that needs shell execution
    if (/[&|;]/.test(command)) {
      return command; // Return original command, let the shell handle it
    }
    
    // Extract the actual command name (ignoring arguments)
    const baseCommand = command.split(/\s+/)[0];
    
    // If the command is a base command (no arguments), perform path lookup
    if (baseCommand === command) {
      // First try to find the base command using the which command
      try {
        const { execSync } = require('child_process');
        const result = execSync(`which "${baseCommand}"`, {
          encoding: 'utf8',
          env: this.getEnhancedEnvironment(),
          timeout: 5000
        }).trim();
        
        if (result && result.length > 0 && !result.includes('\n')) {
          return result;
        }
      } catch {
        // which failed, continue with manual search
      }
      
      // Manually search common paths
      const searchPaths = this.getCommonUnixPaths(baseCommand);
      
      for (const execPath of searchPaths) {
        try {
          await fs.access(execPath, fs.constants.F_OK | fs.constants.X_OK);
          return execPath;
        } catch {
          // Continue searching
        }
      }
    }
    
    // If it contains arguments or the path is not found, return the original command
    return command;
  }
  
  /**
   * Get common Unix executable file paths
   */
  private getCommonUnixPaths(command: string): string[] {
    const baseCommand = command.split(' ')[0];
    const home = homedir();
    
    return [
      `/opt/homebrew/bin/${baseCommand}`,         // Homebrew (Apple Silicon)
      `/usr/local/bin/${baseCommand}`,            // Homebrew (Intel) / manually installed
      `/usr/bin/${baseCommand}`,                  // System commands
      `/bin/${baseCommand}`,                      // Basic system commands
      `/usr/sbin/${baseCommand}`,                 // System administration commands
      `/sbin/${baseCommand}`,                     // Basic system administration commands
      `${home}/.local/bin/${baseCommand}`,        // User local installation
      `${home}/.cargo/bin/${baseCommand}`,        // Rust/Cargo installation
      `${home}/.npm-global/bin/${baseCommand}`,   // npm global installation
      `${home}/.pyenv/shims/${baseCommand}`,      // pyenv managed Python
      `${home}/.nvm/current/bin/${baseCommand}`,  // nvm managed Node.js
      `/Library/Frameworks/Python.framework/Versions/Current/bin/${baseCommand}`, // Python.org installation
      `/opt/miniconda3/bin/${baseCommand}`,       // Miniconda
      `/opt/anaconda3/bin/${baseCommand}`,        // Anaconda
    ];
  }
  
  /**
   * Get the bin path under the user data directory
   * Used to store custom executables (bun, node, npm, npx, pip, python, python3, uv, uvx)
   */
  private getUserDataBinPath(): string | null {
    try {
      const userDataPath = app.getPath('userData');
      return path.join(userDataPath, 'bin');
    } catch {
      // Return null when app is not initialized
      return null;
    }
  }

  /**
   * Get enhanced environment variables
   * @param includeBinPath Whether to include the user data directory bin path (true for internal mode, false for system mode)
   */
  public getEnhancedEnvironment(includeBinPath: boolean = true): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    
    // Get the bin path under user data directory (only add when includeBinPath is true)
    const userDataBinPath = includeBinPath ? this.getUserDataBinPath() : null;
    
    // Windows handling
    if (process.platform === 'win32') {
      // Find existing Path variable (case-insensitive) to avoid creating duplicate PATH variables that would lose system paths
      const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
      
      // Prepend bin directory to PATH (internal mode only)
      if (userDataBinPath) {
        env[pathKey] = userDataBinPath + this.config.pathSeparator + (env[pathKey] || '');
      }
      // Add pinned Python version (internal mode only)
      if (includeBinPath) {
        this.addPinnedPythonVersion(env);
      }
      return env;
    }
    
    // Unix systems need enhanced PATH and environment variables
    const home = homedir();
    const pathComponents = [
      userDataBinPath,                        // 🔥 User data directory bin (highest priority, internal mode only)
      '/opt/homebrew/bin',                    // Homebrew (Apple Silicon)
      '/opt/homebrew/sbin',
      '/usr/local/bin',                       // Homebrew (Intel) / manually installed
      '/usr/local/sbin',
      '/usr/bin',                             // System commands
      '/bin',                                 // Basic system commands
      '/usr/sbin',                            // System administration commands
      '/sbin',                                // Basic system administration commands
      `${home}/.local/bin`,                   // User local installation
      `${home}/.cargo/bin`,                   // Rust/Cargo installation
      `${home}/.npm-global/bin`,              // npm global installation
      `${home}/.pyenv/shims`,                 // pyenv managed Python
      `${home}/.nvm/current/bin`,             // nvm managed Node.js
      '/Library/Frameworks/Python.framework/Versions/Current/bin', // Python.org installation
      '/opt/miniconda3/bin',                  // Miniconda
      '/opt/anaconda3/bin',                   // Anaconda
      env.PATH || ''                          // Original PATH
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
    
    // Add environment manager special environment variables
    this.addEnvironmentManagerVars(enhancedEnv, home);
    
    // Add RuntimeManager's pinned Python version (internal mode only)
    if (includeBinPath) {
      this.addPinnedPythonVersion(enhancedEnv);
    }
    
    return enhancedEnv;
  }
  
  /**
   * Add environment manager special environment variables
   */
  private addEnvironmentManagerVars(env: Record<string, string>, home: string): void {
    // pyenv related environment variables
    if (!env.PYENV_ROOT) {
      env.PYENV_ROOT = `${home}/.pyenv`;
    }
    
    // nvm related environment variables
    if (!env.NVM_DIR) {
      env.NVM_DIR = `${home}/.nvm`;
    }
    
    // rbenv related environment variables (Ruby version management)
    if (!env.RBENV_ROOT) {
      env.RBENV_ROOT = `${home}/.rbenv`;
    }
    
    // nodenv related environment variables (Node.js version management)
    if (!env.NODENV_ROOT) {
      env.NODENV_ROOT = `${home}/.nodenv`;
    }
    
    // Rust related environment variables
    if (!env.CARGO_HOME) {
      env.CARGO_HOME = `${home}/.cargo`;
    }
    if (!env.RUSTUP_HOME) {
      env.RUSTUP_HOME = `${home}/.rustup`;
    }
    
    // Go related environment variables
    if (!env.GOPATH) {
      env.GOPATH = `${home}/go`;
    }
    
    // Homebrew related environment variables (macOS)
    if (process.platform === 'darwin') {
      if (!env.HOMEBREW_PREFIX) {
        // Detect if Apple Silicon
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
   * Add RuntimeManager's pinned Python version to environment variables
   * The UV_PYTHON environment variable tells uv to use the specified Python version
   */
  private addPinnedPythonVersion(env: Record<string, string>): void {
    try {
      // Lazy import to avoid circular dependencies
      const { RuntimeManager } = require('../runtime/RuntimeManager');
      const runtimeManager = RuntimeManager.getInstance();
      const config = runtimeManager.getRunTimeConfig();
      
      if (config.pinnedPythonVersion && config.pinnedPythonVersion.trim().length > 0) {
        // UV_PYTHON sets the Python interpreter version
        // Can be a version number like "3.12" or a full path
        env['UV_PYTHON'] = config.pinnedPythonVersion;
      }
    } catch {
      // Ignore when RuntimeManager is not initialized
    }
  }
  
  /**
   * Parse environment file content
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
      
      // Remove quotes
      const unquotedValue = value.replace(/^["']|["']$/g, '');
      result.push([key, unquotedValue]);
    }
    
    return result;
  }
  
  /**
   * Expand tilde path
   */
  public untildify(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(homedir(), filePath.slice(2));
    }
    return filePath;
  }
  
  /**
   * Format subprocess arguments (handle Windows CVE-2024-27980)
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